"""Agent-Generated Exploratory Journey & Element-Targeted Scroll Engine.

Per idea.md Section 3.2 #4 and #7:
- Model-driven or heuristic journey exploration over newly changed surfaces.
- Element-targeted scroll: detects nested scroll containers (overflow-y: auto/scroll,
  scrollHeight > clientHeight) and scrolls the specific container rather than the window.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, sync_playwright
from pydantic import BaseModel

logger = logging.getLogger("agent.journeys.browser_agent")


@dataclass
class ScrollableRegion:
    selector: str
    tag_name: str
    scroll_height: int
    client_height: int
    overflow_y: str


@dataclass
class PageObservation:
    url: str
    title: str
    interactive_elements: list[str] = field(default_factory=list)
    scrollable_regions: list[ScrollableRegion] = field(default_factory=list)


def find_scrollable_regions(page: Page) -> list[ScrollableRegion]:
    """Scan the DOM for independently scrollable regions (overflow-y: auto/scroll).

    Dashboards commonly have fixed headers/sidebars and independently scrollable content
    areas where window.scrollTo silently fails.
    """
    script = """() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const regions = [];
        for (const el of elements) {
            const style = window.getComputedStyle(el);
            const overflowY = style.overflowY;
            const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            if (isScrollable) {
                let sel = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : el.tagName.toLowerCase());
                regions.push({
                    selector: sel,
                    tag_name: el.tagName.toLowerCase(),
                    scroll_height: el.scrollHeight,
                    client_height: el.clientHeight,
                    overflow_y: overflowY
                });
            }
        }
        return regions;
    }"""
    try:
        raw_regions = page.evaluate(script)
        return [ScrollableRegion(**r) for r in raw_regions]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to evaluate scrollable regions: %s", exc)
        return []


def scroll_element(page: Page, selector: str | None = None, direction: str = "down", amount: int = 300) -> bool:
    """Targeted scrolling for a specific container in the DOM.

    If selector is provided, confirms it is scrollable and scrolls it.
    If None, detects the first scrollable container, falling back to window.
    """
    delta = amount if direction == "down" else -amount
    script = """([selector, delta]) => {
        let target = selector ? document.querySelector(selector) : null;
        if (!target) {
            // Find first scrollable container
            const all = Array.from(document.querySelectorAll('*'));
            for (const el of all) {
                const s = window.getComputedStyle(el);
                if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                    target = el;
                    break;
                }
            }
        }
        if (target) {
            target.scrollBy({ top: delta, behavior: 'smooth' });
            return { scrolled: true, element: target.tagName.toLowerCase(), scrollTop: target.scrollTop };
        }
        window.scrollBy({ top: delta, behavior: 'smooth' });
        return { scrolled: true, element: 'window', scrollTop: window.scrollY };
    }"""
    try:
        res = page.evaluate(script, [selector, delta])
        logger.info("Scrolled %s by %spx", res.get("element"), delta)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to scroll element %s: %s", selector, exc)
        return False


def observe_page(page: Page) -> PageObservation:
    """Capture accessibility-tree summary, interactive buttons/links, and scrollable areas."""
    script = """() => {
        const interactive = [];
        document.querySelectorAll('button, a, input, select, textarea').forEach(el => {
            const text = el.innerText || el.placeholder || el.value || el.getAttribute('aria-label') || '';
            const id = el.id ? '#' + el.id : '';
            if (text || id) {
                interactive.push(`${el.tagName.toLowerCase()}${id}: "${text.trim().slice(0, 40)}"`);
            }
        });
        return interactive.slice(0, 20);
    }"""
    try:
        interactive = page.evaluate(script)
    except Exception:  # noqa: BLE001
        interactive = []

    scrollable = find_scrollable_regions(page)
    return PageObservation(
        url=page.url,
        title=page.title(),
        interactive_elements=interactive,
        scrollable_regions=scrollable,
    )


class NavigatorDecision(BaseModel):
    action_type: str = "none"  # "click", "type", "scroll", "none"
    selector: str = ""
    text: str = ""
    reasoning: str = ""


def plan_exploratory_actions_with_strands(obs: PageObservation, route: str) -> list[dict[str, Any]]:
    """Use the lightweight navigation model (Claude Haiku) via Strands Agents SDK
    to plan the next non-destructive exploratory action."""
    from agent.models.factory import (
        ModelRole,
        create_strands_agent,
        has_api_key_for_role,
    )

    if not has_api_key_for_role(ModelRole.BROWSER_NAVIGATION):
        return []

    try:
        agent = create_strands_agent(
            role=ModelRole.BROWSER_NAVIGATION,
            system_prompt="You are a lightweight browser exploration agent. Choose one safe, non-destructive exploratory action to verify route stability. Respond in structured JSON.",
        )
        prompt = (
            f"Route: {route}\n"
            f"Page Title: {obs.title}\n"
            f"Interactive Elements: {obs.interactive_elements}\n"
            f"Scrollable Regions: {[r.selector for r in obs.scrollable_regions]}\n"
            "Pick one element to interact with safely."
        )
        decision = agent.structured_output(NavigatorDecision, prompt)
        if decision.action_type in ("click", "type", "scroll") and decision.selector:
            return [{"type": decision.action_type, "selector": decision.selector, "text": decision.text}]
    except Exception as exc:  # noqa: BLE001
        logger.warning("Strands lightweight navigator planning skipped: %s", exc)
    return []


def run_exploratory_journey(
    page: Page,
    route: str,
    base_url: str = "http://localhost:3000",
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute dynamic exploratory journey on an affected route."""
    target_url = f"{base_url.rstrip('/')}/{route.lstrip('/')}"
    logger.info("Starting exploratory journey on %s", target_url)

    try:
        page.goto(target_url, wait_until="networkidle", timeout=10000)
    except Exception as exc:  # noqa: BLE001
        return {"passed": False, "route": route, "error": f"Failed to navigate to {target_url}: {exc}"}

    obs_initial = observe_page(page)

    # If scrollable regions exist, exercise element-targeted scroll
    if obs_initial.scrollable_regions:
        target_region = obs_initial.scrollable_regions[0].selector
        scroll_element(page, selector=target_region, direction="down", amount=250)

    # If no explicit actions provided, use lightweight Strands navigator
    planned_actions = actions if actions is not None else plan_exploratory_actions_with_strands(obs_initial, route)

    # Perform custom or planned actions
    for act in planned_actions:
        action_type = act.get("type")
        selector = act.get("selector", "")
        if action_type == "click":
            try:
                page.click(selector, timeout=3000)
            except Exception as exc:  # noqa: BLE001
                return {"passed": False, "route": route, "error": f"Click failed on {selector}: {exc}"}
        elif action_type == "type":
            try:
                page.fill(selector, act.get("text", ""))
            except Exception as exc:  # noqa: BLE001
                return {"passed": False, "route": route, "error": f"Type failed on {selector}: {exc}"}

    # Verify no unhandled page crash or 500 error in body
    body_text = page.inner_text("body") if page.query_selector("body") else ""
    if "Internal Server Error" in body_text or "Application error" in body_text:
        return {"passed": False, "route": route, "error": "Application crash/error detected on page"}

    return {
        "passed": True,
        "route": route,
        "title": obs_initial.title,
        "interactive_count": len(obs_initial.interactive_elements),
        "scrollable_count": len(obs_initial.scrollable_regions),
    }


def run_route_journey(
    route: str,
    base_url: str = "http://localhost:3000",
    artifacts_dir: Path | None = None,
    test_type: str = "functional",
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Autonomous standalone browser journey for an affected route with full CDP trace,
    screencast video, element-targeted scroll, and Gemini visual check."""
    route_slug = route.strip("/").replace("/", "_") or "home"
    artifacts_dir = artifacts_dir or Path("artifacts/runs/temp")
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    trace_path = artifacts_dir / f"{route_slug}-trace.zip"
    video_dir = artifacts_dir / "video"
    video_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path = artifacts_dir / f"{route_slug}-visual.png"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(record_video_dir=str(video_dir))
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        page = context.new_page()

        res = run_exploratory_journey(page, route=route, base_url=base_url, actions=actions)

        # Visual check using Gemini through Strands SDK
        if "visual" in test_type and res.get("passed"):
            try:
                page.screenshot(path=str(screenshot_path), full_page=True)
                res["screenshot_path"] = str(screenshot_path)

                from agent.journeys.visual_inspector import (
                    inspect_screenshot_with_gemini,
                )
                visual_res = inspect_screenshot_with_gemini(
                    screenshot=screenshot_path,
                    route=route,
                    context_description=f"Automated verification on route {route}",
                )
                res["visual_inspection"] = visual_res.model_dump()
                if visual_res.is_visually_broken:
                    res["passed"] = False
                    res["error"] = f"Visual defect detected by Gemini on {route}: {', '.join(visual_res.layout_issues)}"
            except Exception as exc:  # noqa: BLE001
                logger.warning("Visual screenshot or Gemini analysis failed: %s", exc)

        context.tracing.stop(path=str(trace_path))
        video_path = page.video.path() if page.video else None
        context.close()
        browser.close()

    res["name"] = f"exploratory:{route_slug}"
    res["trace_path"] = str(trace_path)
    res["video_path"] = str(video_path) if video_path else None
    return res

