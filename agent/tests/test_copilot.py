"""Unit tests for the AutoQA AI Copilot endpoint.

These cover the two things that must never regress:

* **Intent routing** — money is only spent when the user actually asked for a
  run. A question *about* runs must not dispatch one.
* **Grounding** — the answer is built from a context block assembled from the
  caller's project row and run history, and the reply is extracted from the
  model response rather than fabricated.
"""

from __future__ import annotations

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
