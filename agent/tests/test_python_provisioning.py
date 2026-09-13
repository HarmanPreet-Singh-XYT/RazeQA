"""Python dependency installation in the sandbox.

Regression coverage for a real failure: only `requirements.txt` was handled, so a
project using `pyproject.toml` (or poetry / Pipfile / setup.py) silently skipped
dependency installation and then died at launch with a missing entrypoint, e.g.

    Sandbox app failed to become ready. App log tail:
    sh: 1: uvicorn: not found

Reproduced against a real public Python repo. These tests require Docker.
"""

from __future__ import annotations

import subprocess
import uuid

import pytest

from agent.sandbox.docker_sandbox import (
    _exec,
    _python_install_command,
    ensure_toolchain_image,
    stop_sandbox,
)


def _docker_available() -> bool:
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=15).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


pytestmark = pytest.mark.skipif(
    not _docker_available(), reason="requires a running Docker daemon"
)


@pytest.fixture
def container():
    name = f"pyinstall-{uuid.uuid4().hex[:8]}"
    image = ensure_toolchain_image()
    res = subprocess.run(
        ["docker", "run", "-d", "--rm", "--name", name, "--cap-add", "DAC_OVERRIDE",
         image, "tail", "-f", "/dev/null"],
        capture_output=True, text=True, timeout=120,
    )
    assert res.returncode == 0, res.stderr
    try:
        yield name
    finally:
        stop_sandbox(name)


def _write(container: str, path: str, content: str) -> None:
    _exec(container, f"mkdir -p $(dirname {path}) && cat > {path} <<'EOD'\n{content}\nEOD", cwd="/")


def test_pyproject_project_installs_and_entrypoint_is_runnable(container: str) -> None:
    """A PEP 517 project must have its deps installed AND its console script on PATH."""
    _exec(container, "rm -rf /app && mkdir -p /app", cwd="/")
    _write(container, "/app/pyproject.toml", """[project]
name = "demoapp"
version = "0.1.0"
dependencies = ["click==8.1.7"]

[project.scripts]
demo-cli = "demoapp:main"

[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"
""")
    _write(container, "/app/demoapp/__init__.py", """import click

@click.command()
def main():
    click.echo("DEMO-CLI-OK")
""")

    cmd = _python_install_command(container, "/app")
    assert cmd is not None, "pyproject.toml must produce an install command"

    install = _exec(container, cmd, cwd="/app", timeout=600)
    assert install.returncode == 0, ((install.stdout or "") + (install.stderr or ""))[-1500:]

    # The whole point: the declared entry point is now an executable on PATH, which
    # is exactly what failed before (`uvicorn: not found`).
    run = _exec(container, "demo-cli", cwd="/app")
    assert run.returncode == 0, (run.stderr or "")[-500:]
    assert "DEMO-CLI-OK" in (run.stdout or "")


def test_requirements_project_still_installs(container: str) -> None:
    """The original supported manifest must keep working."""
    _exec(container, "rm -rf /app && mkdir -p /app", cwd="/")
    _write(container, "/app/requirements.txt", "click==8.1.7\n")

    cmd = _python_install_command(container, "/app")
    assert cmd is not None
    install = _exec(container, cmd, cwd="/app", timeout=600)
    assert install.returncode == 0, ((install.stdout or "") + (install.stderr or ""))[-1500:]

    check = _exec(container, "python3 -c 'import click; print(click.__version__)'", cwd="/app")
    assert check.returncode == 0
    assert "8.1.7" in (check.stdout or "")


@pytest.mark.parametrize(
    "manifest,expected_fragment",
    [
        ("pyproject.toml", "pip install"),
        ("requirements.txt", "-r requirements.txt"),
        ("setup.py", "-e"),
    ],
)
def test_manifest_selects_expected_strategy(
    container: str, manifest: str, expected_fragment: str
) -> None:
    _exec(container, "rm -rf /app && mkdir -p /app", cwd="/")
    _write(container, f"/app/{manifest}", "# placeholder\n")

    cmd = _python_install_command(container, "/app")
    assert cmd is not None, f"{manifest} must be recognised"
    assert expected_fragment in cmd


def test_no_manifest_means_no_install_command(container: str) -> None:
    """Nothing to install must return None, not a bogus pip invocation."""
    _exec(container, "rm -rf /app && mkdir -p /app", cwd="/")
    assert _python_install_command(container, "/app") is None
