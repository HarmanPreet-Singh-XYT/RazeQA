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
