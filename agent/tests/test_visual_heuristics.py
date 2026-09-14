"""Proves the cheap DOM-only visual heuristics (contrast, text clipping,
overlap) actually catch the "visible and reachable but looks broken to a
human eye" case that is_visible_and_reachable() cannot — a button with
white text on a white background, and a button whose label text overflows
its own container. Both pass every structural visibility check (not
display:none, not zero-size, not covered) yet are genuinely unusable to a
real user.
"""

from __future__ import annotations

import http.server
import threading

import pytest
from playwright.sync_api import sync_playwright

from agent.journeys.browser_agent import is_visible_and_reachable
from agent.journeys.visual_heuristics import check_visual_heuristics

PAGE_WITH_VISUAL_DEFECTS = """<!doctype html><html><body>
<button id="healthy-button" style="color: #0f172a; background: #ffffff; padding: 8px 16px;">
  Complete Purchase
</button>

<button id="invisible-text-button" style="color: #ffffff; background: #ffffff; padding: 8px 16px;">
  Apply Discount Code
</button>

<button id="clipped-text-button" style="width: 40px; height: 20px; overflow: hidden; white-space: nowrap;">
  This label text is far too long for its container
</button>

<!-- A laid-out but fully transparent panel over a control. This is the shape
     of a collapsed accordion answer, and it is NOT a visual defect. -->
<div style="margin-top: 40px; position: relative; width: 300px;">
  <button id="transparent-veil-button" style="width: 300px; display: block; padding: 8px 16px;">
    Question with a transparent panel over it
  </button>
  <div id="transparent-veil"
       style="position: absolute; inset: 0; background: rgba(0, 0, 0, 0); pointer-events: none;">
    Laid out but not painted
  </div>
</div>

<!-- Positive control: an opaque panel over a control IS a real defect. -->
<div style="margin-top: 40px; position: relative; width: 300px;">
  <button id="covered-button" style="width: 300px; display: block; padding: 8px 16px;">
    Genuinely covered
  </button>
  <div id="opaque-cover"
       style="position: absolute; inset: 0; background: rgb(255, 255, 255); pointer-events: none;"></div>
</div>

<!-- CSS Color 4 syntax, which the old rgb()-only parser read as black. -->
<div style="margin-top: 40px; width: 300px; background: rgb(10, 10, 12); padding: 16px;">
  <a id="lab-color-link" href="#" style="color: lab(84.9837 0.601262 -2.17986);">
    Light text on a dark panel
  </a>
</div>

<!-- A gradient cannot be reduced to one colour; contrast is unmeasurable. -->
<div style="margin-top: 40px; width: 300px; padding: 16px;
            background-image: linear-gradient(rgb(17, 17, 17), rgb(51, 51, 51));">
  <span id="gradient-text" style="color: rgb(250, 250, 250);">Text on a gradient</span>
</div>

<!-- A 7%-alpha decorative grid: laid over the control geometrically, painted
     behind it, and invisible to a human. -->
<div style="margin-top: 40px; position: relative; width: 300px;">
  <button id="faint-gradient-button" style="width: 300px; display: block; padding: 8px 16px;">
    Control under a faint gradient
  </button>
  <div id="faint-gradient"
       style="position: absolute; inset: 0; pointer-events: none;
              background-image: linear-gradient(90deg, rgba(13, 148, 136, 0.07),
                                                        rgba(13, 148, 136, 0.07));"></div>
</div>

<!-- ...but an opaque gradient overlay genuinely hides the control. -->
<div style="margin-top: 40px; position: relative; width: 300px;">
  <button id="opaque-gradient-button" style="width: 300px; display: block; padding: 8px 16px;">
    Control under an opaque gradient
  </button>
  <div id="opaque-gradient"
       style="position: absolute; inset: 0; pointer-events: none;
              background-image: linear-gradient(rgb(20, 20, 20), rgb(40, 40, 40));"></div>
</div>
</body></html>"""


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE_WITH_VISUAL_DEFECTS.encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        pass


@pytest.fixture(scope="module")
def defects_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_low_contrast_button_passes_structural_check_but_fails_heuristic(defects_server: str) -> None:
    """The core claim under test: a white-on-white button is structurally
    indistinguishable from a normal button (visible, reachable, not covered)
    — is_visible_and_reachable() alone cannot tell them apart. The visual
    heuristic is what actually catches it."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")

            # Structural check sees no problem — this is the gap.
            assert is_visible_and_reachable(page, "#invisible-text-button") is True

            # Visual heuristic catches what structural visibility cannot.
            result = check_visual_heuristics(page, "#invisible-text-button")
            assert result is not None
            assert result.contrast_ratio < 2.0, f"Expected near-zero contrast, got {result.contrast_ratio}"
            assert result.is_defect is True
        finally:
            browser.close()


def test_healthy_button_is_not_flagged(defects_server: str) -> None:
    """Sanity check against false positives — a genuinely fine button must
    not be flagged as defective."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#healthy-button")
            assert result is not None
            assert result.contrast_ratio > 10.0, f"Expected high contrast for dark-on-white text, got {result.contrast_ratio}"
            assert result.is_defect is False
        finally:
            browser.close()


def test_clipped_text_button_is_flagged(defects_server: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#clipped-text-button")
            assert result is not None
            assert result.text_clipped is True
            assert result.is_defect is True
        finally:
            browser.close()


def test_exploratory_journey_surfaces_visual_defect_as_finding(defects_server: str, tmp_path) -> None:
    """End-to-end: the low-contrast button should surface in the journey
    result's visual_findings, the same field the pipeline reads into
    additional_findings — not just detectable in isolation via
    check_visual_heuristics(), but actually reaching the journey output."""
    from agent.journeys.browser_agent import run_route_journey

    res = run_route_journey(
        route="/",
        base_url=defects_server,
        artifacts_dir=tmp_path,
        test_type="functional",
    )

    assert res["passed"] is True  # a visual defect finding, not a hard failure
    findings_text = " ".join(res.get("visual_findings", []))
    assert "invisible-text-button" in findings_text, (
        f"Expected the low-contrast button to be surfaced as a visual finding. "
        f"Got: {res.get('visual_findings')}"
    )


# ---------------------------------------------------------------------------
# False positives
#
# Reported from a real run: 28 findings on a healthy marketing site, all
# "N% of the element is overlapped by div", plus a "low contrast (1.1:1)" on
# light text over a dark hero. Both were artifacts of the measurement, not the
# site.
# ---------------------------------------------------------------------------

def test_transparent_panel_is_not_an_overlap_defect(defects_server: str) -> None:
    """A collapsed accordion answer is laid out over its own question button
    but paints nothing (background: rgba(0,0,0,0)) — it must not be reported
    as an overlap."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#transparent-veil-button")
            assert result is not None
            assert result.overlap_ratio < 0.15, (
                f"a fully transparent panel was counted as overlap "
                f"({result.overlap_ratio:.0%} by {result.overlapping_with})"
            )
            assert result.is_defect is False
        finally:
            browser.close()


def test_opaque_panel_is_still_an_overlap_defect(defects_server: str) -> None:
    """Positive control: the transparent case must not pass by disabling the
    overlap check altogether."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#covered-button")
            assert result is not None
            assert result.overlap_ratio > 0.9, result.overlap_ratio
            assert result.is_defect is True
            assert "overlapped" in result.describe()
        finally:
            browser.close()


def test_css_color_4_syntax_is_resolved_not_assumed_black(defects_server: str) -> None:
    """lab()/oklch() fell through the old rgb()-only regex and were measured as
    black — turning light text on a dark panel into a fabricated 1.1:1."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#lab-color-link")
            assert result is not None
            assert result.contrast_ratio is not None, "lab() colour was not resolved"
            assert result.contrast_ratio > 4.5, (
                f"light-on-dark text measured as {result.contrast_ratio:.1f}:1"
            )
            assert result.is_defect is False
        finally:
            browser.close()


def test_gradient_background_reports_unknown_contrast_not_a_defect(defects_server: str) -> None:
    """A gradient cannot be reduced to one colour. Reporting a ratio computed
    against some further ancestor's colour would be a fabrication."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#gradient-text")
            assert result is not None
            assert result.contrast_ratio is None
            assert result.is_defect is False
            assert "contrast" not in result.describe()
        finally:
            browser.close()


def test_faint_gradient_overlay_is_not_an_overlap_defect(defects_server: str) -> None:
    """The remaining live false positive: a decorative grid of 7%-alpha lines
    covered five hero controls and was reported as 100% overlap."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#faint-gradient-button")
            assert result is not None
            assert result.overlap_ratio < 0.15, (
                f"a 7%-alpha gradient was counted as overlap "
                f"({result.overlap_ratio:.0%} by {result.overlapping_with})"
            )
            assert result.is_defect is False
        finally:
            browser.close()


def test_opaque_gradient_overlay_is_still_an_overlap_defect(defects_server: str) -> None:
    """Positive control: the gradient rule must not become a blanket exemption."""
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(defects_server, wait_until="networkidle")
            result = check_visual_heuristics(page, "#opaque-gradient-button")
            assert result is not None
            assert result.overlap_ratio > 0.9, result.overlap_ratio
            assert result.is_defect is True
        finally:
            browser.close()
