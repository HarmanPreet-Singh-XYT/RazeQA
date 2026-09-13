"""Domain model for the three-lane review.

A PR is reviewed through three independent lenses — **compliance**,
**security** and **code review** — because they ask different questions,
fail in different ways, and are trusted to different degrees. Each lane keeps
its own severity ladder (the ladders genuinely differ: compliance has a
``critical`` that security does not, and only the lighter two lanes carry
``suggestion``), and every lane maps onto the engine's single canonical
:class:`~agent.analyzer.severity.Severity` so findings from different lanes can
be ranked against each other in one list.

The canonical severity is *derived from the tier*, never taken from the model's
own adjective. A model that labels a missing null check ``critical`` has not
changed the ladder; it has picked the top rung, and it is ranked as such.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from agent.analyzer.severity import Severity, severity_counts, severity_rank


class Lane(str, Enum):
    """The three reviewers. Each one is a separate model call and a separate
    message in the PR conversation — never merged into one omnibus prompt."""

    COMPLIANCE = "compliance"
    SECURITY = "security"
    CODE_REVIEW = "code_review"


LANE_LABELS: dict[Lane, str] = {
    Lane.COMPLIANCE: "Compliance Review",
    Lane.SECURITY: "Security Review",
    Lane.CODE_REVIEW: "Code Review",
}


@dataclass(frozen=True)
class LaneTier:
    """One rung of a lane's ladder."""

    key: str
    label: str
    severity: Severity
    description: str


#: The ladder each lane reports against, most severe first. The descriptions are
#: the rubric: a finding is placed by matching its failure mode, not its tone.
LANE_TIERS: dict[Lane, tuple[LaneTier, ...]] = {
    Lane.COMPLIANCE: (
        LaneTier(
            key="critical",
            label="Critical",
            severity=Severity.CRITICAL,
            description=(
                "A legal, licensing or regulatory obligation is violated by this change: "
                "code shipped under an incompatible licence, personal data exported without "
                "a lawful basis, or a documented retention/deletion guarantee broken."
            ),
        ),
        LaneTier(
            key="must_fix",
            label="Must Fix",
            severity=Severity.HIGH,
            description=(
                "A stated policy is breached the way an auditor would flag it: a secret "
                "committed to source, unlicensed third-party code, personal data written to "
                "logs, or consent not captured where it is required."
            ),
        ),
        LaneTier(
            key="should_fix",
            label="Should Fix",
            severity=Severity.MEDIUM,
            description=(
                "Compliance hygiene that becomes a finding at the next review: an "
                "undocumented data flow, a missing retention annotation, or a missing "
                "licence header on a newly added derived file."
            ),
        ),
    ),
    Lane.SECURITY: (
        LaneTier(
            key="must_fix",
            label="Must Fix",
            severity=Severity.HIGH,
            description=(
                "An exploitable weakness reachable from the changed code: injection, broken "
                "authorisation or authentication, unsafe deserialisation, secret exposure, "
                "SSRF, path traversal, or unsafe cryptography."
            ),
        ),
        LaneTier(
            key="should_fix",
            label="Should Fix",
            severity=Severity.MEDIUM,
            description=(
                "A weakness that needs a precondition or is defence-in-depth: a missing rate "
                "limit, verbose error leakage, permissive CORS on a sensitive route, or "
                "missing output encoding on a non-default path."
            ),
        ),
        LaneTier(
            key="suggestion",
            label="Suggestion",
            severity=Severity.LOW,
            description=(
                "Hardening or hygiene with no demonstrated exploit path: pinning a "
                "dependency, tightening a regex, or documenting a security-relevant "
                "assumption."
            ),
        ),
    ),
    Lane.CODE_REVIEW: (
        LaneTier(
            key="must_fix",
            label="Must Fix",
            severity=Severity.HIGH,
            description=(
                "The change is incorrect or will fail in production: a logic error, an "
                "off-by-one, an unhandled error path on a real input, a broken contract, or "
                "data loss."
            ),
        ),
        LaneTier(
            key="should_fix",
            label="Should Fix",
            severity=Severity.MEDIUM,
            description=(
                "Correct but materially flawed: a new branch with no test, duplicated logic "
                "that will drift, an N+1 query on a hot path, or unclear ownership of state."
            ),
        ),
        LaneTier(
            key="suggestion",
            label="Suggestion",
            severity=Severity.LOW,
            description=(
                "Readability, naming, structure, or a simplification. Never blocks a merge."
            ),
        ),
    ),
}

#: Aliases the models actually emit, normalised to canonical tier keys per lane.
_TIER_ALIASES: dict[Lane, dict[str, str]] = {
    Lane.COMPLIANCE: {
        "critical": "critical",
        "crit": "critical",
        "blocker": "critical",
        "p0": "critical",
        "must_fix": "must_fix",
        "mustfix": "must_fix",
        "high": "must_fix",
        "major": "must_fix",
        "required": "must_fix",
        "should_fix": "should_fix",
        "shouldfix": "should_fix",
        "medium": "should_fix",
        "moderate": "should_fix",
    },
    Lane.SECURITY: {
        "must_fix": "must_fix",
        "mustfix": "must_fix",
        "critical": "must_fix",
        "crit": "must_fix",
        "blocker": "must_fix",
        "p0": "must_fix",
        "high": "must_fix",
        "major": "must_fix",
        "should_fix": "should_fix",
        "shouldfix": "should_fix",
        "medium": "should_fix",
        "moderate": "should_fix",
        "suggestion": "suggestion",
        "suggestions": "suggestion",
        "suggest": "suggestion",
        "low": "suggestion",
        "minor": "suggestion",
        "nit": "suggestion",
    },
    Lane.CODE_REVIEW: {
        "must_fix": "must_fix",
        "mustfix": "must_fix",
        "critical": "must_fix",
        "crit": "must_fix",
        "blocker": "must_fix",
        "p0": "must_fix",
        "high": "must_fix",
        "major": "must_fix",
        "should_fix": "should_fix",
        "shouldfix": "should_fix",
        "medium": "should_fix",
        "moderate": "should_fix",
        "suggestion": "suggestion",
        "suggestions": "suggestion",
        "suggest": "suggestion",
        "low": "suggestion",
        "minor": "suggestion",
        "nit": "suggestion",
    },
}

_TIER_BY_KEY: dict[Lane, dict[str, LaneTier]] = {
    lane: {tier.key: tier for tier in tiers} for lane, tiers in LANE_TIERS.items()
}


def resolve_tier(lane: Lane, raw: str | None) -> tuple[LaneTier, bool]:
    """Coerce a model-supplied tier onto ``lane``'s ladder.

    Returns ``(tier, inferred)``. ``inferred`` is True when the value was not a
    recognised rung and was placed on the lightest rung of the lane — the
    finding is kept (dropping it would lose a real observation) but it is marked
    so the report can say the lane did not rank it, rather than presenting a
    guess as the model's judgement.
    """
    ladder = LANE_TIERS[lane]
    lightest = ladder[-1]
    if raw is None:
        return lightest, True
    token = re.sub(r"[\s\-]+", "_", str(raw).strip().lower())
    canonical = _TIER_ALIASES[lane].get(token)
    if canonical:
        return _TIER_BY_KEY[lane][canonical], False
    return lightest, True


def fingerprint_finding(lane: Lane | str, path: str | None, title: str, detail: str = "") -> str:
    """Stable identity for a finding: same issue, same fingerprint, any run.

    Line numbers are deliberately excluded — they move whenever anything above
    them changes, and a finding that reappears at a new line is the *same*
    finding. Digits are collapsed for the same reason the browser-side findings
    do it: "expected 3 items, got 2" and "expected 5 items, got 1" are one
    recurring defect, not two.
    """
    lane_value = lane.value if isinstance(lane, Lane) else str(lane)
    text = f"{title or ''} {detail or ''}".lower()
    text = re.sub(r"\d+", "#", text)
    text = re.sub(r"https?://\S+", "<url>", text)
    text = re.sub(r"\s+", " ", text).strip()[:240]
    digest = hashlib.sha256(f"{lane_value}|{path or ''}|{text}".encode()).hexdigest()
    return digest[:32]


class ReviewFinding(BaseModel):
    """One issue raised by one lane."""

    lane: Lane
    tier: str
    severity: Severity = Severity.LOW
    title: str
    detail: str = ""
    file: str | None = None
    line: int | None = None
    evidence: str = ""
    remediation: str = ""
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    #: True when the finding is on a line *this diff* added. A finding in code
    #: the PR merely walked past is inherited, and must not read as "you broke
    #: this".
    introduced: bool = True
    #: True when the model's tier string was unrecognised and was placed on the
    #: lane's lightest rung.
    tier_inferred: bool = False
    fingerprint: str = ""
    #: Other lanes that raised an issue at the same ``file:line``. The lanes stay
    #: separate messages, but a reader deciding what to act on first deserves to
    #: know that two of them independently landed on the same spot.
    also_raised_by: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _canonicalise(self) -> ReviewFinding:
        tier, inferred = resolve_tier(self.lane, self.tier)
        self.tier = tier.key
        self.severity = tier.severity
        self.tier_inferred = inferred
        if not self.fingerprint:
            self.fingerprint = fingerprint_finding(self.lane, self.file, self.title, self.detail)
        return self

    @property
    def tier_label(self) -> str:
        return _TIER_BY_KEY[self.lane][self.tier].label

    @property
    def location(self) -> str:
        if self.file and self.line:
            return f"{self.file}:{self.line}"
        return self.file or ""

    @property
    def has_evidence(self) -> bool:
        return bool(self.evidence.strip())


class LaneReport(BaseModel):
    """One lane's complete output for one review."""

    lane: Lane
    status: str = "ok"  # "ok" | "error"
    model: str | None = None
    findings: list[ReviewFinding] = Field(default_factory=list)
    error: str | None = None
    duration_ms: float = 0.0
    summary: str = ""

    @property
    def counts_by_tier(self) -> dict[str, int]:
        counts = {tier.key: 0 for tier in LANE_TIERS[self.lane]}
        for finding in self.findings:
            counts[finding.tier] = counts.get(finding.tier, 0) + 1
        return counts


class ReviewReport(BaseModel):
    """The merged, ranked result of running every lane over one diff."""

    repo: str = "default"
    base_ref: str | None = None
    head_ref: str | None = None
    lanes: list[LaneReport] = Field(default_factory=list)
    findings: list[ReviewFinding] = Field(default_factory=list)
    generated_at: str = ""

    @property
    def severity_counts(self) -> dict[str, int]:
        return severity_counts(f.severity for f in self.findings)

    @property
    def tier_counts(self) -> dict[str, int]:
        """Per-lane tier tallies, keyed ``"<lane>/<tier>"``."""
        counts: dict[str, int] = {}
        for lane_report in self.lanes:
            for tier, value in lane_report.counts_by_tier.items():
                counts[f"{lane_report.lane.value}/{tier}"] = value
        return counts

    @property
    def blocking(self) -> bool:
        """Whether the review should hold the merge.

        Only the top canonical level blocks. Everything else is advisory by
        design: an LLM review is a high-recall triage signal, and treating a
        sampled opinion on a medium issue as a hard gate is how a review tool
        teaches people to bypass it.
        """
        return any(f.severity is Severity.CRITICAL for f in self.findings)

    @property
    def introduced_findings(self) -> list[ReviewFinding]:
        return [f for f in self.findings if f.introduced]

    def ranked(self) -> list[ReviewFinding]:
        return sorted(
            self.findings,
            key=lambda f: (severity_rank(f.severity), 0 if f.introduced else 1, f.lane.value, f.file or ""),
        )


@dataclass
class LaneContext:
    """Everything a lane needs to review one change."""

    repo: str
    diff: str
    changed_files: list[str]
    base_ref: str | None = None
    head_ref: str | None = None
    title: str = ""
    description: str = ""
    #: Free-form repository conventions (licence, data-handling policy) that the
    #: compliance lane should hold the change against.
    conventions: str = ""
