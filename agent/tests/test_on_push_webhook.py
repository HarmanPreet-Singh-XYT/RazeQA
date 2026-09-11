"""Tests for on-push webhook event handling."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from unittest.mock import patch

from starlette.testclient import TestClient

from agent.main import app


def test_on_push_webhook_event(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "test-secret"
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", secret)

    payload = {
        "ref": "refs/heads/feature/fast-push",
        "after": "a1b2c3d4e5f678901234567890abcdef12345678",
        "deleted": False,
        "head_commit": {
            "id": "a1b2c3d4e5f678901234567890abcdef12345678",
            "message": "feat: test on-push verification",
        },
        "repository": {
            "name": "ecommerce",
            "full_name": "acme/ecommerce",
            "owner": {"login": "acme"},
            "default_branch": "main",
        },
        "installation": {"id": 998877},
    }

    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    client = TestClient(app)
    with patch("agent.api.webhooks.run_pipeline") as mock_pipeline:
        resp = client.post(
            "/webhooks/github",
            content=body,
            headers={
                "X-GitHub-Event": "push",
                "X-Hub-Signature-256": sig,
                "Content-Type": "application/json",
            },
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "queued"
        assert data["event"] == "push"
        assert data["branch"] == "feature/fast-push"
        assert data["sha"] == "a1b2c3d4e5f678901234567890abcdef12345678"


def test_on_push_webhook_skip_ci(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "test-secret"
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", secret)

    payload = {
        "ref": "refs/heads/feature/skip-me",
        "after": "b2c3d4e5f678901234567890abcdef1234567890",
        "deleted": False,
        "head_commit": {
            "id": "b2c3d4e5f678901234567890abcdef1234567890",
            "message": "chore: docs update [skip ci]",
        },
        "repository": {"name": "ecommerce", "default_branch": "main"},
    }

    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    client = TestClient(app)
    resp = client.post(
        "/webhooks/github",
        content=body,
        headers={
            "X-GitHub-Event": "push",
            "X-Hub-Signature-256": sig,
            "Content-Type": "application/json",
        },
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "ignored"
    assert resp.json()["reason"] == "skip_commit_directive"
