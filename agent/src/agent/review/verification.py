"""The verification pipeline that decides whether an agent's patch is accepted.

This is the part that separates "an AI wrote a fix" from "an AI proved a fix".
Nothing here trusts the agent's own claim of success. A candidate patch is only
accepted when every one of these holds:

1. **Scope.** It did not modify, delete or weaken an existing test, fixture,
   snapshot, CI workflow or lint configuration. *Adding* a new test file is
   allowed and in fact required — that is the regression proof, not a bypass.
2. **Regression evidence.** It published a regression test that was *observed
   to fail* on the unpatched code and to pass after the patch. A green suite
   alone proves nothing: it is equally consistent with the test never having
   been able to fail.
3. **Build and suite.** The project still builds and the pre-existing suite
   still passes, so the fix did not buy one green check with another.
4. **Critic.** An independent adversarial pass failed to falsify the patch.

All of it is a pure function over collected evidence, so the rules can be read
and tested without a model, a sandbox or a network.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

#: Tests, fixtures and snapshots. Adding a *new* file here is allowed and in
#: fact required — that new file is the regression proof.
TEST_PATH_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(^|/)(tests?|__tests__|spec|specs|testdata|fixtures?|__mocks__|__snapshots__)(/|$)"),
    re.compile(r"(^|/)conftest\.py$"),
    re.compile(r"(^|/)test_[^/]*\.py$"),
    re.compile(r"(^|/)[^/]*_test\.(py|go|rb|rs|ex|exs)$"),
    re.compile(r"\.(test|spec)\.[cm]?[jt]sx?$"),
    re.compile(r"\.snap$"),
)

#: CI, lint, type and test-runner configuration. These decide what "passing"
#: means, so *adding* one is as dangerous as editing one: a new workflow or a
#: new lint config silently redefines the gate the patch is judged by.
GATE_CONFIG_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(^|/)\.github/(workflows|actions)(/|$)"),
    re.compile(r"(^|/)\.gitlab-ci\.ya?ml$"),
    re.compile(r"(^|/)\.circleci(/|$)"),
    re.compile(r"(^|/)\.buildkite(/|$)"),
    re.compile(r"(^|/)Jenkinsfile$"),
    re.compile(r"(^|/)azure-pipelines\.ya?ml$"),
    re.compile(r"(^|/)\.eslintrc(\.[^/]*)?$"),
    re.compile(r"(^|/)eslint\.config\.[cm]?[jt]s$"),
    re.compile(r"(^|/)\.flake8$"),
    re.compile(r"(^|/)\.?ruff\.toml$"),
    re.compile(r"(^|/)tox\.ini$"),
    re.compile(r"(^|/)pytest\.ini$"),
    re.compile(r"(^|/)jest\.config\.[cm]?[jt]s$"),
    re.compile(r"(^|/)vitest\.config\.[cm]?[jt]s$"),
    re.compile(r"(^|/)\.golangci\.ya?ml$"),
    re.compile(r"(^|/)\.pre-commit-config\.ya?ml$"),
    re.compile(r"(^|/)mypy\.ini$"),
)

#: Every path an agent may not touch, tests included.
PROTECTED_PATH_PATTERNS: tuple[re.Pattern[str], ...] = TEST_PATH_PATTERNS + GATE_CONFIG_PATTERNS


def _normalise(path: str) -> str:
    """Strip leading ``/`` and ``./`` segments.

    Deliberately not ``lstrip("./")``, which also eats the leading dot of a
    dotfile: a root-level ``.github/workflows/ci.yml`` normalised to
    ``github/workflows/ci.yml`` and stopped matching.
    """
    cleaned = (path or "").replace("\\", "/").strip().lstrip("/")
    while cleaned.startswith("./"):
        cleaned = cleaned[2:]
    return cleaned


def is_test_path(path: str) -> bool:
    """True when ``path`` is a test, fixture or snapshot file."""
    cleaned = _normalise(path)
    return bool(cleaned) and any(pattern.search(cleaned) for pattern in TEST_PATH_PATTERNS)


def is_gate_config_path(path: str) -> bool:
    """True when ``path`` is CI, lint or test-runner configuration."""
    cleaned = _normalise(path)
    return bool(cleaned) and any(pattern.search(cleaned) for pattern in GATE_CONFIG_PATTERNS)


def is_protected_path(path: str) -> bool:
    """True when ``path`` is a test, CI, snapshot, fixture or lint config file."""
    cleaned = _normalise(path)
    return bool(cleaned) and any(pattern.search(cleaned) for pattern in PROTECTED_PATH_PATTERNS)


@dataclass
class ScopedFile:
    """A file in a candidate patch, with the status the diff reported."""

    path: str
    status: str = "modified"  # "added" | "modified" | "deleted"


@dataclass(frozen=True)
class ScopeViolation:
    """A reason a candidate patch is rejected on structure alone."""

    kind: str
    detail: str


@dataclass(frozen=True)
class ScopeLimits:
    """Blast-radius budget for an agent-authored patch."""

    max_files: int = 8
    max_changed_lines: int = 200
    #: When False, *any* protected path rejected — including a newly added test.
    #: Left True by default because a mandatory regression test has to live
    #: somewhere, and a brand-new test file authored by the agent is reviewed by
    #: a human in the PR rather than being trusted.
    allow_new_test_files: bool = True


def check_scope(
    files: list[ScopedFile],
    changed_lines: int,
    limits: ScopeLimits | None = None,
) -> list[ScopeViolation]:
    """Structural rejections for a candidate patch.

    Deliberately distinguishes *adding* a protected file from *editing* one:
    the first is the regression test the pipeline demands, the second is how a
    patch cheats.
    """
    limits = limits or ScopeLimits()
    violations: list[ScopeViolation] = []

    if len(files) > limits.max_files:
        violations.append(
            ScopeViolation(
                "too_many_files",
                f"patch touches {len(files)} files, budget is {limits.max_files}",
            )
        )
    if changed_lines > limits.max_changed_lines:
        violations.append(
            ScopeViolation(
                "diff_too_large",
                f"patch changes {changed_lines} lines, budget is {limits.max_changed_lines}",
            )
        )

    for entry in files:
        if not is_protected_path(entry.path):
            continue
        if entry.status == "added":
            # Only a *new test* earns the exemption. A newly added CI workflow
            # or lint config is not a regression proof — it is a redefinition of
            # the gate the patch is about to be judged by.
            if is_test_path(entry.path) and limits.allow_new_test_files:
                continue
            violations.append(
                ScopeViolation(
                    "protected_path_added",
                    f"new protected file {entry.path}",
                )
            )
            continue
        violations.append(
            ScopeViolation(
                f"protected_path_{entry.status}",
                f"{entry.status} existing protected path {entry.path}",
            )
        )

    return violations


@dataclass
class RegressionEvidence:
    """What was observed while proving the regression test is meaningful."""

    test_command: str = ""
    #: True when the new test was *observed failing* before the production fix.
    failed_before: bool = False
    #: True when the same test passed once the production fix was applied.
    passed_after: bool = False
    published: bool = False
    test_files: list[str] = field(default_factory=list)
    before_output: str = ""
    after_output: str = ""


@dataclass
class VerificationInput:
    """Every observation the verdict is computed from."""

    files: list[ScopedFile] = field(default_factory=list)
    changed_lines: int = 0
    scope_violations: list[ScopeViolation] = field(default_factory=list)
    evidence: RegressionEvidence = field(default_factory=RegressionEvidence)
    build_passed: bool = False
    suite_passed: bool = False
    #: False when no build/suite command was configured. The check then cannot
    #: fail, but it must not be reported as verified either.
    build_ran: bool = True
    suite_ran: bool = True
    #: ``True`` when the critic successfully falsified the patch. ``None`` when
    #: no critic was run — recorded as a warning, never as a pass.
    critic_refuted: bool | None = None
    critic_reason: str = ""
    build_command: str = ""
    suite_command: str = ""


@dataclass
class VerificationReport:
    """The verdict, with the reasons a human can audit."""

    passed: bool = False
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checks: dict[str, bool] = field(default_factory=dict)


def evaluate_verification(data: VerificationInput) -> VerificationReport:
    """Apply the acceptance rules and explain the outcome.

    The checks are ordered from "structurally disqualifying" to "weakest
    evidence", and every failure is reported rather than short-circuiting, so a
    rejected attempt tells the reader everything that was wrong with it.
    """
    reasons: list[str] = []
    warnings: list[str] = []
    checks: dict[str, bool] = {}

    scope_ok = not data.scope_violations
    checks["scope"] = scope_ok
    for violation in data.scope_violations:
        # The kind is included, not just the prose: it is the machine-readable
        # part a dashboard or a test can assert on.
        reasons.append(f"scope: {violation.kind}: {violation.detail}")

    evidence = data.evidence
    checks["regression_test_published"] = evidence.published
    if not evidence.published:
        reasons.append(
            "no regression test: the patch adds no new test, so there is no evidence the "
            "defect was reproducible"
        )

    checks["test_fails_before_fix"] = evidence.failed_before
    if evidence.published and not evidence.failed_before:
        reasons.append(
            "test did not fail before the fix: it passes against the unpatched code, so it "
            "does not demonstrate the defect"
        )

    checks["test_passes_after_fix"] = evidence.passed_after
    if evidence.published and not evidence.passed_after:
        reasons.append("test still fails after the fix")

    checks["build_passed"] = data.build_passed
    if not data.build_passed:
        reasons.append(f"build failed ({data.build_command or 'build command not configured'})")
    elif not data.build_ran:
        warnings.append("no build command configured: the patch was not compiled")

    checks["suite_passed"] = data.suite_passed
    if not data.suite_passed:
        reasons.append(f"pre-existing suite failed ({data.suite_command or 'test command not configured'})")
    elif not data.suite_ran:
        warnings.append("no suite command configured: only the regression test was run")

    checks["not_refuted"] = data.critic_refuted is not True
    if data.critic_refuted is True:
        reasons.append(f"critic refuted the patch: {data.critic_reason or 'no reason given'}")
    elif data.critic_refuted is None:
        warnings.append("no critic was run: the patch was not adversarially challenged")

    return VerificationReport(
        passed=not reasons,
        reasons=reasons,
        warnings=warnings,
        checks=checks,
    )


def selection_key(report: VerificationReport, data: VerificationInput, attempt: int) -> tuple[int, int, int, int]:
    """Deterministic ordering among accepted attempts.

    Smallest patch wins; ties break on file count, then on the attempt index so
    a re-run of the same inputs selects the same winner.
    """
    return (data.changed_lines, len(data.files), attempt, 0)


def summarize_evidence(evidence: RegressionEvidence, limit: int = 400) -> dict[str, Any]:
    """A compact, log-safe view of the before/after observation."""
    def _tail(text: str) -> str:
        return (text or "")[-limit:]

    return {
        "test_command": evidence.test_command,
        "test_files": list(evidence.test_files),
        "failed_before": evidence.failed_before,
        "passed_after": evidence.passed_after,
        "published": evidence.published,
        "before_output_tail": _tail(evidence.before_output),
        "after_output_tail": _tail(evidence.after_output),
    }
