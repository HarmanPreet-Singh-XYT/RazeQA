"""Specialized Multi-Model Routing using AWS Strands Agents SDK.

Dispatches specialized AI models by task domain:
1. CODE_REASONING -> Claude Sonnet 4.6 (claude-sonnet-4.6) via Strands AnthropicModel
   Best for: git diff understanding, intent logs, code analysis, remediation prompt generation
2. VISUAL_INSPECTION -> Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite) via Strands GeminiModel
   Best for: screenshot visual evaluation, pixel/layout regression, UI defect spotting
3. BROWSER_NAVIGATION -> Claude 4.5 Haiku (claude-haiku-4.5) via Strands AnthropicModel
   Best for: fast DOM traversal, element interaction, element-targeted scrolling
"""

from __future__ import annotations

import logging
import os
from enum import Enum
from typing import Any

from strands import Agent
from strands.models.anthropic import AnthropicModel
from strands.models.gemini import GeminiModel
from strands.models.model import Model

logger = logging.getLogger("agent.models.factory")

DEFAULT_CODE_MODEL = os.environ.get("CODE_MODEL_ID", "claude-sonnet-4.6")
DEFAULT_VISION_MODEL = os.environ.get("VISION_MODEL_ID", "gemini-3.5-flash-lite")
DEFAULT_NAV_MODEL = os.environ.get("NAV_MODEL_ID", "claude-haiku-4.5")


class ModelRole(str, Enum):
    CODE_REASONING = "code_reasoning"          # Claude Sonnet 4.6 (deep code intelligence)
    VISUAL_INSPECTION = "visual_inspection"    # Gemini 3.5 Flash-Lite (multimodal vision leader)
    BROWSER_NAVIGATION = "browser_navigation"  # Claude 4.5 Haiku (fast, lightweight actions)


def get_code_reasoning_model(
    api_key: str | None = None,
    model_id: str | None = None,
    **kwargs: Any,
) -> AnthropicModel:
    """Claude Sonnet model for code intelligence and remediation prompts."""
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    client_args = {"api_key": key} if key else {}
    return AnthropicModel(
        model_id=model_id or DEFAULT_CODE_MODEL,
        client_args=client_args,
        params={"temperature": 0.1},
        **kwargs,
    )


def get_visual_inspection_model(
    api_key: str | None = None,
    model_id: str | None = None,
    **kwargs: Any,
) -> GeminiModel:
    """Gemini model for high-fidelity multimodal screenshot inspection and visual regressions."""
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    client_args = {"api_key": key} if key else {}
    return GeminiModel(
        model_id=model_id or DEFAULT_VISION_MODEL,
        client_args=client_args,
        **kwargs,
    )


def get_browser_navigation_model(
    api_key: str | None = None,
    model_id: str | None = None,
    provider: str = "anthropic",
    **kwargs: Any,
) -> Model:
    """Fast, lightweight model for browser exploration loops and DOM element interaction."""
    if provider == "gemini":
        key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        client_args = {"api_key": key} if key else {}
        return GeminiModel(
            model_id=model_id or DEFAULT_VISION_MODEL,
            client_args=client_args,
            **kwargs,
        )

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    client_args = {"api_key": key} if key else {}
    return AnthropicModel(
        model_id=model_id or DEFAULT_NAV_MODEL,
        client_args=client_args,
        params={"temperature": 0.0},
        **kwargs,
    )


def get_model_for_role(role: ModelRole | str, **kwargs: Any) -> Model:
    """Get the appropriate specialized Strands model provider for a given usecase."""
    role_val = role.value if isinstance(role, ModelRole) else role
    if role_val == ModelRole.CODE_REASONING.value:
        return get_code_reasoning_model(**kwargs)
    if role_val == ModelRole.VISUAL_INSPECTION.value:
        return get_visual_inspection_model(**kwargs)
    if role_val == ModelRole.BROWSER_NAVIGATION.value:
        return get_browser_navigation_model(**kwargs)
    raise ValueError(f"Unknown ModelRole: {role}")


def has_api_key_for_role(role: ModelRole | str) -> bool:
    """Check if the environment has credentials for the model role."""
    role_val = role.value if isinstance(role, ModelRole) else role
    if role_val in (ModelRole.CODE_REASONING.value, ModelRole.BROWSER_NAVIGATION.value):
        return bool(os.environ.get("ANTHROPIC_API_KEY"))
    if role_val == ModelRole.VISUAL_INSPECTION.value:
        return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    return False


def create_strands_agent(
    role: ModelRole | str,
    system_prompt: str | None = None,
    tools: list[Any] | None = None,
    structured_output_model: Any = None,
    **model_kwargs: Any,
) -> Agent:
    """Construct a configured Strands Agent using the role-specialized model."""
    model = get_model_for_role(role, **model_kwargs)
    return Agent(
        model=model,
        system_prompt=system_prompt,
        tools=tools,
        structured_output_model=structured_output_model,
    )
