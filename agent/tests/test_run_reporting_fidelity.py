"""Reporting fidelity: durations that mean something, and fixes that are real.

Two reported defects motivate these tests:

* every completed run showed "0s" in the dashboard because the pipeline never
  recorded a total duration, and its "analysis" and "journeys" phases were the
  same measurement;
* the auto-repair agent ran its verification build in the same checkout it then
  diffed, so the lockfile churn from `npm run build` was reported as the fix for
  an unrelated visual defect.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from agent.remediation.agentic_repair import AgenticRepairEngine
from agent.remediation.generated_files import (
    is_generated_or_dependency_artifact,
    strip_generated_files_from_diff,
)

# ---------------------------------------------------------------------------
# Generated / dependency artifact classification
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "path",
    [
        "package-lock.json",
        "web/package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "app/node_modules/left-pad/index.js",
        "web/.next/trace",
        "coverage/lcov.info",
        "dist/bundle.js",
        "__pycache__/mod.cpython-312.pyc",
    ],
)
def test_generated_and_dependency_paths_are_detected(path):
    assert is_generated_or_dependency_artifact(path) is True


@pytest.mark.parametrize(
    "path",
    [
        "app/page.tsx",
        "web/components/run-config-form.tsx",
        "package.json",
        # A source directory that merely contains the word "build" must survive:
        # the check is on path *segments*, not substrings.
        "src/build/widget.ts",
        "lib/distribution/plan.ts",
    ],
)
def test_real_source_paths_are_not_flagged(path):
    assert is_generated_or_dependency_artifact(path) is False


def test_diff_stripping_removes_only_generated_sections():
    diff = (
        "diff --git a/package-lock.json b/package-lock.json\n"
        "--- a/package-lock.json\n"
        "+++ b/package-lock.json\n"
        "@@ -1 +1 @@\n"
        '-  "libc": ["glibc"],\n'
        "+  // regenerated\n"
        "diff --git a/app/page.tsx b/app/page.tsx\n"
        "--- a/app/page.tsx\n"
        "+++ b/app/page.tsx\n"
        "@@ -1 +1 @@\n"
        "-<div className=\"bg-red-500\" />\n"
        "+<div className=\"bg-blue-500\" />\n"
    )

    stripped = strip_generated_files_from_diff(diff)

    assert "package-lock.json" not in stripped
    assert "app/page.tsx" in stripped
    assert "bg-blue-500" in stripped


def test_diff_stripping_keeps_a_purely_source_diff_untouched():
    diff = (
        "diff --git a/app/page.tsx b/app/page.tsx\n"
        "--- a/app/page.tsx\n"
        "+++ b/app/page.tsx\n"
        "@@ -1 +1 @@\n"
        "-a\n"
        "+b\n"
    )
    assert strip_generated_files_from_diff(diff) == diff


# ---------------------------------------------------------------------------
# _extract_git_diff must not treat build churn as the author's change
# ---------------------------------------------------------------------------

def _fake_git(diff_stdout: str, status_stdout: str):
    def _run(args, **kwargs):
        if "diff" in args:
            return SimpleNamespace(returncode=0, stdout=diff_stdout, stderr="")
        if "status" in args:
            return SimpleNamespace(returncode=0, stdout=status_stdout, stderr="")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    return _run


def test_extract_git_diff_ignores_lockfile_churn(tmp_path: Path):
    """The exact reported case: `npm run build` rewrote package-lock.json."""
    diff_stdout = (
        "diff --git a/package-lock.json b/package-lock.json\n"
        "--- a/package-lock.json\n"
        "+++ b/package-lock.json\n"
        "@@ -1 +1 @@\n"
        '-  "libc": ["glibc"],\n'
        "+  (removed)\n"
    )
    status_stdout = " M package-lock.json\n"

    engine = AgenticRepairEngine()

    with patch("agent.remediation.agentic_repair.subprocess.run", side_effect=_fake_git(diff_stdout, status_stdout)):
        diff, files = engine._extract_git_diff(tmp_path)

    assert files == []
    assert "package-lock.json" not in diff
    # Nothing meaningful changed, so there is no repair to present.
    assert diff.strip() == ""


def test_extract_git_diff_keeps_real_source_changes(tmp_path: Path):
    diff_stdout = (
        "diff --git a/package-lock.json b/package-lock.json\n"
        "--- a/package-lock.json\n"
        "+++ b/package-lock.json\n"
        "@@ -1 +1 @@\n"
        "-a\n"
        "+b\n"
        "diff --git a/app/page.tsx b/app/page.tsx\n"
        "--- a/app/page.tsx\n"
        "+++ b/app/page.tsx\n"
        "@@ -1 +1 @@\n"
        "-old\n"
        "+new\n"
    )
    status_stdout = " M package-lock.json\n M app/page.tsx\n"

    engine = AgenticRepairEngine()

    with patch("agent.remediation.agentic_repair.subprocess.run", side_effect=_fake_git(diff_stdout, status_stdout)):
        diff, files = engine._extract_git_diff(tmp_path)

    assert files == ["app/page.tsx"]
    assert "app/page.tsx" in diff
    assert "package-lock.json" not in diff


# ---------------------------------------------------------------------------
# Fix synthesizer also refuses generated artifacts
# ---------------------------------------------------------------------------

def test_synthesizer_rejects_generated_artifact_targets():
    """Even when the model returns a lockfile path, it is not published as the fix."""
    import json

    from agent.remediation.fix_synthesizer import FixSynthesizer

    class _FakeResult:
        def __init__(self, text: str) -> None:
            self.message = {"content": [{"text": text}]}

    model_output = json.dumps(
        {
            "styling_paradigm": "logic",
            "root_cause": "regenerated lockfile",
            "explanation": "verified",
            "target_files": ["package-lock.json", "app/page.tsx"],
            "patches": [
                {
                    "file_path": "package-lock.json",
                    "original_snippet": "-  \"libc\": [\"glibc\"],",
                    "replacement_snippet": "+  (removed)",
                    "explanation": "churn",
                },
                {
                    "file_path": "app/page.tsx",
                    "original_snippet": '-<div className="bg-red-500" />',
                    "replacement_snippet": '+<div className="bg-blue-500" />',
                    "explanation": "real fix",
                },
            ],
        }
    )

    synth = FixSynthesizer(api_key="test-key")

    with patch(
        "agent.models.factory.create_strands_agent",
        return_value=lambda prompt: _FakeResult(model_output),
    ):
        proposal = synth._synthesize_with_claude(
            journey_name="exploratory:home",
            error="Visual defect detected",
            analysis=SimpleNamespace(risk_tag="Low", rationale="cosmetic", affected_surfaces=["/"]),
            intents=[],
            dom_snapshot="",
            inspected_context={"app/page.tsx": "<div className=\"bg-red-500\" />"},
            detected_paradigm="logic",
        )

    assert proposal is not None
    assert [p.file_path for p in proposal.patches] == ["app/page.tsx"]
    assert proposal.target_files == ["app/page.tsx"]


def test_extract_git_diff_tolerates_git_failure(tmp_path: Path):
    """A git failure degrades to "no diff" rather than raising into the pipeline."""
    engine = AgenticRepairEngine()

    def _boom(args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=args, timeout=1)

    with patch("agent.remediation.agentic_repair.subprocess.run", side_effect=_boom):
        diff, files = engine._extract_git_diff(tmp_path)

    assert diff == ""
    assert files == []
