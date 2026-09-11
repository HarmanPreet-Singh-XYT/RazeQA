"""Tests for interactive GitHub @pr-agent PR issue comment commands and security gates."""

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from agent.main import app
from agent.db.supabase import default_run_store
from agent.db.supabase import RunRecord


def _make_signature(body: bytes, secret: str = "test-secret") -> str:
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "test-secret")
    return TestClient(app)


def test_webhook_unauthorized_user_rejected(client):
    payload = {
        "action": "created",
        "issue": {
            "number": 42,
            "pull_request": {"url": "https://api.github.com/repos/owner/repo/pulls/42"},
            "user": {"login": "legitimate_pr_author"},
        },
        "comment": {
            "id": 101,
            "body": "@pr-agent apply",
            "user": {"login": "attacker_user", "type": "User"},
            "author_association": "NONE",
        },
        "repository": {"name": "repo", "owner": {"login": "owner"}, "full_name": "owner/repo"},
        "installation": {"id": 123},
    }
    body_bytes = json.dumps(payload).encode()
    headers = {
        "X-GitHub-Event": "issue_comment",
        "X-Hub-Signature-256": _make_signature(body_bytes),
        "Content-Type": "application/json",
    }

    with patch("agent.api.webhooks.github_client.create_reaction", new_callable=AsyncMock):
        res = client.post("/webhooks/github", content=body_bytes, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "rejected"
        assert data["reason"] == "unauthorized"


def test_webhook_help_command(client):
    payload = {
        "action": "created",
        "issue": {
            "number": 42,
            "pull_request": {"url": "https://api.github.com/repos/owner/repo/pulls/42"},
            "user": {"login": "author"},
        },
        "comment": {
            "id": 102,
            "body": "@pr-agent help",
            "user": {"login": "author", "type": "User"},
            "author_association": "OWNER",
        },
        "repository": {"name": "repo", "owner": {"login": "owner"}, "full_name": "owner/repo"},
        "installation": {"id": 123},
    }
    body_bytes = json.dumps(payload).encode()
    headers = {
        "X-GitHub-Event": "issue_comment",
        "X-Hub-Signature-256": _make_signature(body_bytes),
        "Content-Type": "application/json",
    }

    with patch("agent.api.webhooks.github_client.post_pr_comment", new_callable=AsyncMock) as mock_post:
        res = client.post("/webhooks/github", content=body_bytes, headers=headers)
        assert res.status_code == 200
        assert res.json()["command"] == "help"
        mock_post.assert_awaited_once()


def test_webhook_stale_commit_guard(client):
    # Seed an earlier run with old commit SHA
    branch = "feature/stale-branch"
    old_run = default_run_store.create(branch=branch, sha="1111111111111111")
    default_run_store.update(
        run_id=old_run.run_id,
        status="completed",
        result={"suggested_fixes": [{"file_path": "app/page.tsx"}]},
        completed=True,
    )

    payload = {
        "action": "created",
        "issue": {
            "number": 10,
            "pull_request": {"url": "https://api.github.com/repos/owner/repo/pulls/10"},
            "user": {"login": "author"},
        },
        "comment": {
            "id": 103,
            "body": "@pr-agent apply",
            "user": {"login": "author", "type": "User"},
            "author_association": "OWNER",
        },
        "repository": {"name": "repo", "owner": {"login": "owner"}, "full_name": "owner/repo"},
        "installation": {"id": 123},
    }
    body_bytes = json.dumps(payload).encode()
    headers = {
        "X-GitHub-Event": "issue_comment",
        "X-Hub-Signature-256": _make_signature(body_bytes),
        "Content-Type": "application/json",
    }

    # Mock PR head having advanced to a newer commit (222222222222)
    mock_pr = {
        "head": {"sha": "2222222222222222", "ref": branch},
        "base": {"ref": "main"},
    }

    with (
        patch("agent.api.webhooks.github_client.get_pr", new_callable=AsyncMock, return_value=mock_pr),
        patch("agent.api.webhooks.github_client.post_pr_comment", new_callable=AsyncMock) as mock_post,
        patch("agent.api.webhooks.github_client.create_reaction", new_callable=AsyncMock),
        patch("agent.api.webhooks.run_pipeline", new_callable=AsyncMock),
    ):
        res = client.post("/webhooks/github", content=body_bytes, headers=headers)
        assert res.status_code == 200
        assert res.json()["status"] == "stale_commit_guard_retriggered"
        assert "has received new commits" in mock_post.await_args[0][3]


def test_webhook_apply_flow_commits_and_retests(client):
    branch = "feature/checkout-fix"
    head_sha = "abcdef1234567890"

    # Seed run matching current head_sha with a suggested patch
    valid_run = default_run_store.create(branch=branch, sha=head_sha)
    default_run_store.update(
        run_id=valid_run.run_id,
        status="completed",
        result={
            "suggested_fixes": [
                {
                    "file_path": "app/checkout/page.tsx",
                    "original_snippet": "const valid = false;",
                    "replacement_snippet": "const valid = true;",
                    "unified_diff": "--- a/app/checkout/page.tsx\n+++ b/app/checkout/page.tsx",
                    "explanation": "Fix validation state",
                }
            ]
        },
        completed=True,
    )

    payload = {
        "action": "created",
        "issue": {
            "number": 15,
            "pull_request": {"url": "https://api.github.com/repos/owner/repo/pulls/15"},
            "user": {"login": "author"},
        },
        "comment": {
            "id": 104,
            "body": "@pr-agent apply",
            "user": {"login": "author", "type": "User"},
            "author_association": "OWNER",
        },
        "repository": {"name": "repo", "owner": {"login": "owner"}, "full_name": "owner/repo"},
        "installation": {"id": 123},
    }
    body_bytes = json.dumps(payload).encode()
    headers = {
        "X-GitHub-Event": "issue_comment",
        "X-Hub-Signature-256": _make_signature(body_bytes),
        "Content-Type": "application/json",
    }

    mock_pr = {
        "head": {"sha": head_sha, "ref": branch},
        "base": {"ref": "main"},
    }

    with (
        patch("agent.api.webhooks.github_client.get_pr", new_callable=AsyncMock, return_value=mock_pr),
        patch("agent.api.webhooks.github_client.get_file_content", new_callable=AsyncMock, return_value=("const valid = false;\nexport default function Page() {}", "blob123")),
        patch("agent.api.webhooks.github_client.update_file_content", new_callable=AsyncMock, return_value={"commit": {"sha": "fixedcommit999"}}),
        patch("agent.api.webhooks.github_client.post_pr_comment", new_callable=AsyncMock),
        patch("agent.api.webhooks.github_client.create_reaction", new_callable=AsyncMock),
        patch("agent.api.webhooks.github_client.create_check_run", new_callable=AsyncMock, return_value=999),
        patch("agent.api.webhooks.run_pipeline", new_callable=AsyncMock),
    ):
        res = client.post("/webhooks/github", content=body_bytes, headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "applied_and_retesting"
        assert data["commit"] == "fixedcommit999"
        assert "app/checkout/page.tsx" in data["files"]


def test_bot_loop_prevention(client):
    payload = {
        "action": "created",
        "issue": {"number": 1, "pull_request": {}},
        "comment": {
            "id": 105,
            "body": "Automated commit applied [skip-pr-agent]",
            "user": {"login": "bot", "type": "Bot"},
        },
    }
    body_bytes = json.dumps(payload).encode()
    headers = {
        "X-GitHub-Event": "issue_comment",
        "X-Hub-Signature-256": _make_signature(body_bytes),
        "Content-Type": "application/json",
    }
    res = client.post("/webhooks/github", content=body_bytes, headers=headers)
    assert res.status_code == 200
    assert res.json()["status"] == "ignored"
