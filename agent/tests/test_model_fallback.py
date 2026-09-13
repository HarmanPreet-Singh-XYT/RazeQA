"""Unit tests for Dynamic AI Model Routing, Provider Fallbacks, and Multi-Model Architecture."""

import os
from unittest.mock import MagicMock, patch

import pytest
from strands.models.anthropic import AnthropicModel
from strands.models.gemini import GeminiModel

from agent.models.factory import (
    DEFAULT_CODE_MODEL,
    DEFAULT_GEMINI_CODE_MODEL,
    DEFAULT_GEMINI_NAV_MODEL,
    DEFAULT_GEMINI_VISION_MODEL,
    DEFAULT_NAV_MODEL,
    DEFAULT_VISION_MODEL,
    ModelRole,
    create_strands_agent,
    get_active_provider_for_role,
    get_model_for_role,
    has_anthropic_key,
    has_api_key_for_role,
    has_gemini_key,
    is_multi_model_enabled,
)
from agent.remediation.fix_synthesizer import FixSynthesizer


def test_only_gemini_key_routes_everything_to_gemini(monkeypatch):
    """When only GEMINI_API_KEY is present, all roles must route to Gemini models."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaSyFakeKey123")
    monkeypatch.setenv("ENABLE_MULTI_MODEL", "false")

    assert has_gemini_key() is True
    assert has_anthropic_key() is False
    assert is_multi_model_enabled() is False

    # Check active provider for all roles
    assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "gemini"
    assert get_active_provider_for_role(ModelRole.VISUAL_INSPECTION) == "gemini"
    assert get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION) == "gemini"

    # has_api_key_for_role should return True for all roles
    assert has_api_key_for_role(ModelRole.CODE_REASONING) is True
    assert has_api_key_for_role(ModelRole.VISUAL_INSPECTION) is True
    assert has_api_key_for_role(ModelRole.BROWSER_NAVIGATION) is True

    # Check models instantiated
    code_model = get_model_for_role(ModelRole.CODE_REASONING)
    assert isinstance(code_model, GeminiModel)
    assert code_model.get_config()["model_id"] == "gemini-3.8-flash"

    vision_model = get_model_for_role(ModelRole.VISUAL_INSPECTION)
    assert isinstance(vision_model, GeminiModel)
    assert vision_model.get_config()["model_id"] == DEFAULT_GEMINI_VISION_MODEL

    nav_model = get_model_for_role(ModelRole.BROWSER_NAVIGATION)
    assert isinstance(nav_model, GeminiModel)
    assert nav_model.get_config()["model_id"] == DEFAULT_GEMINI_NAV_MODEL


def test_only_anthropic_key_routes_everything_to_anthropic(monkeypatch):
    """When only ANTHROPIC_API_KEY is present, all roles must route to Anthropic models."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake-key-123")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.setenv("ENABLE_MULTI_MODEL", "false")

    assert has_anthropic_key() is True
    assert has_gemini_key() is False

    assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "anthropic"
    assert get_active_provider_for_role(ModelRole.VISUAL_INSPECTION) == "anthropic"
    assert get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION) == "anthropic"

    assert has_api_key_for_role(ModelRole.CODE_REASONING) is True
    assert has_api_key_for_role(ModelRole.VISUAL_INSPECTION) is True
    assert has_api_key_for_role(ModelRole.BROWSER_NAVIGATION) is True

    code_model = get_model_for_role(ModelRole.CODE_REASONING)
    assert isinstance(code_model, AnthropicModel)
    assert code_model.get_config()["model_id"] == DEFAULT_CODE_MODEL

    vision_model = get_model_for_role(ModelRole.VISUAL_INSPECTION)
    assert isinstance(vision_model, AnthropicModel)

    nav_model = get_model_for_role(ModelRole.BROWSER_NAVIGATION)
    assert isinstance(nav_model, AnthropicModel)
    assert nav_model.get_config()["model_id"] == DEFAULT_NAV_MODEL


def test_both_keys_with_multi_model_disabled(monkeypatch):
    """When both keys are present and ENABLE_MULTI_MODEL=false, single provider is used."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake")
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaFake")
    monkeypatch.setenv("ENABLE_MULTI_MODEL", "false")
    monkeypatch.delenv("DEFAULT_AI_PROVIDER", raising=False)

    assert is_multi_model_enabled() is False

    # Defaults to primary provider (anthropic)
    assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "anthropic"
    assert get_active_provider_for_role(ModelRole.VISUAL_INSPECTION) == "anthropic"
    assert get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION) == "anthropic"

    # When user prefers Gemini as the single provider
    monkeypatch.setenv("DEFAULT_AI_PROVIDER", "gemini")
    assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "gemini"
    assert get_active_provider_for_role(ModelRole.VISUAL_INSPECTION) == "gemini"
    assert get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION) == "gemini"


def test_both_keys_with_multi_model_enabled(monkeypatch):
    """When ENABLE_MULTI_MODEL=true, roles specialize across providers."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-fake")
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaFake")
    monkeypatch.setenv("ENABLE_MULTI_MODEL", "true")

    assert is_multi_model_enabled() is True

    # Code and navigation use Anthropic; vision uses Gemini
    assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "anthropic"
    assert get_active_provider_for_role(ModelRole.VISUAL_INSPECTION) == "gemini"
    assert get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION) == "anthropic"

    code_model = get_model_for_role(ModelRole.CODE_REASONING)
    assert isinstance(code_model, AnthropicModel)

    vision_model = get_model_for_role(ModelRole.VISUAL_INSPECTION)
    assert isinstance(vision_model, GeminiModel)
    assert vision_model.get_config()["model_id"] == DEFAULT_GEMINI_VISION_MODEL

    nav_model = get_model_for_role(ModelRole.BROWSER_NAVIGATION)
    assert isinstance(nav_model, AnthropicModel)


def test_neither_key_present(monkeypatch):
    """When neither key is present, has_api_key_for_role returns False."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)

    assert has_anthropic_key() is False
    assert has_gemini_key() is False
    assert has_api_key_for_role(ModelRole.CODE_REASONING) is False
    assert has_api_key_for_role(ModelRole.VISUAL_INSPECTION) is False
    assert has_api_key_for_role(ModelRole.BROWSER_NAVIGATION) is False


def test_fix_synthesizer_uses_strands_agent():
    """Verify FixSynthesizer delegates to Strands agent and parses json response."""
    mock_agent = MagicMock()
    fake_response = MagicMock()
    fake_response.message = {
        "role": "assistant",
        "content": [
            {
                "text": """{
  "target_files": ["app/page.tsx"],
  "styling_paradigm": "tailwind",
  "root_cause": "Missing padding",
  "explanation": "Add p-4 class",
  "patches": [{
    "file_path": "app/page.tsx",
    "original_snippet": "<div className=\\"flex\\">",
    "replacement_snippet": "<div className=\\"flex p-4\\">",
    "explanation": "Add padding"
  }]
}"""
            }
        ],
    }
    mock_agent.return_value = fake_response

    from agent.analyzer.diff_analyzer import AnalysisResult

    synth = FixSynthesizer(api_key="fake-gemini-key")
    with patch("agent.models.factory.create_strands_agent", return_value=mock_agent) as mock_create:
        proposal = synth._synthesize_with_claude(
            journey_name="test-journey",
            error="Failed button",
            analysis=AnalysisResult(affected_surfaces=["app/page.tsx"], risk_tag="Medium"),
            intents=[],
            dom_snapshot="",
            inspected_context={"app/page.tsx": "<div className=\"flex\">Hello</div>"},
            detected_paradigm="tailwind",
        )
        assert proposal is not None
        assert mock_create.called
        assert proposal.target_files == ["app/page.tsx"]
        assert proposal.root_cause == "Missing padding"
        assert len(proposal.patches) == 1


def test_explicit_bedrock_routing(monkeypatch):
    """When USE_BEDROCK=true, all roles route to BedrockModel."""
    import boto3
    from strands.models.bedrock import BedrockModel

    monkeypatch.setenv("USE_BEDROCK", "true")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    session = boto3.Session(aws_access_key_id="fake", aws_secret_access_key="fake", region_name="us-east-1")
    with patch("agent.models.factory._create_boto_session", return_value=session):
        assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "bedrock"
        assert get_active_provider_for_role(ModelRole.VISUAL_INSPECTION) == "bedrock"
        assert get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION) == "bedrock"

        assert has_api_key_for_role(ModelRole.CODE_REASONING) is True
        assert has_api_key_for_role(ModelRole.VISUAL_INSPECTION) is True
        assert has_api_key_for_role(ModelRole.BROWSER_NAVIGATION) is True

        code_model = get_model_for_role(ModelRole.CODE_REASONING)
        assert isinstance(code_model, BedrockModel)
        assert "claude-sonnet" in code_model.get_config()["model_id"]

        nav_model = get_model_for_role(ModelRole.BROWSER_NAVIGATION)
        assert isinstance(nav_model, BedrockModel)
        assert "claude-haiku" in nav_model.get_config()["model_id"]


def test_aws_environment_autodetects_bedrock(monkeypatch):
    """Running on AWS without third-party API keys automatically defaults to Bedrock."""
    import boto3
    from strands.models.bedrock import BedrockModel

    monkeypatch.delenv("USE_BEDROCK", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("AWS_EXECUTION_ENV", "AWS_ECS_FARGATE")
    monkeypatch.setenv("AWS_REGION", "us-west-2")

    session = boto3.Session(aws_access_key_id="fake", aws_secret_access_key="fake", region_name="us-west-2")
    with patch("agent.models.factory._create_boto_session", return_value=session):
        assert get_active_provider_for_role(ModelRole.CODE_REASONING) == "bedrock"
        assert has_api_key_for_role(ModelRole.CODE_REASONING) is True

        model = get_model_for_role(ModelRole.CODE_REASONING)
        assert isinstance(model, BedrockModel)


def test_agentcore_endpoints():
    """Verify Amazon Bedrock AgentCore container contract endpoints (/ping and /invocations)."""
    from starlette.testclient import TestClient
    from agent.main import app
    from conftest import AUTH_HEADERS

    client = TestClient(app)

    # 1. /ping should return 200 without requiring bearer auth token
    ping_resp = client.get("/ping")
    assert ping_resp.status_code == 200
    assert ping_resp.json()["status"].lower() == "healthy"

    # 2. /invocations runs real analysis, so it is NOT exempt from auth. Without
    #    a token it must be refused; the previous exemption made it an open
    #    compute endpoint.
    unauth_resp = client.post("/invocations", json={"action": "status"})
    assert unauth_resp.status_code in (401, 503)

    # 3. With the bearer token it handles the AgentCore payload normally.
    inv_resp = client.post("/invocations", json={"action": "status"}, headers=AUTH_HEADERS)
    assert inv_resp.status_code == 200
    assert inv_resp.json()["status"] == "ok"


