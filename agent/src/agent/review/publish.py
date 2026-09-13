"""Publishing a verified fix.

Deliberately separate from verification, and deliberately incapable of the
dangerous thing. A verified patch becomes a *new branch* and, at most, a pull
request against the branch that was under review. It never commits to the base
branch, never bypasses branch protection, and never merges — so the normal CI
and human review that apply to every other change apply to this one too.
"""

from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from agent.review.fixer import FixOutcome
from agent.review.render import render_fix_markdown

logger = logging.getLogger("agent.review.publish")

_SAFE_REF = re.compile(r"^[A-Za-z0-9._/@+-]+$")


class PublishError(RuntimeError):
    """Raised when a fix could not be published, with the reason."""


@dataclass
class PublishedFix:
    """Where a verified fix landed."""

    branch: str
    base_ref: str
    commit_sha: str
    files: list[str] = field(default_factory=list)
    pr_url: str | None = None


def _run_git(repo_dir: Path, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=str(repo_dir),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def branch_name_for(finding_fingerprint: str, slug: str = "") -> str:
    """A deterministic branch name for a fix, so re-running cannot pile up branches."""
    slug_part = re.sub(r"[^a-z0-9]+", "-", (slug or "").lower()).strip("-")[:40]
    suffix = finding_fingerprint[:12] or "fix"
    return f"review-fix/{suffix}" + (f"-{slug_part}" if slug_part else "")


class FixPublisher:
    """Turns a verified :class:`FixOutcome` into a branch and a commit."""

    def __init__(self, repo_dir: str | Path) -> None:
        self.repo_dir = Path(repo_dir).resolve()

    def _current_ref(self) -> str:
        result = _run_git(self.repo_dir, "rev-parse", "--abbrev-ref", "HEAD")
        if result.returncode != 0:
            raise PublishError(f"not a git repository: {self.repo_dir}")
        return result.stdout.strip()

    def commit(
        self,
        outcome: FixOutcome,
        *,
        base_ref: str | None = None,
        branch: str | None = None,
    ) -> PublishedFix:
        """Create ``review-fix/<fingerprint>`` and commit the winning patch to it."""
        if not outcome.verified or not outcome.patch.strip():
            raise PublishError("refusing to publish: no verified patch on this outcome")

        base = base_ref or self._current_ref()
        if not _SAFE_REF.match(base):
            raise PublishError(f"unsafe base ref: {base!r}")

        target = branch or branch_name_for(outcome.fingerprint, outcome.title)
        if not _SAFE_REF.match(target):
            raise PublishError(f"unsafe branch name: {target!r}")
        if target == base:
            raise PublishError("refusing to publish a fix directly onto the base branch")

        existing = _run_git(self.repo_dir, "rev-parse", "--verify", "--quiet", target)
        if existing.returncode == 0:
            # Deterministic naming means a rerun lands on the same branch: move it
            # to the base rather than stacking commits on an old attempt.
            checkout = _run_git(self.repo_dir, "checkout", "-q", "-B", target, base)
        else:
            checkout = _run_git(self.repo_dir, "checkout", "-q", "-b", target, base)
        if checkout.returncode != 0:
            raise PublishError(f"could not create branch {target}: {checkout.stderr.strip()[:200]}")

        apply_result = subprocess.run(
            ["git", "apply", "--whitespace=nowarn", "-"],
            cwd=str(self.repo_dir),
            input=outcome.patch,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if apply_result.returncode != 0:
            _run_git(self.repo_dir, "checkout", "-q", base)
            raise PublishError(f"verified patch no longer applies to {base}: {apply_result.stderr.strip()[:200]}")

        _run_git(self.repo_dir, "add", "-A")
        message = (
            f"fix: {outcome.title}\n\n"
            f"Verified fix for review finding {outcome.fingerprint}.\n"
            f"{outcome.summary}\n\n"
            f"Assisted-by: mini-swe-agent\n"
            f"Review-Finding: {outcome.fingerprint}\n"
        )
        commit_result = subprocess.run(
            [
                "git",
                "-c",
                "user.email=review@local",
                "-c",
                "user.name=review-engine",
                "commit",
                "-q",
                "-m",
                message,
            ],
            cwd=str(self.repo_dir),
            capture_output=True,
            text=True,
            timeout=60,
        )
        if commit_result.returncode != 0:
            _run_git(self.repo_dir, "checkout", "-q", base)
            raise PublishError(f"could not commit the fix: {commit_result.stderr.strip()[:200]}")

        sha = _run_git(self.repo_dir, "rev-parse", "HEAD").stdout.strip()
        files = _run_git(self.repo_dir, "diff", "--name-only", f"{base}..HEAD").stdout.split()
        return PublishedFix(branch=target, base_ref=base, commit_sha=sha, files=files)

    async def open_pull_request(
        self,
        published: PublishedFix,
        *,
        owner: str,
        repo: str,
        outcome: FixOutcome,
        installation_id: int | None = None,
    ) -> str:
        """Open a PR for the published branch. Requires GitHub App credentials."""
        from agent.github.app import GitHubAppClient

        client = GitHubAppClient()
        body = (
            f"{render_fix_markdown(outcome)}\n\n"
            f"---\n_This change was authored by an agent and verified against a "
            f"regression test that was observed failing before the fix. It is a normal "
            f"pull request: review it, and let CI and branch protection apply._"
        )
        return await client.create_pull_request(
            owner=owner,
            repo=repo,
            title=f"fix: {outcome.title}",
            head=published.branch,
            base=published.base_ref,
            body=body,
            installation_id=installation_id,
        )
