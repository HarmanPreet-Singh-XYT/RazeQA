"""Tests for best-of-N verified fixing.

The fake sandbox below makes the *rules* testable without a model, a container
or a network; the final test runs the whole thing for real against a throwaway
git repository and a real test runner.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from agent.review.fixer import (
    CommandResult,
    FixCandidate,
    LocalGitSandbox,
    ScriptedCandidateGenerator,
    VerifiedFixEngine,
    split_candidate_patch,
)
from agent.review.models import Lane, ReviewFinding
from agent.review.verification import ScopeLimits


class FakeSandbox:
    """Records what was applied and replays scripted command results."""

    def __init__(self, results: list[CommandResult] | None = None, reject: set[str] | None = None) -> None:
        self._results = list(results or [])
        self._reject = reject or set()
        self.applied: list[str] = []
        self.commands: list[str] = []
        self.resets = 0

    def reset(self) -> None:
        self.resets += 1
        self.applied.clear()

    def apply_patch(self, patch: str) -> bool:
        if patch.strip() in self._reject:
            return False
        self.applied.append(patch)
        return True

    def run(self, command: str, timeout: int = 300) -> CommandResult:
        self.commands.append(command)
        if self._results:
            return self._results.pop(0)
        return CommandResult(0, "ok")

    def diff(self) -> str:
        return "\n".join(self.applied)


def source_patch(path: str = "src/app.py", added: int = 1) -> str:
    body = "\n".join(f"+line{i} = {i}" for i in range(added))
    return (
        f"diff --git a/{path} b/{path}\n"
        f"--- a/{path}\n"
        f"+++ b/{path}\n"
        f"@@ -1,1 +1,{added + 1} @@\n"
        f" x = 0\n"
        f"{body}\n"
    )


def new_test_patch(path: str = "tests/test_regression.py") -> str:
    return (
        f"diff --git a/{path} b/{path}\n"
        f"new file mode 100644\n"
        f"--- /dev/null\n"
        f"+++ b/{path}\n"
        f"@@ -0,0 +1,2 @@\n"
        f"+def test_regression():\n"
        f"+    assert add(2, 3) == 5\n"
    )


def modify_existing_test_patch(path: str = "tests/test_existing.py") -> str:
    return (
        f"diff --git a/{path} b/{path}\n"
        f"--- a/{path}\n"
        f"+++ b/{path}\n"
        f"@@ -1,2 +1,2 @@\n"
        f"-def test_add():\n"
        f"-    assert add(2, 3) == 5\n"
        f"+def test_add():\n"
        f"+    assert True\n"
    )


def finding() -> ReviewFinding:
    return ReviewFinding(
        lane=Lane.CODE_REVIEW,
        tier="must_fix",
        title="add() subtracts instead of adding",
        file="src/app.py",
        line=1,
        evidence="return a - b",
    )


PASS = CommandResult(0, "passed")
FAIL = CommandResult(1, "failed")


def test_split_candidate_patch_separates_test_from_fix():
    patch = source_patch() + new_test_patch()
    test_patch, source, index = split_candidate_patch(patch)
    assert "tests/test_regression.py" in test_patch
    assert "src/app.py" not in test_patch
    assert "src/app.py" in source
    assert "tests/test_regression.py" not in source
    assert set(index.paths) == {"src/app.py", "tests/test_regression.py"}


def test_accepts_a_verified_candidate_and_records_evidence():
    sandbox = FakeSandbox(results=[FAIL, PASS, PASS, PASS])
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]))
    candidate = FixCandidate(patch=source_patch() + new_test_patch(), test_command="pytest", suite_command="pytest -q", build_command="build")

    attempt = engine._verify_candidate(candidate, sandbox, finding())

    assert attempt.verification.passed is True
    assert attempt.evidence.published is True
    assert attempt.evidence.failed_before is True
    assert attempt.evidence.passed_after is True
    assert attempt.evidence.test_files == ["tests/test_regression.py"]
    # The test command runs twice: once on the unpatched tree, once after the fix.
    assert sandbox.commands[:2] == ["pytest", "pytest"]


def test_rejects_a_patch_that_modifies_an_existing_test():
    """The single most important rejection: editing a test until it passes."""
    sandbox = FakeSandbox(results=[PASS, PASS, PASS, PASS])
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]))
    candidate = FixCandidate(
        patch=source_patch() + modify_existing_test_patch(),
        test_command="pytest",
        suite_command="pytest -q",
        build_command="build",
    )

    attempt = engine._verify_candidate(candidate, sandbox, finding())

    assert attempt.verification.passed is False
    assert attempt.verification.checks["scope"] is False
    assert "protected_path_modified" in " ".join(attempt.verification.reasons)


def test_rejects_a_patch_with_no_regression_test():
    sandbox = FakeSandbox(results=[PASS, PASS])
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]))
    candidate = FixCandidate(patch=source_patch(), test_command="pytest", build_command="build")

    attempt = engine._verify_candidate(candidate, sandbox, finding())

    assert attempt.verification.passed is False
    assert attempt.evidence.published is False
    assert "no regression test" in " ".join(attempt.verification.reasons)


def test_rejects_a_test_that_already_passed_before_the_fix():
    """Green before the fix means the test could never have detected the defect."""
    sandbox = FakeSandbox(results=[PASS, PASS, PASS, PASS])
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]))
    candidate = FixCandidate(
        patch=source_patch() + new_test_patch(),
        test_command="pytest",
        suite_command="pytest -q",
        build_command="build",
    )

    attempt = engine._verify_candidate(candidate, sandbox, finding())

    assert attempt.verification.passed is False
    assert attempt.evidence.failed_before is False
    assert "did not fail before the fix" in " ".join(attempt.verification.reasons)


def test_best_of_n_selects_the_smallest_verified_patch():
    large = source_patch(added=20) + new_test_patch()
    small = source_patch(added=1) + new_test_patch()
    # Each attempt consumes: test-before, test-after, suite, build.
    sandbox = FakeSandbox(results=[FAIL, PASS, PASS, PASS, FAIL, PASS, PASS, PASS])
    generator = ScriptedCandidateGenerator(
        [
            FixCandidate(patch=large, test_command="pytest", suite_command="pytest -q", build_command="build"),
            FixCandidate(patch=small, test_command="pytest", suite_command="pytest -q", build_command="build"),
        ]
    )
    engine = VerifiedFixEngine(generator)

    outcome = engine.fix(finding(), sandbox, attempts=2)

    assert outcome.verified is True
    assert len(outcome.attempts) == 2
    assert all(a.passed for a in outcome.attempts)
    assert outcome.winner is not None
    assert outcome.winner.changed_lines == 3  # one context + one added source line + ... smallest
    assert outcome.winner.changed_lines < outcome.attempts[0].changed_lines


def test_smallest_patch_wins_even_when_a_larger_one_was_verified_first():
    """Selection is by patch size, not by which attempt happened to succeed first."""
    first_big = source_patch(added=10) + new_test_patch()
    second_small = source_patch(added=1) + new_test_patch()
    sandbox = FakeSandbox(results=[FAIL, PASS, PASS, PASS, FAIL, PASS, PASS, PASS])
    generator = ScriptedCandidateGenerator(
        [
            FixCandidate(patch=first_big, test_command="pytest", suite_command="pytest -q", build_command="build"),
            FixCandidate(patch=second_small, test_command="pytest", suite_command="pytest -q", build_command="build"),
        ]
    )
    outcome = VerifiedFixEngine(generator).fix(finding(), sandbox, attempts=2)
    assert outcome.winner is outcome.attempts[1]


def test_no_winner_when_every_candidate_fails():
    sandbox = FakeSandbox(results=[PASS, PASS, PASS, PASS])
    generator = ScriptedCandidateGenerator(
        [FixCandidate(patch=source_patch() + new_test_patch(), test_command="pytest", suite_command="pytest -q", build_command="build")]
    )
    outcome = VerifiedFixEngine(generator).fix(finding(), sandbox, attempts=1)
    assert outcome.verified is False
    assert outcome.winner is None
    assert "no candidate verified" in outcome.summary
    assert outcome.patch == ""


def test_generator_failure_loses_only_that_attempt():
    calls: list[int] = []

    def generator(f, attempt):
        calls.append(attempt)
        if attempt == 1:
            raise RuntimeError("model unavailable")
        return FixCandidate(patch=source_patch() + new_test_patch(), test_command="pytest", build_command="build")

    sandbox = FakeSandbox(results=[FAIL, PASS, PASS])
    outcome = VerifiedFixEngine(generator).fix(finding(), sandbox, attempts=2)

    assert calls == [1, 2]
    assert outcome.verified is True
    assert outcome.attempts[0].error == "no candidate produced"


def test_critic_refutation_rejects_an_otherwise_passing_patch():
    sandbox = FakeSandbox(results=[FAIL, PASS, PASS, PASS])
    engine = VerifiedFixEngine(
        ScriptedCandidateGenerator([]),
        critic=lambda f, patch: (True, "the patch swallows the exception"),
    )
    candidate = FixCandidate(
        patch=source_patch() + new_test_patch(),
        test_command="pytest",
        suite_command="pytest -q",
        build_command="build",
    )
    attempt = engine._verify_candidate(candidate, sandbox, finding())
    assert attempt.verification.passed is False
    assert "critic refuted" in " ".join(attempt.verification.reasons)


def test_broken_critic_does_not_approve_anything():
    def explode(f, patch):
        raise RuntimeError("critic crashed")

    sandbox = FakeSandbox(results=[FAIL, PASS, PASS, PASS])
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]), critic=explode)
    candidate = FixCandidate(
        patch=source_patch() + new_test_patch(),
        test_command="pytest",
        suite_command="pytest -q",
        build_command="build",
    )
    attempt = engine._verify_candidate(candidate, sandbox, finding())
    # A crashed critic is treated as "no verdict": a warning, not a silent pass.
    assert attempt.critic_refuted is None
    assert "critic error" in attempt.critic_reason
    assert attempt.verification.passed is True
    assert "no critic was run" in " ".join(attempt.verification.warnings)


def test_patch_that_does_not_apply_is_rejected_without_running_tests():
    """If the regression test cannot even be applied, nothing is run and the
    attempt is rejected — no evidence may be manufactured from a broken tree."""
    patch = source_patch() + new_test_patch()
    test_half = split_candidate_patch(patch)[0]
    sandbox = FakeSandbox(results=[FAIL, PASS], reject={test_half.strip()})
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]))
    attempt = engine._verify_candidate(
        FixCandidate(patch=patch, test_command="pytest"), sandbox, finding()
    )
    assert attempt.verification.passed is False
    assert attempt.error is not None
    assert sandbox.commands == []


def test_oversized_patch_is_rejected_on_scope():
    patch = source_patch(added=300) + new_test_patch()
    sandbox = FakeSandbox(results=[FAIL, PASS, PASS, PASS])
    engine = VerifiedFixEngine(ScriptedCandidateGenerator([]), limits=ScopeLimits(max_changed_lines=50))
    attempt = engine._verify_candidate(
        FixCandidate(patch=patch, test_command="pytest", suite_command="pytest -q"),
        sandbox,
        finding(),
    )
    assert attempt.verification.passed is False
    assert "diff_too_large" in " ".join(attempt.verification.reasons)


# ---------------------------------------------------------------------------
# Real end-to-end: a throwaway git repo, a real test runner, a real red->green.
# ---------------------------------------------------------------------------

BUGGY_CALC = "def add(a, b):\n    return a - b\n"
FIXED_CALC = "def add(a, b):\n    return a + b\n"
# Passes against the buggy code as well (3 - 0 == 3 + 0), so the baseline suite
# starts green and any regression it reports is genuinely caused by the patch.
EXISTING_TEST = "from calc import add\n\n\ndef test_add_zero():\n    assert add(3, 0) == 3\n"


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(repo), capture_output=True, text=True)


def _build_patch_from_edits(repo: Path, source: str, test_path: str, test_body: str) -> str:
    """Produce a real combined patch by editing a scratch clone and diffing it."""
    scratch = LocalGitSandbox(repo)
    try:
        (scratch.workdir / "calc.py").write_text(source)
        target = scratch.workdir / test_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(test_body)
        scratch.intent_to_add()
        return scratch.diff()
    finally:
        scratch.cleanup()


def test_real_repo_red_to_green_end_to_end(tmp_path: Path):
    """The full loop against a real repository and a real pytest run.

    This is the claim the whole module exists to support: the regression test is
    observed failing on the unpatched tree, then passing after the fix.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "calc.py").write_text(BUGGY_CALC)
    # An empty root conftest.py puts the repository root on sys.path, so the
    # suite can `from calc import add` exactly as a real project would.
    (repo / "conftest.py").write_text("")
    tests_dir = repo / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_calc.py").write_text(EXISTING_TEST)
    _git(repo, "init", "-q")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "baseline")

    regression_test = "from calc import add\n\n\ndef test_add_regression():\n    assert add(2, 3) == 5\n"
    patch = _build_patch_from_edits(repo, FIXED_CALC, "tests/test_regression.py", regression_test)

    py = sys.executable
    candidate = FixCandidate(
        patch=patch,
        test_command=f"{py} -m pytest tests/test_regression.py -q",
        suite_command=f"{py} -m pytest -q",
        build_command=f"{py} -c 'import calc'",
    )

    sandbox = LocalGitSandbox(repo)
    try:
        outcome = VerifiedFixEngine(ScriptedCandidateGenerator([candidate])).fix(
            finding(), sandbox, attempts=1
        )
    finally:
        sandbox.cleanup()

    assert outcome.verified is True, [
        (a.error, a.verification.reasons) for a in outcome.attempts
    ]
    winner = outcome.winner
    assert winner is not None
    assert winner.evidence.failed_before is True
    assert winner.evidence.passed_after is True
    assert "tests/test_regression.py" in winner.evidence.test_files
    assert winner.build.ok and winner.suite.ok
    assert "a + b" in winner.final_diff
    # The final patch must carry the regression test too. `git diff HEAD` omits
    # untracked files, and publishing without the test would drop the evidence.
    assert "tests/test_regression.py" in winner.final_diff


def test_same_size_fix_is_not_masked_by_stale_bytecode(tmp_path: Path):
    """Regression test for an oracle that lies.

    ``return a - b`` and ``return a + b`` have identical length, so a Python
    bytecode cache keyed on ``(mtime, size)`` stays "valid" across the patch.
    Without cache purging the "after" phase re-imports the *unpatched* module and
    the fail-before/pass-after evidence becomes meaningless.

    This asserts the fix is actually observed: the same character-length change
    must move the test from red to green.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "calc.py").write_text(BUGGY_CALC)
    (repo / "conftest.py").write_text("")
    (repo / "tests").mkdir()
    (repo / "tests" / "test_calc.py").write_text(EXISTING_TEST)
    _git(repo, "init", "-q")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "baseline")

    assert len(BUGGY_CALC) == len(FIXED_CALC), "the trap only exists for equal-length edits"

    scrub = LocalGitSandbox(repo)
    try:
        (scrub.workdir / "calc.py").write_text(FIXED_CALC)
        (scrub.workdir / "tests" / "test_regression.py").write_text(
            "from calc import add\n\n\ndef test_add_regression():\n    assert add(2, 3) == 5\n"
        )
        scrub.intent_to_add()
        patch = scrub.diff()
    finally:
        scrub.cleanup()

    py = sys.executable
    candidate = FixCandidate(
        patch=patch,
        test_command=f"{py} -m pytest tests/test_regression.py -q",
        suite_command=f"{py} -m pytest -q",
    )

    sandbox = LocalGitSandbox(repo)
    try:
        outcome = VerifiedFixEngine(ScriptedCandidateGenerator([candidate])).fix(
            finding(), sandbox, attempts=1
        )
    finally:
        sandbox.cleanup()

    assert outcome.verified is True, [
        (a.error, a.verification.reasons) for a in outcome.attempts
    ]
    winner = outcome.winner
    assert winner is not None
    assert winner.evidence.failed_before is True
    assert winner.evidence.passed_after is True


def test_real_repo_rejects_agent_that_deletes_the_test(tmp_path: Path):
    """A patch that rewrites an existing test to `assert True` is refused even
    though it would make the suite green."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "calc.py").write_text(BUGGY_CALC)
    # An empty root conftest.py puts the repository root on sys.path, so the
    # suite can `from calc import add` exactly as a real project would.
    (repo / "conftest.py").write_text("")
    tests_dir = repo / "tests"
    tests_dir.mkdir()
    (tests_dir / "test_calc.py").write_text(EXISTING_TEST)
    _git(repo, "init", "-q")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    _git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "baseline")

    sandbox = LocalGitSandbox(repo)
    try:
        # The "agent" edits the existing test file instead of adding a new one.
        (sandbox.workdir / "tests" / "test_calc.py").write_text(
            "def test_add_positive():\n    assert True\n"
        )
        patch = sandbox.diff()
    finally:
        sandbox.cleanup()

    candidate = FixCandidate(patch=patch, test_command="pytest -q", suite_command="pytest -q")
    sandbox = LocalGitSandbox(repo)
    try:
        outcome = VerifiedFixEngine(ScriptedCandidateGenerator([candidate])).fix(
            finding(), sandbox, attempts=1
        )
    finally:
        sandbox.cleanup()

    assert outcome.verified is False
    assert "protected_path_modified" in " ".join(outcome.attempts[0].verification.reasons)
