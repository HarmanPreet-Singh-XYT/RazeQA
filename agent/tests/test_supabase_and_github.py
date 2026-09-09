"""Unit and integration tests for Supabase, GitHub App, AI Analyzer, and Remediation."""

from __future__ import annotations

import hashlib
import hmac

from starlette.testclient import TestClient

from agent.analyzer.diff_analyzer import DiffAnalyzer
from agent.bridge.models import IntentEvent
from agent.db.supabase import (
    SupabaseIntentStore,
    default_intent_store,
    default_run_store,
    is_supabase_enabled,
)
from agent.github.app import verify_webhook_signature
from agent.main import app
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)


def test_supabase_fallback_mode() -> None:
    # In test environment without SUPABASE_URL, fallback should be cleanly active
    assert is_supabase_enabled() is False or isinstance(default_intent_store, SupabaseIntentStore)
    assert default_run_store is not None


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
    client = TestClient(app)
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

    res = client.post(
        "/webhooks/github",
        json=payload,
        headers={"X-GitHub-Event": "pull_request"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "accepted"
    assert data["branch"] == branch
    assert data["pr_number"] == 42
    assert data["intents_found"] == 1
    assert data["check_run_id"] is not None
