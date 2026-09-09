"""Supabase database client and store adapters with seamless fallback."""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime
from typing import Any

from agent.api.runs import RunRecord, run_store
from agent.bridge.models import FileIntentStore, IntentEvent, IntentStore

logger = logging.getLogger("agent.db.supabase")


def get_supabase_client() -> Any | None:
    """Instantiate Supabase client if credentials exist in environment."""
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import Client, create_client

        client: Client = create_client(url, key)
        return client
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to initialize Supabase client: %s", exc)
        return None


def is_supabase_enabled() -> bool:
    return get_supabase_client() is not None


class SupabaseIntentStore(IntentStore):
    """PostgreSQL intent log store hosted on Supabase."""

    def __init__(self, client: Any) -> None:
        self.client = client

    def append(self, branch: str, event: IntentEvent) -> None:
        try:
            payload = {
                "branch": branch,
                "sha": event.sha,
                "files": event.files,
                "action": event.action,
                "prompt_summary": event.prompt_summary,
                "reasoning": event.reasoning,
                "working_dir": event.working_dir,
                "created_at": event.timestamp,
            }
            self.client.table("intent_logs").insert(payload).execute()
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to insert intent_log into Supabase: %s", exc)

    def get(self, branch: str) -> list[IntentEvent]:
        try:
            res = (
                self.client.table("intent_logs")
                .select("*")
                .eq("branch", branch)
                .order("created_at", desc=False)
                .execute()
            )
            events: list[IntentEvent] = []
            for row in res.data or []:
                events.append(
                    IntentEvent(
                        files=row.get("files") or [],
                        action=row.get("action", "edit"),
                        prompt_summary=row.get("prompt_summary", ""),
                        reasoning=row.get("reasoning", ""),
                        branch=row.get("branch", branch),
                        working_dir=row.get("working_dir"),
                        sha=row.get("sha"),
                        timestamp=row.get("created_at") or datetime.now(UTC).isoformat(),
                    )
                )
            return events
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to fetch intent_logs from Supabase: %s", exc)
            return []

    def clear(self, branch: str) -> None:
        try:
            self.client.table("intent_logs").delete().eq("branch", branch).execute()
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to clear intent_logs from Supabase: %s", exc)


class SupabaseRunStore:
    """PostgreSQL test run store hosted on Supabase."""

    def __init__(self, client: Any) -> None:
        self.client = client

    def find_latest_by_sha(
        self, branch: str, sha: str, scope: str | None = None, test_type: str | None = None
    ) -> RunRecord | None:
        try:
            query = (
                self.client.table("runs")
                .select("*")
                .eq("branch", branch)
                .eq("sha", sha)
            )
            if scope:
                query = query.eq("scope", scope)
            if test_type:
                query = query.eq("test_type", test_type)
            res = query.order("created_at", desc=True).limit(1).execute()
            rows = res.data or []
            if not rows:
                return None
            row = rows[0]
            return RunRecord(
                run_id=row["id"],
                branch=row["branch"],
                sha=row["sha"],
                scope=row["scope"],
                test_type=row["test_type"],
                status=row["status"],
                created_at=row.get("created_at") or datetime.now(UTC).isoformat(),
                completed_at=row.get("completed_at"),
                result=row.get("result"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to query run from Supabase: %s", exc)
            return None

    def create(self, branch: str, sha: str, scope: str = "changed", test_type: str = "functional") -> RunRecord:
        import uuid

        record = RunRecord(
            run_id=f"run_{uuid.uuid4().hex[:12]}",
            branch=branch,
            sha=sha,
            scope=scope,
            test_type=test_type,
            status="queued",
        )
        try:
            payload = {
                "id": record.run_id,
                "branch": record.branch,
                "sha": record.sha,
                "scope": record.scope,
                "test_type": record.test_type,
                "status": record.status,
                "created_at": record.created_at,
            }
            self.client.table("runs").insert(payload).execute()
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to insert run into Supabase: %s", exc)
        return record

    def get(self, run_id: str) -> RunRecord | None:
        try:
            res = self.client.table("runs").select("*").eq("id", run_id).limit(1).execute()
            rows = res.data or []
            if not rows:
                return None
            row = rows[0]
            return RunRecord(
                run_id=row["id"],
                branch=row["branch"],
                sha=row["sha"],
                scope=row["scope"],
                test_type=row["test_type"],
                status=row["status"],
                created_at=row.get("created_at") or datetime.now(UTC).isoformat(),
                completed_at=row.get("completed_at"),
                result=row.get("result"),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to get run from Supabase: %s", exc)
            return None

    def update(
        self,
        run_id: str,
        status: str,
        result: dict[str, Any] | None = None,
        completed: bool = False,
    ) -> RunRecord | None:
        try:
            payload: dict[str, Any] = {"status": status}
            if result is not None:
                payload["result"] = result
            if completed:
                payload["completed_at"] = datetime.now(UTC).isoformat()
            res = self.client.table("runs").update(payload).eq("id", run_id).execute()
            rows = res.data or []
            if rows:
                row = rows[0]
                return RunRecord(
                    run_id=row["id"],
                    branch=row["branch"],
                    sha=row["sha"],
                    scope=row["scope"],
                    test_type=row["test_type"],
                    status=row["status"],
                    created_at=row.get("created_at") or datetime.now(UTC).isoformat(),
                    completed_at=row.get("completed_at"),
                    result=row.get("result"),
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to update run in Supabase: %s", exc)
        return None

    def list_all(self, branch: str | None = None, sha: str | None = None) -> list[RunRecord]:
        try:
            query = self.client.table("runs").select("*").order("created_at", desc=True)
            if branch:
                query = query.eq("branch", branch)
            if sha:
                query = query.eq("sha", sha)
            res = query.execute()
            records: list[RunRecord] = []
            for row in res.data or []:
                records.append(
                    RunRecord(
                        run_id=row["id"],
                        branch=row["branch"],
                        sha=row["sha"],
                        scope=row["scope"],
                        test_type=row["test_type"],
                        status=row["status"],
                        created_at=row.get("created_at") or datetime.now(UTC).isoformat(),
                        completed_at=row.get("completed_at"),
                        result=row.get("result"),
                    )
                )
            return records
        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to list runs from Supabase: %s", exc)
            return []


# Storage instances with automatic Supabase detection and local fallback
_supabase_client = get_supabase_client()
default_intent_store: IntentStore = (
    SupabaseIntentStore(_supabase_client) if _supabase_client else FileIntentStore()
)
default_run_store: Any = SupabaseRunStore(_supabase_client) if _supabase_client else run_store
