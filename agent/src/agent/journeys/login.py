"""Seeded login journey (idea.md Section 3.3): the dedicated login step that runs
before any other journeys, with full trace + video capture (Section 3.2 step 7).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

from agent.journeys.cursor_overlay import click_with_cursor, fill_with_cursor
from agent.journeys.web_vitals import WEB_VITALS_INIT_SCRIPT, collect_web_vitals


@dataclass
class JourneyResult:
    passed: bool
    trace_path: Path
    video_path: Path | None
    storage_state_path: Path | None = None
    error: str | None = None
    #: Measured browser Web Vitals for the login navigation, if any were
    #: observed. ``None`` means the collector observed nothing (never invented).
    web_vitals: dict[str, Any] | None = None


def run_login_journey(
    base_url: str,
    email: str,
    password: str,
    artifacts_dir: Path,
) -> JourneyResult:
    """Logs in with the seeded test account and confirms the authenticated
    dashboard is reachable. Session storage is exported to artifacts so
    later journeys in the same run can reuse it (idea.md: "login only has to
    happen once per sandbox spin-up").
    """
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    trace_path = artifacts_dir / "login-trace.zip"
    storage_state_path = artifacts_dir / "storage_state.json"
    video_dir = artifacts_dir / "video"
    video_dir.mkdir(parents=True, exist_ok=True)

    saved_state_path: Path | None = None

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(record_video_dir=str(video_dir))
        context.tracing.start(screenshots=True, snapshots=True, sources=True)
        page = context.new_page()
        # Install the Web Vitals collector before any navigation on the login
        # page too, so its lifecycle is observed just like route journeys.
        page.add_init_script(WEB_VITALS_INIT_SCRIPT)

        error: str | None = None
        passed = False
        login_vitals: dict[str, Any] | None = None
        try:
            page.goto(f"{base_url}/dashboard", wait_until="networkidle")
            # If not redirected to /login automatically, navigate to /login
            if not page.query_selector("#email"):
                page.goto(f"{base_url}/login", wait_until="networkidle")

            fill_with_cursor(page, "#email", email)
            fill_with_cursor(page, "#password", password)
            click_with_cursor(page, "button[type=submit]")
            page.wait_for_url(f"{base_url}/dashboard", timeout=10_000)
            content = page.content()
            passed = any(indicator in content for indicator in ("AutoQA Platform", "Sign out", "ecommerce-web", "Authenticated content", "Dashboard"))
            if not passed:
                error = "Dashboard reached but expected authenticated indicators were missing."
            else:
                context.storage_state(path=str(storage_state_path))
                saved_state_path = storage_state_path
        except Exception as exc:  # noqa: BLE001 - captured as a journey failure, not a crash
            error = str(exc)

        # Cleanup must run even if tracing.stop() itself raises — otherwise a
        # tracing failure leaks the browser process for the rest of the run.
        video_path: Path | None = None
        # Read measured vitals while the page is still open.
        try:
            login_vitals = collect_web_vitals(page)
        except Exception:  # noqa: BLE001 - metrics are best-effort, never fatal
            login_vitals = None
        try:
            context.tracing.stop(path=str(trace_path))
        except Exception:  # noqa: BLE001
            pass
        try:
            # page.video.path() returns str, not Path — normalize to match
            # JourneyResult.video_path's declared type.
            video_path = Path(page.video.path()) if page.video else None
        except Exception:  # noqa: BLE001
            video_path = None
        context.close()
        browser.close()

        if video_path and video_path.exists():
            from agent.journeys.video_converter import process_recorded_video

            video_path = process_recorded_video(video_path)

    return JourneyResult(
        passed=passed,
        trace_path=trace_path,
        video_path=video_path,
        storage_state_path=saved_state_path,
        error=error,
        web_vitals=login_vitals,
    )
