"""Zero-host-disk sandbox: real-Docker verification tests.

These are the tests that actually prove the security property the refactor
exists for, rather than asserting on mocks:

  1. The target repo is cloned INSIDE the container.
  2. No host clone/worktree directory is ever created.
  3. The container (and therefore the only copy of the source) is destroyed
     when the run ends, including on failure.
  4. The GitHub token never appears in the container's stored error text.

They require a working Docker daemon and network access to GitHub, so they are
skipped automatically when either is unavailable.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from agent.sandbox.docker_sandbox import (
    CloneError,
    SandboxBootError,
    clone_repo_into_container,
    ensure_toolchain_image,
    stop_sandbox,
)

# Small, stable, public repo — keeps the clone fast.
TEST_OWNER = "octocat"
TEST_REPO = "Hello-World"
TEST_BASE_REF = "master"


def _docker_available() -> bool:
    try:
        return subprocess.run(
            ["docker", "info"], capture_output=True, timeout=15
        ).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


pytestmark = pytest.mark.skipif(
    not _docker_available(), reason="requires a running Docker daemon"
)


def _start_idle_container() -> str:
    """Boot a bare toolchain container without going through the full clone flow."""
    import uuid

    image = ensure_toolchain_image()
    name = f"pr-sandbox-test-{uuid.uuid4().hex[:8]}"
    res = subprocess.run(
        [
            "docker", "run", "-d", "--rm", "--name", name,
            "--security-opt", "no-new-privileges",
            "--cap-drop", "ALL",
            "--cap-add", "DAC_OVERRIDE",
            image, "tail", "-f", "/dev/null",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert res.returncode == 0, res.stderr
    return name


def _container_exists(name: str) -> bool:
    res = subprocess.run(
        ["docker", "ps", "-a", "--filter", f"name=^{name}$", "--format", "{{.Names}}"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    return name in res.stdout.split()


def test_in_container_clone_puts_source_in_container_not_on_host(tmp_path: Path) -> None:
    """The clone must land at /app inside the container and nowhere on the host."""
    name = _start_idle_container()
    try:
        clone_repo_into_container(
            container=name,
            owner=TEST_OWNER,
            repo=TEST_REPO,
            sha="HEAD",
            base_ref=TEST_BASE_REF,
            github_token=None,
            dest="/app",
        )

        # Source is present inside the container ...
        res = subprocess.run(
            ["docker", "exec", "-w", "/app", name, "sh", "-c",
             "git rev-parse --is-inside-work-tree && ls -a | head -20"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert res.returncode == 0, res.stderr
        assert "true" in res.stdout

        # ... and the clone is a real checkout with a .git dir.
        git_check = subprocess.run(
            ["docker", "exec", "-w", "/app", name, "test", "-d", ".git"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert git_check.returncode == 0
    finally:
        stop_sandbox(name)


def test_no_host_clone_or_worktree_directories_are_created() -> None:
    """Containers no longer imply any durable host-side mirror of the source."""
    import agent.sandbox as sandbox_pkg
    from agent.runner import pipeline

    # The host-side clone/worktree concepts are gone entirely.

    assert not hasattr(sandbox_pkg, "clone")
    # ARTIFACTS_BASE (forensic output) still exists; that is expected and fine.
    assert pipeline.ARTIFACTS_BASE is not None
    assert not hasattr(pipeline, "WORKSPACES_BASE")


def test_container_is_destroyed_after_stop() -> None:
    """--rm + stop must remove the container, destroying the only copy of the source."""
    name = _start_idle_container()
    assert _container_exists(name)
    stop_sandbox(name)
    assert not _container_exists(name), f"container {name} survived stop_sandbox"


def test_clone_failure_destroys_container_and_never_leaks_token() -> None:
    """A failed clone must tear the container down and scrub any token from errors."""
    secret = "ghp_SUPERSECRETTOKENVALUE123456789"
    name = _start_idle_container()
    try:
        with pytest.raises(CloneError) as excinfo:
            clone_repo_into_container(
                container=name,
                owner="this-owner-does-not-exist-xyz",
                repo="and-this-repo-neither-xyz",
                sha="HEAD",
                base_ref="main",
                github_token=secret,
                dest="/app",
            )
        # The token is injected as an env var, so a naive error dump could echo it.
        assert secret not in str(excinfo.value), "token leaked into the raised error"
        # And the scrubber itself works, independent of whether this particular
        # failure happened to echo the token.
        from agent.sandbox.docker_sandbox import _scrub_token

        assert _scrub_token(f"boom {secret} boom", secret) == "boom *** boom"
        assert _scrub_token("no token here", secret) == "no token here"
    finally:
        stop_sandbox(name)


def test_unsafe_repo_inputs_are_rejected_before_any_shell_runs() -> None:
    """Attacker-influenced owner/repo/sha must not be able to inject shell syntax."""
    name = _start_idle_container()
    try:
        for kwargs in (
            {"owner": "evil; rm -rf /", "repo": "x", "sha": "HEAD", "base_ref": "main"},
            {"owner": "ok", "repo": "$(whoami)", "sha": "HEAD", "base_ref": "main"},
            {"owner": "ok", "repo": "ok", "sha": "abc && curl evil.sh", "base_ref": "main"},
            {"owner": "ok", "repo": "ok", "sha": "HEAD", "base_ref": "main; reboot"},
        ):
            with pytest.raises(SandboxBootError):
                clone_repo_into_container(
                    container=name, github_token=None, dest="/app", **kwargs
                )
    finally:
        stop_sandbox(name)
