"""Tests for installer capture on the GitHub App installation webhook.

Import is gated on ``installations.installed_by_github_user_id``, which is only
ever written from the signature-verified ``installation`` webhook ``sender``
(see web/lib/github/connection.ts). Two failure modes are worth pinning down:

* the installer is not recorded, so every account silently loses the ability to
  import and the connect screen never clears, and
* the installer is re-attributed on a ``installation_repositories`` edit, so an
  installation changes hands every time someone toggles repository access.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from agent.api import webhooks as webhooks_module
from agent.main import app


class _FakeSupabase:
    """Captures table writes so a test can assert on the exact row payload."""

    def __init__(self) -> None:
        self.upserts: list[tuple[str, dict]] = []
        self.deletes: list[str] = []

    def table(self, name: str) -> _FakeTable:
        return _FakeTable(name, self)


class _FakeTable:
    def __init__(self, name: str, parent: _FakeSupabase) -> None:
        self._name = name
        self._parent = parent

    def upsert(self, row: dict, on_conflict: str | None = None) -> _FakeTable:
        self._parent.upserts.append((self._name, row))
        return self

    def delete(self) -> _FakeTable:
        self._parent.deletes.append(self._name)
        return self

    def eq(self, *_args, **_kwargs) -> _FakeTable:
        return self

    def execute(self):
        return type("_Res", (), {"data": []})()


def _post_webhook(event: str, payload: dict) -> None:
    secret = os.environ["GITHUB_WEBHOOK_SECRET"]
    body = json.dumps(payload).encode()
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    response = TestClient(app).post(
        "/webhooks/github",
        content=body,
        headers={
            "X-GitHub-Event": event,
            "X-Hub-Signature-256": signature,
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 200, response.text


def test_installation_created_records_the_installer() -> None:
    fake = _FakeSupabase()
    payload = {
        "action": "created",
        "installation": {"id": 4242, "account": {"login": "acme", "id": 99}},
        "sender": {"id": 1234567, "login": "octocat"},
        "repositories": [
            {
                "id": 1,
                "name": "web",
                "full_name": "acme/web",
                "private": True,
                "default_branch": "main",
                "html_url": "https://github.com/acme/web",
            }
        ],
    }

    with patch("agent.db.supabase.get_supabase_client", return_value=fake):
        _post_webhook("installation", payload)

    assert len(fake.upserts) == 1, fake.upserts
    table, row = fake.upserts[0]
    assert table == "installations"
    assert row["installation_id"] == 4242
    assert row["installed_by_github_user_id"] == 1234567
    assert row["installed_by_login"] == "octocat"
    assert row["repositories"][0]["full_name"] == "acme/web"

    # Installing the App grants access; it must not silently create projects.
    assert all(name != "projects" for name, _ in fake.upserts)


def test_installation_created_without_sender_omits_installer_columns() -> None:
    """Omitting the keys preserves an installer recorded by an earlier delivery.

    PostgREST's merge-duplicates upsert only updates columns present in the
    payload, so writing nothing is the correct way to say "unknown" — writing
    null would clobber a previously known owner.
    """
    fake = _FakeSupabase()
    payload = {
        "action": "created",
        "installation": {"id": 4242, "account": {"login": "acme", "id": 99}},
        "repositories": [],
    }

    with patch("agent.db.supabase.get_supabase_client", return_value=fake):
        _post_webhook("installation", payload)

    _, row = fake.upserts[0]
    assert "installed_by_github_user_id" not in row
    assert "installed_by_login" not in row


def test_installation_repositories_does_not_reassign_ownership() -> None:
    fake = _FakeSupabase()
    payload = {
        "action": "added",
        "installation": {"id": 4242, "account": {"login": "acme", "id": 99}},
        # This sender toggled repository access; they are not necessarily the
        # account that installed the App.
        "sender": {"id": 7654321, "login": "teammate"},
    }

    repo_lookup = AsyncMock(
        return_value={
            "repositories": [
                {
                    "id": 1,
                    "name": "web",
                    "full_name": "acme/web",
                    "private": True,
                    "default_branch": "main",
                    "html_url": "https://github.com/acme/web",
                }
            ]
        }
    )

    with (
        patch("agent.db.supabase.get_supabase_client", return_value=fake),
        patch.object(
            webhooks_module.github_client,
            "get_installation_repositories",
            repo_lookup,
        ),
    ):
        _post_webhook("installation_repositories", payload)

    assert len(fake.upserts) == 1, fake.upserts
    _, row = fake.upserts[0]
    assert "installed_by_github_user_id" not in row
    assert "installed_by_login" not in row
    assert row["repositories"][0]["full_name"] == "acme/web"
