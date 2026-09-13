"""Unit and integration tests for resolved system gaps.

Covers:
1. Credential & secret redaction
2. Baseline key normalization and update_baseline_from_run
3. Storage state session persistence across journeys
4. Unified run store coherence between API and pipeline
5. Additional findings & severity categorization
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from starlette.testclient import TestClient

from agent.analyzer.diff_analyzer import AnalysisResult
from agent.api.runs import _active_store
from agent.bridge.models import IntentEvent
from agent.credentials.redaction import REDACTED_LABEL, redact_credentials
from agent.db.supabase import default_run_store
from agent.main import app
from conftest import AUTH_HEADERS
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)
from agent.runner.baseline import BaselineStore, RegressionCategory


def test_credential_redaction_masks_tokens_and_passwords() -> None:
    raw_text = (
        "Error in auth: password='SuperSecretPassword123' at /api/login.\n"
        "Header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\n"
        "Cookie: session=abc1234567xyz; path=/\n"
        "Token: ghp_1234567890abcdefghijklmnopqrstuvwxyzAB"
    )

    sanitized = redact_credentials(raw_text, custom_secrets=["SuperSecretPassword123"])

    assert "SuperSecretPassword123" not in sanitized
    assert REDACTED_LABEL in sanitized
    assert "abc1234567xyz" not in sanitized
    assert "ghp_1234567890" not in sanitized
    assert "Authorization:" in sanitized


def test_baseline_key_normalization() -> None:
    store = BaselineStore()
    store.set_baseline("test-repo", "dashboard", True, None)

    # All variations should resolve to the same normalized key
    assert store.get_baseline("test-repo", "dashboard")["passed"] is True
    assert store.get_baseline("test-repo", "/dashboard")["passed"] is True
    assert store.get_baseline("test-repo", "exploratory:dashboard")["passed"] is True
    assert store.get_baseline("test-repo", "exploratory:/dashboard")["passed"] is True

    # Test update_baseline_from_run
    store.update_baseline_from_run(
        "test-repo",
        [{"name": "exploratory:checkout", "passed": False, "error": "Checkout broken"}],
    )
    res = store.get_baseline("test-repo", "checkout")
    assert res["passed"] is False
    assert res["error"] == "Checkout broken"


def test_unified_run_store_coherence() -> None:
    client = TestClient(app, headers=AUTH_HEADERS)

    # 1. Trigger run via API
    res = client.post("/runs", json={"branch": "test/unified-store", "sha": "1122334455667788990011223344556677889900"})
    assert res.status_code == 200
    data = res.json()
    run_id = data["run_id"]

    # 2. Both _active_store() and default_run_store must see this exact record
    assert _active_store().get(run_id) is not None
    assert default_run_store.get(run_id) is not None

    # 3. Updating default_run_store must be immediately visible to GET /runs/{run_id}
    default_run_store.update(run_id=run_id, status="completed", result={"status": "success", "passed_journeys": ["login"]})
    get_res = client.get(f"/runs/{run_id}")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert get_data["status"] == "completed"
    assert get_data["result"]["passed_journeys"] == ["login"]


def test_remediation_formatter_redacts_and_packages_metadata() -> None:
    analysis = AnalysisResult(
        affected_surfaces=["/login", "/dashboard"],
        risk_tag="High",
        rationale="Authentication flow altered.",
        recommended_journeys=["login"],
    )
    intents = [
        IntentEvent(
            files=["app/login/actions.ts"],
            action="edit",
            prompt_summary="Update password: 'SuperSecret123' check",
            reasoning="Set new pass: 'SuperSecret123'",
            branch="test/redact",
        )
    ]

    prompt = generate_remediation_markdown(
        journey_name="login",
        error="Auth failure with password=SuperSecret123 on /login",
        analysis=analysis,
        intents=intents,
        trace_path="artifacts/runs/trace.zip",
        video_path="artifacts/runs/video.webm",
        dom_snapshot="<input name='password' value='SuperSecret123' />",
        severity="Critical",
        domain="Authentication",
        additional_findings=["Visual shift detected on submit button."],
    )

    assert "SuperSecret123" not in prompt
    assert "SEVERITY: CRITICAL" in prompt
    assert "Domain:** `Authentication`" in prompt
    assert "Additional Telemetry Findings" in prompt
    assert "Visual shift detected on submit button" in prompt

    comment = generate_pr_summary_comment(
        status="failure",
        passed_journeys=["login"],
        failed_journeys=[{
            "name": "checkout",
            "error": "Failed with token: ghp_11223344556677889900aabbccddeeff",
            "severity": "Critical",
            "domain": "Checkout/Payments",
        }],
        analysis=analysis,
        remediation_prompts=[prompt],
        additional_findings=["Console error on payment worker"],
    )

    assert "ghp_11223344556677889900aabbccddeeff" not in comment
    assert "[Checkout/Payments]" in comment
    assert "Critical" in comment
    assert "Console error on payment worker" in comment


@pytest.mark.asyncio
async def test_pipeline_collects_findings_and_uses_stored_credentials(tmp_path: Path, monkeypatch) -> None:
    from agent.runner.pipeline import run_pipeline

    # owner/repo here are fictitious test fixtures, not a real GitHub repo.
    # SANDBOX_MODE=disabled is what keeps this test off the network and off
    # Docker: no sandbox container is booted and no in-container clone happens,
    # so diff/route-discovery fall back to the local app repo. This test only
    # exercises journey orchestration / credential handling, which is what it
    # asserts on.
    monkeypatch.setenv("SANDBOX_MODE", "disabled")

    with patch("agent.runner.pipeline.run_login_journey") as mock_login, \
         patch("agent.journeys.browser_agent.run_route_journey") as mock_route:

        # Mock successful login with storage state export
        storage_file = tmp_path / "storage_state.json"
        storage_file.write_text('{"cookies": [{"name": "session", "value": "qa@example.com"}]}')

        mock_login_res = MagicMock()
        mock_login_res.passed = True
        mock_login_res.error = None
        mock_login_res.trace_path = tmp_path / "login-trace.zip"
        mock_login_res.video_path = tmp_path / "login-video.webm"
        mock_login_res.storage_state_path = storage_file
        mock_login.return_value = mock_login_res

        # Mock exploratory journey on /checkout with additional visual finding
        mock_route.return_value = {
            "name": "exploratory:/checkout",
            "passed": True,
            "error": None,
            "trace_path": str(tmp_path / "checkout-trace.zip"),
            "video_path": str(tmp_path / "checkout-video.webm"),
            "visual_inspection": {
                "layout_issues": ["Subtle margin misalignment on promo box"],
                "has_visual_defects": False,
            },
        }

        result = await run_pipeline(
            owner="acme-test",
            repo="ecommerce",
            branch="feat/test-pipeline",
            base_branch="main",
            sha="99887766554433221100aabbccddeeff00112233",
            intents=[
                IntentEvent(
                    files=["app/checkout/page.tsx"],
                    action="edit",
                    prompt_summary="Add checkout promo banner",
                    reasoning="Help users find discounts",
                    branch="feat/test-pipeline",
                )
            ],
        )

        assert result["status"] == "success"
        assert "login" in result["passed_journeys"]
        # Verify additional findings captured from visual inspection
        assert any("Subtle margin misalignment" in f for f in result.get("additional_findings", []))
        assert mock_route.call_count >= 1
        for c in mock_route.call_args_list:
            assert c.kwargs.get("storage_state") == storage_file
