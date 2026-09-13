"""Three-lane automated code review with a verified, on-demand fixer.

The pipeline this package implements:

* :mod:`agent.review.engine` runs the **compliance**, **security** and
  **code-review** lanes over one pull-request diff and merges their findings
  into a single ranked report. Each lane keeps its own severity ladder and its
  own message.
* :mod:`agent.review.verification` decides whether an agent-authored patch is
  acceptable, from observed evidence rather than from the agent's own claim:
  it must not weaken an existing test, CI or lint gate, it must publish a
  regression test that was seen failing before the fix, the build and the
  existing suite must still pass, and an adversarial critic must fail to
  falsify it.
* :mod:`agent.review.fixer` generates several candidate patches, verifies each
  in an isolated sandbox, and keeps the smallest survivor.
* :mod:`agent.review.publish` turns a verified patch into a branch and a pull
  request — never a direct commit, never a merge.
"""

from agent.review.diff import (
    DiffIndex,
    collect_diff,
    parse_unified_diff,
    select_diff_sections,
)
from agent.review.engine import (
    ReviewEngine,
    default_lane_invoker,
    extract_json,
    parse_lane_output,
)
from agent.review.fixer import (
    CommandResult,
    FixAttempt,
    FixCandidate,
    FixOutcome,
    LocalGitSandbox,
    ScriptedCandidateGenerator,
    VerifiedFixEngine,
    make_llm_critic,
    split_candidate_patch,
)
from agent.review.models import (
    LANE_LABELS,
    LANE_TIERS,
    Lane,
    LaneContext,
    LaneReport,
    LaneTier,
    ReviewFinding,
    ReviewReport,
    fingerprint_finding,
    resolve_tier,
)
from agent.review.publish import (
    FixPublisher,
    PublishedFix,
    PublishError,
    branch_name_for,
)
from agent.review.render import (
    render_fix_markdown,
    render_lane_markdown,
    render_report_markdown,
    report_to_json,
)
from agent.review.verification import (
    PROTECTED_PATH_PATTERNS,
    RegressionEvidence,
    ScopedFile,
    ScopeLimits,
    ScopeViolation,
    VerificationInput,
    VerificationReport,
    check_scope,
    evaluate_verification,
    is_gate_config_path,
    is_protected_path,
    is_test_path,
    summarize_evidence,
)

__all__ = [
    "LANE_LABELS",
    "LANE_TIERS",
    "PROTECTED_PATH_PATTERNS",
    "CommandResult",
    "DiffIndex",
    "FixAttempt",
    "FixCandidate",
    "FixOutcome",
    "FixPublisher",
    "Lane",
    "LaneContext",
    "LaneReport",
    "LaneTier",
    "LocalGitSandbox",
    "PublishError",
    "PublishedFix",
    "RegressionEvidence",
    "ReviewEngine",
    "ReviewFinding",
    "ReviewReport",
    "ScopeLimits",
    "ScopeViolation",
    "ScopedFile",
    "ScriptedCandidateGenerator",
    "VerificationInput",
    "VerificationReport",
    "VerifiedFixEngine",
    "branch_name_for",
    "check_scope",
    "collect_diff",
    "default_lane_invoker",
    "evaluate_verification",
    "extract_json",
    "fingerprint_finding",
    "is_gate_config_path",
    "is_protected_path",
    "is_test_path",
    "make_llm_critic",
    "parse_lane_output",
    "parse_unified_diff",
    "render_fix_markdown",
    "render_lane_markdown",
    "render_report_markdown",
    "report_to_json",
    "resolve_tier",
    "select_diff_sections",
    "split_candidate_patch",
    "summarize_evidence",
]
