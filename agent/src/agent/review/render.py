"""Markdown rendering for a review report and a fix outcome.

Each lane renders on its own so it can be posted as its own message — the three
reviews are separate conversations, and collapsing them into one wall is exactly
what makes an automated review skimmable-then-ignored.
"""

from __future__ import annotations

from typing import Any

from agent.review.fixer import FixOutcome
from agent.review.models import (
    LANE_LABELS,
    LANE_TIERS,
    Lane,
    LaneReport,
    ReviewFinding,
    ReviewReport,
)

_TIER_BADGE = {
    "critical": "🟥 Critical",
    "must_fix": "🟧 Must Fix",
    "should_fix": "🟨 Should Fix",
    "suggestion": "🟦 Suggestion",
}


def _finding_block(finding: ReviewFinding, index: int) -> str:
    badge = _TIER_BADGE.get(finding.tier, finding.tier)
    lines = [f"**{index}. {badge} — {finding.title}**"]

    meta: list[str] = []
    if finding.location:
        meta.append(f"`{finding.location}`")
    if not finding.introduced:
        meta.append("_pre-existing (not introduced by this change)_")
    if finding.also_raised_by:
        others = ", ".join(LANE_LABELS[Lane(v)] for v in finding.also_raised_by)
        meta.append(f"_also raised by {others}_")
    if finding.tier_inferred:
        meta.append("_tier could not be parsed; placed on the lightest rung_")
    if meta:
        lines.append(" · ".join(meta))

    if finding.evidence:
        lines += ["", "```", finding.evidence.strip()[:1200], "```"]
    if finding.detail:
        lines += ["", finding.detail.strip()]
    if finding.remediation:
        lines += ["", f"**Remediation:** {finding.remediation.strip()}"]
    return "\n".join(lines)


def render_lane_markdown(report: LaneReport, *, repo: str = "", head_ref: str | None = None) -> str:
    """One lane's message."""
    title = LANE_LABELS[report.lane]
    header = f"### {title}"
    if repo:
        header += f" — `{repo}`"
    if head_ref:
        header += f" @ `{head_ref}`"

    if report.status == "error":
        return f"{header}\n\n⚠️ This lane could not complete: {report.error or 'unknown error'}"

    counts = report.counts_by_tier
    tally = ", ".join(f"{counts[tier.key]} {tier.label.lower()}" for tier in LANE_TIERS[report.lane])
    lines = [header, "", tally]

    if report.summary:
        lines += ["", report.summary.strip()]

    if not report.findings:
        lines += ["", "No findings."]
        return "\n".join(lines)

    lines.append("")
    for index, finding in enumerate(report.findings, start=1):
        lines += [_finding_block(finding, index), ""]
    return "\n".join(lines).rstrip()


def render_report_markdown(report: ReviewReport) -> str:
    """The full report: a ranked summary followed by the three lane messages."""
    counts = report.severity_counts
    total = sum(counts.values())
    if report.blocking:
        status = "⛔ Critical issue(s) — do not merge"
    elif counts["high"]:
        status = f"🟧 {counts['high']} must-fix finding(s), no critical issue"
    else:
        status = "✅ No must-fix findings"

    lines = [
        "## Automated review",
        "",
        f"{status} — {total} finding(s): "
        + ", ".join(f"{counts[level]} {level}" for level in ("critical", "high", "medium", "low")),
    ]
    if report.generated_at:
        lines.append("")
        lines.append(f"_Generated {report.generated_at}_")

    if report.findings:
        lines += ["", "### Ranked findings", ""]
        for index, finding in enumerate(report.ranked(), start=1):
            badge = _TIER_BADGE.get(finding.tier, finding.tier)
            where = f" — `{finding.location}`" if finding.location else ""
            inherited = "" if finding.introduced else " _(pre-existing)_"
            lines.append(
                f"{index}. {badge} · **{finding.title}**{where} — {LANE_LABELS[finding.lane]}{inherited}"
            )

    for lane_report in report.lanes:
        lines += ["", "---", "", render_lane_markdown(lane_report, repo=report.repo, head_ref=report.head_ref)]

    return "\n".join(lines)


def render_fix_markdown(outcome: FixOutcome) -> str:
    """A fix outcome as a PR-ready comment."""
    lines = [f"### On-demand fix — {outcome.title}", ""]
    if not outcome.verified:
        lines += [
            "❌ No candidate patch passed verification. Nothing is proposed for merge.",
            "",
            outcome.summary,
            "",
            "Attempt detail:",
        ]
        for attempt in outcome.attempts:
            reason = attempt.error or "; ".join(attempt.verification.reasons) or "rejected"
            lines.append(f"- attempt {attempt.attempt}: {reason}")
        return "\n".join(lines)

    winner = outcome.winner
    assert winner is not None  # for type checkers; guaranteed by `verified`
    evidence = winner.evidence
    lines += [
        "✅ A patch passed verification.",
        "",
        f"- Regression test: {', '.join(f'`{f}`' for f in evidence.test_files) or '(none)'}",
        f"- Failed before the fix: **{evidence.failed_before}**",
        f"- Passed after the fix: **{evidence.passed_after}**",
        f"- Build: **{'passed' if winner.build.ok else 'failed'}**",
        f"- Existing suite: **{'passed' if winner.suite.ok else 'failed'}**",
        f"- Critic refuted: **{winner.critic_refuted}**",
        f"- Diff size: {winner.changed_lines} changed line(s) across {len(winner.files)} file(s)",
        "",
        outcome.summary,
    ]
    if winner.verification.warnings:
        lines += ["", "Warnings:"] + [f"- {w}" for w in winner.verification.warnings]
    lines += ["", "```diff", outcome.patch.strip()[:8000], "```"]
    return "\n".join(lines)


def report_to_json(report: ReviewReport) -> dict[str, Any]:
    """Serialisable report for the API and the dashboard."""
    return {
        "repo": report.repo,
        "base_ref": report.base_ref,
        "head_ref": report.head_ref,
        "generated_at": report.generated_at,
        "blocking": report.blocking,
        "severity_counts": report.severity_counts,
        "tier_counts": report.tier_counts,
        "lanes": [
            {
                "lane": lane.lane.value,
                "label": LANE_LABELS[lane.lane],
                "status": lane.status,
                "error": lane.error,
                "summary": lane.summary,
                "duration_ms": lane.duration_ms,
                "counts": lane.counts_by_tier,
                "findings": [finding.model_dump(mode="json") for finding in lane.findings],
            }
            for lane in report.lanes
        ],
        "findings": [finding.model_dump(mode="json") for finding in report.ranked()],
    }
