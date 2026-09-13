"""The baseline store must survive an engine restart.

Previously it was an in-memory dict plus a module-level singleton, so every
restart silently reverted "PR vs main" comparison to seeded placeholders.
"""

from __future__ import annotations

from pathlib import Path

from agent.runner.baseline import BaselineStore, RegressionCategory


def test_baseline_survives_a_new_store_instance(tmp_path: Path):
    path = tmp_path / "baseline.json"

    first = BaselineStore(path=path)
    assert first.has_baseline("acme/app") is False
    first.update_baseline_from_run(
        "acme/app",
        [
            {"name": "login", "passed": True},
            {"name": "checkout", "passed": False, "error": "invoice boom"},
        ],
    )
    assert first.has_baseline("acme/app") is True
    assert path.exists()

    # Simulate a process restart: a fresh store reading the same file.
    reloaded = BaselineStore(path=path)
    assert reloaded.has_baseline("acme/app") is True
    assert reloaded.get_baseline("acme/app", "checkout")["passed"] is False
    assert reloaded.get_baseline("acme/app", "login")["passed"] is True


def test_comparison_across_restart_flags_new_regression(tmp_path: Path):
    path = tmp_path / "baseline.json"

    seed = BaselineStore(path=path)
    seed.update_baseline_from_run("acme/app", [{"name": "checkout", "passed": True}])

    restarted = BaselineStore(path=path)
    result = restarted.compare(
        "acme/app",
        [{"name": "checkout", "passed": False, "error": "customer_address missing"}],
    )
    assert result["has_new_regressions"] is True
    assert result["new_regressions"][0]["category"] == RegressionCategory.NEW_REGRESSION.value


def test_missing_file_falls_back_to_seeded_defaults(tmp_path: Path):
    store = BaselineStore(path=tmp_path / "nope.json")
    assert store.has_baseline("web") is False
    assert store.get_baseline("web", "login")["passed"] is True


def test_path_none_is_memory_only(tmp_path: Path):
    store = BaselineStore(path=None, use_default_path=False)
    store.update_baseline_from_run("acme/app", [{"name": "login", "passed": True}])
    assert store.has_baseline("acme/app") is True
    # Nothing was written anywhere.
    assert not list(tmp_path.iterdir())
