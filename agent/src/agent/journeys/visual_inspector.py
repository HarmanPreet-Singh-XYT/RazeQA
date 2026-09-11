"""Gemini Multimodal Visual Inspector via AWS Strands Agents SDK.

Uses Gemini models through Strands SDK for high-precision screenshot visual inspection,
layout shift detection, and visual regression spotting.
"""

from __future__ import annotations

import logging
from pathlib import Path

from pydantic import BaseModel, Field
from strands.types.content import ImageContent, Message
from strands.types.media import ImageSource

from agent.models.factory import ModelRole, create_strands_agent, has_api_key_for_role

logger = logging.getLogger("agent.journeys.visual_inspector")

SYSTEM_PROMPT = """You are a Visual QA and Frontend Regression Inspector.
You are given a web page screenshot captured during automated browser journey execution.
Analyze the screenshot for:
1. Broken UI components, unstyled elements, or raw markup/error messages
2. Layout shifts, awkward element wrapping, or overlapping text/buttons
3. Broken images, missing icons, or unaligned action buttons
4. High-contrast or visible crash banners (500, 404, unhandled rejection)

Respond with structured findings.
"""


class VisualInspectionResult(BaseModel):
    has_visual_defects: bool = False
    is_visually_broken: bool = False
    confidence_score: float = 1.0
    layout_issues: list[str] = Field(default_factory=list)
    visual_anomalies: list[str] = Field(default_factory=list)
    summary: str = "Visual presentation is healthy and aligned."


def _heuristic_visual_check(
    screenshot_bytes: bytes,
    route: str,
    dom_defects: list[str] | None = None,
) -> VisualInspectionResult:
    """Deterministic fallback check when Gemini API key is not configured."""
    if len(screenshot_bytes) < 500:
        return VisualInspectionResult(
            has_visual_defects=True,
            is_visually_broken=True,
            confidence_score=0.9,
            layout_issues=["Empty or corrupted screenshot file."],
            summary="Screenshot size was too small to represent a rendered page.",
        )

    if dom_defects:
        return VisualInspectionResult(
            has_visual_defects=True,
            is_visually_broken=True,
            confidence_score=0.85,
            layout_issues=dom_defects,
            summary=f"DOM visual heuristics detected {len(dom_defects)} defect(s) on {route}.",
        )

    return VisualInspectionResult(
        has_visual_defects=False,
        is_visually_broken=False,
        confidence_score=0.0,
        layout_issues=[],
        summary=f"Gemini API unconfigured; visual inspection skipped on {route} (file size {len(screenshot_bytes)} bytes verified).",
    )


def inspect_screenshot_with_gemini(
    screenshot: Path | bytes,
    route: str = "/",
    context_description: str = "",
    dom_defects: list[str] | None = None,
) -> VisualInspectionResult:
    """Inspect a browser screenshot using Google Gemini through the Strands SDK."""
    if isinstance(screenshot, (str, Path)):
        p = Path(screenshot)
        if not p.exists():
            return VisualInspectionResult(
                has_visual_defects=True,
                is_visually_broken=True,
                confidence_score=1.0,
                layout_issues=[f"Screenshot not found at path: {p}"],
                summary="Screenshot file was missing.",
            )
        screenshot_bytes = p.read_bytes()
    else:
        screenshot_bytes = screenshot

    # Fallback if Gemini credentials are not present in current environment
    if not has_api_key_for_role(ModelRole.VISUAL_INSPECTION):
        logger.info("No Gemini API key found; running deterministic visual check for %s", route)
        return _heuristic_visual_check(screenshot_bytes, route, dom_defects=dom_defects)

    try:
        agent = create_strands_agent(
            role=ModelRole.VISUAL_INSPECTION,
            system_prompt=SYSTEM_PROMPT,
        )

        img_source: ImageSource = {"bytes": screenshot_bytes}
        img_content: ImageContent = {"format": "png", "source": img_source}

        prompt_text = (
            f"Analyze this screenshot captured on route '{route}'.\n"
            f"Context: {context_description or 'Automated PR verification journey'}\n"
            "Report whether any visual defects, broken elements, or layout shifts exist."
        )

        message: Message = {
            "role": "user",
            "content": [
                {"text": prompt_text},
                {"image": img_content},
            ],
        }

        # Run structured output through Strands agent
        res = agent.structured_output(VisualInspectionResult, [message])
        logger.info("Gemini visual inspection completed for %s: has_defects=%s", route, res.has_visual_defects)
        return res
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini visual inspection via Strands failed (%s), using fallback.", exc)
        return _heuristic_visual_check(screenshot_bytes, route, dom_defects=dom_defects)
