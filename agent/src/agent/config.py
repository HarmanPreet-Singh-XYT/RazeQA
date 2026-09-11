"""Environment and configuration loading for the autonomous QA engine."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("agent.config")


def get_candidate_env_paths() -> list[Path]:
    """Return an ordered list of candidate .env file paths to search."""
    candidates: list[Path] = []

    # 1. Explicit environment variable if specified
    explicit = os.environ.get("ENV_FILE")
    if explicit:
        candidates.append(Path(explicit).resolve())

    # 2. CWD-based paths (e.g. running from repo root or agent directory)
    cwd = Path.cwd().resolve()
    candidates.append(cwd / ".env")
    candidates.append(cwd / "agent" / ".env")

    # 3. Source-relative paths (reliable regardless of where python/uvicorn is launched)
    # config.py is at: <repo_root>/agent/src/agent/config.py
    current_file = Path(__file__).resolve()
    agent_dir = current_file.parents[2]  # <repo_root>/agent
    repo_root = current_file.parents[3]  # <repo_root>

    candidates.append(agent_dir / ".env")
    candidates.append(repo_root / ".env")

    # Deduplicate while preserving order
    seen: set[Path] = set()
    unique: list[Path] = []
    for p in candidates:
        try:
            resolved = p.resolve()
        except OSError:
            resolved = p
        if resolved not in seen:
            seen.add(resolved)
            unique.append(p)
    return unique


def _is_pytest() -> bool:
    """Check if code is running under pytest."""
    return "pytest" in sys.modules or "PYTEST_CURRENT_TEST" in os.environ


def load_env(
    env_file: str | Path | None = None,
    *,
    override: bool = False,
    force: bool = False,
) -> list[Path]:
    """Find and load .env files into os.environ.

    Parameters
    ----------
    env_file : str | Path | None
        Specific path to a .env file. If provided, loaded first.
    override : bool
        Whether to overwrite existing environment variables. Defaults to False
        so explicit shell/container variables take precedence.
    force : bool
        If True, loads .env even when running under pytest.

    Returns
    -------
    list[Path]
        List of paths that were found and loaded.
    """
    if not force and _is_pytest() and not os.environ.get("LOAD_ENV_IN_TESTS"):
        return []

    loaded: list[Path] = []

    if env_file:
        custom_path = Path(env_file).resolve()
        if custom_path.is_file():
            load_dotenv(custom_path, override=override)
            loaded.append(custom_path)
            logger.info("Loaded custom environment file: %s", custom_path)
            return loaded

    for candidate in get_candidate_env_paths():
        if candidate.is_file():
            load_dotenv(candidate, override=override)
            loaded.append(candidate)
            logger.info("Loaded environment file: %s", candidate)

    return loaded


# Automatically load on module import
_loaded_files = load_env()
