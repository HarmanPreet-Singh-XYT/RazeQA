"""Isolated checkout of a specific branch/SHA for sandbox image builds.

Uses `git worktree` against the engine's own local clone of the app repo so
each run builds an image from the exact commit under test rather than
whatever happens to be checked out on the host (which was the prior
behavior: journeys always hit whatever was already running on
localhost:3000, regardless of which SHA triggered the run).
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import uuid
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger("agent.sandbox.checkout")


class CheckoutError(RuntimeError):
    """Raised when the target branch/SHA cannot be checked out."""


@contextmanager
def checkout_worktree(repo_dir: Path, sha: str, workspaces_root: Path):
    """Creates an isolated `git worktree` at `sha` under `workspaces_root`,
    yields its path, and always removes it on exit."""
    workspaces_root.mkdir(parents=True, exist_ok=True)
    worktree_path = workspaces_root / f"wt-{sha[:12]}-{uuid.uuid4().hex[:6]}"

    try:
        subprocess.run(
            ["git", "fetch", "--all", "--quiet"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            timeout=60,
        )
        result = subprocess.run(
            ["git", "worktree", "add", "--detach", str(worktree_path), sha],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            raise CheckoutError(
                f"Failed to check out {sha} from {repo_dir}: {result.stderr.strip()}"
            )
        yield worktree_path
    finally:
        subprocess.run(
            ["git", "worktree", "remove", "--force", str(worktree_path)],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        shutil.rmtree(worktree_path, ignore_errors=True)
