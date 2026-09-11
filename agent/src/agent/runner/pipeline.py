"""Unified Autonomous PR Testing & Verification Pipeline."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from agent.analyzer.diff_analyzer import AnalysisResult, DiffAnalyzer
from agent.analyzer.quality_dimensions import default_quality_evaluator
from agent.bridge.models import IntentEvent
from agent.db.supabase import default_run_store
from agent.github.app import GitHubAppClient, GitHubNotConfiguredError
from agent.journeys.login import run_login_journey
from agent.remediation.agentic_repair import AgenticRepairEngine, AutoRepairConfig
from agent.remediation.fix_synthesizer import FilePatch, FixProposal, FixSynthesizer, apply_patch_to_text
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)
from agent.sandbox.checkout import CheckoutError, checkout_worktree
from agent.sandbox.docker_sandbox import SandboxBootError, build_image, run_sandbox

logger = logging.getLogger("agent.runner.pipeline")
ARTIFACTS_BASE = Path(__file__).resolve().parents[3] / "artifacts" / "runs"
WORKSPACES_BASE = Path(__file__).resolve().parents[3] / "artifacts" / "workspaces"


_ADMIN_PATH_SEGMENT_RE = re.compile(r"(?:^|[/\\])admin(?:[/\\]|$)")


def _touches_admin_path(file_path: str) -> bool:
    """True only if 'admin' appears as its own path segment (a directory or
    bare filename component), not merely as a substring anywhere in the path.
    Rejects false positives like 'AdminBadge.tsx' or 'README-admin-notes.md'."""
    normalized = str(file_path)
    stem_no_ext = re.sub(r"\.[^./\\]+$", "", normalized)
    return bool(_ADMIN_PATH_SEGMENT_RE.search(normalized)) or bool(
        re.search(r"(?:^|[/\\])admin$", stem_no_ext)
    )


_UNSAFE_PATH_CHARS_RE = re.compile(r"[^A-Za-z0-9._-]")


def _sanitize_path_component(value: str, max_len: int = 100) -> str:
    """Collapse a branch/sha value into a safe single path component.

    branch names are attacker-controlled (a PR author picks their own head
    ref), so this must not be used directly in a filesystem path or Docker
    tag: a branch named e.g. "../../etc/foo" would otherwise let a crafted
    PR write run artifacts outside ARTIFACTS_BASE.
    """
    collapsed = _UNSAFE_PATH_CHARS_RE.sub("-", value).strip("-.")
    return (collapsed or "run")[:max_len]


def _artifact_url_for_file(
    local_path: str | Path | None,
    run_id: str | None = None,
    category: str = "video",
) -> str | None:
    """Returns the Supabase Storage public URL if uploaded, or local relative URL as fallback."""
    if not local_path:
        return None
    p = Path(local_path)
    if p.exists() and p.is_file():
        try:
            from agent.db.storage import default_artifact_storage

            if default_artifact_storage.is_available():
                prefix = f"runs/{run_id}" if run_id else "runs"
                dest = f"{prefix}/{category}/{p.name}"
                uploaded_url = default_artifact_storage.upload_artifact(p, dest)
                if uploaded_url:
                    return uploaded_url
        except Exception as exc:  # noqa: BLE001
            logger.warning("Supabase storage upload failed for %s: %s", p, exc)

    from agent.api.artifacts import to_artifact_url

    return to_artifact_url(local_path)


# Directory containing the app-under-test's own git repo (must have a real
# .git so `git worktree` / `git diff` work). In the Docker Compose stack this
# is bind-mounted to /app/repo/web (docker-compose.yml); for bare local
# development it defaults to the monorepo's own top-level web/ directory.
APP_REPO_DIR = Path(
    os.environ.get("APP_REPO_DIR", str(Path(__file__).resolve().parents[4] / "web"))
)

# Set SANDBOX_MODE=disabled to fall back to hitting a locally-running app
# instance directly (useful for local development without Docker-in-Docker).
# Any other value (or unset, in a real deployment) requires real per-run
# container isolation — the pipeline refuses to silently test against
# whatever happens to be on localhost:3000.
SANDBOX_MODE = os.environ.get("SANDBOX_MODE", "docker")


@contextmanager
def _sandbox_for_sha(repo_dir: Path, sha: str, image_tag: str, env: dict[str, str], run_id: str | None = None):
    """Checks out `sha` into an isolated worktree, builds an image from it,
    boots a resource-constrained container, and yields its base_url. Always
    tears down the worktree and container on exit."""
    mode = os.environ.get("SANDBOX_MODE", SANDBOX_MODE)
    if mode == "disabled":
        logger.warning(
            "SANDBOX_MODE=disabled: testing against http://localhost:3000 directly "
            "instead of an isolated per-run container. Not safe for untrusted PR code."
        )
        yield "http://localhost:3000"
        return

    with checkout_worktree(repo_dir, sha, WORKSPACES_BASE) as worktree_path:
        build_image(worktree_path, image_tag)
        try:
            with run_sandbox(image_tag, env=env) as handle:
                if run_id:
                    from agent.runner.queue import default_job_queue
                    default_job_queue.register_container(run_id, handle.container_name)
                try:
                    yield handle.base_url
                finally:
                    if run_id:
                        from agent.runner.queue import default_job_queue
                        default_job_queue.unregister_container(run_id)
        finally:
            if os.environ.get("KEEP_SANDBOX_IMAGES", "false").lower() not in ("true", "1"):
                from agent.sandbox.docker_sandbox import remove_image
                remove_image(image_tag)


class GitDiffError(RuntimeError):
    """Raised when the actual diff for a run cannot be determined.

    A prior version of this function silently substituted a hardcoded fake
    diff when git commands failed, which meant a broken git ref/environment
    would produce a plausible-looking but entirely synthetic risk analysis
    instead of surfacing the failure. Fail the run instead.
    """


def _get_git_diff(cwd: Path, base_ref: str = "main", head_ref: str = "HEAD") -> str:
    """Extract git diff between base and head refs.

    An empty diff (base_ref == head_ref, nothing changed) is a legitimate
    result and returned as such — only a git *failure* (bad ref, not a repo,
    git missing) raises.
    """
    try:
        res = subprocess.run(
            ["git", "diff", f"{base_ref}...{head_ref}"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
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
        return res.stdout
    except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc2:
        raise GitDiffError(
            f"Could not compute git diff in {cwd} for {base_ref}...{head_ref}: {exc2}"
        ) from exc2


async def _synthesize_or_repair(
    journey_name: str,
    error: str,
    analysis: AnalysisResult,
    intents: list[IntentEvent],
    dom_snapshot: str | None = None,
    source_root: Path | None = None,
    custom_secrets: list[str] | None = None,
    fix_synthesizer: FixSynthesizer | None = None,
    auto_repair_config: AutoRepairConfig | None = None,
) -> FixProposal | None:
    """Executes autonomous agentic repair with mini-swe-agent when enabled,
    verifying builds and enforcing guardrails, with graceful fallback to synthesizer."""
    if auto_repair_config and auto_repair_config.enabled and source_root and source_root.exists():
        try:
            logger.info("Executing autonomous AgenticRepairEngine for '%s'...", journey_name)
            repair_engine = AgenticRepairEngine(config=auto_repair_config)
            repair_res = await asyncio.to_thread(
                repair_engine.run_repair,
                workspace_dir=source_root,
                journey_name=journey_name,
                error=error,
                analysis=analysis,
                intents=intents,
                dom_snapshot=dom_snapshot,
                custom_secrets=custom_secrets,
            )
            if repair_res and (repair_res.unified_diff or repair_res.target_files):
                trajectory_dicts = [
                    {
                        "step": t.step,
                        "thought": t.thought,
                        "command": t.command,
                        "returncode": t.returncode,
                        "output": t.output,
                        "duration_ms": t.duration_ms,
                        "guardrail_passed": t.guardrail_passed,
                    }
                    for t in repair_res.trajectory
                ]
                patches = []
                for tf in repair_res.target_files:
                    try:
                        patches.append(
                            FilePatch(
                                file_path=tf,
                                original_snippet="",
                                replacement_snippet="",
                                unified_diff=repair_res.unified_diff,
                                explanation=f"Verified with '{repair_res.build_command}'",
                            )
                        )
                    except Exception as patch_exc:
                        logger.warning("Failed to construct FilePatch for target file '%s': %s", tf, patch_exc)
                logger.info(
                    "AgenticRepairEngine completed with success=%s (build_passed=%s, diff_len=%d)",
                    repair_res.success,
                    repair_res.build_passed,
                    len(repair_res.unified_diff),
                )
                return FixProposal(
                    target_files=repair_res.target_files,
                    styling_paradigm="logic",
                    root_cause=f"Autonomous repair completed in {repair_res.steps_taken} steps",
                    explanation=f"Autonomous agent inspected code and verified fix with `{repair_res.build_command}` (build passed: {repair_res.build_passed}).",
                    patches=patches,
                    repair_trajectory=trajectory_dicts,
                    build_passed=repair_res.build_passed,
                    build_command=repair_res.build_command,
                    build_output=repair_res.build_output,
                    steps_taken=repair_res.steps_taken,
                    max_steps=repair_res.max_steps,
                    total_cost_usd=repair_res.total_cost_usd,
                    unified_diff=repair_res.unified_diff,
                )
        except Exception as exc:
            logger.warning("AgenticRepairEngine execution failed (%s), falling back to synthesizer.", exc)

    # Fallback to deterministic/LLM FixSynthesizer
    synth = fix_synthesizer or FixSynthesizer()
    return synth.synthesize(
        journey_name=journey_name,
        error=error,
        analysis=analysis,
        intents=intents,
        dom_snapshot=dom_snapshot,
        source_root=source_root,
        custom_secrets=custom_secrets,
    )


async def _run_journeys(
    base_url: str,
    test_user_email: str,
    test_user_password: str,
    artifacts_dir: Path,
    analysis: AnalysisResult,
    intents: list[IntentEvent],
    test_type: str,
    run_id: str | None = None,
    auto_repair_config: AutoRepairConfig | None = None,
) -> dict[str, Any]:
    """Runs the seeded login journey followed by exploratory journeys against
    `base_url`, returning collected results. Shared between the PR-branch run
    and (when refreshing the baseline) the base-branch run, so both use the
    exact same journey logic against their own isolated sandbox."""
    passed_journeys: list[str] = []
    failed_journeys: list[dict[str, Any]] = []
    additional_findings: list[str] = []
    remediation_prompts: list[str] = []
    raw_journeys: list[dict[str, Any]] = []
    fix_proposals: list[FixProposal] = []
    suggested_fixes: list[dict[str, Any]] = []

    custom_secrets = [s for s in (test_user_email, test_user_password) if s]

    fix_synthesizer = FixSynthesizer()

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
        login_err = login_result.error or "Login verification failed"
        failed_journeys.append({
            "name": "login",
            "error": login_err,
            "severity": "Critical",
            "domain": "Authentication",
        })
        login_proposal = await _synthesize_or_repair(
            journey_name="login",
            error=login_err,
            analysis=analysis,
            intents=intents,
            source_root=APP_REPO_DIR,
            custom_secrets=custom_secrets,
            fix_synthesizer=fix_synthesizer,
            auto_repair_config=auto_repair_config,
        )
        if login_proposal and (login_proposal.patches or login_proposal.unified_diff):
            fix_proposals.append(login_proposal)
            for p in login_proposal.patches:
                suggested_fixes.append(p.model_dump())

        login_video_url = _artifact_url_for_file(login_result.video_path, run_id, "video")
        login_trace_url = _artifact_url_for_file(login_result.trace_path, run_id, "traces")

        prompt = generate_remediation_markdown(
            journey_name="login",
            error=login_err,
            analysis=analysis,
            intents=intents,
            trace_path=login_trace_url or (str(login_result.trace_path) if login_result.trace_path else None),
            video_path=login_video_url or (str(login_result.video_path) if login_result.video_path else None),
            severity="Critical",
            domain="Authentication",
            fix_proposal=login_proposal,
            custom_secrets=custom_secrets,
        )
        remediation_prompts.append(prompt)

    from agent.journeys.browser_agent import run_route_journey

    storage_state_path = login_result.storage_state_path
    journey_artifacts: list[dict[str, Any]] = []

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
            storage_state=storage_state_path,
            risk_tag=analysis.risk_tag,
        )
        j_name = exp_res.get("name", f"exploratory:{route}")
        passed = exp_res.get("passed", False)
        err = exp_res.get("error")

        vis_inspection = exp_res.get("visual_inspection")
        if vis_inspection and isinstance(vis_inspection, dict):
            if vis_inspection.get("layout_issues"):
                for issue in vis_inspection["layout_issues"]:
                    additional_findings.append(f"Visual warning on {route}: {issue}")

        # Per-element visual heuristic/vision findings from observe_page()
        # (contrast, clipping, overlap, escalated Gemini checks) — a
        # separate, cheaper, per-element signal from the full-page Gemini
        # pass above, which only runs when test_type includes "visual".
        for finding in exp_res.get("visual_findings", []) or []:
            additional_findings.append(f"Visual defect on {route}: {finding}")

        raw_journeys.append({
            "name": j_name,
            "passed": passed,
            "error": err,
        })

        v_url = _artifact_url_for_file(exp_res.get("video_path"), run_id, "video")
        t_url = _artifact_url_for_file(exp_res.get("trace_path"), run_id, "traces")
        annotated_path = exp_res.get("annotated_screenshot_path")
        annotated_url = _artifact_url_for_file(annotated_path, run_id, "screenshots") if annotated_path else None

        journey_artifacts.append({
            "name": j_name,
            "route": route,
            "trace_url": t_url,
            "video_url": v_url,
            "annotated_screenshot_url": annotated_url,
            "trace_path": exp_res.get("trace_path"),
            "video_path": exp_res.get("video_path"),
            "annotated_screenshot_path": annotated_path,
            "dom_snapshot": exp_res.get("dom_snapshot", ""),
            "network_requests": exp_res.get("network_requests", []),
            "console_errors": exp_res.get("console_errors", []),
            "response_headers": exp_res.get("response_headers", {}),
            "duration_ms": exp_res.get("duration_ms", 1200.0),
        })

        domain = "Checkout/Payments" if "checkout" in route else "Dashboard/Navigation" if "dashboard" in route else "UI/Features"
        severity = "Critical" if "checkout" in route else "High"

        if passed:
            passed_journeys.append(j_name)
        else:
            journey_err = err or f"Exploration on {route} failed"
            failed_journeys.append({
                "name": j_name,
                "error": journey_err,
                "severity": severity,
                "domain": domain,
            })
            route_proposal = await _synthesize_or_repair(
                journey_name=j_name,
                error=journey_err,
                analysis=analysis,
                intents=intents,
                dom_snapshot=exp_res.get("dom_snapshot"),
                source_root=APP_REPO_DIR,
                custom_secrets=custom_secrets,
                fix_synthesizer=fix_synthesizer,
                auto_repair_config=auto_repair_config,
            )
            if route_proposal and (route_proposal.patches or route_proposal.unified_diff):
                fix_proposals.append(route_proposal)
                for p in route_proposal.patches:
                    suggested_fixes.append(p.model_dump())

            prompt = generate_remediation_markdown(
                journey_name=j_name,
                error=journey_err,
                analysis=analysis,
                intents=intents,
                trace_path=t_url or exp_res.get("trace_path"),
                video_path=v_url or exp_res.get("video_path"),
                dom_snapshot=exp_res.get("dom_snapshot"),
                severity=severity,
                domain=domain,
                additional_findings=additional_findings if additional_findings else None,
                fix_proposal=route_proposal,
                custom_secrets=custom_secrets,
            )
            remediation_prompts.append(prompt)

    return {
        "passed_journeys": passed_journeys,
        "failed_journeys": failed_journeys,
        "additional_findings": additional_findings,
        "remediation_prompts": remediation_prompts,
        "raw_journeys": raw_journeys,
        "login_result": login_result,
        "journey_artifacts": journey_artifacts,
        "fix_proposals": fix_proposals,
        "suggested_fixes": suggested_fixes,
    }


# Hard ceiling on a single pipeline run (checkout + image build + sandbox
# boot + all journeys + baseline refresh). Runs are dispatched via
# background_tasks.add_task with no external supervisor watching them — a
# hung `docker build`, a wedged sandbox boot, or a stuck Playwright call
# would otherwise leave the run at status="running" forever with no
# indication anything is wrong.
PIPELINE_TIMEOUT_S = float(os.environ.get("PIPELINE_TIMEOUT_S", "900"))


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
    test_user_email: str = "qa@example.com",
    test_user_password: str = "changeme123",
    run_id: str | None = None,
    scope: str = "changed",
    test_type: str = "functional",
) -> dict[str, Any]:
    """Execute complete end-to-end verification pipeline, with a timeout and
    catch-all failure handling so a run can never get stuck at "running"
    forever — see _run_pipeline_inner for the actual pipeline steps."""
    try:
        return await asyncio.wait_for(
            _run_pipeline_inner(
                owner=owner,
                repo=repo,
                branch=branch,
                base_branch=base_branch,
                sha=sha,
                pr_number=pr_number,
                check_run_id=check_run_id,
                installation_id=installation_id,
                intents=intents,
                test_user_email=test_user_email,
                test_user_password=test_user_password,
                run_id=run_id,
                scope=scope,
                test_type=test_type,
            ),
            timeout=PIPELINE_TIMEOUT_S,
        )
    except TimeoutError:
        logger.error("Pipeline for %s/%s branch=%s sha=%s timed out after %ss", owner, repo, branch, sha[:8], PIPELINE_TIMEOUT_S)
        _mark_run_failed_by_lookup(branch, sha, scope, test_type, run_id, f"Pipeline timed out after {PIPELINE_TIMEOUT_S:.0f}s")
        raise
    except Exception as exc:  # noqa: BLE001
        # Catch-all: any error not already handled by a specific except
        # clause inside _run_pipeline_inner still must not leave the run
        # record stuck at "running" with no explanation.
        logger.exception("Unhandled pipeline error for %s/%s branch=%s sha=%s", owner, repo, branch, sha[:8])
        _mark_run_failed_by_lookup(branch, sha, scope, test_type, run_id, f"Unhandled pipeline error: {exc}")
        raise


def _mark_run_failed_by_lookup(
    branch: str, sha: str, scope: str, test_type: str, run_id: str | None, error: str
) -> None:
    """Best-effort: find (or accept the given) run record and mark it failed.
    Used by run_pipeline's outer timeout/catch-all, which may fire before
    _run_pipeline_inner ever created or fetched a record itself."""
    try:
        record = default_run_store.get(run_id) if run_id else None
        if not record:
            record = default_run_store.find_latest_by_sha(branch=branch, sha=sha, scope=scope, test_type=test_type)
        if record and record.status not in ("completed", "failed"):
            default_run_store.update(
                run_id=record.run_id,
                status="failed",
                result={"status": "error", "error": error},
                completed=True,
            )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to mark run as failed after pipeline error")


async def _run_pipeline_inner(
    owner: str,
    repo: str,
    branch: str,
    base_branch: str,
    sha: str,
    pr_number: int | None = None,
    check_run_id: int | None = None,
    installation_id: int | None = None,
    intents: list[IntentEvent] | None = None,
    test_user_email: str = "qa@example.com",
    test_user_password: str = "changeme123",
    run_id: str | None = None,
    scope: str = "changed",
    test_type: str = "functional",
) -> dict[str, Any]:
    """Execute complete end-to-end verification pipeline."""
    intents = intents or []
    github_client = GitHubAppClient()
    artifacts_dir = ARTIFACTS_BASE / f"{_sanitize_path_component(branch)}_{sha[:8]}"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    # 0. Query project credentials from CredentialStore if available
    try:
        from agent.credentials.store import CredentialStore

        cred_store = CredentialStore()
        # If any intent touches an actual admin route/directory, prefer admin
        # role. Matches a path *segment* named "admin" (e.g. "app/admin/page.tsx",
        # "src/admin/Panel.tsx") rather than a bare substring — a naive
        # substring check would grant elevated sandbox credentials to any PR
        # that merely touches a benign file like "AdminBadge.tsx" or
        # "README-admin-notes.md", widening the blast radius of admin
        # credential exposure to untrusted PR code for no reason.
        role = "admin" if any(_touches_admin_path(f) for it in intents for f in it.files) else "user"
        role_cred = cred_store.get_role(f"{owner}/{repo}", role=role) or cred_store.get_role(repo, role=role)
        if role_cred and role_cred.email:
            test_user_email = role_cred.email
            test_user_password = role_cred.password
            logger.info("Injected stored credentials for project '%s/%s' (role=%s)", owner, repo, role_cred.role)
    except Exception as exc:  # noqa: BLE001
        logger.debug("CredentialStore lookup skipped: %s", exc)

    logger.info("Starting pipeline for %s/%s branch=%s sha=%s (scope=%s, test_type=%s)", owner, repo, branch, sha[:8], scope, test_type)

    # 1. Create or fetch run record in store & set running (before any step that
    # can fail, so a failure always has a record to mark as failed rather than
    # leaving the run stuck at "queued" with no explanation).
    record = None
    if run_id:
        record = default_run_store.get(run_id)
    if not record:
        record = default_run_store.find_latest_by_sha(branch=branch, sha=sha, scope=scope, test_type=test_type)
    if not record:
        record = default_run_store.create(branch=branch, sha=sha, scope=scope, test_type=test_type)
    default_run_store.update(run_id=record.run_id, status="running")

    # 2. Extract diff
    try:
        diff = _get_git_diff(APP_REPO_DIR, base_ref=base_branch)
    except GitDiffError as exc:
        logger.error("Pipeline aborted for run %s: %s", record.run_id, exc)
        default_run_store.update(
            run_id=record.run_id,
            status="failed",
            result={"status": "error", "error": str(exc)},
            completed=True,
        )
        raise

    # 3. AI Diff + Intent Analysis with Dependency Graph
    t_analysis = time.monotonic()
    from agent.analyzer.dependency_graph import DependencyGraph

    changed_files = [f for it in intents for f in it.files]
    diff_file_matches = re.findall(r"^\+\+\+ b/(.+)$", diff, re.MULTILINE)
    for df in diff_file_matches:
        if df not in changed_files:
            changed_files.append(df)

    dep_graph = DependencyGraph(APP_REPO_DIR)
    downstream_surfaces = dep_graph.find_affected_routes(changed_files)
    if downstream_surfaces:
        logger.info("Dependency graph found %d downstream route(s): %s", len(downstream_surfaces), downstream_surfaces)

    analyzer = DiffAnalyzer()
    analysis: AnalysisResult = analyzer.analyze(diff, intents, downstream_surfaces=downstream_surfaces)
    timing: dict[str, float] = {"analysis_duration_s": round(time.monotonic() - t_analysis, 3)}
    logger.info("Analysis: risk=%s, affected=%s", analysis.risk_tag, analysis.affected_surfaces)

    # 4. Execute Browser Journeys inside an isolated, resource-constrained
    # sandbox built from the exact SHA under test (never the host's own
    # possibly-stale localhost:3000).
    repo_dir_for_checkout = APP_REPO_DIR
    image_tag = f"pr-testing-sandbox:{_sanitize_path_component(branch)}-{sha[:12]}"
    sandbox_env = {
        "TEST_USER_EMAIL": test_user_email,
        "TEST_USER_PASSWORD": test_user_password,
    }

    t_journeys = time.monotonic()
    try:
        from agent.projects.registry import default_project_registry
        from agent.runner.queue import default_job_queue
        if record and default_job_queue.is_job_cancelled(record.run_id):
            logger.info("Run %s was cancelled/superseded before journeys started; terminating.", record.run_id)
            return {"status": "superseded", "error": "Run was superseded by a newer commit"}

        project_rec = default_project_registry.get_by_repo(f"{owner}/{repo}") or default_project_registry.get_by_repo(repo)
        project_settings = (project_rec.settings if project_rec else {}) or {}
        auto_repair_raw = project_settings.get("auto_repair", {})
        auto_repair_config = AutoRepairConfig(
            enabled=auto_repair_raw.get("enabled", False),
            trigger_mode=auto_repair_raw.get("trigger_mode", "automatic"),
            build_command=auto_repair_raw.get("build_command", project_settings.get("build_command", "npm run build")),
            test_command=auto_repair_raw.get("test_command", project_settings.get("test_command", "npm test")),
            max_steps=int(auto_repair_raw.get("max_steps", 10)),
            cost_limit_usd=float(auto_repair_raw.get("cost_limit_usd", 1.0)),
            custom_instructions=auto_repair_raw.get("custom_instructions", ""),
        )

        with _sandbox_for_sha(repo_dir_for_checkout, sha, image_tag, sandbox_env, run_id=record.run_id if record else None) as sandbox_base_url:
            journeys = await _run_journeys(
                base_url=sandbox_base_url,
                test_user_email=test_user_email,
                test_user_password=test_user_password,
                artifacts_dir=artifacts_dir,
                analysis=analysis,
                intents=intents,
                test_type=test_type,
                run_id=record.run_id,
                auto_repair_config=auto_repair_config,
            )
        timing["journeys_duration_s"] = round(time.monotonic() - t_journeys, 3)
    except (CheckoutError, SandboxBootError) as exc:
        logger.error("Pipeline aborted for run %s: sandbox failure: %s", record.run_id, exc)
        default_run_store.update(
            run_id=record.run_id,
            status="failed",
            result={"status": "error", "error": f"Sandbox failure: {exc}"},
            completed=True,
        )
        raise

    passed_journeys = journeys["passed_journeys"]
    failed_journeys = journeys["failed_journeys"]
    additional_findings = journeys["additional_findings"]
    remediation_prompts = journeys["remediation_prompts"]
    raw_journeys = journeys["raw_journeys"]
    login_result = journeys["login_result"]

    # 5. Baseline Comparison vs main
    from agent.runner.baseline import default_baseline_store

    if branch == base_branch:
        # This run IS the main/base branch — its own outcome becomes the new
        # baseline that subsequent PR runs compare against, instead of the
        # baseline staying frozen at its seeded defaults forever.
        default_baseline_store.update_baseline_from_run(repo=repo, journeys=raw_journeys)
        logger.info("Updated baseline for repo '%s' from base-branch run (%d journeys)", repo, len(raw_journeys))
    elif not default_baseline_store.has_baseline(repo):
        # No baseline recorded yet for this repo and this run is a PR (not
        # main itself) — refresh it now by running the same journeys against
        # an isolated sandbox built from base_branch, so the very first PR
        # comparison is against a real main-branch run rather than seeded
        # placeholder defaults.
        try:
            base_sha_res = subprocess.run(
                ["git", "rev-parse", base_branch],
                cwd=repo_dir_for_checkout,
                capture_output=True,
                text=True,
                timeout=30,
            )
            base_sha = base_sha_res.stdout.strip()
            if base_sha_res.returncode == 0 and base_sha:
                safe_base_branch = _sanitize_path_component(base_branch)
                baseline_image_tag = f"pr-testing-sandbox:{safe_base_branch}-{base_sha[:12]}"
                baseline_artifacts_dir = ARTIFACTS_BASE / f"{safe_base_branch}_{base_sha[:8]}_baseline"
                with _sandbox_for_sha(repo_dir_for_checkout, base_sha, baseline_image_tag, sandbox_env) as baseline_url:
                    baseline_journeys = await _run_journeys(
                        base_url=baseline_url,
                        test_user_email=test_user_email,
                        test_user_password=test_user_password,
                        artifacts_dir=baseline_artifacts_dir,
                        analysis=analysis,
                        intents=[],
                        test_type=test_type,
                        run_id=f"{record.run_id}_baseline",
                    )
                default_baseline_store.update_baseline_from_run(repo=repo, journeys=baseline_journeys["raw_journeys"])
                logger.info("Refreshed baseline for repo '%s' from live %s run (%d journeys)", repo, base_branch, len(baseline_journeys["raw_journeys"]))
            else:
                logger.warning("Could not resolve base_branch '%s' to a SHA; baseline comparison uses seeded defaults.", base_branch)
        except (CheckoutError, SandboxBootError, subprocess.SubprocessError) as exc:
            logger.warning("Baseline refresh against '%s' failed, comparison uses seeded/stale defaults: %s", base_branch, exc)

    baseline_comparison = default_baseline_store.compare(repo=repo, pr_journeys=raw_journeys)
    has_new_regressions = baseline_comparison["has_new_regressions"]

    overall_status = "failure" if has_new_regressions or failed_journeys else "success"
    logger.info("Pipeline completed: overall_status=%s (new_regressions=%s)", overall_status, has_new_regressions)

    # 6. Update Run Record with persistent Supabase Storage artifact URLs
    login_video_url = _artifact_url_for_file(login_result.video_path, record.run_id, "video")
    login_trace_url = _artifact_url_for_file(login_result.trace_path, record.run_id, "traces")

    journey_artifacts = [
        {
            "name": "login",
            "trace_url": login_trace_url,
            "video_url": login_video_url,
        }
    ]
    for ja in journeys["journey_artifacts"]:
        annotated_url = ja.get("annotated_screenshot_url") or _artifact_url_for_file(
            ja.get("annotated_screenshot_path"), record.run_id, "screenshots"
        )
        entry = {
            "name": ja["name"],
            "route": ja.get("route", ja["name"]),
            "trace_url": ja.get("trace_url"),
            "video_url": ja.get("video_url"),
            "dom_snapshot": ja.get("dom_snapshot", ""),
            "network_requests": ja.get("network_requests", []),
            "console_errors": ja.get("console_errors", []),
            "response_headers": ja.get("response_headers", {}),
            "duration_ms": ja.get("duration_ms", 1200.0),
        }
        if annotated_url:
            entry["annotated_screenshot_url"] = annotated_url
        journey_artifacts.append(entry)

    # Primary video & trace: prioritize the failing journey's recordings
    primary_video_url = login_video_url
    primary_trace_url = login_trace_url

    primary_screenshot_url = None
    for ja in journeys["journey_artifacts"]:
        if any(fj["name"] == ja["name"] for fj in failed_journeys):
            if ja.get("video_url"):
                primary_video_url = ja["video_url"]
            if ja.get("trace_url"):
                primary_trace_url = ja["trace_url"]
            if ja.get("annotated_screenshot_url") or ja.get("screenshot_url"):
                primary_screenshot_url = ja.get("annotated_screenshot_url") or ja.get("screenshot_url")
            break

    if not primary_video_url:
        for ja in journeys["journey_artifacts"]:
            if ja.get("video_url"):
                primary_video_url = ja["video_url"]
                break

    if not primary_screenshot_url:
        for ja in journeys["journey_artifacts"]:
            if ja.get("annotated_screenshot_url") or ja.get("screenshot_url"):
                primary_screenshot_url = ja.get("annotated_screenshot_url") or ja.get("screenshot_url")
                break

    # Calculate real quality dimensions & per-path analysis
    quality_report_obj = default_quality_evaluator.evaluate_run(
        run_record=record,
        journeys=journey_artifacts,
        repo_dir=str(repo_dir_for_checkout),
        git_diff=diff if "diff" in locals() else None,
    )
    quality_report = quality_report_obj.to_dict()

    run_result = {
        "status": overall_status,
        "risk_tag": analysis.risk_tag,
        "rationale": analysis.rationale,
        "affected_surfaces": analysis.affected_surfaces,
        "passed_journeys": passed_journeys,
        "failed_journeys": failed_journeys,
        "additional_findings": additional_findings,
        "baseline_comparison": baseline_comparison,
        "trace_url": primary_trace_url,
        "video_url": primary_video_url,
        "screenshot_url": primary_screenshot_url,
        "journey_artifacts": journey_artifacts,
        "remediation_prompts": remediation_prompts,
        "remediation_prompt": remediation_prompts[0] if remediation_prompts else None,
        "suggested_fixes": journeys.get("suggested_fixes", []),
        "fix_proposals": [fp.model_dump() for fp in journeys.get("fix_proposals", [])],
        "timing": timing,
        "quality_dimensions": quality_report,
        "per_path_analysis": quality_report.get("per_path_analysis", {}),
    }
    default_run_store.update(
        run_id=record.run_id,
        status="completed" if overall_status == "success" else "failed",
        result=run_result,
        completed=True,
        video_url=primary_video_url,
        trace_url=primary_trace_url,
    )

    # 7. Notify GitHub Check Run
    if check_run_id:
        conclusion = "success" if overall_status == "success" else "failure"
        summary = (
            f"Autonomous PR verification {conclusion.upper()}.\n"
            f"Risk: {analysis.risk_tag} | Passed: {len(passed_journeys)} | Failed: {len(failed_journeys)}"
        )
        detail_text = "\n\n".join(remediation_prompts) if remediation_prompts else "All user journeys verified clean."
        try:
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
        except GitHubNotConfiguredError as exc:
            logger.error("Could not update Check Run %s: %s", check_run_id, exc)

    # 8. Automatic Commit on Green Build if enabled and verified
    auto_committed = False
    if (
        auto_repair_config
        and auto_repair_config.enabled
        and auto_repair_config.trigger_mode == "automatic"
        and overall_status != "success"
        and pr_number
    ):
        proposals = journeys.get("fix_proposals", [])
        has_green_build = any(getattr(fp, "build_passed", False) for fp in proposals)
        suggested_fixes = journeys.get("suggested_fixes", [])
        if has_green_build and suggested_fixes:
            try:
                applied_files: list[str] = []
                for raw_fix in suggested_fixes:
                    patch = FilePatch(**raw_fix)
                    current_text, blob_sha = await github_client.get_file_content(
                        owner=owner,
                        repo=repo,
                        path=patch.file_path,
                        ref=branch,
                        installation_id=installation_id,
                    )
                    updated_text, ok = apply_patch_to_text(current_text, patch)
                    if ok:
                        commit_msg = f"fix(pr-agent): {patch.explanation} [skip-pr-agent]"
                        await github_client.update_file_content(
                            owner=owner,
                            repo=repo,
                            path=patch.file_path,
                            message=commit_msg,
                            content=updated_text,
                            sha=blob_sha,
                            branch=branch,
                            installation_id=installation_id,
                        )
                        applied_files.append(patch.file_path)
                if applied_files:
                    auto_committed = True
                    logger.info("Automatic commit on green build applied to: %s", applied_files)
            except Exception as auto_commit_exc:
                logger.warning("Automatic commit on green build could not complete: %s", auto_commit_exc)

    # 9. Post PR Comment if PR number provided
    if pr_number:
        comment_body = generate_pr_summary_comment(
            status=overall_status,
            passed_journeys=passed_journeys,
            failed_journeys=failed_journeys,
            analysis=analysis,
            remediation_prompts=remediation_prompts,
            additional_findings=additional_findings if additional_findings else None,
            branch=branch,
            fix_proposals=journeys.get("fix_proposals"),
            custom_secrets=[s for s in (test_user_email, test_user_password) if s],
            trigger_mode=auto_repair_config.trigger_mode if auto_repair_config else "manual_approval",
            auto_committed=auto_committed,
        )
        try:
            await github_client.post_pr_comment(
                owner=owner,
                repo=repo,
                pr_number=pr_number,
                body=comment_body,
                installation_id=installation_id,
            )
        except GitHubNotConfiguredError as exc:
            logger.error("Could not post PR comment on #%s: %s", pr_number, exc)

    return run_result
