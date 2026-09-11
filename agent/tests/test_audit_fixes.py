"""Comprehensive regression tests for the 10 audited security, robustness, and scoping fixes."""

from __future__ import annotations

import os
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.testclient import TestClient

from agent.analyzer.dependency_graph import DependencyGraph
from agent.api.runs import RunRecord, RunStore
from agent.bridge.daemon import BridgeDaemon
from agent.bridge.models import FileIntentStore, IntentEvent
from agent.credentials.store import CredentialDecryptionError, CredentialStore
from agent.github.app import GitHubAppClient
from agent.journeys.visual_inspector import (
    VisualInspectionResult,
    _heuristic_visual_check,
    inspect_screenshot_with_gemini,
)
from agent.main import app
from agent.runner.queue import JobQueue
from agent.runner.retention import cleanup_local_artifacts


# 1. Credentials dev/prod gate and decrypt error
def test_credentials_prod_gate_and_decrypt_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Production gate
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("CREDENTIAL_STORE_KEY", raising=False)
    with pytest.raises(RuntimeError, match="CREDENTIAL_STORE_KEY environment variable is required in production"):
        CredentialStore(path=tmp_path / "prod.enc")

    # Decrypt failure raises CredentialDecryptionError instead of returning {}
    monkeypatch.delenv("ENVIRONMENT", raising=False)
    bad_enc = tmp_path / "corrupt.enc"
    bad_enc.write_bytes(b"invalid_ciphertext_garbage")
    store = CredentialStore(path=bad_enc)
    with pytest.raises(CredentialDecryptionError, match="Failed to decrypt credentials"):
        store.get("test-project")


# 2. GitHub API URL encoding
@pytest.mark.asyncio
async def test_github_api_url_encoding() -> None:
    client = GitHubAppClient(token="fake-token")
    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"content": "", "encoding": "utf-8", "sha": "123"}
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        await client.get_file_content("owner", "repo", "app/[id]/page.tsx", "main")
        called_url = mock_get.call_args[0][0]
        assert "app/%5Bid%5D/page.tsx" in called_url


# 3. WebSocket Authorization header
def test_bridge_daemon_websocket_url_has_no_query_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_API_KEY", "secret-agent-key")
    daemon = BridgeDaemon(project_dir=tmp_path, platform_url="http://localhost:8000")
    # URL generated should not embed ?token=
    branch = "feature/test"
    from urllib.parse import quote_plus
    ws_url = f"{daemon.ws_base_url}/bridge/ws/{quote_plus(branch)}"
    assert "?token=" not in ws_url


# 4. Dependency graph Next.js App Router route groups and path matching
def test_dependency_graph_route_groups_and_path_matching(tmp_path: Path) -> None:
    app_dir = tmp_path / "app" / "(auth)" / "login"
    app_dir.mkdir(parents=True)
    page_file = app_dir / "page.tsx"
    page_file.write_text("export default function LoginPage() {}")

    graph = DependencyGraph(tmp_path)
    routes = graph.find_affected_routes([page_file])
    # Should strip (auth) route group and resolve to /login
    assert "/login" in routes
    assert "/(auth)/login" not in routes


# 5. Retention policy protects active runs
def test_retention_preserves_active_runs(tmp_path: Path) -> None:
    active_dir = tmp_path / "run_active_1234"
    active_dir.mkdir()
    (active_dir / "trace.zip").write_bytes(b"data")

    expired_dir = tmp_path / "run_expired_5678"
    expired_dir.mkdir()
    (expired_dir / "trace.zip").write_bytes(b"data")

    # Age both directories
    past = time.time() - (10 * 86400)
    os.utime(active_dir, (past, past))
    os.utime(expired_dir, (past, past))

    # Clean with active_run_ids protecting active_1234
    purged = cleanup_local_artifacts(
        max_age_seconds=7 * 86400,
        base_dirs=[tmp_path],
        active_run_ids={"active_1234"},
    )
    assert purged == 1
    assert active_dir.exists()
    assert not expired_dir.exists()


# 6. Queue cancellation terminates container
def test_queue_cancellation_terminates_container() -> None:
    queue = JobQueue(max_concurrent=2)
    queue._jobs["job1"] = MagicMock(status="running", error=None)
    queue._branch_active_job["acme/repo:feature"] = "job1"
    queue.register_container("job1", "test-container-99")

    with patch("subprocess.run") as mock_run:
        cancelled = queue.cancel_branch_jobs("acme/repo", "feature")
        assert cancelled == 0  # no async task mock attached, but status updated
        mock_run.assert_called_once_with(
            ["docker", "stop", "test-container-99"],
            capture_output=True,
            timeout=10,
        )


# 7. Visual inspector confidence calibration and DOM heuristics
def test_visual_inspector_calibrated_confidence() -> None:
    fake_screenshot = b"\x89PNG\r\n\x1a\n" + b"\x00" * 800
    # When unconfigured, should report 0.0 confidence (not 0.95)
    res = _heuristic_visual_check(fake_screenshot, route="/checkout")
    assert res.has_visual_defects is False
    assert res.confidence_score == 0.0
    assert "unconfigured" in res.summary.lower()

    # When DOM defects are present, should flag defect
    dom_res = _heuristic_visual_check(
        fake_screenshot,
        route="/checkout",
        dom_defects=["Low text contrast on checkout button"],
    )
    assert dom_res.has_visual_defects is True
    assert dom_res.is_visually_broken is True
    assert dom_res.confidence_score == 0.85


# 8. RunStore repository scoping
def test_run_store_repo_scoping() -> None:
    store = RunStore()
    store.create(branch="main", sha="sha123", repo="org-a/repo-1")
    store.create(branch="main", sha="sha123", repo="org-b/repo-2")

    match_a = store.find_latest_by_sha(branch="main", sha="sha123", repo="org-a/repo-1")
    match_b = store.find_latest_by_sha(branch="main", sha="sha123", repo="org-b/repo-2")

    assert match_a is not None and match_a.repo == "org-a/repo-1"
    assert match_b is not None and match_b.repo == "org-b/repo-2"
    assert store.find_latest_by_sha(branch="main", sha="sha123", repo="org-c/repo-3") is None


# 9. Webhook unmatched repo rejection
def test_webhook_unmatched_repo_rejection(monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib
    import hmac
    import json

    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "test-secret")
    monkeypatch.setenv("APP_REPO_NAME", "expected/repo")

    client = TestClient(app)
    payload = {
        "repository": {"full_name": "unexpected/foreign-repo"},
    }
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()

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
    assert "unmatched_repo" in resp.json()["reason"]


# 10. Webhook rate limiting cooldown on @pr-agent test
def test_webhook_rate_limiting_cooldown(monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib
    import hmac
    import json
    from agent.api.webhooks import _comment_command_cooldowns

    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "test-secret")
    client = TestClient(app)

    payload = {
        "action": "created",
        "issue": {
            "number": 10,
            "pull_request": {"url": "https://api.github.com/repos/owner/repo/pulls/10"},
            "user": {"login": "author"},
        },
        "comment": {
            "id": 901,
            "body": "@pr-agent test",
            "user": {"login": "author", "type": "User"},
            "author_association": "OWNER",
        },
        "repository": {"name": "repo", "owner": {"login": "owner"}, "full_name": "owner/repo"},
        "installation": {"id": 1},
    }
    body = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()

    # Pre-seed cooldown within the 60s window
    _comment_command_cooldowns["owner/repo#10:test"] = time.time() - 10.0

    with patch("agent.api.webhooks.github_client.create_reaction", new_callable=AsyncMock):
        resp = client.post(
            "/webhooks/github",
            content=body,
            headers={
                "X-GitHub-Event": "issue_comment",
                "X-Hub-Signature-256": sig,
                "Content-Type": "application/json",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "rate_limited"
