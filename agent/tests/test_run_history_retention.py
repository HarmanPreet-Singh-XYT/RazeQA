"""Opt-in run-history retention.

Run rows are the dashboard's history, so they are kept by default
(RUN_HISTORY_RETENTION_SECONDS=0 / `cleanup_run_history(0)` is a no-op). When a
deployment opts in, `runs.result` payloads expire on the retention schedule too.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from agent.api.runs import RunStore
from agent.db.supabase import SupabaseRunStore
from agent.runner import retention


class _FakeSupabaseQuery:
    def __init__(self, rows: list[dict], captured: dict):
        self._rows = rows
        self._captured = captured

    def delete(self):
        return self

    def lt(self, column: str, value: str):
        self._captured["column"] = column
        self._captured["value"] = value
        return self

    def execute(self):
        return SimpleNamespace(data=list(self._rows))


class _FakeSupabaseClient:
    def __init__(self, rows: list[dict], captured: dict):
        self._rows = rows
        self._captured = captured

    def table(self, _name: str) -> _FakeSupabaseQuery:
        return _FakeSupabaseQuery(self._rows, self._captured)


def test_cleanup_run_history_is_disabled_by_default(monkeypatch):
    calls: list[str] = []

    class _Store:
        def delete_older_than(self, cutoff_iso: str) -> int:
            calls.append(cutoff_iso)
            return 5

    monkeypatch.setattr("agent.db.supabase.default_run_store", _Store())

    assert retention.cleanup_run_history() == 0
    assert retention.cleanup_run_history(max_age_seconds=0) == 0
    assert retention.cleanup_run_history(max_age_seconds=-1) == 0
    assert calls == []


def test_cleanup_run_history_delegates_with_a_past_cutoff(monkeypatch):
    captured: list[str] = []

    class _Store:
        def delete_older_than(self, cutoff_iso: str) -> int:
            captured.append(cutoff_iso)
            return 3

    monkeypatch.setattr("agent.db.supabase.default_run_store", _Store())

    removed = retention.cleanup_run_history(max_age_seconds=7 * 86400)

    assert removed == 3
    assert len(captured) == 1
    cutoff = datetime.fromisoformat(captured[0])
    expected = datetime.now(UTC) - timedelta(days=7)
    assert abs((cutoff - expected).total_seconds()) < 60


def test_cleanup_run_history_survives_a_store_without_the_method(monkeypatch):
    class _Store:
        pass

    monkeypatch.setattr("agent.db.supabase.default_run_store", _Store())
    assert retention.cleanup_run_history(max_age_seconds=86400) == 0


def test_supabase_store_deletes_below_the_cutoff():
    captured: dict = {}
    rows = [{"id": "run_1"}, {"id": "run_2"}]
    store = SupabaseRunStore(_FakeSupabaseClient(rows, captured))

    removed = store.delete_older_than("2020-01-01T00:00:00+00:00")

    assert removed == 2
    assert captured == {"column": "created_at", "value": "2020-01-01T00:00:00+00:00"}


def test_in_memory_store_deletes_only_expired_runs():
    store = RunStore()
    fresh = store.create(branch="main", sha="aaa")

    # A cutoff an hour ago is older than the just-created run, so nothing goes.
    past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    assert store.delete_older_than(past) == 0
    assert store.get(fresh.run_id) is not None

    # A future cutoff (i.e. everything is "old") removes it.
    future = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert store.delete_older_than(future) == 1
    assert store.get(fresh.run_id) is None


def test_in_memory_store_ignores_a_malformed_cutoff():
    store = RunStore()
    store.create(branch="main", sha="bbb")
    assert store.delete_older_than("not-a-date") == 0
