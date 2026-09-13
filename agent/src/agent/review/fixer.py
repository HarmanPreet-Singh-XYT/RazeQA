"""Best-of-N verified fixing.

The engine generates several candidate patches for one finding, runs each
through the verification pipeline in an isolated sandbox, and keeps the smallest
patch that survives. It never commits: it returns the winning patch plus its
evidence, and publishing is a separate, explicit step
(:mod:`agent.review.publish`).

The important structural detail is how a single candidate patch is split. An
agent emits one diff, which may contain both a brand-new regression test and
the production fix. Those two halves are applied *separately*:

* the test half alone is applied to the unpatched tree and run — it must FAIL,
  which is the only way to know the test can detect the defect at all;
* then the production half is applied and the same test must PASS.

Without the first step "the tests pass" is worthless evidence, because a test
that can never fail also passes.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from agent.review.diff import DiffIndex, parse_unified_diff, select_diff_sections
from agent.review.models import ReviewFinding
from agent.review.verification import (
    PROTECTED_PATH_PATTERNS,
    RegressionEvidence,
    ScopedFile,
    ScopeLimits,
    VerificationInput,
    VerificationReport,
    check_scope,
    evaluate_verification,
    is_test_path,
    selection_key,
    summarize_evidence,
)

logger = logging.getLogger("agent.review.fixer")


@dataclass
class CommandResult:
    """Outcome of one command run in the sandbox."""

    returncode: int = 0
    output: str = ""
    skipped: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0

    @classmethod
    def skip(cls, reason: str = "") -> CommandResult:
        return cls(returncode=0, output=reason, skipped=True)


@dataclass
class FixCandidate:
    """One proposed patch for one finding."""

    patch: str
    test_command: str = ""
    suite_command: str = ""
    build_command: str = ""
    notes: str = ""
    attempt: int = 0


class FixSandbox(Protocol):
    """Isolated checkout a candidate is applied to and verified in.

    Implementations must guarantee ``reset()`` returns the tree to exactly the
    pre-patch state, because every attempt starts from a clean base and the
    fail-before half of the evidence depends on it.
    """

    def reset(self) -> None: ...

    def apply_patch(self, patch: str) -> bool: ...

    def run(self, command: str, timeout: int = 300) -> CommandResult: ...

    def diff(self) -> str: ...


#: ``(finding, attempt_index) -> candidate or None``
CandidateGenerator = Callable[[ReviewFinding, int], "FixCandidate | None"]
#: ``(finding, final_patch) -> (refuted, reason)``
CriticFn = Callable[[ReviewFinding, str], "tuple[bool | None, str]"]


@dataclass
class FixAttempt:
    """Everything observed for one candidate."""

    attempt: int
    candidate: FixCandidate
    applied: bool = False
    error: str | None = None
    files: list[ScopedFile] = field(default_factory=list)
    changed_lines: int = 0
    evidence: RegressionEvidence = field(default_factory=RegressionEvidence)
    build: CommandResult = field(default_factory=CommandResult)
    suite: CommandResult = field(default_factory=CommandResult)
    critic_refuted: bool | None = None
    critic_reason: str = ""
    verification: VerificationReport = field(default_factory=VerificationReport)
    final_diff: str = ""

    @property
    def passed(self) -> bool:
        return self.verification.passed

    def to_dict(self) -> dict[str, Any]:
        return {
            "attempt": self.attempt,
            "applied": self.applied,
            "error": self.error,
            "files": [{"path": f.path, "status": f.status} for f in self.files],
            "changed_lines": self.changed_lines,
            "evidence": summarize_evidence(self.evidence),
            "build": {"command": self.candidate.build_command, "returncode": self.build.returncode, "skipped": self.build.skipped},
            "suite": {"command": self.candidate.suite_command, "returncode": self.suite.returncode, "skipped": self.suite.skipped},
            "critic_refuted": self.critic_refuted,
            "critic_reason": self.critic_reason,
            "verification": {
                "passed": self.verification.passed,
                "reasons": self.verification.reasons,
                "warnings": self.verification.warnings,
                "checks": self.verification.checks,
            },
            "patch": self.final_diff or self.candidate.patch,
        }


@dataclass
class FixOutcome:
    """The result of a full best-of-N fix run for one finding."""

    fingerprint: str
    title: str
    attempts: list[FixAttempt] = field(default_factory=list)
    winner: FixAttempt | None = None
    summary: str = ""

    @property
    def verified(self) -> bool:
        return self.winner is not None

    @property
    def patch(self) -> str:
        return (self.winner.final_diff or self.winner.candidate.patch) if self.winner else ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "fingerprint": self.fingerprint,
            "title": self.title,
            "verified": self.verified,
            "summary": self.summary,
            "winner": self.winner.to_dict() if self.winner else None,
            "attempts": [a.to_dict() for a in self.attempts],
        }


def split_candidate_patch(patch: str) -> tuple[str, str, DiffIndex]:
    """Split a candidate patch into ``(test_patch, source_patch, index)``.

    A *newly added* protected path is the regression test; everything else is
    the production change. Modifying an existing protected path is not a split
    question — it stays in the source half and is rejected by ``check_scope``.
    """
    index = parse_unified_diff(patch)

    def _is_new_test(entry) -> bool:
        return entry.is_new and is_test_path(entry.path)

    test_patch = select_diff_sections(patch, _is_new_test)
    source_patch = select_diff_sections(patch, lambda entry: not _is_new_test(entry))
    return test_patch, source_patch, index


class VerifiedFixEngine:
    """Generate, verify and select a patch for one finding."""

    def __init__(
        self,
        generator: CandidateGenerator,
        *,
        critic: CriticFn | None = None,
        limits: ScopeLimits | None = None,
        command_timeout: int = 300,
    ) -> None:
        self.generator = generator
        self.critic = critic
        self.limits = limits or ScopeLimits()
        self.command_timeout = command_timeout

    def fix(
        self,
        finding: ReviewFinding,
        sandbox: FixSandbox,
        *,
        attempts: int = 3,
        test_command: str = "",
        suite_command: str = "",
        build_command: str = "",
    ) -> FixOutcome:
        """Run up to ``attempts`` candidates and return the smallest survivor."""
        outcome = FixOutcome(fingerprint=finding.fingerprint, title=finding.title)
        accepted: list[FixAttempt] = []

        for index in range(1, max(1, attempts) + 1):
            try:
                candidate = self.generator(finding, index)
            except Exception as exc:  # noqa: BLE001 - a generator failure is one lost attempt
                logger.warning("Candidate generator failed on attempt %s: %s", index, exc)
                candidate = None

            if candidate is None:
                outcome.attempts.append(
                    FixAttempt(attempt=index, candidate=FixCandidate(patch=""), error="no candidate produced")
                )
                continue

            candidate.attempt = index
            candidate.test_command = candidate.test_command or test_command
            candidate.suite_command = candidate.suite_command or suite_command
            candidate.build_command = candidate.build_command or build_command

            attempt = self._verify_candidate(candidate, sandbox, finding)
            outcome.attempts.append(attempt)
            if attempt.passed:
                accepted.append(attempt)

        if accepted:
            outcome.winner = min(accepted, key=lambda a: selection_key(a.verification, _as_input(a), a.attempt))
            outcome.summary = (
                f"{len(accepted)}/{len(outcome.attempts)} candidate(s) verified; "
                f"selected the smallest patch ({outcome.winner.changed_lines} changed lines "
                f"across {len(outcome.winner.files)} file(s))"
            )
        else:
            outcome.summary = (
                f"no candidate verified out of {len(outcome.attempts)} attempt(s); "
                "the finding was left for a human"
            )
        return outcome

    def _verify_candidate(
        self,
        candidate: FixCandidate,
        sandbox: FixSandbox,
        finding: ReviewFinding,
    ) -> FixAttempt:
        attempt = FixAttempt(attempt=candidate.attempt, candidate=candidate)

        if not candidate.patch.strip():
            attempt.error = "empty patch"
            return attempt

        test_patch, source_patch, index = split_candidate_patch(candidate.patch)
        attempt.changed_lines = index.added_line_count
        attempt.files = [ScopedFile(path=f.path, status=f.status) for f in index.files.values()]

        scope_violations = check_scope(attempt.files, attempt.changed_lines, self.limits)

        test_files = [f.path for f in index.files.values() if f.is_new and is_test_path(f.path)]
        evidence = RegressionEvidence(
            test_command=candidate.test_command,
            published=bool(test_patch.strip()),
            test_files=test_files,
        )
        attempt.evidence = evidence

        sandbox.reset()

        # 1. The regression test alone, against the unpatched tree, must fail.
        if evidence.published:
            if not sandbox.apply_patch(test_patch):
                attempt.error = "regression test patch did not apply to the clean tree"
                attempt.verification = evaluate_verification(
                    VerificationInput(
                        files=attempt.files,
                        changed_lines=attempt.changed_lines,
                        scope_violations=scope_violations,
                        evidence=evidence,
                    )
                )
                return attempt
            before = sandbox.run(candidate.test_command, timeout=self.command_timeout)
            evidence.failed_before = not before.ok
            evidence.before_output = before.output
        else:
            evidence.failed_before = False

        # 2. The production fix on top, and the same test must now pass.
        if source_patch.strip() and not sandbox.apply_patch(source_patch):
            attempt.error = "production patch did not apply"
            attempt.verification = evaluate_verification(
                VerificationInput(
                    files=attempt.files,
                    changed_lines=attempt.changed_lines,
                    scope_violations=scope_violations,
                    evidence=evidence,
                )
            )
            return attempt
        attempt.applied = True

        after = sandbox.run(candidate.test_command, timeout=self.command_timeout) if evidence.published else CommandResult.skip("no test")
        evidence.passed_after = after.ok if evidence.published else False
        evidence.after_output = after.output

        suite = (
            sandbox.run(candidate.suite_command, timeout=self.command_timeout)
            if candidate.suite_command
            else CommandResult.skip("no suite command configured")
        )
        build = (
            sandbox.run(candidate.build_command, timeout=self.command_timeout)
            if candidate.build_command
            else CommandResult.skip("no build command configured")
        )
        attempt.suite = suite
        attempt.build = build
        attempt.final_diff = sandbox.diff() or candidate.patch

        critic_refuted: bool | None = None
        critic_reason = ""
        if self.critic is not None:
            try:
                critic_refuted, critic_reason = self.critic(finding, attempt.final_diff)
            except Exception as exc:  # noqa: BLE001 - a broken critic must not approve anything
                critic_refuted, critic_reason = None, f"critic error: {exc}"
        attempt.critic_refuted = critic_refuted
        attempt.critic_reason = critic_reason

        attempt.verification = evaluate_verification(
            VerificationInput(
                files=attempt.files,
                changed_lines=attempt.changed_lines,
                scope_violations=scope_violations,
                evidence=evidence,
                build_passed=build.ok,
                suite_passed=suite.ok,
                build_ran=not build.skipped,
                suite_ran=not suite.skipped,
                critic_refuted=critic_refuted,
                critic_reason=critic_reason,
                build_command=candidate.build_command,
                suite_command=candidate.suite_command,
            )
        )
        return attempt


def _as_input(attempt: FixAttempt) -> VerificationInput:
    """Reconstruct the verification input for ranking (only size fields are read)."""
    return VerificationInput(files=attempt.files, changed_lines=attempt.changed_lines)


class ScriptedCandidateGenerator:
    """Deterministic generator used by tests and the offline demo.

    Each call returns the next scripted patch, then ``None`` once exhausted.
    """

    def __init__(self, candidates: list[FixCandidate]) -> None:
        self._candidates = list(candidates)

    def __call__(self, finding: ReviewFinding, attempt: int) -> FixCandidate | None:
        if attempt - 1 < len(self._candidates):
            candidate = self._candidates[attempt - 1]
            candidate.attempt = attempt
            return candidate
        return None


class LocalGitSandbox:
    """A throwaway copy of a git repository, verified with real commands.

    This is the development and demo path. The container path reuses the same
    protocol over ``docker exec`` via the existing sandbox module, so the
    verification rules are identical either way.
    """

    def __init__(self, source_dir: str | Path, *, workdir: str | Path | None = None) -> None:
        self.source_dir = Path(source_dir).resolve()
        self._owns_workdir = workdir is None
        self.workdir = Path(workdir).resolve() if workdir else Path(tempfile.mkdtemp(prefix="review-fix-"))
        if self._owns_workdir:
            self._clone()

    def _clone(self) -> None:
        ignore = shutil.ignore_patterns(
            ".git", "node_modules", ".next", ".venv", "venv", "__pycache__", ".pytest_cache", "dist", "coverage"
        )
        shutil.copytree(self.source_dir, self.workdir, ignore=ignore, dirs_exist_ok=True)
        self._git("init", "-q")
        self._git("add", "-A")
        self._git(
            "-c",
            "user.email=review@local",
            "-c",
            "user.name=review",
            "commit",
            "-q",
            "-m",
            "baseline",
        )

    def _git(self, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["git", *args],
            cwd=str(self.workdir),
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def reset(self) -> None:
        self._git("checkout", "--", ".")
        self._git("clean", "-fdq")
        self.purge_caches()

    def purge_caches(self) -> None:
        """Delete interpreter and test-runner caches.

        This is not hygiene, it is correctness. Python validates a cached
        ``.pyc`` with (mtime, size); a fix such as ``a - b`` -> ``a + b`` leaves
        the size unchanged, so a cache written moments earlier can still be
        considered valid and the "after" run observes the *unpatched* code. An
        oracle that reports stale results is worse than no oracle, because it
        makes the fail-before/pass-after evidence a lie.
        """
        for path in list(self.workdir.rglob("__pycache__")):
            shutil.rmtree(path, ignore_errors=True)
        for pattern in ("*.pyc", "*.pyo"):
            for path in list(self.workdir.rglob(pattern)):
                try:
                    path.unlink()
                except OSError:
                    pass

    def intent_to_add(self) -> None:
        """Stage new files as intent-to-add so ``diff()`` reports them.

        Without this an untracked regression test is invisible to ``git diff``,
        and a candidate that only added a test would look like an empty patch.
        """
        self._git("add", "-N", ".")

    def apply_patch(self, patch: str) -> bool:
        if not patch.strip():
            return True
        result = subprocess.run(
            ["git", "apply", "--whitespace=nowarn", "-"],
            cwd=str(self.workdir),
            input=patch,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            logger.info("Patch did not apply: %s", result.stderr.strip()[:200])
            return False
        # A patched file may keep its size, so any cache keyed on (mtime, size)
        # would still be considered fresh. Drop caches whenever the tree moves.
        self.purge_caches()
        return True

    def run(self, command: str, timeout: int = 300) -> CommandResult:
        if not command.strip():
            return CommandResult.skip("no command configured")
        # PYTHONDONTWRITEBYTECODE keeps the two phases of an attempt from being
        # served out of the same bytecode cache.
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUNBUFFERED": "1"}
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=str(self.workdir),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raw = exc.stdout or ""
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", "replace")
            return CommandResult(returncode=-1, output=f"{raw}\n[timed out after {timeout}s]")
        output = result.stdout + (result.stderr if result.returncode != 0 else "")
        return CommandResult(returncode=result.returncode, output=output)

    def diff(self) -> str:
        """Full working-tree patch, *including* newly added files.

        ``git diff HEAD`` omits untracked files, so a candidate whose only new
        file is the regression test would look like a patch that changes no
        tests. Publishing that would silently drop the very test that justifies
        the fix, so the new files are staged as intent-to-add for the duration
        of the diff and then unstaged again.
        """
        self._git("add", "-N", ".")
        try:
            result = self._git("diff", "HEAD")
            return result.stdout if result.returncode == 0 else ""
        finally:
            self._git("reset", "-q")

    def cleanup(self) -> None:
        if self._owns_workdir:
            shutil.rmtree(self.workdir, ignore_errors=True)


def make_llm_critic(*, invoker: Callable[[str, str], str] | None = None) -> CriticFn:
    """Build a critic backed by the code-reasoning model.

    ``invoker`` is injectable so the critic can be tested without a provider.
    """
    from agent.review.prompts import build_critic_prompt

    def _invoke(system: str, user: str) -> str:
        if invoker is not None:
            return invoker(system, user)
        from agent.models.factory import ModelRole, create_strands_agent

        agent = create_strands_agent(role=ModelRole.CODE_REASONING, system_prompt=system, max_tokens=2000)
        return str(agent(user))

    def critic(finding: ReviewFinding, patch: str) -> tuple[bool | None, str]:

        system, user = build_critic_prompt(
            finding.title, finding.detail, finding.location, patch[:12000]
        )
        raw = _invoke(system, user)
        from agent.review.engine import extract_json

        data = extract_json(raw)
        if not isinstance(data, dict) or "refuted" not in data:
            return None, "critic reply was not parseable"
        refuted = bool(data.get("refuted"))
        reason = str(data.get("reason") or data.get("counterexample") or "")
        return refuted, reason

    return critic


__all__ = [
    "PROTECTED_PATH_PATTERNS",
    "CommandResult",
    "FixAttempt",
    "FixCandidate",
    "FixOutcome",
    "FixSandbox",
    "LocalGitSandbox",
    "ScriptedCandidateGenerator",
    "VerifiedFixEngine",
    "make_llm_critic",
    "split_candidate_patch",
]
