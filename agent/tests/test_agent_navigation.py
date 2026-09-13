"""Navigation-fidelity primitives.

The reported behaviour was that a run's recording showed only the home page and
lasted about seven seconds. Two causes are pinned here:

* link checking did not exist, so "do the links work?" was never answered, and
  scroll was a single 250px nudge rather than a pass over the page;
* session replay had to be assembled from per-route clips (`stitch_videos`).

These exercise the pure logic with lightweight fakes — no browser required.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agent.journeys.browser_agent import (
    collect_internal_links,
    is_unsafe_to_click,
    scroll_through_page,
    verify_internal_links,
)
from agent.journeys.video_converter import stitch_videos

# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeRequest:
    def __init__(self, statuses: dict[str, int | Exception]) -> None:
        self.statuses = statuses
        self.requested: list[str] = []

    def get(self, url: str, timeout: int | None = None, max_redirects: int | None = None):
        self.requested.append(url)
        outcome = self.statuses.get(url)
        if isinstance(outcome, Exception):
            raise outcome
        if outcome is None:
            raise RuntimeError(f"no route to {url}")
        return SimpleNamespace(status=outcome)


class _FakePage:
    """Only the surface the navigation helpers touch."""

    def __init__(
        self,
        url: str = "http://localhost:3000/",
        anchors: list[dict[str, str]] | None = None,
        statuses: dict[str, int | Exception] | None = None,
        scroll_height: int = 0,
        viewport: int = 800,
        scrollable_regions: list[dict] | None = None,
    ) -> None:
        self.url = url
        self._anchors = anchors or []
        self._scroll_height = scroll_height
        self._viewport = viewport
        self._regions = scrollable_regions or []
        self.request = _FakeRequest(statuses or {})
        self.wheel_calls: list[tuple[int, int]] = []
        self.mouse = SimpleNamespace(wheel=self._wheel)
        self.scrolled_to: list[int] = []

    def _wheel(self, x: int, y: int) -> None:
        self.wheel_calls.append((x, y))

    def wait_for_timeout(self, _ms: int) -> None:
        return None

    def evaluate(self, script: str, arg=None):
        if "scrollHeight" in script and "viewport" in script:
            return {"height": self._scroll_height, "viewport": self._viewport}
        if "overflowY" in script:
            return self._regions
        if "scrollTo" in script:
            self.scrolled_to.append(0)
            return None
        return self._anchors


# ---------------------------------------------------------------------------
# Link discovery
# ---------------------------------------------------------------------------

def test_collect_internal_links_keeps_only_same_origin_paths():
    page = _FakePage(
        url="http://localhost:3000/",
        anchors=[
            {"href": "/about", "text": "About"},
            {"href": "/", "text": "Home"},  # the current page
            {"href": "https://evil.example.com/x", "text": "External"},
            {"href": "#top", "text": "Anchor"},
            {"href": "mailto:hi@example.com", "text": "Mail"},
            {"href": "/about#team", "text": "About anchor"},  # duplicate path
            {"href": "/docs", "text": "Docs"},
        ],
    )

    links = collect_internal_links(page, current_route="/")

    assert [link["url"] for link in links] == [
        "http://localhost:3000/about",
        "http://localhost:3000/docs",
    ]
    # The raw attribute is kept so a real click can target the actual selector.
    assert links[0]["href"] == "/about"


def test_collect_internal_links_respects_the_cap():
    anchors = [{"href": f"/page-{i}", "text": ""} for i in range(40)]
    page = _FakePage(anchors=anchors)
    assert len(collect_internal_links(page, current_route="/", limit=5)) == 5


def test_collect_internal_links_survives_a_broken_dom_read():
    page = MagicMock()
    page.url = "http://localhost:3000/"
    page.evaluate.side_effect = RuntimeError("detached frame")
    assert collect_internal_links(page, current_route="/") == []


# ---------------------------------------------------------------------------
# Link verification
# ---------------------------------------------------------------------------

def test_verify_internal_links_classifies_statuses():
    links = [
        {"href": "/ok", "url": "http://localhost:3000/ok"},
        {"href": "/gone", "url": "http://localhost:3000/gone"},
        {"href": "/boom", "url": "http://localhost:3000/boom"},
        {"href": "/admin", "url": "http://localhost:3000/admin"},
        {"href": "/slow", "url": "http://localhost:3000/slow"},
    ]
    page = _FakePage(
        statuses={
            "http://localhost:3000/ok": 200,
            "http://localhost:3000/gone": 404,
            "http://localhost:3000/boom": 500,
            "http://localhost:3000/admin": 403,
            "http://localhost:3000/slow": TimeoutError("timed out"),
        }
    )

    report = verify_internal_links(page, links)

    assert [b["url"] for b in report["broken"]] == [
        "http://localhost:3000/gone",
        "http://localhost:3000/boom",
    ]
    # Auth-protected and rate-limited responses are not broken links.
    assert {c["url"] for c in report["checked"]} == {
        "http://localhost:3000/ok",
        "http://localhost:3000/admin",
    }
    # A transport failure is unverified, not a defect.
    assert [u["url"] for u in report["unverified"]] == ["http://localhost:3000/slow"]


def test_verify_internal_links_returns_empty_report_without_links():
    report = verify_internal_links(_FakePage(), [])
    assert report == {"checked": [], "broken": [], "unverified": []}


# ---------------------------------------------------------------------------
# Destructive-link guard
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "link",
    [
        {"href": "/logout", "url": "http://x/logout", "text": "Log out"},
        {"href": "/settings/delete", "url": "http://x/settings/delete", "text": "Delete account"},
        {"href": "/checkout", "url": "http://x/checkout", "text": "Checkout"},
        {"href": "/billing", "url": "http://x/billing", "text": "Billing"},
        {"href": "/account/unsubscribe", "url": "http://x/account/unsubscribe", "text": "Unsubscribe"},
    ],
)
def test_destructive_links_are_never_clicked(link):
    assert is_unsafe_to_click(link) is True


@pytest.mark.parametrize(
    "link",
    [
        {"href": "/about", "url": "http://x/about", "text": "About"},
        {"href": "/docs", "url": "http://x/docs", "text": "Documentation"},
        {"href": "/pricing", "url": "http://x/pricing", "text": "Pricing"},
        {"href": "/features", "url": "http://x/features", "text": "Features"},
    ],
)
def test_ordinary_links_are_clickable(link):
    assert is_unsafe_to_click(link) is False


# ---------------------------------------------------------------------------
# Scrolling
# ---------------------------------------------------------------------------
def test_scroll_through_page_glides_in_many_small_steps():
    """One big wheel event per step teleported the page; a gesture must not."""
    page = _FakePage(scroll_height=2600, viewport=800)

    gestures = scroll_through_page(page)

    assert gestures >= 3
    # Each gesture is decomposed into many small deltas at frame cadence.
    assert len(page.wheel_calls) > gestures * 5, "scroll is not gliding"
    deltas = [dy for _, dy in page.wheel_calls]
    assert all(abs(d) <= 120 for d in deltas), f"a jump this large reads as a teleport: {max(deltas)}"
    # Downward travel dominates; the momentum tail and ease-out are allowed.
    assert sum(1 for d in deltas if d > 0) > sum(1 for d in deltas if d < 0)
    # Returned to the top so the capture starts at the fold.
    assert page.scrolled_to


def test_scroll_through_page_is_bounded():
    page = _FakePage(scroll_height=1_000_000, viewport=800)
    from agent.journeys.browser_agent import MAX_SCROLL_GESTURES

    gestures = scroll_through_page(page)
    assert gestures <= MAX_SCROLL_GESTURES
    assert gestures >= 3


def test_scroll_through_page_tolerates_a_page_that_cannot_scroll():
    page = _FakePage(scroll_height=0, viewport=800)
    assert scroll_through_page(page) == 0


# ---------------------------------------------------------------------------
# Session replay stitching
# ---------------------------------------------------------------------------

def test_stitch_videos_needs_at_least_two_clips(tmp_path: Path):
    only = tmp_path / "one.mp4"
    only.write_bytes(b"x")
    assert stitch_videos([only], tmp_path / "session.mp4") is None


def test_stitch_videos_skips_missing_files(tmp_path: Path):
    present = tmp_path / "a.mp4"
    present.write_bytes(b"x")
    assert stitch_videos([present, tmp_path / "missing.mp4"], tmp_path / "session.mp4") is None


def test_stitch_videos_returns_none_without_ffmpeg(tmp_path: Path):
    first = tmp_path / "a.mp4"
    second = tmp_path / "b.mp4"
    first.write_bytes(b"x")
    second.write_bytes(b"y")

    with patch("agent.journeys.video_converter.shutil.which", return_value=None):
        assert stitch_videos([first, second], tmp_path / "session.mp4") is None


def test_stitch_videos_reports_success_from_ffmpeg(tmp_path: Path):
    first = tmp_path / "a.mp4"
    second = tmp_path / "b.mp4"
    first.write_bytes(b"x")
    second.write_bytes(b"y")
    dest = tmp_path / "session.mp4"

    def _fake_run(args, **kwargs):
        # Emulate ffmpeg writing the stitched output.
        Path(args[-1]).write_bytes(b"stitched")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    with patch("agent.journeys.video_converter.shutil.which", return_value="/usr/bin/ffmpeg"), patch(
        "agent.journeys.video_converter.subprocess.run", side_effect=_fake_run
    ):
        result = stitch_videos([first, second], dest)

    assert result == dest
    assert dest.read_bytes() == b"stitched"


def test_stitch_videos_cleans_up_a_failed_output(tmp_path: Path):
    first = tmp_path / "a.mp4"
    second = tmp_path / "b.mp4"
    first.write_bytes(b"x")
    second.write_bytes(b"y")
    dest = tmp_path / "session.mp4"

    def _failing_run(args, **kwargs):
        # Write a partial file, then report failure — must not be left behind.
        Path(args[-1]).write_bytes(b"partial")
        return SimpleNamespace(returncode=1, stdout="", stderr="encoder error")

    with patch("agent.journeys.video_converter.shutil.which", return_value="/usr/bin/ffmpeg"), patch(
        "agent.journeys.video_converter.subprocess.run", side_effect=_failing_run
    ):
        result = stitch_videos([first, second], dest)

    assert result is None
    assert not dest.exists()


@pytest.mark.parametrize("count", [0, 1])
def test_no_session_replay_for_trivial_runs(tmp_path: Path, count: int):
    paths = []
    for i in range(count):
        p = tmp_path / f"c{i}.mp4"
        p.write_bytes(b"x")
        paths.append(p)
    assert stitch_videos(paths, tmp_path / "session.mp4") is None
