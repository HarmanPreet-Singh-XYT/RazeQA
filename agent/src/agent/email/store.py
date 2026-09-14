"""Durable outbox for outbound email.

The outbox exists so that no caller has to care whether SMTP is reachable. A
trigger writes one row and returns; a background drain delivers it, retries it
with backoff, and leaves an audit trail either way.

Two properties matter:

* **Enqueue is idempotent.** A ``dedupe_key`` identifies a logical event (one
  run, one publication). A retried pipeline that calls back into this module
  inserts the same key a second time, loses the unique-index race and gets
  ``None`` back instead of mailing everyone twice.
* **A missing database never loses the feature.** Without Supabase the store
  degrades to an in-process list, matching the run/intent stores' local
  fallback. Messages do not survive a restart, which is acceptable for local
  development and is logged as such.
"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

logger = logging.getLogger("agent.email.store")

STATUS_QUEUED = "queued"
STATUS_SENDING = "sending"
STATUS_SENT = "sent"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


class EmailOutboxStore:
    """Persistence for the ``email_messages`` outbox."""

    #: Retry backoff, in seconds, indexed by attempt number. A message that
    #: cannot be delivered on the first try is retried on a widening schedule
    #: rather than hammering a relay that is down.
    BACKOFF_S: tuple[float, ...] = (0.0, 30.0, 120.0, 600.0)

    def __init__(self, client: Any | None = None) -> None:
        self._client = client
        self._memory: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    @property
    def client(self) -> Any | None:
        if self._client is not None:
            return self._client
        try:
            from agent.db.supabase import get_supabase_client

            self._client = get_supabase_client()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Supabase unavailable for email outbox: %s", exc)
            self._client = None
        return self._client

    # -- enqueue -------------------------------------------------------------

    def enqueue(
        self,
        *,
        kind: str,
        subject: str,
        body_text: str,
        body_html: str | None,
        recipients: list[str],
        cc: list[str] | None = None,
        repo_full_name: str | None = None,
        project_id: str | None = None,
        run_id: str | None = None,
        pr_number: int | None = None,
        dedupe_key: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Record one message. Returns the row, or ``None`` when deduplicated.

        The row is returned in ``queued`` status; delivery is the drain's job.
        """
        timestamp = _iso()
        row: dict[str, Any] = {
            "id": str(uuid.uuid4()),
            "kind": kind,
            "subject": subject,
            "body_text": body_text,
            "body_html": body_html,
            "recipients": list(recipients),
            "cc": list(cc or []),
            "repo_full_name": repo_full_name,
            "project_id": project_id,
            "run_id": run_id,
            "pr_number": pr_number,
            "status": STATUS_QUEUED,
            "attempts": 0,
            "last_error": None,
            "provider_message_id": None,
            "dedupe_key": dedupe_key,
            "metadata": metadata or {},
            "created_at": timestamp,
            "updated_at": timestamp,
            "sent_at": None,
        }

        client = self.client
        if not client:
            return self._memory_enqueue(row)

        payload = {k: v for k, v in row.items() if k != "id"}
        try:
            res = client.table("email_messages").insert(payload).execute()
            rows = res.data or []
            return rows[0] if rows else row
        except Exception as exc:  # noqa: BLE001
            if _is_unique_violation(exc):
                logger.info(
                    "Email %s already queued for %s; skipping duplicate.",
                    kind,
                    dedupe_key,
                )
                return None
            logger.warning("Could not enqueue %s email: %s", kind, exc)
            # Last resort: keep the message in-process so an SMTP-less or
            # DB-less deployment still delivers it, rather than dropping mail
            # because one dependency is down.
            return self._memory_enqueue(row)

    def _memory_enqueue(self, row: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            if row.get("dedupe_key") and any(
                existing.get("dedupe_key") == row["dedupe_key"]
                for existing in self._memory
            ):
                return None
            self._memory.append(row)
            return dict(row)

    # -- reads ---------------------------------------------------------------

    def list_messages(
        self,
        *,
        repo_full_name: str | None = None,
        project_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        client = self.client
        if not client:
            return self._memory_list(
                repo_full_name=repo_full_name,
                project_id=project_id,
                status=status,
                limit=limit,
            )
        try:
            query = client.table("email_messages").select("*")
            if repo_full_name:
                query = query.eq("repo_full_name", repo_full_name)
            if project_id:
                query = query.eq("project_id", project_id)
            if status:
                query = query.eq("status", status)
            res = (
                query.order("created_at", desc=True)
                .limit(max(1, min(limit, 200)))
                .execute()
            )
            return res.data or []
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not list email messages: %s", exc)
            return self._memory_list(
                repo_full_name=repo_full_name,
                project_id=project_id,
                status=status,
                limit=limit,
            )

    def get(self, message_id: str) -> dict[str, Any] | None:
        client = self.client
        if not client:
            with self._lock:
                for row in self._memory:
                    if row["id"] == message_id:
                        return dict(row)
            return None
        try:
            res = (
                client.table("email_messages")
                .select("*")
                .eq("id", message_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0] if rows else None
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not read email message %s: %s", message_id, exc)
            return None

    def due_messages(
        self, *, limit: int = 20, max_attempts: int = 3
    ) -> list[dict[str, Any]]:
        """Messages eligible for a delivery attempt right now, oldest first.

        A ``failed`` row becomes eligible again once its backoff has elapsed;
        ``queued`` rows are always eligible. Messages that exhausted their
        attempts are left alone.
        """
        client = self.client
        if not client:
            return self._memory_due(limit=limit, max_attempts=max_attempts)
        try:
            res = (
                client.table("email_messages")
                .select("*")
                .in_("status", [STATUS_QUEUED, STATUS_FAILED])
                .lt("attempts", max_attempts)
                .order("created_at")
                .limit(max(1, min(limit, 100)))
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not read due email messages: %s", exc)
            return self._memory_due(limit=limit, max_attempts=max_attempts)

        now = _now()
        due: list[dict[str, Any]] = []
        for row in res.data or []:
            if _backoff_elapsed(row, now, self.BACKOFF_S):
                due.append(row)
        return due

    def _memory_due(self, *, limit: int, max_attempts: int) -> list[dict[str, Any]]:
        now = _now()
        with self._lock:
            candidates = [
                dict(row)
                for row in self._memory
                if row.get("status") in (STATUS_QUEUED, STATUS_FAILED)
                and int(row.get("attempts") or 0) < max_attempts
                and _backoff_elapsed(row, now, self.BACKOFF_S)
            ]
        candidates.sort(key=lambda r: str(r.get("created_at") or ""))
        return candidates[:limit]

    def _memory_list(
        self,
        *,
        repo_full_name: str | None,
        project_id: str | None,
        status: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        with self._lock:
            rows = [dict(row) for row in self._memory]
        if repo_full_name:
            rows = [r for r in rows if r.get("repo_full_name") == repo_full_name]
        if project_id:
            rows = [r for r in rows if r.get("project_id") == project_id]
        if status:
            rows = [r for r in rows if r.get("status") == status]
        rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return rows[: max(1, min(limit, 200))]

    # -- updates -------------------------------------------------------------

    def mark_sending(self, message_id: str) -> None:
        self._update(message_id, {"status": STATUS_SENDING, "updated_at": _iso()})

    def mark_sent(self, message_id: str, provider_message_id: str | None) -> None:
        self._update(
            message_id,
            {
                "status": STATUS_SENT,
                "provider_message_id": provider_message_id,
                "last_error": None,
                "sent_at": _iso(),
                "updated_at": _iso(),
            },
        )

    def mark_failed(self, message_id: str, error: str, attempts: int) -> None:
        self._update(
            message_id,
            {
                "status": STATUS_FAILED,
                "last_error": error[:2000],
                "attempts": attempts,
                "updated_at": _iso(),
            },
        )

    def mark_skipped(self, message_id: str, reason: str) -> None:
        self._update(
            message_id,
            {
                "status": STATUS_SKIPPED,
                "last_error": reason[:2000],
                "updated_at": _iso(),
            },
        )

    def retry(self, message_id: str) -> bool:
        """Re-queue a failed/skipped message for another attempt."""
        row = self.get(message_id)
        if not row:
            return False
        self._update(
            message_id,
            {
                "status": STATUS_QUEUED,
                "attempts": 0,
                "last_error": None,
                "updated_at": _iso(),
            },
        )
        return True

    def _update(self, message_id: str, patch: dict[str, Any]) -> None:
        client = self.client
        if not client:
            with self._lock:
                for row in self._memory:
                    if row["id"] == message_id:
                        row.update(patch)
                        return
            return
        try:
            client.table("email_messages").update(patch).eq("id", message_id).execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not update email message %s: %s", message_id, exc)
            with self._lock:
                for row in self._memory:
                    if row["id"] == message_id:
                        row.update(patch)
                        return


def _is_unique_violation(exc: Exception) -> bool:
    text = str(exc).lower()
    return "duplicate" in text or "23505" in text or "unique" in text


def _backoff_elapsed(
    row: dict[str, Any], now: datetime, schedule: tuple[float, ...]
) -> bool:
    """Whether enough time has passed since the last attempt."""
    if str(row.get("status") or "") != STATUS_FAILED:
        return True
    attempts = max(0, int(row.get("attempts") or 0))
    delay = schedule[min(attempts, len(schedule) - 1)] if schedule else 0.0
    last = _parse_ts(row.get("updated_at") or row.get("created_at"))
    if last is None:
        return True
    return now - last >= timedelta(seconds=delay)


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    try:
        # Python 3.11+ parses a trailing "Z" directly; the project requires 3.12.
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


default_email_outbox = EmailOutboxStore()
