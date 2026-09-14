"""Synchronous SMTP transport, wrapped for async callers.

Deliberately built on the standard library's :mod:`smtplib` rather than a
provider SDK so the feature works against any relay — corporate Exchange, SES
SMTP, Postmark, a local MailHog — without a vendor dependency. Provider APIs,
bounce webhooks and delivery analytics are explicitly out of scope; this is the
"send an email" primitive the rest of the system needs.

Nothing here raises into its caller for an ordinary delivery failure. A
notification must never change the outcome of a verification run, so failures
are returned as an :class:`EmailResult` and logged; the outbox records them for
retry.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from agent.email.config import EmailSettings, is_valid_address

logger = logging.getLogger("agent.email.client")


@dataclass
class EmailResult:
    """The outcome of one delivery attempt."""

    ok: bool
    message_id: str | None = None
    error: str | None = None


def _filter_addresses(addresses: list[str] | tuple[str, ...]) -> list[str]:
    valid: list[str] = []
    for address in addresses:
        if is_valid_address(address):
            valid.append(address)
        else:
            logger.warning("Dropping malformed email address: %r", address)
    return valid


def send_email_sync(
    settings: EmailSettings,
    *,
    to: list[str] | tuple[str, ...],
    subject: str,
    text: str,
    html: str | None = None,
    cc: list[str] | tuple[str, ...] | None = None,
    reply_to: str | None = None,
) -> EmailResult:
    """Deliver one message over SMTP.

    ``to``/``cc`` are validated and de-duplicated here so an invalid address or
    a header-injection attempt never reaches the wire.
    """
    recipients = _filter_addresses(to)
    cc_recipients = _filter_addresses(cc or [])
    if not recipients and not cc_recipients:
        return EmailResult(ok=False, error="no valid recipients")

    if not settings.configured:
        return EmailResult(ok=False, error="SMTP is not configured")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.sender_name, settings.sender))
    message["To"] = ", ".join(recipients)
    if cc_recipients:
        message["Cc"] = ", ".join(cc_recipients)
    effective_reply_to = reply_to or settings.reply_to
    if effective_reply_to and is_valid_address(effective_reply_to):
        message["Reply-To"] = effective_reply_to
    message_id = make_msgid(domain=settings.sender.partition("@")[2] or None)
    message["Message-ID"] = message_id
    message.set_content(text)
    if html:
        # multipart/alternative: plain text first, HTML as the preferred part.
        message.add_alternative(html, subtype="html")

    # The envelope must include Cc so the relay does not silently drop copies.
    envelope = recipients + cc_recipients
    context = ssl.create_default_context()

    try:
        if settings.use_tls:
            with smtplib.SMTP_SSL(
                settings.host, settings.port, timeout=settings.timeout, context=context
            ) as server:
                _login_if_needed(server, settings)
                server.send_message(
                    message, from_addr=settings.sender, to_addrs=envelope
                )
        else:
            with smtplib.SMTP(
                settings.host, settings.port, timeout=settings.timeout
            ) as server:
                server.ehlo()
                if settings.starttls:
                    server.starttls(context=context)
                    server.ehlo()
                _login_if_needed(server, settings)
                server.send_message(
                    message, from_addr=settings.sender, to_addrs=envelope
                )
    except Exception as exc:  # noqa: BLE001 - any transport failure is a delivery failure
        return EmailResult(ok=False, error=f"{type(exc).__name__}: {exc}")

    logger.info("Sent %s email to %d recipient(s)", subject[:80], len(envelope))
    return EmailResult(ok=True, message_id=message_id)


def _login_if_needed(server: smtplib.SMTP, settings: EmailSettings) -> None:
    """Authenticate only when a username is configured.

    An unauthenticated relay (a local MTA or an allowlisted internal host) is a
    legitimate deployment, and calling ``login`` with empty credentials turns it
    into a failure.
    """
    if settings.username:
        server.login(settings.username, settings.password)


async def send_email(
    settings: EmailSettings,
    *,
    to: list[str] | tuple[str, ...],
    subject: str,
    text: str,
    html: str | None = None,
    cc: list[str] | tuple[str, ...] | None = None,
    reply_to: str | None = None,
) -> EmailResult:
    """:func:`send_email_sync` off the event loop.

    ``smtplib`` is blocking, so the pipeline would stall for the length of the
    SMTP handshake if this were called directly. ``to_thread`` keeps the run's
    event loop free.
    """
    return await asyncio.to_thread(
        send_email_sync,
        settings,
        to=to,
        subject=subject,
        text=text,
        html=html,
        cc=cc,
        reply_to=reply_to,
    )
