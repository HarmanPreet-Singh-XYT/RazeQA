"""Exercises real Playwright execution end-to-end — no mocks on the journey
functions themselves.

test_gaps_resolved.py::test_pipeline_collects_findings_and_uses_stored_credentials
patches out run_login_journey and run_route_journey entirely, which proves the
pipeline correctly threads mocked journey *outputs* through result assembly
— it never actually launches a browser, records a video, or writes a trace
file. That gave false confidence about the part of the system this repo's
whole pitch depends on (idea.md Section 3.2 step 7: "forensic-grade proof").

These tests stand up a tiny local HTTP server serving a real login form and
dashboard page, then call run_login_journey / run_route_journey directly
(the real functions, unpatched) and assert real video (.mp4 or .webm) and .zip trace
files land on disk with nonzero size — the actual claim the rest of the
system relies on.
"""

from __future__ import annotations

import http.server
import threading
from pathlib import Path

import pytest

from agent.journeys.browser_agent import run_route_journey
from agent.journeys.login import run_login_journey

LOGIN_PAGE = """<!doctype html><html><body>
<form id="login-form">
  <input id="email" name="email" type="email" />
  <input id="password" name="password" type="password" />
  <button type="submit">Sign in</button>
</form>
<script>
document.getElementById('login-form').addEventListener('submit', function (e) {
  e.preventDefault();
  window.location.href = '/dashboard';
});
</script>
</body></html>"""

DASHBOARD_PAGE = """<!doctype html><html><body>
<h1>Dashboard</h1>
<p>Authenticated content</p>
<a href="#" id="sign-out">Sign out</a>
</body></html>"""

CHECKOUT_PAGE = """<!doctype html><html><body>
<h1>Checkout</h1>
<button id="pay">Pay now</button>
</body></html>"""

ROUTES = {"/login": LOGIN_PAGE, "/dashboard": DASHBOARD_PAGE, "/checkout": CHECKOUT_PAGE}


class _Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib method name
        body = ROUTES.get(self.path, "<html><body>Not Found</body></html>")
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        pass  # silence request logging in test output


@pytest.fixture(scope="module")
def local_app_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


def test_real_login_journey_records_video_and_trace(local_app_server: str, tmp_path: Path) -> None:
    result = run_login_journey(
        base_url=local_app_server,
        email="qa@example.com",
        password="changeme123",
        artifacts_dir=tmp_path,
    )

    assert result.passed is True, result.error
    assert result.trace_path.exists()
    assert result.trace_path.stat().st_size > 0, "trace.zip was created but is empty"

    assert result.video_path is not None
    assert result.video_path.exists()
    assert result.video_path.stat().st_size > 0, "video was created but is empty"
    assert result.video_path.suffix in {".mp4", ".webm"}

    assert result.storage_state_path is not None
    assert result.storage_state_path.exists()


def test_real_exploratory_journey_records_video_and_trace(local_app_server: str, tmp_path: Path) -> None:
    res = run_route_journey(
        route="/checkout",
        base_url=local_app_server,
        artifacts_dir=tmp_path,
        test_type="functional",
    )

    assert res["passed"] is True, res.get("error")

    trace_path = Path(res["trace_path"])
    assert trace_path.exists()
    assert trace_path.stat().st_size > 0

    assert res["video_path"] is not None
    video_path = Path(res["video_path"])
    assert video_path.exists()
    assert video_path.stat().st_size > 0


def test_real_exploratory_journey_measures_web_vitals(local_app_server: str, tmp_path: Path) -> None:
    """The collector is installed before navigation, so the real browser
    observes FCP/LCP/TTFB for the page. INP is honestly None because the
    journey performed no user interaction."""
    res = run_route_journey(
        route="/checkout",
        base_url=local_app_server,
        artifacts_dir=tmp_path,
        test_type="functional",
    )

    assert res["passed"] is True, res.get("error")

    vitals = res.get("web_vitals")
    assert isinstance(vitals, dict)
    assert vitals["measured"] is True
    assert vitals["source"] == "browser_performance_api"
    assert vitals["fcp_ms"] is not None and vitals["fcp_ms"] > 0
    assert vitals["lcp_ms"] is not None and vitals["lcp_ms"] > 0
    assert vitals["ttfb_ms"] is not None
    # No interaction occurred, so INP genuinely cannot be measured.
    assert vitals["inp_ms"] is None
    assert "inp_ms" not in vitals["measured_metrics"]

    # Journey duration and action timings are wall-clock measured, not defaults.
    assert res["duration_ms"] > 0
    assert isinstance(res["action_timings_ms"], list)
    assert len(res["action_timings_ms"]) >= 1


def test_real_login_journey_captures_artifacts_on_failure(tmp_path: Path) -> None:
    """Sanity check that the journey genuinely inspects page state rather than
    always reporting success, and that forensic artifacts are still captured
    on a failure path (failures need proof too, not just passes). Points at a
    server with no routes at all, so the login flow can never complete."""
    # Bind then immediately close: reserves a port that is guaranteed free,
    # then guaranteed unreachable (connection refused) once closed.
    probe = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    unreachable_port = probe.server_address[1]
    probe.server_close()

    unreachable_url = f"http://127.0.0.1:{unreachable_port}"

    result = run_login_journey(
        base_url=unreachable_url,
        email="qa@example.com",
        password="changeme123",
        artifacts_dir=tmp_path,
    )

    assert result.passed is False
    assert result.error is not None
    # Trace is still written even on failure — that's the forensic guarantee.
    assert result.trace_path.exists()
