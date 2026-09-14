"""Unit tests for the AutoQA AI Copilot endpoint.

These cover the two things that must never regress:

* **Intent routing** — money is only spent when the user actually asked for a
  run. A question *about* runs must not dispatch one.
* **Grounding** — the answer is built from a context block assembled from the
  caller's project row and run history, and the reply is extracted from the
  model response rather than fabricated.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from agent.api.copilot import (
    CopilotChatRequest,
    CopilotChatResponse,
    ProjectContext,
    RunContext,
    _extract_text,
    build_context_block,
    wants_run,
)
from agent.main import app


@pytest.fixture
def client():
    import os

    token = os.environ.get("AGENT_API_KEY", "test-key")
    os.environ["AGENT_API_KEY"] = token
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


# ---------------------------------------------------------------------------
# Intent routing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "run tests",
        "Run the tests please",
        "trigger verification on active branch",
        "Trigger a test run",
        "verify my branch",
        "audit this site",
        "re-run the full suite",
        "verify all routes on this site now",
    ],
)
def test_trigger_intent_detected(message):
    assert wants_run(message) is True


@pytest.mark.parametrize(
    "message",
    [
        "hey",
        "What is the status of my latest test run?",
        "Explain any regressions or failures",
        "How do I trigger a test run?",
        "Why did the last run fail?",
        "What happens when I start a run?",
        "How is the external website performing?",
        "Check HTTP response codes & SSL",
        "",
        "   ",
    ],
)
def test_non_trigger_messages_do_not_dispatch(message):
    assert wants_run(message) is False


# ---------------------------------------------------------------------------
# Context grounding
# ---------------------------------------------------------------------------


def test_context_block_includes_project_settings_and_runs():
    request = CopilotChatRequest(
        message="status?",
        project=ProjectContext(
            repo_full_name="acme/storefront",
            name="storefront",
            type="git",
            default_branch="main",
            settings={
                "framework": "nextjs",
                "scope": "full",
                "auto_repair": {"enabled": True, "max_steps": 8, "cost_limit_usd": 2.5},
                "roles": {"admin": {"email": "a@b.c"}, "user": {"email": "u@b.c"}},
                "roles_secret_marker": "must-not-leak",
            },
        ),
        runs=[
            RunContext(
                run_id="run-1",
                branch="main",
                sha="abcdef1234567890",
                status="failed",
                created_at="2026-09-13T00:00:00Z",
                summary="Checkout journey timed out.",
            )
        ],
    )

    block = build_context_block(request)

    assert "acme/storefront" in block
    assert "framework: nextjs" in block
    assert "auto_repair: enabled=True" in block
    assert "configured_test_roles: admin, user" in block
    assert "run-1" in block
    assert "status=failed" in block
    # Long SHAs are truncated so the prompt stays small.
    assert "abcdef123456" in block
    assert "abcdef1234567890" not in block


def test_context_block_states_absence_instead_of_inventing():
    block = build_context_block(CopilotChatRequest(message="hi"))
    assert "(none selected)" in block
    assert "no runs recorded" in block


# ---------------------------------------------------------------------------
# Model response extraction
# ---------------------------------------------------------------------------


def test_extract_text_from_strands_dict_message():
    """Current Strands returns ``message`` as a dict of content blocks."""
    result = {
        "message": {
            "role": "assistant",
            "content": [
                {"text": "The run failed."},
                {"reasoningContent": {"reasoningText": {"text": "hidden"}}},
            ],
        }
    }
    assert _extract_text(result) == "The run failed."


def test_extract_text_from_object_message():
    class Block:
        def __init__(self, text):
            self.text = text

    class Message:
        def __init__(self):
            self.content = [Block("first"), Block("second")]

    class Result:
        def __init__(self):
            self.message = Message()

    assert _extract_text(Result()) == "first\nsecond"


def test_extract_text_returns_empty_when_model_said_nothing():
    assert _extract_text({"message": {"role": "assistant", "content": []}}) == ""


# ---------------------------------------------------------------------------
# Chat endpoint
# ---------------------------------------------------------------------------


def test_chat_rejects_empty_message(client):
    res = client.post("/api/copilot/chat", json={"message": "   "})
    assert res.status_code == 400


def test_chat_uses_model_and_never_invents_a_run(client, monkeypatch):
    """With no dispatch allowed, no run id may appear in the response."""
    from agent.api import copilot as copilot_module

    async def fake_invoke(agent, prompt):
        assert "ACTIVE PROJECT" in prompt
        assert "acme/storefront" in prompt
        return {"message": {"role": "assistant", "content": [{"text": "That run failed."}]}}

    monkeypatch.setattr(copilot_module, "_invoke_agent", fake_invoke)
    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)
    monkeypatch.setattr(
        copilot_module,
        "create_strands_agent",
        lambda *a, **k: object(),
    )

    res = client.post(
        "/api/copilot/chat",
        json={
            "message": "What happened in my last run?",
            "allow_trigger": False,
            "project": {"repo_full_name": "acme/storefront", "type": "git"},
            "runs": [{"run_id": "run-9", "status": "failed"}],
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["reply"] == "That run failed."
    assert data["triggered_run"] is None


def test_chat_dispatches_run_and_reports_real_id(client, monkeypatch):
    """A trigger request reports the pipeline's own run id, not a synthetic one."""
    from agent.api import copilot as copilot_module

    async def fake_invoke(agent, prompt):
        # The dispatch result must be visible to the model in the prompt.
        assert "run-real-1" in prompt
        return {"message": {"role": "assistant", "content": [{"text": "Started."}]}}

    async def fake_dispatch(request):
        return {
            "run_id": "run-real-1",
            "status": "queued",
            "repo": "acme/storefront",
            "branch": "main",
            "message": "New test run enqueued and dispatched.",
            "fresh": True,
        }

    monkeypatch.setattr(copilot_module, "_invoke_agent", fake_invoke)
    monkeypatch.setattr(copilot_module, "_dispatch_run_async", fake_dispatch)
    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)
    monkeypatch.setattr(copilot_module, "create_strands_agent", lambda *a, **k: object())

    res = client.post(
        "/api/copilot/chat",
        json={
            "message": "trigger verification on active branch",
            "allow_trigger": True,
            "project": {"repo_full_name": "acme/storefront", "type": "git"},
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["triggered_run"]["run_id"] == "run-real-1"
    assert data["triggered_run"]["status"] == "queued"


def test_chat_reports_dispatch_failure_honestly(client, monkeypatch):
    """A failing dispatch must surface as failed, never as a promised run."""
    from agent.api import copilot as copilot_module

    async def fake_invoke(agent, prompt):
        return {"message": {"role": "assistant", "content": [{"text": "Dispatch failed."}]}}

    async def boom(request):
        raise RuntimeError("sandbox unavailable")

    monkeypatch.setattr(copilot_module, "_invoke_agent", fake_invoke)
    monkeypatch.setattr(copilot_module, "_dispatch_run_async", boom)
    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)
    monkeypatch.setattr(copilot_module, "create_strands_agent", lambda *a, **k: object())

    res = client.post(
        "/api/copilot/chat",
        json={
            "message": "run tests",
            "allow_trigger": True,
            "project": {"repo_full_name": "acme/storefront", "type": "git"},
        },
    )

    assert res.status_code == 200
    triggered = res.json()["triggered_run"]
    assert triggered["status"] == "failed"
    assert triggered["run_id"] is None
    assert "sandbox unavailable" in triggered["message"]


def test_chat_reports_unconfigured_model(client, monkeypatch):
    from agent.api import copilot as copilot_module

    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: False)

    res = client.post("/api/copilot/chat", json={"message": "hi"})
    assert res.status_code == 503
    assert "ANTHROPIC_API_KEY" in res.json()["detail"] or "GEMINI_API_KEY" in res.json()["detail"]


def test_health_reports_provider_readiness(client, monkeypatch):
    from agent.api import copilot as copilot_module

    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)
    res = client.get("/api/copilot/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ready"


def test_copilot_requires_bearer_token():
    """The copilot sits behind the same auth middleware as every other route."""
    with TestClient(app) as unauthenticated:
        res = unauthenticated.post("/api/copilot/chat", json={"message": "hi"})
    assert res.status_code in (401, 403)


def test_response_schema_is_serialisable():
    response = CopilotChatResponse(reply="ok", model="m", provider="p")
    assert response.model_dump()["triggered_run"] is None
    assert response.model_dump()["tool_calls"] == []


# ---------------------------------------------------------------------------
# Agentic tools
#
# The copilot is a tool-using agent. These tests pin the two properties that
# make that safe: tools are scoped to the resolved project (the model supplies
# arguments, never a repo), and a run is only ever started once per turn and
# only when the caller permitted it.
# ---------------------------------------------------------------------------


def _turn(
    message: str = "hi",
    *,
    allow_trigger: bool = True,
    repo: str | None = "acme/storefront",
    mode: str = "standard",
    approvals: list[str] | None = None,
    max_tool_calls: int = 8,
):
    from agent.api.copilot import _TurnState

    return _TurnState(
        request=CopilotChatRequest(
            message=message,
            allow_trigger=allow_trigger,
            mode=mode,
            approvals=approvals or [],
            max_tool_calls=max_tool_calls,
            project=ProjectContext(repo_full_name=repo, type="git") if repo else None,
        )
    )


def _tool(tools, name):
    return next(t for t in tools if t.tool_name == name)


def _payload(result):
    return json.loads(result["content"][0]["text"])


def test_tools_are_built_for_every_turn():
    from agent.api.copilot import ALL_TOOLS, build_copilot_tools

    tools = build_copilot_tools(_turn(), [])
    assert {t.tool_name for t in tools} == set(ALL_TOOLS)
    assert len(tools) == len(ALL_TOOLS) == 16


def test_list_runs_is_scoped_to_the_active_project(monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    class Store:
        def list_all(self, *, repo=None, limit=None, **kwargs):
            captured.update(repo=repo, limit=limit)
            return []

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    _tool(tools, "list_recent_runs")(limit=3)

    # The model asked for 3 runs; it never named a repository.
    assert captured["repo"] == "acme/storefront"
    assert captured["limit"] == 3
    assert trace[-1].status == "ok"


def test_list_runs_caps_the_row_count(monkeypatch):
    from agent.api import copilot as copilot_module
    from agent.api.copilot import MAX_TOOL_ROWS

    captured: dict = {}

    class Store:
        def list_all(self, *, repo=None, limit=None, **kwargs):
            captured["limit"] = limit
            return []

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())

    tools = copilot_module.build_copilot_tools(_turn(), [])
    _tool(tools, "list_recent_runs")(limit=10_000)
    assert captured["limit"] == MAX_TOOL_ROWS


def test_get_run_details_refuses_a_run_from_another_project(monkeypatch):
    from agent.api import copilot as copilot_module

    class Record:
        def model_dump(self):
            return {"run_id": "run-other", "repo": "someone/else", "status": "failed"}

    class Store:
        def get(self, run_id):
            return Record()

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    result = _tool(tools, "get_run_details")(run_id="run-other")

    assert trace[-1].status == "denied"
    assert result["status"] == "error"
    assert "does not belong" in _payload(result)["error"]


def test_get_run_details_returns_cases_for_the_active_project(monkeypatch):
    from agent.api import copilot as copilot_module

    class Record:
        def model_dump(self):
            return {"run_id": "run-1", "repo": "acme/storefront", "status": "failed"}

    class Store:
        def get(self, run_id):
            return Record()

    class Insights:
        def list_test_cases(self, run_id):
            return [{"name": "checkout", "status": "failed", "severity": "high", "error": "timeout"}]

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())
    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    result = _tool(tools, "get_run_details")(run_id="run-1")

    payload = _payload(result)
    assert payload["run"]["run_id"] == "run-1"
    assert payload["test_cases"][0]["name"] == "checkout"
    assert trace[-1].status == "ok"


def test_list_findings_passes_the_status_filter(monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    class Insights:
        def list_findings(self, repo, status=None):
            captured.update(repo=repo, status=status)
            return [{"title": "Broken link", "severity": "low", "status": "dismissed"}]

    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())

    tools = copilot_module.build_copilot_tools(_turn(), [])
    payload = _payload(_tool(tools, "list_findings")(status="dismissed"))

    assert captured == {"repo": "acme/storefront", "status": "dismissed"}
    assert payload["findings"][0]["title"] == "Broken link"


def test_list_findings_all_omits_the_status_filter(monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    class Insights:
        def list_findings(self, repo, status=None):
            captured["status"] = status
            return []

    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())

    tools = copilot_module.build_copilot_tools(_turn(), [])
    _tool(tools, "list_findings")(status="all")
    assert captured["status"] is None


def test_trigger_tool_is_denied_when_the_turn_forbids_it(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module

    async def boom(request, **kwargs):
        raise AssertionError("must not dispatch when allow_trigger is False")

    monkeypatch.setattr(copilot_module, "_dispatch_run_async", boom)

    state = _turn(allow_trigger=False)
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)
    result = asyncio.run(_tool(tools, "trigger_verification")(scope="full"))

    assert result["status"] == "error"
    assert trace[-1].status == "denied"
    assert state.triggered is None


def test_trigger_tool_dispatches_a_real_run_and_reports_its_id(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module

    async def fake_dispatch(request, *, scope="changed", test_type="functional"):
        assert scope == "full"
        assert test_type == "exploratory"
        return {
            "run_id": "run-real-7",
            "status": "queued",
            "repo": "acme/storefront",
            "branch": "main",
            "message": "enqueued",
        }

    monkeypatch.setattr(copilot_module, "_dispatch_run_async", fake_dispatch)

    state = _turn("run a full exploratory pass")
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)
    payload = _payload(
        asyncio.run(_tool(tools, "trigger_verification")(scope="full", test_type="exploratory"))
    )

    assert payload["run_id"] == "run-real-7"
    assert state.triggered["run_id"] == "run-real-7"
    assert trace[-1].status == "ok"


def test_trigger_tool_does_not_double_dispatch_after_the_precheck(monkeypatch):
    """The deterministic pre-check and the tool must not start two runs."""
    import asyncio

    from agent.api import copilot as copilot_module

    async def boom(request, **kwargs):
        raise AssertionError("a run was already dispatched this turn")

    monkeypatch.setattr(copilot_module, "_dispatch_run_async", boom)

    state = _turn("run tests")
    state.triggered = {"run_id": "run-precheck", "status": "queued"}
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)
    payload = _payload(asyncio.run(_tool(tools, "trigger_verification")()))

    assert payload["already_dispatched"] is True
    assert payload["run_id"] == "run-precheck"


def test_chat_hands_the_agent_its_tools(client, monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    def fake_factory(role, system_prompt=None, tools=None, **kwargs):
        captured["tools"] = tools
        return object()

    async def fake_invoke(agent, prompt):
        return {"message": {"role": "assistant", "content": [{"text": "ok"}]}}

    monkeypatch.setattr(copilot_module, "create_strands_agent", fake_factory)
    monkeypatch.setattr(copilot_module, "_invoke_agent", fake_invoke)
    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)

    res = client.post(
        "/api/copilot/chat",
        json={
            "message": "What keeps failing?",
            "project": {"repo_full_name": "acme/storefront", "type": "git"},
        },
    )

    assert res.status_code == 200
    assert len(captured["tools"]) == 16
    assert res.json()["tool_calls"] == []
    assert res.json()["pending_approvals"] == []


# ---------------------------------------------------------------------------
# Permission modes, approvals, and the tool budget
# ---------------------------------------------------------------------------


def test_read_only_mode_blocks_state_changes_but_allows_reads(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module

    class Store:
        def list_all(self, *, repo=None, limit=None, **kwargs):
            return []

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())

    state = _turn(mode="read_only")
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)

    # A read is fine.
    _tool(tools, "list_recent_runs")(limit=1)
    assert trace[-1].status == "ok"

    # A dispatch is refused before it can reach the pipeline.
    async def boom(request, **kwargs):
        raise AssertionError("read-only must not dispatch")

    monkeypatch.setattr(copilot_module, "_dispatch_run_async", boom)
    denied = asyncio.run(_tool(tools, "trigger_verification")())
    assert _payload(denied)["error"]
    assert trace[-1].status == "denied"
    assert state.triggered is None


def test_standard_mode_requires_approval_for_apply_and_comment(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module

    state = _turn(mode="standard")
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)

    result = asyncio.run(_tool(tools, "apply_run_fix")(run_id="run-1"))

    assert trace[-1].status == "pending_approval"
    assert result["status"] == "error"
    assert len(state.pending) == 1
    pending = state.pending[0]
    assert pending.tool == "apply_run_fix"
    assert pending.action_id.startswith("apply_run_fix:")
    assert _payload(result)["status"] == "pending_approval"


def test_approval_lets_the_same_call_through(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module
    from agent.api.copilot import action_signature

    action_id = action_signature("apply_run_fix", {"run_id": "run-1"})

    class Record:
        def model_dump(self):
            return {"run_id": "run-1", "repo": "acme/storefront", "status": "failed"}

    class Store:
        def get(self, run_id):
            return Record()

    async def fake_apply(run_id, background_tasks):
        return {"applied_files": ["src/app.ts"], "run_id": run_id}

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())
    monkeypatch.setattr("agent.api.runs.apply_run_fix", fake_apply)

    state = _turn(mode="standard", approvals=[action_id])
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)

    result = asyncio.run(_tool(tools, "apply_run_fix")(run_id="run-1"))

    assert trace[-1].status == "ok"
    assert _payload(result)["applied_files"] == ["src/app.ts"]
    assert state.pending == []


def test_autonomous_mode_skips_approval(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module

    class Record:
        def model_dump(self):
            return {"run_id": "run-1", "repo": "acme/storefront", "status": "failed"}

    class Store:
        def get(self, run_id):
            return Record()

    async def fake_apply(run_id, background_tasks):
        return {"applied_files": [], "run_id": run_id}

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())
    monkeypatch.setattr("agent.api.runs.apply_run_fix", fake_apply)

    state = _turn(mode="autonomous")
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)

    asyncio.run(_tool(tools, "apply_run_fix")(run_id="run-1"))

    assert trace[-1].status == "ok"
    assert state.pending == []


def test_approval_signature_is_argument_specific():
    from agent.api.copilot import action_signature

    assert action_signature("apply_run_fix", {"run_id": "a"}) != action_signature(
        "apply_run_fix", {"run_id": "b"}
    )
    assert action_signature("apply_run_fix", {"run_id": "a"}) == action_signature(
        "apply_run_fix", {"run_id": "a"}
    )


def test_tool_budget_stops_further_calls(monkeypatch):
    from agent.api import copilot as copilot_module

    class Store:
        def list_all(self, *, repo=None, limit=None, **kwargs):
            return []

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())

    state = _turn(max_tool_calls=1)
    trace = []
    tools = copilot_module.build_copilot_tools(state, trace)

    _tool(tools, "list_recent_runs")(limit=1)
    result = _tool(tools, "list_findings")()

    assert state.steps == 1
    assert "budget exhausted" in _payload(result)["error"]
    assert trace[-1].status == "error"


def test_tool_budget_is_capped_whatever_the_caller_asks(monkeypatch):
    from agent.api.copilot import MAX_TOOL_BUDGET

    state = _turn(max_tool_calls=10_000)
    assert state.budget == MAX_TOOL_BUDGET


# ---------------------------------------------------------------------------
# Expanded tool set
# ---------------------------------------------------------------------------


def test_set_finding_status_scopes_to_the_project(monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    class Insights:
        def _project_id(self, repo):
            return "proj-1"

        def set_finding_status(self, **kwargs):
            captured.update(kwargs)
            return {"id": kwargs["finding_id"], "status": kwargs["status"]}

    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())
    monkeypatch.setattr(copilot_module, "_project_key", lambda repo: "proj-1")

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    result = _tool(tools, "set_finding_status")(finding_id="f-1", status="dismissed", reason="known")

    assert captured["project_ids"] == ["proj-1"]
    assert captured["finding_id"] == "f-1"
    assert captured["status"] == "dismissed"
    assert trace[-1].status == "ok"
    assert _payload(result)["status"] == "dismissed"


def test_set_finding_status_reports_a_missing_row(monkeypatch):
    from agent.api import copilot as copilot_module

    class Insights:
        def set_finding_status(self, **kwargs):
            return None

    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())
    monkeypatch.setattr(copilot_module, "_project_key", lambda repo: "proj-1")

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    result = _tool(tools, "set_finding_status")(finding_id="missing")

    assert trace[-1].status == "error"
    assert "was not found" in _payload(result)["error"]


def test_search_findings_matches_title_and_category(monkeypatch):
    from agent.api import copilot as copilot_module

    class Insights:
        def list_findings(self, repo, status=None):
            return [
                {"id": "f-1", "title": "Checkout button unresponsive", "status": "open"},
                {"id": "f-2", "title": "Slow hero image", "category": "performance", "status": "open"},
            ]

    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    payload = _payload(_tool(tools, "search_findings")(query="checkout"))

    assert payload["count"] == 1
    assert payload["findings"][0]["finding_id"] == "f-1"


def test_compare_runs_classifies_regressions_and_recoveries(monkeypatch):
    from agent.api import copilot as copilot_module

    cases = {
        "run-base": [
            {"name": "login", "status": "passed"},
            {"name": "checkout", "status": "passed"},
            {"name": "search", "status": "failed"},
        ],
        "run-head": [
            {"name": "login", "status": "failed"},
            {"name": "checkout", "status": "passed"},
            {"name": "search", "status": "passed"},
        ],
    }

    class Insights:
        def list_test_cases(self, run_id):
            return cases.get(run_id, [])

    monkeypatch.setattr("agent.db.pr_insights.PRInsightStore", lambda: Insights())

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    payload = _payload(_tool(tools, "compare_runs")(base_run_id="run-base", head_run_id="run-head"))

    assert [r["name"] for r in payload["regressions"]] == ["login"]
    assert [r["name"] for r in payload["recoveries"]] == ["search"]


def test_quality_analytics_is_scoped_to_the_project(monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    class Store:
        def list_all(self, *, repo=None, limit=None, **kwargs):
            captured["repo"] = repo
            return []

    class Metrics:
        def to_dict(self):
            return {"pass_rate": 0.9}

    class Aggregator:
        def aggregate_runs(self, runs):
            return Metrics()

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())
    monkeypatch.setattr(
        "agent.analyzer.fleet_analytics.default_fleet_aggregator", Aggregator()
    )

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    payload = _payload(_tool(tools, "get_quality_analytics")())

    assert captured["repo"] == "acme/storefront"
    assert payload["metrics"] == {"pass_rate": 0.9}


def test_saved_tests_tool_uses_the_project_loader(monkeypatch):
    from agent.api import copilot as copilot_module

    captured: dict = {}

    def fake_loader(repo, limit=100):
        captured.update(repo=repo, limit=limit)
        return [{"name": "checkout flow", "route": "/checkout", "category": "happy_path"}]

    monkeypatch.setattr("agent.projects.saved_tests.load_saved_tests", fake_loader)

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    payload = _payload(_tool(tools, "list_saved_tests")(limit=5))

    assert captured["repo"] == "acme/storefront"
    assert payload["saved_tests"][0]["name"] == "checkout flow"


def test_comment_on_pull_request_posts_via_github(monkeypatch):
    import asyncio

    from agent.api import copilot as copilot_module

    captured: dict = {}

    class Client:
        async def post_pr_comment(self, owner, repo, number, body, installation_id=None):
            captured.update(owner=owner, repo=repo, number=number, body=body)
            return "https://github.com/acme/storefront/pull/7#issuecomment-1"

    monkeypatch.setattr("agent.github.app.GitHubAppClient", Client)

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(mode="autonomous"), trace)
    payload = _payload(
        asyncio.run(_tool(tools, "comment_on_pull_request")(pr_number=7, body="Verified."))
    )

    assert captured == {
        "owner": "acme",
        "repo": "storefront",
        "number": 7,
        "body": "Verified.",
    }
    assert payload["comment_url"].endswith("#issuecomment-1")


def test_audit_external_site_only_works_for_external_projects():
    import asyncio

    from agent.api import copilot as copilot_module

    trace = []
    tools = copilot_module.build_copilot_tools(_turn(), trace)
    result = asyncio.run(_tool(tools, "audit_external_site")())

    assert trace[-1].status == "error"
    assert "not an external website" in _payload(result)["error"]


def test_attaches_to_the_request_background_tasks(monkeypatch):
    """The apply-fix route schedules re-verification on the tasks it is given.

    Handing it a throwaway collector would silently drop the re-run, so the tool
    must pass through the request's own BackgroundTasks.
    """
    import asyncio

    from starlette.background import BackgroundTasks

    from agent.api import copilot as copilot_module
    from agent.api.copilot import _TurnState

    class Record:
        def model_dump(self):
            return {"run_id": "run-1", "repo": "acme/storefront", "status": "failed"}

    class Store:
        def get(self, run_id):
            return Record()

    seen: dict = {}

    async def fake_apply(run_id, background_tasks):
        seen["tasks"] = background_tasks
        return {"applied_files": [], "run_id": run_id}

    monkeypatch.setattr("agent.api.runs.get_run_store", lambda: Store())
    monkeypatch.setattr("agent.api.runs.apply_run_fix", fake_apply)

    background = BackgroundTasks()
    state = _TurnState(
        request=CopilotChatRequest(
            message="apply it",
            mode="autonomous",
            project=ProjectContext(repo_full_name="acme/storefront", type="git"),
        ),
        background=background,
    )
    tools = copilot_module.build_copilot_tools(state, [])

    asyncio.run(_tool(tools, "apply_run_fix")(run_id="run-1"))

    assert seen["tasks"] is background


def test_health_advertises_modes_tools_and_providers(client, monkeypatch):
    from agent.api import copilot as copilot_module

    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)

    data = client.get("/api/copilot/health").json()

    assert data["status"] == "ready"
    assert data["tool_count"] == len(copilot_module.ALL_TOOLS)
    assert data["modes"] == ["read_only", "standard", "autonomous"]
    assert {p["id"] for p in data["providers"]} == {"bedrock", "anthropic", "gemini"}


def test_chat_surfaces_pending_approvals_and_step_count(client, monkeypatch):
    from agent.api import copilot as copilot_module

    async def fake_invoke(agent, prompt):
        # The mode must reach the model, not just the tools.
        assert "MODE: read-only" in prompt
        return {"message": {"role": "assistant", "content": [{"text": "ok"}]}}

    monkeypatch.setattr(copilot_module, "create_strands_agent", lambda *a, **k: object())
    monkeypatch.setattr(copilot_module, "_invoke_agent", fake_invoke)
    monkeypatch.setattr(copilot_module, "has_api_key_for_role", lambda role: True)

    res = client.post(
        "/api/copilot/chat",
        json={
            "message": "what is broken?",
            "mode": "read_only",
            "max_tool_calls": 3,
            "project": {"repo_full_name": "acme/storefront", "type": "git"},
        },
    )

    assert res.status_code == 200
    data = res.json()
    assert data["steps_used"] == 0
    assert data["max_tool_calls"] == 3
    assert data["pending_approvals"] == []
