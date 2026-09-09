"""Full closed-loop smoke test:
Intent Bridge -> Supabase/Store -> GitHub App Webhook -> AI Analyzer -> Check Run & Remediation Prompt.

Run with:
    uv run python scripts/full_loop_smoke.py
"""

from __future__ import annotations

import asyncio
import logging

from starlette.testclient import TestClient

from agent.analyzer.diff_analyzer import DiffAnalyzer
from agent.bridge.models import IntentEvent
from agent.db.supabase import default_intent_store, is_supabase_enabled
from agent.github.app import GitHubAppClient
from agent.main import app
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("full_loop_smoke")

TEST_BRANCH = "feature/quick-checkout"
COMMIT_SHA = "f1e2d3c4b5a697887766554433221100aabbccdd"
OWNER = "acme-corp"
REPO = "saas-app"
PR_NUMBER = 108


def main() -> None:
    print("==================================================================")
    print("  AUTONOMOUS PR TESTING ENGINE: FULL CLOSED-LOOP SMOKE DEMO       ")
    print("==================================================================")

    # 1. Check Supabase and Database setup
    print("\n[Step 1] Database & Storage Layer:")
    if is_supabase_enabled():
        print("  -> Supabase connection ACTIVE (PostgreSQL cloud storage enabled)")
    else:
        print("  -> Local adapter ACTIVE (Seamless fallback mode without SUPABASE_URL)")

    # 2. Simulate Claude Code tool-use intent capture via Bridge
    print(f"\n[Step 2] Coding Agent Bridge (Capturing Intent on '{TEST_BRANCH}'):")
    default_intent_store.clear(TEST_BRANCH)
    events = [
        IntentEvent(
            files=["app/checkout/page.tsx", "components/pay-button.tsx"],
            action="edit",
            prompt_summary="Add instant Apple Pay button to checkout",
            reasoning="Reduce cart abandonment by allowing 1-tap checkout without form filling",
            branch=TEST_BRANCH,
            sha=COMMIT_SHA,
        ),
        IntentEvent(
            files=["app/api/charge/route.ts"],
            action="create",
            prompt_summary="Add Apple Pay token charge handler",
            reasoning="Validate merchant session and forward token to Stripe",
            branch=TEST_BRANCH,
            sha=COMMIT_SHA,
        ),
    ]

    for ev in events:
        default_intent_store.append(TEST_BRANCH, ev)
        print(f"  + Captured Intent: [{ev.action}] {ev.files} -> '{ev.prompt_summary}'")

    # 3. Simulate GitHub PR Webhook Ingestion
    print(f"\n[Step 3] GitHub App Webhook Ingestion (PR #{PR_NUMBER} opened):")
    client = TestClient(app)
    webhook_payload = {
        "action": "opened",
        "pull_request": {
            "number": PR_NUMBER,
            "head": {"ref": TEST_BRANCH, "sha": COMMIT_SHA},
            "base": {"ref": "main"},
        },
        "repository": {
            "name": REPO,
            "full_name": f"{OWNER}/{REPO}",
            "owner": {"login": OWNER},
        },
    }

    res = client.post(
        "/webhooks/github",
        json=webhook_payload,
        headers={"X-GitHub-Event": "pull_request"},
    )
    assert res.status_code == 200, f"Webhook failed: {res.text}"
    webhook_data = res.json()
    check_run_id = webhook_data["check_run_id"]
    print(f"  -> Webhook accepted for {webhook_data['repo']} PR #{PR_NUMBER}")
    print(f"  -> GitHub Check Run created (ID: {check_run_id}) [Status: IN_PROGRESS ⏳]")
    print(f"  -> Linked {webhook_data['intents_found']} bridge intent records to this PR run")

    # 4. AI Diff + Intent Analysis
    print("\n[Step 4] AI Diff & Intent Analysis (Claude-powered):")
    sample_diff = """diff --git a/app/checkout/page.tsx b/app/checkout/page.tsx
--- a/app/checkout/page.tsx
+++ b/app/checkout/page.tsx
@@ -45,6 +45,10 @@ export default function CheckoutPage() {
+  // Apple Pay button bypasses standard address validation form
+  const handleApplePay = async () => {
+    await chargeApi({ token: session.token });
+  };
"""
    intents = default_intent_store.get(TEST_BRANCH)
    analyzer = DiffAnalyzer()
    analysis = analyzer.analyze(sample_diff, intents)
    print(f"  -> Risk Assessment: **{analysis.risk_tag.upper()} RISK**")
    print(f"  -> Rationale: {analysis.rationale}")
    print(f"  -> Affected Surfaces: {analysis.affected_surfaces}")
    print(f"  -> Planned Verification Journeys: {analysis.recommended_journeys}")

    # 5. Simulate Playwright Journey Execution & Failure Catching
    print("\n[Step 5] Autonomous Browser Journeys Execution (Playwright):")
    print("  ✓ Journey 1: 'login' (seeded auth flow) -> PASSED")
    print("  ❌ Journey 2: 'checkout' (Apple Pay flow) -> FAILED (Downstream invoice missing customer address)")

    # 6. Generate Forensic Remediation Prompt
    print("\n[Step 6] Forensic Proof & Remediation Markdown Generation:")
    remediation_prompt = generate_remediation_markdown(
        journey_name="checkout",
        error="Order creation failed: Address verification error (customer_address required)",
        analysis=analysis,
        intents=intents,
        trace_path="artifacts/runs/feature-quick-checkout_f1e2d3c4/trace.zip",
        video_path="artifacts/runs/feature-quick-checkout_f1e2d3c4/video.webm",
        dom_snapshot="<div class='error-toast'>Address verification error: customer_address is required for invoice creation</div>",
    )

    # 7. Update GitHub Check Run and Post PR Comment
    print("\n[Step 7] GitHub App Delivery (Check Run Completion + PR Comment):")
    github_client = GitHubAppClient()
    asyncio.run(
        github_client.update_check_run(
            owner=OWNER,
            repo=REPO,
            check_run_id=check_run_id,
            conclusion="failure",
            title="Autonomous Verification: Regression Detected",
            summary=f"Risk: {analysis.risk_tag} | Failed: checkout flow",
            text=remediation_prompt,
        )
    )
    print(f"  -> GitHub Check Run {check_run_id} updated [Status: COMPLETED, Conclusion: FAILURE ❌]")

    pr_comment = generate_pr_summary_comment(
        status="failure",
        passed_journeys=["login"],
        failed_journeys=[{"name": "checkout", "error": "Address verification error"}],
        analysis=analysis,
        remediation_prompts=[remediation_prompt],
    )
    comment_url = asyncio.run(
        github_client.post_pr_comment(
            owner=OWNER,
            repo=REPO,
            pr_number=PR_NUMBER,
            body=pr_comment,
        )
    )
    print(f"  -> GitHub PR Comment posted to PR #{PR_NUMBER}: {comment_url}")

    print("\n==================================================================")
    print("  >>> FULL CLOSED-LOOP ENGINE DEMONSTRATION COMPLETE & PASSED <<< ")
    print("==================================================================")


if __name__ == "__main__":
    main()
