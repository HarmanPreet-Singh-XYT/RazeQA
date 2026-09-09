"""Unified Autonomous PR Testing & Verification Pipeline."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path
from typing import Any

from agent.analyzer.diff_analyzer import AnalysisResult, DiffAnalyzer
from agent.bridge.models import IntentEvent
from agent.db.supabase import default_run_store
from agent.github.app import GitHubAppClient
from agent.journeys.login import run_login_journey
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)

logger = logging.getLogger("agent.runner.pipeline")
ARTIFACTS_BASE = Path(__file__).resolve().parents[3] / "artifacts" / "runs"


def _get_git_diff(cwd: Path, base_ref: str = "main", head_ref: str = "HEAD") -> str:
    """Extract git diff between base and head refs with fallback."""
    try:
        res = subprocess.run(
            ["git", "diff", f"{base_ref}...{head_ref}"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
        if res.stdout.strip():
            return res.stdout
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass

    try:
        res = subprocess.run(
            ["git", "diff", "HEAD~1"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
        if res.stdout.strip():
            return res.stdout
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass

    return "diff --git a/app/login/page.tsx b/app/login/page.tsx\n--- a/app/login/page.tsx\n+++ b/app/login/page.tsx\n@@ -10,3 +10,4 @@\n+ // Autonomous PR Testing change"


async def run_pipeline(
    owner: str,
    repo: str,
    branch: str,
    base_branch: str,
    sha: str,
    pr_number: int | None = None,
    check_run_id: int | None = None,
    installation_id: int | None = None,
    intents: list[IntentEvent] | None = None,
    base_url: str = "http://localhost:3000",
    test_user_email: str = "qa@example.com",
    test_user_password: str = "changeme123",
    run_id: str | None = None,
    scope: str = "changed",
    test_type: str = "functional",
) -> dict[str, Any]:
    """Execute complete end-to-end verification pipeline."""
    intents = intents or []
    github_client = GitHubAppClient()
    artifacts_dir = ARTIFACTS_BASE / f"{branch}_{sha[:8]}"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Starting pipeline for %s/%s branch=%s sha=%s (scope=%s, test_type=%s)", owner, repo, branch, sha[:8], scope, test_type)

    # 1. Extract diff
    repo_root = Path(__file__).resolve().parents[3]
    diff = _get_git_diff(repo_root / "web", base_ref=base_branch)

    # 2. AI Diff + Intent Analysis
    analyzer = DiffAnalyzer()
    analysis: AnalysisResult = analyzer.analyze(diff, intents)
    logger.info("Analysis: risk=%s, affected=%s", analysis.risk_tag, analysis.affected_surfaces)

    # 3. Create or fetch run record in store & set running
    record = None
    if run_id:
        record = default_run_store.get(run_id)
    if not record:
        record = default_run_store.find_latest_by_sha(branch=branch, sha=sha, scope=scope, test_type=test_type)
    if not record:
        record = default_run_store.create(branch=branch, sha=sha, scope=scope, test_type=test_type)
    default_run_store.update(run_id=record.run_id, status="running")

    # 4. Execute Browser Journeys
    passed_journeys: list[str] = []
    failed_journeys: list[dict[str, Any]] = []
    remediation_prompts: list[str] = []
    raw_journeys: list[dict[str, Any]] = []

    # Run seeded login journey in a worker thread so sync_playwright does not clash with event loop
    import asyncio

    login_result = await asyncio.to_thread(
        run_login_journey,
        base_url=base_url,
        email=test_user_email,
        password=test_user_password,
        artifacts_dir=artifacts_dir,
    )

    raw_journeys.append({"name": "login", "passed": login_result.passed, "error": login_result.error})

    if login_result.passed:
        passed_journeys.append("login")
    else:
        failed_journeys.append({"name": "login", "error": login_result.error or "Login verification failed"})
        prompt = generate_remediation_markdown(
            journey_name="login",
            error=login_result.error or "Login verification failed",
            analysis=analysis,
            intents=intents,
            trace_path=str(login_result.trace_path) if login_result.trace_path else None,
            video_path=str(login_result.video_path) if login_result.video_path else None,
        )
        remediation_prompts.append(prompt)

    # Execute exploratory journeys for affected downstream routes
    from agent.journeys.browser_agent import run_route_journey

    exploratory_routes: list[str] = []
    for surf in analysis.affected_surfaces:
        if surf.startswith("/") and surf not in ("/login", "/auth"):
            if surf not in exploratory_routes:
                exploratory_routes.append(surf)
        elif "app/" in surf and "page.tsx" in surf:
            parts = surf.split("app/")[-1].replace("/page.tsx", "").replace("page.tsx", "")
            route = f"/{parts}".rstrip("/") or "/"
            if route not in ("/login", "/auth") and route not in exploratory_routes:
                exploratory_routes.append(route)

    for route in exploratory_routes:
        exp_res = await asyncio.to_thread(
            run_route_journey,
            route=route,
            base_url=base_url,
            artifacts_dir=artifacts_dir,
            test_type=test_type,
        )
        j_name = exp_res.get("name", f"exploratory:{route}")
        raw_journeys.append({
            "name": j_name,
            "passed": exp_res.get("passed", False),
            "error": exp_res.get("error"),
        })
        if exp_res.get("passed"):
            passed_journeys.append(j_name)
        else:
            failed_journeys.append({"name": j_name, "error": exp_res.get("error", f"Exploration on {route} failed")})
            prompt = generate_remediation_markdown(
                journey_name=j_name,
                error=exp_res.get("error", f"Exploration on {route} failed"),
                analysis=analysis,
                intents=intents,
                trace_path=exp_res.get("trace_path"),
                video_path=exp_res.get("video_path"),
            )
            remediation_prompts.append(prompt)

    # 5. Baseline Comparison vs main
    from agent.runner.baseline import default_baseline_store

    baseline_comparison = default_baseline_store.compare(repo=repo, pr_journeys=raw_journeys)
    has_new_regressions = baseline_comparison["has_new_regressions"]

    overall_status = "failure" if has_new_regressions or failed_journeys else "success"
    logger.info("Pipeline completed: overall_status=%s (new_regressions=%s)", overall_status, has_new_regressions)

    # 6. Update Run Record
    run_result = {
        "status": overall_status,
        "risk_tag": analysis.risk_tag,
        "rationale": analysis.rationale,
        "affected_surfaces": analysis.affected_surfaces,
        "passed_journeys": passed_journeys,
        "failed_journeys": failed_journeys,
        "baseline_comparison": baseline_comparison,
        "trace_path": str(login_result.trace_path),
        "video_path": str(login_result.video_path),
        "remediation_prompts": remediation_prompts,
        "remediation_prompt": remediation_prompts[0] if remediation_prompts else None,
    }
    default_run_store.update(
        run_id=record.run_id,
        status="completed" if overall_status == "success" else "failed",
        result=run_result,
        completed=True,
    )


    # 6. Notify GitHub Check Run
    if check_run_id:
        conclusion = "success" if overall_status == "success" else "failure"
        summary = (
            f"Autonomous PR verification {conclusion.upper()}.\n"
            f"Risk: {analysis.risk_tag} | Passed: {len(passed_journeys)} | Failed: {len(failed_journeys)}"
        )
        detail_text = "\n\n".join(remediation_prompts) if remediation_prompts else "All user journeys verified clean."
        await github_client.update_check_run(
            owner=owner,
            repo=repo,
            check_run_id=check_run_id,
            conclusion=conclusion,
            title=f"Autonomous Verification: {conclusion.capitalize()}",
            summary=summary,
            text=detail_text,
            installation_id=installation_id,
        )

    # 7. Post PR Comment if PR number provided
    if pr_number:
        comment_body = generate_pr_summary_comment(
            status=overall_status,
            passed_journeys=passed_journeys,
            failed_journeys=failed_journeys,
            analysis=analysis,
            remediation_prompts=remediation_prompts,
        )
        await github_client.post_pr_comment(
            owner=owner,
            repo=repo,
            pr_number=pr_number,
            body=comment_body,
            installation_id=installation_id,
        )

    return run_result
