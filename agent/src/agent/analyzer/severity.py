"""The single severity taxonomy shared by the engine, the API and the dashboard.

Four actionable levels, ordered by how much they should hold up a merge:

``critical``  blocks core functionality or risks data integrity
``high``      breaks an important feature or badly degrades the experience
``medium``    noticeable, but the user can still accomplish the goal
``low``       cosmetic or rare-condition edge case

The engine historically emitted free-form strings in different places
(``"Critical"``, ``"High"``, ``"warning"``, ``"optimization"``). Every finding
now funnels through :func:`normalize_severity`, so a result cannot be ranked one
way in the API and another way in the UI, and an unknown string can never leak
into the dashboard as if it were a real level.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Iterable


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


#: Lower rank == more severe. Used for sorting and for "highest wins".
RANK: dict[Severity, int] = {
    Severity.CRITICAL: 0,
    Severity.HIGH: 1,
    Severity.MEDIUM: 2,
    Severity.LOW: 3,
}

LABELS: dict[Severity, str] = {
    Severity.CRITICAL: "Critical",
    Severity.HIGH: "High",
    Severity.MEDIUM: "Medium",
    Severity.LOW: "Low",
}

#: Human strings that have historically meant a given level. Non-security
#: "warning"/"optimization" style labels from the insights module are mapped
#: deliberately: a warning is advisory (medium), an optimization is cosmetic (low).
_ALIASES: dict[str, Severity] = {
    "critical": Severity.CRITICAL,
    "blocker": Severity.CRITICAL,
    "blocking": Severity.CRITICAL,
    "sev1": Severity.CRITICAL,
    "sev0": Severity.CRITICAL,
    "p0": Severity.CRITICAL,
    "high": Severity.HIGH,
    "major": Severity.HIGH,
    "sev2": Severity.HIGH,
    "p1": Severity.HIGH,
    "warning": Severity.MEDIUM,
    "warn": Severity.MEDIUM,
    "medium": Severity.MEDIUM,
    "moderate": Severity.MEDIUM,
    "sev3": Severity.MEDIUM,
    "p2": Severity.MEDIUM,
    "low": Severity.LOW,
    "minor": Severity.LOW,
    "info": Severity.LOW,
    "informational": Severity.LOW,
    "optimization": Severity.LOW,
    "cosmetic": Severity.LOW,
    "sev4": Severity.LOW,
    "p3": Severity.LOW,
}


def normalize_severity(value: Any, default: Severity | None = None) -> Severity | None:
    """Coerce any severity-ish value to a :class:`Severity`, or ``default``.

    ``None`` and unrecognised strings return ``default`` rather than guessing —
    an unknown label is not evidence of any particular impact.
    """
    if isinstance(value, Severity):
        return value
    if value is None:
        return default
    text = str(value).strip().lower()
    if not text:
        return default
    if text in _ALIASES:
        return _ALIASES[text]
    # Tolerate prefixes such as "severity: high" or "level=critical".
    for token in text.replace("=", " ").replace(":", " ").split():
        if token in _ALIASES:
            return _ALIASES[token]
    return default


def severity_from_risk(risk_tag: Any) -> Severity:
    """Map the diff analyzer's risk tag onto the four-level taxonomy.

    Unknown or missing risk is treated as ``medium`` so an unanalysed change is
    never presented as low risk.
    """
    return normalize_severity(risk_tag, Severity.MEDIUM) or Severity.MEDIUM


def severity_rank(value: Any) -> int:
    """Sort key: lower is more severe. Unknown values sort last."""
    normalized = normalize_severity(value)
    if normalized is None:
        return len(RANK)
    return RANK[normalized]


def highest_severity(values: Iterable[Any]) -> Severity | None:
    """The most severe recognised value, or ``None`` when there are none."""
    best: Severity | None = None
    for value in values:
        normalized = normalize_severity(value)
        if normalized is None:
            continue
        if best is None or RANK[normalized] < RANK[best]:
            best = normalized
    return best


def severity_label(value: Any) -> str:
    normalized = normalize_severity(value)
    return LABELS[normalized] if normalized else "Unrated"


def severity_counts(values: Iterable[Any]) -> dict[str, int]:
    """Counts per level, always with all four keys present (zeros included)."""
    counts = {level.value: 0 for level in Severity}
    for value in values:
        normalized = normalize_severity(value)
        if normalized is not None:
            counts[normalized.value] += 1
    return counts
