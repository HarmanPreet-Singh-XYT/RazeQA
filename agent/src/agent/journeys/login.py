"""Seeded login journey (idea.md Section 3.3): the dedicated login step that runs
before any other journeys, with full trace + video capture (Section 3.2 step 7).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import sync_playwright


@dataclass
class JourneyResult:
    passed: bool
    trace_path: Path
    video_path: Path | None
    error: str | None = None


def run_login_journey(
    base_url: str,
    email: str,
    password: str,
    artifacts_dir: Path,
) -> JourneyResult:
    """Logs in with the seeded test account and confirms the authenticated
    dashboard is reachable. Session storage is left in the browser context so
    later journeys in the same run can reuse it (idea.md: "login only has to
    happen once per sandbox spin-up").
    """
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    trace_path = artifacts_dir / "login-trace.zip"
    video_dir = artifacts_dir / "video"
    video_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(record_video_dir=str(video_dir))
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        page = context.new_page()

        error: str | None = None
        passed = False
        try:
            page.goto(f"{base_url}/dashboard", wait_until="networkidle")
            page.fill("#email", email)
            page.fill("#password", password)
            page.click("button[type=submit]")
            page.wait_for_url(f"{base_url}/dashboard", timeout=10_000)
            content = page.content()
            passed = any(indicator in content for indicator in ("AutoQA Platform", "Sign out", "ecommerce-web", "Authenticated content", "Dashboard"))
            if not passed:
                error = "Dashboard reached but expected authenticated indicators were missing."
        except Exception as exc:  # noqa: BLE001 - captured as a journey failure, not a crash
            error = str(exc)

        context.tracing.stop(path=str(trace_path))
        video_path = page.video.path() if page.video else None
        context.close()
        browser.close()

    return JourneyResult(passed=passed, trace_path=trace_path, video_path=video_path, error=error)
