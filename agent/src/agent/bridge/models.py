"""Data models and per-branch persistence for Coding Agent Bridge intent events."""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import BaseModel, Field


class IntentEvent(BaseModel):
    files: list[str] = Field(default_factory=list)
    action: str = "edit"
    prompt_summary: str
    reasoning: str
    branch: str
    repo: str = "default"
    working_dir: str | None = None
    sha: str | None = None
    timestamp: str = Field(default_factory=lambda: datetime.now(UTC).isoformat())


DEFAULT_INTENTS_DIR = Path(
    os.environ.get(
        "INTENT_STORE_DIR",
        Path(__file__).resolve().parents[3] / "artifacts" / "intents",
    )
)


class IntentStore:
    def append(self, branch: str, event: IntentEvent, repo: str = "default") -> None:
        raise NotImplementedError

    def get(self, branch: str, repo: str = "default") -> list[IntentEvent]:
        raise NotImplementedError

    def clear(self, branch: str, repo: str = "default") -> None:
        raise NotImplementedError


class FileIntentStore(IntentStore):
    """File-backed intent log store. Persists events as JSON Lines per repo and branch."""

    def __init__(self, base_dir: Path = DEFAULT_INTENTS_DIR) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _branch_file(self, branch: str, repo: str = "default") -> Path:
        key = f"{repo}__{branch}" if repo and repo != "default" else branch
        safe_name = quote_plus(key)
        return self.base_dir / f"{safe_name}.jsonl"

    def append(self, branch: str, event: IntentEvent, repo: str = "default") -> None:
        effective_repo = event.repo if event.repo != "default" else repo
        file_path = self._branch_file(branch, repo=effective_repo)
        line = event.model_dump_json() + "\n"
        with self._lock, file_path.open("a", encoding="utf-8") as f:
            f.write(line)

    def get(self, branch: str, repo: str = "default") -> list[IntentEvent]:
        file_path = self._branch_file(branch, repo=repo)
        with self._lock:
            if not file_path.exists():
                # Fallback to legacy un-scoped branch file if present
                legacy_path = self._branch_file(branch, repo="default")
                if legacy_path != file_path and legacy_path.exists():
                    file_path = legacy_path
                else:
                    return []
            events: list[IntentEvent] = []
            with file_path.open("r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped:
                        data = json.loads(stripped)
                        events.append(IntentEvent(**data))
            return events

    def clear(self, branch: str, repo: str = "default") -> None:
        file_path = self._branch_file(branch, repo=repo)
        with self._lock:
            if file_path.exists():
                file_path.unlink()
            legacy_path = self._branch_file(branch, repo="default")
            if legacy_path != file_path and legacy_path.exists():
                legacy_path.unlink()
