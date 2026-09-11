"""Real synthetic pointer interaction for recorded journeys.

page.click(selector) / page.fill(selector, value) are CDP DOM-level commands
— Playwright resolves the selector and dispatches synthetic click/input
events directly on the element. No cursor moves, no mouse button goes down,
nothing the browser's own rendering reacts to — it's the same mechanism any
Playwright/Selenium/Cypress E2E test uses, not an agent operating the page
the way a human with a mouse would.

This module drives real input instead: page.mouse.move(x, y, steps=N) emits
interpolated mousemove events Chrome actually renders a cursor for and
:hover states react to; page.mouse.down()/up() are real button-press events;
page.keyboard.type() emits individual keydown/keyup pairs per character
instead of setting the input's value directly. All coordinate-driven off
each element's real bounding box (DOM/accessibility-tree grounded — fast and
reliable) rather than vision-driven pixel guessing. This is what actually
shows up as cursor movement in the CDP screencast video; no OS-level
integration needed since it stays entirely inside the browser's own input
pipeline.
"""

from __future__ import annotations

import random
import weakref

from playwright.sync_api import Locator, Page

# Tracks the last known cursor position per Page, so movement is continuous
# ("cursor slides from wherever it was to the next target") instead of every
# action starting from a fixed origin, which would look like teleporting.
#
# Keyed by the Page object itself via WeakKeyDictionary rather than id(page):
# a plain dict keyed by id() never evicts entries when a Page is garbage
# collected, both leaking memory across the life of the worker process and
# risking a correctness bug — CPython can reuse a freed object's id() for a
# brand-new Page, which would silently inherit a stale cursor position from
# an unrelated prior run. WeakKeyDictionary entries disappear automatically
# once the Page itself is collected, closing both gaps.
_last_position: "weakref.WeakKeyDictionary[Page, tuple[float, float]]" = weakref.WeakKeyDictionary()


def _get_last_position(page: Page) -> tuple[float, float]:
    if page not in _last_position:
        viewport = page.viewport_size or {"width": 1280, "height": 720}
        _last_position[page] = (viewport["width"] / 2, viewport["height"] / 2)
    return _last_position[page]


def _set_last_position(page: Page, x: float, y: float) -> None:
    _last_position[page] = (x, y)


def _locator_center(locator: Locator) -> tuple[float, float] | None:
    box = locator.bounding_box()
    if not box:
        return None
    # Slight jitter within the element so repeated clicks on the same target
    # don't land on the exact same pixel every time — closer to how a human
    # never clicks the literal geometric center.
    jitter_x = box["width"] * random.uniform(-0.15, 0.15)
    jitter_y = box["height"] * random.uniform(-0.15, 0.15)
    return (
        box["x"] + box["width"] / 2 + jitter_x,
        box["y"] + box["height"] / 2 + jitter_y,
    )


def move_mouse_to(page: Page, x: float, y: float, steps: int = 18) -> None:
    """Moves the real synthetic cursor from its last known position to
    (x, y), emitting interpolated mousemove events along the way (steps > 1
    is what makes this an actual glide instead of a teleport)."""
    page.mouse.move(x, y, steps=steps)
    _set_last_position(page, x, y)


def move_mouse_to_locator(page: Page, locator: Locator, steps: int = 18) -> bool:
    """Moves the cursor to `locator`'s (jittered) center. Returns False if
    the element isn't visible/measurable."""
    target = _locator_center(locator)
    if not target:
        return False
    move_mouse_to(page, target[0], target[1], steps=steps)
    return True


def click_with_cursor(page: Page, selector: str, timeout: float | None = None, **kwargs) -> None:
    """Real mouse-driven click: glide the cursor to the element, press down,
    hold briefly (visible on camera, and closer to real click timing), then
    release — instead of page.click()'s instant synthetic DOM click event."""
    locator = page.locator(selector).first
    if timeout is not None:
        locator.wait_for(state="visible", timeout=timeout)
    else:
        locator.wait_for(state="visible")

    if not move_mouse_to_locator(page, locator):
        # Element has no measurable box (display:none, off-screen, etc.) —
        # fall back to Playwright's own resolution so the action can still
        # complete rather than silently doing nothing.
        page.click(selector, **kwargs)
        return

    page.mouse.down()
    page.wait_for_timeout(random.randint(40, 90))
    page.mouse.up()


def fill_with_cursor(page: Page, selector: str, value: str, **kwargs) -> None:
    """Real mouse-and-keyboard-driven text entry: glide to the field, click
    to focus it, then type character-by-character via page.keyboard.type()
    (individual keydown/keyup events) instead of page.fill()'s instant value
    assignment."""
    locator = page.locator(selector).first
    locator.wait_for(state="visible")

    if move_mouse_to_locator(page, locator):
        page.mouse.down()
        page.wait_for_timeout(random.randint(30, 60))
        page.mouse.up()
    else:
        locator.click(**kwargs)

    # Clear any existing value the same way a user would (select-all + type
    # over it) rather than programmatically resetting .value.
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.type(value, delay=random.randint(25, 60))
