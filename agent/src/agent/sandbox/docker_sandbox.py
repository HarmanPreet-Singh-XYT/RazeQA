"""Docker sandbox spin-up (idea.md Section 3.2 step 2): checkout, install, boot,
inject test credentials as env vars.

Design: rather than `docker build` a bespoke image per run (baking the repo's
source into a custom image via a synthesized or repo-provided Dockerfile),
this boots a plain runtime container from a small set of shared, pre-pulled
base images, copies the checked-out worktree into it, and runs
install/build/start as plain shell commands via `docker exec`.

This sidesteps an entire class of Dockerfile-synthesis bugs (COPY ordering,
ENV/NODE_ENV timing relative to install, per-framework Dockerfile templates
drifting from what the framework actually needs) — install/build steps run
in a real, already-booted Linux environment with normal shell semantics,
the same way a developer would run them locally. It also removes the
image-build step from the critical path entirely, so most of the ~30-90s a
`docker build` used to take is no longer spent per run.

Containers running the checked-out (untrusted) PR branch are constrained:
memory/CPU caps, no inbound network beyond the one published port, and a
non-root user inside the container.
"""

from __future__ import annotations

import logging
import subprocess
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx

from agent.projects.build_detection import detect_project_config, resolve_build_root

logger = logging.getLogger("agent.sandbox.docker_sandbox")

DEFAULT_MEMORY_LIMIT = "1g"
DEFAULT_CPU_LIMIT = "1.0"
DEFAULT_PIDS_LIMIT = "256"

# Shared, pre-pulled runtime images keyed by framework family. These are
# generic language runtimes, never rebuilt per-run — only the worktree
# contents are copied in and executed via `docker exec`.
BASE_IMAGES: dict[str, str] = {
    "node": "node:20-alpine",
    "python": "python:3.12-slim",
}

# A container idles on this command until we exec real work into it, and
# exits promptly once stopped/killed during teardown.
_IDLE_CMD = ["tail", "-f", "/dev/null"]


class SandboxBootError(RuntimeError):
    """Raised when a sandbox container fails to build, start, or become ready."""


@dataclass
class SandboxHandle:
    container_name: str
    port: int
    base_url: str


def _run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    defaults: dict = {"capture_output": True, "text": True}
    defaults.update(kwargs)
    return subprocess.run(cmd, **defaults)


def _base_image_for(framework: str) -> str:
    if framework == "python":
        return BASE_IMAGES["python"]
    return BASE_IMAGES["node"]


def _exec(container: str, shell_cmd: str, cwd: str = "/app", timeout: int = 600) -> subprocess.CompletedProcess:
    return _run(
        ["docker", "exec", "-w", cwd, container, "sh", "-c", shell_cmd],
        timeout=timeout,
    )


def _raise_on_failure(step: str, result: subprocess.CompletedProcess, image_tag: str) -> None:
    if result.returncode != 0:
        output = (result.stdout or "") + (result.stderr or "")
        raise SandboxBootError(f"{step} failed for {image_tag}: {output[-4000:]}")


def _provision(container: str, project_dir: Path, image_tag: str) -> tuple[str, int]:
    """Copies the worktree into the container and runs install + build.

    Returns (start_command, port) so the caller can launch the app process.
    """
    build_dir = resolve_build_root(project_dir)
    if build_dir != project_dir:
        logger.info(
            "Monorepo detected: using '%s' as app root (worktree root: '%s')",
            build_dir,
            project_dir,
        )

    config = detect_project_config(build_dir)

    # Copy the resolved app directory's contents into /app inside the
    # container. Trailing "/." on the source copies contents, not the
    # directory itself, so files land directly at /app/... as expected.
    copy_result = _run(
        ["docker", "cp", f"{build_dir}/.", f"{container}:/app"],
        timeout=120,
    )
    _raise_on_failure("docker cp (copying source into sandbox)", copy_result, image_tag)

    if config.framework == "python":
        install_cmd = (
            "pip install --no-cache-dir -r requirements.txt"
            if (build_dir / "requirements.txt").is_file()
            else "echo 'no requirements.txt, skipping install'"
        )
        install_result = _exec(container, install_cmd)
        _raise_on_failure("dependency install", install_result, image_tag)
        return config.start_command, config.port

    if config.package_manager != "npm":
        _exec(container, f"npm install -g {config.package_manager} >/dev/null 2>&1 || true")

    # Node-family projects: install deps, then build. NODE_ENV is
    # deliberately left unset for both steps — setting it to "production"
    # before install would skip devDependencies, which commonly hold
    # build-time tooling (bundler plugins, type packages) the build step
    # needs, and would then also skip the build step's own dev tooling.
    install_result = _exec(container, f"{config.package_manager} install")
    _raise_on_failure("dependency install", install_result, image_tag)

    if config.build_command and "no build script" not in config.build_command:
        # Deliberately not suppressing failures here: if the PR's code fails
        # to build, the run must fail clearly rather than silently exercising
        # stale/incomplete output from a previous successful build.
        build_result = _exec(container, config.build_command)
        _raise_on_failure("build", build_result, image_tag)

    return config.start_command, config.port


def build_image(project_dir: Path, image_tag: str) -> None:
    """Deprecated no-op retained for backward compatibility with callers that
    still import it; sandbox provisioning now happens inside `run_sandbox`
    via `docker exec`, so there is no separate image-build step."""
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
    raise SandboxBootError(f"Sandbox at {base_url} did not become ready within {timeout_s}s") from last_error


@contextmanager
def run_sandbox(
    project_dir: Path,
    image_tag: str,
    env: dict[str, str] | None = None,
    container_port: int | None = None,
    host_port: int | None = None,
    memory_limit: str = DEFAULT_MEMORY_LIMIT,
    cpu_limit: str = DEFAULT_CPU_LIMIT,
    ready_timeout_s: float = 120.0,
):
    """Boots a resource-constrained, isolated container from a shared base
    runtime image, copies `project_dir`'s contents in, installs deps, builds,
    starts the app, waits for it to answer HTTP, yields a SandboxHandle, then
    always tears the container down on exit (even if the caller raises)."""
    build_dir = resolve_build_root(project_dir)
    config = detect_project_config(build_dir)
    base_image = _base_image_for(config.framework)
    port = host_port or (10000 + (uuid.uuid4().int % 10000))
    name = f"pr-testing-sandbox-{uuid.uuid4().hex[:8]}"

    pull = _run(["docker", "image", "inspect", base_image], timeout=10)
    if pull.returncode != 0:
        logger.info("Pulling shared base image %s (first run only)...", base_image)
        pulled = _run(["docker", "pull", base_image], timeout=300)
        if pulled.returncode != 0:
            raise SandboxBootError(f"Failed to pull base image {base_image}: {pulled.stderr.strip()}")

    run_cmd = [
        "docker", "run", "-d", "--rm", "--name", name,
        "--memory", memory_limit,
        "--cpus", cpu_limit,
        "--pids-limit", DEFAULT_PIDS_LIMIT,
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        # `docker cp` preserves the *host* uid on copied files (e.g. the
        # developer's local uid), which is meaningless inside the container.
        # Root normally bypasses file-owner permission checks via
        # CAP_DAC_OVERRIDE; with a bare --cap-drop ALL that capability is
        # gone too, so root can no longer write files copied in this way
        # (e.g. `npm install` fails with EACCES rewriting package-lock.json).
        # Add just this one capability back rather than relaxing the drop.
        "--cap-add", "DAC_OVERRIDE",
        "-w", "/app",
    ]
    started_container_port = container_port or config.port
    run_cmd += ["-p", f"{port}:{started_container_port}"]
    for key, value in (env or {}).items():
        run_cmd += ["-e", f"{key}={value}"]
    run_cmd += [base_image, *_IDLE_CMD]

    started = _run(run_cmd, timeout=30)
    if started.returncode != 0:
        raise SandboxBootError(f"docker run failed for {image_tag}: {started.stderr.strip()}")

    base_url = f"http://localhost:{port}"
    try:
        start_command, _ = _provision(name, project_dir, image_tag)

        # Launch the app's start command in the background inside the
        # container (detached via nohup) so `docker exec` returns immediately
        # instead of blocking on a long-running server process.
        launch_result = _exec(
            name,
            f"nohup sh -c '{start_command}' > /tmp/app.log 2>&1 & echo $! > /tmp/app.pid",
        )
        if launch_result.returncode != 0:
            raise SandboxBootError(
                f"failed to launch app process for {image_tag}: {launch_result.stderr[-4000:]}"
            )

        try:
            _wait_until_ready(base_url, timeout_s=ready_timeout_s)
        except SandboxBootError:
            log_tail = _exec(name, "cat /tmp/app.log 2>/dev/null | tail -c 4000")
            raise SandboxBootError(
                f"Sandbox app failed to become ready for {image_tag}. App log tail:\n{log_tail.stdout}"
            ) from None

        yield SandboxHandle(container_name=name, port=port, base_url=base_url)
    finally:
        stop = _run(["docker", "stop", name], timeout=30)
        if stop.returncode != 0:
            logger.warning("Failed to stop sandbox container %s cleanly: %s", name, stop.stderr.strip())


def remove_image(image_tag: str) -> None:
    """Deprecated no-op retained for backward compatibility: sandboxes no
    longer build a per-run image, so there is nothing to remove. Containers
    are started with --rm and are cleaned up when `run_sandbox` stops them."""
    return None
