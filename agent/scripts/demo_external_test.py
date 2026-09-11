#!/usr/bin/env python3
"""Live demonstration script for Autonomous External Website Testing.

Spins up a rich external test web application (with navigation, buttons, nested
scroll regions, and data tables), runs the external verification pipeline using
real Playwright browser execution, records forensic video and traces, and
prints the complete inspection results.

Run with:
    uv run python scripts/demo_external_test.py [OPTIONAL_URL]
"""

from __future__ import annotations

import asyncio
import http.server
import sys
import threading
from pathlib import Path

from agent.runner.external_runner import run_external_pipeline

DEMO_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Apex SaaS — Customer Portal</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
    button { background: #6366f1; color: white; border: none; padding: 10px 18px; border-radius: 8px; cursor: pointer; font-weight: 600; }
    button:hover { background: #4f46e5; }
    .scroll-pane { height: 160px; overflow-y: scroll; border: 1px solid #334155; border-radius: 8px; padding: 12px; background: #0f172a; }
    .scroll-item { padding: 8px; border-bottom: 1px solid #1e293b; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>Apex SaaS Platform</h1>
  <p>External live site autonomous verification demonstration</p>

  <div class="card">
    <h2>Interactive Actions</h2>
    <button id="primary-cta" onclick="this.innerText='Action Triggered!'">Start Free Trial</button>
    <button id="secondary-cta" style="margin-left: 10px; background: #334155;" onclick="alert('Explored')">Documentation</button>
  </div>

  <div class="card">
    <h2>Telemetry Logs (Nested Scroll Container)</h2>
    <p style="font-size: 0.8125rem; color: #94a3b8; margin-bottom: 8px;">Tests element-targeted scroll engine</p>
    <div id="logs-container" class="scroll-pane">
      <div class="scroll-item">🟢 [00:01] Service initialized</div>
      <div class="scroll-item">🟢 [00:02] Database connection pool healthy</div>
      <div class="scroll-item">🔵 [00:05] WebSocket gateway listener open</div>
      <div class="scroll-item">🔵 [00:07] Ingesting telemetry metrics</div>
      <div class="scroll-item">🟡 [00:12] Cache utilization warning (threshold 80%)</div>
      <div class="scroll-item">🟢 [00:15] Memory compaction finished</div>
      <div class="scroll-item">🟢 [00:20] Health check passed 200 OK</div>
      <div class="scroll-item">🚀 [00:25] Ready for production traffic</div>
    </div>
  </div>
</body>
</html>"""


class _DemoHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(DEMO_HTML.encode())

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        pass


def start_demo_server() -> tuple[http.server.HTTPServer, str]:
    server = http.server.HTTPServer(("127.0.0.1", 0), _DemoHandler)
    host, port = server.server_address
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server, f"http://{host}:{port}"


async def main() -> None:
    custom_url = sys.argv[1] if len(sys.argv) > 1 else None
    server = None

    if custom_url:
        target_url = custom_url
        print(f"\n🌐 Testing user-specified external URL: {target_url}")
    else:
        server, target_url = start_demo_server()
        print("\n🚀 Launched standalone external test application at:", target_url)

    print("⚡ Starting Autonomous External Verification Pipeline...")
    print("   • Browser: Chromium (Playwright headless)")
    print("   • Features: Element-Targeted Scroll, Interactive Probing, Video & Trace Recording")
    print("-" * 65)

    try:
        result = await run_external_pipeline(
            url=target_url,
            name="demo-external",
            routes=["/"],
            test_type="functional",
        )

        print("\n" + "=" * 65)
        print("🎉 EXTERNAL SITE VERIFICATION COMPLETED SUCCESSFULLY!")
        print("=" * 65)
        print(f"Status:             {result['status'].upper()}")
        print(f"Execution Duration: {result['duration_s']}s")
        print(f"Summary:            {result['summary']}")
        print(f"Passed Journeys:    {result['passed_journeys']}")

        for art in result["artifacts"]:
            print("\nRoute Details:")
            print(f"  • Target:             {art['route']}")
            print(f"  • Page Title:         {art['title']}")
            print(f"  • Interactive Items:  {art['interactive_count']} candidate(s) discovered")
            print(f"  • Scrollable Regions: {art['scrollable_count']} container(s) exercised")
            if art.get("video_path"):
                p = Path(art["video_path"])
                size_kb = round(p.stat().st_size / 1024, 1) if p.exists() else 0
                print(f"  • Video Proof:        {art['video_path']} ({size_kb} KB)")
            if art.get("trace_path"):
                p = Path(art["trace_path"])
                size_kb = round(p.stat().st_size / 1024, 1) if p.exists() else 0
                print(f"  • Forensic Trace:     {art['trace_path']} ({size_kb} KB)")

        print("=" * 65)

    finally:
        if server:
            server.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
