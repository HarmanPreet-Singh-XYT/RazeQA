"""Targeted vision check for a single element — the expensive escalation
path from visual_heuristics.py's cheap DOM checks.

Deliberately scoped and rare: this crops a screenshot to one element's
bounding box (not the full page) and asks Gemini a narrow question, and is
only ever called when check_visual_heuristics() reports the element is
borderline (not a confident pass, not a confident CSS-detectable defect), or
the journey is running against a High-risk diff surface. Most elements never
reach this — they're either clean or already confidently flagged by the
cheap heuristics.
"""

from __future__ import annotations

import io
import logging

from playwright.sync_api import Locator, Page
from pydantic import BaseModel, Field
from strands.types.content import ImageContent, Message
from strands.types.media import ImageSource

from agent.models.factory import ModelRole, create_strands_agent, has_api_key_for_role

logger = logging.getLogger("agent.journeys.element_vision")

SYSTEM_PROMPT = """You are inspecting a single cropped screenshot of one UI
element (a button, link, or form field) taken during automated browser
testing. Decide whether a real human user could clearly see this element
and understand it is interactive and functional. Common defects: text with
insufficient contrast against its background, text clipped or overflowing
its container, the element visually overlapped or obscured by something
else, or the element appearing broken/unstyled.
"""


class ElementVisionResult(BaseModel):
    looks_broken: bool = False
    confidence: float = 0.5
    reason: str = ""


def _crop_to_element(page: Page, locator: Locator, padding: int = 8) -> bytes | None:
    """Screenshots just the element's region (plus a small padding margin
    for surrounding context), not the full page — keeps the vision call
    cheap and focused on exactly what's under question."""
    box = locator.bounding_box()
    if not box:
        return None
    clip = {
        "x": max(0, box["x"] - padding),
        "y": max(0, box["y"] - padding),
        "width": box["width"] + padding * 2,
        "height": box["height"] + padding * 2,
    }
    try:
        return page.screenshot(clip=clip)
    except Exception:  # noqa: BLE001
        return None


def inspect_element_visually(
    page: Page,
    selector: str,
    reason_for_escalation: str = "",
) -> ElementVisionResult | None:
    """Ask Gemini whether a specific element looks broken to a human.
    Returns None (not a defect — fail open) if no vision credentials are
    configured or the element can't be captured; the cheap heuristic result
    that triggered this call is preserved by the caller in that case."""
    if not has_api_key_for_role(ModelRole.VISUAL_INSPECTION):
        logger.debug("No Gemini API key; skipping element-level vision check for %s", selector)
        return None

    locator = page.locator(selector).first
    screenshot_bytes = _crop_to_element(page, locator)
    if not screenshot_bytes:
        return None

    try:
        agent = create_strands_agent(role=ModelRole.VISUAL_INSPECTION, system_prompt=SYSTEM_PROMPT)

        img_source: ImageSource = {"bytes": screenshot_bytes}
        img_content: ImageContent = {"format": "png", "source": img_source}

        prompt_text = (
            f"This element ({selector}) was flagged as visually ambiguous by a cheap heuristic "
            f"check: {reason_for_escalation or 'no specific reason given'}. "
            "Look at the cropped screenshot and decide if it actually looks broken to a human."
        )
        message: Message = {
            "role": "user",
            "content": [{"text": prompt_text}, {"image": img_content}],
        }

        result = agent.structured_output(ElementVisionResult, [message])
        logger.info(
            "Element vision check on %s: looks_broken=%s confidence=%.2f",
            selector, result.looks_broken, result.confidence,
        )
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("Element vision check failed for %s: %s", selector, exc)
        return None
