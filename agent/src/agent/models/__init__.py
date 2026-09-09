"""Multi-Model Strategy via AWS Strands Agents SDK.

Separates models by specialized usecase:
- Claude Sonnet 4.6 (claude-sonnet-4.6): Deep code reasoning, diff & intent analysis, remediation generation
- Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite): High-precision screenshot visual inspection & visual regression detection
- Claude 4.5 Haiku (claude-haiku-4.5): Fast, lightweight browser navigation & exploratory action loop
"""

from agent.models.factory import (
    ModelRole,
    create_strands_agent,
    get_browser_navigation_model,
    get_code_reasoning_model,
    get_model_for_role,
    get_visual_inspection_model,
)

__all__ = [
    "ModelRole",
    "create_strands_agent",
    "get_browser_navigation_model",
    "get_code_reasoning_model",
    "get_model_for_role",
    "get_visual_inspection_model",
]
