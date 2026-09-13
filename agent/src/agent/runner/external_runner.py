"""Autonomous Verification Pipeline for External / Non-GitHub Websites.

Enables automated browser testing, element-targeted scroll verification,
visual defect detection, and forensic artifact packaging for any live, staging,
or non-GitHub web application.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from pathlib import Path
from typing import Any

from agent.analyzer.quality_dimensions import default_quality_evaluator
from agent.db.supabase import default_run_store
from agent.journeys.browser_agent import run_route_journey
from agent.models.usage import (
    UsageAccumulator,
    clear_usage_accumulator,
    install_usage_accumulator,
)
from agent.runner.pipeline import ARTIFACTS_BASE, _artifact_url_for_file

logger = logging.getLogger("agent.runner.external")
EXTERNAL_PIPELINE_TIMEOUT_S = float(os.environ.get("EXTERNAL_PIPELINE_TIMEOUT_S", "300"))


def _sanitize_slug(text: str, max_len: int = 60) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", text).strip("_.-")
    return (cleaned or "external")[:max_len]


async def run_external_pipeline(
    url: str,
    run_id: str | None = None,
    name: str = "external-site",
    routes: list[str] | None = None,
    test_type: str = "functional",
    credentials: dict[str, str] | None = None,
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Execute autonomous verification against an external or standalone website."""
    try:
        return await asyncio.wait_for(
            _run_external_pipeline_inner(
                url=url,
                run_id=run_id,
                name=name,
                routes=routes,
                test_type=test_type,
                credentials=credentials,
                actions=actions,
            ),
            timeout=EXTERNAL_PIPELINE_TIMEOUT_S,
        )
    except TimeoutError:
        err_msg = f"External site testing for {url} timed out after {EXTERNAL_PIPELINE_TIMEOUT_S:.0f}s"
        logger.error(err_msg)
        if run_id:
            default_run_store.update(
                run_id=run_id,
                status="failed",
                result={"status": "error", "error": err_msg},
                completed=True,
            )
        raise
    except Exception as exc:
        err_msg = f"External site testing failed for {url}: {exc}"
        logger.exception(err_msg)
        if run_id:
            default_run_store.update(
                run_id=run_id,
                status="failed",
                result={"status": "error", "error": err_msg},
                completed=True,
            )
        raise


async def _run_external_pipeline_inner(
    url: str,
    run_id: str | None = None,
    name: str = "external-site",
    routes: list[str] | None = None,
    test_type: str = "functional",
    credentials: dict[str, str] | None = None,
    actions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    t_start = time.monotonic()
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    # 1. Ensure RunRecord exists
    record = None
    if run_id:
        record = default_run_store.get(run_id)
    if not record:
        record = default_run_store.create(
            branch=name,
            sha=url,
            scope="external",
            test_type=test_type,
            repo="external",
        )
        run_id = record.run_id

    default_run_store.update(run_id=record.run_id, status="running")

    # 2. Setup artifacts directory
    safe_slug = _sanitize_slug(f"{name}_{url.split('://')[-1].split('/')[0]}")
    artifacts_dir = ARTIFACTS_BASE / f"ext_{safe_slug}_{run_id[-8:]}"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    test_routes = routes or ["/"]
    passed_journeys: list[str] = []
    failed_journeys: list[dict[str, Any]] = []
    additional_findings: list[str] = []
    journey_artifacts: list[dict[str, Any]] = []
    primary_video_url: str | None = None
    primary_trace_url: str | None = None

    logger.info("Starting external site testing on %s (routes: %s, test_type: %s)", url, test_routes, test_type)

    # Meter real Strands LLM usage for the navigator/visual agents this run creates.
    usage_accumulator = UsageAccumulator()
    install_usage_accumulator(usage_accumulator)

    # 3. Execute journeys across routes
    for r in test_routes:
        if r.startswith(("http://", "https://")):
            target = r
        else:
            target = f"{url.rstrip('/')}/{r.lstrip('/')}" if r != "/" else url

        j_name = f"external:{r}"
        try:
            exp_res = await asyncio.to_thread(
                run_route_journey,
                route=target,
                base_url=url,
                artifacts_dir=artifacts_dir,
                test_type=test_type,
                actions=actions,
            )

            passed = exp_res.get("passed", False)
            err = exp_res.get("error")

            # Collect visual findings
            for finding in exp_res.get("visual_findings", []) or []:
                additional_findings.append(f"Visual check on {target}: {finding}")

            vis_inspection = exp_res.get("visual_inspection")
            if vis_inspection and isinstance(vis_inspection, dict):
                for issue in vis_inspection.get("layout_issues", []):
                    additional_findings.append(f"Gemini visual warning on {target}: {issue}")

            v_url = _artifact_url_for_file(exp_res.get("video_path"), run_id, "video")
            t_url = _artifact_url_for_file(exp_res.get("trace_path"), run_id, "traces")
            annotated_path = exp_res.get("annotated_screenshot_path")
            annotated_url = _artifact_url_for_file(annotated_path, run_id, "screenshots") if annotated_path else None

            if not primary_video_url and v_url:
                primary_video_url = v_url
            if not primary_trace_url and t_url:
                primary_trace_url = t_url

            journey_artifacts.append({
                "route": target,
                "base_url": url,
                "passed": passed,
                "title": exp_res.get("title", ""),
                "interactive_count": exp_res.get("interactive_count", 0),
                "scrollable_count": exp_res.get("scrollable_count", 0),
                "trace_url": t_url,
                "video_url": v_url,
                "screenshot_url": annotated_url or _artifact_url_for_file(exp_res.get("screenshot_path"), run_id, "screenshots"),
                "trace_path": str(exp_res.get("trace_path")) if exp_res.get("trace_path") else None,
                "video_path": str(exp_res.get("video_path")) if exp_res.get("video_path") else None,
                "dom_snapshot": exp_res.get("dom_snapshot", ""),
                "network_requests": exp_res.get("network_requests", []),
                "console_errors": exp_res.get("console_errors", []),
                "response_headers": exp_res.get("response_headers", {}),
                "duration_ms": exp_res.get("duration_ms"),
                # Real browser measurements threaded to the evaluator.
                "web_vitals": exp_res.get("web_vitals"),
                "action_timings_ms": exp_res.get("action_timings_ms", []),
            })

            if passed:
                passed_journeys.append(j_name)
            else:
                failed_journeys.append({
                    "name": j_name,
                    "target": target,
                    "error": err or f"Exploration on {target} failed",
                    "severity": "High",
                })
        except Exception as exc:
            failed_journeys.append({
                "name": j_name,
                "target": target,
                "error": f"Journey error: {exc}",
                "severity": "Critical",
            })

    duration_s = round(time.monotonic() - t_start, 2)
    overall_status = "failure" if failed_journeys else "success"

    summary_text = (
        f"Verified external site {url}: {len(passed_journeys)} passed, {len(failed_journeys)} failed "
        f"across {len(test_routes)} route(s) in {duration_s}s."
    )

    # Calculate real quality dimensions & per-path analysis for external site
    llm_usage = usage_accumulator.snapshot().to_dict()
    clear_usage_accumulator()
    quality_report_obj = default_quality_evaluator.evaluate_run(
        run_record=record,
        journeys=journey_artifacts,
        repo_dir=None,
        llm_usage=llm_usage,
    )
    quality_report = quality_report_obj.to_dict()

    final_result = {
        "status": overall_status,
        "url": url,
        "name": name,
        "test_type": test_type,
        "duration_s": duration_s,
        "summary": summary_text,
        "passed_journeys": passed_journeys,
        "failed_journeys": failed_journeys,
        "additional_findings": additional_findings,
        "artifacts": journey_artifacts,
        "video_url": primary_video_url,
        "trace_url": primary_trace_url,
        "quality_dimensions": quality_report,
        "per_path_analysis": quality_report.get("per_path_analysis", {}),
    }

    default_run_store.update(
        run_id=record.run_id,
        status="completed" if overall_status == "success" else "failed",
        result=final_result,
        completed=True,
    )

    logger.info("External site testing finished for %s in %ss: status=%s", url, duration_s, overall_status)
    return final_result
