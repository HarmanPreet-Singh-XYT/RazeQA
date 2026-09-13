"""Tests for publishing a verified fix: a branch and a commit, never a merge."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from agent.review.fixer import FixAttempt, FixCandidate, FixOutcome
from agent.review.publish import FixPublisher, PublishError, branch_name_for
from agent.review.verification import VerificationReport

BUGGY = "def add(a, b):\n    return a - b\n"
PATCH = (
    "diff --git a/calc.py b/calc.py\n"
    "--- a/calc.py\n"
    "+++ b/calc.py\n"
    "@@ -1,2 +1,2 @@\n"
    " def add(a, b):\n"
    "-    return a - b\n"
    "+    return a + b\n"
)


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(repo), capture_output=True, text=True)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    path = tmp_path / "repo"
    path.mkdir()
    (path / "calc.py").write_text(BUGGY)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    _git(path, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "baseline")
    return path


def verified_outcome(patch: str = PATCH) -> FixOutcome:
    attempt = FixAttempt(
        attempt=1,
        candidate=FixCandidate(patch=patch),
        applied=True,
        final_diff=patch,
    )
    attempt.verification = VerificationReport(passed=True)
    return FixOutcome(
        fingerprint="abcdef1234567890",
        title="add() subtracts instead of adding",
        attempts=[attempt],
        winner=attempt,
        summary="1/1 candidate(s) verified",
    )


def test_branch_name_is_deterministic():
    """A re-run must land on the same branch, not pile up new ones."""
    first = branch_name_for("abcdef1234567890", "add() subtracts instead of adding")
    second = branch_name_for("abcdef1234567890", "add() subtracts instead of adding")
    assert first == second
    assert first.startswith("review-fix/abcdef123456")
    assert " " not in first and "(" not in first


def test_refuses_to_publish_an_unverified_outcome(repo: Path):
    outcome = FixOutcome(fingerprint="x", title="nothing", winner=None)
    with pytest.raises(PublishError, match="no verified patch"):
        FixPublisher(repo).commit(outcome)


def test_commits_to_a_new_branch_and_leaves_main_untouched(repo: Path):
    published = FixPublisher(repo).commit(verified_outcome(), base_ref="main")

    assert published.branch.startswith("review-fix/")
    assert published.base_ref == "main"
    assert published.files == ["calc.py"]
    assert published.commit_sha

    # The fix is on the new branch...
    assert "a + b" in _git(repo, "show", f"{published.branch}:calc.py").stdout
    # ...and the base branch is exactly as it was.
    assert "a - b" in _git(repo, "show", "main:calc.py").stdout
    # The commit records that it was machine-authored.
    message = _git(repo, "log", "-1", "--format=%B", published.branch).stdout
    assert "Assisted-by: mini-swe-agent" in message
    assert "Review-Finding: abcdef1234567890" in message


def test_publishes_the_regression_test_alongside_the_fix(repo: Path):
    """The published branch must carry the test that proves the fix.

    `git diff HEAD` omits untracked files; a final patch built from it would
    publish the source change while silently dropping the new regression test.
    """
    with_test = PATCH + (
        "diff --git a/tests/test_calc_regression.py b/tests/test_calc_regression.py\n"
        "new file mode 100644\n"
        "--- /dev/null\n"
        "+++ b/tests/test_calc_regression.py\n"
        "@@ -0,0 +1,2 @@\n"
        "+def test_calc_regression():\n"
        "+    assert True\n"
    )
    published = FixPublisher(repo).commit(verified_outcome(with_test), base_ref="main")

    assert set(published.files) == {"calc.py", "tests/test_calc_regression.py"}
    shown = _git(repo, "show", f"{published.branch}:tests/test_calc_regression.py").stdout
    assert "test_calc_regression" in shown


def test_rerun_reuses_the_branch_instead_of_stacking_commits(repo: Path):
    publisher = FixPublisher(repo)
    first = publisher.commit(verified_outcome(), base_ref="main")
    _git(repo, "checkout", "-q", "main")
    second = publisher.commit(verified_outcome(), base_ref="main")

    assert first.branch == second.branch
    assert first.commit_sha == second.commit_sha
    count = _git(repo, "rev-list", "--count", f"main..{second.branch}").stdout.strip()
    assert count == "1"


def test_refuses_to_publish_directly_onto_the_base_branch(repo: Path):
    outcome = verified_outcome()
    with pytest.raises(PublishError, match="refusing to publish a fix directly"):
        FixPublisher(repo).commit(outcome, base_ref="main", branch="main")


def test_reports_a_patch_that_no_longer_applies(repo: Path):
    stale = FixOutcome(
        fingerprint="abcdef1234567890",
        title="stale",
        winner=FixAttempt(
            attempt=1,
            candidate=FixCandidate(patch=PATCH.replace("return a - b", "return a * b")),
            final_diff=PATCH.replace("return a - b", "return a * b"),
        ),
    )
    assert stale.verified is True
    with pytest.raises(PublishError, match="no longer applies"):
        FixPublisher(repo).commit(stale, base_ref="main")
    # A failed publish must not leave the repository on a half-made branch.
    assert _git(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == "main"
