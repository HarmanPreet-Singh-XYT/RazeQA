"""Human-feel synthetic pointer interaction for recorded journeys.

Two separate problems are solved here.

1. **Real input.** ``page.click(selector)`` / ``page.fill(...)`` are CDP
   DOM-level commands that dispatch synthetic events straight at the element —
   no cursor moves, no button goes down, nothing the browser renders reacts to.
   This module drives ``page.mouse`` / ``page.keyboard`` instead, so hover
   states, focus rings and scroll physics behave as they do for a person.

2. **A visible cursor.** Playwright's ``record_video_dir`` captures a *page*
   screencast, not the desktop: real mouse events move the browser's input
   pipeline but the OS pointer is never part of the rendered page, so the
   recording showed a site apparently operating itself. A DOM overlay cursor is
   injected into every document and animated along the same path, which is what
   makes the recording read as a person using the site.

   The overlay is ``position: fixed``, but a ``transform``/``filter``/
   ``perspective`` on ``<html>`` makes *that* element the containing block rather
   than the viewport, so the cursor is painted in a scaled space while the click
   still lands at true viewport coordinates — the site operated itself in the
   wrong place. ``move()`` therefore measures what it actually painted and
   iterates onto the requested point, which is correct on a plain page and on a
   transformed one, without having to guess which CSS the site under test uses.

Motion is deliberately non-linear: eased curved paths with a random bow, small
idle pauses, a hover beat before pressing, and a visible click pulse.
"""

from __future__ import annotations

import logging
import math
import random
import weakref

from playwright.sync_api import Locator, Page

logger = logging.getLogger("agent.journeys.cursor_overlay")

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
_last_position: weakref.WeakKeyDictionary[Page, tuple[float, float]] = weakref.WeakKeyDictionary()


# Injected into every document (add_init_script re-runs per navigation). The
# cursor is `position: fixed` so it stays put while the page scrolls, and
# `pointer-events: none` so it is excluded from hit-testing — otherwise it would
# sit on top of the very elements the reachability checks probe with
# document.elementFromPoint().
_CURSOR_OVERLAY_SCRIPT = r"""
(() => {
  if (window.__qaCursorInstalled) return;
  window.__qaCursorInstalled = true;

  const POS_KEY = '__qaCursorPos';
  const readPos = () => {
    try {
      const raw = sessionStorage.getItem(POS_KEY);
      if (raw) {
        const parts = raw.split(',');
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        if (isFinite(x) && isFinite(y)) return [x, y];
      }
    } catch (e) { /* storage blocked on this page */ }
    return null;
  };
  const writePos = (x, y) => {
    try { sessionStorage.setItem(POS_KEY, x + ',' + y); } catch (e) { /* ignore */ }
  };

  const ensure = () => {
    if (!document.documentElement || window.__qaCursor) return;

    const style = document.createElement('style');
    style.textContent = `
      #__qa-cursor { position: fixed; left: 50%; top: 45%; width: 22px; height: 22px;
        z-index: 2147483647; pointer-events: none; transform: translate(-4px, -2px);
        transition: transform .07s ease-out; will-change: left, top; }
      #__qa-cursor svg { display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
      .__qa-ripple { position: fixed; width: 14px; height: 14px; border-radius: 9999px;
        border: 2px solid rgba(220,38,38,.85); pointer-events: none; z-index: 2147483646;
        transform: translate(-50%,-50%); animation: __qa-pulse .55s ease-out forwards; }
      .__qa-caption { position: fixed; z-index: 2147483645; pointer-events: none;
        max-width: 320px; padding: 3px 7px; border-radius: 6px; background: rgba(15,23,42,.92);
        color: #f8fafc; font: 600 11px/1.35 ui-sans-serif, system-ui, sans-serif;
        transform: translate(14px, 16px); opacity: 0; transition: opacity .18s ease-out; }
      .__qa-caption.__qa-on { opacity: 1; }
      @keyframes __qa-pulse {
        from { width: 14px; height: 14px; opacity: .9; }
        to { width: 58px; height: 58px; opacity: 0; }
      }`;
    document.documentElement.appendChild(style);

    const el = document.createElement('div');
    el.id = '__qa-cursor';
    el.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24">'
      + '<path d="M4 2 L4 20.5 L9.2 15.4 L12.6 22.4 L15.2 21.2 L11.8 14.3 L18.6 14.1 Z" '
      + 'fill="#111827" stroke="#ffffff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(el);

    const caption = document.createElement('div');
    caption.className = '__qa-caption';
    document.documentElement.appendChild(caption);

    let pressed = false;

    window.__qaCursor = {
      el, caption,
      move(x, y) {
        // `position: fixed` resolves against the nearest ancestor that
        // establishes a containing block. Normally that is the viewport, but a
        // transform/filter/perspective on <html> makes it that element instead,
        // and the overlay is then painted in the transformed space while CDP
        // mouse coordinates stay in true viewport space — so the cursor is
        // drawn somewhere the click does not land.
        //
        // That mapping is affine (rendered = scale * left + offset), so two
        // measurements solve it exactly. Iterating onto the target instead would
        // shrink the error by |1 - scale| per pass: fine for a 0.8 scale, but it
        // never converges at 2.0 and diverges beyond it.
        el.style.transform = 'translate(-4px, -2px)';
        el.style.left = '0px';
        el.style.top = '0px';
        const base = el.getBoundingClientRect();
        el.style.left = '100px';
        el.style.top = '100px';
        const probe = el.getBoundingClientRect();
        const scale_x = (probe.left - base.left) / 100;
        const scale_y = (probe.top - base.top) / 100;

        if (Math.abs(scale_x) > 0.01 && Math.abs(scale_y) > 0.01) {
          // The arrow's tip sits 4px right / 2px up from the element's corner.
          el.style.left = (x - 4 - base.left) / scale_x + 'px';
          el.style.top = (y - 2 - base.top) / scale_y + 'px';
        } else {
          // No measurable geometry (detached or not rendered): aim directly.
          el.style.left = x + 'px';
          el.style.top = y + 'px';
        }

        if (pressed) el.style.transform = 'translate(-4px, -2px) scale(.86)';
        // The caption is anchored to the pointer, so it has to travel with
        // it. Callers label the action *before* gliding to the target, and a
        // caption that stayed at the old position read as detached from the
        // cursor it was describing.
        if (caption.classList.contains('__qa-on')) {
          caption.style.left = el.style.left;
          caption.style.top = el.style.top;
        }
        // Recorded in viewport coordinates, and replayed through move() on the
        // next document, so the corrected local offset never leaks into storage.
        writePos(x, y);
      },
      press() { pressed = true; el.style.transform = 'translate(-4px, -2px) scale(.86)'; },
      release() { pressed = false; el.style.transform = 'translate(-4px, -2px) scale(1)'; },
      ripple() {
        const r = document.createElement('div');
        r.className = '__qa-ripple';
        r.style.left = el.style.left;
        r.style.top = el.style.top;
        document.documentElement.appendChild(r);
        setTimeout(() => r.remove(), 600);
      },
      label(text) {
        if (!text) { caption.classList.remove('__qa-on'); return; }
        caption.textContent = text;
        caption.style.left = el.style.left;
        caption.style.top = el.style.top;
        caption.classList.add('__qa-on');
      },
    };

    // Appear somewhere sensible on the FIRST frame of every document instead of
    // parked off-screen. A new document is created on every navigation, which is
    // why the cursor used to vanish after each page change until the next move.
    // Routed through move() so a transformed <html> is corrected here too, rather
    // than setting left/top raw and rendering at the uncorrected offset.
    const restored = window.__qaPendingCursor || readPos();
    window.__qaPendingCursor = null;
    if (restored) window.__qaCursor.move(restored[0], restored[1]);
  };

  window.__qaCursorEnsure = ensure;

  // Self-healing: if a framework wiped the node (hydration, document rewrite),
  // the next move recreates it rather than silently doing nothing.
  window.__qaCursorMove = (x, y) => {
    ensure();
    if (window.__qaCursor) window.__qaCursor.move(x, y);
    else window.__qaPendingCursor = [x, y];
  };
  window.__qaCursorPress = () => { ensure(); if (window.__qaCursor) window.__qaCursor.press(); };
  window.__qaCursorRelease = () => { ensure(); if (window.__qaCursor) window.__qaCursor.release(); };
  window.__qaCursorRipple = () => { ensure(); if (window.__qaCursor) window.__qaCursor.ripple(); };
  window.__qaCursorLabel = (t) => { ensure(); if (window.__qaCursor) window.__qaCursor.label(t); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure, { once: true });
  } else {
    ensure();
  }
})();
"""


def install_cursor_overlay(page: Page) -> None:
    """Inject the visible cursor overlay for this page and every navigation."""
    try:
        page.add_init_script(_CURSOR_OVERLAY_SCRIPT)
        # Apply to the document already loaded (add_init_script only affects
        # future navigations).
        page.evaluate(_CURSOR_OVERLAY_SCRIPT)
    except Exception as exc:  # noqa: BLE001
        # Never fail a run because the cosmetic layer could not be installed.
        logger.debug("Could not install cursor overlay: %s", exc)


def _cursor_move(page: Page, x: float, y: float) -> None:
    try:
        page.evaluate("([x, y]) => window.__qaCursorMove && window.__qaCursorMove(x, y)", [x, y])
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not move overlay cursor: %s", exc)


def _cursor_press(page: Page, pressed: bool) -> None:
    fn = "__qaCursorPress" if pressed else "__qaCursorRelease"
    try:
        page.evaluate(f"() => window.{fn} && window.{fn}()")
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not press overlay cursor: %s", exc)


def _cursor_ripple(page: Page) -> None:
    try:
        page.evaluate("() => window.__qaCursorRipple && window.__qaCursorRipple()")
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not ripple overlay cursor: %s", exc)


def annotate_cursor(page: Page, text: str | None) -> None:
    """Show a short caption next to the cursor, so a recording is self-explaining."""
    try:
        page.evaluate("(t) => window.__qaCursorLabel && window.__qaCursorLabel(t)", text or "")
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not caption overlay cursor: %s", exc)


def restore_cursor(page: Page) -> None:
    """Re-show the cursor after a navigation.

    A new document gets a brand-new overlay node, so call this after any
    ``goto``/click that may have navigated. The overlay also persists its own
    position in ``sessionStorage``; this is belt-and-braces for the same-origin
    navigations a QA session performs.
    """
    try:
        page.evaluate("() => window.__qaCursorEnsure && window.__qaCursorEnsure()")
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not re-create overlay cursor: %s", exc)
    try:
        _cursor_move(page, *_get_last_position(page))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not restore overlay cursor position: %s", exc)


def _get_last_position(page: Page) -> tuple[float, float]:
    if page not in _last_position:
        viewport = _viewport_size(page)
        _last_position[page] = (viewport["width"] / 2, viewport["height"] / 2)
    return _last_position[page]


def _set_last_position(page: Page, x: float, y: float) -> None:
    _last_position[page] = (x, y)


def _viewport_size(page: Page) -> dict[str, float]:
    """The page's viewport, with a sane fallback for fakes and odd targets."""
    viewport = getattr(page, "viewport_size", None)
    if not isinstance(viewport, dict) or not viewport.get("width") or not viewport.get("height"):
        return {"width": 1280.0, "height": 720.0}
    return {"width": float(viewport["width"]), "height": float(viewport["height"])}


def _clamp_to_viewport(page: Page, x: float, y: float) -> tuple[float, float]:
    """A pointer cannot leave the display; the overlay cursor can, and then it
    vanishes. Keep every sampled point inside the frame."""
    viewport = _viewport_size(page)
    return (
        min(max(x, 0.0), viewport["width"] - 1.0),
        min(max(y, 0.0), viewport["height"] - 1.0),
    )


def _box_center(box: dict[str, float]) -> tuple[float, float]:
    """The (jittered) center of a bounding box.

    Slight jitter within the element so repeated clicks on the same target
    don't land on the exact same pixel every time — closer to how a human
    never clicks the literal geometric center.
    """
    jitter_x = box["width"] * random.uniform(-0.15, 0.15)
    jitter_y = box["height"] * random.uniform(-0.15, 0.15)
    return (
        box["x"] + box["width"] / 2 + jitter_x,
        box["y"] + box["height"] / 2 + jitter_y,
    )


def _locator_center(page: Page, locator: Locator) -> tuple[float, float] | None:
    box = locator.bounding_box()
    if not box:
        return None
    center = _box_center(box)
    # A center outside the viewport cannot be pointed at or pressed: the overlay
    # cursor would glide off the screen (it is position: fixed) and the press
    # would land on nothing. Callers fall back to a real Playwright action,
    # which scrolls the element in itself.
    viewport = _viewport_size(page)
    if not (0 <= center[0] <= viewport["width"] and 0 <= center[1] <= viewport["height"]):
        return None
    return center


_LINK_BOX_SCRIPT = """(target) => {
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  const hit = anchors.find((a) => {
    try { return new URL(a.href, location.href).href === target; }
    catch (e) { return a.href === target; }
  });
  if (!hit) return null;
  const rect = hit.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  // Only aim at a link a person could actually see. A link scrolled above
  // the fold has a negative viewport y, and gliding to it would park the
  // overlay cursor off-screen (where it stays until the next move).
  const margin = 8;
  if (rect.bottom < margin || rect.top > window.innerHeight - margin) return null;
  if (rect.right < margin || rect.left > window.innerWidth - margin) return null;
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}"""


def move_mouse_to_link(page: Page, url: str, steps: int = 14) -> bool:
    """Glide onto the on-page link that points at ``url``.

    A person navigating to another page moves the pointer onto the link before
    the document changes. Returns False when no matching, measurable anchor
    exists so the caller can fall back to a resting position.
    """
    if not url:
        return False
    try:
        box = page.evaluate(_LINK_BOX_SCRIPT, url)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not locate link %s: %s", url, exc)
        return False
    if not box:
        return False
    try:
        x, y = _box_center(box)
    except (KeyError, TypeError):
        return False
    move_mouse_to(page, x, y, steps=steps)
    return True


def natural_resting_point(page: Page) -> tuple[float, float]:
    """A plausible place for a hand to leave the pointer on this viewport.

    Used when there is no specific target: a *different* point each time, so
    consecutive navigations don't park the cursor on the same pixel. A fixed
    coordinate is exactly what made session replays look like a screenshot
    with pages changing underneath a frozen arrow.
    """
    viewport = _viewport_size(page)
    return (
        random.uniform(viewport["width"] * 0.16, viewport["width"] * 0.84),
        random.uniform(viewport["height"] * 0.20, viewport["height"] * 0.58),
    )


def drift_cursor(page: Page, max_px: float = 26.0, steps: int = 6) -> None:
    """Nudge the pointer a few pixels so it never looks welded in place.

    Real hands are never perfectly still; a long scroll gesture with a pointer
    that never moves is what makes a recording read as a static screenshot.
    """
    start_x, start_y = _get_last_position(page)
    viewport = _viewport_size(page)
    target_x = min(max(start_x + random.uniform(-max_px, max_px), 12.0), viewport["width"] - 12.0)
    target_y = min(max(start_y + random.uniform(-max_px, max_px), 12.0), viewport["height"] - 12.0)
    move_mouse_to(page, target_x, target_y, steps=steps)


def _ease_in_out(t: float) -> float:
    """Smoothstep: slow start, fast middle, slow arrival — not linear."""
    return t * t * (3.0 - 2.0 * t)


def human_path(
    start: tuple[float, float],
    end: tuple[float, float],
    steps: int = 14,
) -> list[tuple[float, float]]:
    """A curved, eased path between two points.

    Real pointer motion is never a straight line at constant speed: it bows, it
    accelerates through the middle, and it overshoots slightly on long throws
    before correcting. Exposed for testing.
    """
    x0, y0 = start
    x1, y1 = end
    dx, dy = x1 - x0, y1 - y0
    distance = math.hypot(dx, dy) or 1.0

    # Perpendicular bow, so the path arcs rather than sliding along a rail.
    mid_x, mid_y = (x0 + x1) / 2, (y0 + y1) / 2
    normal_x, normal_y = -dy / distance, dx / distance
    bow = random.uniform(-0.16, 0.16) * distance
    ctrl_x, ctrl_y = mid_x + normal_x * bow, mid_y + normal_y * bow

    points: list[tuple[float, float]] = []
    for i in range(1, steps + 1):
        t = _ease_in_out(i / steps)
        inv = 1.0 - t
        px = inv * inv * x0 + 2 * inv * t * ctrl_x + t * t * x1
        py = inv * inv * y0 + 2 * inv * t * ctrl_y + t * t * y1
        # Micro-tremor: a hand is never perfectly still.
        points.append((px + random.uniform(-0.8, 0.8), py + random.uniform(-0.8, 0.8)))

    # Overshoot and correct on long throws.
    if distance > 320:
        overshoot = random.uniform(0.02, 0.05)
        points.append((x1 + dx * overshoot, y1 + dy * overshoot))
        points.append((x1, y1))

    return points


def move_mouse_to(page: Page, x: float, y: float, steps: int = 14) -> None:
    """Glide the real cursor along a human path to (x, y).

    Each point is emitted through ``page.mouse.move`` (so hover states and the
    browser's own input pipeline see it) *and* mirrored onto the DOM overlay
    cursor that the video actually records.
    """
    start = _get_last_position(page)
    for px, py in human_path(start, (x, y), steps=steps):
        px, py = _clamp_to_viewport(page, px, py)
        page.mouse.move(px, py)
        _cursor_move(page, px, py)
        # Variable inter-sample delay, with an occasional longer hesitation.
        page.wait_for_timeout(random.randint(6, 16) if random.random() > 0.15 else random.randint(25, 70))
    x, y = _clamp_to_viewport(page, x, y)
    page.mouse.move(x, y)
    _cursor_move(page, x, y)
    _set_last_position(page, x, y)


def bring_into_view(page: Page, locator: Locator, settle_ms: int = 90) -> None:
    """Scroll an element to the middle of the viewport before pointing at it.

    This is what stops the cursor sliding off the bottom of the screen. The
    overlay cursor is ``position: fixed`` and Playwright's ``bounding_box()`` is
    viewport-relative, so an element below the fold has a y *past* the viewport:
    gliding to it moved the pointer off-screen while the page stayed put, and
    the subsequent press landed on whatever happened to be at that point (or
    nothing). Centering rather than ``scroll_into_view_if_needed`` also keeps
    the target clear of sticky headers, which align to the top edge.
    """
    try:
        locator.evaluate("(el) => el.scrollIntoView({ block: 'center', inline: 'center' })")
    except Exception:  # noqa: BLE001
        # Locator.evaluate is unavailable on some fakes and on detached nodes;
        # Playwright's own scroll is a fine second best.
        try:
            locator.scroll_into_view_if_needed(timeout=2000)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not scroll element into view: %s", exc)
            return
    try:
        page.wait_for_timeout(settle_ms)
    except Exception as exc:  # noqa: BLE001
        logger.debug("No settle wait after scrolling into view: %s", exc)


def move_mouse_to_locator(page: Page, locator: Locator, steps: int = 14) -> bool:
    """Moves the cursor to `locator`'s (jittered) center. Returns False if
    the element isn't visible/measurable or isn't inside the viewport."""
    target = _locator_center(page, locator)
    if not target:
        return False
    move_mouse_to(page, target[0], target[1], steps=steps)
    return True


def click_with_cursor(
    page: Page,
    selector: str,
    timeout: float | None = None,
    label: str | None = None,
    **kwargs,
) -> None:
    """Human-looking click: glide over, settle, press, release, pulse.

    ``label`` optionally captions the action next to the cursor so a reviewer
    watching the recording knows what the agent thought it was doing.
    """
    locator = page.locator(selector).first
    if timeout is not None:
        locator.wait_for(state="visible", timeout=timeout)
    else:
        locator.wait_for(state="visible")

    # Scroll the target to the middle of the viewport *before* aiming at it, so
    # the pointer and the press both happen where the viewer can see them.
    bring_into_view(page, locator)

    if label:
        annotate_cursor(page, label)

    if not move_mouse_to_locator(page, locator):
        # The cursor could not be placed on the target: no measurable box, or a
        # centre that falls outside the viewport. Playwright's own click still
        # scrolls the element into view and activates it, so complete the action —
        # but say so, because the recording otherwise shows the button activating
        # with the cursor parked somewhere else, which reads as a broken replay.
        logger.warning(
            "Cursor could not reach %s (%s); clicking without the cursor travelling "
            "to it, so the recording will show this action uncursored",
            selector,
            label or "no label",
        )
        page.click(selector, **kwargs)
        # Playwright scrolled the target into view in order to click it. Now that
        # it is reachable, let the cursor follow so the replay stays truthful.
        move_mouse_to_locator(page, locator)
        return

    # A person pauses on a target before committing to the click.
    page.wait_for_timeout(random.randint(70, 220))
    _cursor_press(page, True)
    page.mouse.down()
    page.wait_for_timeout(random.randint(45, 95))
    page.mouse.up()
    _cursor_press(page, False)
    _cursor_ripple(page)


def fill_with_cursor(page: Page, selector: str, value: str, label: str | None = None, **kwargs) -> None:
    """Human-looking text entry: glide, click to focus, then type per keystroke."""
    locator = page.locator(selector).first
    locator.wait_for(state="visible")

    # Same as click_with_cursor: an input below the fold has to be scrolled to
    # the middle first, or the cursor travels off-screen to a position that is
    # not where the field is.
    bring_into_view(page, locator)

    if label:
        annotate_cursor(page, label)

    if move_mouse_to_locator(page, locator):
        page.wait_for_timeout(random.randint(60, 160))
        _cursor_press(page, True)
        page.mouse.down()
        page.wait_for_timeout(random.randint(35, 70))
        page.mouse.up()
        _cursor_press(page, False)
        _cursor_ripple(page)
    else:
        logger.warning(
            "Cursor could not reach %s (%s); focusing without the cursor travelling "
            "to it, so the recording will show this action uncursored",
            selector,
            label or "no label",
        )
        locator.click(**kwargs)
        # That click scrolled the field into view; let the cursor follow it.
        move_mouse_to_locator(page, locator)

    # Clear any existing value the same way a user would (select-all + type
    # over it) rather than programmatically resetting .value.
    page.keyboard.press("ControlOrMeta+A")
    _type_like_a_human(page, value)


def _type_like_a_human(page: Page, value: str) -> None:
    """Type with per-character jitter and a beat at word boundaries."""
    for index, char in enumerate(value):
        page.keyboard.type(char, delay=random.randint(28, 85))
        if char == " " and index and random.random() > 0.6:
            page.wait_for_timeout(random.randint(90, 220))


def _flick_velocity_profile(steps: int) -> list[float]:
    """Per-frame speed multipliers for one scroll gesture.

    A real scroll accelerates away from rest, cruises, then decelerates as it
    lands. Sending the whole distance as a single wheel event instead is what
    made the page teleport, freeze, teleport.
    """
    profile: list[float] = []
    for index in range(steps):
        t = (index + 1) / steps
        if t < 0.2:
            speed = 0.45 + 2.75 * t  # ramp up
        elif t > 0.75:
            speed = max(0.22, 1.0 - ((t - 0.75) / 0.25) * 0.78)  # ease out
        else:
            speed = 1.0
        profile.append(speed)
    return profile


def wheel_human(page: Page, distance: int, momentum: bool = True) -> int:
    """Perform one human scroll gesture of roughly ``distance`` pixels.

    The distance is decomposed into many small wheel deltas at roughly frame
    cadence (~20px every 8-15ms) following a velocity profile, plus a short
    decaying momentum tail. Returns the number of wheel events emitted.
    """
    if distance == 0:
        return 0

    direction = 1 if distance > 0 else -1
    total = abs(distance)
    steps = max(6, min(30, int(total / random.uniform(18, 26))))
    profile = _flick_velocity_profile(steps)
    per_px = total / sum(profile)

    events = 0
    for speed in profile:
        delta = max(1, round(per_px * speed))
        page.mouse.wheel(0, delta * direction)
        events += 1
        page.wait_for_timeout(random.randint(8, 15))

    if momentum:
        tail = total * random.uniform(0.04, 0.10)
        for _ in range(random.randint(2, 4)):
            if tail < 1:
                break
            page.mouse.wheel(0, max(1, int(tail)) * direction)
            events += 1
            tail *= 0.55
            page.wait_for_timeout(random.randint(10, 20))

    return events
