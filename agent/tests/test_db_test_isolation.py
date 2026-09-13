"""Tests for the Supabase test-isolation guard and fixture-run cleanup.

The bug these cover: running pytest from a checkout whose ``agent/.env`` held
live Supabase credentials inserted fixture runs into the production ``runs``
table, so they showed up in the dashboard as real verifications.
"""

from __future__ import annotations

import os

import pytest

from agent.db.supabase import ALLOW_DB_IN_TESTS_ENV, get_supabase_client
from agent.runner.retention import _is_fixture_run

# ---------------------------------------------------------------------------
# Guard: no database access from the test suite by default
# ---------------------------------------------------------------------------


def test_supabase_client_is_refused_under_pytest():
    """Even with credentials present, pytest must not get a real client."""
    prior = {k: os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")}
    os.environ["SUPABASE_URL"] = "https://example.supabase.co"
    os.environ["SUPABASE_SECRET_KEY"] = "not-a-real-key"
    os.environ.pop(ALLOW_DB_IN_TESTS_ENV, None)
    try:
        assert get_supabase_client() is None
    finally:
        for key, value in prior.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_supabase_client_opt_in_attempts_real_construction():
    """The escape hatch exists for integration tests with a throwaway project."""
    prior = {k: os.environ.get(k) for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY")}
    os.environ["SUPABASE_URL"] = "https://example.supabase.co"
    os.environ["SUPABASE_SECRET_KEY"] = "not-a-real-key"
    os.environ[ALLOW_DB_IN_TESTS_ENV] = "1"
    try:
        # Construction succeeds (no network call happens here); the point is
        # only that the guard stood down.
        assert get_supabase_client() is not None
    finally:
        os.environ.pop(ALLOW_DB_IN_TESTS_ENV, None)
        for key, value in prior.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def test_guard_holds_even_with_ambient_credentials():
    """The real invariant: whatever the environment holds, pytest gets no client.

    `agent.config.load_env()` repopulates SUPABASE_* from `agent/.env` on import,
    so isolation cannot rest on scrubbing the environment — it has to be enforced
    where the client is created.
    """
    assert os.environ.get("SUPABASE_URL"), (
        "expected SUPABASE_URL from agent/.env; without it this test cannot prove "
        "the guard works against a live-looking environment"
    )
    os.environ.pop(ALLOW_DB_IN_TESTS_ENV, None)
    assert get_supabase_client() is None


# ---------------------------------------------------------------------------
# Fixture-run detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "row",
    [
        {"branch": "acme-corp", "sha": "http://127.0.0.1:55315"},
        {"branch": "acme-api-test", "sha": "http://127.0.0.1:55315"},
        {"branch": "main", "sha": "http://localhost:3000"},
        {"branch": "test-branch", "sha": "abc123"},
        {"branch": "feat/test", "sha": "abc123"},
    ],
)
def test_fixture_rows_are_detected(row):
    assert _is_fixture_run(row) is True


@pytest.mark.parametrize(
    "row",
    [
        {"branch": "main", "sha": "deadbeefcafe1234"},
        {"branch": "feat/checkout-fix", "sha": "9f8e7d6c5b4a3210"},
        {"branch": "production", "sha": "abcdef1234567890"},
        {"branch": "", "sha": ""},
    ],
)
def test_real_rows_are_not_flagged(row):
    assert _is_fixture_run(row) is False


def test_cleanup_dry_run_reports_without_deleting(monkeypatch):
    """The default is a preview; deleting requires an explicit apply."""
    from agent.runner import retention

    monkeypatch.setattr(
        retention,
        "find_fixture_runs",
        lambda: [{"id": "run_x", "branch": "acme-corp", "sha": "http://127.0.0.1:1"}],
    )
    summary = retention.cleanup_fixture_runs(dry_run=True)
    assert summary["count"] == 1
    assert summary["deleted"] == 0
    assert summary["dry_run"] is True
    assert summary["candidates"][0]["id"] == "run_x"


def test_cleanup_apply_deletes_matched_rows(monkeypatch):
    from agent.runner import retention

    deleted: list[str] = []

    class _Query:
        def __init__(self, row_id):
            self.row_id = row_id

        def delete(self):
            return self

        def eq(self, _field, value):
            deleted.append(value)
            return self

        def execute(self):
            return type("R", (), {"data": []})()

    class _Client:
        def table(self, _name):
            return self

        def delete(self):
            return self

        def eq(self, _field, value):
            deleted.append(value)
            return self

        def execute(self):
            return type("R", (), {"data": []})()

    monkeypatch.setattr(
        retention,
        "find_fixture_runs",
        lambda: [{"id": "run_a", "branch": "acme-corp", "sha": "http://127.0.0.1:1"}],
    )
    monkeypatch.setattr(
        "agent.db.supabase.get_supabase_client",
        lambda: _Client(),
    )

    summary = retention.cleanup_fixture_runs(dry_run=False)
    assert summary["deleted"] == 1
    assert "run_a" in deleted
