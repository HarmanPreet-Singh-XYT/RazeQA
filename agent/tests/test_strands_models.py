"""Tests for Multi-Model Routing via AWS Strands Agents SDK."""

import os
from unittest.mock import MagicMock, patch

import pytest

# Env vars that determine provider routing in agent.models.factory
# (get_active_provider_for_role). Tests in this file assert the "neither
# key present" fallback routing (code/nav -> anthropic, visual -> gemini),
# so they need a clean slate regardless of what real credentials happen to
# be loaded into the process environment — e.g. importing
# agent.remediation.agentic_repair (mini-swe-agent) elsewhere in the test
# session triggers agent.config's load_dotenv(agent/.env), which injects
# any real GEMINI_API_KEY/DEFAULT_AI_PROVIDER found there permanently into
# os.environ for the rest of the pytest process.
_PROVIDER_ENV_VARS = (
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "DEFAULT_AI_PROVIDER",
    "USE_BEDROCK",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    "ENABLE_MULTI_MODEL",
)


@pytest.fixture(autouse=True)
def _clean_provider_env(monkeypatch):
    """Ensures no provider credentials leak in from the real process
    environment (see note above) so provider-routing fallback logic is
    tested deterministically."""
    for var in _PROVIDER_ENV_VARS:
        monkeypatch.delenv(var, raising=False)

from strands import Agent
from strands.models.anthropic import AnthropicModel
from strands.models.gemini import GeminiModel

from agent.analyzer.diff_analyzer import DiffAnalyzer
from agent.journeys.browser_agent import (
    PageObservation,
    plan_exploratory_actions_with_strands,
)
from agent.journeys.visual_inspector import (
    VisualInspectionResult,
    inspect_screenshot_with_gemini,
)
from agent.models.factory import (
    DEFAULT_CODE_MODEL,
    DEFAULT_NAV_MODEL,
    DEFAULT_VISION_MODEL,
    ModelRole,
    create_strands_agent,
    get_browser_navigation_model,
    get_code_reasoning_model,
    get_visual_inspection_model,
)


def test_model_roles_and_providers():
    """Verify each usecase is routed to its optimal specialized model through Strands SDK:
    - Code reasoning -> Claude Sonnet (AnthropicModel)
    - Visual inspection -> Gemini Flash (GeminiModel)
    - Browser navigation -> Claude Haiku / lightweight (AnthropicModel)
    """
    code_model = get_code_reasoning_model(api_key="test-key")
    assert isinstance(code_model, AnthropicModel)
    assert code_model.get_config()["model_id"] == DEFAULT_CODE_MODEL

    vision_model = get_visual_inspection_model(api_key="test-key")
    assert isinstance(vision_model, GeminiModel)
    assert vision_model.get_config()["model_id"] == DEFAULT_VISION_MODEL

    nav_model = get_browser_navigation_model(api_key="test-key")
    assert isinstance(nav_model, AnthropicModel)
    assert nav_model.get_config()["model_id"] == DEFAULT_NAV_MODEL


def test_create_strands_agents_for_roles():
    """Verify Strands Agent instances are constructed with the proper role configuration."""
    code_agent = create_strands_agent(ModelRole.CODE_REASONING, api_key="dummy")
    assert isinstance(code_agent, Agent)
    assert isinstance(code_agent.model, AnthropicModel)

    vision_agent = create_strands_agent(ModelRole.VISUAL_INSPECTION, api_key="dummy")
    assert isinstance(vision_agent, Agent)
    assert isinstance(vision_agent.model, GeminiModel)

    nav_agent = create_strands_agent(ModelRole.BROWSER_NAVIGATION, api_key="dummy")
    assert isinstance(nav_agent, Agent)
    assert isinstance(nav_agent.model, AnthropicModel)


def test_visual_inspector_with_gemini_fallback():
    """Verify Gemini visual inspector evaluates screenshot and returns structured result."""
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1000
    res = inspect_screenshot_with_gemini(fake_png, route="/dashboard")
    assert isinstance(res, VisualInspectionResult)
    assert res.has_visual_defects is False
    assert "dashboard" in res.summary.lower()


def test_visual_inspector_with_mocked_gemini_agent():
    """Verify Gemini multimodal message calling via Strands Agent."""
    mock_agent = MagicMock()
    mock_agent.structured_output.return_value = VisualInspectionResult(
        has_visual_defects=True,
        is_visually_broken=True,
        layout_issues=["Overlapping submit button in modal."],
        summary="Modal overlay clipping detected by Gemini.",
    )

    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 1000
    with (
        patch("agent.journeys.visual_inspector.has_api_key_for_role", return_value=True),
        patch("agent.journeys.visual_inspector.create_strands_agent", return_value=mock_agent),
    ):
        res = inspect_screenshot_with_gemini(fake_png, route="/checkout")
        assert res.has_visual_defects is True
        assert res.is_visually_broken is True
        assert "Overlapping submit button" in res.layout_issues[0]
        assert mock_agent.structured_output.called


def test_diff_analyzer_uses_claude_code_reasoning():
    """Verify diff analyzer invokes Strands Agent configured with Claude Sonnet."""
    mock_agent = MagicMock()
    mock_agent.structured_output.return_value = MagicMock(
        risk_tag="High",
        affected_surfaces=["/login", "/dashboard"],
        rationale="Auth touched",
        recommended_journeys=["login"],
    )

    with (
        patch("agent.analyzer.diff_analyzer.create_strands_agent", return_value=mock_agent) as mock_create,
    ):
        analyzer = DiffAnalyzer(api_key="sk-test-key")
        res = analyzer.analyze("diff --git a/app/login/page.tsx", [])
        assert res.risk_tag == "High"
        assert mock_create.called
        assert mock_create.call_args.kwargs["role"] == ModelRole.CODE_REASONING


def test_lightweight_navigator_planning():
    """Verify browser navigation planner uses lightweight Haiku model via Strands."""
    obs = PageObservation(
        url="http://localhost:3000/dashboard",
        title="Dashboard",
        interactive_elements=['button#quick-checkout: "Buy Now"'],
        scrollable_regions=[],
    )

    mock_agent = MagicMock()
    mock_decision = MagicMock(action_type="click", selector="button#quick-checkout", text="")
    mock_agent.structured_output.return_value = mock_decision

    with (
        patch("agent.models.factory.has_api_key_for_role", return_value=True),
        patch("agent.models.factory.create_strands_agent", return_value=mock_agent) as mock_create,
    ):
        actions = plan_exploratory_actions_with_strands(obs, "/dashboard")
        assert len(actions) == 1
        assert actions[0]["type"] == "click"
        assert actions[0]["selector"] == "button#quick-checkout"
        assert mock_create.call_args.kwargs["role"] == ModelRole.BROWSER_NAVIGATION


# ---------------------------------------------------------------------------
# Deprecated model ids are upgraded on read
# ---------------------------------------------------------------------------

def test_normalize_model_id_upgrades_deprecated_claude_35():
    from agent.models.factory import normalize_model_id

    # Bedrock form (provider prefix preserved, inference-profile prefix added).
    assert (
        normalize_model_id("bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0")
        == "bedrock/us.anthropic.claude-sonnet-4-6"
    )
    # Bare Bedrock id.
    assert (
        normalize_model_id("anthropic.claude-3-5-sonnet-20241022-v2:0")
        == "us.anthropic.claude-sonnet-4-6"
    )
    # Direct Anthropic form.
    assert normalize_model_id("anthropic/claude-3-5-sonnet-20241022") == "anthropic/claude-sonnet-4.6"
    assert normalize_model_id("claude-3-5-sonnet-latest") == "claude-sonnet-4.6"
    # Retired 3.x Haiku/Opus also move forward.
    assert normalize_model_id("claude-3-5-haiku-20241022") == "claude-haiku-4.5"


def test_normalize_model_id_leaves_current_ids_untouched():
    from agent.models.factory import normalize_model_id

    for current in (
        "anthropic/claude-sonnet-4.6",
        "bedrock/us.anthropic.claude-sonnet-4-6",
        "gemini/gemini-3.8-flash",
        "claude-haiku-4.5",
        None,
        "",
    ):
        assert normalize_model_id(current) == current


def test_resolve_model_name_upgrades_deprecated_env(monkeypatch):
    """A deprecated BEDROCK_CODE_MODEL must not be used as-is."""
    from agent.remediation.agentic_repair import resolve_model_name
    from agent.models import factory

    monkeypatch.setattr(factory, "is_bedrock_enabled", lambda: True)
    monkeypatch.setattr(factory, "has_bedrock_credentials", lambda: True)
    monkeypatch.setenv("BEDROCK_CODE_MODEL", "anthropic.claude-3-5-sonnet-20241022-v2:0")
    assert resolve_model_name() == "bedrock/us.anthropic.claude-sonnet-4-6"
