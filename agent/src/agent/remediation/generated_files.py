"""Which changed paths are generated output rather than the author's edits.

The repair loop runs a verification build (`npm run build`, `npm install`, ...)
in the same checkout it then diffs. Those commands rewrite lockfiles and build
directories, so a repair that changed nothing meaningful could still produce a
diff — and a package-lock.json rewrite was presented to the user as the fix for
a visual defect on a page.

Kept dependency-free so both `agentic_repair` and `fix_synthesizer` can use it
without either importing the other.
"""

from __future__ import annotations

# Files that package managers rewrite as a side effect of install/build.
GENERATED_ARTIFACT_BASENAMES = frozenset(
    {
        "package-lock.json",
        "npm-shrinkwrap.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lock",
        "bun.lockb",
        "poetry.lock",
        "Pipfile.lock",
        "Cargo.lock",
        "composer.lock",
        "Gemfile.lock",
        "go.sum",
    }
)

# Directory *segments* (not substrings) that hold generated output. Kept
# deliberately narrow: a source directory legitimately named `build/` must not be
# excluded just because the name resembles an output folder.
GENERATED_ARTIFACT_DIRS = frozenset(
    {
        "node_modules",
        ".next",
        ".nuxt",
        ".turbo",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        "coverage",
        "dist",
        ".cache",
    }
)


def is_generated_or_dependency_artifact(path: str) -> bool:
    """True when a path is a dependency lockfile or generated/build output."""
    cleaned = (path or "").replace("\\", "/").strip().lstrip("./")
    if not cleaned:
        return False
    if cleaned.rsplit("/", 1)[-1] in GENERATED_ARTIFACT_BASENAMES:
        return True
    return any(segment in GENERATED_ARTIFACT_DIRS for segment in cleaned.split("/"))


def strip_generated_files_from_diff(diff_text: str) -> str:
    """Drop per-file sections of a unified diff that only touch generated files.

    Uses the ``diff --git a/<path> b/<path>`` header as the section boundary, so
    remaining hunks stay intact.
    """
    if not diff_text or "diff --git" not in diff_text:
        return diff_text

    sections = diff_text.split("\ndiff --git ")
    kept: list[str] = []

    for index, section in enumerate(sections):
        # The first chunk still has its `diff --git ` prefix; later ones lost it
        # to the split.
        header = (
            section
            if index == 0 and section.startswith("diff --git ")
            else f"diff --git {section}"
        )
        lines = header.splitlines()
        header_line = lines[0] if lines else ""

        candidate = ""
        if " b/" in header_line:
            candidate = header_line.split(" b/", 1)[1]
        elif " a/" in header_line:
            candidate = header_line.split(" a/", 1)[1]
        candidate = candidate.strip().strip('"')

        if candidate and is_generated_or_dependency_artifact(candidate):
            continue
        kept.append(header)

    return "\n".join(kept)
