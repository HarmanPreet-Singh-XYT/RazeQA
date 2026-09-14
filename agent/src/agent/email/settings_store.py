"""Persistence for per-user notification settings.

One row per user in ``notification_settings`` holds two additive JSON blobs:

* ``defaults`` — workspace defaults applied to the user's projects when a project
  has not overridden a field;
* ``personal`` — the user's own subscription, applied when they are a resolved
  recipient.

Like the other stores, a missing Supabase client degrades to an in-process dict
so local development and tests work without a database. The lookup path is on the
notification critical path, so a failure here returns empty blobs (meaning "no
override") rather than raising — a database hiccup must not silence a
notification.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("agent.email.settings_store")


def _now() -> str:
    return datetime.now(UTC).isoformat()


class NotificationSettingsStore:
    """Reads and writes ``notification_settings`` rows."""

    def __init__(self, client: Any | None = None) -> None:
        self._client = client
        self._memory: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    @property
    def client(self) -> Any | None:
        if self._client is not None:
            return self._client
        try:
            from agent.db.supabase import get_supabase_client

            self._client = get_supabase_client()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Supabase unavailable for notification settings: %s", exc)
            self._client = None
        return self._client

    def get_for_user(self, user_id: Any) -> dict[str, Any]:
        """``{"defaults": {...}, "personal": {...}}``; empty blobs when unset."""
        empty = {"defaults": {}, "personal": {}}
        if not user_id:
            return empty
        key = str(user_id)

        client = self.client
        if not client:
            with self._lock:
                row = self._memory.get(key)
            return dict(row) if row else empty
        try:
            res = (
                client.table("notification_settings")
                .select("defaults, personal")
                .eq("user_id", key)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if not rows:
                return empty
            return {
                "defaults": rows[0].get("defaults") or {},
                "personal": rows[0].get("personal") or {},
            }
        except Exception as exc:  # noqa: BLE001
            # Missing table (migration not applied) or a transient error: treat
            # as "no override" so notifications still flow.
            logger.debug("Could not read notification settings for %s: %s", key, exc)
            with self._lock:
                row = self._memory.get(key)
            return dict(row) if row else empty

    def get_defaults_for_user(self, user_id: Any) -> dict[str, Any]:
        return self.get_for_user(user_id).get("defaults") or {}

    def get_personal_for_user(self, user_id: Any) -> dict[str, Any]:
        return self.get_for_user(user_id).get("personal") or {}

    def upsert_for_user(
        self,
        user_id: str,
        *,
        defaults: dict[str, Any] | None = None,
        personal: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create or update a user's row, leaving an unsupplied blob untouched."""
        if not user_id:
            raise ValueError("user_id is required")
        existing = self.get_for_user(user_id)
        payload = {
            "user_id": str(user_id),
            "defaults": existing.get("defaults") or {} if defaults is None else defaults,
            "personal": existing.get("personal") or {} if personal is None else personal,
            "updated_at": _now(),
        }

        with self._lock:
            self._memory[str(user_id)] = {
                "defaults": payload["defaults"],
                "personal": payload["personal"],
            }

        client = self.client
        if not client:
            return {"defaults": payload["defaults"], "personal": payload["personal"]}
        try:
            client.table("notification_settings").upsert(
                payload, on_conflict="user_id"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not persist notification settings for %s: %s", user_id, exc)
        return {"defaults": payload["defaults"], "personal": payload["personal"]}


default_notification_settings_store = NotificationSettingsStore()
