"""Git Mirror Manager ported from langpeanut-cloud architecture.

Maintains bare/shallow mirror repositories locally to eliminate repeated network
cloning overhead, reducing checkout time from seconds to milliseconds while safely
handling lock file recovery.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger("agent.runner.mirror")
DEFAULT_MIRRORS_DIR = Path(
    os.environ.get(
        "GIT_MIRRORS_DIR",
        str(Path(__file__).resolve().parents[3] / "artifacts" / "mirrors"),
    )
)


class MirrorError(RuntimeError):
    """Raised when git mirror management fails."""


_UNSAFE_REPO_CHARS_RE = re.compile(r"[^A-Za-z0-9._-]")


def _sanitize_repo_component(value: str) -> str:
    """Collapse an owner/repo-derived string into a safe mirror directory name.

    Previously only "/" and "\\" were replaced, so an owner/repo value of
    ".." could still combine into a path that escapes base_dir via traversal.
    This collapses everything but a conservative safe-character allowlist.
    """
    collapsed = _UNSAFE_REPO_CHARS_RE.sub("_", value).strip("_.")
    return collapsed or "repo"


class MirrorManager:
    """Manages local bare git mirrors for repositories."""

    def __init__(self, base_dir: Path | None = None) -> None:
        self.base_dir = base_dir or DEFAULT_MIRRORS_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _clean_stale_locks(self, mirror_path: Path) -> None:
        """Remove leftover index.lock files from abrupt runner terminations."""
        lock_file = mirror_path / "index.lock"
        if lock_file.exists():
            try:
                lock_file.unlink()
                logger.info("Cleaned stale git lock file at %s", lock_file)
            except OSError as exc:
                logger.warning("Could not remove lock file %s: %s", lock_file, exc)

    def ensure_mirror(self, owner: str, repo: str, auth_url: str | None = None) -> Path:
        """Ensure a local mirror of the repository exists and is up to date."""
        safe_name = _sanitize_repo_component(f"{owner}_{repo}")
        mirror_path = self.base_dir / f"{safe_name}.git"

        # If mirror doesn't exist, initialize bare clone
        if not mirror_path.exists():
            logger.info("Creating bare git mirror for %s/%s at %s", owner, repo, mirror_path)
            target_url = auth_url or f"https://github.com/{owner}/{repo}.git"
            try:
                subprocess.run(
                    # "--" ensures target_url can never be parsed as a git
                    # option even if it starts with "-" (argument injection).
                    ["git", "clone", "--bare", "--", target_url, str(mirror_path)],
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=120,
                )
            except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc:
                raise MirrorError(f"Failed to initialize git mirror for {owner}/{repo}: {exc}") from exc
        else:
            # Update existing mirror
            self._clean_stale_locks(mirror_path)
            if auth_url:
                subprocess.run(
                    ["git", "remote", "set-url", "--", "origin", auth_url],
                    cwd=mirror_path,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
            try:
                subprocess.run(
                    ["git", "fetch", "--prune", "--", "origin"],
                    cwd=mirror_path,
                    capture_output=True,
                    text=True,
                    check=True,
                    timeout=60,
                )
            except subprocess.SubprocessError as exc:
                logger.warning("Git fetch on mirror %s returned warning: %s", mirror_path, exc)

        return mirror_path

    def head_commit_sha(self, mirror_path: Path, branch: str = "main") -> str:
        """Resolve head commit SHA for a branch directly from the mirror."""
        try:
            res = subprocess.run(
                ["git", "rev-parse", "--", branch],
                cwd=mirror_path,
                capture_output=True,
                text=True,
                check=True,
                timeout=10,
            )
            return res.stdout.strip()
        except subprocess.SubprocessError as exc:
            raise MirrorError(f"Could not resolve head SHA for branch '{branch}' in {mirror_path}: {exc}") from exc

    def clone_from_mirror(self, mirror_path: Path, dest_dir: Path, auth_url: str | None = None) -> None:
        """Perform a fast local clone from bare mirror into ephemeral working copy."""
        if dest_dir.exists():
            shutil.rmtree(dest_dir, ignore_errors=True)
        dest_dir.parent.mkdir(parents=True, exist_ok=True)

        try:
            subprocess.run(
                ["git", "clone", "--", str(mirror_path), str(dest_dir)],
                capture_output=True,
                text=True,
                check=True,
                timeout=30,
            )
            if auth_url:
                subprocess.run(
                    ["git", "remote", "set-url", "--", "origin", auth_url],
                    cwd=dest_dir,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
        except subprocess.SubprocessError as exc:
            raise MirrorError(f"Failed to clone working tree from mirror {mirror_path} to {dest_dir}: {exc}") from exc
