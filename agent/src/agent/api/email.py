"""HTTP surface for outbound email notifications.

Two audiences:

* the dashboard, which needs to know whether SMTP is live, send a test message,
  and show the recent delivery log;
* operators, who need a way to retry a message without waiting for the worker.

The endpoints never return a secret: :meth:`EmailSettings.public_dict` omits the
password and reports only whether authentication is configured.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from agent.api.rate_limit import SlidingWindowLimiter
from agent.email import templates
from agent.email.config import is_valid_address, load_email_settings
from agent.email.notifications import flush_outbox, notification_policy, send_test_email
from agent.email.store import default_email_outbox

logger = logging.getLogger("agent.api.email")
router = APIRouter(prefix="/email", tags=["email"])

#: A test send is a real outbound message; cap it so the endpoint cannot be used
#: to relay spam through the deployment's SMTP credentials.
test_email_limiter = SlidingWindowLimiter(max_events=5, window_seconds=60.0)


class TestEmailRequest(BaseModel):
    to: str | None = Field(
        default=None, description="Recipient; defaults to NOTIFY_EMAIL_TO."
    )


class RetryRequest(BaseModel):
    id: str


@router.get("/status")
async def email_status(repo: str | None = Query(default=None)) -> dict[str, Any]:
    """Whether email is configured, plus the effective policy for a repo."""
    settings = load_email_settings()
    messages = default_email_outbox.list_messages(limit=50)
    failed = sum(1 for m in messages if m.get("status") == "failed")
    return {
        **settings.public_dict(),
        "templates": sorted(templates.RENDERERS),
        "recent": len(messages),
        "failedRecent": failed,
        "policy": notification_policy(repo) if repo else None,
    }


@router.get("/messages")
async def list_messages(
    repo: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    """The recent delivery log, newest first."""
    rows = default_email_outbox.list_messages(
        repo_full_name=repo, status=status, limit=limit
    )
    return {
        "messages": [
            {
                "id": row.get("id"),
                "kind": row.get("kind"),
                "subject": row.get("subject"),
                "recipients": row.get("recipients") or [],
                "status": row.get("status"),
                "attempts": row.get("attempts"),
                "lastError": row.get("last_error"),
                "repoFullName": row.get("repo_full_name"),
                "runId": row.get("run_id"),
                "createdAt": row.get("created_at"),
                "sentAt": row.get("sent_at"),
            }
            for row in rows
        ]
    }


@router.post("/test")
async def send_test(payload: TestEmailRequest) -> dict[str, Any]:
    """Send a diagnostic email, bypassing project preferences."""
    settings = load_email_settings()
    if not settings.configured:
        raise HTTPException(
            status_code=503,
            detail="SMTP is not configured. Set SMTP_HOST and SMTP_FROM (see agent/.env.example).",
        )

    recipient = (payload.to or "").strip() or None
    if recipient and not is_valid_address(recipient):
        raise HTTPException(status_code=422, detail="Invalid recipient address.")

    identifier = recipient or (
        settings.global_recipients[0] if settings.global_recipients else "unknown"
    )
    wait = test_email_limiter.check(identifier)
    if wait > 0:
        raise HTTPException(
            status_code=429,
            detail=f"Too many test emails. Try again in {int(wait) + 1}s.",
        )

    result = await send_test_email(recipient)
    if not result.get("sent"):
        raise HTTPException(
            status_code=502, detail=result.get("reason") or "Send failed."
        )
    return result


@router.post("/flush")
async def flush() -> dict[str, Any]:
    """Attempt every due message immediately (the worker's job, on demand)."""
    return await flush_outbox(limit=50)


@router.post("/retry")
async def retry(payload: RetryRequest) -> dict[str, Any]:
    """Re-queue a failed message for another delivery attempt."""
    if not payload.id:
        raise HTTPException(status_code=422, detail="id is required.")
    if not default_email_outbox.retry(payload.id):
        raise HTTPException(status_code=404, detail="No such email message.")
    return {"queued": True, "id": payload.id}
