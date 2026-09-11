"""Project registry for managing registered repositories and settings."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from agent.db.supabase import get_supabase_client

logger = logging.getLogger("agent.projects.registry")


@dataclass
class ProjectRecord:
    id: str
    repo_full_name: str
    installation_id: int | None = None
    settings: dict[str, Any] | None = None


class ProjectRegistry:
    """Registry to load project configurations from Supabase or memory."""

    def __init__(self, client: Any | None = None) -> None:
        self._client = client
        self._cache: dict[str, ProjectRecord] = {}

    @property
    def client(self) -> Any | None:
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def get_by_repo(self, repo_full_name: str) -> ProjectRecord | None:
        client = self.client
        if not client:
            return self._cache.get(repo_full_name)

        try:
            res = client.table("projects").select("*").eq("repo_full_name", repo_full_name).limit(1).execute()
            rows = res.data or []
            if rows:
                row = rows[0]
                return ProjectRecord(
                    id=row["id"],
                    repo_full_name=row["repo_full_name"],
                    installation_id=row.get("installation_id"),
                    settings=row.get("settings") or {},
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to query project for %s: %s", repo_full_name, exc)

        return self._cache.get(repo_full_name)

    def register(self, repo_full_name: str, settings: dict[str, Any] | None = None, installation_id: int | None = None) -> ProjectRecord:
        import uuid
        client = self.client
        record = ProjectRecord(
            id=str(uuid.uuid4()),
            repo_full_name=repo_full_name,
            installation_id=installation_id,
            settings=settings or {},
        )
        if client:
            try:
                payload = {
                    "id": record.id,
                    "repo_full_name": record.repo_full_name,
                    "installation_id": record.installation_id,
                    "settings": record.settings,
                }
                client.table("projects").upsert(payload).execute()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to register project in Supabase: %s", exc)

        self._cache[repo_full_name] = record
        return record


default_project_registry = ProjectRegistry()
