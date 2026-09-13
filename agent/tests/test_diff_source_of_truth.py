"""Regression tests for the diff-analysis source-of-truth bug.

The pipeline used to compute the diff, route discovery and blast radius BEFORE
any sandbox existed, against ``APP_REPO_DIR`` — the platform's own ``web/`` app.
For a real PR that meant the risk analysis described the wrong codebase: the
diff side of the product was analysing our own repository rather than the one
under test.

These tests pin the corrected behaviour: when a sandbox container is in play,
the diff and route discovery are driven by that container.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from agent.runner.pipeline import _extract_run_diff


@pytest.mark.asyncio
async def test_extract_run_diff_uses_container_when_sandboxed() -> None:
    """With a container, the diff must come from the container — never the host repo."""
    with patch("agent.runner.pipeline._get_git_diff", return_value="diff-from-container") as mock_container_diff, \
         patch("agent.runner.pipeline._get_git_diff_local", return_value="diff-from-host") as mock_local:
        result = await _extract_run_diff("sandbox-abc123", "main", is_real_github_repo=True)

    assert result == "diff-from-container"
    mock_container_diff.assert_called_once_with("sandbox-abc123", "main")
    mock_local.assert_not_called()


@pytest.mark.asyncio
async def test_extract_run_diff_falls_back_to_local_without_container() -> None:
    """SANDBOX_MODE=disabled has no container, so the local app repo is the source."""
    with patch("agent.runner.pipeline._get_git_diff_local", return_value="diff-from-host") as mock_local, \
         patch("agent.runner.pipeline._get_git_diff") as mock_container_diff:
        result = await _extract_run_diff(None, "main", is_real_github_repo=False)

    assert result == "diff-from-host"
    mock_local.assert_called_once()
    mock_container_diff.assert_not_called()


def test_get_git_diff_runs_inside_container() -> None:
    """The container diff must be a `docker exec ... git diff`, not a host git call."""
    from agent.runner.pipeline import _get_git_diff

    completed = MagicMock()
    completed.stdout = "the-diff"
    with patch("agent.runner.pipeline.subprocess.run", return_value=completed) as mock_run:
        assert _get_git_diff("sandbox-xyz", "main") == "the-diff"

    argv = mock_run.call_args[0][0]
    assert argv[:5] == ["docker", "exec", "-w", "/app", "sandbox-xyz"]
    assert argv[5] == "git"
    assert argv[6] == "diff"
    assert "main...HEAD" in argv[7]


def test_get_git_diff_does_not_reference_app_repo_dir() -> None:
    """Guard against a regression that re-binds the diff to the host app repo."""
    import inspect

    from agent.runner import pipeline

    source = inspect.getsource(pipeline._get_git_diff)
    assert "APP_REPO_DIR" not in source, (
        "_get_git_diff must diff inside the container; APP_REPO_DIR belongs to "
        "the platform's own app and must never be the diff source for a PR run."
    )
    # The host-path variant is intentionally separate, for the disabled dev path.
    assert "cwd=cwd" in inspect.getsource(pipeline._get_git_diff_local)
