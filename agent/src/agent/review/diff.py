"""Unified-diff parsing shared by the three-lane review engine and the fixer.

Two consumers need different things from the same text:

* the **review engine** needs to know whether a finding sits on a line this PR
  *added* (a problem introduced here) or on an untouched line of a file the
  author happened to modify (a pre-existing problem they merely walked past).
  Reporting the second as if it were the first is how a review tool trains
  people to stop reading it;
* the **fixer** needs per-file *status*, so it can tell "the agent added a
  regression test" (allowed, and required) apart from "the agent edited an
  existing test until it passed" (the single most important thing to reject).

Both are derived here from the diff text alone, without shelling out to git.
"""

from __future__ import annotations

import logging
import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger("agent.review.diff")

#: One `diff --git` section, kept whole so a filtered subset still applies.
_SECTION_SPLIT = re.compile(r"(?=^diff --git )", re.MULTILINE)
_HUNK_HEADER = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def _unquote(path: str) -> str:
    """Strip git's quoting and the a/ or b/ prefix from a diff path."""
    cleaned = (path or "").strip()
    if len(cleaned) >= 2 and cleaned.startswith('"') and cleaned.endswith('"'):
        cleaned = cleaned[1:-1]
    if cleaned.startswith(("a/", "b/")):
        cleaned = cleaned[2:]
    return cleaned.strip()


def _header_paths(section: str) -> tuple[str, str]:
    """Recover ``(old, new)`` from a ``diff --git`` header line."""
    header = section.splitlines()[0].strip() if section else ""
    if not header.startswith("diff --git "):
        return "", ""
    remainder = header[len("diff --git ") :]
    # Paths are space-separated unless quoted; shlex handles the quoted form.
    import shlex

    try:
        parts = shlex.split(remainder)
    except ValueError:
        parts = remainder.split()
    if len(parts) >= 2:
        return _unquote(parts[0]), _unquote(parts[1])
    if len(parts) == 1:
        return _unquote(parts[0]), _unquote(parts[0])
    return "", ""


@dataclass
class DiffFile:
    """One file's slice of a unified diff."""

    path: str
    status: str = "modified"  # "added" | "modified" | "deleted"
    added_lines: set[int] = field(default_factory=set)
    removed_lines: set[int] = field(default_factory=set)

    @property
    def is_new(self) -> bool:
        return self.status == "added"


@dataclass
class DiffIndex:
    """Every file in a diff, in first-seen order."""

    files: dict[str, DiffFile] = field(default_factory=dict)

    @property
    def paths(self) -> list[str]:
        return list(self.files)

    @property
    def added_line_count(self) -> int:
        return sum(len(f.added_lines) for f in self.files.values())

    def introduces(self, path: str | None, line: int | None) -> bool:
        """Whether ``(path, line)`` is a line this diff added.

        Returns ``True`` when the file is part of the change but the line is
        unknown, and ``False`` for a file the diff never touched — an issue in
        code this PR does not modify is inherited, not introduced.
        """
        if not path:
            return True
        entry = self.files.get(path)
        if entry is None:
            return False
        if line is None:
            return True
        return line in entry.added_lines


def _section_path(section: str) -> tuple[str, str]:
    """Extract ``(path, status)`` from one diff section."""
    new_path = ""
    old_path = ""
    status = "modified"

    if re.search(r"^new file mode ", section, re.MULTILINE):
        status = "added"
    elif re.search(r"^deleted file mode ", section, re.MULTILINE):
        status = "deleted"

    for raw in section.splitlines():
        if raw.startswith("+++ "):
            candidate = raw[4:].split("\t", 1)[0].strip()
            if candidate != "/dev/null":
                new_path = _unquote(candidate)
        elif raw.startswith("--- "):
            candidate = raw[4:].split("\t", 1)[0].strip()
            if candidate != "/dev/null":
                old_path = _unquote(candidate)
        if new_path and old_path:
            break

    if not new_path and not old_path:
        old_path, new_path = _header_paths(section)

    # A brand-new file still shows `--- /dev/null`; git only tells us by the
    # `new file mode` marker, which is what `status` above already captured.
    return (new_path or old_path), status


def _parse_section(section: str) -> DiffFile | None:
    path, status = _section_path(section)
    if not path:
        return None

    entry = DiffFile(path=path, status=status)
    new_lineno: int | None = None
    old_lineno: int | None = None

    for raw in section.splitlines():
        if raw.startswith("@@"):
            match = _HUNK_HEADER.match(raw)
            if match:
                old_lineno = int(match.group(1))
                new_lineno = int(match.group(2))
            continue
        if new_lineno is None:
            continue
        if raw.startswith(("+++", "---")):
            continue
        if raw.startswith("+"):
            entry.added_lines.add(new_lineno)
            new_lineno += 1
        elif raw.startswith("-"):
            if old_lineno is not None:
                entry.removed_lines.add(old_lineno)
                old_lineno += 1
        elif raw.startswith("\\"):
            continue
        else:
            new_lineno += 1
            if old_lineno is not None:
                old_lineno += 1

    return entry


def parse_unified_diff(diff: str) -> DiffIndex:
    """Parse a unified diff into a :class:`DiffIndex`.

    Tolerates a diff with no ``diff --git`` headers (a bare unified patch) by
    treating the whole text as a single section.
    """
    index = DiffIndex()
    if not diff or not diff.strip():
        return index

    # Require at least a git header or a hunk marker. Without this, arbitrary
    # text ("not a diff at all") would be treated as a one-file patch and invent
    # a file named "x".
    if "diff --git " not in diff and "@@" not in diff:
        return index

    sections = [s for s in _SECTION_SPLIT.split(diff) if s.strip()]
    if not sections:
        return index

    if not sections[0].lstrip().startswith("diff --git"):
        # Bare unified patch: synthesise the header the parser expects.
        first = sections[0]
        header = "diff --git a/x b/x\n"
        if "--- " not in first.splitlines()[0]:
            sections[0] = header + first

    for section in sections:
        entry = _parse_section(section)
        if entry is None:
            continue
        existing = index.files.get(entry.path)
        if existing is None:
            index.files[entry.path] = entry
        else:
            existing.added_lines |= entry.added_lines
            existing.removed_lines |= entry.removed_lines
            if entry.status == "added":
                existing.status = "added"

    return index


def select_diff_sections(diff: str, predicate: Callable[[DiffFile], bool]) -> str:
    """Return the subset of ``diff`` whose files satisfy ``predicate``.

    Each surviving section keeps its ``diff --git`` header and every hunk, so the
    result is still a patch ``git apply`` accepts. This is what lets the fixer
    apply a regression test on its own, to prove it fails before the fix.
    """
    if not diff or not diff.strip():
        return ""
    sections = [s for s in _SECTION_SPLIT.split(diff) if s.strip()]
    kept: list[str] = []
    for section in sections:
        entry = _parse_section(section)
        if entry is not None and predicate(entry):
            kept.append(section if section.endswith("\n") else section + "\n")
    return "".join(kept)


def collect_diff(
    repo_dir: str | Path,
    base: str = "main",
    head: str = "HEAD",
    *,
    timeout: int = 30,
) -> str:
    """Produce a generated-artifact-free unified diff for ``base...head``.

    The three-lane review runs on this exact string, and the fixer's scope checks
    run on the parsed form of it, so lockfile churn is removed once, here, rather
    than being re-filtered by every consumer.
    """
    from agent.remediation.generated_files import strip_generated_files_from_diff

    try:
        result = subprocess.run(
            [
                "git",
                "-c",
                "core.quotepath=false",
                "diff",
                "--no-color",
                "--find-renames",
                "--unified=3",
                f"{base}...{head}",
            ],
            cwd=str(repo_dir),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Could not collect diff for %s...%s: %s", base, head, exc)
        return ""

    # Plain `git diff` exits 0 whether or not there are differences; a non-zero
    # status is an error (bad ref, not a repository), not "changes found".
    if result.returncode != 0:
        logger.warning("git diff exited %s: %s", result.returncode, result.stderr.strip()[:200])
        return ""
    return strip_generated_files_from_diff(result.stdout)
