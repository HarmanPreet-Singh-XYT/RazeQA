"""Tests for in-container PR-head fetching (fork pull requests).

A pull request opened from a fork keeps its head commit only in the base
repository's ``refs/pull/<n>/head``; a plain clone of the base repo has no
branch for it, so ``git checkout <head-sha>`` fails. When the PR number is
known, the clone script must fetch that ref before checking out — and the PR
number must not be able to inject shell syntax.
"""

from __future__ import annotations

import types

import pytest

from agent.sandbox.docker_sandbox import (
    SandboxBootError,
    clone_repo_into_container,
)


def _capture_clone_script(monkeypatch, **kwargs) -> str:
    captured: dict[str, str] = {}

    def _fake_exec(container, shell_cmd, cwd="/", timeout=600):
        captured["script"] = shell_cmd
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr("agent.sandbox.docker_sandbox._exec", _fake_exec)
    clone_repo_into_container(
        container="sandbox",
        owner="acme",
        repo="web",
        sha="a" * 40,
        base_ref="main",
        github_token=None,
        **kwargs,
    )
    return captured["script"]


def test_pr_number_adds_fork_ref_fetch(monkeypatch) -> None:
    script = _capture_clone_script(monkeypatch, pr_number=123)
    assert "refs/pull/123/head" in script
    assert "git cat-file -e" in script


def test_no_pr_number_keeps_the_plain_clone(monkeypatch) -> None:
    script = _capture_clone_script(monkeypatch, pr_number=None)
    assert "refs/pull/" not in script


@pytest.mark.parametrize("bad", ["123; rm -rf /", "$(whoami)", "-1", 0])
def test_invalid_pr_number_is_rejected(monkeypatch, bad) -> None:
    def _fail_exec(*args, **kwargs):
        raise AssertionError("no shell command may run for an invalid PR number")

    monkeypatch.setattr("agent.sandbox.docker_sandbox._exec", _fail_exec)
    with pytest.raises(SandboxBootError):
        clone_repo_into_container(
            container="sandbox",
            owner="acme",
            repo="web",
            sha="a" * 40,
            base_ref="main",
            github_token=None,
            pr_number=bad,
        )
