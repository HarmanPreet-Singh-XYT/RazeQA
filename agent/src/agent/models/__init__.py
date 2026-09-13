"""Multi-Model Strategy via AWS Strands Agents SDK.

Separates models by specialized usecase with dynamic provider fallbacks:
- AWS Bedrock: Claude Sonnet / Haiku deployed on AWS with IAM auth
- Code Reasoning: Claude Sonnet 5 (Anthropic) or Gemini 3.8 Flash (Google)
- Visual Inspection: Gemini 3.5 Flash-Lite (Google) or Claude Sonnet 5 (Anthropic)
- Browser Navigation: Claude Haiku 4.5 (Anthropic) or Gemini 3.5 Flash (Google)
"""

from agent.models.factory import (
    DEFAULT_BEDROCK_CODE_MODEL,
    DEFAULT_BEDROCK_NAV_MODEL,
    DEFAULT_BEDROCK_VISION_MODEL,
    DEFAULT_CODE_MODEL,
    DEFAULT_GEMINI_CODE_MODEL,
    DEFAULT_GEMINI_NAV_MODEL,
    DEFAULT_GEMINI_VISION_MODEL,
    DEFAULT_NAV_MODEL,
    DEFAULT_VISION_MODEL,
    ModelRole,
    create_strands_agent,
    get_active_provider_for_role,
    get_bedrock_model,
    get_browser_navigation_model,
    get_code_reasoning_model,
    get_model_for_role,
    get_visual_inspection_model,
    has_anthropic_key,
    has_api_key_for_role,
    has_bedrock_credentials,
    has_gemini_key,
    is_aws_environment,
    is_bedrock_enabled,
    is_multi_model_enabled,
    resolve_model_id,
)

__all__ = [
    "DEFAULT_BEDROCK_CODE_MODEL",
    "DEFAULT_BEDROCK_NAV_MODEL",
    "DEFAULT_BEDROCK_VISION_MODEL",
    "DEFAULT_CODE_MODEL",
    "DEFAULT_GEMINI_CODE_MODEL",
    "DEFAULT_GEMINI_NAV_MODEL",
    "DEFAULT_GEMINI_VISION_MODEL",
    "DEFAULT_NAV_MODEL",
    "DEFAULT_VISION_MODEL",
    "ModelRole",
    "create_strands_agent",
    "get_active_provider_for_role",
    "get_bedrock_model",
    "get_browser_navigation_model",
    "get_code_reasoning_model",
    "get_model_for_role",
    "get_visual_inspection_model",
    "has_anthropic_key",
    "has_api_key_for_role",
    "has_bedrock_credentials",
    "has_gemini_key",
    "is_aws_environment",
    "is_bedrock_enabled",
    "is_multi_model_enabled",
    "resolve_model_id",
]
