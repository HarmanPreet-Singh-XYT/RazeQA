"""Automated verification tests for external / non-GitHub website testing."""

from __future__ import annotations

import http.server
import threading
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from agent.api.runs import run_store
from agent.main import app
from agent.runner.external_runner import run_external_pipeline

LANDING_PAGE = """<!doctype html>
<html lang="en">
<head><title>External Acme Portal</title></head>
<body>
  <h1>Welcome to Acme Portal</h1>
  <p>Live external web application</p>
  <button id="cta-button" onclick="this.innerText='Clicked!'">Get Started</button>
  <a href="/pricing" id="pricing-link">View Pricing</a>
  <div id="scroll-container" style="overflow-y: scroll; height: 120px; border: 1px solid #ccc; margin-top: 20px;">
    <div style="height: 500px; padding: 10px;">
      <p>Scroll item 1</p>
      <p>Scroll item 2</p>
      <p>Scroll item 3</p>
      <button id="deep-scroll-btn">Deep Action</button>
    </div>
  </div>
</body>
</html>"""

PRICING_PAGE = """<!doctype html>
<html lang="en">
<head><title>Acme Portal - Pricing</title></head>
<body>
  <h1>Pricing Plans</h1>
  <button id="buy-pro">Choose Pro</button>
</body>
</html>"""

EXTERNAL_ROUTES = {
    "/": LANDING_PAGE,
    "/pricing": PRICING_PAGE,
}


class _ExternalTestServerHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        body = EXTERNAL_ROUTES.get(self.path, "<html><body>Not Found</body></html>")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        pass


@pytest.fixture(scope="module")
def external_test_server():
    server = http.server.HTTPServer(("127.0.0.1", 0), _ExternalTestServerHandler)
    host, port = server.server_address
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    base_url = f"http://{host}:{port}"
    yield base_url
    server.shutdown()


@pytest.mark.asyncio
async def test_run_external_pipeline_with_real_playwright(external_test_server: str, tmp_path: Path):
    """Verifies that run_external_pipeline drives Playwright, scrolls nested containers,
    and produces real trace and video artifacts."""
    result = await run_external_pipeline(
        url=external_test_server,
        name="acme-corp",
        routes=["/", "/pricing"],
        test_type="functional",
    )

    assert result["status"] == "success"
    assert len(result["passed_journeys"]) == 2
    assert len(result["failed_journeys"]) == 0
    assert len(result["artifacts"]) == 2

    # Check first route (landing page) artifacts
    landing_art = result["artifacts"][0]
    assert landing_art["passed"] is True
    assert landing_art["title"] == "External Acme Portal"
    assert landing_art["interactive_count"] > 0
    assert landing_art["scrollable_count"] >= 1  # nested container detected!

    # Verify real trace and video files exist and are non-empty
    if landing_art.get("trace_path"):
        trace_file = Path(landing_art["trace_path"])
        assert trace_file.exists()
        assert trace_file.stat().st_size > 0

    if landing_art.get("video_path"):
        video_file = Path(landing_art["video_path"])
        assert video_file.exists()
        assert video_file.stat().st_size > 0


from conftest import AUTH_HEADERS


def test_external_api_endpoint(external_test_server: str):
    """Verifies POST /runs/external dispatches verification and returns run record."""
    client = TestClient(app)

    response = client.post(
        "/runs/external",
        json={
            "url": external_test_server,
            "name": "acme-api-test",
            "routes": ["/"],
            "test_type": "functional",
            "wait": True,
        },
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    data = response.json()
    assert "run_id" in data
    assert data["scope"] == "external"
    assert data["status"] in ("completed", "running")
    if data["status"] == "completed":
        assert data["result"]["status"] == "success"


def test_cli_test_site_parser():
    """Verifies agent-bridge CLI parses test-site arguments correctly."""
    import argparse
    from agent.bridge.cli import main

    # Inspect parser setup without running
    parser = argparse.ArgumentParser(prog="agent-bridge")
    subparsers = parser.add_subparsers(dest="subcommand")
    p_ext = subparsers.add_parser("test-site")
    p_ext.add_argument("url")
    p_ext.add_argument("--test-type", default="functional")
    p_ext.add_argument("--wait", action="store_true")

    args = parser.parse_args(["test-site", "https://example.com", "--test-type", "functional+visual", "--wait"])
    assert args.subcommand == "test-site"
    assert args.url == "https://example.com"
    assert args.test_type == "functional+visual"
    assert args.wait is True
