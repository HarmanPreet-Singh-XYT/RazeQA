"""Manages local clones of external GitHub repositories for sandbox builds.

When a project is registered via GitHub import, the pipeline needs a *local*
git repository to:
  1. Run `git worktree add` for the exact SHA under test.
  2. Run `git diff` for diff analysis.

This module ensures a clone of the target repo exists locally under
``artifacts/clones/<owner>_<repo>/`` and keeps it up-to-date with
``git fetch --all``.

The clone directory is separate from WORKSPACES_BASE (worktree checkouts) and
is never removed between runs — it acts as a permanent local mirror of the
upstream GitHub repo.
"""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger("agent.sandbox.clone")

# Base directory for all repo clones — siblings of the artifact runs dir.
CLONES_BASE = Path(__file__).resolve().parents[4] / "artifacts" / "clones"


class CloneError(RuntimeError):
    """Raised when cloning or fetching a repository fails."""


def _safe_name(owner: str, repo: str) -> str:
    """Returns a filesystem-safe directory name for a repo clone."""
    safe = f"{owner}_{repo}".replace("/", "_").replace("\\", "_")
    return safe[:120]  # cap length


def clone_dir_for(owner: str, repo: str) -> Path:
    """Returns the expected local clone path for a given repo (may not exist yet)."""
    return CLONES_BASE / _safe_name(owner, repo)


def ensure_clone(
    owner: str,
    repo: str,
    github_token: str | None = None,
    clone_url: str | None = None,
) -> Path:
    """Ensures a local clone of ``owner/repo`` exists and is up to date.

    - If the clone doesn't exist yet, runs ``git clone``.
    - If it already exists, runs ``git fetch --all --prune`` to bring it
      up to date with the latest branches and tags.

    Returns the path to the local clone root (which has a real ``.git``
    directory suitable for ``git worktree``).

    Raises ``CloneError`` if clone/fetch fails.
    """
    CLONES_BASE.mkdir(parents=True, exist_ok=True)
    local_path = clone_dir_for(owner, repo)

    # Build the clone URL — prefer explicit override, then token-authenticated
    # HTTPS, then unauthenticated (public repos).
    if not clone_url:
        if github_token:
            clone_url = f"https://x-access-token:{github_token}@github.com/{owner}/{repo}.git"
        else:
            clone_url = f"https://github.com/{owner}/{repo}.git"

    if (local_path / ".git").is_dir():
        # Clone already exists — just fetch updates.
        logger.info("Fetching updates for existing clone of %s/%s at %s", owner, repo, local_path)
        fetch = subprocess.run(
            ["git", "fetch", "--all", "--prune", "--quiet"],
            cwd=local_path,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if fetch.returncode != 0:
            logger.warning(
                "git fetch failed for %s/%s (will proceed with stale clone): %s",
                owner, repo, fetch.stderr.strip(),
            )
        return local_path

    # Fresh clone — bare=False so `git worktree` works (needs a working tree).
    logger.info("Cloning %s/%s into %s", owner, repo, local_path)
    clone_result = subprocess.run(
        ["git", "clone", "--quiet", clone_url, str(local_path)],
        capture_output=True,
        text=True,
        timeout=300,  # 5 min for large repos
    )
    if clone_result.returncode != 0:
        # Mask the token in the error message before logging/raising.
        err = clone_result.stderr.replace(github_token or "", "***") if github_token else clone_result.stderr
        raise CloneError(
            f"Failed to clone {owner}/{repo}: {err.strip()}"
        )

    logger.info("Successfully cloned %s/%s", owner, repo)
    return local_path
