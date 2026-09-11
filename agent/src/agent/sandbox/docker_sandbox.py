"""Docker sandbox spin-up (idea.md Section 3.2 step 2): checkout, install, boot,
inject test credentials as env vars. v1 shells out to the `docker` CLI directly
rather than pulling in the docker SDK.

Containers running the checked-out (untrusted) PR branch are constrained:
memory/CPU caps, no inbound network beyond the one published port, and a
non-root user inside the container (the app image itself must not run as
root — see web/Dockerfile, which already does this correctly).
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

logger = logging.getLogger("agent.sandbox.docker_sandbox")

DEFAULT_MEMORY_LIMIT = "1g"
DEFAULT_CPU_LIMIT = "1.0"
DEFAULT_PIDS_LIMIT = "256"


class SandboxBootError(RuntimeError):
    """Raised when a sandbox container fails to build, start, or become ready."""


@dataclass
class SandboxHandle:
    container_name: str
    port: int
    base_url: str


def build_image(project_dir: Path, image_tag: str) -> None:
    result = subprocess.run(
        ["docker", "build", "-t", image_tag, "."],
        cwd=project_dir,
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise SandboxBootError(f"docker build failed for {image_tag}: {result.stderr[-4000:]}")


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
    image_tag: str,
    env: dict[str, str] | None = None,
    container_port: int = 3000,
    host_port: int | None = None,
    memory_limit: str = DEFAULT_MEMORY_LIMIT,
    cpu_limit: str = DEFAULT_CPU_LIMIT,
    ready_timeout_s: float = 60.0,
):
    """Boots a resource-constrained, isolated container from `image_tag`, waits
    for it to answer HTTP, yields a SandboxHandle, then always tears the
    container down on exit (even if the caller raises)."""
    port = host_port or (10000 + (uuid.uuid4().int % 10000))
    name = f"pr-testing-sandbox-{uuid.uuid4().hex[:8]}"

    cmd = [
        "docker", "run", "-d", "--rm", "--name", name,
        "-p", f"{port}:{container_port}",
        "--memory", memory_limit,
        "--cpus", cpu_limit,
        "--pids-limit", DEFAULT_PIDS_LIMIT,
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
    ]
    for key, value in (env or {}).items():
        cmd += ["-e", f"{key}={value}"]
    cmd.append(image_tag)

    started = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if started.returncode != 0:
        raise SandboxBootError(f"docker run failed for {image_tag}: {started.stderr.strip()}")

    base_url = f"http://localhost:{port}"
    try:
        _wait_until_ready(base_url, timeout_s=ready_timeout_s)
        yield SandboxHandle(container_name=name, port=port, base_url=base_url)
    finally:
        stop = subprocess.run(["docker", "stop", name], capture_output=True, text=True, timeout=30)
        if stop.returncode != 0:
            logger.warning("Failed to stop sandbox container %s cleanly: %s", name, stop.stderr.strip())


def remove_image(image_tag: str) -> None:
    """Removes a Docker image built for a run, ensuring source code is never retained on host."""
    try:
        res = subprocess.run(["docker", "rmi", "-f", image_tag], capture_output=True, text=True, timeout=30)
        if res.returncode == 0:
            logger.info("Successfully cleaned up Docker image: %s", image_tag)
        else:
            logger.debug("docker rmi exited non-zero for %s: %s", image_tag, res.stderr.strip())
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to remove Docker image %s: %s", image_tag, exc)

