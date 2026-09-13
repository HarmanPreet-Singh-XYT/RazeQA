"""Reusable, opt-in regression tests per repository.

A generated test case is only a record of one run. When a person decides a flow
is worth protecting, they save it here, and every later run is told to exercise
it. Saving is deliberate: a suite that grows from every run's noise stops being
a signal.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

logger = logging.getLogger("agent.projects.saved_tests")

#: Keep the injected instruction block bounded so it cannot crowd out the
#: project's own testing instructions in the planner prompt.
MAX_INSTRUCTION_TESTS = 25


def saved_test_fingerprint(name: str, route: str | None) -> str:
    """Stable identity for a saved test: one flow keeps one row."""
    normalized = re.sub(r"\s+", " ", (name or "").lower()).strip()
    digest = hashlib.sha256(f"{route or ''}|{normalized}".encode()).hexdigest()
    return digest[:32]


def load_saved_tests(repo_full_name: str, limit: int = 100) -> list[dict[str, Any]]:
    """Enabled saved tests for a repository. Failures degrade to an empty list."""
    if not repo_full_name:
        return []
    try:
        from agent.db.supabase import get_supabase_client

        client = get_supabase_client()
        if not client:
            return []
        res = (
            client.table("saved_tests")
            .select("id, name, route, category, intent, preconditions, times_run, last_verified_at")
            .eq("repo_full_name", repo_full_name)
            .eq("enabled", True)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as exc:  # noqa: BLE001
        # A missing table (migration not applied) or an unreachable database must
        # not stop a run; the suite is an enhancement, not a prerequisite.
        logger.debug("Could not load saved tests for %s: %s", repo_full_name, exc)
        return []


def as_instruction_lines(tests: list[dict[str, Any]]) -> list[str]:
    """Render saved tests as planner instructions."""
    lines: list[str] = []
    for test in tests[:MAX_INSTRUCTION_TESTS]:
        name = str(test.get("name") or "saved test")
        route = test.get("route")
        intent = (test.get("intent") or "").strip()
        preconditions = test.get("preconditions") or []
        entry = f"- {name}"
        if route:
            entry += f" (route: {route})"
        if intent:
            entry += f": {intent}"
        if preconditions:
            rendered = "; ".join(str(p) for p in preconditions if p)
            if rendered:
                entry += f" [setup: {rendered}]"
        lines.append(entry)
    return lines
