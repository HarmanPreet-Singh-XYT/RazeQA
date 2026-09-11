"""Tests for artifact retention cleanup and docker image removal."""

from __future__ import annotations

import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

from agent.runner.retention import cleanup_local_artifacts, purge_run_directory
from agent.sandbox.docker_sandbox import remove_image


def test_cleanup_local_artifacts_removes_old_dirs(tmp_path: Path) -> None:
    old_run = tmp_path / "run_old"
    old_run.mkdir()
    (old_run / "test.txt").write_text("old")

    new_run = tmp_path / "run_new"
    new_run.mkdir()
    (new_run / "test.txt").write_text("new")

    # Set old_run mtime to 10 days ago
    past_time = time.time() - (10 * 86400)
    os.utime(old_run, (past_time, past_time))

    purged = cleanup_local_artifacts(max_age_seconds=7 * 86400, base_dirs=[tmp_path])
    assert purged == 1
    assert not old_run.exists()
    assert new_run.exists()


def test_purge_run_directory(tmp_path: Path) -> None:
    target_dir = tmp_path / "run_to_purge"
    target_dir.mkdir()
    (target_dir / "trace.zip").write_bytes(b"data")

    assert purge_run_directory("run_to_purge", base_dirs=[tmp_path]) is True
    assert not target_dir.exists()


def test_remove_image_calls_docker() -> None:
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0)
        remove_image("pr-testing-sandbox:test-123")
        mock_run.assert_called_once_with(
            ["docker", "rmi", "-f", "pr-testing-sandbox:test-123"],
            capture_output=True,
            text=True,
            timeout=30,
        )
