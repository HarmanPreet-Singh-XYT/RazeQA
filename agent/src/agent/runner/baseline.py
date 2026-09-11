"""Baseline Comparison Engine (idea.md Section 3.2 #8).

Distinguishes brand-new regressions introduced by a PR from pre-existing bugs
that already existed on main.
"""

from __future__ import annotations

import logging
from enum import Enum
from typing import Any

logger = logging.getLogger("agent.runner.baseline")


class RegressionCategory(str, Enum):
    NEW_REGRESSION = "NEW_REGRESSION"  # Failed on PR, but passed on main (PR broke this!)
    PRE_EXISTING_BUG = "PRE_EXISTING_BUG"  # Failed on PR and failed on main (Not introduced by PR)
    FIXED_BUG = "FIXED_BUG"  # Passed on PR, but failed on main (PR fixed it!)
    STABLE_PASS = "STABLE_PASS"  # Passed on PR and passed on main


def _normalize_journey_name(name: str) -> str:
    """Normalize journey identifiers by stripping prefixes and slashes."""
    cleaned = name.strip()
    if cleaned.startswith("exploratory:"):
        cleaned = cleaned[len("exploratory:") :]
    cleaned = cleaned.lstrip("/")
    return cleaned or "home"


class BaselineStore:
    """Stores latest known baseline journey outcomes on main."""

    def __init__(self) -> None:
        # Key: repo:journey_name -> {"passed": bool, "error": str}
        self._store: dict[str, dict[str, Any]] = {}
        # Track which repos have ever received a *real* baseline (from an
        # actual base-branch run) vs. only ever falling back to seeded
        # placeholder defaults via get_baseline's default. This lets callers
        # distinguish "never refreshed" from "refreshed and everything passed".
        self._refreshed_repos: set[str] = set()
        # Seed default healthy baseline for the demo web app so comparisons
        # have somewhere to start before the first real base-branch run —
        # NOT treated as a "refreshed" baseline.
        self.set_baseline("web", "login", True, None)
        self.set_baseline("web", "dashboard", True, None)
        self.set_baseline("web", "checkout", True, None)

    def has_baseline(self, repo: str) -> bool:
        """True only if `repo` has had a real base-branch run recorded —
        i.e. update_baseline_from_run has been called for it, not just the
        seeded placeholder defaults from __init__."""
        return repo in self._refreshed_repos

    def set_baseline(self, repo: str, journey_name: str, passed: bool, error: str | None = None) -> None:
        norm = _normalize_journey_name(journey_name)
        key = f"{repo}:{norm}"
        self._store[key] = {"passed": passed, "error": error}

    def get_baseline(self, repo: str, journey_name: str) -> dict[str, Any]:
        norm = _normalize_journey_name(journey_name)
        key = f"{repo}:{norm}"
        return self._store.get(key, {"passed": True, "error": None})

    def update_baseline_from_run(self, repo: str, journeys: list[dict[str, Any]]) -> None:
        """Update baseline store from a validated test run."""
        for j in journeys:
            self.set_baseline(repo, j["name"], j.get("passed", False), j.get("error"))
        self._refreshed_repos.add(repo)

    def compare(
        self,
        repo: str,
        pr_journeys: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Compare PR journey execution against main baseline.

        Returns categorized results and flags whether any NEW regressions exist.
        """
        comparisons: list[dict[str, Any]] = []
        has_new_regressions = False

        for pr_j in pr_journeys:
            name = pr_j["name"]
            pr_passed = pr_j.get("passed", False)
            pr_error = pr_j.get("error")

            base = self.get_baseline(repo, name)
            base_passed = base.get("passed", True)

            if not pr_passed and base_passed:
                cat = RegressionCategory.NEW_REGRESSION
                has_new_regressions = True
            elif not pr_passed and not base_passed:
                cat = RegressionCategory.PRE_EXISTING_BUG
            elif pr_passed and not base_passed:
                cat = RegressionCategory.FIXED_BUG
            else:
                cat = RegressionCategory.STABLE_PASS

            comparisons.append(
                {
                    "name": name,
                    "category": cat.value,
                    "pr_passed": pr_passed,
                    "base_passed": base_passed,
                    "error": pr_error,
                }
            )

        new_regressions = [c for c in comparisons if c["category"] == RegressionCategory.NEW_REGRESSION.value]
        pre_existing = [c for c in comparisons if c["category"] == RegressionCategory.PRE_EXISTING_BUG.value]
        passes = [c for c in comparisons if c["category"] in (RegressionCategory.STABLE_PASS.value, RegressionCategory.FIXED_BUG.value)]

        return {
            "has_new_regressions": has_new_regressions,
            "new_regressions": new_regressions,
            "pre_existing_bugs": pre_existing,
            "passes": passes,
            "all": comparisons,
        }


default_baseline_store = BaselineStore()
