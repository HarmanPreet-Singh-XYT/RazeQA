"""Tests for static dependency graph and cross-file route impact detection."""

from __future__ import annotations

from pathlib import Path

from agent.analyzer.dependency_graph import DependencyGraph
from agent.analyzer.diff_analyzer import DiffAnalyzer


def test_dependency_graph_discovers_downstream_route(tmp_path: Path) -> None:
    # Set up mock project structure:
    # lib/validator.ts (shared)
    # app/checkout/page.tsx (imports lib/validator)
    # app/login/page.tsx (does not import)
    lib_dir = tmp_path / "lib"
    lib_dir.mkdir(parents=True)
    validator_file = lib_dir / "validator.ts"
    validator_file.write_text("export function validateCard(card: string) { return true; }\n")

    app_dir = tmp_path / "app"
    checkout_dir = app_dir / "checkout"
    checkout_dir.mkdir(parents=True)
    checkout_page = checkout_dir / "page.tsx"
    checkout_page.write_text("import { validateCard } from '@/lib/validator';\nexport default function Page() {}\n")

    login_dir = app_dir / "login"
    login_dir.mkdir(parents=True)
    login_page = login_dir / "page.tsx"
    login_page.write_text("export default function Page() {}\n")

    graph = DependencyGraph(tmp_path)
    graph.build()

    dependents = graph.get_dependents(validator_file)
    assert checkout_page.resolve() in dependents
    assert login_page.resolve() not in dependents

    # Changed validator.ts should mark /checkout as affected
    affected = graph.find_affected_routes(["lib/validator.ts"])
    assert "/checkout" in affected
    assert "/login" not in affected


def test_diff_analyzer_incorporates_downstream_routes() -> None:
    analyzer = DiffAnalyzer(api_key=None)
    # Diff does not contain "checkout" anywhere, but downstream_surfaces has /checkout
    diff = "diff --git a/lib/validator.ts b/lib/validator.ts\n+ export const MAX_LEN = 16;"
    res = analyzer.analyze(diff, intents=[], downstream_surfaces=["/checkout"])

    assert "/checkout" in res.affected_surfaces
    assert res.risk_tag == "High"
    assert "checkout" in res.recommended_journeys
