"""Resolve who should receive a project's notifications.

Recipients come from four sources, in this order, and the union is used:

1. **Explicit project recipients** — ``settings.notifications.recipients``. The
   dashboard's escape hatch for "these three people, regardless of seats".
2. **Team members** — ``team_members`` rows for the GitHub organization that owns
   the project's installation. This is the primary source: the people the
   organization says are on the team, managed at Dashboard → Notifications → Team.
3. **The project owner** — the Supabase user who imported the repository. A
   single-developer install has no ``team_members`` rows at all, and without
   this fallback notifications would silently go nowhere.
4. **Deployment-wide recipients** — ``NOTIFY_EMAIL_TO``. A shared inbox, and the
   way to prove delivery from a fresh deployment before anyone has been added
   to ``team_members``.

Resolution returns :class:`RecipientTarget` objects rather than bare addresses,
because a recipient may be a known Supabase user with a **personal** preference
that has to be honoured (see ``agent.projects.notifications``). Addresses added
explicitly or via ``NOTIFY_EMAIL_TO`` carry no ``user_id`` and are always
included.

Every address is validated and de-duplicated case-insensitively. A failure to
resolve any *additional* source is logged and does not remove the addresses
already found — a missing ``team_members`` table must not stop the owner from
being told their build broke.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from agent.email.config import EmailSettings, is_valid_address

logger = logging.getLogger("agent.email.recipients")

#: Where a recipient came from, for display and precedence.
SOURCE_EXPLICIT = "explicit"
SOURCE_TEAM = "team"
SOURCE_OWNER = "owner"
SOURCE_GLOBAL = "global"


@dataclass(frozen=True)
class RecipientTarget:
    """One resolved recipient, with their Supabase identity when known."""

    email: str
    user_id: str | None = None
    source: str = SOURCE_EXPLICIT


def _admin_client() -> Any | None:
    try:
        from agent.db.supabase import get_supabase_client

        return get_supabase_client()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Supabase unavailable for recipient resolution: %s", exc)
        return None


def find_project(client: Any, repo_full_name: str) -> dict[str, Any] | None:
    """The project row for a repository, or ``None`` when it is not imported."""
    if not client or not repo_full_name:
        return None
    try:
        res = (
            client.table("projects")
            .select("id, user_id, installation_id, repo_full_name, settings")
            .eq("repo_full_name", repo_full_name)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not resolve project %s: %s", repo_full_name, exc)
        return None


def org_login_for_project(client: Any, project: dict[str, Any] | None) -> str | None:
    """The GitHub org/account login behind a project's installation."""
    if not client or not project:
        return None
    installation_id = project.get("installation_id")
    if installation_id is None:
        return None
    try:
        res = (
            client.table("installations")
            .select("account_login")
            .eq("installation_id", installation_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        login = rows[0].get("account_login") if rows else None
        return str(login).strip() or None
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not resolve installation %s: %s", installation_id, exc)
        return None


def team_member_targets(client: Any, org_login: str | None) -> list[RecipientTarget]:
    """Team members recorded for an organization, with their user ids."""
    if not client or not org_login:
        return []
    try:
        res = (
            client.table("team_members")
            .select("email, user_id")
            .eq("org_login", org_login)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not read team members for %s: %s", org_login, exc)
        return []
    targets: list[RecipientTarget] = []
    for row in res.data or []:
        email = str(row.get("email") or "").strip()
        if not email:
            continue
        user_id = row.get("user_id")
        targets.append(
            RecipientTarget(
                email=email,
                user_id=str(user_id) if user_id else None,
                source=SOURCE_TEAM,
            )
        )
    return targets


def owner_target(client: Any, user_id: Any) -> RecipientTarget | None:
    """The Supabase user who owns a project, as a recipient target."""
    if not client or not user_id:
        return None
    try:
        result = client.auth.admin.get_user_by_id(str(user_id))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not resolve owner %s: %s", user_id, exc)
        return None
    user = getattr(result, "user", None) or (
        result.get("user") if isinstance(result, dict) else None
    )
    email = getattr(user, "email", None) or (
        user.get("email") if isinstance(user, dict) else None
    )
    if not email:
        return None
    return RecipientTarget(email=str(email).strip(), user_id=str(user_id), source=SOURCE_OWNER)


def _dedupe(targets: list[RecipientTarget]) -> list[RecipientTarget]:
    """De-duplicate by address, keeping the first (highest-precedence) source.

    A person who is both an explicit recipient and a team member is one target;
    the explicit occurrence wins, which is also the one with no personal
    preference attached — an explicit address is a deliberate choice by the
    project, so it is not silently dropped by a personal opt-out.
    """
    seen: set[str] = set()
    out: list[RecipientTarget] = []
    for target in targets:
        address = (target.email or "").strip()
        if not is_valid_address(address):
            if address:
                logger.warning("Ignoring malformed notification recipient: %r", address)
            continue
        key = address.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            RecipientTarget(email=address, user_id=target.user_id, source=target.source)
        )
    return out


def resolve_recipient_targets(
    *,
    repo_full_name: str | None,
    explicit: list[str] | tuple[str, ...] | None = None,
    settings: EmailSettings,
    include_owner: bool = True,
    include_team: bool = True,
    project: dict[str, Any] | None = None,
) -> list[RecipientTarget]:
    """The full recipient list for a repository's notification.

    ``settings.global_recipients_only`` short-circuits everything else, which is
    the staging-safety switch: mail can be exercised end to end without reaching
    a real user.
    """
    if settings.global_recipients_only:
        return _dedupe(
            [RecipientTarget(email=a, source=SOURCE_GLOBAL) for a in settings.global_recipients]
            + [RecipientTarget(email=a, source=SOURCE_EXPLICIT) for a in (explicit or [])]
        )

    collected: list[RecipientTarget] = [
        RecipientTarget(email=a, source=SOURCE_EXPLICIT) for a in (explicit or [])
    ]
    client = _admin_client()

    if include_team or include_owner:
        project = project or find_project(client, repo_full_name or "")
        if include_team:
            collected.extend(team_member_targets(client, org_login_for_project(client, project)))
        if include_owner and project:
            target = owner_target(client, project.get("user_id"))
            if target:
                collected.append(target)

    collected.extend(
        RecipientTarget(email=a, source=SOURCE_GLOBAL) for a in settings.global_recipients
    )
    return _dedupe(collected)


def resolve_recipients(
    *,
    repo_full_name: str | None,
    explicit: list[str] | tuple[str, ...] | None = None,
    settings: EmailSettings,
    include_owner: bool = True,
    include_team: bool = True,
    project: dict[str, Any] | None = None,
) -> list[str]:
    """Backwards-compatible address-only view of :func:`resolve_recipient_targets`."""
    return [
        target.email
        for target in resolve_recipient_targets(
            repo_full_name=repo_full_name,
            explicit=explicit,
            settings=settings,
            include_owner=include_owner,
            include_team=include_team,
            project=project,
        )
    ]
