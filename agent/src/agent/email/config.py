"""Outbound email (SMTP) configuration.

Every value is read from the environment at call time rather than captured at
import, so a process that loads ``.env`` after import (the CLI and the bridge
daemon both do) still sees the configuration, and tests can monkeypatch a single
name without reloading the module.

The design is deliberately conservative:

* **Off unless configured.** A host and a sender address are both required; with
  either missing, :meth:`EmailSettings.configured` is false and every send path
  degrades to a recorded ``skipped`` message rather than raising. Email is a
  convenience, and a deployment without SMTP must keep working.
* **Explicit transport.** ``SMTP_USE_TLS`` selects implicit TLS (SMTPS, usually
  port 465); otherwise ``SMTP_STARTTLS`` (on by default) upgrades a plain
  connection. Ambiguity here is the difference between mail delivered and mail
  silently dropped by the relay.
* **A single place for secrets.** ``SMTP_PASSWORD`` is registered with the
  secret-file loader in :mod:`agent.config`, so Docker/K8s secret mounts work
  like every other credential in the project.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger("agent.email.config")

#: Environment variables that hold a secret and may be supplied as a file.
EMAIL_SECRET_ENV_NAMES: tuple[str, ...] = ("SMTP_PASSWORD",)

_TRUTHY = ("1", "true", "yes", "on")


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY


def _int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning("Ignoring non-numeric %s=%r; using %d", name, raw, default)
        return default


def _float(name: str, default: float) -> float:
    raw = _env(name)
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        logger.warning("Ignoring non-numeric %s=%r; using %s", name, raw, default)
        return default


def parse_address_list(raw: str | None) -> list[str]:
    """Split a comma/semicolon/whitespace separated address list, de-duplicated.

    Kept here (rather than in the recipient resolver) so the env-var parsing and
    the ``settings.notifications`` parsing share one notion of what an address
    list looks like.
    """
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for chunk in raw.replace(";", ",").replace("\n", ",").split(","):
        address = chunk.strip().strip("<>").strip()
        if not address:
            continue
        key = address.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(address)
    return out


def is_valid_address(address: str) -> bool:
    """A deliberately permissive sanity check, not RFC 5322.

    The goal is to reject obvious mistakes (a bare name, a missing ``@``, a
    newline that could inject a header) before handing an address to the SMTP
    layer. The relay remains the authority on deliverability.
    """
    if not address or len(address) > 320:
        return False
    if any(ch.isspace() for ch in address) or "\n" in address or "\r" in address:
        return False
    if address.count("@") != 1:
        return False
    local, _, domain = address.partition("@")
    if not local or not domain or "." not in domain:
        return False
    return not (domain.startswith(".") or domain.endswith("."))


@dataclass(frozen=True)
class EmailSettings:
    """Resolved SMTP + notification policy for the current process."""

    host: str
    port: int
    username: str
    password: str
    sender: str
    sender_name: str
    reply_to: str
    use_tls: bool
    starttls: bool
    timeout: float
    #: Master switch. ``false`` stops every notification even when SMTP is
    #: configured, without having to remove the credentials.
    enabled: bool
    #: Comma-separated addresses that always receive a copy of every
    #: notification, regardless of project preferences. Useful for a shared
    #: team inbox or for proving delivery from a deployment.
    global_recipients: tuple[str, ...]
    #: When true, ``global_recipients`` replace project recipients instead of
    #: being added to them. Intended for staging deployments where mail must not
    #: leak to real users.
    global_recipients_only: bool
    max_attempts: int
    retry_interval_s: float
    dashboard_url: str

    @property
    def configured(self) -> bool:
        """Whether a send could actually be attempted."""
        return bool(self.host and self.sender)

    @property
    def active(self) -> bool:
        """Whether notifications are both enabled and deliverable."""
        return self.enabled and self.configured

    def public_dict(self) -> dict:
        """A description safe to return over the API (never includes the password)."""
        return {
            "configured": self.configured,
            "enabled": self.enabled,
            "active": self.active,
            "host": self.host,
            "port": self.port,
            "from": self.sender,
            "fromName": self.sender_name,
            "useTls": self.use_tls,
            "starttls": self.starttls,
            "authConfigured": bool(self.username),
            "dashboardUrl": self.dashboard_url,
        }


def load_email_settings() -> EmailSettings:
    """Read the current SMTP configuration from the environment."""
    host = _env("SMTP_HOST")
    port = _int("SMTP_PORT", 587)
    username = _env("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD") or ""
    sender = _env("SMTP_FROM") or username
    use_tls = _bool("SMTP_USE_TLS", False)
    # STARTTLS defaults on for a plain connection and off for implicit TLS,
    # because doing both is a configuration error that some relays reject.
    starttls = _bool("SMTP_STARTTLS", not use_tls)
    return EmailSettings(
        host=host,
        port=port,
        username=username,
        password=password,
        sender=sender,
        sender_name=_env("SMTP_FROM_NAME", "RazeQA"),
        reply_to=_env("SMTP_REPLY_TO"),
        use_tls=use_tls,
        starttls=starttls,
        timeout=_float("SMTP_TIMEOUT", 15.0),
        enabled=_bool("EMAIL_NOTIFICATIONS_ENABLED", True),
        global_recipients=tuple(parse_address_list(_env("NOTIFY_EMAIL_TO"))),
        global_recipients_only=_bool("NOTIFY_EMAIL_TO_ONLY", False),
        max_attempts=max(1, _int("EMAIL_MAX_ATTEMPTS", 3)),
        retry_interval_s=max(5.0, _float("EMAIL_RETRY_INTERVAL_S", 60.0)),
        dashboard_url=_env("DASHBOARD_URL") or _env("APP_ORIGIN"),
    )


def is_email_configured() -> bool:
    """Convenience predicate for callers that do not need the whole object."""
    return load_email_settings().configured
