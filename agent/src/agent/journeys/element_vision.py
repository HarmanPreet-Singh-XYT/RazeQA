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
import os
import time
from typing import Any

from playwright.sync_api import Locator, Page
from pydantic import BaseModel, Field
from strands.types.content import ImageContent, Message
from strands.types.media import ImageSource

from agent.models.factory import ModelRole, create_strands_agent, has_api_key_for_role

logger = logging.getLogger("agent.journeys.element_vision")

# Model providers occasionally answer with a transient 5xx/429 (Gemini's
# "503 UNAVAILABLE. The service is currently unavailable." is the common one).
# A single blip previously discarded the vision result and let a possibly-broken
# element pass, so retry a bounded number of times with a short backoff.
VISION_MAX_ATTEMPTS = max(1, int(os.environ.get("VISION_MAX_ATTEMPTS", "3")))
VISION_RETRY_BASE_DELAY_S = float(os.environ.get("VISION_RETRY_BASE_DELAY_S", "0.75"))

_TRANSIENT_MARKERS = (
    "503",
    "502",
    "504",
    "500",
    "429",
    "unavailable",
    "overloaded",
    "rate limit",
    "too many requests",
    "timeout",
    "timed out",
    "connection reset",
    "temporarily",
)


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


def _is_transient(exc: Exception) -> bool:
    """Whether a vision failure is worth retrying (provider hiccup, not a bug)."""
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(marker in text for marker in _TRANSIENT_MARKERS)


def _structured_output_with_retry(agent: Any, schema: Any, messages: list[Message]) -> Any:
    """Call ``agent.structured_output``, retrying transient provider failures.

    Non-transient errors propagate to the caller, which fails open (returns
    None) and preserves the cheap heuristic's finding.
    """
    last_exc: Exception | None = None
    for attempt in range(1, VISION_MAX_ATTEMPTS + 1):
        try:
            return agent.structured_output(schema, messages)
        except Exception as exc:
            last_exc = exc
            if attempt >= VISION_MAX_ATTEMPTS or not _is_transient(exc):
                raise
            delay = VISION_RETRY_BASE_DELAY_S * (2 ** (attempt - 1))
            logger.info(
                "Element vision check hit a transient error (attempt %d/%d): %s; retrying in %.2fs",
                attempt,
                VISION_MAX_ATTEMPTS,
                exc,
                delay,
            )
            time.sleep(delay)
    # Unreachable: the loop either returns or raises.
    raise last_exc if last_exc else RuntimeError("vision retry loop did not run")


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

        result = _structured_output_with_retry(agent, ElementVisionResult, [message])
        logger.info(
            "Element vision check on %s: looks_broken=%s confidence=%.2f",
            selector, result.looks_broken, result.confidence,
        )
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("Element vision check failed for %s: %s", selector, exc)
        return None
