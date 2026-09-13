"""Classify what a change set can actually affect.

Mapping changed files straight to routes conflates two opposite situations:

* ``app/layout.tsx`` (or ``globals.css``, or ``middleware.ts``) affects *every*
  page but is imported by none, so a pure import-graph walk reports no affected
  route — the widest-blast-radius change looked identical to a docs edit.
* ``README.md`` and a lockfile genuinely affect no user-visible surface, and
  were reported the same way.

Left alone, a ``changed``-scope run therefore either tests arbitrary pages
(paying tokens for a result unrelated to the diff) or reports "inconclusive"
without saying why. This module separates the cases *before* journey planning so
the run can say which one it is.

Kinds, in order of precedence:

``global_ui``
    App-wide surface changed (root layout, global stylesheet, middleware,
    framework/theme config, or a nested layout's subtree) -> verify broadly.
``unmapped``
    Real source/config changed that maps to no route, so the blast radius is
    unknown -> bounded smoke test, labelled as unknown rather than assumed.
``targeted``
    One or more specific routes are known to be affected -> verify exactly
    those, including every route that shares a changed component.
``no_ui_impact``
    Only docs, CI, tests, lockfiles or infra changed -> nothing user-visible to
    verify; say so instead of testing arbitrary pages.
``empty``
    No changed files to reason about -> leave the existing scope rules alone.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

logger = logging.getLogger("agent.analyzer.change_impact")

# Caps how many routes a classifier-chosen plan may contain, so an
# "unmapped" smoke test cannot balloon into a full sweep by accident.
MAX_CLASSIFIED_ROUTES = 12

_SOURCE_SUFFIXES = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte",
    ".css", ".scss", ".sass", ".less", ".html", ".astro", ".py", ".json",
}

# Files that cannot change what a user sees in the running app.
_NON_UI_PATTERNS = (
    r"\.md$",
    r"\.mdx$",
    r"\.txt$",
    r"(^|/)docs?/",
    r"(^|/)LICENSE",
    r"(^|/)CHANGELOG",
    r"(^|/)\.github/",
    r"(^|/)\.gitignore$",
    r"(^|/)\.gitattributes$",
    r"(^|/)\.editorconfig$",
    r"(^|/)\.prettierrc",
    r"(^|/)\.dockerignore$",
    r"(^|/)tests?/",
    r"(^|/)__tests__/",
    r"(^|/)e2e/",
    r"\.test\.",
    r"\.spec\.",
    r"(^|/)conftest\.py$",
    r"(^|/)Dockerfile",
    r"(^|/)docker-compose",
    r"(^|/)\.env\.example$",
    # Dependency lockfiles are generated; if dependencies actually changed,
    # package.json changes too and is classified separately.
    r"\.lock$",
    r"(^|/)package-lock\.json$",
    r"(^|/)yarn\.lock$",
    r"(^|/)pnpm-lock\.yaml$",
    r"(^|/)Pipfile\.lock$",
    r"(^|/)go\.sum$",
    r"(^|/)Cargo\.lock$",
    r"(^|/)composer\.lock$",
    r"(^|/)Gemfile\.lock$",
)
_NON_UI_RE = re.compile("|".join(_NON_UI_PATTERNS), re.IGNORECASE)

# App-wide configuration: changing any of these changes behaviour everywhere.
_GLOBAL_CONFIG_RE = re.compile(
    r"(^|/)(next\.config|tailwind\.config|postcss\.config|vite\.config|astro\.config|"
    r"remix\.config|svelte\.config|nuxt\.config)\.(ts|js|mjs|cjs|json)$",
    re.IGNORECASE,
)
_MIDDLEWARE_RE = re.compile(r"(^|/)(src/)?middleware\.(ts|js|mjs)$", re.IGNORECASE)
_GLOBAL_CSS_RE = re.compile(
    r"(^|/)(src/)?app/(globals|global|index)\.(css|scss|sass|less)$", re.IGNORECASE
)
_PROVIDERS_RE = re.compile(r"(^|/)(app|components|src)/.*providers?\.(tsx|jsx|ts|js)$", re.IGNORECASE)

# Server-only surfaces: changing them cannot change what a user sees.
_BACKEND_ONLY_RE = re.compile(
    r"(^|/)(app|pages|src/app|src/pages)/api/"
    r"|(^|/)api/"
    r"|(^|/)scripts?/"
    r"|(^|/)migrations?/"
    r"|(^|/)supabase/migrations/",
    re.IGNORECASE,
)

# App Router special files that wrap every route in their subtree.
_APP_SPECIAL_RE = re.compile(
    r"(?:^|/)(?:src/)?app/(.*?)(layout|template|error|global-error|not-found|loading)"
    r"\.(?:tsx|jsx|ts|js)$",
    re.IGNORECASE,
)


@dataclass
class ChangeImpact:
    """What this change set is expected to be able to affect."""

    kind: str
    rationale: str
    changed_files: list[str] = field(default_factory=list)
    routes: list[str] = field(default_factory=list)
    global_files: list[str] = field(default_factory=list)
    unmapped_files: list[str] = field(default_factory=list)
    non_ui_files: list[str] = field(default_factory=list)
    # None means "let the normal scope rules decide"; a list means "use exactly these".
    force_routes: list[str] | None = None
    force_full_sweep: bool = False
    skip_journeys: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "rationale": self.rationale,
            "routes": self.routes,
            "global_files": self.global_files,
            "unmapped_files": self.unmapped_files,
            "non_ui_files": self.non_ui_files,
            "force_full_sweep": self.force_full_sweep,
            "skip_journeys": self.skip_journeys,
        }


def _normalize(path: str | Path) -> str:
    cleaned = str(path).replace("\\", "/").strip()
    # Tolerate diff-style and absolute inputs.
    if cleaned.startswith(("a/", "b/")):
        cleaned = cleaned[2:]
    cleaned = cleaned.lstrip("./")
    return cleaned


def _is_non_ui(rel_path: str) -> bool:
    return bool(_NON_UI_RE.search(rel_path))


def _is_backend_only(rel_path: str) -> bool:
    return bool(_BACKEND_ONLY_RE.search(rel_path))


def _relative_to_root(path_value: Any, root_dir: Any) -> str:
    try:
        return Path(path_value).resolve().relative_to(Path(root_dir).resolve()).as_posix()
    except Exception:  # noqa: BLE001
        return _normalize(str(path_value))


def _dependents_verdict(
    rel_path: str,
    dependency_graph: Any,
    discovered_routes: list[str],
) -> str:
    """What a file with no route mapping can still affect.

    ``"global"``  — something app-wide (a root layout, middleware) uses it, so it
    inherits that blast radius: a nav component rendered by the root layout
    appears on every page even though no page imports it.
    ``"non_ui"``  — it is used, but only by server-side/API code, so nothing a
    user sees can change.
    ``"unknown"`` — nothing imports it, or only files of unknown reach: the blast
    radius cannot be established, which is not the same as "no impact".
    """
    if dependency_graph is None:
        return "unknown"
    try:
        dependents = dependency_graph.get_dependents(Path(rel_path)) or set()
    except Exception as exc:  # noqa: BLE001
        logger.debug("Dependent lookup failed for %s: %s", rel_path, exc)
        return "unknown"

    if not dependents:
        return "unknown"

    root_dir = getattr(dependency_graph, "root_dir", None)
    rel_dependents = [_relative_to_root(dep, root_dir) for dep in dependents]

    if any(global_ui_routes(dep, discovered_routes) is not None for dep in rel_dependents):
        return "global"
    if all(_is_non_ui(dep) or _is_backend_only(dep) for dep in rel_dependents):
        return "non_ui"
    return "unknown"


def _is_source_like(rel_path: str) -> bool:
    return Path(rel_path).suffix.lower() in _SOURCE_SUFFIXES


def _subtree_routes(prefix: str, discovered_routes: list[str]) -> list[str]:
    """Discovered routes inside an App Router path prefix (``/`` means all)."""
    if prefix in ("", "/"):
        return list(discovered_routes)
    normalized = prefix.rstrip("/")
    return [
        r
        for r in discovered_routes
        if r == normalized or r.startswith(normalized + "/")
    ]


def global_ui_routes(rel_path: str, discovered_routes: list[str]) -> list[str] | None:
    """Routes a global/special file affects, or None if it is not global.

    Returns ``discovered_routes`` (all of them) for app-wide files, or the
    matching subtree for a nested layout/template/error file.
    """
    if _MIDDLEWARE_RE.search(rel_path) or _GLOBAL_CONFIG_RE.search(rel_path):
        return list(discovered_routes)
    if _GLOBAL_CSS_RE.search(rel_path):
        return list(discovered_routes)
    if _PROVIDERS_RE.search(rel_path):
        return list(discovered_routes)

    special = _APP_SPECIAL_RE.search(rel_path)
    if special:
        raw_prefix = special.group(1) or ""
        parts = [
            p
            for p in raw_prefix.strip("/").split("/")
            if p and not (p.startswith("(") and p.endswith(")"))
        ]
        prefix = "/" + "/".join(parts) if parts else "/"
        return _subtree_routes(prefix, discovered_routes)

    return None


def classify_change_impact(
    changed_files: list[str | Path] | None,
    dependency_graph: Any | None = None,
    discovered_routes: list[str] | None = None,
    scope: str = "changed",
) -> ChangeImpact:
    """Decide what this change set can affect, before any route is planned.

    ``scope="full"`` means the operator explicitly asked for the whole site, so
    classification is recorded but never narrows or skips the run.
    """
    discovered = list(discovered_routes or [])
    files = []
    seen: set[str] = set()
    for raw in changed_files or []:
        normalized = _normalize(raw)
        if normalized and normalized not in seen:
            seen.add(normalized)
            files.append(normalized)

    explicit_full = scope == "full"

    if not files:
        return ChangeImpact(
            kind="empty",
            rationale="No changed files were available, so the configured scope was used unchanged.",
        )

    non_ui_files: list[str] = []
    global_files: list[str] = []
    global_targets: set[str] = set()
    mapped_routes: set[str] = set()
    unmapped_files: list[str] = []

    for rel_path in files:
        routes_for_file = global_ui_routes(rel_path, discovered)
        if routes_for_file is not None:
            global_files.append(rel_path)
            global_targets.update(routes_for_file)
            continue

        if _is_non_ui(rel_path) or _is_backend_only(rel_path):
            non_ui_files.append(rel_path)
            continue

        mapped: set[str] = set()
        if dependency_graph is not None:
            try:
                mapped = set(dependency_graph.find_affected_routes([rel_path]))
            except Exception as exc:  # noqa: BLE001
                logger.debug("Dependency lookup failed for %s: %s", rel_path, exc)

        if mapped:
            mapped_routes.update(mapped)
            continue

        if not _is_source_like(rel_path):
            # Not code we can reason about (binary, asset, unknown extension).
            continue

        # No route maps to it directly. Before calling that "unknown", ask what
        # actually depends on it: a component rendered by the root layout is
        # app-wide, and a helper used only by API routes affects no UI at all.
        verdict = _dependents_verdict(rel_path, dependency_graph, discovered)
        if verdict == "global":
            global_files.append(rel_path)
            global_targets.update(discovered)
        elif verdict == "non_ui":
            non_ui_files.append(rel_path)
        else:
            # Real code/config that maps to no route: the blast radius is simply
            # unknown, which is not the same as "no impact".
            unmapped_files.append(rel_path)

    common = {
        "changed_files": files,
        "global_files": global_files,
        "unmapped_files": unmapped_files,
        "non_ui_files": non_ui_files,
    }

    def _capped(routes) -> list[str]:
        # Preserve deterministic, readable ordering and bound the plan size.
        return sorted(dict.fromkeys(routes))[:MAX_CLASSIFIED_ROUTES]

    # 1. App-wide surface: verify broadly, whatever the requested scope.
    if global_files:
        routes = _capped(global_targets) or _capped(discovered)
        return ChangeImpact(
            kind="global_ui",
            rationale=(
                "App-wide surface changed ("
                + ", ".join(global_files[:5])
                + "), which affects every route in its scope; verifying broadly instead of "
                "narrowing to the diff."
            ),
            routes=routes,
            force_full_sweep=not explicit_full,
            force_routes=None if explicit_full else routes,
            **common,
        )

    # 2. Code that maps to no route: unknown blast radius.
    if unmapped_files:
        smoke = set(mapped_routes)
        if "/" in discovered:
            smoke.add("/")
        if not smoke:
            smoke.update(discovered[:3])
        routes = _capped(smoke)
        return ChangeImpact(
            kind="unmapped",
            rationale=(
                "Changed files map to no route ("
                + ", ".join(unmapped_files[:5])
                + "); blast radius is unknown, so a bounded smoke test was run rather than "
                "assuming there is no impact."
            ),
            routes=routes,
            force_routes=None if explicit_full else routes,
            **common,
        )

    # 3. Specific routes known to be affected (including shared components).
    if mapped_routes:
        routes = _capped(mapped_routes)
        return ChangeImpact(
            kind="targeted",
            rationale=(
                f"{len(routes)} route(s) affected: "
                + ", ".join(routes)
                + " — every route that imports the changed code is included."
            ),
            routes=routes,
            force_routes=None if explicit_full else routes,
            **common,
        )

    # 4. Nothing user-visible changed.
    return ChangeImpact(
        kind="no_ui_impact",
        rationale=(
            "Only non-UI files changed ("
            + ", ".join(non_ui_files[:5])
            + "); there is no user-visible surface to verify."
        ),
        routes=[],
        skip_journeys=not explicit_full,
        **common,
    )
