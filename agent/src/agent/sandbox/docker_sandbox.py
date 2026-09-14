"""Docker sandbox: container-first boot, in-container clone, docker exec provisioning.

Threat model / design goal
--------------------------
Source code under test is sensitive and must never be persisted, or even briefly
staged, on the host filesystem. The previous design cloned the target repo to a
durable host mirror, created a per-run host `git worktree`, and only then copied
that directory into a container — so the code landed on host disk twice before a
container existed.

The flow now is:

1. Boot a hardened, resource-constrained container from a shared toolchain image
   with **no source code in it yet**. All hardening flags are applied at this
   first `docker run`, because untrusted `npm install` / `pip install` scripts
   execute immediately after an untrusted clone — there is no later, safer moment
   to constrain the container.
2. Clone the target repo *inside* the container via `docker exec`. The GitHub
   token is injected once as a container env var at `docker run` and read by a
   `GIT_ASKPASS` helper, so it never appears in a clone URL or in `ps` output.
3. Install, build and launch the app via `docker exec` against that in-container
   checkout.
4. Destroy the container (`--rm` + explicit stop). Nothing about the target repo
   persists between runs.

Static analysis that needs a real filesystem (route discovery, build detection)
uses a short-lived `docker cp | tar` extraction that is deleted before the
calling function returns — see ``container_extract``.
"""

from __future__ import annotations

import logging
import os
import re
import socket
import subprocess
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx

from agent.projects.build_detection import detect_project_config, resolve_build_root
from agent.sandbox.container_extract import extract_container_path

logger = logging.getLogger("agent.sandbox.docker_sandbox")

DEFAULT_MEMORY_LIMIT = "1g"
DEFAULT_CPU_LIMIT = "1.0"
DEFAULT_PIDS_LIMIT = "256"

# Name of the shared toolchain image (see sandbox/Dockerfile.toolchain).
TOOLCHAIN_IMAGE = "pr-testing-toolchain:latest"
_TOOLCHAIN_DOCKERFILE = Path(__file__).resolve().parents[3] / "sandbox" / "Dockerfile.toolchain"

# Ports published at boot. The app's real listen port is only known *after*
# in-container framework detection, so instead of forcing every framework onto
# one port we publish a small fixed set of common dev/preview ports and route
# base_url at whichever one the app actually listened on.
CANDIDATE_CONTAINER_PORTS: tuple[int, ...] = (3000, 4173, 4321, 8000)

# A container idles on this command until we exec real work into it, and exits
# promptly once stopped/killed during teardown.
_IDLE_CMD = ["tail", "-f", "/dev/null"]

# Attacker-influenced values (PR branch names, SHAs, repo names) are interpolated
# into a shell script, so each must be validated to be unable to break out.
_SAFE_REPO_COMPONENT = re.compile(r"^[A-Za-z0-9._-]+$")
_SAFE_GIT_REF = re.compile(r"^[A-Za-z0-9._/@+-]+$")
_SAFE_SHA = re.compile(r"^[A-Za-z0-9._-]+$")


class SandboxBootError(RuntimeError):
    """Raised when a sandbox container fails to build, start, or become ready.

    ``step`` records which phase failed so the caller can report a build
    failure, a dependency-install failure and an app that will not start as
    distinct results instead of one opaque string. One of:
    ``clone``, ``dependency_install``, ``build``, ``app_start``, ``provision``.

    ``log`` carries the full captured command output (bounded by the caller)
    so the dashboard can show build logs instead of only the truncated message.
    """

    def __init__(self, message: str, step: str = "provision", log: str = "") -> None:
        super().__init__(message)
        self.step = step
        self.log = log or message


class CloneError(RuntimeError):
    """Raised when the in-container clone of the target repo fails."""

    def __init__(self, message: str, log: str = "") -> None:
        super().__init__(message)
        self.log = log or message


@dataclass
class SandboxHandle:
    container_name: str
    port: int
    base_url: str


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    defaults: dict = {"capture_output": True, "text": True}
    defaults.update(kwargs)
    return subprocess.run(cmd, **defaults)


def _scrub_token(text: str, token: str | None) -> str:
    """Replace a secret token with a placeholder if it appears in ``text``."""
    if not token:
        return text
    return text.replace(token, "***")


def _exec(container: str, shell_cmd: str, cwd: str = "/app", timeout: int = 600) -> subprocess.CompletedProcess:
    # HOME is set explicitly: the toolchain image runs as root with no passwd
    # entry, so git would otherwise warn about an unset $HOME on every command.
    return _run(
        ["docker", "exec", "-e", "HOME=/tmp", "-w", cwd, container, "sh", "-c", shell_cmd],
        timeout=timeout,
    )


def _raise_on_failure(step: str, result: subprocess.CompletedProcess, image_tag: str) -> None:
    if result.returncode != 0:
        output = (result.stdout or "") + (result.stderr or "")
        # Normalize the human label into a machine-readable phase.
        step_key = {
            "dependency install": "dependency_install",
            "build": "build",
        }.get(step, step)
        raise SandboxBootError(
            f"{step} failed for {image_tag}: {output[-4000:]}",
            step=step_key,
            log=output,
        )


def _validate_repo_inputs(owner: str, repo: str, sha: str, base_ref: str) -> None:
    """Reject inputs that could break out of the generated clone shell script.

    ``owner``/``repo``/``sha``/``base_ref`` all originate from webhook payloads
    and PR metadata, i.e. from the party whose code we are about to run. They are
    formatted into a shell script executed inside the container, so anything that
    is not a conservative safe charset is rejected outright rather than escaped.
    """
    for label, value, pattern in (
        ("owner", owner, _SAFE_REPO_COMPONENT),
        ("repo", repo, _SAFE_REPO_COMPONENT),
        ("sha", sha, _SAFE_SHA),
        ("base_ref", base_ref, _SAFE_GIT_REF),
    ):
        if not value or not pattern.match(value):
            raise SandboxBootError(
                f"Refusing to build sandbox: unsafe {label} {value!r} "
                f"(must match {pattern.pattern})"
            )


def ensure_toolchain_image() -> str:
    """Build the shared toolchain image once, if it isn't already present."""
    inspect = _run(["docker", "image", "inspect", TOOLCHAIN_IMAGE], timeout=20)
    if inspect.returncode == 0:
        return TOOLCHAIN_IMAGE

    if not _TOOLCHAIN_DOCKERFILE.is_file():
        raise SandboxBootError(
            f"Toolchain image {TOOLCHAIN_IMAGE} is absent and its Dockerfile was not "
            f"found at {_TOOLCHAIN_DOCKERFILE}"
        )

    logger.info("Building shared sandbox toolchain image %s (first run only)...", TOOLCHAIN_IMAGE)
    built = _run(
        ["docker", "build", "-t", TOOLCHAIN_IMAGE, "-f", str(_TOOLCHAIN_DOCKERFILE), str(_TOOLCHAIN_DOCKERFILE.parent)],
        timeout=1800,
    )
    if built.returncode != 0:
        raise SandboxBootError(
            f"Failed to build toolchain image {TOOLCHAIN_IMAGE}: {(built.stderr or '')[-2000:]}"
        )
    return TOOLCHAIN_IMAGE


def _allocate_host_ports(count: int) -> list[int]:
    """Reserve ``count`` currently-free local TCP ports.

    There is an inherent bind-then-release race between probing and Docker
    binding the port. It is small in practice and reported as a clear
    SandboxBootError by `docker run` if lost, rather than silently mis-mapping.
    """
    ports: list[int] = []
    sockets = []
    try:
        for _ in range(count):
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("127.0.0.1", 0))
            ports.append(s.getsockname()[1])
            sockets.append(s)
    finally:
        for s in sockets:
            s.close()
    return ports


def clone_repo_into_container(
    container: str,
    owner: str,
    repo: str,
    sha: str,
    base_ref: str,
    github_token: str | None,
    dest: str = "/app",
    timeout: int = 300,
) -> None:
    """Clone ``owner/repo`` at ``sha`` into ``dest`` inside ``container``.

    Token handling: the token is already present in the container environment
    (injected once at `docker run`). It is never re-passed on a `docker exec`
    command line, so it appears in exactly one `docker run` argv and never in a
    per-exec argv, shell history, or the clone URL.

    A literal ``https://x-access-token:$TOKEN@github.com/...`` clone URL would be
    visible in ``ps aux`` once the shell expands it into the git process argv —
    env-var interpolation hides it from logs and shell history but not from `ps`.
    ``GIT_ASKPASS`` avoids that entirely: git invokes a tiny helper that echoes
    ``$GITHUB_TOKEN`` from its own environment, so the URL stays tokenless.
    """
    _validate_repo_inputs(owner, repo, sha, base_ref)

    tokenless_url = f"https://github.com/{owner}/{repo}.git"

    # `base_ref` is fetched into a remote-tracking ref so that
    # `git diff <base_ref>...HEAD` works later: a single-ref blobless clone has
    # no base_ref present to diff against.
    script = f"""
set -e
# Stay in / (which exists) until the destination is (re)created: `cd`ing into a
# directory and then deleting it leaves git running with an unreadable CWD.
rm -rf {_sh_quote(dest)}
mkdir -p {_sh_quote(dest)}
cat > /tmp/askpass.sh <<'ASKPASS_EOF'
#!/bin/sh
printf '%s' "$GITHUB_TOKEN"
ASKPASS_EOF
chmod 700 /tmp/askpass.sh
GIT_ASKPASS=/tmp/askpass.sh \
GIT_TERMINAL_PROMPT=0 \
git -c credential.https://github.com.username=x-access-token \
    clone --quiet --no-tags {tokenless_url} {_sh_quote(dest)}
cd {_sh_quote(dest)}
GIT_ASKPASS=/tmp/askpass.sh GIT_TERMINAL_PROMPT=0 \
    git fetch --quiet origin {_sh_quote(base_ref)}:refs/remotes/origin/{_sh_quote(base_ref)} || true
git checkout --quiet --detach {_sh_quote(sha)}
# Drop the credential path entirely before any untrusted build script runs.
git remote remove origin || true
rm -f /tmp/askpass.sh
unset GITHUB_TOKEN
"""

    result = _exec(container, script, cwd="/", timeout=timeout)
    if result.returncode != 0:
        err = (result.stdout or "") + (result.stderr or "")
        if github_token:
            # Never echo the token back, even on failure.
            err = err.replace(github_token, "***")
        raise CloneError(
            f"Failed to clone {owner}/{repo}@{sha[:12]} into container {container}: {err[-4000:]}",
            log=err,
        )
    logger.info("Cloned %s/%s@%s into container %s", owner, repo, sha[:12], container)


def _sh_quote(value: str) -> str:
    """Single-quote a shell argument safely."""
    return "'" + value.replace("'", "'\\''") + "'"


def _resolve_build_root_in_container(container: str) -> tuple[str, str]:
    """Detect the app root + project config, returning (in_container_build_dir, framework).

    Uses a short-lived host extraction purely to *decide commands* — nothing is
    ever installed, built or executed against the extracted copy.
    """
    with extract_container_path(container, "/app") as local_app:
        local_build_root = resolve_build_root(local_app)
        config = detect_project_config(local_build_root)
        try:
            rel = local_build_root.relative_to(local_app)
        except ValueError:
            rel = Path(".")
    in_container_build_dir = "/app" if str(rel) in (".", "") else f"/app/{rel.as_posix()}"
    return in_container_build_dir, config


def _provision(container: str, image_tag: str) -> tuple[str, int]:
    """Detect the project in-container, install deps, build. Returns (start_command, port)."""
    build_dir, config = _resolve_build_root_in_container(container)
    if build_dir != "/app":
        logger.info("Monorepo detected: using '%s' as app root (repo root: '/app')", build_dir)

    if config.framework == "python":
        install_cmd = _python_install_command(container, build_dir)
        if install_cmd is None:
            logger.info(
                "No Python dependency manifest found at %s; skipping install.", build_dir
            )
        else:
            install_result = _exec(container, install_cmd, cwd=build_dir)
            _raise_on_failure("dependency install", install_result, image_tag)
        return config.start_command, config.port

    if not _container_file_exists(container, f"{build_dir}/package.json"):
        # Mirrors the Python branch above: no manifest means there is nothing to
        # install. Running `npm install` anyway produces a confusing ENOENT dump
        # instead of a clear "this is not a Node project" signal.
        raise SandboxBootError(
            f"No package.json found at {build_dir} in container {container} "
            f"(image_tag={image_tag}); cannot provision a Node project.",
            step="provision",
        )

    if config.package_manager != "npm":
        _exec(container, f"npm install -g {config.package_manager} >/dev/null 2>&1 || true", cwd=build_dir)

    # NODE_ENV is deliberately left unset for install and build: setting it to
    # "production" before install would skip devDependencies, which commonly hold
    # build-time tooling (bundler plugins, type packages) the build step needs.
    install_result = _exec(container, f"{config.package_manager} install", cwd=build_dir)
    _raise_on_failure("dependency install", install_result, image_tag)

    if config.build_command and "no build script" not in config.build_command:
        # Failures are deliberately not suppressed: if the PR's code does not
        # build, the run must fail rather than silently exercise stale output.
        build_result = _exec(container, config.build_command, cwd=build_dir)
        _raise_on_failure("build", build_result, image_tag)

    return config.start_command, config.port


def _container_file_exists(container: str, path: str) -> bool:
    return _exec(container, f"test -f {_sh_quote(path)}", cwd="/", timeout=30).returncode == 0


def _python_install_command(container: str, build_dir: str) -> str | None:
    """Pick the right Python dependency install command for the project's manifest.

    Only `requirements.txt` used to be handled, so any project using modern
    packaging (pyproject.toml / poetry / Pipfile / setup.py) silently skipped
    installation and then failed at launch with a missing entrypoint (e.g.
    `uvicorn: not found`). Each branch installs the project itself too, so console
    scripts declared as entry points actually land on PATH.

    Returns None when no recognised manifest exists — nothing to install.
    """
    def _exists(name: str) -> bool:
        return _container_file_exists(container, f"{build_dir}/{name}")

    if _exists("poetry.lock"):
        return (
            "pip install --no-cache-dir poetry >/dev/null 2>&1 && "
            "poetry config virtualenvs.create false && "
            "poetry install --no-interaction --no-ansi"
        )
    if _exists("Pipfile"):
        return (
            "pip install --no-cache-dir pipenv >/dev/null 2>&1 && "
            "pipenv install --dev --deploy --system"
        )
    if _exists("pyproject.toml"):
        # Covers PEP 517/518 projects (hatchling, setuptools, flit, PDM, uv).
        # Extras are opted into via PYTHON_INSTALL_EXTRAS if a project needs them.
        extras = os.environ.get("PYTHON_INSTALL_EXTRAS", "").strip()
        spec = f".[{extras}]" if extras else "."
        return (
            "pip install --no-cache-dir --upgrade pip setuptools wheel >/dev/null 2>&1; "
            f"pip install --no-cache-dir -e {_sh_quote(spec)}"
        )
    if _exists("requirements.txt"):
        # Install the project itself as well when it is a package, so entry-point
        # console scripts resolve. Tolerated to fail: some repos are apps, not
        # packages, and `pip install -e .` is meaningless for them.
        return (
            "pip install --no-cache-dir -r requirements.txt && "
            f"(cd {_sh_quote(build_dir)} && pip install --no-cache-dir -e . >/dev/null 2>&1 || true)"
        )
    if _exists("setup.py"):
        return f"pip install --no-cache-dir -e {_sh_quote(build_dir)}"
    return None


def _wait_until_ready(base_url: str, timeout_s: float = 60.0) -> None:
    deadline = time.monotonic() + timeout_s
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            resp = httpx.get(base_url, timeout=2.0)
            if resp.status_code < 500:
                return
        except httpx.HTTPError as exc:
            last_error = exc
        time.sleep(0.5)
    raise SandboxBootError(
        f"Sandbox at {base_url} did not become ready within {timeout_s}s", step="app_start"
    ) from last_error


def start_sandbox(
    owner: str,
    repo: str,
    sha: str,
    base_ref: str,
    image_tag: str,
    github_token: str | None = None,
    env: dict[str, str] | None = None,
    memory_limit: str = DEFAULT_MEMORY_LIMIT,
    cpu_limit: str = DEFAULT_CPU_LIMIT,
    ready_timeout_s: float = 120.0,
    container_ports: tuple[int, ...] = CANDIDATE_CONTAINER_PORTS,
) -> SandboxHandle:
    """Boot a hardened container with no source in it, clone the PR in-container,
    provision it, launch the app, and return a running SandboxHandle.

    On any failure the container is destroyed before the exception propagates, so
    a failed boot never leaves the cloned source behind.
    """
    _validate_repo_inputs(owner, repo, sha, base_ref)

    base_image = ensure_toolchain_image()
    name = f"pr-testing-sandbox-{uuid.uuid4().hex[:8]}"
    host_ports = _allocate_host_ports(len(container_ports))

    run_cmd = [
        "docker", "run", "-d", "--rm", "--name", name,
        "--memory", memory_limit,
        "--cpus", cpu_limit,
        "--pids-limit", DEFAULT_PIDS_LIMIT,
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        "--cap-add", "DAC_OVERRIDE",
        "-w", "/app",
    ]
    # Publish every candidate port so the app is reachable regardless of which
    # one framework detection eventually picks.
    for host_port, container_port in zip(host_ports, container_ports):
        run_cmd += ["-p", f"{host_port}:{container_port}"]
    # The token is injected exactly once, here. Later `docker exec` calls never
    # carry it, so it appears in a single argv line and in no exec argv at all.
    if github_token:
        run_cmd += ["-e", f"GITHUB_TOKEN={github_token}"]
    for key, value in (env or {}).items():
        run_cmd += ["-e", f"{key}={value}"]
    run_cmd += [base_image, *_IDLE_CMD]

    started = _run(run_cmd, timeout=60)
    if started.returncode != 0:
        raise SandboxBootError(
            f"docker run failed for {image_tag}: {(started.stderr or '').strip()}",
            step="provision",
        )

    try:
        clone_repo_into_container(
            container=name,
            owner=owner,
            repo=repo,
            sha=sha,
            base_ref=base_ref,
            github_token=github_token,
        )

        start_command, detected_port = _provision(name, image_tag)

        if detected_port not in container_ports:
            raise SandboxBootError(
                f"Detected app port {detected_port} is not among the published ports "
                f"{container_ports}; the sandbox cannot expose it.",
                step="provision",
            )
        host_port = host_ports[container_ports.index(detected_port)]
        base_url = f"http://localhost:{host_port}"

        launch_result = _exec(
            name,
            f"nohup sh -c '{start_command}' > /tmp/app.log 2>&1 & echo $! > /tmp/app.pid",
        )
        if launch_result.returncode != 0:
            launch_output = (launch_result.stdout or "") + (launch_result.stderr or "")
            raise SandboxBootError(
                f"failed to launch app process for {image_tag}: {(launch_result.stderr or '')[-4000:]}",
                step="app_start",
                log=launch_output,
            )

        try:
            _wait_until_ready(base_url, timeout_s=ready_timeout_s)
        except SandboxBootError:
            log_tail = _exec(name, "cat /tmp/app.log 2>/dev/null | tail -c 20000")
            app_log = log_tail.stdout or ""
            raise SandboxBootError(
                f"Sandbox app failed to become ready for {image_tag}. App log tail:\n{app_log[-4000:]}",
                step="app_start",
                log=app_log,
            ) from None

        return SandboxHandle(container_name=name, port=host_port, base_url=base_url)
    except Exception:
        stop_sandbox(name)
        raise


def stop_sandbox(container_name: str) -> None:
    """Stops and tears down a sandbox container, destroying the in-container clone."""
    stop = _run(["docker", "stop", container_name], timeout=30)
    if stop.returncode != 0:
        logger.warning("Failed to stop sandbox container %s cleanly: %s", container_name, (stop.stderr or "").strip())


@contextmanager
def run_sandbox(
    owner: str,
    repo: str,
    sha: str,
    base_ref: str,
    image_tag: str,
    github_token: str | None = None,
    env: dict[str, str] | None = None,
    memory_limit: str = DEFAULT_MEMORY_LIMIT,
    cpu_limit: str = DEFAULT_CPU_LIMIT,
    ready_timeout_s: float = 120.0,
):
    """Context manager form of :func:`start_sandbox`; always tears the container down."""
    handle = start_sandbox(
        owner=owner,
        repo=repo,
        sha=sha,
        base_ref=base_ref,
        image_tag=image_tag,
        github_token=github_token,
        env=env,
        memory_limit=memory_limit,
        cpu_limit=cpu_limit,
        ready_timeout_s=ready_timeout_s,
    )
    try:
        yield handle
    finally:
        stop_sandbox(handle.container_name)


def build_image(project_dir: Path, image_tag: str) -> None:
    """Deprecated no-op: sandboxes no longer build a per-run image, and no longer
    take a host project directory at all. Retained only for import compatibility."""
    return None


def remove_image(image_tag: str) -> None:
    """Deprecated no-op retained for backward compatibility: per-run images are no
    longer built. Containers run with --rm and are removed by `stop_sandbox`."""
    return None
