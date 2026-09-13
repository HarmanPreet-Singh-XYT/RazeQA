"""The three-lane review engine.

Runs the compliance, security and code-review lanes over one diff and merges
their output into a single ranked report. Three properties matter more than the
prompting:

* **Lanes fail independently.** One lane erroring, timing out or emitting
  unparseable prose must not take the review down — the report records the lane
  as failed and keeps the other two.
* **Model output is data, not truth.** Every field is coerced, every tier is
  mapped onto the lane's ladder, and anything that cannot be anchored to a file
  or a quoted snippet is dropped rather than shown to a human as a finding.
* **Introduced != inherited.** A finding on an untouched line of a touched file
  is marked as pre-existing, so the report never blames an author for code they
  walked past.
"""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from agent.analyzer.severity import severity_rank
from agent.review.diff import DiffIndex, parse_unified_diff
from agent.review.models import (
    LANE_TIERS,
    Lane,
    LaneContext,
    LaneReport,
    ReviewFinding,
    ReviewReport,
)
from agent.review.prompts import build_lane_system_prompt, build_lane_user_prompt

logger = logging.getLogger("agent.review.engine")

#: ``(lane, system_prompt, user_prompt) -> raw model text``
LaneInvoker = Callable[[Lane, str, str], str]


class _RawFinding(BaseModel):
    """Lenient shape for one model-emitted finding.

    Field aliases are tolerated because models drift between ``file``/``path``
    and ``tier``/``severity``/``level``; normalising here keeps the mapping
    rules in one place instead of scattered through the parser.

    Every field is typed ``Any`` on purpose. A model that emits
    ``"line": "not-a-number"`` has produced one unusable field, not an unusable
    finding — strict typing here would discard a real observation over its
    weakest attribute. Coercion happens in :func:`parse_lane_output`.
    """

    model_config = ConfigDict(extra="ignore")

    tier: Any = None
    severity: Any = None
    level: Any = None
    priority: Any = None
    title: Any = None
    summary: Any = None
    file: Any = None
    path: Any = None
    filename: Any = None
    line: Any = None
    line_number: Any = None
    evidence: Any = None
    snippet: Any = None
    quote: Any = None
    detail: Any = None
    description: Any = None
    impact: Any = None
    remediation: Any = None
    fix: Any = None
    suggestion: Any = None
    confidence: Any = None


class _LaneOutput(BaseModel):
    summary: str = ""
    findings: list[_RawFinding] = []


def _first(*values: Any) -> Any:
    """The first value that is neither None nor an empty/whitespace string."""
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _agent_result_text(result: Any) -> str:
    """Best-effort text extraction from a Strands agent result."""
    if isinstance(result, str):
        return result
    message = getattr(result, "message", None)
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [c.get("text", "") for c in content if isinstance(c, dict)]
            joined = "".join(parts).strip()
            if joined:
                return joined
    for attr in ("content", "text", "output", "result"):
        value = getattr(result, attr, None)
        if isinstance(value, str) and value.strip():
            return value
    return str(result)


def default_lane_invoker(lane: Lane, system_prompt: str, user_prompt: str) -> str:
    """Invoke a lane with the repository's role-routed code-reasoning model.

    Prefers the SDK's structured output so the reply is schema-shaped, and
    falls back to free text (which the parser handles anyway) when the provider
    or model does not support it.
    """
    from agent.models.factory import ModelRole, create_strands_agent

    agent = create_strands_agent(
        role=ModelRole.CODE_REASONING,
        system_prompt=system_prompt,
        max_tokens=4000,
    )
    try:
        parsed = agent.structured_output(_LaneOutput, user_prompt)
        if isinstance(parsed, _LaneOutput):
            return parsed.model_dump_json()
        return json.dumps(parsed, default=str)
    except Exception as exc:  # noqa: BLE001 - any failure falls back to text
        logger.debug("Structured output unavailable for lane %s (%s); using text.", lane.value, exc)
    return _agent_result_text(agent(user_prompt))


def extract_json(raw: str) -> Any | None:
    """Pull a JSON value out of a model reply that may be wrapped in prose.

    Models reliably wrap JSON in a markdown fence or preface it with a sentence
    even when told not to; both are recovered here rather than being treated as
    a lane failure.
    """
    if not raw or not raw.strip():
        return None
    text = raw.strip()

    fence = re.search(r"```(?:json)?\s*(.+?)```", text, re.DOTALL | re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()

    try:
        return json.loads(text)
    except (ValueError, TypeError):
        pass

    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except (ValueError, TypeError):
                continue
    return None


def parse_lane_output(raw: str, lane: Lane, max_findings: int = 10) -> tuple[list[ReviewFinding], str]:
    """Turn one lane's raw reply into findings and a summary.

    A finding is dropped when it has no title, or when it can be anchored
    neither to a file nor to a quoted snippet — an unanchored claim is exactly
    the kind of noise that makes a review tool ignorable.
    """
    data = extract_json(raw)
    if data is None:
        return [], ""

    if isinstance(data, list):
        raw_findings: list[Any] = data
        summary = ""
    elif isinstance(data, dict):
        raw_findings = _first(data.get("findings"), data.get("issues"), data.get("results")) or []
        summary = str(_first(data.get("summary"), data.get("overview"), "") or "")
    else:
        return [], ""

    if not isinstance(raw_findings, list):
        return [], summary

    findings: list[ReviewFinding] = []
    for item in raw_findings:
        if not isinstance(item, dict):
            continue
        try:
            parsed = _RawFinding.model_validate(item)
        except Exception as exc:  # noqa: BLE001 - malformed entry is skipped, not fatal
            logger.debug("Skipping unparseable finding on lane %s: %s", lane.value, exc)
            continue

        title = _first(parsed.title, parsed.summary)
        path = _first(parsed.file, parsed.path, parsed.filename)
        evidence = _first(parsed.evidence, parsed.snippet, parsed.quote) or ""
        if not title or not (path or str(evidence).strip()):
            continue

        line = _first(parsed.line, parsed.line_number)
        try:
            line = int(line) if line is not None else None
        except (TypeError, ValueError):
            line = None

        confidence = parsed.confidence
        if not isinstance(confidence, (int, float)):
            confidence = 0.5
        confidence = min(1.0, max(0.0, float(confidence)))

        try:
            findings.append(
                ReviewFinding(
                    lane=lane,
                    tier=str(_first(parsed.tier, parsed.severity, parsed.level, parsed.priority) or ""),
                    title=str(title).strip(),
                    detail=str(_first(parsed.detail, parsed.description, parsed.impact, "") or ""),
                    file=str(path).strip() if path else None,
                    line=line,
                    evidence=str(evidence),
                    remediation=str(_first(parsed.remediation, parsed.fix, parsed.suggestion, "") or ""),
                    confidence=confidence,
                )
            )
        except Exception as exc:  # noqa: BLE001 - one bad finding must not lose the lane
            logger.debug("Dropping malformed finding on lane %s: %s", lane.value, exc)

    return findings[:max_findings], summary


def dedupe_findings(findings: list[ReviewFinding]) -> list[ReviewFinding]:
    """Collapse repeat reports of the same issue, keeping the most severe.

    The fingerprint deliberately ignores line numbers, so a model that reports
    the same defect twice under two phrasings collapses to one entry.
    """
    by_fingerprint: dict[str, ReviewFinding] = {}
    for finding in findings:
        existing = by_fingerprint.get(finding.fingerprint)
        if existing is None:
            by_fingerprint[finding.fingerprint] = finding
            continue
        if severity_rank(finding.severity) < severity_rank(existing.severity):
            # Keep the more severe copy, but preserve the better evidence anchor.
            if not finding.evidence and existing.evidence:
                finding.evidence = existing.evidence
            by_fingerprint[finding.fingerprint] = finding
    return list(by_fingerprint.values())


class ReviewEngine:
    """Runs the three lanes and merges them into one :class:`ReviewReport`."""

    def __init__(
        self,
        invoker: LaneInvoker | None = None,
        *,
        max_findings_per_lane: int = 10,
        max_workers: int = 3,
    ) -> None:
        self.invoker = invoker or default_lane_invoker
        self.max_findings_per_lane = max_findings_per_lane
        self.max_workers = max(1, max_workers)

    def review(
        self,
        diff: str,
        *,
        repo: str = "default",
        base_ref: str | None = None,
        head_ref: str | None = None,
        title: str = "",
        description: str = "",
        conventions: str = "",
        changed_files: list[str] | None = None,
        lanes: list[Lane] | None = None,
        index: DiffIndex | None = None,
    ) -> ReviewReport:
        """Review ``diff`` through every requested lane (default: all three)."""
        index = index if index is not None else parse_unified_diff(diff)
        selected = lanes or list(LANE_TIERS)
        files = changed_files if changed_files is not None else index.paths

        ctx = LaneContext(
            repo=repo,
            diff=diff,
            changed_files=files,
            base_ref=base_ref,
            head_ref=head_ref,
            title=title,
            description=description,
            conventions=conventions,
        )

        reports = self._run_lanes(selected, ctx)
        findings = dedupe_findings([f for report in reports for f in report.findings])

        for finding in findings:
            finding.introduced = index.introduces(finding.file, finding.line)

        _annotate_cross_lane(findings)

        return ReviewReport(
            repo=repo,
            base_ref=base_ref,
            head_ref=head_ref,
            lanes=reports,
            findings=findings,
            generated_at=datetime.now(UTC).isoformat(),
        )

    def _run_lanes(self, lanes: list[Lane], ctx: LaneContext) -> list[LaneReport]:
        """Run the lanes concurrently, preserving the requested order."""
        if not lanes:
            return []
        workers = min(self.max_workers, len(lanes))
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="review-lane") as pool:
            futures = {lane: pool.submit(self._run_lane, lane, ctx) for lane in lanes}
            return [futures[lane].result() for lane in lanes]

    def _run_lane(self, lane: Lane, ctx: LaneContext) -> LaneReport:
        started = time.monotonic()
        try:
            raw = self.invoker(
                lane,
                build_lane_system_prompt(lane),
                build_lane_user_prompt(lane, ctx, self.max_findings_per_lane),
            )
        except Exception as exc:  # noqa: BLE001 - a lane failure is contained
            logger.warning("Review lane %s failed: %s", lane.value, exc)
            return LaneReport(
                lane=lane,
                status="error",
                error=f"{type(exc).__name__}: {exc}",
                duration_ms=(time.monotonic() - started) * 1000.0,
            )

        findings, summary = parse_lane_output(raw, lane, self.max_findings_per_lane)
        return LaneReport(
            lane=lane,
            status="ok",
            findings=findings,
            summary=summary,
            duration_ms=(time.monotonic() - started) * 1000.0,
        )


def _annotate_cross_lane(findings: list[ReviewFinding]) -> None:
    """Record when two lanes independently landed on the same location."""
    by_location: dict[tuple[str, int], set[str]] = {}
    for finding in findings:
        if finding.file and finding.line:
            by_location.setdefault((finding.file, finding.line), set()).add(finding.lane.value)
    for finding in findings:
        if finding.file and finding.line:
            others = sorted(by_location.get((finding.file, finding.line), set()) - {finding.lane.value})
            if others:
                finding.also_raised_by = others
