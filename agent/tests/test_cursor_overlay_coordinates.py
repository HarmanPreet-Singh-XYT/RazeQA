"""The visible cursor must be drawn where the click actually lands.

Raised directly by the user: "it just goes somewhere else and btn is somewhere
else which gets clicked." The overlay is ``position: fixed`` on a child of
``<html>``, so it is positioned against the viewport — *unless* a
``transform``/``filter``/``perspective`` on ``<html>`` makes that element the
containing block instead. In that case the overlay is painted in the
transformed space while CDP mouse coordinates stay in true viewport space, and
the recording shows a site operating itself in the wrong place.

These tests measure the rendered arrow rather than trusting the inline style:
``move_mouse_to`` is asked for a viewport point, and the overlay's
``getBoundingClientRect`` is read back and compared against it. A test that
asserted on ``el.style.left`` would have passed throughout the entire bug.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, sync_playwright

from agent.journeys.cursor_overlay import (
    click_with_cursor,
    install_cursor_overlay,
    move_mouse_to,
)

#: The arrow's tip sits 4px right / 2px up from the element's own corner, so
#: adding the hotspot offset back onto the rect recovers the logical point.
_OVERLAY_POINT = """() => {
  const el = document.getElementById('__qa-cursor');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + 4, y: r.top + 2 };
}"""

PROBE_POINTS = [(100.0, 100.0), (600.0, 400.0), (1100.0, 650.0), (960.0, 340.0)]

#: Enough slack for sub-pixel layout without hiding a real drift.
TOLERANCE_PX = 1.5


def _overlay_point(page: Page) -> dict[str, float] | None:
    return page.evaluate(_OVERLAY_POINT)


def _page_with(css: str, body: str = "") -> str:
    return (
        f"<!doctype html><html><head><style>body {{ margin: 0 }}{css}</style></head>"
        f"<body>{body}<div style='height: 2000px'></div></body></html>"
    )


def _assert_lands_on(page: Page, x: float, y: float) -> None:
    drawn = _overlay_point(page)
    assert drawn is not None, f"overlay cursor missing after moving to ({x}, {y})"
    dx = drawn["x"] - x
    dy = drawn["y"] - y
    assert abs(dx) <= TOLERANCE_PX and abs(dy) <= TOLERANCE_PX, (
        f"cursor drawn at ({drawn['x']:.1f}, {drawn['y']:.1f}) but asked for "
        f"({x}, {y}) — off by ({dx:+.1f}, {dy:+.1f})"
    )


def test_overlay_lands_where_it_was_told() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.set_content(_page_with(""))
            install_cursor_overlay(page)
            for x, y in PROBE_POINTS:
                move_mouse_to(page, x, y, steps=3)
                page.wait_for_timeout(30)
                _assert_lands_on(page, x, y)
        finally:
            browser.close()


@pytest.mark.parametrize(
    "transform",
    [
        "transform: scale(0.8); transform-origin: 0 0;",
        "transform: scale(1.4); transform-origin: 0 0;",
        "transform: translate(120px, 60px) scale(0.75); transform-origin: 0 0;",
        # scale 2.0 is the fixed point where an iterative correction stops
        # converging at all, and past it the error grows every pass.
        "transform: scale(2); transform-origin: 0 0;",
    ],
)
def test_overlay_lands_where_it_was_told_under_transformed_html(transform: str) -> None:
    """A transform on <html> puts the overlay in a different coordinate space."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.set_content(_page_with(f"html {{ {transform} }}"))
            install_cursor_overlay(page)
            for x, y in PROBE_POINTS:
                move_mouse_to(page, x, y, steps=3)
                page.wait_for_timeout(30)
                _assert_lands_on(page, x, y)
        finally:
            browser.close()


def test_transform_on_body_does_not_move_the_overlay() -> None:
    """Only <html> is an ancestor of the overlay; a body transform must not
    shift it, or the correction above would over-compensate on normal pages."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.set_content(
                _page_with("body { transform: scale(0.75); transform-origin: 0 0; }")
            )
            install_cursor_overlay(page)
            for x, y in PROBE_POINTS:
                move_mouse_to(page, x, y, steps=3)
                page.wait_for_timeout(30)
                _assert_lands_on(page, x, y)
        finally:
            browser.close()


def test_click_moves_the_cursor_onto_the_target() -> None:
    """The cursor ends up inside the clicked element, not merely somewhere near
    it — the original complaint was a correct click with a stray cursor."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.set_content(
                _page_with(
                    "html { transform: scale(0.8); transform-origin: 0 0; }"
                    " #target { position: absolute; left: 400px; top: 300px;"
                    " width: 160px; height: 44px; }",
                    body="<button id='target'>Place order</button>",
                )
            )
            install_cursor_overlay(page)
            page.evaluate(
                """() => {
                  window.__clicks = [];
                  addEventListener('click', (e) => {
                    window.__clicks.push(e.target.id || e.target.tagName);
                  }, true);
                }"""
            )

            click_with_cursor(page, "#target")
            page.wait_for_timeout(60)

            assert page.evaluate("() => window.__clicks") == ["target"], (
                "the click did not reach the target element"
            )

            box = page.locator("#target").bounding_box()
            assert box is not None
            drawn = _overlay_point(page)
            assert drawn is not None
            assert box["x"] <= drawn["x"] <= box["x"] + box["width"], (
                f"cursor x={drawn['x']:.1f} is outside the target's "
                f"x-range [{box['x']:.1f}, {box['x'] + box['width']:.1f}]"
            )
            assert box["y"] <= drawn["y"] <= box["y"] + box["height"], (
                f"cursor y={drawn['y']:.1f} is outside the target's "
                f"y-range [{box['y']:.1f}, {box['y'] + box['height']:.1f}]"
            )
        finally:
            browser.close()
