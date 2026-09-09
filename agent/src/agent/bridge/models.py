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
    def append(self, branch: str, event: IntentEvent) -> None:
        raise NotImplementedError

    def get(self, branch: str) -> list[IntentEvent]:
        raise NotImplementedError

    def clear(self, branch: str) -> None:
        raise NotImplementedError


class FileIntentStore(IntentStore):
    """File-backed intent log store. Persists events as JSON Lines per branch."""

    def __init__(self, base_dir: Path = DEFAULT_INTENTS_DIR) -> None:
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _branch_file(self, branch: str) -> Path:
        safe_name = quote_plus(branch)
        return self.base_dir / f"{safe_name}.jsonl"

    def append(self, branch: str, event: IntentEvent) -> None:
        file_path = self._branch_file(branch)
        line = event.model_dump_json() + "\n"
        with self._lock, file_path.open("a", encoding="utf-8") as f:
            f.write(line)

    def get(self, branch: str) -> list[IntentEvent]:
        file_path = self._branch_file(branch)
        with self._lock:
            if not file_path.exists():
                return []
            events: list[IntentEvent] = []
            with file_path.open("r", encoding="utf-8") as f:
                for line in f:
                    stripped = line.strip()
                    if stripped:
                        data = json.loads(stripped)
                        events.append(IntentEvent(**data))
            return events

    def clear(self, branch: str) -> None:
        file_path = self._branch_file(branch)
        with self._lock:
            if file_path.exists():
                file_path.unlink()
