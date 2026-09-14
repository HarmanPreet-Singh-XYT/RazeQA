"""Outbound email notifications (SMTP).

Public surface:

* :func:`load_email_settings` / :func:`is_email_configured` — transport config.
* :func:`send_email` / :func:`send_email_sync` — the raw transport.
* :func:`notify_run_completed`, :func:`notify_review_completed`,
  :func:`notify_fix_published` — event entry points used by the engine.
* :class:`EmailOutboxStore` — the durable outbox.
"""

from agent.email.client import EmailResult, send_email, send_email_sync
from agent.email.config import EmailSettings, is_email_configured, load_email_settings
from agent.email.notifications import (
    flush_outbox,
    notify_fix_published,
    notify_review_completed,
    notify_run_completed,
    send_test_email,
)
from agent.email.store import EmailOutboxStore, default_email_outbox

__all__ = [
    "EmailOutboxStore",
    "EmailResult",
    "EmailSettings",
    "default_email_outbox",
    "flush_outbox",
    "is_email_configured",
    "load_email_settings",
    "notify_fix_published",
    "notify_review_completed",
    "notify_run_completed",
    "send_email",
    "send_email_sync",
    "send_test_email",
]
