"""Dynamic Multi-Model Routing & Provider Fallbacks via AWS Strands Agents SDK.

Supports:
1. Dynamic Single/Multi-Provider Architecture:
   - AWS Bedrock: When USE_BEDROCK=true (or running on AWS without direct keys), routes to BedrockModel.
     (Code reasoning defaults to us.anthropic.claude-sonnet-4-5-20250929-v1:0,
      vision to us.anthropic.claude-sonnet-4-5-20250929-v1:0,
      nav to us.anthropic.claude-haiku-4-5-20251001-v1:0).
   - Google Gemini: If only GEMINI_API_KEY (or GOOGLE_API_KEY) exists: All roles use Google Gemini models.
     (Code reasoning defaults to gemini-3.8-flash, vision to gemini-3.5-flash-lite, nav to gemini-3.5-flash).
   - Anthropic Claude: If only ANTHROPIC_API_KEY exists: All roles use Anthropic Claude models.
     (Code reasoning defaults to claude-sonnet-5, vision to claude-sonnet-5, nav to claude-haiku-4.5).
   - Both keys exist:
     - When ENABLE_MULTI_MODEL=true: Specializes across models (Claude for code/nav, Gemini for vision).
     - When ENABLE_MULTI_MODEL=false (default): Unifies under single primary provider (DEFAULT_AI_PROVIDER).
2. Clean error handling when no keys are available.
"""

from __future__ import annotations

import logging
import os
from enum import Enum
from typing import Any

from strands import Agent
from strands.models.anthropic import AnthropicModel
from strands.models.bedrock import BedrockModel
from strands.models.gemini import GeminiModel
from strands.models.model import Model

logger = logging.getLogger("agent.models.factory")

# Anthropic Claude defaults
DEFAULT_CODE_MODEL = os.environ.get("CODE_MODEL_ID", "claude-sonnet-5")
DEFAULT_VISION_MODEL = os.environ.get("VISION_MODEL_ID", "gemini-3.5-flash-lite")
DEFAULT_NAV_MODEL = os.environ.get("NAV_MODEL_ID", "claude-haiku-4.5")
DEFAULT_ANTHROPIC_VISION_MODEL = os.environ.get("ANTHROPIC_VISION_MODEL", "claude-sonnet-5")

# Gemini defaults
DEFAULT_GEMINI_CODE_MODEL = os.environ.get("GEMINI_CODE_MODEL", "gemini-3.8-flash")
DEFAULT_GEMINI_VISION_MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-3.5-flash-lite")
DEFAULT_GEMINI_NAV_MODEL = os.environ.get("GEMINI_NAV_MODEL", "gemini-3.5-flash")

# AWS Bedrock defaults
DEFAULT_BEDROCK_CODE_MODEL = os.environ.get(
    "BEDROCK_CODE_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
)
DEFAULT_BEDROCK_VISION_MODEL = os.environ.get(
    "BEDROCK_VISION_MODEL", "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
)
DEFAULT_BEDROCK_NAV_MODEL = os.environ.get(
    "BEDROCK_NAV_MODEL", "us.anthropic.claude-haiku-4-5-20251001-v1:0"
)


class ModelRole(str, Enum):
    CODE_REASONING = "code_reasoning"          # Deep code reasoning & fix synthesis
    VISUAL_INSPECTION = "visual_inspection"    # High-precision visual & screenshot analysis
    BROWSER_NAVIGATION = "browser_navigation"  # Fast, lightweight DOM traversal & actions


def is_multi_model_enabled() -> bool:
    """Return True if multi-model specialized routing is explicitly turned on."""
    return os.environ.get("ENABLE_MULTI_MODEL", "false").strip().lower() in ("true", "1", "yes", "on")


def is_aws_environment() -> bool:
    """Detect whether code is executing inside an AWS environment (ECS, Lambda, EC2)."""
    return bool(
        os.environ.get("AWS_EXECUTION_ENV")
        or os.environ.get("ECS_CONTAINER_METADATA_URI")
        or os.environ.get("ECS_CONTAINER_METADATA_URI_V4")
        or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
        or os.environ.get("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
    )


def is_bedrock_enabled() -> bool:
    """Check whether AWS Bedrock is enabled explicitly or automatically on AWS."""
    val = os.environ.get("USE_BEDROCK", "").strip().lower()
    if val in ("true", "1", "yes", "on"):
        return True
    if val in ("false", "0", "no", "off"):
        return False
    if os.environ.get("DEFAULT_AI_PROVIDER", "").strip().lower() == "bedrock":
        return True
    # Auto-detect when deployed on AWS and no external Anthropic or Gemini key is configured
    if is_aws_environment() and not has_anthropic_key() and not has_gemini_key():
        return True
    return False


def has_bedrock_credentials() -> bool:
    """Check if Bedrock is configured and credentials / IAM role are available."""
    if not is_bedrock_enabled():
        return False
    if is_aws_environment():
        return True
    return bool(
        (os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"))
        or os.environ.get("USE_BEDROCK", "").strip().lower() in ("true", "1", "yes", "on")
        or os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
    )


def has_anthropic_key() -> bool:
    """Check if Anthropic credentials are present in environment."""
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def has_gemini_key() -> bool:
    """Check if Google Gemini credentials are present in environment."""
    return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))


def get_active_provider_for_role(role: ModelRole | str) -> str:
    """Determine the active AI provider ('bedrock', 'anthropic', or 'gemini') for a specific role.

    Resolution order:
    1. If AWS Bedrock is enabled:
       - If ENABLE_MULTI_MODEL=true and Gemini key exists -> visual_inspection uses gemini, rest use bedrock
       - Otherwise -> bedrock for all roles
    2. If only Gemini key exists -> gemini for all roles
    3. If only Anthropic key exists -> anthropic for all roles
    4. If both exist and ENABLE_MULTI_MODEL=true:
       - visual_inspection -> gemini
       - code_reasoning & browser_navigation -> anthropic
    5. If both exist and ENABLE_MULTI_MODEL=false:
       - Follows DEFAULT_AI_PROVIDER (defaults to anthropic)
    6. If neither exists:
       - Default to anthropic for code/nav, gemini for visual (allows mocked unit tests to run)
    """
    role_val = role.value if isinstance(role, ModelRole) else role
    has_ant = has_anthropic_key()
    has_gem = has_gemini_key()

    # 1. AWS Bedrock routing
    if is_bedrock_enabled():
        if is_multi_model_enabled() and has_gem and role_val == ModelRole.VISUAL_INSPECTION.value:
            return "gemini"
        return "bedrock"

    # 2. Only one external provider configured
    if has_gem and not has_ant:
        return "gemini"
    if has_ant and not has_gem:
        return "anthropic"

    # 3. Both providers configured
    if has_ant and has_gem:
        if is_multi_model_enabled():
            if role_val == ModelRole.VISUAL_INSPECTION.value:
                return "gemini"
            return "anthropic"

        # Unified single-provider mode
        pref = os.environ.get("DEFAULT_AI_PROVIDER", "auto").strip().lower()
        if pref == "gemini":
            return "gemini"
        if pref == "bedrock":
            return "bedrock"
        return "anthropic"

    # 4. Neither key present: preserved for mocked test runners
    pref = os.environ.get("DEFAULT_AI_PROVIDER", "auto").strip().lower()
    if pref == "gemini":
        return "gemini"
    if pref == "bedrock":
        return "bedrock"
    if role_val == ModelRole.VISUAL_INSPECTION.value and pref != "anthropic":
        return "gemini"
    return "anthropic"


def _create_boto_session() -> Any:
    """Create a boto3.Session using environment credentials or ambient IAM role."""
    import boto3

    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    session_kwargs: dict[str, Any] = {"region_name": region}
    if os.environ.get("AWS_ACCESS_KEY_ID") and os.environ.get("AWS_SECRET_ACCESS_KEY"):
        session_kwargs["aws_access_key_id"] = os.environ["AWS_ACCESS_KEY_ID"]
        session_kwargs["aws_secret_access_key"] = os.environ["AWS_SECRET_ACCESS_KEY"]
        if os.environ.get("AWS_SESSION_TOKEN"):
            session_kwargs["aws_session_token"] = os.environ["AWS_SESSION_TOKEN"]
    return boto3.Session(**session_kwargs)


def get_bedrock_model(
    role: ModelRole | str,
    model_id: str | None = None,
    boto_session: Any | None = None,
    **kwargs: Any,
) -> BedrockModel:
    """Instantiate a BedrockModel using Strands Agents SDK."""
    role_val = role.value if isinstance(role, ModelRole) else role
    if role_val == ModelRole.CODE_REASONING.value:
        chosen_model = model_id or os.environ.get("CODE_MODEL_ID") or DEFAULT_BEDROCK_CODE_MODEL
    elif role_val == ModelRole.VISUAL_INSPECTION.value:
        chosen_model = model_id or os.environ.get("VISION_MODEL_ID") or DEFAULT_BEDROCK_VISION_MODEL
    elif role_val == ModelRole.BROWSER_NAVIGATION.value:
        chosen_model = model_id or os.environ.get("NAV_MODEL_ID") or DEFAULT_BEDROCK_NAV_MODEL
    else:
        chosen_model = model_id or DEFAULT_BEDROCK_CODE_MODEL

    session = boto_session
    if session is None:
        try:
            session = _create_boto_session()
        except Exception as exc:
            logger.warning("Could not instantiate boto3 session for Bedrock: %s", exc)

    return BedrockModel(
        boto_session=session,
        model_id=chosen_model,
        **kwargs,
    )


def get_code_reasoning_model(
    api_key: str | None = None,
    model_id: str | None = None,
    provider: str | None = None,
    **kwargs: Any,
) -> Model:
    """Model for code intelligence, diff analysis, and remediation prompts.

    Supports Bedrock, Anthropic Claude, and Google Gemini.
    """
    target_provider = provider or get_active_provider_for_role(ModelRole.CODE_REASONING)

    if target_provider == "bedrock":
        return get_bedrock_model(role=ModelRole.CODE_REASONING, model_id=model_id, **kwargs)

    if target_provider == "gemini":
        key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        client_args = {"api_key": key} if key else {}
        chosen_model = model_id or os.environ.get("CODE_MODEL_ID") or DEFAULT_GEMINI_CODE_MODEL
        return GeminiModel(
            model_id=chosen_model,
            client_args=client_args,
            **kwargs,
        )

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    client_args = {"api_key": key} if key else {}
    chosen_model = model_id or os.environ.get("CODE_MODEL_ID") or DEFAULT_CODE_MODEL
    return AnthropicModel(
        model_id=chosen_model,
        client_args=client_args,
        params={"temperature": 0.1},
        **kwargs,
    )


def get_visual_inspection_model(
    api_key: str | None = None,
    model_id: str | None = None,
    provider: str | None = None,
    **kwargs: Any,
) -> Model:
    """Model for high-fidelity screenshot inspection and visual regressions."""
    target_provider = provider or get_active_provider_for_role(ModelRole.VISUAL_INSPECTION)

    if target_provider == "bedrock":
        return get_bedrock_model(role=ModelRole.VISUAL_INSPECTION, model_id=model_id, **kwargs)

    if target_provider == "anthropic":
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        client_args = {"api_key": key} if key else {}
        chosen_model = model_id or os.environ.get("VISION_MODEL_ID") or DEFAULT_ANTHROPIC_VISION_MODEL
        return AnthropicModel(
            model_id=chosen_model,
            client_args=client_args,
            params={"temperature": 0.0},
            **kwargs,
        )

    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    client_args = {"api_key": key} if key else {}
    chosen_model = model_id or os.environ.get("VISION_MODEL_ID") or DEFAULT_VISION_MODEL
    return GeminiModel(
        model_id=chosen_model,
        client_args=client_args,
        **kwargs,
    )


def get_browser_navigation_model(
    api_key: str | None = None,
    model_id: str | None = None,
    provider: str | None = None,
    **kwargs: Any,
) -> Model:
    """Fast, lightweight model for browser exploration loops and DOM element interaction."""
    target_provider = provider or get_active_provider_for_role(ModelRole.BROWSER_NAVIGATION)

    if target_provider == "bedrock":
        return get_bedrock_model(role=ModelRole.BROWSER_NAVIGATION, model_id=model_id, **kwargs)

    if target_provider == "gemini":
        key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        client_args = {"api_key": key} if key else {}
        chosen_model = model_id or os.environ.get("NAV_MODEL_ID") or DEFAULT_GEMINI_NAV_MODEL
        return GeminiModel(
            model_id=chosen_model,
            client_args=client_args,
            **kwargs,
        )

    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    client_args = {"api_key": key} if key else {}
    chosen_model = model_id or os.environ.get("NAV_MODEL_ID") or DEFAULT_NAV_MODEL
    return AnthropicModel(
        model_id=chosen_model,
        client_args=client_args,
        params={"temperature": 0.0},
        **kwargs,
    )


def get_model_for_role(
    role: ModelRole | str,
    provider: str | None = None,
    **kwargs: Any,
) -> Model:
    """Get the appropriate specialized Strands model provider for a given usecase."""
    role_val = role.value if isinstance(role, ModelRole) else role
    target_provider = provider or get_active_provider_for_role(role_val)

    if role_val == ModelRole.CODE_REASONING.value:
        return get_code_reasoning_model(provider=target_provider, **kwargs)
    if role_val == ModelRole.VISUAL_INSPECTION.value:
        return get_visual_inspection_model(provider=target_provider, **kwargs)
    if role_val == ModelRole.BROWSER_NAVIGATION.value:
        return get_browser_navigation_model(provider=target_provider, **kwargs)
    raise ValueError(f"Unknown ModelRole: {role}")


def has_api_key_for_role(role: ModelRole | str) -> bool:
    """Check if the environment has credentials for the resolved provider of a given role."""
    has_ant = has_anthropic_key()
    has_gem = has_gemini_key()
    has_bed = has_bedrock_credentials()

    if is_bedrock_enabled():
        if is_multi_model_enabled() and has_gem:
            role_val = role.value if isinstance(role, ModelRole) else role
            if role_val == ModelRole.VISUAL_INSPECTION.value:
                return has_gem
        return has_bed

    if not has_ant and not has_gem:
        return False

    # Single-key scenarios: provider handles all roles
    if has_gem and not has_ant:
        return True
    if has_ant and not has_gem:
        return True

    # Both keys present: check whether multi-model specialization is enabled
    if is_multi_model_enabled():
        role_val = role.value if isinstance(role, ModelRole) else role
        if role_val == ModelRole.VISUAL_INSPECTION.value:
            return has_gem
        return has_ant

    # Both present, unified single-provider mode
    pref = os.environ.get("DEFAULT_AI_PROVIDER", "auto").strip().lower()
    if pref == "gemini":
        return has_gem
    return has_ant


def create_strands_agent(
    role: ModelRole | str,
    system_prompt: str | None = None,
    tools: list[Any] | None = None,
    structured_output_model: Any = None,
    provider: str | None = None,
    **model_kwargs: Any,
) -> Agent:
    """Construct a configured Strands Agent using the role-specialized model."""
    model = get_model_for_role(role, provider=provider, **model_kwargs)
    return Agent(
        model=model,
        system_prompt=system_prompt,
        tools=tools,
        structured_output_model=structured_output_model,
    )
