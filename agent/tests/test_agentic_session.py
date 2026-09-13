"""Human-feel input and the agentic exploration session.

The reported complaint was that a recording looked like the site operating
itself: no visible cursor, mechanical motion, and no evidence of an agent
thinking its way around. These cover the two halves of the fix:

* the motion layer (curved eased paths, visible overlay cursor, uneven wheel
  increments) — pure geometry, testable without a browser;
* the agent loop (adaptive budget, one action per step, a running notebook, and
  the code-level guardrails that stop a page from steering the model).
"""

from __future__ import annotations

import math
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from agent.journeys import browser_agent as ba
from agent.journeys.cursor_overlay import human_path
from agent.journeys.scope_planner import TestingConfig

# ---------------------------------------------------------------------------
# Human motion
# ---------------------------------------------------------------------------

def test_human_path_is_curved_not_a_straight_line():
    """A straight interpolation is what made movement look like a teleport."""
    straightness = []
    for _ in range(25):
        points = human_path((0.0, 0.0), (400.0, 0.0), steps=14)
        # Max perpendicular deviation from the straight line y = 0.
        straightness.append(max(abs(y) for _, y in points))

    assert all(dev > 0 for dev in straightness), "path never bows"
    assert max(straightness) > 20, "bow is too small to read as human"


def test_human_path_starts_and_ends_on_target():
    points = human_path((10.0, 10.0), (250.0, 400.0), steps=14)
    assert math.dist(points[-1], (250.0, 400.0)) < 2.0
    # Never jumps straight to the target on the first sample.
    assert math.dist(points[0], (250.0, 400.0)) > 50


def test_human_path_eases_in_and_out():
    """Early and late samples must be slower than the middle ones."""
    points = human_path((0.0, 0.0), (600.0, 0.0), steps=20)
    deltas = [math.dist(points[i], points[i - 1]) for i in range(1, len(points))]
    middle = max(deltas)
    assert deltas[0] < middle
    assert deltas[1] < middle


def test_human_path_overshoots_on_long_throws():
    overshot = False
    for _ in range(30):
        points = human_path((0.0, 0.0), (800.0, 0.0), steps=14)
        if max(x for x, _ in points) > 800.0:
            overshot = True
            break
    assert overshot, "long throws never overshoot and correct"


def test_human_path_is_not_deterministic():
    first = human_path((0.0, 0.0), (300.0, 200.0))
    second = human_path((0.0, 0.0), (300.0, 200.0))
    assert first != second, "identical paths would look robotic across runs"


# ---------------------------------------------------------------------------
# Visible overlay cursor
# ---------------------------------------------------------------------------

class _OverlayPage:
    """Records the init script and the evaluate() calls made against it."""

    def __init__(self) -> None:
        self.init_scripts: list[str] = []
        self.evaluated: list[tuple[str, object]] = []

    def add_init_script(self, script: str) -> None:
        self.init_scripts.append(script)

    def evaluate(self, script: str, arg=None):
        self.evaluated.append((script, arg))


def test_cursor_overlay_is_injected_for_every_document():
    page = _OverlayPage()
    from agent.journeys.cursor_overlay import install_cursor_overlay

    install_cursor_overlay(page)

    assert page.init_scripts, "overlay must be re-injected on each navigation"
    script = page.init_scripts[0]
    assert "__qa-cursor" in script
    # Cosmetic layer must never intercept clicks or break hit-testing.
    assert "pointer-events: none" in script
    assert "position: fixed" in script, "cursor must not scroll away"


def test_cursor_overlay_survives_injection_failure():
    page = MagicMock()
    page.add_init_script.side_effect = RuntimeError("target closed")
    from agent.journeys.cursor_overlay import install_cursor_overlay

    # Must not raise: a cosmetic layer cannot be allowed to fail a run.
    install_cursor_overlay(page)


def test_mouse_exactly_one_attempt_at_target_and_within_viewport():
    page = MagicMock()
    page.viewport_size = {"width": 1280, "height": 720}
    page.wait_for_timeout = MagicMock()
    from agent.journeys.cursor_overlay import move_mouse_to

    move_mouse_to(page, 300, 200)

    moves = [call.args for call in page.mouse.move.call_args_list]
    assert moves, "no real mouse movement was emitted"
    assert moves[-1] == (300, 200), "final position must be the exact target"


def test_cursor_caption_travels_with_the_pointer():
    """Callers label an action *before* gliding to it, so the caption must
    follow the cursor rather than stay behind at the old position."""
    page = _OverlayPage()
    from agent.journeys.cursor_overlay import install_cursor_overlay

    install_cursor_overlay(page)

    script = page.init_scripts[0]
    move_body = script.split("move(x, y) {", 1)[1].split("},", 1)[0]
    assert "caption.style.left" in move_body
    assert "caption.style.top" in move_body


class _MotionPage:
    """Fake page with a real viewport and a recording mouse."""

    def __init__(self, box=None, scroll_height: int = 0) -> None:
        self.box = box
        self._scroll_height = scroll_height
        self.viewport_size = {"width": 1280, "height": 720}
        self.moves: list[tuple[float, float]] = []
        self.wheels: list[tuple[int, int]] = []
        self.mouse = SimpleNamespace(move=self._move, wheel=self._wheel)

    def _move(self, x: float, y: float) -> None:
        self.moves.append((x, y))

    def _wheel(self, x: int, y: int) -> None:
        self.wheels.append((x, y))

    def wait_for_timeout(self, _ms: int) -> None:
        return None

    def evaluate(self, script: str, arg=None):
        if "querySelectorAll('a[href]')" in script:
            return self.box
        if "scrollHeight" in script and "viewport" in script:
            return {"height": self._scroll_height, "viewport": 800}
        if "overflowY" in script:
            return []
        return None


def test_resting_points_vary_and_stay_inside_the_viewport():
    page = _MotionPage()
    from agent.journeys.cursor_overlay import natural_resting_point

    points = [natural_resting_point(page) for _ in range(40)]

    assert len(set(points)) > 1, "a constant resting point is what froze the replay"
    assert all(0 <= x <= 1280 and 0 <= y <= 720 for x, y in points)


def test_move_mouse_to_link_glides_onto_the_anchor():
    page = _MotionPage(box={"x": 100, "y": 40, "width": 80, "height": 20})
    from agent.journeys.cursor_overlay import move_mouse_to_link

    assert move_mouse_to_link(page, "http://localhost:3000/about") is True
    end_x, end_y = page.moves[-1]
    assert 100 <= end_x <= 180 and 40 <= end_y <= 60, "did not land on the link"


def test_move_mouse_to_link_reports_when_there_is_no_anchor():
    page = _MotionPage(box=None)
    from agent.journeys.cursor_overlay import move_mouse_to_link

    assert move_mouse_to_link(page, "http://localhost:3000/missing") is False
    assert page.moves == []


def test_move_mouse_to_link_ignores_links_scrolled_out_of_view():
    """A link above the fold has a negative viewport y; gliding to it would
    park the overlay cursor off-screen until the next action."""
    from agent.journeys.cursor_overlay import _LINK_BOX_SCRIPT

    assert "getBoundingClientRect" in _LINK_BOX_SCRIPT
    assert "innerHeight" in _LINK_BOX_SCRIPT and "innerWidth" in _LINK_BOX_SCRIPT


def test_move_mouse_to_link_keeps_the_pointer_on_screen():
    page = _MotionPage(box={"x": -200, "y": -300, "width": 400, "height": 600})
    from agent.journeys.cursor_overlay import move_mouse_to_link

    assert move_mouse_to_link(page, "http://localhost:3000/top") is True
    x, y = page.moves[-1]
    assert 0 <= x <= 1280 and 0 <= y <= 720, f"pointer parked off-screen at {(x, y)}"


def test_drift_cursor_never_leaves_the_viewport():
    page = _MotionPage()
    from agent.journeys.cursor_overlay import drift_cursor, move_mouse_to

    move_mouse_to(page, 1270, 710)
    for _ in range(25):
        drift_cursor(page, max_px=60)
        x, y = page.moves[-1]
        assert 12 <= x <= 1268
        assert 12 <= y <= 708


def test_scroll_sweep_moves_the_pointer_not_just_the_page():
    """The wheel sweep used to run with the cursor welded in place, so a long
    scroll read as a static screenshot moving under a frozen arrow."""
    page = _MotionPage(scroll_height=2600)
    from agent.journeys.browser_agent import scroll_through_page

    gestures = scroll_through_page(page)

    assert gestures >= 3
    assert page.moves, "the scroll sweep never moved the pointer"
    assert len(set(page.moves)) > 3, "pointer was effectively welded in place"
    # Cursor movement must not replace the gliding wheel gestures.
    assert len(page.wheels) > gestures * 5


# ---------------------------------------------------------------------------
# Adaptive budget
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "routes,expected_floor,expected_ceiling",
    [
        ([], 12, 80),
        (["/"], 12, 80),
        (["/"] * 5, 12, 80),
        (["/"] * 15, 12, 80),
        (["/"] * 50, 12, 80),
    ],
)
def test_budget_is_bounded(routes, expected_floor, expected_ceiling):
    budget = ba.estimate_session_budget(routes, TestingConfig())
    assert expected_floor <= budget <= expected_ceiling


def test_budget_grows_with_site_size():
    small = ba.estimate_session_budget(["/"], TestingConfig(wall_time_limit_seconds=300, cost_limit_usd=5.0))
    medium = ba.estimate_session_budget(["/"] * 6, TestingConfig(wall_time_limit_seconds=300, cost_limit_usd=5.0))
    assert medium > small


def test_budget_respects_the_wall_clock_ceiling():
    # 30s at ~3s/step allows at most 10 steps, floored at MIN_SESSION_STEPS.
    budget = ba.estimate_session_budget(["/"] * 40, TestingConfig(wall_time_limit_seconds=10, cost_limit_usd=5.0))
    assert budget == ba.MIN_SESSION_STEPS


def test_budget_respects_the_cost_ceiling():
    budget = ba.estimate_session_budget(["/"] * 40, TestingConfig(wall_time_limit_seconds=300, cost_limit_usd=0.01))
    assert budget == ba.MIN_SESSION_STEPS


# ---------------------------------------------------------------------------
# The agent loop
# ---------------------------------------------------------------------------

class _AgentPage:
    """Fake page sufficient for run_agentic_session's happy and safety paths."""

    def __init__(self) -> None:
        self.url = "http://localhost:3000/"
        self.viewport_size = {"width": 1280, "height": 720}
        self.mouse = SimpleNamespace(move=self._move, wheel=lambda *a, **k: None,
                                     down=lambda: None, up=lambda: None)
        self.keyboard = SimpleNamespace(press=lambda *a, **k: None, type=lambda *a, **k: None)
        self.video = None
        self.goto_calls: list[str] = []
        # Pointer position at the moment each navigation started, and the raw
        # stream of move() calls, so tests can prove the cursor actually moved.
        self.mouse_moves: list[tuple[float, float]] = []
        self.cursor_at_goto: list[tuple[float, float] | None] = []
        self.clicked: list[str] = []
        self.typed: list[tuple[str, str]] = []

    def _move(self, x: float, y: float) -> None:
        self.mouse_moves.append((x, y))

    def add_init_script(self, script: str) -> None:
        return None

    def wait_for_timeout(self, _ms: int) -> None:
        return None

    def goto(self, url: str, **_kwargs) -> None:
        self.goto_calls.append(url)
        self.cursor_at_goto.append(self.mouse_moves[-1] if self.mouse_moves else None)
        self.url = url

    def content(self) -> str:
        return "<html></html>"

    def evaluate(self, script: str, arg=None):
        if "scrollHeight" in script and "viewport" in script:
            return {"height": 0, "viewport": 800}
        if "overflowY" in script:
            return []
        return None

    def locator(self, selector: str):
        page = self

        class _Loc:
            def __init__(self) -> None:
                self.first = self

            def count(self) -> int:
                return 1

            def is_visible(self) -> bool:
                return True

            def wait_for(self, **_kwargs) -> None:
                return None

            def bounding_box(self):
                return {"x": 10, "y": 10, "width": 40, "height": 20}

            def click(self, **_kwargs) -> None:
                page.clicked.append(selector)

            def fill(self, value: str, **_kwargs) -> None:
                page.typed.append((selector, value))

        return _Loc()

    def wait_for_load_state(self, *_a, **_k) -> None:
        return None

    def title(self) -> str:
        return "Fixture"

    def query_selector(self, _sel: str):
        return object()

    def inner_text(self, _sel: str) -> str:
        return ""


def _fake_obs(url: str = "http://localhost:3000/"):
    return ba.PageObservation(
        url=url,
        title="Fixture",
        interactive_elements=['a: "About"'],
        interactive_candidates=[ba.InteractiveCandidate(selector='[data-pr-testing-idx="0"]', label='a: "About"')],
        scrollable_regions=[],
        visual_findings=[],
    )


def _run_session(decisions, tmp_path: Path, obs=None, **kwargs):
    """Drive run_agentic_session with a scripted sequence of decisions.

    Click/type are intercepted at the cursor layer and recorded onto the fake
    page, so assertions observe what the loop actually executed rather than
    what a locator was asked to do.
    """
    seq = list(decisions)
    page = _AgentPage()

    fake_context = MagicMock()
    fake_context.new_page.return_value = page
    fake_context.tracing = MagicMock()
    fake_browser = MagicMock()
    fake_browser.new_context.return_value = fake_context

    fake_pw = MagicMock()
    fake_pw.chromium.launch.return_value = fake_browser

    class _PW:
        def __enter__(self):
            return fake_pw

        def __exit__(self, *exc):
            return False

    def _decide(*_a, **_k):
        return seq.pop(0) if seq else ba.AgentAction(action_type="done")

    def _record_click(_page, selector, **_kw):
        page.clicked.append(selector)

    def _record_fill(_page, selector, value, **_kw):
        page.typed.append((selector, value))

    with patch.object(ba, "sync_playwright", return_value=_PW()), \
         patch.object(ba, "observe_page", side_effect=lambda *a, **k: obs or _fake_obs(page.url)), \
         patch.object(ba, "settle_page_for_capture", lambda *a, **k: None), \
         patch.object(ba, "scroll_through_page", lambda *a, **k: 3), \
         patch.object(ba, "collect_internal_links", return_value=[
             {"href": "/about", "url": "http://localhost:3000/about", "text": "About"},
         ]), \
         patch.object(ba, "click_with_cursor", side_effect=_record_click), \
         patch.object(ba, "fill_with_cursor", side_effect=_record_fill), \
         patch.object(ba, "_agentic_decide", side_effect=_decide):
        return ba.run_agentic_session(
            base_url="http://localhost:3000",
            seed_routes=["/"],
            artifacts_dir=tmp_path,
            config=TestingConfig(wall_time_limit_seconds=300, cost_limit_usd=5.0),
            max_steps=kwargs.get("max_steps", 10),
        ), page


def test_agent_session_stops_when_the_model_says_done(tmp_path: Path):
    result, _ = _run_session(
        [
            ba.AgentAction(action_type="note", note="home looked fine"),
            ba.AgentAction(action_type="done", note="covered it"),
        ],
        tmp_path,
    )
    assert result["stop_reason"] == "agent_done"
    assert result["steps_used"] == 2
    assert any("home looked fine" in str(n.get("saw")) for n in result["notes"])


def test_agent_session_records_findings_as_advisory_notes(tmp_path: Path):
    result, _ = _run_session(
        [
            ba.AgentAction(action_type="note", note="checked pricing", finding="pricing CTA overlaps footer"),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
    )
    assert any("pricing CTA overlaps footer" in f for f in result["findings"])


def test_agent_session_refuses_an_unobserved_selector(tmp_path: Path):
    """A page cannot talk the model into clicking something it never saw."""
    result, page = _run_session(
        [
            ba.AgentAction(action_type="click", selector="#invented-by-the-page"),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
    )
    assert page.clicked == []
    assert any("refused click" in str(n.get("did")) for n in result["notes"])


def test_agent_session_refuses_destructive_clicks(tmp_path: Path):
    obs = _fake_obs()
    obs.interactive_candidates = [
        ba.InteractiveCandidate(selector='[data-pr-testing-idx="0"]', label='button: "Delete account"'),
    ]
    result, page = _run_session(
        [
            ba.AgentAction(action_type="click", selector='[data-pr-testing-idx="0"]'),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
        obs=obs,
    )
    assert page.clicked == []
    assert any("destructive" in str(n.get("did")) for n in result["notes"])


def test_agent_session_never_types_into_a_password_field(tmp_path: Path):
    obs = _fake_obs()
    obs.interactive_candidates = [
        ba.InteractiveCandidate(selector="#password", label='input: "Password"'),
    ]
    _result, page = _run_session(
        [
            ba.AgentAction(action_type="type", selector="#password", text="hunter2"),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
        obs=obs,
    )
    assert page.typed == []


def test_agent_session_executes_a_safe_click(tmp_path: Path):
    """The positive case, so the guard tests are not passing vacuously."""
    result, page = _run_session(
        [
            ba.AgentAction(action_type="click", selector='[data-pr-testing-idx="0"]'),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
    )
    assert page.clicked == ['[data-pr-testing-idx="0"]']
    assert any("clicked" in str(n.get("did")) for n in result["notes"])


def test_agent_session_follows_a_link_it_discovered(tmp_path: Path):
    result, page = _run_session(
        [
            ba.AgentAction(action_type="goto", url="http://localhost:3000/about"),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
    )
    assert any("http://localhost:3000/about" in call for call in page.goto_calls)
    assert "/about" in result["pages_visited"]


def test_every_navigation_moves_the_cursor_to_a_new_place(tmp_path: Path):
    """Regression: _goto used to move the pointer to the same hardcoded pixel
    on every navigation, so the replayed cursor sat frozen while pages changed
    underneath it — the recording looked like a slideshow with a stuck arrow."""
    result, page = _run_session(
        [
            ba.AgentAction(action_type="goto", url="http://localhost:3000/about"),
            ba.AgentAction(action_type="goto", url="http://localhost:3000/about"),
            ba.AgentAction(action_type="goto", url="http://localhost:3000/about"),
            ba.AgentAction(action_type="done"),
        ],
        tmp_path,
    )

    # One position recorded per navigation (the initial seed plus three gotos).
    parked = [pos for pos in page.cursor_at_goto if pos is not None]
    assert len(parked) >= 4, f"expected a pointer position per navigation, got {parked}"
    assert all(pos != (200.0, 160.0) for pos in parked), "hardcoded parking spot returned"
    assert len(set(parked)) == len(parked), f"cursor parked on the same pixel twice: {parked}"
    assert all(0 <= x <= 1280 and 0 <= y <= 720 for x, y in parked)
    assert result["steps_used"] == 4


def test_agent_session_stops_after_repeated_failures(tmp_path: Path):
    result, _ = _run_session(
        [ba.AgentAction(action_type="click", selector="#nope") for _ in range(6)],
        tmp_path,
    )
    assert result["stop_reason"] == "no_progress"
    assert result["steps_used"] <= 4


def test_agent_session_handles_a_missing_model(tmp_path: Path):
    page = _AgentPage()
    fake_context = MagicMock()
    fake_context.new_page.return_value = page
    fake_browser = MagicMock()
    fake_browser.new_context.return_value = fake_context
    fake_pw = MagicMock()
    fake_pw.chromium.launch.return_value = fake_browser

    class _PW:
        def __enter__(self):
            return fake_pw

        def __exit__(self, *exc):
            return False

    with patch.object(ba, "sync_playwright", return_value=_PW()), \
         patch.object(ba, "observe_page", return_value=_fake_obs()), \
         patch.object(ba, "settle_page_for_capture", lambda *a, **k: None), \
         patch.object(ba, "collect_internal_links", return_value=[]), \
         patch.object(ba, "_agentic_decide", return_value=None):
        result = ba.run_agentic_session(
            base_url="http://localhost:3000",
            seed_routes=["/"],
            artifacts_dir=tmp_path,
            max_steps=5,
        )

    assert result["stop_reason"] == "model_unavailable"
    assert result["notes"] == []


def test_agent_exploration_can_be_disabled(monkeypatch):
    monkeypatch.setenv("AGENTIC_EXPLORATION", "disabled")
    assert ba.agentic_exploration_enabled(TestingConfig()) is False
    monkeypatch.setenv("AGENTIC_EXPLORATION", "enabled")
    monkeypatch.setattr(ba, "agentic_exploration_enabled", ba.agentic_exploration_enabled)
    # Config flag also disables it.
    assert ba.agentic_exploration_enabled(TestingConfig(agentic_exploration=False)) is False
