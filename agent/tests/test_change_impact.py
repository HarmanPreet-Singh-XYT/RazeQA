"""Change-impact classification.

The defect these guard: mapping changed files straight to routes made
``app/layout.tsx`` (affects every page) and ``README.md`` (affects nothing) look
identical — both produced an empty route list. A ``changed``-scope run then
either tested arbitrary pages or reported a bare "inconclusive".

Each case below is exercised against a real ``DependencyGraph`` built from a
temporary App Router tree, so the classification is tested through the same
import-graph machinery production uses.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.analyzer.change_impact import (
    MAX_CLASSIFIED_ROUTES,
    classify_change_impact,
    global_ui_routes,
)
from agent.analyzer.dependency_graph import DependencyGraph


@pytest.fixture
def site(tmp_path: Path) -> DependencyGraph:
    """A small App Router project with the shapes that matter."""
    files = {
        "app/layout.tsx": 'import Nav from "@/components/Nav";\n'
        "export default function L({children}: any){return <div><Nav/>{children}</div>;}",
        "app/page.tsx": 'import Hero from "@/components/Hero";\nexport default function P(){return <Hero/>;}',
        "app/about/page.tsx": "export default function P(){return <p>about</p>;}",
        "app/pricing/page.tsx": 'import {price} from "@/lib/pricing";\nexport default function P(){return <p>{price()}</p>;}',
        "app/api/track/route.ts": 'import {track} from "@/lib/analytics";\nexport async function POST(){track();return new Response("ok");}',
        "components/Hero.tsx": "export default function Hero(){return <h1>hi</h1>;}",
        "components/Nav.tsx": "export default function Nav(){return <nav/>;}",
        "components/Footer.tsx": "export default function Footer(){return <footer/>;}",
        "lib/pricing.ts": "export const price = () => 10;",
        "lib/analytics.ts": "export const track = () => {};",
        "README.md": "# docs",
        "package.json": '{"name":"site"}',
        "app/globals.css": "body{margin:0}",
        "middleware.ts": "export function middleware(){}",
    }
    for rel, content in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    return DependencyGraph(tmp_path)


def _classify(graph: DependencyGraph, files: list[str], scope: str = "changed"):
    return classify_change_impact(files, graph, graph.discover_all_routes(), scope=scope)


# ---------------------------------------------------------------------------
# Route discovery sanity
# ---------------------------------------------------------------------------

def test_fixture_routes_are_discovered(site: DependencyGraph):
    assert site.discover_all_routes() == ["/", "/about", "/pricing"]


# ---------------------------------------------------------------------------
# Case 1: one page changed
# ---------------------------------------------------------------------------

def test_single_changed_page_targets_only_that_route(site: DependencyGraph):
    impact = _classify(site, ["app/pricing/page.tsx"])
    assert impact.kind == "targeted"
    assert impact.force_routes == ["/pricing"]
    assert impact.skip_journeys is False
    assert impact.force_full_sweep is False


def test_component_used_by_one_page_targets_that_page(site: DependencyGraph):
    impact = _classify(site, ["components/Hero.tsx"])
    assert impact.kind == "targeted"
    assert impact.force_routes == ["/"]


def test_shared_util_targets_every_page_that_imports_it(site: DependencyGraph):
    # Give the util a second consumer.
    footer = site.root_dir / "components" / "Footer.tsx"
    footer.write_text('import {price} from "@/lib/pricing";\nexport default function F(){return <p>{price()}</p>;}', encoding="utf-8")
    about = site.root_dir / "app" / "about" / "page.tsx"
    about.write_text('import Footer from "@/components/Footer";\nexport default function P(){return <Footer/>;}', encoding="utf-8")

    impact = classify_change_impact(
        ["lib/pricing.ts"], DependencyGraph(site.root_dir), DependencyGraph(site.root_dir).discover_all_routes()
    )
    assert impact.kind == "targeted"
    assert set(impact.force_routes) == {"/pricing", "/about"}


# ---------------------------------------------------------------------------
# Case 2: no page maps, but the change is app-wide
# ---------------------------------------------------------------------------

def test_root_layout_forces_a_broad_sweep(site: DependencyGraph):
    impact = _classify(site, ["app/layout.tsx"])
    assert impact.kind == "global_ui"
    assert impact.force_full_sweep is True
    assert impact.skip_journeys is False
    assert set(impact.routes) == {"/", "/about", "/pricing"}


def test_global_stylesheet_and_middleware_force_a_broad_sweep(site: DependencyGraph):
    for changed in ("app/globals.css", "middleware.ts"):
        impact = _classify(site, [changed])
        assert impact.kind == "global_ui", changed
        assert impact.force_full_sweep is True


def test_component_rendered_by_the_root_layout_inherits_its_blast_radius(site: DependencyGraph):
    """The nav is on every page but no page imports it — the layout does."""
    impact = _classify(site, ["components/Nav.tsx"])
    assert impact.kind == "global_ui"
    assert impact.force_full_sweep is True


# ---------------------------------------------------------------------------
# Case 3: genuinely no user-visible surface
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "changed",
    ["README.md", "docs/guide.md", ".github/workflows/ci.yml", "package-lock.json", "CHANGELOG.md"],
)
def test_non_ui_files_skip_journeys(site: DependencyGraph, changed: str):
    impact = _classify(site, [changed])
    assert impact.kind == "no_ui_impact"
    assert impact.skip_journeys is True
    assert impact.force_routes is None


def test_api_only_util_has_no_user_visible_impact(site: DependencyGraph):
    """Only an API route imports it, so no page can change."""
    impact = _classify(site, ["lib/analytics.ts"])
    assert impact.kind == "no_ui_impact"
    assert impact.skip_journeys is True


def test_api_route_change_has_no_user_visible_impact(site: DependencyGraph):
    impact = _classify(site, ["app/api/track/route.ts"])
    assert impact.kind == "no_ui_impact"
    assert impact.skip_journeys is True


def test_mixed_page_and_docs_still_targets_the_page(site: DependencyGraph):
    impact = _classify(site, ["app/about/page.tsx", "README.md"])
    assert impact.kind == "targeted"
    assert impact.force_routes == ["/about"]


# ---------------------------------------------------------------------------
# Case 4: unknown blast radius must not be reported as "no impact"
# ---------------------------------------------------------------------------

def test_unreferenced_source_is_unmapped_not_no_impact(site: DependencyGraph):
    (site.root_dir / "lib" / "orphan.ts").write_text("export const x = 1;", encoding="utf-8")
    impact = _classify(site, ["lib/orphan.ts"])
    assert impact.kind == "unmapped"
    assert impact.skip_journeys is False
    # Bounded smoke test rather than an assumed all-clear.
    assert impact.force_routes == ["/"]


def test_dependency_manifest_is_unmapped(site: DependencyGraph):
    impact = _classify(site, ["package.json"])
    assert impact.kind == "unmapped"
    assert impact.skip_journeys is False


def test_unmapped_alongside_targeted_keeps_the_targeted_route(site: DependencyGraph):
    (site.root_dir / "lib" / "orphan.ts").write_text("export const x = 1;", encoding="utf-8")
    impact = _classify(site, ["app/about/page.tsx", "lib/orphan.ts"])
    assert impact.kind == "unmapped"
    assert "/about" in impact.force_routes
    assert "/" in impact.force_routes


def test_classified_route_plan_is_bounded(site: DependencyGraph):
    for index in range(30):
        page = site.root_dir / "app" / f"p{index}" / "page.tsx"
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text("export default function P(){return <p/>;}", encoding="utf-8")
    impact = _classify(site, ["app/layout.tsx"])
    assert len(impact.force_routes) <= MAX_CLASSIFIED_ROUTES


# ---------------------------------------------------------------------------
# Explicit full sweep wins
# ---------------------------------------------------------------------------

def test_explicit_full_sweep_is_never_narrowed_or_skipped(site: DependencyGraph):
    docs = _classify(site, ["README.md"], scope="full")
    assert docs.skip_journeys is False
    assert docs.force_routes is None

    targeted = _classify(site, ["app/pricing/page.tsx"], scope="full")
    assert targeted.force_routes is None
    assert targeted.skip_journeys is False


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_empty_diff_leaves_scope_untouched(site: DependencyGraph):
    impact = _classify(site, [])
    assert impact.kind == "empty"
    assert impact.force_routes is None
    assert impact.skip_journeys is False


def test_diff_and_absolute_paths_are_normalized(site: DependencyGraph):
    impact = _classify(site, ["b/app/about/page.tsx"])
    assert impact.kind == "targeted"
    assert impact.force_routes == ["/about"]

    absolute = _classify(site, [str(site.root_dir / "app" / "about" / "page.tsx")])
    assert absolute.kind == "targeted"
    assert absolute.force_routes == ["/about"]


def test_nested_layout_maps_to_its_subtree(site: DependencyGraph):
    nested = site.root_dir / "app" / "pricing" / "layout.tsx"
    nested.write_text("export default function L({children}: any){return <div>{children}</div>;}", encoding="utf-8")
    impact = _classify(site, ["app/pricing/layout.tsx"])
    assert impact.kind == "global_ui"
    assert impact.routes == ["/pricing"]


def test_route_group_segments_are_stripped():
    routes = ["/", "/pricing"]
    assert global_ui_routes("app/(marketing)/layout.tsx", routes) == routes
    assert global_ui_routes("app/(shop)/pricing/layout.tsx", routes) == ["/pricing"]


def test_classification_is_explained(site: DependencyGraph):
    for files in (["README.md"], ["app/layout.tsx"], ["app/about/page.tsx"], ["package.json"]):
        impact = _classify(site, files)
        assert impact.rationale, f"no rationale for {files}"
        assert impact.kind in impact.rationale or "route" in impact.rationale or "changed" in impact.rationale


def test_to_dict_is_serialisable(site: DependencyGraph):
    import json

    impact = _classify(site, ["app/layout.tsx"])
    payload = json.dumps(impact.to_dict())
    assert "global_ui" in payload


# ---------------------------------------------------------------------------
# Pipeline wiring: a no-UI change must not boot a browser
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_no_ui_impact_short_circuits_journeys(site: DependencyGraph, tmp_path: Path):
    """The whole point: don't spend a sandbox and tokens verifying a docs edit."""
    from unittest.mock import patch

    from agent.analyzer.diff_analyzer import AnalysisResult
    from agent.runner.pipeline import _run_journeys

    impact = _classify(site, ["README.md"])
    assert impact.skip_journeys is True

    analysis = AnalysisResult(
        intents=[],
        framework="nextjs",
        package_manager="npm",
        has_db_migrations=False,
        risk_score=0.0,
        suggested_journeys=[],
        affected_surfaces=[],
    )

    with patch("agent.journeys.browser_agent.run_route_journey") as run_route, patch(
        "agent.runner.pipeline.run_login_journey"
    ) as run_login:
        result = await _run_journeys(
            base_url="http://localhost:3000",
            test_user_email="t@example.com",
            test_user_password="pw",
            artifacts_dir=tmp_path,
            analysis=analysis,
            intents=[],
            test_type="functional",
            run_id="run_no_ui",
            discovered_routes=["/", "/about"],
            change_impact=impact,
        )

    assert run_route.called is False
    assert run_login.called is False
    assert result["raw_journeys"] == []
    assert result["journey_artifacts"] == []
    assert result["agentic_session"] is None
    assert result["change_impact"]["kind"] == "no_ui_impact"
    # The reason must be carried so the run can explain itself.
    assert any("No journeys run" in f for f in result["additional_findings"])


@pytest.mark.asyncio
async def test_classifier_routes_bypass_the_scope_planner(site: DependencyGraph, tmp_path: Path):
    """A known target needs no model call, and gets no model variance."""
    from unittest.mock import patch

    from agent.analyzer.diff_analyzer import AnalysisResult
    from agent.journeys.scope_planner import ScopePlanner
    from agent.runner.pipeline import _run_journeys

    impact = _classify(site, ["app/pricing/page.tsx"])
    assert impact.force_routes == ["/pricing"]

    analysis = AnalysisResult(
        intents=[],
        framework="nextjs",
        package_manager="npm",
        has_db_migrations=False,
        risk_score=0.0,
        suggested_journeys=[],
        affected_surfaces=[],
    )

    visited: list[str] = []

    def _fake_route(route, **kwargs):
        visited.append(route)
        return {
            "passed": True,
            "route": route,
            "name": f"exploratory:{route}",
            "action_timings_ms": [],
            "duration_ms": 10.0,
        }

    with patch.object(ScopePlanner, "plan_test_scope") as plan, patch(
        "agent.runner.pipeline.run_login_journey", return_value=None
    ), patch("agent.journeys.browser_agent.run_route_journey", side_effect=_fake_route):
        await _run_journeys(
            base_url="http://localhost:3000",
            test_user_email="t@example.com",
            test_user_password="pw",
            artifacts_dir=tmp_path,
            analysis=analysis,
            intents=[],
            test_type="functional",
            run_id="run_targeted",
            discovered_routes=["/", "/about", "/pricing"],
            change_impact=impact,
        )

    assert plan.called is False, "a known target must not go through the LLM planner"
    assert visited == ["/pricing"]
