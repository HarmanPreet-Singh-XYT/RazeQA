"""Background drain for the email outbox.

The fast path delivers inline (see :func:`agent.email.notifications._dispatch`),
so this loop exists purely to retry what did not go out: an SMTP outage at the
moment a run finished, a transient relay rejection, a message enqueued while the
process was shutting down.

It mirrors the retention loop in ``agent.main``: a single long-lived task,
cancelled cleanly on shutdown, that never lets one failed pass kill the loop.
"""

from __future__ import annotations

import asyncio
import logging

from agent.email.config import load_email_settings
from agent.email.notifications import flush_outbox

logger = logging.getLogger("agent.email.worker")


async def run_outbox_loop(interval_s: float | None = None) -> None:
    """Retry undelivered messages forever, sleeping ``interval_s`` between passes."""
    settings = load_email_settings()
    if not settings.configured:
        logger.info("Email outbox loop idle: SMTP is not configured.")
        return

    interval = float(
        interval_s if interval_s is not None else settings.retry_interval_s
    )
    if interval <= 0:
        logger.info("Email outbox loop disabled (interval=%s).", interval)
        return

    logger.info("Email outbox loop active: retrying every %.0fs.", interval)
    while True:
        try:
            result = await flush_outbox(limit=20)
            if result.get("delivered") or result.get("failed"):
                logger.info(
                    "Email outbox pass: %s delivered, %s failed",
                    result.get("delivered", 0),
                    result.get("failed", 0),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Email outbox pass failed")
        await asyncio.sleep(interval)
