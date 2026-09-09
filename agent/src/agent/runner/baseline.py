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


class BaselineStore:
    """Stores latest known baseline journey outcomes on main."""

    def __init__(self) -> None:
        # Key: repo:journey_name -> {"passed": bool, "error": str}
        self._store: dict[str, dict[str, Any]] = {}
        # Seed default healthy baseline for the demo web app
        self._store["web:login"] = {"passed": True, "error": None}
        self._store["web:dashboard"] = {"passed": True, "error": None}
        self._store["web:checkout"] = {"passed": True, "error": None}

    def set_baseline(self, repo: str, journey_name: str, passed: bool, error: str | None = None) -> None:
        key = f"{repo}:{journey_name}"
        self._store[key] = {"passed": passed, "error": error}

    def get_baseline(self, repo: str, journey_name: str) -> dict[str, Any]:
        key = f"{repo}:{journey_name}"
        return self._store.get(key, {"passed": True, "error": None})

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
