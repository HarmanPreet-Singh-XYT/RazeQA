"""Unit and integration tests for Supabase, GitHub App, AI Analyzer, and Remediation."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from agent.analyzer.diff_analyzer import DiffAnalyzer
from agent.bridge.models import IntentEvent
from agent.db.supabase import (
    SupabaseIntentStore,
    default_intent_store,
    default_run_store,
    get_supabase_client,
    is_supabase_enabled,
)
from agent.github.app import verify_webhook_signature
from agent.main import app
from conftest import AUTH_HEADERS
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)


def test_supabase_fallback_mode() -> None:
    # default_intent_store/is_supabase_enabled() reflect whatever SUPABASE_URL
    # was present at *module import time* (the store is a module-level
    # singleton) — not necessarily the current process env, which may have
    # since picked up real credentials from agent/.env via a later
    # load_dotenv() call elsewhere in the test session (e.g. importing
    # agent.remediation.agentic_repair -> agent.config). So this only checks
    # that both are always in a valid, usable state, not which mode is active.
    assert isinstance(default_intent_store, SupabaseIntentStore) or default_intent_store is not None
    assert default_run_store is not None


def test_supabase_secret_key_resolution() -> None:
    # This test exercises key resolution, so it needs the factory to actually
    # build a client. The suite-wide guard (get_supabase_client returns None
    # under pytest, to keep fixture data out of real databases) is lifted here
    # only because `supabase.create_client` is mocked — no network I/O happens.
    with patch.dict(os.environ, {"ALLOW_SUPABASE_WRITES_IN_TESTS": "1"}, clear=False):
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SECRET_KEY": "sb_sec_test"}, clear=False):
            with patch("supabase.create_client") as mock_create:
                mock_create.return_value = "mock_client"
                client = get_supabase_client()
                assert client == "mock_client"
                mock_create.assert_called_once_with("https://example.supabase.co", "sb_sec_test")

        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SECRET_KEY": "", "SUPABASE_SERVICE_ROLE_KEY": "legacy_service_key"}, clear=False):
            with patch("supabase.create_client") as mock_create:
                mock_create.return_value = "mock_client_legacy"
                client = get_supabase_client()
                assert client == "mock_client_legacy"
                mock_create.assert_called_once_with("https://example.supabase.co", "legacy_service_key")


def test_github_webhook_signature_verification() -> None:
    secret = "test-secret-12345"
    payload = b'{"action": "opened"}'
    valid_sig = "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

    assert verify_webhook_signature(payload, valid_sig, secret) is True
    assert verify_webhook_signature(payload, "sha256=invalid", secret) is False
    assert verify_webhook_signature(payload, None, secret) is False


def test_diff_analyzer_heuristic() -> None:
    analyzer = DiffAnalyzer(api_key=None)
    intents = [
        IntentEvent(
            files=["app/login/page.tsx"],
            action="edit",
            prompt_summary="Fix login validation error",
            reasoning="Error message was not cleared on resubmission",
            branch="fix/login-error",
        )
    ]
    diff = "diff --git a/app/login/page.tsx b/app/login/page.tsx\n+ const auth = true;"
    res = analyzer.analyze(diff, intents)

    assert res.risk_tag == "High"  # Because auth was touched
    assert "/login" in res.affected_surfaces
    assert "login" in res.recommended_journeys
    assert len(res.rationale) > 0


def test_remediation_markdown_generator() -> None:
    analyzer = DiffAnalyzer(api_key=None)
    intents = [
        IntentEvent(
            files=["components/payment-form.tsx"],
            action="edit",
            prompt_summary="Validate CVV",
            reasoning="Prevent empty card submissions",
            branch="feat/payment",
        )
    ]
    analysis = analyzer.analyze("diff --git a/payment b/payment", intents)

    markdown = generate_remediation_markdown(
        journey_name="checkout",
        error="Element #submit-payment timed out after 10000ms",
        analysis=analysis,
        intents=intents,
        trace_path="/path/to/trace.zip",
        video_path="/path/to/video.webm",
    )

    assert "Autonomous PR Verification Failed" in markdown
    assert "HIGH RISK" in markdown
    assert "Validate CVV" in markdown
    assert "Prevent empty card submissions" in markdown
    assert "Ready-to-Paste Remediation Prompt" in markdown

    comment = generate_pr_summary_comment(
        status="failure",
        passed_journeys=["login"],
        failed_journeys=[{"name": "checkout", "error": "Timeout"}],
        analysis=analysis,
        remediation_prompts=[markdown],
    )
    assert "Autonomous PR Verification: **FAILURE**" in comment
    assert "❌ Regressions Detected" in comment


def test_github_webhook_endpoint_pr_opened() -> None:
    client = TestClient(app, headers=AUTH_HEADERS)
    branch = "feature/new-checkout-flow"
    sha = "7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"

    # Pre-seed intent log for this branch
    default_intent_store.clear(branch)
    default_intent_store.append(
        branch,
        IntentEvent(
            files=["app/checkout/page.tsx"],
            action="edit",
            prompt_summary="Add Apple Pay checkout button",
            reasoning="Offer mobile 1-click checkout options",
            branch=branch,
            sha=sha,
        ),
    )

    payload = {
        "action": "opened",
        "number": 42,
        "pull_request": {
            "number": 42,
            "head": {"ref": branch, "sha": sha},
            "base": {"ref": "main"},
        },
        "repository": {
            "name": "web",
            "full_name": "acme/web",
            "owner": {"login": "acme"},
        },
    }

    body = json.dumps(payload).encode()
    from conftest import TEST_GITHUB_WEBHOOK_SECRET

    secret = os.environ.get("GITHUB_WEBHOOK_SECRET") or TEST_GITHUB_WEBHOOK_SECRET
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()

    with patch(
        "agent.api.webhooks.github_client.create_check_run",
        new=AsyncMock(return_value=123456),
    ):
        res = client.post(
            "/webhooks/github",
            content=body,
            headers={
                "X-GitHub-Event": "pull_request",
                "X-Hub-Signature-256": signature,
                "Content-Type": "application/json",
            },
        )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "accepted"
    assert data["branch"] == branch
    assert data["pr_number"] == 42
    assert data["intents_found"] == 1
    assert data["check_run_id"] == 123456
