"""Verifies the exploratory agent can't be tricked into "clicking" a button
a real user could never see or reach.

Raised directly by the user: "what if the button was just hidden but as we
r doing through playwright we might just get the btn anyways." A plain
document.querySelectorAll('button') does exactly that — it returns
display:none, opacity:0, off-screen, and overlay-covered elements just as
readily as real visible ones. This test stands up a page with one real
button and four decoys (one per hiding technique) and asserts observe_page()
only ever surfaces the real one, and is_visible_and_reachable() independently
agrees for each case.

Deliberately NOT covered here (out of scope by design, see
visual_inspector.py instead): a button that IS visible and reachable but
looks visually wrong to a human (bad contrast, overlapping text, squeezed
layout). That class of defect lives in rendered pixels, not DOM/CSS
properties, and needs a vision pass, not a computed-style check.
"""

from __future__ import annotations

import http.server
import threading

import pytest
from playwright.sync_api import sync_playwright

from agent.journeys.browser_agent import is_visible_and_reachable, observe_page

PAGE_WITH_DECOYS = """<!doctype html><html><body>
<button id="real-submit" style="position: fixed; top: 300px; left: 300px;">
  Complete Purchase
</button>

<button id="decoy-display-none" style="display: none;">Hidden Coupon Apply</button>

<button id="decoy-opacity-zero" style="opacity: 0;">Ghost Admin Delete</button>

<button id="decoy-offscreen" style="position: fixed; left: -9999px; top: -9999px;">
  Offscreen Debug Action
</button>

<button id="decoy-covered" style="position: fixed; top: 40px; left: 40px;">
  Covered By Overlay
</button>
<div style="position: fixed; top: 20px; left: 20px; width: 200px; height: 60px; background: white; z-index: 999;"></div>
</body></html>"""


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE_WITH_DECOYS.encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        pass


@pytest.fixture(scope="module")
def decoy_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_observe_page_excludes_hidden_and_covered_buttons(decoy_server: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(decoy_server, wait_until="networkidle")
            obs = observe_page(page)

            elements_text = " ".join(obs.interactive_elements)

            assert "real-submit" in elements_text, (
                "The one genuinely visible, reachable button was filtered out "
                f"— false positive. Candidates were: {obs.interactive_elements}"
            )

            for decoy_id in (
                "decoy-display-none",
                "decoy-opacity-zero",
                "decoy-offscreen",
                "decoy-covered",
            ):
                assert decoy_id not in elements_text, (
                    f"#{decoy_id} should never be offered as a click candidate — "
                    "a real user cannot see or reach it. Candidates were: "
                    f"{obs.interactive_elements}"
                )
        finally:
            browser.close()


def test_is_visible_and_reachable_agrees_per_element(decoy_server: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(decoy_server, wait_until="networkidle")

            assert is_visible_and_reachable(page, "#real-submit") is True
            assert is_visible_and_reachable(page, "#decoy-display-none") is False
            assert is_visible_and_reachable(page, "#decoy-opacity-zero") is False
            assert is_visible_and_reachable(page, "#decoy-offscreen") is False
            assert is_visible_and_reachable(page, "#decoy-covered") is False

            # A selector matching nothing at all must also be rejected, not
            # error out — covers a hallucinated selector from the navigator model.
            assert is_visible_and_reachable(page, "#does-not-exist") is False
        finally:
            browser.close()


def test_exploratory_journey_refuses_hallucinated_hidden_selector(decoy_server: str, tmp_path) -> None:
    """End-to-end: if a caller-supplied action targets a hidden decoy (as if
    the navigation model had hallucinated it), the journey must refuse the
    action rather than silently interacting with it, and must not fail the
    whole journey over a single refused action."""
    from agent.journeys.browser_agent import run_route_journey

    res = run_route_journey(
        route="/",
        base_url=decoy_server,
        artifacts_dir=tmp_path,
        test_type="functional",
        actions=[{"type": "click", "selector": "#decoy-display-none"}],
    )

    # The action is refused (logged, skipped) — journey still completes and
    # is judged on actual page health, not on whether the bogus click landed.
    assert res["passed"] is True, res.get("error")
