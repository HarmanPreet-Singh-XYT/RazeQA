"""Per-repository and per-user email notification preferences.

Two scopes now exist, and this module is where they meet:

* **Project** — ``projects.settings.notifications``. The per-repository override,
  editable at Dashboard → Notifications → Repositories.
* **Workspace defaults** — ``notification_settings.defaults`` for the project's
  owner. Applied to every project that has not overridden a field, so a new
  repository inherits a deliberate policy instead of a hardcoded one. Editable at
  Dashboard → Notifications → Global defaults.
* **Personal** — ``notification_settings.personal`` for a user. Applies when that
  user is a resolved recipient (the project owner, or a team member who has a
  Supabase account): it lets one person opt out of an event without silencing the
  repository for everyone else. Editable at Dashboard → Notifications → My
  preferences.

Every parser tolerates anything — a hand-edited blob, an older shape, a list
where a dict was expected. A malformed preference must never be able to stop a
notification that would otherwise be useful.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agent.analyzer.severity import normalize_severity, severity_rank
from agent.email.config import is_valid_address, parse_address_list

#: The notification kinds a project or person can switch independently.
EVENTS: tuple[str, ...] = (
    "run_completed",
    "findings_alert",
    "review_completed",
    "fix_published",
)

EVENT_LABELS: dict[str, str] = {
    "run_completed": "Verification finished",
    "findings_alert": "New high-severity findings",
    "review_completed": "Code review finished",
    "fix_published": "Verified fix published",
}

DEFAULT_MIN_SEVERITY = "high"


def _all_events() -> dict[str, bool]:
    return {event: True for event in EVENTS}


def _parse_events(raw_events: Any) -> dict[str, bool]:
    events = _all_events()
    if isinstance(raw_events, dict):
        for event in EVENTS:
            if event in raw_events:
                events[event] = bool(raw_events[event])
    return events


def _parse_severity(raw: Any) -> str:
    value = str(raw or DEFAULT_MIN_SEVERITY).strip().lower()
    return value if normalize_severity(value) is not None else DEFAULT_MIN_SEVERITY


def _parse_recipients(raw: Any) -> tuple[str, ...]:
    if isinstance(raw, str):
        candidates = parse_address_list(raw)
    elif isinstance(raw, (list, tuple)):
        candidates = []
        for item in raw:
            candidates.extend(parse_address_list(str(item)))
    else:
        candidates = []
    return tuple(a for a in candidates if is_valid_address(a))


@dataclass(frozen=True)
class NotificationSettings:
    """A project's effective policy (workspace defaults already merged in)."""

    enabled: bool = True
    recipients: tuple[str, ...] = ()
    events: dict[str, bool] = field(default_factory=_all_events)
    #: Only findings at or above this level trigger ``findings_alert``.
    min_severity: str = DEFAULT_MIN_SEVERITY

    def wants(self, kind: str) -> bool:
        if not self.enabled:
            return False
        return bool(self.events.get(kind, True))

    def allows_severity(self, severity: Any) -> bool:
        """Whether a finding at ``severity`` clears the configured floor."""
        normalized = normalize_severity(severity)
        if normalized is None:
            # An unrated finding is not evidence of high impact, but silently
            # dropping it would hide a real problem; report it at the floor.
            return True
        floor = normalize_severity(self.min_severity) or normalize_severity(DEFAULT_MIN_SEVERITY)
        return severity_rank(normalized) <= severity_rank(floor)

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "recipients": list(self.recipients),
            "events": dict(self.events),
            "min_severity": self.min_severity,
        }


@dataclass(frozen=True)
class PersonalNotificationSettings:
    """One person's own subscription, applied when they are a recipient."""

    enabled: bool = True
    events: dict[str, bool] = field(default_factory=_all_events)
    min_severity: str = DEFAULT_MIN_SEVERITY

    def wants(self, kind: str) -> bool:
        if not self.enabled:
            return False
        return bool(self.events.get(kind, True))

    def allows_severity(self, severity: Any) -> bool:
        normalized = normalize_severity(severity)
        if normalized is None:
            return True
        floor = normalize_severity(self.min_severity) or normalize_severity(DEFAULT_MIN_SEVERITY)
        return severity_rank(normalized) <= severity_rank(floor)

    def to_dict(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "events": dict(self.events),
            "min_severity": self.min_severity,
        }


DEFAULT_NOTIFICATIONS = NotificationSettings()
DEFAULT_PERSONAL_NOTIFICATIONS = PersonalNotificationSettings()


def _parse_notifications_blob(raw: dict[str, Any]) -> NotificationSettings:
    return NotificationSettings(
        enabled=bool(raw.get("enabled", True)),
        recipients=_parse_recipients(raw.get("recipients")),
        events=_parse_events(raw.get("events")),
        min_severity=_parse_severity(raw.get("min_severity")),
    )


def parse_notifications(settings: Any) -> NotificationSettings:
    """Read a project's own preference out of its settings blob."""
    if not isinstance(settings, dict):
        return DEFAULT_NOTIFICATIONS
    raw = settings.get("notifications")
    if not isinstance(raw, dict):
        return DEFAULT_NOTIFICATIONS
    return _parse_notifications_blob(raw)


def parse_personal_settings(blob: Any) -> PersonalNotificationSettings:
    """Read a user's personal subscription blob. Absent means "everything on"."""
    if not isinstance(blob, dict) or not blob:
        return DEFAULT_PERSONAL_NOTIFICATIONS
    return PersonalNotificationSettings(
        enabled=bool(blob.get("enabled", True)),
        events=_parse_events(blob.get("events")),
        min_severity=_parse_severity(blob.get("min_severity")),
    )


def merge_notification_dicts(base: Any, override: Any) -> dict[str, Any]:
    """Deep-merge two ``notifications`` blobs; ``override`` wins per field.

    Only plain objects merge — arrays and scalars replace wholesale, so an
    explicit ``recipients: []`` clears rather than concatenating.
    """
    if not isinstance(base, dict):
        return dict(override) if isinstance(override, dict) else {}
    if not isinstance(override, dict):
        return dict(base)
    merged: dict[str, Any] = dict(base)
    for key, value in override.items():
        current = merged.get(key)
        if isinstance(value, dict) and isinstance(current, dict):
            merged[key] = merge_notification_dicts(current, value)
        else:
            merged[key] = value
    return merged


def effective_notifications(defaults: Any, project_settings: Any) -> NotificationSettings:
    """The policy that actually applies: workspace defaults under project overrides.

    ``defaults`` is the raw ``notification_settings.defaults`` blob; a project
    that has saved nothing inherits it entirely. A project that saved a field
    wins for that field only, so adding a new field to the defaults later still
    reaches existing projects.
    """
    default_blob: dict[str, Any] = {}
    if isinstance(defaults, dict):
        candidate = defaults.get("notifications", defaults)
        if isinstance(candidate, dict):
            default_blob = candidate
    project_blob: dict[str, Any] = {}
    if isinstance(project_settings, dict) and isinstance(
        project_settings.get("notifications"), dict
    ):
        project_blob = project_settings["notifications"]
    return _parse_notifications_blob(merge_notification_dicts(default_blob, project_blob))


def filter_findings(
    findings: list[dict[str, Any]], policy: NotificationSettings
) -> list[dict[str, Any]]:
    """The subset of ``findings`` this policy would alert on, most severe first.

    Deduplicated by fingerprint so the same issue observed twice in one run is
    one line in the email, exactly as it is one row in the dashboard.
    """
    seen: set[str] = set()
    selected: list[dict[str, Any]] = []
    for finding in findings or []:
        if not isinstance(finding, dict):
            continue
        if not policy.allows_severity(finding.get("severity")):
            continue
        key = str(finding.get("fingerprint") or finding.get("title") or id(finding))
        if key in seen:
            continue
        seen.add(key)
        selected.append(finding)
    selected.sort(key=lambda f: severity_rank(f.get("severity")))
    return selected
