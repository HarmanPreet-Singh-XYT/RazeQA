"""Static Dependency Graph Analyzer for JavaScript/TypeScript and Python projects.

Enables targeted test generation to discover downstream impacts when shared
utilities, components, or validation helpers change, even when the diff
itself does not mention the affected routes.
"""

from __future__ import annotations

import logging
import re
from collections import defaultdict
from pathlib import Path

logger = logging.getLogger("agent.analyzer.dependency_graph")

# Regex patterns to capture import/require targets
IMPORT_RE = re.compile(
    r"""(?:import\s+.*?from\s+['"]([^'"]+)['"]|export\s+.*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\))""",
    re.MULTILINE | re.DOTALL,
)


class DependencyGraph:
    """Builds a reverse dependency map (imported_file -> [dependent_files])

    for a source tree to trace downstream affected routes from changed files.
    """

    def __init__(self, root_dir: Path | str) -> None:
        self.root_dir = Path(root_dir).resolve()
        # reverse_map[target_canonical_path] = set of file_paths that import it
        self.reverse_map: dict[Path, set[Path]] = defaultdict(set)
        self._built = False

    def build(self) -> None:
        """Scan source files and construct the dependency graph."""
        if not self.root_dir.exists():
            return

        extensions = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"}
        source_files: list[Path] = []
        for p in self.root_dir.rglob("*"):
            if any(part in ("node_modules", ".next", ".git", "dist", "build", ".venv", "__pycache__") for part in p.parts):
                continue
            if p.is_file() and p.suffix.lower() in extensions:
                source_files.append(p)

        for src_file in source_files:
            self._index_file(src_file)

        self._built = True
        logger.debug("Built dependency graph for %d source files in %s", len(source_files), self.root_dir)

    def _index_file(self, file_path: Path) -> None:
        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return

        if file_path.suffix.lower() == ".py":
            # Python import detection
            self._index_python_imports(file_path, content)
            return

        # JS/TS import detection
        for match in IMPORT_RE.finditer(content):
            target_str = next(m for m in match.groups() if m is not None)
            resolved = self._resolve_js_import(file_path, target_str)
            if resolved:
                self.reverse_map[resolved].add(file_path)

    def _resolve_js_import(self, current_file: Path, target_str: str) -> Path | None:
        # Resolve aliases like @/ or ~/
        candidate_paths: list[Path] = []
        if target_str.startswith(("@/", "~/")):
            rel_sub = target_str[2:]
            candidate_paths.append(self.root_dir / rel_sub)
            candidate_paths.append(self.root_dir / "src" / rel_sub)
            candidate_paths.append(self.root_dir / "app" / rel_sub)
        elif target_str.startswith("."):
            candidate_paths.append((current_file.parent / target_str).resolve())
        else:
            # Package or external import (e.g. 'react', 'lodash') - ignore
            return None

        extensions = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]
        for base in candidate_paths:
            for ext in extensions:
                probe = Path(f"{base}{ext}")
                if probe.is_file():
                    return probe.resolve()

        return None

    def _index_python_imports(self, file_path: Path, content: str) -> None:
        py_import_re = re.compile(r"^\s*(?:from\s+([a-zA-Z0-9_\.]+)\s+import|import\s+([a-zA-Z0-9_\.]+))", re.MULTILINE)
        for match in py_import_re.finditer(content):
            module_name = match.group(1) or match.group(2)
            if not module_name:
                continue
            parts = module_name.split(".")
            probe = self.root_dir.joinpath(*parts).with_suffix(".py")
            if probe.is_file():
                self.reverse_map[probe.resolve()].add(file_path)

    def get_dependents(self, file_path: Path | str, max_depth: int = 3) -> set[Path]:
        """Finds all files that directly or indirectly import file_path."""
        if not self._built:
            self.build()

        target = Path(file_path).resolve()
        try:
            if not target.is_relative_to(self.root_dir):
                target = (self.root_dir / str(file_path).lstrip("/")).resolve()
        except (ValueError, OSError):
            target = (self.root_dir / str(file_path).lstrip("/")).resolve()

        canonical_target = None
        if target in self.reverse_map:
            canonical_target = target
        else:
            # Match strictly by relative path within root_dir
            for k in self.reverse_map:
                try:
                    rel_k = k.relative_to(self.root_dir).as_posix()
                    rel_target = target.relative_to(self.root_dir).as_posix()
                    if rel_k == rel_target or rel_k.endswith("/" + rel_target):
                        canonical_target = k
                        break
                except (ValueError, OSError):
                    if k == target:
                        canonical_target = k
                        break

        if not canonical_target:
            return set()

        visited: set[Path] = set()
        queue: list[tuple[Path, int]] = [(canonical_target, 0)]

        while queue:
            curr, depth = queue.pop(0)
            if depth >= max_depth:
                continue
            for dependent in self.reverse_map.get(curr, []):
                if dependent not in visited:
                    visited.add(dependent)
                    queue.append((dependent, depth + 1))

        return visited

    def find_affected_routes(self, changed_files: list[str | Path]) -> list[str]:
        """Given a list of changed files (e.g. from git diff), returns downstream
        affected route paths (e.g. ['/checkout', '/login']).
        """
        if not self._built:
            self.build()

        affected_files: set[Path] = set()
        for cf in changed_files:
            cf_path = (self.root_dir / cf).resolve() if not Path(cf).is_absolute() else Path(cf).resolve()
            # The changed file itself may be a route or component
            affected_files.add(cf_path)
            # Plus all dependent files
            deps = self.get_dependents(cf_path)
            affected_files.update(deps)

        routes: set[str] = set()
        for f in affected_files:
            try:
                rel_path = f.relative_to(self.root_dir).as_posix()
            except ValueError:
                rel_path = f.as_posix()

            # Next.js App Router (app/xxx/page.tsx or src/app/xxx/page.tsx)
            app_pattern = re.search(r'(?:^|/)app/(.+)/page\.(?:tsx|jsx|js)$', rel_path)
            if app_pattern:
                raw_route = app_pattern.group(1)
                # Strip route groups like (auth), (dashboard)
                cleaned_route = re.sub(r'/?\([^)]+\)', '', raw_route).strip("/")
                route = f"/{cleaned_route}" if cleaned_route else "/"
                routes.add(route)
            elif re.search(r'(?:^|/)app/page\.(?:tsx|jsx|js)$', rel_path):
                routes.add("/")
            # Pages router (pages/xxx.tsx or src/pages/xxx.tsx)
            else:
                pages_pattern = re.search(r'(?:^|/)pages/(.+)\.(?:tsx|jsx|js)$', rel_path)
                if pages_pattern:
                    raw_route = pages_pattern.group(1).replace("/index", "").replace("index", "").strip("/")
                    route = f"/{raw_route}" if raw_route else "/"
                    if not route.startswith("/api"):
                        routes.add(route)

        return sorted(routes)
