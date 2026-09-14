"""Control coverage: a "full sweep" must operate every discovered control once.

Raised by the user: *"it doesn't click on every btn if it goes full sweep —
which basically means it just goes to different pages."*

The cause was structural, in two halves, and both are covered here:

* **Discovery** only ever saw the header nav. ``_OBSERVE_SCRIPT`` filtered to
  controls inside the viewport, and the sweep always observed at the top of the
  page, so the agent's entire menu was seven nav links. Whole-page discovery
  with stable per-element keys fixes that.
* **Action** was model-dependent and, for click/type, impossible: the model was
  asked for a control's exact selector but only ever shown its label. The
  deterministic coverage ledger fixes that — the model may choose the *order*,
  but code guarantees the coverage.
"""

from __future__ import annotations

import http.server
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from playwright.sync_api import sync_playwright

from agent.journeys import browser_agent as ba
from agent.journeys.browser_agent import (
    InteractiveCandidate,
    exercise_discovered_controls,
    observe_page,
)

# ---------------------------------------------------------------------------
# Fixture pages
# ---------------------------------------------------------------------------

PAGE = """<!doctype html><html><body>
<nav><a href="/other">Other page</a></nav>
<button id="save-profile">Save profile</button>
<button id="toggle-details">Toggle details</button>
<button id="logout">Log out</button>
<input id="email" type="email" placeholder="Email">
<input id="secret" type="password" placeholder="Password">
<div role="button" id="custom-cta">Open custom control</div>
<details><summary id="disclosure">More information</summary><p>Body</p></details>
<div style="position: fixed; left: -9999px; top: -9999px;">
  <button id="off-canvas">Off canvas action</button>
</div>
<div style="height: 1600px;">spacer</div>
<button id="below-fold">Below the fold action</button>
</body></html>"""

OTHER = "<!doctype html><html><body><h1>Other page</h1></body></html>"


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = OTHER if self.path.startswith("/other") else PAGE
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, fmt: str, *args) -> None:
        pass


@pytest.fixture(scope="module")
def control_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


# ---------------------------------------------------------------------------
# Discovery: the whole page, with stable keys
# ---------------------------------------------------------------------------

def test_observation_includes_controls_below_the_fold(control_server: str) -> None:
    """A viewport-only observation is why the agent could only ever click the
    seven links in the header."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(control_server, wait_until="networkidle")

            top_only = observe_page(page, run_visual_heuristics=False, full_page=False)
            whole = observe_page(page, run_visual_heuristics=False, full_page=True)

            top_labels = " ".join(c.label for c in top_only.interactive_candidates)
            whole_labels = " ".join(c.label for c in whole.interactive_candidates)

            assert "save-profile" in top_labels
            assert "below-fold" not in top_labels, "viewport-only observation leaked below-fold controls"
            assert "below-fold" in whole_labels, (
                f"whole-page observation missed the below-fold control. Got: {whole_labels}"
            )
        finally:
            browser.close()


def test_observation_still_excludes_off_canvas_controls(control_server: str) -> None:
    """Whole-page must not mean "everything in the DOM": a control parked at
    -9999px is one a real user can never reach, viewport or not."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(control_server, wait_until="networkidle")
            whole = observe_page(page, run_visual_heuristics=False, full_page=True)
            labels = " ".join(c.label for c in whole.interactive_candidates)
            assert "off-canvas" not in labels, f"off-canvas control was offered: {labels}"
        finally:
            browser.close()


def test_observation_discovers_roles_and_disclosures(control_server: str) -> None:
    """Design systems render buttons as divs with a role; a tag-only allowlist
    silently skipped them."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(control_server, wait_until="networkidle")
            whole = observe_page(page, run_visual_heuristics=False, full_page=True)
            labels = " ".join(c.label for c in whole.interactive_candidates)
            assert "custom-cta" in labels, f"role=button control not discovered: {labels}"
            assert "disclosure" in labels, f"<summary> disclosure not discovered: {labels}"
        finally:
            browser.close()


def test_control_keys_are_stable_and_resolvable(control_server: str) -> None:
    """The coverage ledger keys off `key`, not the per-observation selector, so
    the same control must keep the same key across observations."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(control_server, wait_until="networkidle")
            first = observe_page(page, run_visual_heuristics=False, full_page=True)
            second = observe_page(page, run_visual_heuristics=False, full_page=True)

            keys_a = {c.key for c in first.interactive_candidates}
            keys_b = {c.key for c in second.interactive_candidates}

            assert keys_a and "" not in keys_a, "every candidate needs a stable key"
            assert keys_a == keys_b, "control keys changed between identical observations"

            for cand in first.interactive_candidates:
                assert page.locator(cand.selector).count() == 1, (
                    f"selector {cand.selector} for {cand.label} does not resolve uniquely"
                )
        finally:
            browser.close()


def test_kinds_are_classified_for_the_exercise_loop(control_server: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(control_server, wait_until="networkidle")
            obs = observe_page(page, run_visual_heuristics=False, full_page=True)
            kinds = {c.label: c.kind for c in obs.interactive_candidates}
            assert any(k == "link" for k in kinds.values())
            assert any(k == "input" for k in kinds.values())
            assert any(k == "button" for k in kinds.values())
        finally:
            browser.close()


# ---------------------------------------------------------------------------
# The coverage loop (fake page)
# ---------------------------------------------------------------------------

class _Loc:
    def __init__(self) -> None:
        self.first = self

    def count(self) -> int:
        return 1

    def scroll_into_view_if_needed(self, **_kwargs) -> None:
        return None


class _CovPage:
    """Only the surface exercise_discovered_controls touches."""

    def __init__(self, url: str = "http://localhost:3000/") -> None:
        self.url = url
        self.keyboard = SimpleNamespace(press=lambda *a, **k: None)
        self.goto_calls: list[str] = []
        self.evaluated: list[tuple[str, object]] = []

    def wait_for_timeout(self, _ms: int) -> None:
        return None

    def wait_for_load_state(self, *_a, **_k) -> None:
        return None

    def goto(self, url: str, **_kwargs) -> None:
        self.goto_calls.append(url)
        self.url = url

    def evaluate(self, script: str, arg=None):
        self.evaluated.append((script, arg))
        if "tagName" in script:
            return "INPUT"
        return None

    def locator(self, _selector: str) -> _Loc:
        return _Loc()


def _run_loop(cands, page=None, **kwargs):
    page = page or _CovPage()
    clicked: list[str] = []
    typed: list[tuple[str, str]] = []

    def _click(_page, selector, **_kw):
        clicked.append(selector)

    def _fill(_page, selector, value, **_kw):
        typed.append((selector, value))

    with patch.object(ba, "is_visible_and_reachable", return_value=True), \
         patch.object(ba, "click_with_cursor", side_effect=_click), \
         patch.object(ba, "fill_with_cursor", side_effect=_fill), \
         patch.object(ba, "annotate_cursor", lambda *a, **k: None), \
         patch.object(ba, "_control_is_password_field", return_value=False):
        result = exercise_discovered_controls(page, **kwargs)
    return result, clicked, typed, page


def _cand(key: str, kind: str, label: str) -> InteractiveCandidate:
    return InteractiveCandidate(selector=f'[data-k="{key}"]', label=label, key=key, kind=kind)


def test_loop_operates_every_discovered_control() -> None:
    cands = [
        _cand("a", "button", 'button#a: "Save"'),
        _cand("b", "button", 'button#b: "Toggle"'),
        _cand("c", "input", 'input#c: "Email"'),
        _cand("d", "link", 'a#d: "Docs"'),
    ]
    result, clicked, typed, _ = _run_loop(
        cands, route="/", route_url="http://localhost:3000/", candidates=cands
    )
    assert result["discovered"] == 4
    assert result["exercised_count"] == 4, result
    assert len(clicked) == 3
    assert len(typed) == 1
    assert result["coverage_pct"] == 100.0


def test_loop_skips_destructive_controls() -> None:
    cands = [
        _cand("ok", "button", 'button#ok: "Save"'),
        _cand("bye", "button", 'button#bye: "Log out"'),
        _cand("del", "button", 'button#del: "Delete account"'),
    ]
    result, clicked, _typed, _ = _run_loop(
        cands, route="/", route_url="http://localhost:3000/", candidates=cands
    )
    assert result["exercised_count"] == 1
    assert result["skipped_count"] == 2
    assert {s["reason"] for s in result["skipped"]} == {"destructive"}
    assert len(clicked) == 1
    assert result["coverage_pct"] == 33.3


def test_loop_never_types_into_password_fields() -> None:
    cands = [_cand("pw", "input", 'input#pw: "Password"')]
    page = _CovPage()
    with patch.object(ba, "is_visible_and_reachable", return_value=True), \
         patch.object(ba, "click_with_cursor"), \
         patch.object(ba, "fill_with_cursor") as fill, \
         patch.object(ba, "annotate_cursor", lambda *a, **k: None), \
         patch.object(ba, "_control_is_password_field", return_value=True):
        result = exercise_discovered_controls(
            page, route="/", route_url="http://localhost:3000/", candidates=cands
        )
    fill.assert_not_called()
    assert result["skipped"][0]["reason"] == "password-field"


def test_loop_respects_the_budget() -> None:
    cands = [_cand(str(i), "button", f'button: "B{i}"') for i in range(10)]
    result, _clicked, _typed, _ = _run_loop(
        cands, route="/", route_url="http://localhost:3000/", candidates=cands, budget=3
    )
    assert result["exercised_count"] == 3
    assert result["discovered"] == 10


def test_link_keys_are_shared_across_routes_but_page_controls_are_not() -> None:
    """The header nav is one control seen on every route; a page's own button
    must still be exercised on its own page."""
    route_a = [
        _cand("nav-docs", "link", 'a: "Docs"'),
        _cand("save", "button", 'button: "Save"'),
    ]
    route_b = [
        _cand("nav-docs", "link", 'a: "Docs"'),
        _cand("save", "button", 'button: "Save"'),
    ]
    covered: set[str] = set()

    first, _c1, _t1, _ = _run_loop(
        route_a, route="/a", route_url="http://x/a", candidates=route_a, covered=covered
    )
    # The ledger travels back to the caller as a JSON-safe list (that is how the
    # pipeline accumulates it across routes).
    covered.update(first["covered_keys"])
    second, _c2, _t2, _ = _run_loop(
        route_b, route="/b", route_url="http://x/b", candidates=route_b, covered=covered
    )
    covered.update(second["covered_keys"])

    assert first["exercised_count"] == 2
    assert second["exercised_count"] == 1, (
        "the shared nav link should be skipped on the second route, but the "
        "second route's own Save button must still be exercised"
    )
    assert "nav-docs" in covered
    assert "/b::save" in covered


def test_loop_returns_to_the_route_after_a_control_navigates() -> None:
    page = _CovPage()
    cands = [_cand("nav", "link", 'a#nav: "Other page"')]

    def _click_away(_page, _selector, **_kw):
        _page.url = "http://localhost:3000/other"

    with patch.object(ba, "is_visible_and_reachable", return_value=True), \
         patch.object(ba, "click_with_cursor", side_effect=_click_away), \
         patch.object(ba, "annotate_cursor", lambda *a, **k: None):
        result = exercise_discovered_controls(
            page, route="/", route_url="http://localhost:3000/", candidates=cands
        )

    assert result["exercised"][0]["navigated"] is True
    assert page.goto_calls == ["http://localhost:3000/"], "did not return to the route"


def test_extra_pages_opened_by_a_control_are_closed() -> None:
    """`target="_blank"` links open tabs the sweep never inspects. Left open
    they keep loading, and because the context records a video per page they
    also leave stray recordings beside the run's real evidence."""
    page = _CovPage()
    popup = MagicMock()
    popup.video = MagicMock()
    page.context = SimpleNamespace(pages=[page, popup])

    assert ba._close_extra_pages(page) == 1
    popup.close.assert_called_once()
    popup.video.delete.assert_called_once()


def test_closing_extra_pages_survives_a_closed_context() -> None:
    page = _CovPage()
    page.context = SimpleNamespace(pages=None)
    assert ba._close_extra_pages(page) == 0


def test_click_scrolls_the_target_into_view_before_aiming(control_server: str) -> None:
    """The reported bug: after the sweep returns to the top of the page, a
    control that lives mid-page was aimed at *without scrolling back*, so the
    cursor slid down off the bottom of the screen and nothing was visible."""
    from agent.journeys.cursor_overlay import click_with_cursor, install_cursor_overlay

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 720}).new_page()
        try:
            page.goto(control_server, wait_until="networkidle")
            install_cursor_overlay(page)
            page.evaluate(
                "() => { window.__clicked = false;"
                " document.getElementById('below-fold')"
                ".addEventListener('click', () => { window.__clicked = true; }); }"
            )
            # Exactly the starting state the user described: parked at the top,
            # target far below the fold.
            page.evaluate("() => window.scrollTo(0, 0)")
            assert page.evaluate("() => window.scrollY") == 0

            click_with_cursor(page, "#below-fold", timeout=3000)

            assert page.evaluate("() => window.scrollY") > 0, (
                "the page never scrolled to the target, so the cursor left the screen"
            )
            assert page.evaluate("() => window.__clicked") is True, (
                "the press never landed on the button"
            )

            cursor = page.evaluate(
                """() => {
                    const el = document.getElementById('__qa-cursor');
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return {
                      pointTop: parseFloat(el.style.top || '0'),
                      top: r.top, bottom: r.bottom, viewport: window.innerHeight,
                    };
                }"""
            )
            assert cursor is not None, "overlay cursor was never installed"
            # The pointer position itself must be on-screen. (The arrow graphic
            # is ~22px tall, so at the very bottom of a document — where the
            # element cannot be centred — its tail may clip a few pixels.)
            assert 0 <= cursor["pointTop"] <= cursor["viewport"], (
                f"cursor's press point is outside the viewport: {cursor}"
            )
        finally:
            browser.close()


def test_loop_returns_to_the_route_when_a_navigation_commits_late() -> None:
    """A click returns as soon as the mouse event is dispatched; its navigation
    commits later. Judging "did it navigate?" too early made the sweep carry on
    inside the destination page — observed live as forty straight actions on
    /download that the ledger reported as detached controls on /faq."""
    page = _CovPage()
    cands = [
        _cand("nav", "link", 'a#nav: "Docs"'),
        _cand("save", "button", 'button: "Save"'),
    ]

    def _click_then_navigate(_page, selector, **_kw):
        # Only the link navigates; the URL changes once the in-flight
        # navigation is awaited.
        if selector == '[data-k="nav"]':
            _page.pending_url = "http://localhost:3000/docs"

    def _settle(_page, *_a, **_k):
        if getattr(_page, "pending_url", None):
            _page.url = _page.pending_url
            _page.pending_url = None

    page.wait_for_load_state = lambda *a, **k: _settle(page)
    with patch.object(ba, "is_visible_and_reachable", return_value=True), \
         patch.object(ba, "click_with_cursor", side_effect=_click_then_navigate), \
         patch.object(ba, "annotate_cursor", lambda *a, **k: None):
        result = exercise_discovered_controls(
            page, route="/", route_url="http://localhost:3000/", candidates=cands
        )

    assert result["exercised"][0]["navigated"] is True
    assert page.goto_calls == ["http://localhost:3000/"], "sweep did not come back to the route"


def test_loop_recovers_when_it_finds_itself_on_another_route() -> None:
    """Belt and braces for the same bug: if the page is not on the route when a
    control comes up, go back before touching anything."""
    page = _CovPage(url="http://localhost:3000/docs")
    cands = [_cand("save", "button", 'button: "Save"')]
    result, _clicked, _typed, _ = _run_loop(
        cands, page=page, route="/", route_url="http://localhost:3000/", candidates=cands
    )

    assert page.goto_calls == ["http://localhost:3000/"]
    assert result["exercised_count"] == 1


def test_restore_browser_state_reloads_without_clearing_unknown_storage() -> None:
    page = _CovPage()
    ba._restore_browser_state(page, None, "http://localhost:3000/")

    assert page.goto_calls == ["http://localhost:3000/"]
    assert not any("localStorage" in s for s, _ in page.evaluated), (
        "cleared storage it never snapshotted"
    )


def test_restore_browser_state_replays_the_snapshot_then_reloads() -> None:
    """A sweep that toggles the theme must not leave the run's screenshot in
    dark mode."""
    snapshot = {"local": '[["theme","light"]]', "session": "[]"}
    page = _CovPage()
    ba._restore_browser_state(page, snapshot, "http://localhost:3000/")

    replayed = [arg for script, arg in page.evaluated if "localStorage" in script]
    assert replayed == [snapshot]
    assert page.goto_calls == ["http://localhost:3000/"]


def test_snapshot_browser_state_survives_a_hostile_page() -> None:
    page = _CovPage()
    page.evaluate = lambda script, arg=None: (_ for _ in ()).throw(RuntimeError("blocked"))
    assert ba._snapshot_browser_state(page) is None


def test_priority_orders_the_work_without_changing_coverage() -> None:
    cands = [
        _cand("a", "button", 'button: "A"'),
        _cand("b", "button", 'button: "B"'),
        _cand("c", "button", 'button: "C"'),
    ]
    _result, clicked, _typed, _ = _run_loop(
        cands,
        route="/",
        route_url="http://localhost:3000/",
        candidates=cands,
        priority=["c", "a"],
    )
    assert clicked[0] == '[data-k="c"]'
    assert clicked[1] == '[data-k="a"]'
    assert len(clicked) == 3


# ---------------------------------------------------------------------------
# The model only orders the work; it never gates it
# ---------------------------------------------------------------------------

def test_prioritisation_returns_empty_without_a_model_key() -> None:
    obs = ba.PageObservation(url="http://x/", title="X")
    with patch("agent.models.factory.has_api_key_for_role", return_value=False):
        assert ba.prioritise_controls_with_strands(obs, "/") == []


def test_prioritisation_only_accepts_observed_keys() -> None:
    obs = ba.PageObservation(
        url="http://x/",
        title="X",
        interactive_candidates=[_cand("real", "button", 'button: "Real"')],
    )
    agent = SimpleNamespace()
    agent.structured_output = lambda _schema, _prompt: ba.ControlPriority(
        ordered_keys=["invented", "real", "real"]
    )
    with patch("agent.models.factory.has_api_key_for_role", return_value=True), \
         patch("agent.models.factory.create_strands_agent", return_value=agent):
        assert ba.prioritise_controls_with_strands(obs, "/") == ["real"]


def test_prioritisation_failure_degrades_to_document_order() -> None:
    obs = ba.PageObservation(
        url="http://x/",
        title="X",
        interactive_candidates=[_cand("real", "button", 'button: "Real"')],
    )

    def _boom(*_a, **_k):
        raise RuntimeError("model down")

    with patch("agent.models.factory.has_api_key_for_role", return_value=True), \
         patch("agent.models.factory.create_strands_agent", side_effect=_boom):
        assert ba.prioritise_controls_with_strands(obs, "/") == []


# ---------------------------------------------------------------------------
# End to end: a real journey reports its coverage
# ---------------------------------------------------------------------------

def test_journey_operates_the_pages_controls_and_reports_coverage(
    control_server: str, tmp_path: Path
) -> None:
    """The whole point: a route sweep must touch the page's own buttons, not
    just hop to another page."""
    from agent.journeys.browser_agent import run_route_journey

    res = run_route_journey(
        route="/",
        base_url=control_server,
        artifacts_dir=tmp_path,
        test_type="functional",
        # Explicit empty list keeps the model out of the test: the coverage
        # loop is what is under test, and it must not depend on a model call.
        actions=[],
    )

    assert res["passed"] is True, res.get("error")
    coverage = res["coverage"]
    assert coverage["discovered"] > 0
    labels = " ".join(e["label"] for e in coverage["exercised"])
    assert "save-profile" in labels, f"page button never operated. exercised={labels}"
    assert "toggle-details" in labels, f"page button never operated. exercised={labels}"

    skipped = {s["label"]: s["reason"] for s in coverage["skipped"]}
    assert any("logout" in lbl and reason == "destructive" for lbl, reason in skipped.items()), skipped

    assert coverage["coverage_pct"] > 0
    assert 0 < coverage["exercised_count"] <= coverage["discovered"]
