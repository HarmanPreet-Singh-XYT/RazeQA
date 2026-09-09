"""Docker sandbox spin-up (idea.md Section 3.2 step 2): checkout, install, boot,
inject test credentials as env vars. v1 shells out to the `docker` CLI directly
rather than pulling in the docker SDK.
"""

from __future__ import annotations

import subprocess
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass
class SandboxHandle:
    container_name: str
    port: int
    base_url: str


def build_image(project_dir: Path, image_tag: str) -> None:
    subprocess.run(
        ["docker", "build", "-t", image_tag, "."],
        cwd=project_dir,
        check=True,
    )


def _wait_until_ready(base_url: str, timeout_s: float = 30.0) -> None:
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
    raise TimeoutError(f"Sandbox at {base_url} did not become ready in time") from last_error


@contextmanager
def run_sandbox(
    image_tag: str,
    env: dict[str, str] | None = None,
    container_port: int = 3000,
    host_port: int | None = None,
):
    """Boots a container from `image_tag`, waits for it to answer HTTP, yields a
    SandboxHandle, then always tears the container down on exit."""
    port = host_port or (10000 + (uuid.uuid4().int % 10000))
    name = f"pr-testing-sandbox-{uuid.uuid4().hex[:8]}"

    cmd = ["docker", "run", "-d", "--rm", "--name", name, "-p", f"{port}:{container_port}"]
    for key, value in (env or {}).items():
        cmd += ["-e", f"{key}={value}"]
    cmd.append(image_tag)

    subprocess.run(cmd, check=True, capture_output=True)
    base_url = f"http://localhost:{port}"
    try:
        _wait_until_ready(base_url)
        yield SandboxHandle(container_name=name, port=port, base_url=base_url)
    finally:
        subprocess.run(["docker", "stop", name], check=False, capture_output=True)
