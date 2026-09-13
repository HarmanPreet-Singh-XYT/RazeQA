#!/usr/bin/env python
"""End-to-end demo of the three-lane review and the verified fixer.

Runs with **no API keys and no network**. The three lane replies and the
candidate patch are scripted, but everything else is real: a real git
repository, a real unified diff, real patch application, a real test runner, and
a real branch and commit. That is deliberate — the claim being demonstrated is
"the fix was verified", so the parts that would have to be faked for that claim
to hold are exactly the parts that are not.

    cd agent
    uv run python scripts/review_demo.py

Pass ``--live`` to drive the lanes with the configured model instead of the
scripted replies (requires provider credentials).
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent.review.diff import collect_diff, parse_unified_diff
from agent.review.engine import ReviewEngine, default_lane_invoker
from agent.review.fixer import (
    FixCandidate,
    LocalGitSandbox,
    ScriptedCandidateGenerator,
    VerifiedFixEngine,
)
from agent.review.models import Lane, ReviewFinding
from agent.review.publish import FixPublisher
from agent.review.render import (
    render_fix_markdown,
    render_report_markdown,
)

CORRECT_AUTH = '''"""Authorization helpers."""

ADMIN = "admin"


class User:
    def __init__(self, name, role="member"):
        self.name = name
        self.role = role


class Document:
    def __init__(self, owner, body=""):
        self.owner = owner
        self.body = body


def can_view(user, document):
    return document.owner == user.name or user.role == ADMIN
'''

BUGGY_AUTH = '''"""Authorization helpers."""

ADMIN = "admin"


class User:
    def __init__(self, name, role="member"):
        self.name = name
        self.role = role


class Document:
    def __init__(self, owner, body=""):
        self.owner = owner
        self.body = body


def can_view(user, document):
    return True
'''

EXISTING_TEST = '''from auth import Document, User, can_view


def test_owner_can_view_their_document():
    assert can_view(User("alice"), Document(owner="alice")) is True
'''

REGRESSION_TEST = '''from auth import Document, User, can_view


def test_another_member_cannot_view_someone_elses_document():
    assert can_view(User("bob"), Document(owner="alice")) is False
'''


def banner(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(repo), capture_output=True, text=True)


def build_fixture(root: Path) -> Path:
    """A tiny project whose feature branch introduces an authorisation bypass."""
    repo = root / "demo-api"
    repo.mkdir(parents=True)

    (repo / "auth.py").write_text(CORRECT_AUTH)
    (repo / "conftest.py").write_text("")
    (repo / "tests").mkdir()
    (repo / "tests" / "test_auth.py").write_text(EXISTING_TEST)

    git(repo, "init", "-q", "-b", "main")
    git(repo, "-c", "user.email=demo@local", "-c", "user.name=demo", "add", "-A")
    git(repo, "-c", "user.email=demo@local", "-c", "user.name=demo", "commit", "-q", "-m", "baseline")

    # The pull request under review: someone "simplified" the permission check.
    git(repo, "checkout", "-q", "-b", "feat/simplify-auth")
    (repo / "auth.py").write_text(BUGGY_AUTH)
    git(repo, "-c", "user.email=demo@local", "-c", "user.name=demo", "commit", "-qam", "simplify can_view")
    return repo


def scripted_lanes(diff: str):
    """Deterministic stand-in for the three model calls.

    The security lane points at the real added line, derived from the diff, so
    the finding exercises the real introduced-vs-inherited classification.
    """
    index = parse_unified_diff(diff)
    entry = index.files.get("auth.py")
    bug_line = next(
        (line for line in sorted(entry.added_lines) if line >= 1),
        None,
    ) if entry else None

    replies = {
        Lane.SECURITY: {
            "summary": "One exploitable authorisation bypass introduced by this change.",
            "findings": [
                {
                    "tier": "must_fix",
                    "title": "can_view() returns True for every caller",
                    "file": "auth.py",
                    "line": bug_line or 18,
                    "evidence": "return True",
                    "detail": (
                        "The permission check was replaced with an unconditional True, so any "
                        "authenticated member can read any other member's document. There is no "
                        "precondition an attacker must satisfy."
                    ),
                    "remediation": "Restore an explicit owner-or-admin comparison.",
                    "confidence": 0.95,
                }
            ],
        },
        Lane.CODE_REVIEW: {
            "summary": "The function no longer uses its arguments, which the type checker will not catch.",
            "findings": [
                {
                    "tier": "should_fix",
                    "title": "can_view() ignores both of its parameters",
                    "file": "auth.py",
                    "line": bug_line or 18,
                    "evidence": "def can_view(user, document):",
                    "detail": "Both arguments are now unused, which signals the check was dropped.",
                    "remediation": "Reinstate the comparison; the parameters are the point of the function.",
                    "confidence": 0.8,
                }
            ],
        },
        Lane.COMPLIANCE: {"summary": "No licensing or data-handling obligations are affected.", "findings": []},
    }

    def invoke(lane: Lane, system_prompt: str, user_prompt: str) -> str:
        return json.dumps(replies[lane])

    return invoke


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="use the configured model for the lanes")
    parser.add_argument("--keep", action="store_true", help="keep the temporary repository")
    args = parser.parse_args()

    root = Path(tempfile.mkdtemp(prefix="review-demo-"))
    try:
        repo = build_fixture(root)

        banner("1. The change under review")
        diff = collect_diff(repo, "main", "HEAD")
        print(f"repository: {repo}")
        print("branch:     feat/simplify-auth -> main\n")
        print(diff.strip())

        banner("2. Three-lane review (compliance / security / code review)")
        invoker = default_lane_invoker if args.live else scripted_lanes(diff)
        engine = ReviewEngine(invoker=invoker)
        report = engine.review(
            diff,
            repo="demo/demo-api",
            base_ref="main",
            head_ref="feat/simplify-auth",
            title="Simplify can_view",
        )
        print(render_report_markdown(report))

        blocking = [f for f in report.findings if f.severity.value in ("critical", "high")]
        if not blocking:
            print("\nNo blocking finding to fix; nothing further to demo.")
            return 0

        finding: ReviewFinding = blocking[0]
        print(f"\nSelected finding: [{finding.tier}] {finding.title} at {finding.location}")

        banner("3. On-demand fix: generate a candidate patch")
        test_command = f"{sys.executable} -m pytest tests/test_auth_regression.py -q"
        suite_command = f"{sys.executable} -m pytest -q"
        build_command = f"{sys.executable} -c 'import auth'"

        scrub = LocalGitSandbox(repo)
        try:
            (scrub.workdir / "auth.py").write_text(CORRECT_AUTH)
            (scrub.workdir / "tests" / "test_auth_regression.py").write_text(REGRESSION_TEST)
            scrub.intent_to_add()
            candidate_patch = scrub.diff()
        finally:
            scrub.cleanup()
        print(candidate_patch.strip())

        candidate = FixCandidate(
            patch=candidate_patch,
            test_command=test_command,
            suite_command=suite_command,
            build_command=build_command,
            notes="scripted demo candidate",
        )

        banner("4. Verify: does it actually fix anything?")
        sandbox = LocalGitSandbox(repo)
        try:
            outcome = VerifiedFixEngine(ScriptedCandidateGenerator([candidate])).fix(
                finding, sandbox, attempts=1
            )
        finally:
            sandbox.cleanup()

        for attempt in outcome.attempts:
            print(f"attempt {attempt.attempt}: {'PASS' if attempt.passed else 'REJECT'}")
            print(f"  test patch vs unpatched tree : failed_before={attempt.evidence.failed_before}")
            print(f"  same test after the fix      : passed_after={attempt.evidence.passed_after}")
            print(f"  build                        : {'passed' if attempt.build.ok else 'failed'}")
            print(f"  existing suite               : {'passed' if attempt.suite.ok else 'failed'}")
            print(f"  scope violations             : {attempt.verification.reasons or 'none'}")
            if attempt.evidence.before_output:
                tail = attempt.evidence.before_output.strip().splitlines()
                print(f"  before (tail)                : {tail[-1] if tail else ''}")
            if attempt.evidence.after_output:
                tail = attempt.evidence.after_output.strip().splitlines()
                print(f"  after  (tail)                : {tail[-1] if tail else ''}")
        print(f"\n{outcome.summary}")

        print()
        print(render_fix_markdown(outcome))

        if not outcome.verified:
            return 1

        banner("5. Publish as a branch (never a direct commit, never a merge)")
        published = FixPublisher(repo).commit(outcome, base_ref="feat/simplify-auth")
        print(f"branch     : {published.branch}")
        print(f"based on   : {published.base_ref}")
        print(f"commit     : {published.commit_sha[:12]}")
        print(f"files      : {', '.join(published.files)}")
        print("\nThe base branch is untouched:")
        print(git(repo, "show", f"{published.base_ref}:auth.py").stdout.splitlines()[-1])

        banner("Done")
        print("Review found it, the agent fixed it, and the fix was proven by a test")
        print("observed failing before the change and passing after it.")
        print(f"\nTemporary repository: {repo}")
        return 0
    finally:
        if args.keep:
            print(f"\n(kept {root})")
        else:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
