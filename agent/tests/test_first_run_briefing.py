"""Backend support for the first-run briefing.

The briefing lets a freshly-imported project choose *how* its first verification
runs: a full sweep, the suite at one commit, only the changes one commit
introduced, or the changes across a commit range. These tests pin the contract
that makes those choices real rather than cosmetic:

* the diff base a run is computed against, and its precedence over the
  compatibility ``commit_range`` field,
* rejection of a ref that could break out of the sandbox's generated shell,
* the base being threaded all the way to the pipeline,
* a "full" scope actually changing the planner's mission, and
* commit listing normalisation (including parents, which is what lets the UI
  express "only this commit" without a second round trip).
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from conftest import AUTH_HEADERS
from fastapi.testclient import TestClient
from pydantic import ValidationError

from agent.api.runs import RunRequest
from agent.github.app import GitHubAppClient
from agent.journeys.scope_planner import ScopePlanner, TestingConfig
from agent.main import app


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Diff-base resolution
# ---------------------------------------------------------------------------

def test_no_base_ref_means_default_base_branch():
    req = RunRequest(branch="main", sha="a" * 40)
    assert req.resolved_base_ref() is None


def test_explicit_base_ref_wins_over_commit_range():
    req = RunRequest(
        branch="main",
        sha="c" * 40,
        base_ref="b" * 40,
        commit_range=f"{'a' * 40}..{'c' * 40}",
    )
    assert req.resolved_base_ref() == "b" * 40


@pytest.mark.parametrize("raw", [f"{'a' * 40}..{'c' * 40}", f"{'a' * 40}...{'c' * 40}"])
def test_commit_range_start_becomes_the_diff_base(raw):
    req = RunRequest(branch="main", sha="c" * 40, commit_range=raw)
    assert req.resolved_base_ref() == "a" * 40


def test_bare_commit_range_is_treated_as_the_base():
    req = RunRequest(branch="main", sha="c" * 40, commit_range="release-1.2")
    assert req.resolved_base_ref() == "release-1.2"


def test_empty_base_ref_falls_back_to_commit_range():
    req = RunRequest(branch="main", sha="c" * 40, base_ref="   ", commit_range="main..feature")
    assert req.resolved_base_ref() == "main"


def test_shell_metacharacters_in_base_ref_are_rejected():
    # The base ref is formatted into the sandbox's clone script; anything that
    # could escape it must be refused at the API boundary.
    with pytest.raises(ValidationError):
        RunRequest(branch="main", sha="a" * 40, base_ref="main; rm -rf /")


def test_unicode_and_quotes_in_base_ref_are_rejected():
    for bad in ("main`whoami`", "main$(id)", 'main"', "main\nwhoami"):
        with pytest.raises(ValidationError):
            RunRequest(branch="main", sha="a" * 40, base_ref=bad)


# ---------------------------------------------------------------------------
# The base reaches the pipeline
# ---------------------------------------------------------------------------

@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_trigger_run_passes_resolved_diff_base_to_pipeline(mock_pipeline, client):
    res = client.post(
        "/runs",
        headers=AUTH_HEADERS,
        json={
            "branch": "feature/first-run",
            "sha": "d" * 40,
            "repo": "acme/storefront",
            "scope": "changed",
            "base_ref": "b" * 40,
            "force": True,
        },
    )
    assert res.status_code == 200
    assert res.json()["status"] == "queued"
    assert mock_pipeline.call_args.kwargs["diff_base"] == "b" * 40
    assert mock_pipeline.call_args.kwargs["scope"] == "changed"


@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_trigger_run_full_sweep_passes_scope_without_diff_base(mock_pipeline, client):
    res = client.post(
        "/runs",
        headers=AUTH_HEADERS,
        json={
            "branch": "main",
            "sha": "e" * 40,
            "repo": "acme/storefront",
            "scope": "full",
            "test_type": "functional",
            "force": True,
        },
    )
    assert res.status_code == 200
    assert mock_pipeline.call_args.kwargs["diff_base"] is None
    assert mock_pipeline.call_args.kwargs["scope"] == "full"


def test_trigger_run_rejects_unsafe_base_ref(client):
    res = client.post(
        "/runs",
        headers=AUTH_HEADERS,
        json={
            "branch": "main",
            "sha": "f" * 40,
            "repo": "acme/storefront",
            "base_ref": "main; touch /tmp/pwned",
        },
    )
    assert res.status_code == 422


@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_verifying_an_old_commit_does_not_redefine_the_baseline(mock_pipeline, client):
    """A run at a chosen commit must not overwrite the branch's baseline."""
    res = client.post(
        "/runs",
        headers=AUTH_HEADERS,
        json={
            "branch": "main",
            "sha": "b" * 40,
            "repo": "acme/storefront",
            "scope": "full",
            "update_baseline": False,
            "force": True,
        },
    )
    assert res.status_code == 200
    assert mock_pipeline.call_args.kwargs["update_baseline"] is False


@patch("agent.runner.pipeline.run_pipeline", new_callable=AsyncMock)
def test_baseline_update_defaults_to_true(mock_pipeline, client):
    res = client.post(
        "/runs",
        headers=AUTH_HEADERS,
        json={
            "branch": "main",
            "sha": "c" * 40,
            "repo": "acme/storefront",
            "scope": "full",
            "force": True,
        },
    )
    assert res.status_code == 200
    assert mock_pipeline.call_args.kwargs["update_baseline"] is True


# ---------------------------------------------------------------------------
# An explicit diff base must never silently become HEAD~1
# ---------------------------------------------------------------------------

def test_explicit_diff_base_fails_loudly_instead_of_falling_back():
    import subprocess

    from agent.runner.pipeline import GitDiffError, _get_git_diff

    def _fail(*args, **kwargs):
        raise subprocess.CalledProcessError(returncode=128, cmd=args[0])

    with patch("agent.runner.pipeline.subprocess.run", side_effect=_fail) as mock_run, \
         pytest.raises(GitDiffError, match="requested base"):
        _get_git_diff("container", "b" * 40, allow_parent_fallback=False)

    # Only the explicit base was attempted; no HEAD~1 guess was made.
    attempted = [call.args[0] for call in mock_run.call_args_list]
    assert not any("HEAD~1" in argv for argv in attempted)


def test_default_diff_base_keeps_the_single_commit_fallback():
    import subprocess
    from types import SimpleNamespace

    from agent.runner.pipeline import _get_git_diff

    def _run(args, **kwargs):
        if "HEAD~1" in args:
            return SimpleNamespace(stdout="fallback-diff")
        raise subprocess.CalledProcessError(returncode=128, cmd=args)

    with patch("agent.runner.pipeline.subprocess.run", side_effect=_run):
        assert _get_git_diff("container", "main") == "fallback-diff"


# ---------------------------------------------------------------------------
# Scope planner honours a full sweep
# ---------------------------------------------------------------------------

def _run_planner_and_capture_prompt(tmp_path, *, scope: str) -> str:
    """Run the planner with a stubbed agent and return the task prompt it saw."""
    planner = ScopePlanner(config=TestingConfig(max_routes=15))
    mock_agent = MagicMock()
    mock_agent.run.return_value = {
        "exit_status": "Submitted",
        "submission": "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n"
        + json.dumps([{"route": "/checkout", "focus": "verify"}]),
    }
    mock_agent.cost = 0.01

    with patch("agent.journeys.scope_planner.has_scope_planner_credentials", return_value=True), \
         patch("minisweagent.models.litellm_model.LitellmModel"), \
         patch("minisweagent.agents.default.DefaultAgent", return_value=mock_agent):
        result = planner.plan_test_scope(
            workspace_dir=tmp_path,
            discovered_routes=["/", "/checkout", "/pricing"],
            git_diff="diff --git a/app/checkout/page.tsx b/app/checkout/page.tsx",
            scope=scope,
        )

    assert result.success
    return mock_agent.run.call_args.kwargs.get("task") or mock_agent.run.call_args.args[0]


def test_full_scope_prompt_demands_every_route(tmp_path):
    prompt = _run_planner_and_capture_prompt(tmp_path, scope="full")
    assert "FULL REGRESSION SWEEP" in prompt
    assert "Select every discovered route" in prompt
    # A full sweep must not be told to filter by the diff.
    assert "not only the diff-affected ones" in prompt


def test_changed_scope_prompt_stays_diff_focused(tmp_path):
    prompt = _run_planner_and_capture_prompt(tmp_path, scope="changed")
    assert "CHANGED SURFACES" in prompt
    assert "FULL REGRESSION SWEEP" not in prompt


def test_scope_planner_still_enforces_allowlist_on_full_sweep(tmp_path):
    """A full sweep may not select routes that were never discovered."""
    planner = ScopePlanner(config=TestingConfig(max_routes=15))
    mock_agent = MagicMock()
    mock_agent.run.return_value = {
        "exit_status": "Submitted",
        "submission": "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n"
        + json.dumps(
            [
                {"route": "/checkout", "focus": "ok"},
                {"route": "/admin/delete-all", "focus": "invented"},
            ]
        ),
    }
    mock_agent.cost = 0.01

    with patch("agent.journeys.scope_planner.has_scope_planner_credentials", return_value=True), \
         patch("minisweagent.models.litellm_model.LitellmModel"), \
         patch("minisweagent.agents.default.DefaultAgent", return_value=mock_agent):
        result = planner.plan_test_scope(
            workspace_dir=tmp_path,
            discovered_routes=["/", "/checkout"],
            scope="full",
        )

    assert [p.route for p in result.planned_routes] == ["/checkout"]


@pytest.mark.asyncio
async def test_full_sweep_fallback_covers_every_route_when_planner_is_unavailable(tmp_path):
    """Without an LLM the full sweep must still visit every discovered route.

    The diff-derived fallback would narrow to /about only; a full sweep is
    supposed to be the whole-app visit-and-check, so that narrowing would
    silently turn the user's choice into the opposite of what they asked for.
    """
    from agent.analyzer.diff_analyzer import AnalysisResult
    from agent.runner.pipeline import _run_journeys

    artifacts = tmp_path / "artifacts"
    artifacts.mkdir(parents=True)

    analysis = AnalysisResult(
        intents=[],
        framework="nextjs",
        package_manager="npm",
        has_db_migrations=False,
        risk_score=0.1,
        suggested_journeys=[],
        affected_surfaces=["/about"],
    )

    visited: list[str] = []

    def _record_route(**kwargs):
        visited.append(kwargs["route"])
        return {
            "name": f"exploratory:{kwargs['route']}",
            "passed": True,
            "error": None,
            "duration_ms": 10.0,
        }

    with patch("agent.runner.pipeline.run_login_journey"), \
         patch("agent.journeys.browser_agent.run_route_journey", side_effect=_record_route), \
         patch(
             "agent.journeys.scope_planner.ScopePlanner.plan_test_scope",
             return_value=MagicMock(success=False, planned_routes=[]),
         ):
        await _run_journeys(
            base_url="http://localhost:3000",
            test_user_email="test@example.com",
            test_user_password="password",
            artifacts_dir=artifacts,
            analysis=analysis,
            intents=[],
            test_type="functional",
            run_id="run_full_sweep_fallback",
            source_root=tmp_path,
            discovered_routes=["/", "/about", "/faq", "/features"],
            scope="full",
        )

    assert visited == ["/", "/about", "/faq", "/features"]


@pytest.mark.asyncio
async def test_changed_scope_fallback_narrows_to_the_diff(tmp_path):
    """The default scope keeps the diff-derived fallback it always had."""
    from agent.analyzer.diff_analyzer import AnalysisResult
    from agent.runner.pipeline import _run_journeys

    artifacts = tmp_path / "artifacts"
    artifacts.mkdir(parents=True)

    analysis = AnalysisResult(
        intents=[],
        framework="nextjs",
        package_manager="npm",
        has_db_migrations=False,
        risk_score=0.1,
        suggested_journeys=[],
        affected_surfaces=["/about"],
    )

    visited: list[str] = []

    def _record_route(**kwargs):
        visited.append(kwargs["route"])
        return {
            "name": f"exploratory:{kwargs['route']}",
            "passed": True,
            "error": None,
            "duration_ms": 10.0,
        }

    with patch("agent.runner.pipeline.run_login_journey"), \
         patch("agent.journeys.browser_agent.run_route_journey", side_effect=_record_route), \
         patch(
             "agent.journeys.scope_planner.ScopePlanner.plan_test_scope",
             return_value=MagicMock(success=False, planned_routes=[]),
         ):
        await _run_journeys(
            base_url="http://localhost:3000",
            test_user_email="test@example.com",
            test_user_password="password",
            artifacts_dir=artifacts,
            analysis=analysis,
            intents=[],
            test_type="functional",
            run_id="run_changed_fallback",
            source_root=tmp_path,
            discovered_routes=["/", "/about", "/faq", "/features"],
            scope="changed",
        )

    assert visited == ["/about"]


# ---------------------------------------------------------------------------
# Commit listing
# ---------------------------------------------------------------------------

def _fake_async_client(payload, *, status: int = 200):
    response = MagicMock()
    response.status_code = status
    response.json.return_value = payload
    response.raise_for_status = MagicMock()

    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


@pytest.mark.asyncio
async def test_list_commits_normalises_github_payload():
    payload = [
        {
            "sha": "c" * 40,
            "html_url": "https://github.com/acme/storefront/commit/ccc",
            "commit": {
                "message": "Fix checkout total\n\nLonger body",
                "author": {"name": "Ada", "date": "2026-01-02T03:04:05Z"},
            },
            "author": {"login": "ada"},
            "parents": [{"sha": "b" * 40}],
        }
    ]
    fake = _fake_async_client(payload)

    with patch("agent.github.app.httpx.AsyncClient", return_value=fake):
        commits = await GitHubAppClient(token="t").list_commits("acme", "storefront", ref="main")

    assert len(commits) == 1
    commit = commits[0]
    assert commit["sha"] == "c" * 40
    assert commit["message"] == "Fix checkout total"
    assert commit["message_full"].startswith("Fix checkout total")
    assert commit["author"] == "Ada"
    assert commit["parents"] == ["b" * 40]
    # The ref and a bounded page size must actually be sent to GitHub.
    assert fake.get.call_args.kwargs["params"]["sha"] == "main"
    assert 1 <= fake.get.call_args.kwargs["params"]["per_page"] <= 100


@pytest.mark.asyncio
async def test_list_commits_omits_ref_param_when_not_given():
    fake = _fake_async_client([])
    with patch("agent.github.app.httpx.AsyncClient", return_value=fake):
        await GitHubAppClient(token="t").list_commits("acme", "storefront")
    assert "sha" not in fake.get.call_args.kwargs["params"]


def test_commits_endpoint_requires_owner_repo_form(client):
    res = client.get("/api/github/commits?repo=storefront", headers=AUTH_HEADERS)
    assert res.status_code == 400
    assert "owner/repository" in res.json()["detail"]


def test_commits_endpoint_returns_normalised_list(client):
    payload = [
        {
            "sha": "a" * 40,
            "commit": {
                "message": "Initial",
                "author": {"name": "Ada", "date": "2026-01-01T00:00:00Z"},
            },
            "parents": [],
        }
    ]
    fake = _fake_async_client(payload)
    with patch("agent.github.app.httpx.AsyncClient", return_value=fake):
        res = client.get(
            "/api/github/commits?repo=acme/storefront&ref=main",
            headers=AUTH_HEADERS,
        )

    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["commits"][0]["sha"] == "a" * 40
