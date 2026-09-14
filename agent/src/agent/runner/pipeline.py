"""Unified Autonomous PR Testing & Verification Pipeline."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
import threading
import time
from contextlib import asynccontextmanager, nullcontext
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agent.analyzer.dependency_graph import DependencyGraph
from agent.analyzer.diff_analyzer import AnalysisResult, DiffAnalyzer
from agent.analyzer.quality_dimensions import default_quality_evaluator
from agent.bridge.models import IntentEvent
from agent.credentials.redaction import redact_data
from agent.db.supabase import default_run_store
from agent.github.app import GitHubAppClient, GitHubNotConfiguredError
from agent.journeys.login import run_login_journey
from agent.journeys.scope_planner import PlannedRoute, ScopePlanner, TestingConfig
from agent.models.factory import normalize_model_id
from agent.models.usage import (
    UsageAccumulator,
    clear_usage_accumulator,
    install_usage_accumulator,
)
from agent.remediation.agentic_repair import AgenticRepairEngine, AutoRepairConfig
from agent.remediation.fix_synthesizer import (
    FilePatch,
    FixProposal,
    FixSynthesizer,
    apply_patch_to_text,
)
from agent.remediation.formatter import (
    generate_pr_summary_comment,
    generate_remediation_markdown,
)
from agent.sandbox.container_extract import extract_container_path
from agent.sandbox.docker_sandbox import (
    CloneError,
    SandboxBootError,
    _scrub_token,
    start_sandbox,
    stop_sandbox,
)

logger = logging.getLogger("agent.runner.pipeline")
ARTIFACTS_BASE = Path(os.environ.get("ARTIFACTS_BASE") or (Path(__file__).resolve().parents[3] / "artifacts" / "runs"))


_ADMIN_PATH_SEGMENT_RE = re.compile(r"(?:^|[/\\])admin(?:[/\\]|$)")


def decide_overall_status(
    *,
    journeys_executed: int,
    has_new_regressions: bool,
    failed_journeys: list[Any],
) -> str:
    """Resolve the run's outcome, including the zero-coverage gate.

    Returns one of ``success``, ``failure`` or ``inconclusive``.

    ``inconclusive`` means the run executed no journeys at all (nothing
    discovered, no credentials, or login disabled). It is intentionally a
    third value rather than ``success``: a run that verified nothing must not
    be able to post a green Check Run, but it is also not evidence of a
    regression, so it maps to GitHub's ``neutral`` conclusion.
    """
    if journeys_executed == 0:
        return "inconclusive"
    if has_new_regressions or failed_journeys:
        return "failure"
    return "success"


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
#
# `or` (not os.environ.get's default) is deliberate: .env ships the key as
# present-but-empty (`APP_REPO_DIR=`), and os.environ.get only applies its
# default when the key is absent. With a plain default the value became
# Path("") -> "", which resolves to the CWD (agent/) instead of web/, so route
# discovery found zero routes and every login/auth flow silently dropped out
# of the run. Same pattern as ARTIFACTS_BASE/RUNS_BASE in this codebase.
APP_REPO_DIR = Path(
    os.environ.get("APP_REPO_DIR") or (Path(__file__).resolve().parents[4] / "web")
)

# Set SANDBOX_MODE=disabled to fall back to hitting a locally-running app
# instance directly (useful for local development without Docker-in-Docker).
# Any other value (or unset, in a real deployment) requires real per-run
# container isolation — the pipeline refuses to silently test against
# whatever happens to be on localhost:3000.
SANDBOX_MODE = os.environ.get("SANDBOX_MODE", "docker")


@dataclass
class SandboxInfo:
    base_url: str
    # Name of the running sandbox container the PR was cloned into, or None when
    # SANDBOX_MODE=disabled (no container; journeys hit an already-running app).
    container_name: str | None

    def __iter__(self):
        return iter((self.base_url, self.container_name))

    def __str__(self) -> str:
        return self.base_url


@asynccontextmanager
async def _sandbox_for_sha(
    owner: str,
    repo: str,
    sha: str,
    base_branch: str,
    image_tag: str,
    env: dict[str, str],
    github_token: str | None = None,
    run_id: str | None = None,
    pr_number: int | None = None,
):
    """Boots an isolated container, clones `sha` into it in-container, provisions and
    launches it, and yields a SandboxInfo handle. Always tears the container down on exit,
    which destroys the only copy of the target repo's source.

    Nothing about the target repo is ever written to host disk: there is no host clone
    and no host `git worktree` any more. Blocking git/Docker work runs in background
    threads so the FastAPI event loop stays responsive.
    """
    mode = os.environ.get("SANDBOX_MODE", SANDBOX_MODE)
    if mode == "disabled":
        logger.warning(
            "SANDBOX_MODE=disabled: testing against http://localhost:3000 directly "
            "instead of an isolated per-run container. Not safe for untrusted PR code."
        )
        yield SandboxInfo(base_url="http://localhost:3000", container_name=None)
        return

    handle = await asyncio.to_thread(
        start_sandbox,
        owner=owner,
        repo=repo,
        sha=sha,
        base_ref=base_branch,
        image_tag=image_tag,
        github_token=github_token,
        env=env,
        pr_number=pr_number,
    )
    if run_id:
        from agent.runner.queue import default_job_queue
        default_job_queue.register_container(run_id, handle.container_name)
    try:
        yield SandboxInfo(base_url=handle.base_url, container_name=handle.container_name)
    finally:
        if run_id:
            from agent.runner.queue import default_job_queue
            default_job_queue.unregister_container(run_id)
        await asyncio.to_thread(stop_sandbox, handle.container_name)



class GitDiffError(RuntimeError):
    """Raised when the actual diff for a run cannot be determined.

    A prior version of this function silently substituted a hardcoded fake
    diff when git commands failed, which meant a broken git ref/environment
    would produce a plausible-looking but entirely synthetic risk analysis
    instead of surfacing the failure. Fail the run instead.
    """


def _looks_like_sha(value: str) -> bool:
    """True when a ref is already a (possibly abbreviated) commit SHA.

    A SHA resolves directly once its object is present, so there is no point
    probing `origin/<sha>` — and doing so would only add a failing git call.
    """
    candidate = value.strip()
    return len(candidate) >= 7 and all(c in "0123456789abcdefABCDEF" for c in candidate)


def _get_git_diff(
    container: str,
    base_ref: str = "main",
    head_ref: str = "HEAD",
    allow_parent_fallback: bool = True,
) -> str:
    """Extract git diff between base and head refs from inside the sandbox container.

    An empty diff (base_ref == head_ref, nothing changed) is a legitimate
    result and returned as such — only a git *failure* (bad ref, not a repo,
    git missing) raises.

    Runs against the in-container checkout (``/app``), so the diff describes the
    repo actually under test rather than any host directory.

    ``allow_parent_fallback`` gates the ``HEAD~1`` safety net used for a
    single-commit clone with no resolvable base. When the caller explicitly chose
    a diff base (a commit, or a commit-range start), falling back would silently
    describe the wrong change set, so the failure is raised instead.
    """
    def _exec_git(args: list[str]) -> str:
        res = subprocess.run(
            ["docker", "exec", "-w", "/app", container, "git", *args],
            capture_output=True,
            text=True,
            check=True,
        )
        return res.stdout

    # A bare branch name is not necessarily a local ref in the container: the
    # in-container clone fetches the base into `refs/remotes/origin/<ref>`, so
    # `main` may resolve to a stale local branch (or to nothing for an arbitrary
    # SHA/base that only exists as a remote-tracking ref). Try the explicit
    # remote-tracking form first, then the name as given (which is what covers a
    # full commit SHA, since fetching an object makes it addressable by SHA).
    candidates = [f"origin/{base_ref}", base_ref] if base_ref and not _looks_like_sha(base_ref) else [base_ref]
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            return _exec_git(["diff", f"{candidate}...{head_ref}"])
        except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc:
            last_error = exc

    if not allow_parent_fallback:
        raise GitDiffError(
            f"Could not compute git diff in container {container} for the requested "
            f"base {base_ref!r}...{head_ref}: {last_error}"
        ) from last_error

    try:
        return _exec_git(["diff", "HEAD~1"])
    except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc2:
        raise GitDiffError(
            f"Could not compute git diff in container {container} for {base_ref}...{head_ref}: {exc2}"
        ) from (last_error or exc2)


async def _extract_run_diff(
    container_name: str | None,
    base_branch: str,
    is_real_github_repo: bool,
    explicit_base: bool = False,
) -> str:
    """Extract the diff for this run from whichever code is actually under test.

    - Sandboxed: diff inside the running container (the PR's own checkout).
    - Not sandboxed: diff the local app repo (dev-only path).

    ``explicit_base`` marks a caller-chosen diff base, which disables the
    ``HEAD~1`` fallback so an unresolvable base fails loudly instead of quietly
    producing the wrong change set.
    """
    if explicit_base:
        # An explicit base disables the HEAD~1 safety net, so the extra argument
        # is only passed on that path.
        if container_name:
            return await asyncio.to_thread(
                _get_git_diff, container_name, base_branch, "HEAD", False
            )
        return await asyncio.to_thread(
            _get_git_diff_local, APP_REPO_DIR, base_branch, "HEAD", False
        )

    if container_name:
        return await asyncio.to_thread(_get_git_diff, container_name, base_branch)
    return await asyncio.to_thread(_get_git_diff_local, APP_REPO_DIR, base_branch)


def _get_git_diff_local(
    cwd: Path,
    base_ref: str = "main",
    head_ref: str = "HEAD",
    allow_parent_fallback: bool = True,
) -> str:
    """Host-path variant of :func:`_get_git_diff`, used when SANDBOX_MODE=disabled
    (no container exists to diff inside)."""
    candidates = [f"origin/{base_ref}", base_ref] if base_ref and not _looks_like_sha(base_ref) else [base_ref]
    last_error: Exception | None = None
    for candidate in candidates:
        try:
            res = subprocess.run(
                ["git", "diff", f"{candidate}...{head_ref}"],
                cwd=cwd,
                capture_output=True,
                text=True,
                check=True,
            )
            return res.stdout
        except (subprocess.SubprocessError, FileNotFoundError, OSError) as exc:
            last_error = exc

    if not allow_parent_fallback:
        raise GitDiffError(
            f"Could not compute git diff in {cwd} for the requested base "
            f"{base_ref!r}...{head_ref}: {last_error}"
        ) from last_error

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
        ) from (last_error or exc2)


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
    container_name: str | None = None,
) -> FixProposal | None:
    """Executes autonomous agentic repair with mini-swe-agent when enabled,
    verifying builds and enforcing guardrails, with graceful fallback to synthesizer.

    For containerized runs the repair executes inside the sandbox container, so the
    host-path existence check is skipped entirely (``/app`` is guaranteed to exist
    by the time journeys run).
    """
    repair_target_available = bool(container_name) or bool(source_root and source_root.exists())
    if auto_repair_config and auto_repair_config.enabled and repair_target_available:
        try:
            logger.info("Executing autonomous AgenticRepairEngine for '%s'...", journey_name)
            repair_engine = AgenticRepairEngine(config=auto_repair_config)
            repair_res = await asyncio.to_thread(
                repair_engine.run_repair,
                workspace_dir=source_root,
                container=container_name,
                journey_name=journey_name,
                error=error,
                analysis=analysis,
                intents=intents,
                dom_snapshot=dom_snapshot,
                custom_secrets=custom_secrets,
            )
            if repair_res and repair_res.success and repair_res.unified_diff.strip():
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
                                full_content=repair_res.file_contents.get(tf),
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
    return await asyncio.to_thread(
        synth.synthesize,
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
    source_root: Path | None = None,
    container_name: str | None = None,
    testing_config: TestingConfig | None = None,
    discovered_routes: list[str] | None = None,
    git_diff: str = "",
    route_fallback_root: Path | None = None,
    scope: str = "changed",
    change_impact: Any | None = None,
    deadline: float | None = None,
) -> dict[str, Any]:
    """Runs discovered route validation, login (if present), and autonomous exploratory
    journeys against `base_url`, returning collected results.

    ``scope`` is passed to the scope planner: ``"full"`` asks for a whole-app sweep
    (every discovered route, not just the diff-adjacent ones) while ``"changed"``
    lets the planner narrow to what the diff touched.

    ``change_impact`` (see ``agent.analyzer.change_impact``) can override both: it
    may pin the route list for a targeted change, mark the run as app-wide, or
    declare that nothing user-visible changed so no journeys should run at all.

    route_fallback_root: used only for local/in-repo runs. If the checkout under
    test yields no discoverable routes (e.g. a partial clone or a worktree whose
    app root was not detected), fall back to this directory's routes —
    otherwise login/auth flows silently drop out of the run entirely. Never set
    this for a real GitHub repo, where falling back would test the platform's
    own app against someone else's PR.
    """
    passed_journeys: list[str] = []
    failed_journeys: list[dict[str, Any]] = []
    additional_findings: list[str] = []
    remediation_prompts: list[str] = []
    raw_journeys: list[dict[str, Any]] = []
    fix_proposals: list[FixProposal] = []
    suggested_fixes: list[dict[str, Any]] = []

    # Nothing user-visible changed (docs, CI, lockfiles, API-only code). Running
    # journeys would burn a sandbox and tokens to produce a result unrelated to
    # the diff, so say so and stop. The build has already been verified by the
    # caller; this is a deliberate "not applicable", not a silent skip.
    if change_impact is not None and getattr(change_impact, "skip_journeys", False):
        logger.info("Skipping journeys: %s", change_impact.rationale)
        return {
            "passed_journeys": [],
            "failed_journeys": [],
            "additional_findings": [f"No journeys run — {change_impact.rationale}"],
            "remediation_prompts": [],
            "raw_journeys": [],
            "login_result": None,
            "journey_artifacts": [],
            "fix_proposals": [],
            "suggested_fixes": [],
            "agentic_session": None,
            "change_impact": change_impact.to_dict(),
        }

    target_source_root = source_root or APP_REPO_DIR

    # 1. Route Discovery: Static, from source if not already provided
    if discovered_routes is None:
        dep_graph = DependencyGraph(target_source_root)
        discovered_routes = dep_graph.discover_all_routes()

    if not discovered_routes and route_fallback_root is not None:
        fallback_routes = await asyncio.to_thread(
            DependencyGraph(route_fallback_root).discover_all_routes
        )
        if fallback_routes:
            logger.warning(
                "No routes discovered under %s; falling back to %s for route discovery (%d routes).",
                target_source_root,
                route_fallback_root,
                len(fallback_routes),
            )
            discovered_routes = fallback_routes

    custom_secrets = [s for s in (test_user_email, test_user_password) if s]
    fix_synthesizer = FixSynthesizer()

    # 2. Login-route detection: only run login journey if:
    #    a) An auth/login route exists in discovered routes
    #    b) Valid auth credentials (email and password) are provided
    #    c) The user wants the login flow (enable_login_flow=True and not instructed to skip)
    login_candidate_suffixes = ("/login", "/signin", "/sign-in", "/auth")
    has_login_route = any(
        r in ("/login", "/signin", "/sign-in", "/auth")
        or any(r.rstrip("/").endswith(s) for s in login_candidate_suffixes)
        for r in (discovered_routes or [])
    )

    has_auth_details = bool(
        test_user_email and test_user_password and test_user_email.strip() and test_user_password.strip()
    )

    instructions_text = (testing_config.testing_instructions if testing_config else "").lower()
    instructions_ask_skip_login = bool(
        re.search(
            r"\b(?:skip|no|disable|without|don'?t(?:\s+need)?|ignore)\s+(?:login|auth|authentication|signin|sign-in)\b",
            instructions_text,
        )
    )

    user_wants_login = (
        (testing_config.enable_login_flow if testing_config is not None else True)
        and not instructions_ask_skip_login
    )

    should_run_login = has_login_route and has_auth_details and user_wants_login

    login_result = None
    if should_run_login:
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
                source_root=target_source_root,
                custom_secrets=custom_secrets,
                fix_synthesizer=fix_synthesizer,
                auto_repair_config=auto_repair_config,
                container_name=container_name,
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
    else:
        reasons = []
        if not has_login_route:
            reasons.append("no login/auth route in discovered static routes")
        if not has_auth_details:
            reasons.append("no auth credentials (email/password) provided")
        if not user_wants_login:
            if instructions_ask_skip_login:
                reasons.append("testing instructions requested skipping login flow")
            else:
                reasons.append("login flow disabled in configuration")

        logger.info(
            "Skipping login journey entirely to prevent spurious errors (%s). Discovered routes: %s",
            ", ".join(reasons),
            discovered_routes,
        )

    from agent.journeys.browser_agent import run_route_journey

    storage_state_path = login_result.storage_state_path if login_result else None
    journey_artifacts: list[dict[str, Any]] = []

    # 3. Scope decision: mini-swe-agent as the planner.
    #
    # A classifier-chosen plan is deterministic: it already knows exactly which
    # routes the change can reach, so there is nothing for the planner to infer
    # (and no reason to pay a model call or accept its variance). Used for
    # targeted changes and the bounded "blast radius unknown" smoke test.
    planner = ScopePlanner(config=testing_config)
    classifier_routes = list(getattr(change_impact, "force_routes", None) or [])
    if classifier_routes:
        planned_routes = [
            PlannedRoute(route=r, focus=f"change impact: {change_impact.kind}")
            for r in classifier_routes
        ]
        logger.info(
            "Using classifier-selected routes (%s): %s", change_impact.kind, classifier_routes
        )
    else:
        planned_routes = []
        try:
            plan_res = await asyncio.to_thread(
                planner.plan_test_scope,
                workspace_dir=target_source_root,
                discovered_routes=discovered_routes or [],
                analysis=analysis,
                git_diff=git_diff,
                custom_secrets=custom_secrets,
                container=container_name,
                scope=scope,
            )
            if plan_res.success and plan_res.planned_routes:
                planned_routes = plan_res.planned_routes
                logger.info(
                    "Scope planner planned %d routes: %s",
                    len(planned_routes),
                    [p.route for p in planned_routes],
                )
        except Exception as exc:
            logger.warning(
                "Scope planning encountered error; will fallback to diff-derived routes: %s", exc
            )

    # Fallback to diff-derived exploratory routes if scope planner produced no routes or was unavailable
    if not planned_routes:
        fallback_routes: list[str] = []
        if scope == "full":
            # A full sweep does not depend on the diff: cover every discovered
            # route (bounded by the planner's cap) so "every page visit and
            # check" still holds when the planner is unavailable.
            fallback_routes = [
                r
                for r in (discovered_routes or [])
                if r.startswith("/") and r not in ("/login", "/auth")
            ]
            fallback_routes = list(dict.fromkeys(fallback_routes))[: max(1, testing_config.max_routes if testing_config else 15)]
        if not fallback_routes and analysis and analysis.affected_surfaces:
            for surf in analysis.affected_surfaces:
                if surf.startswith("/") and surf not in ("/login", "/auth"):
                    if surf not in fallback_routes:
                        fallback_routes.append(surf)
                elif "app/" in surf and "page.tsx" in surf:
                    parts = surf.split("app/")[-1].replace("/page.tsx", "").replace("page.tsx", "")
                    route = f"/{parts}".rstrip("/") or "/"
                    if route not in ("/login", "/auth") and route not in fallback_routes:
                        fallback_routes.append(route)
        if not fallback_routes and discovered_routes and "/" in discovered_routes:
            fallback_routes.append("/")
        planned_routes = [
            PlannedRoute(route=r, focus="full-sweep regression coverage" if scope == "full" else "diff-derived verification")
            for r in fallback_routes
        ]
        logger.info("Using fallback exploratory routes (%d, scope=%s): %s", len(planned_routes), scope, [p.route for p in planned_routes])

    # Cross-route control ledger: the header nav is the same control on every
    # page, so it is exercised once per sweep rather than once per route.
    covered_control_keys: set[str] = set()

    for p_route in planned_routes:
        route = p_route.route
        focus = p_route.focus
        if is_run_cancelled(run_id):
            logger.info("Run %s cancelled; skipping remaining %d route(s)", run_id, len(planned_routes) - len(raw_journeys))
            additional_findings.append("Run cancelled by user; remaining routes were skipped.")
            break
        route_budget = (
            float(testing_config.control_time_budget_seconds) if testing_config else 45.0
        )
        if deadline is not None:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= PIPELINE_REPORT_RESERVE_S:
                skipped = len(planned_routes) - len(raw_journeys)
                logger.warning(
                    "Pipeline time budget nearly exhausted (%.0fs left); stopping sweep with %d route(s) untested",
                    remaining,
                    skipped,
                )
                additional_findings.append(
                    f"Time budget exhausted before {skipped} route(s) could be tested."
                )
                break
            # No single route may eat the whole remaining budget; leave the
            # reporting reserve intact.
            route_budget = min(route_budget, max(5.0, remaining - PIPELINE_REPORT_RESERVE_S))
        logger.info("Executing exploratory journey for route %s (focus: %s)", route, focus)
        exp_res = await asyncio.to_thread(
            run_route_journey,
            route=route,
            base_url=base_url,
            artifacts_dir=artifacts_dir,
            test_type=test_type,
            storage_state=storage_state_path,
            risk_tag=analysis.risk_tag if analysis else "",
            covered_keys=covered_control_keys,
            max_controls=(testing_config.max_controls_per_route if testing_config else 40),
            control_time_budget_seconds=route_budget,
            should_abort=lambda: is_run_cancelled(run_id),
        )
        if exp_res.get("cancelled"):
            logger.info("Route %s aborted mid-journey because run %s was cancelled", route, run_id)
            additional_findings.append(f"Run cancelled by user during route {route}.")
            break
        coverage = exp_res.get("coverage") or {}
        covered_control_keys.update(coverage.get("covered_keys") or [])
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
            # Real browser measurements (None metrics stay None downstream).
            "web_vitals": exp_res.get("web_vitals"),
            "action_timings_ms": exp_res.get("action_timings_ms", []),
            # Navigation evidence: what was scrolled, which links were checked,
            # and which clicks actually moved the browser.
            "scroll_actions": exp_res.get("scroll_actions", 0),
            "links_checked": exp_res.get("links_checked", []),
            "broken_links": exp_res.get("broken_links", []),
            "navigation_checks": exp_res.get("navigation_checks", []),
            # Control coverage: how many of the controls actually discovered on
            # this route were operated, skipped, or unreachable. Without this
            # the PR report can never answer "was every button clicked?".
            "interactive_count": exp_res.get("interactive_count", 0),
            "coverage": coverage,
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
                source_root=source_root or APP_REPO_DIR,
                custom_secrets=custom_secrets,
                fix_synthesizer=fix_synthesizer,
                auto_repair_config=auto_repair_config,
                container_name=container_name,
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

    # Agentic exploration session: one continuous, human-looking browser
    # session in which the model chooses its own actions and keeps notes.
    #
    # It runs IN ADDITION to the deterministic journeys above, and its notes are
    # advisory only — they are surfaced as findings, but pass/fail is still
    # decided by hard signals (HTTP status, console errors, build, visual
    # defects). That keeps a run reproducible even though the exploration is
    # not: the same commit cannot flip from green to red on model whim.
    agentic_session: dict[str, Any] | None = None
    try:
        from agent.journeys.browser_agent import (
            agentic_exploration_enabled,
            estimate_session_budget,
            run_agentic_session,
        )

        if is_run_cancelled(run_id):
            logger.info("Skipping agentic exploration for run %s: cancelled", run_id)
        elif (
            deadline is not None
            and deadline - asyncio.get_running_loop().time() <= PIPELINE_REPORT_RESERVE_S
        ):
            logger.warning("Skipping agentic exploration for run %s: time budget exhausted", run_id)
        elif agentic_exploration_enabled(testing_config):
            session_budget = estimate_session_budget(planned_routes, testing_config)
            logger.info(
                "Starting agentic exploration session (%d routes, %d step budget) for %s",
                len(planned_routes),
                session_budget,
                base_url,
            )
            agentic_session = await asyncio.to_thread(
                run_agentic_session,
                base_url=base_url,
                seed_routes=[p.route for p in planned_routes],
                artifacts_dir=artifacts_dir / "agentic",
                config=testing_config,
                storage_state=storage_state_path,
                risk_tag=analysis.risk_tag if analysis else "",
                max_steps=session_budget,
                should_abort=lambda: is_run_cancelled(run_id),
            )
            for finding in agentic_session.get("findings", []):
                additional_findings.append(f"Agent note — {finding}")
            logger.info(
                "Agentic session finished: %d steps, %d pages, stop=%s, notes=%d",
                agentic_session.get("steps_used", 0),
                len(agentic_session.get("pages_visited", [])),
                agentic_session.get("stop_reason"),
                len(agentic_session.get("notes", [])),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Agentic exploration session skipped: %s", exc)
        agentic_session = None

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
        "agentic_session": agentic_session,
    }


# Hard ceiling on a single pipeline run (checkout + image build + sandbox
# boot + all journeys + baseline refresh). Runs are dispatched via
# background_tasks.add_task with no external supervisor watching them — a
# hung `docker build`, a wedged sandbox boot, or a stuck Playwright call
# would otherwise leave the run at status="running" forever with no
# indication anything is wrong.
PIPELINE_TIMEOUT_S = float(os.environ.get("PIPELINE_TIMEOUT_S", "900"))

# How much of the pipeline budget to keep in reserve for baseline comparison,
# report/check-run posting and artifact upload once the route sweep stops.
# Without a reserve, a sweep that runs to the hard timeout leaves nothing for
# the report and the run ends with no actionable result.
PIPELINE_REPORT_RESERVE_S = float(os.environ.get("PIPELINE_REPORT_RESERVE_S", "75"))

# Minimum remaining budget needed before the first-run baseline refresh is
# started. It boots a second sandbox and re-runs the whole sweep, so starting it
# with only a minute left guarantees the hard timeout fires with no report.
PIPELINE_BASELINE_MIN_BUDGET_S = float(os.environ.get("PIPELINE_BASELINE_MIN_BUDGET_S", "180"))

# How many characters of redacted build/boot output to persist with a failed
# run. This is what the dashboard's log viewer shows; it is deliberately much
# larger than the GitHub-comment tail so a build error is debuggable in the UI.
PIPELINE_BUILD_LOG_CHARS = int(os.environ.get("PIPELINE_BUILD_LOG_CHARS", "50000"))


def _deadline_exhausted(deadline: float | None, reserve: float | None = None) -> bool:
    """True when the pipeline should stop starting expensive new work.

    ``reserve`` overrides how much budget must remain; baseline refresh passes a
    larger reserve because it boots a second sandbox and re-runs the sweep.
    """
    if deadline is None:
        return False
    try:
        threshold = PIPELINE_REPORT_RESERVE_S if reserve is None else reserve
        return asyncio.get_running_loop().time() >= deadline - threshold
    except RuntimeError:
        return False


def _baseline_refresh_reserve(sweep_started_at: float) -> float:
    """How much budget must remain before an inline first-run baseline refresh starts.

    The refresh is a *second* full sandbox boot + route sweep, so it takes
    roughly as long as the PR sweep that just finished. The previous fixed
    ``PIPELINE_BASELINE_MIN_BUDGET_S`` floor (180s) let it start with only a few
    minutes left: the second sweep then ran into the hard pipeline timeout and
    took the whole run's report down with it, leaving the PR's GitHub Check Run
    ``in_progress`` forever. Requiring the elapsed sweep time (plus the normal
    reporting reserve) to still be available refuses work this run cannot
    finish — the base-branch run seeds the baseline instead.
    """
    elapsed = max(0.0, time.monotonic() - sweep_started_at)
    return max(PIPELINE_BASELINE_MIN_BUDGET_S, elapsed + PIPELINE_REPORT_RESERVE_S)


# ---------------------------------------------------------------------------
# Cooperative run cancellation
# ---------------------------------------------------------------------------
# A user can cancel a run from the dashboard. The pipeline spends most of its
# time inside synchronous Playwright calls dispatched with asyncio.to_thread;
# cancelling the asyncio task alone does not stop the thread, so the thread is
# given a cheap flag to poll between browser actions. The task handle is kept
# too, so a cancel can interrupt an await point (sandbox boot, model call)
# immediately rather than waiting for the next control loop.
_run_cancel_events: dict[str, threading.Event] = {}
_run_tasks: dict[str, asyncio.Task[Any]] = {}
_MAX_RETAINED_CANCEL_TOKENS = 200


def register_run_cancel_token(run_id: str) -> None:
    """Track the running task for ``run_id`` so it can be cancelled from the API."""
    _run_cancel_events.setdefault(run_id, threading.Event())
    task = asyncio.current_task()
    if task is not None:
        _run_tasks[run_id] = task


def clear_run_cancel_token(run_id: str | None) -> None:
    if not run_id:
        return
    _run_tasks.pop(run_id, None)
    event = _run_cancel_events.get(run_id)
    # A set event is deliberately retained: a to_thread worker (Playwright) can
    # outlive the cancelled coroutine, and it still needs to observe the
    # cancellation on its next cooperative check.
    if event is not None and not event.is_set():
        _run_cancel_events.pop(run_id, None)
    # Bound the retained set so a long-lived process cannot grow it forever.
    while len(_run_cancel_events) > _MAX_RETAINED_CANCEL_TOKENS:
        _run_cancel_events.pop(next(iter(_run_cancel_events)), None)


def signal_run_cancel(run_id: str | None) -> None:
    """Set the cooperative cancel flag without touching the task handle."""
    if not run_id:
        return
    _run_cancel_events.setdefault(run_id, threading.Event()).set()


def is_run_cancelled(run_id: str | None) -> bool:
    """Cooperative check used both on the event loop and inside worker threads."""
    if not run_id:
        return False
    event = _run_cancel_events.get(run_id)
    if event is not None and event.is_set():
        return True
    # Queue-backed jobs also carry a status the pipeline can observe.
    try:
        from agent.runner.queue import default_job_queue

        return default_job_queue.is_job_cancelled(run_id)
    except Exception:  # noqa: BLE001
        return False


def request_run_cancel(run_id: str, reason: str = "Cancelled by user") -> bool:
    """Signal cancellation for a run. Returns True if a live run was signalled."""
    signal_run_cancel(run_id)
    task = _run_tasks.get(run_id)
    if task is not None and not task.done():
        try:
            task.get_loop().call_soon_threadsafe(task.cancel)
        except RuntimeError:
            task.cancel()
        logger.info("Cancellation requested for run %s: %s", run_id, reason)
        return True
    return False


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
    diff_base: str | None = None,
    update_baseline: bool = True,
    forced_routes: list[str] | None = None,
    post_comments: bool = True,
) -> dict[str, Any]:
    """Execute complete end-to-end verification pipeline, with a timeout and
    catch-all failure handling so a run can never get stuck at "running"
    forever — see _run_pipeline_inner for the actual pipeline steps.

    ``diff_base`` selects the ref the change set is computed against (the first-
    run briefing's "only this commit" / "this commit range" modes). It never
    changes which commit is built and tested (``sha``) or what the baseline is
    compared against (``base_branch``).

    ``forced_routes`` pins the run to specific routes (an on-demand
    "inspect /checkout" request). It bypasses the diff-derived route selection,
    but never the discovered-route allowlist: a route that does not exist in the
    app is still dropped rather than invented.
    """
    if run_id:
        register_run_cancel_token(run_id)

    # Per-project override of the hard pipeline timeout, set in project
    # settings (Settings > Job Timeout). Falls back to the env-configured
    # default when the project has no override or isn't registered.
    pipeline_timeout_s = PIPELINE_TIMEOUT_S
    try:
        from agent.projects.registry import default_project_registry

        project_rec = default_project_registry.get_by_repo(f"{owner}/{repo}") or default_project_registry.get_by_repo(repo)
        raw_timeout = (project_rec.settings or {}).get("pipeline_timeout_s") if project_rec else None
        if raw_timeout is not None:
            pipeline_timeout_s = float(raw_timeout)
    except Exception:  # noqa: BLE001
        logger.warning("Failed to load pipeline_timeout_s override for %s/%s; using default", owner, repo, exc_info=True)

    deadline = asyncio.get_running_loop().time() + pipeline_timeout_s
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
                diff_base=diff_base,
                update_baseline=update_baseline,
                forced_routes=forced_routes,
                post_comments=post_comments,
                deadline=deadline,
            ),
            timeout=pipeline_timeout_s,
        )
    except asyncio.CancelledError:
        if run_id and is_run_cancelled(run_id):
            logger.info("Pipeline for %s/%s branch=%s sha=%s cancelled by user", owner, repo, branch, sha[:8])
            _mark_run_failed_by_lookup(
                branch, sha, scope, test_type, run_id, "Cancelled by user", status="cancelled"
            )
        raise
    except TimeoutError:
        logger.error("Pipeline for %s/%s branch=%s sha=%s timed out after %ss", owner, repo, branch, sha[:8], pipeline_timeout_s)
        # Tell any to_thread worker still running inside the timed-out coroutine
        # to abort at its next cooperative check, rather than leaving it to
        # fight a torn-down sandbox.
        signal_run_cancel(run_id)
        _mark_run_failed_by_lookup(branch, sha, scope, test_type, run_id, f"Pipeline timed out after {pipeline_timeout_s:.0f}s")
        await _notify_run_aborted(
            owner=owner,
            repo=repo,
            sha=sha,
            pr_number=pr_number,
            check_run_id=check_run_id,
            installation_id=installation_id,
            post_comments=post_comments,
            message=(
                f"The autonomous verification run for `{sha[:8]}` timed out after "
                f"{pipeline_timeout_s:.0f}s and was aborted without a result. "
                "Re-run it, or raise the project's Job Timeout in Settings if the "
                "app under test is genuinely slow to build and sweep."
            ),
            title="Autonomous Verification: Timed out",
        )
        raise
    except Exception as exc:  # noqa: BLE001
        # Catch-all: any error not already handled by a specific except
        # clause inside _run_pipeline_inner still must not leave the run
        # record stuck at "running" with no explanation.
        logger.exception("Unhandled pipeline error for %s/%s branch=%s sha=%s", owner, repo, branch, sha[:8])
        _mark_run_failed_by_lookup(branch, sha, scope, test_type, run_id, f"Unhandled pipeline error: {exc}")
        await _notify_run_aborted(
            owner=owner,
            repo=repo,
            sha=sha,
            pr_number=pr_number,
            check_run_id=check_run_id,
            installation_id=installation_id,
            post_comments=post_comments,
            message=(
                f"The autonomous verification run for `{sha[:8]}` failed before it "
                f"could report a result: `{exc}`"
            ),
        )
        raise
    finally:
        clear_run_cancel_token(run_id)


def _mark_run_failed_by_lookup(
    branch: str, sha: str, scope: str, test_type: str, run_id: str | None, error: str,
    status: str = "failed",
) -> None:
    """Best-effort: find (or accept the given) run record and mark it failed/cancelled.
    Used by run_pipeline's outer timeout/catch-all, which may fire before
    _run_pipeline_inner ever created or fetched a record itself."""
    try:
        record = default_run_store.get(run_id) if run_id else None
        if not record:
            record = default_run_store.find_latest_by_sha(branch=branch, sha=sha, scope=scope, test_type=test_type)
        if record and record.status not in ("completed", "failed", "cancelled"):
            default_run_store.update(
                run_id=record.run_id,
                status=status,
                result={
                    "status": "error" if status == "failed" else "cancelled",
                    "error": error,
                    "build_log": error,
                },
                completed=True,
            )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to mark run as failed after pipeline error")


async def _notify_run_aborted(
    *,
    owner: str,
    repo: str,
    sha: str,
    pr_number: int | None,
    check_run_id: int | None,
    installation_id: int | None,
    post_comments: bool,
    message: str,
    title: str = "Autonomous Verification: Failed",
) -> None:
    """Best-effort: settle the GitHub Check Run and PR when the pipeline is
    killed by its own timeout or catch-all.

    A PR-triggered run that hits ``PIPELINE_TIMEOUT_S`` is marked failed in the
    dashboard by ``_mark_run_failed_by_lookup``, but the Check Run created when
    the webhook arrived is never completed — so from the pull request's point of
    view the verification job runs forever. Complete it (and leave a short
    comment) so a hung run is visibly a *finished failure*, not a job that never
    ends.
    """
    if not check_run_id and not (pr_number and post_comments):
        return
    try:
        from agent.github.app import GitHubAppClient

        client = GitHubAppClient()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not build GitHub client to report aborted run: %s", exc)
        return

    if check_run_id:
        try:
            await client.update_check_run(
                owner=owner,
                repo=repo,
                check_run_id=check_run_id,
                conclusion="failure",
                title=title,
                summary=message,
                installation_id=installation_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not complete Check Run %s after abort: %s", check_run_id, exc)

    if pr_number and post_comments:
        try:
            await client.post_pr_comment(
                owner=owner,
                repo=repo,
                pr_number=pr_number,
                body=f"⚠️ {message}",
                installation_id=installation_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not comment on PR #%s after abort: %s", pr_number, exc)


async def _report_boot_failure(
    *,
    step: str,
    safe_error: str,
    run_id: str,
    owner: str,
    repo: str,
    branch: str,
    sha: str,
    base_branch: str,
    pr_number: int | None,
    check_run_id: int | None,
    installation_id: int | None,
    github_client: GitHubAppClient,
    post_comments: bool,
    secrets: list[str] | None = None,
    log: str | None = None,
) -> None:
    """Record a build/boot failure as a real, reported PR result.

    Without this, a build failure marked the run failed in the dashboard but the
    GitHub Check Run stayed ``in_progress`` forever and no comment explained why:
    the code that completes the check and posts the summary sat *after* the
    ``raise`` for this path. A change that does not build is a critical result,
    not a silent one.
    """
    from agent.db.pr_insights import default_pr_insight_store
    from agent.runner.test_cases import fingerprint

    redacted_output = redact_data(safe_error, secrets or [])
    # The full captured output, not just the exception tail. Bounded so a
    # pathological build cannot bloat every run row.
    redacted_log = redact_data(log or safe_error, secrets or [])
    build_log = redacted_log[-PIPELINE_BUILD_LOG_CHARS:]
    label = {
        "clone": "Repository checkout",
        "dependency_install": "Dependency install",
        "build": "Build",
        "app_start": "Application start",
        "provision": "Environment provisioning",
    }.get(step, "Build")

    test_case = {
        "name": f"{label} failed",
        "route": None,
        "status": "failed",
        "category": "build",
        "severity": "critical",
        "impact": (
            "The application could not be built, so no user flow could be verified. "
            "Nothing downstream of the build was tested."
        ),
        "failure_reason": redacted_output[-2000:],
        "reproduction_steps": [
            "Check out the tested commit.",
            "Run the project's install and build commands as configured.",
            "The failure reproduces in the build output below.",
        ],
        "code_analysis": [],
        "mock_context": [],
        "evidence": {"build_output": build_log},
        "origin": "new",
        "verified_this_commit": True,
        "pr_number": pr_number,
    }
    severity_summary = {
        "counts": {"critical": 1, "high": 0, "medium": 0, "low": 0},
        "highest": "critical",
        "total_cases": 1,
        "passed": 0,
        "failed": 1,
        "skipped": 0,
        "carried_forward": 0,
        "carried_forward_failing": 0,
        "additional_findings": 0,
        "all_passed": False,
    }
    failure_findings = [
        {
            "fingerprint": fingerprint(None, "build", redacted_output),
            "severity": "critical",
            "category": "build",
            "title": f"{label} failed",
            "detail": redacted_output[-2000:],
            "route": None,
        }
    ]

    default_run_store.update(
        run_id=run_id,
        status="failed",
        result={
            "status": "error",
            "error": f"{label} failure: {redacted_output}",
            "failure_kind": step,
            "build_log": build_log,
            "test_cases": [test_case],
            "severity_summary": severity_summary,
            "coverage_gate": "no_journeys",
            "journeys_executed": 0,
            "owner": owner,
            "repo": repo,
            "branch": branch,
            "installation_id": installation_id,
        },
        completed=True,
    )

    repo_full_name = f"{owner}/{repo}" if owner and repo else repo
    try:
        default_pr_insight_store.record_run_result(
            repo_full_name=repo_full_name,
            run_id=run_id,
            pr_number=pr_number,
            test_cases=[test_case],
            findings=failure_findings,
            head_sha=sha,
            base_branch=base_branch,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist build-failure result for %s: %s", run_id, exc)

    if check_run_id:
        try:
            await github_client.update_check_run(
                owner=owner,
                repo=repo,
                check_run_id=check_run_id,
                conclusion="failure",
                title=f"Autonomous Verification: {label} failed",
                summary=(
                    f"Autonomous PR verification FAILED at the {label.lower()} step.\n"
                    "No user journeys were run because the application could not be built.\n"
                    f"Commit: {sha[:8]}"
                ),
                text=f"```\n{redacted_output[-6000:]}\n```",
                installation_id=installation_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not complete Check Run %s after boot failure: %s", check_run_id, exc)

    if pr_number and post_comments:
        comment = (
            f"### ❌ Verification failed — {label.lower()}\n\n"
            f"The application could not be built from `{sha[:8]}`, so no user journeys were run. "
            "This is reported as a critical failure rather than a clean run.\n\n"
            "<details><summary>Build output (tail)</summary>\n\n"
            f"```\n{redacted_output[-6000:]}\n```\n\n</details>"
        )
        try:
            await github_client.post_pr_comment(
                owner=owner,
                repo=repo,
                pr_number=pr_number,
                body=comment,
                installation_id=installation_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not post build-failure comment on #%s: %s", pr_number, exc)


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
    diff_base: str | None = None,
    update_baseline: bool = True,
    forced_routes: list[str] | None = None,
    post_comments: bool = True,
    deadline: float | None = None,
) -> dict[str, Any]:
    """Execute complete end-to-end verification pipeline.

    ``deadline`` is an ``asyncio`` loop-clock time by which the run should stop
    starting new work, so the route sweep can bail out before the outer hard
    timeout kills the whole thing with no report.
    """
    intents = intents or []
    github_client = GitHubAppClient()
    artifacts_dir = ARTIFACTS_BASE / f"{_sanitize_path_component(branch)}_{sha[:8]}"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    # The diff base is what the change set is computed against. It defaults to
    # the base branch; the first-run briefing overrides it to isolate a single
    # commit or a range of commits. The baseline comparison below still uses
    # `base_branch` so "new regression vs main" keeps its meaning.
    effective_diff_base = (diff_base or base_branch).strip() or base_branch
    explicit_diff_base = bool(diff_base and diff_base.strip())

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

    # 2. Resolve the GitHub token up front — it is needed to boot the sandbox,
    #    which now clones the repo in-container (no host clone happens at all).
    #    For local/in-repo runs no clone is needed, so no token is fetched.
    #
    #    Ownership alone decides this. An earlier version also treated
    #    repo == "web" as the local demo app, hardcoding the platform's own
    #    directory name into the decision, so a real GitHub repo named "web" was
    #    silently never cloned and got tested against the local checkout instead.
    is_real_github_repo = owner not in ("local", "default", "") and repo not in ("default", "")
    github_token: str | None = None
    if is_real_github_repo:
        try:
            from agent.github.app import GitHubAppClient as _GAC
            _gc = _GAC()
            github_token = _gc.token
            if not github_token and installation_id:
                # get_installation_token is async — awaiting it directly is
                # required. Wrapping it in asyncio.to_thread handed back an
                # un-awaited coroutine, so github_token was never a usable
                # string and the sandbox clone had no credentials.
                github_token = await _gc.get_installation_token(installation_id)
        except Exception as exc:  # noqa: BLE001
            logger.debug("GitHub token resolution skipped: %s", exc)

    # 3. Create or fetch run record in store & set running (before any step that
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

    # 4. Boot the sandbox, then do diff extraction + route discovery + analysis
    #    against the code *inside it*. These used to run against APP_REPO_DIR
    #    before the sandbox existed, which meant the diff, affected surfaces and
    #    risk tag described the platform's own web/ app rather than the PR.
    image_tag = f"pr-testing-sandbox:{_sanitize_path_component(branch)}-{sha[:12]}"
    sandbox_env = {
        "TEST_USER_EMAIL": test_user_email,
        "TEST_USER_PASSWORD": test_user_password,
    }
    # Values loaded from the repository's Context & Secrets. Secrets are added
    # here so they can be injected into the sandbox, and are also merged into the
    # redaction list once it is built, so they cannot reach an artifact or a
    # prompt.
    context_secret_values: list[str] = []

    t_analysis = time.monotonic()
    # Reassigned once the analysis phase really ends (just before journeys run).
    # Previously both timers started here, so "analysis" and "journeys" always
    # reported the same number, and no total was reported at all.
    t_journeys = t_analysis
    usage_accumulator: UsageAccumulator | None = None
    # Populated inside the sandbox block; declared here so the result assembly
    # below cannot hit an unbound name if a step before it raised.
    change_impact: Any | None = None
    effective_scope = scope
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
            wall_time_limit_seconds=int(auto_repair_raw.get("wall_time_limit_seconds", 180)),
            custom_instructions=auto_repair_raw.get("custom_instructions", ""),
            # Upgrade a retired model id saved in project settings.
            model_name=normalize_model_id(auto_repair_raw.get("model_name")),
            env_vars=auto_repair_raw.get("env_vars", {}),
        )

        testing_raw = project_settings.get("testing", {})
        # Per-repository Context & Secrets. Variables and seed data are surfaced
        # to the planning agent as plain-English context; secret values are
        # never included here — they are decrypted only for environment
        # injection and redaction.
        from agent.projects.context import load_project_context

        project_context = load_project_context(f"{owner}/{repo}")

        # Inject the repository's variables and secrets into the test container
        # as environment variables. Secrets are decrypted only here and only for
        # this purpose. Names are validated so a malformed key cannot corrupt the
        # container environment.
        for _ctx_name, _ctx_value in {**project_context.variables, **project_context.secrets}.items():
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", _ctx_name or ""):
                sandbox_env[_ctx_name] = _ctx_value
        context_secret_values.extend(project_context.secrets.values())

        _base_instructions = testing_raw.get(
            "testing_instructions",
            project_settings.get("testing_instructions", ""),
        )
        _context_lines = project_context.prompt_lines()
        if _context_lines:
            _base_instructions = (
                (_base_instructions + "\n\n" if _base_instructions else "")
                + "Repository context provided by the team:\n"
                + "\n".join(_context_lines)
            )

        # Saved tests are the repository's opt-in regression suite. They are
        # injected as required coverage so a flow someone chose to protect keeps
        # being exercised on every run, not just the run that discovered it.
        from agent.projects.saved_tests import as_instruction_lines, load_saved_tests

        _saved_tests = load_saved_tests(f"{owner}/{repo}")
        _saved_lines = as_instruction_lines(_saved_tests)
        if _saved_lines:
            _base_instructions = (
                (_base_instructions + "\n\n" if _base_instructions else "")
                + "It is a requirement that these saved regression tests are exercised:\n"
                + "\n".join(_saved_lines)
            )
            logger.info("Injecting %d saved regression test(s) into the plan", len(_saved_lines))

        # The planner field is bounded; a long suite must not raise a validation
        # error at run time.
        _base_instructions = _base_instructions[:4000]

        testing_config = TestingConfig(
            testing_instructions=_base_instructions,
            enable_login_flow=bool(
                testing_raw.get("enable_login_flow", project_settings.get("enable_login_flow", True))
            ),
            max_routes=int(testing_raw.get("max_routes", 15)),
            model_name=normalize_model_id(testing_raw.get("model_name")),
            agentic_exploration=bool(
                testing_raw.get("agentic_exploration", project_settings.get("agentic_exploration", True))
            ),
        )

        async with _sandbox_for_sha(
            owner=owner,
            repo=repo,
            sha=sha,
            base_branch=effective_diff_base,
            image_tag=image_tag,
            env=sandbox_env,
            github_token=github_token,
            run_id=record.run_id if record else None,
            # The PR number lets a fork PR's head commit be fetched from
            # refs/pull/<n>/head, which a plain clone of the base repo cannot see.
            pr_number=pr_number,
        ) as sandbox_info:
            container_name = sandbox_info.container_name
            active_source_root = APP_REPO_DIR

            # 4a. Diff — against the in-container checkout when sandboxed.
            diff = await _extract_run_diff(
                container_name,
                effective_diff_base,
                is_real_github_repo,
                explicit_base=explicit_diff_base,
            )
            changed_files = [f for it in intents for f in it.files]
            for df in re.findall(r"^\+\+\+ b/(.+)$", diff, re.MULTILINE):
                if df not in changed_files:
                    changed_files.append(df)

            # 4b. Route discovery + downstream blast radius, against the same
            #     code. Container paths are read through a short-lived, deleted
            #     extraction so DependencyGraph keeps its plain Path interface.
            #     The extraction stays open for the whole analysis + journey
            #     phase: nothing executes against it, but the planners read it.
            source_view = (
                extract_container_path(container_name, "/app")
                if container_name
                else nullcontext(APP_REPO_DIR)
            )
            with source_view as local_app:
                active_source_root = local_app
                dep_graph = DependencyGraph(local_app)
                downstream_surfaces = await asyncio.to_thread(
                    dep_graph.find_affected_routes, changed_files
                )
                discovered_routes = await asyncio.to_thread(dep_graph.discover_all_routes)

                # Decide what this change set can actually affect BEFORE any route
                # is planned. Mapping files straight to routes conflated "affects
                # every page" (a root layout is imported by no page) with "affects
                # nothing" (a README), and left a docs-only diff being tested
                # against arbitrary pages or reported as a bare "inconclusive".
                from agent.analyzer.change_impact import classify_change_impact

                change_impact = await asyncio.to_thread(
                    classify_change_impact,
                    changed_files,
                    dep_graph,
                    discovered_routes,
                    scope,
                )
                if forced_routes:
                    # An explicit "inspect these routes" request wins over the
                    # diff-derived selection. The discovered-route allowlist is
                    # still enforced downstream, so a route that does not exist
                    # in the app is dropped rather than invented.
                    change_impact.kind = "targeted"
                    change_impact.rationale = (
                        "On-demand inspection requested for "
                        + ", ".join(forced_routes)
                    )
                    change_impact.routes = list(forced_routes)
                    change_impact.force_routes = list(forced_routes)
                    change_impact.force_full_sweep = False
                    change_impact.skip_journeys = False
                effective_scope = "full" if change_impact.force_full_sweep else scope
                logger.info(
                    "Change impact: kind=%s scope=%s->%s routes=%s",
                    change_impact.kind,
                    scope,
                    effective_scope,
                    change_impact.routes or change_impact.force_routes,
                )

                if downstream_surfaces:
                    logger.info("Dependency graph found %d downstream route(s): %s", len(downstream_surfaces), downstream_surfaces)
                if discovered_routes:
                    logger.info("Discovered %d static route(s): %s", len(discovered_routes), discovered_routes)

                # Start metering real Strands LLM usage for this run. Any agent
                # created from here on (diff analysis, navigation, visual
                # inspection, repair) registers its provider-reported token
                # usage with this accumulator.
                usage_accumulator = UsageAccumulator()
                install_usage_accumulator(usage_accumulator)
                analyzer = DiffAnalyzer()
                analysis: AnalysisResult = await asyncio.to_thread(
                    analyzer.analyze, diff, intents, downstream_surfaces=downstream_surfaces
                )
                logger.info("Analysis: risk=%s, affected=%s", analysis.risk_tag, analysis.affected_surfaces)

                # Analysis phase (sandbox boot + diff + route discovery + risk
                # analysis) ends here; journeys begin. Splitting the timers here
                # makes the latency breakdown describe real phases.
                t_journeys = time.monotonic()

                # 4c. Journeys, against the running sandbox app.
                journeys = await _run_journeys(
                    base_url=str(sandbox_info),
                    test_user_email=test_user_email,
                    test_user_password=test_user_password,
                    artifacts_dir=artifacts_dir,
                    analysis=analysis,
                    intents=intents,
                    test_type=test_type,
                    run_id=record.run_id,
                    auto_repair_config=auto_repair_config,
                    source_root=active_source_root,
                    container_name=container_name,
                    testing_config=testing_config,
                    discovered_routes=discovered_routes,
                    git_diff=diff,
                    route_fallback_root=None if (is_real_github_repo or container_name) else APP_REPO_DIR,
                    scope=effective_scope,
                    change_impact=change_impact,
                    deadline=deadline,
                )
        t_end = time.monotonic()
        timing: dict[str, float] = {
            "analysis_duration_s": round(t_journeys - t_analysis, 3),
            "journeys_duration_s": round(t_end - t_journeys, 3),
            "total_duration_s": round(t_end - t_analysis, 3),
        }
    except (CloneError, SandboxBootError) as exc:
        # Defense in depth: the GitHub token is injected into the container at
        # boot, so scrub it from any error text before that text is persisted to
        # the run store or surfaced to the dashboard.
        safe_error = _scrub_token(str(exc), github_token)
        # The sandbox attaches the untruncated command output; keep it so the
        # dashboard can show the same build log a developer would see in CI.
        safe_log = _scrub_token(getattr(exc, "log", "") or str(exc), github_token)
        step = getattr(exc, "step", None) or ("clone" if isinstance(exc, CloneError) else "build")
        logger.error("Pipeline aborted for run %s at %s: %s", record.run_id, step, safe_error)
        clear_usage_accumulator()
        await _report_boot_failure(
            step=step,
            safe_error=safe_error,
            log=safe_log,
            run_id=record.run_id,
            owner=owner,
            repo=repo,
            branch=branch,
            sha=sha,
            base_branch=base_branch,
            pr_number=pr_number,
            check_run_id=check_run_id,
            installation_id=installation_id,
            github_client=github_client,
            post_comments=post_comments,
            secrets=context_secret_values,
        )
        raise

    passed_journeys = journeys["passed_journeys"]
    failed_journeys = journeys["failed_journeys"]
    additional_findings = journeys["additional_findings"]
    remediation_prompts = journeys["remediation_prompts"]
    raw_journeys = journeys["raw_journeys"]
    login_result = journeys["login_result"]

    # A user cancel that lands between journey completion and reporting should
    # stop here rather than spending more model calls and posting a result the
    # user asked us to abandon.
    if is_run_cancelled(record.run_id):
        logger.info("Run %s cancelled by user; skipping baseline comparison and reporting", record.run_id)
        default_run_store.update(
            run_id=record.run_id,
            status="cancelled",
            result={
                "status": "cancelled",
                "error": "Cancelled by user",
                "journey_artifacts": journeys["journey_artifacts"],
            },
            completed=True,
        )
        if check_run_id:
            try:
                await github_client.update_check_run(
                    owner=owner,
                    repo=repo,
                    check_run_id=check_run_id,
                    conclusion="cancelled",
                    title="Autonomous Verification: Cancelled",
                    summary="This verification run was cancelled before it completed.",
                    installation_id=installation_id,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not mark Check Run %s cancelled: %s", check_run_id, exc)
        return {"status": "cancelled", "error": "Cancelled by user"}

    # 5. Baseline Comparison vs main
    from agent.runner.baseline import default_baseline_store

    if not update_baseline:
        # An explicit commit/range verification describes the repo as it was at
        # that point, not as it is now, so it must not redefine what "main"
        # looks like for future PR comparisons.
        logger.info(
            "Baseline left unchanged: run targets an explicit commit/range (repo=%s, branch=%s).",
            repo,
            branch,
        )
    elif branch == base_branch:
        # This run IS the main/base branch — its own outcome becomes the new
        # baseline that subsequent PR runs compare against, instead of the
        # baseline staying frozen at its seeded defaults forever.
        default_baseline_store.update_baseline_from_run(repo=repo, journeys=raw_journeys)
        logger.info("Updated baseline for repo '%s' from base-branch run (%d journeys)", repo, len(raw_journeys))
    elif is_run_cancelled(record.run_id) or _deadline_exhausted(
        deadline, reserve=_baseline_refresh_reserve(t_analysis)
    ):
        logger.warning(
            "Skipping first-run baseline refresh for repo '%s': run cancelled or out of time. "
            "Comparison uses the seeded/stale baseline.",
            repo,
        )
    elif not default_baseline_store.has_baseline(repo):
        # No baseline recorded yet for this repo and this run is a PR (not
        # main itself) — refresh it now by running the same journeys against
        # an isolated sandbox built from base_branch, so the very first PR
        # comparison is against a real main-branch run rather than seeded
        # placeholder defaults.
        try:
            # The PR sandbox already fetched base_branch as a remote-tracking
            # ref during its in-container clone, so resolve the base SHA there.
            # With no container (SANDBOX_MODE=disabled), fall back to the host app
            # repo — the non-containerized dev path.
            if container_name:
                base_sha_res = await asyncio.to_thread(
                    subprocess.run,
                    ["docker", "exec", "-w", "/app", container_name,
                     "git", "rev-parse", f"origin/{base_branch}"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            else:
                base_sha_res = await asyncio.to_thread(
                    subprocess.run,
                    ["git", "rev-parse", base_branch],
                    cwd=APP_REPO_DIR,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            base_sha = base_sha_res.stdout.strip()
            if base_sha_res.returncode == 0 and base_sha:
                safe_base_branch = _sanitize_path_component(base_branch)
                baseline_image_tag = f"pr-testing-sandbox:{safe_base_branch}-{base_sha[:12]}"
                baseline_artifacts_dir = ARTIFACTS_BASE / f"{safe_base_branch}_{base_sha[:8]}_baseline"
                async with _sandbox_for_sha(
                    owner=owner,
                    repo=repo,
                    sha=base_sha,
                    base_branch=base_branch,
                    image_tag=baseline_image_tag,
                    env=sandbox_env,
                    github_token=github_token,
                    run_id=f"{record.run_id}_baseline",
                ) as baseline_info:
                    base_container = baseline_info.container_name
                    base_active_source = APP_REPO_DIR
                    if base_container:
                        with extract_container_path(base_container, "/app") as base_local_app:
                            base_active_source = base_local_app
                            dep_graph_base = DependencyGraph(base_local_app)
                            base_discovered_routes = await asyncio.to_thread(
                                dep_graph_base.discover_all_routes
                            )
                            baseline_journeys = await _run_journeys(
                                base_url=str(baseline_info),
                                test_user_email=test_user_email,
                                test_user_password=test_user_password,
                                artifacts_dir=baseline_artifacts_dir,
                                analysis=analysis,
                                intents=[],
                                test_type=test_type,
                                run_id=f"{record.run_id}_baseline",
                                auto_repair_config=auto_repair_config,
                                source_root=base_active_source,
                                container_name=base_container,
                                testing_config=testing_config,
                                discovered_routes=base_discovered_routes or discovered_routes,
                                git_diff="",
                                scope=scope,
                                # Defence in depth: even if the refresh starts
                                # with what looked like enough budget, its own
                                # sweep must stop at the report reserve rather
                                # than run past the hard timeout.
                                deadline=deadline,
                            )
                    else:
                        dep_graph_base = DependencyGraph(APP_REPO_DIR)
                        base_discovered_routes = await asyncio.to_thread(
                            dep_graph_base.discover_all_routes
                        )
                        baseline_journeys = await _run_journeys(
                            base_url=str(baseline_info),
                            test_user_email=test_user_email,
                            test_user_password=test_user_password,
                            artifacts_dir=baseline_artifacts_dir,
                            analysis=analysis,
                            intents=[],
                            test_type=test_type,
                            run_id=f"{record.run_id}_baseline",
                            auto_repair_config=auto_repair_config,
                            source_root=base_active_source,
                            container_name=None,
                            testing_config=testing_config,
                            discovered_routes=base_discovered_routes or discovered_routes,
                            git_diff="",
                            route_fallback_root=APP_REPO_DIR,
                            scope=scope,
                            deadline=deadline,
                        )
                default_baseline_store.update_baseline_from_run(repo=repo, journeys=baseline_journeys["raw_journeys"])
                logger.info("Refreshed baseline for repo '%s' from live %s run (%d journeys)", repo, base_branch, len(baseline_journeys["raw_journeys"]))
            else:
                logger.warning("Could not resolve base_branch '%s' to a SHA; baseline comparison uses seeded defaults.", base_branch)
        except (CloneError, SandboxBootError, subprocess.SubprocessError, GitDiffError) as exc:
            logger.warning("Baseline refresh against '%s' failed, comparison uses seeded/stale defaults: %s", base_branch, exc)

    baseline_comparison = default_baseline_store.compare(repo=repo, pr_journeys=raw_journeys)
    has_new_regressions = baseline_comparison["has_new_regressions"]

    # Coverage gate. A run that executed zero journeys verified nothing — no
    # route was discovered, no login route/credentials were available, or the
    # caller disabled the login flow. Previously this fell through to
    # `success`, so a green Check Run could be posted over an empty test run.
    # "inconclusive" is deliberately distinct from both success and failure:
    # it maps to a neutral Check Run conclusion rather than a passing one.
    journeys_executed = len(raw_journeys)
    overall_status = decide_overall_status(
        journeys_executed=journeys_executed,
        has_new_regressions=has_new_regressions,
        failed_journeys=failed_journeys,
    )
    if overall_status == "inconclusive":
        logger.warning(
            "Coverage gate: no journeys were executed for %s@%s "
            "(no routes discovered, no credentials, or login disabled) — "
            "reporting 'inconclusive' instead of success.",
            repo,
            sha[:8],
        )
    logger.info(
        "Pipeline completed: overall_status=%s (new_regressions=%s, journeys=%d)",
        overall_status,
        has_new_regressions,
        journeys_executed,
    )

    # 6. Update Run Record with persistent Supabase Storage artifact URLs
    login_video_url = (
        _artifact_url_for_file(login_result.video_path, record.run_id, "video")
        if login_result and login_result.video_path
        else None
    )
    login_trace_url = (
        _artifact_url_for_file(login_result.trace_path, record.run_id, "traces")
        if login_result and login_result.trace_path
        else None
    )

    # Known real secret values for this run, used to redact persisted artifacts
    # (the same list the remediation formatter redacts with). Repository secrets
    # from Context & Secrets are included so a value injected into the sandbox
    # cannot survive in a DOM snapshot, log or prompt.
    custom_secrets = [s for s in (test_user_email, test_user_password) if s]
    custom_secrets.extend(v for v in context_secret_values if v)

    journey_artifacts = []
    if login_result:
        journey_artifacts.append({
            "name": "login",
            "trace_url": login_trace_url,
            "video_url": login_video_url,
        })
    for ja in journeys["journey_artifacts"]:
        annotated_url = ja.get("annotated_screenshot_url") or _artifact_url_for_file(
            ja.get("annotated_screenshot_path"), record.run_id, "screenshots"
        )
        entry = {
            "name": ja["name"],
            "route": ja.get("route", ja["name"]),
            "trace_url": ja.get("trace_url"),
            "video_url": ja.get("video_url"),
            # Redact before persistence. These fields are written to
            # `runs.result` and object storage, and previously stored the raw
            # DOM, request/response headers and console output verbatim — an
            # Authorization/Cookie header or a rendered test password would
            # survive in the forensic record.
            "dom_snapshot": redact_data(ja.get("dom_snapshot", ""), custom_secrets),
            "network_requests": redact_data(ja.get("network_requests", []), custom_secrets),
            "console_errors": redact_data(ja.get("console_errors", []), custom_secrets),
            "response_headers": redact_data(ja.get("response_headers", {}), custom_secrets),
            "duration_ms": ja.get("duration_ms", 1200.0),
            "web_vitals": ja.get("web_vitals"),
            "action_timings_ms": ja.get("action_timings_ms", []),
            "scroll_actions": ja.get("scroll_actions", 0),
            "links_checked": ja.get("links_checked", []),
            "broken_links": ja.get("broken_links", []),
            "navigation_checks": ja.get("navigation_checks", []),
        }
        if annotated_url:
            entry["annotated_screenshot_url"] = annotated_url
        journey_artifacts.append(entry)

    # One continuous session replay: each route is recorded in its own browser
    # context, so a sweep produced N short clips and the dashboard showed only
    # one of them. Stitch them in visit order so the headline video shows the
    # whole navigation instead of a single page.
    session_replay_url: str | None = None
    session_replay_path: Path | None = None
    route_video_paths = [
        p
        for p in (
            [login_result.video_path] if login_result and login_result.video_path else []
        )
        + [ja.get("video_path") for ja in journeys["journey_artifacts"]]
        if p
    ]
    if len(route_video_paths) > 1:
        try:
            from agent.journeys.video_converter import stitch_videos

            stitched = stitch_videos(route_video_paths, artifacts_dir / "session-replay.mp4")
            if stitched and Path(stitched).exists():
                session_replay_path = Path(stitched)
                session_replay_url = _artifact_url_for_file(
                    session_replay_path, record.run_id, "video"
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Session replay stitching failed: %s", exc)

    # Primary video & trace: prioritize the failing journey's recordings
    primary_video_url = login_video_url
    primary_trace_url = login_trace_url
    if not primary_video_url and journeys["journey_artifacts"]:
        primary_video_url = journeys["journey_artifacts"][0].get("video_url")
    if not primary_trace_url and journeys["journey_artifacts"]:
        primary_trace_url = journeys["journey_artifacts"][0].get("trace_url")
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

    # A continuous agentic session recording is preferred over a stitched
    # replay: it is one uninterrupted session with a visible human-like cursor,
    # whereas the stitched version concatenates per-route clips.
    agentic_session = journeys.get("agentic_session") or None
    agentic_video_path = (agentic_session or {}).get("video_path")
    agentic_video_url = (
        _artifact_url_for_file(agentic_video_path, record.run_id, "video")
        if agentic_video_path
        else None
    )

    if not primary_screenshot_url:
        for ja in journeys["journey_artifacts"]:
            if ja.get("annotated_screenshot_url") or ja.get("screenshot_url"):
                primary_screenshot_url = ja.get("annotated_screenshot_url") or ja.get("screenshot_url")
                break

    # The stitched session replay wins the headline video slot: it covers every
    # visited route, whereas the fallback above deliberately prefers the one
    # failing journey — which is how a 14-page sweep ended up represented by a
    # single home-page clip. Per-route clips stay available in journey_artifacts.
    if agentic_video_url:
        primary_video_url = agentic_video_url
    elif session_replay_url:
        primary_video_url = session_replay_url

    # Snapshot the real LLM token usage accumulated across this run's Strands
    # agent invocations, then stop metering.
    llm_usage = usage_accumulator.snapshot().to_dict() if usage_accumulator is not None else None
    clear_usage_accumulator()

    # Calculate real quality dimensions & per-path analysis.
    # repo_dir is deliberately None for containerized runs: the source lives only
    # inside the sandbox container, which is already destroyed by this point, so
    # there is no host checkout for the evaluator to read. Passing a path that no
    # longer exists would be worse than reporting the degraded (no-source) shape.
    quality_report_obj = default_quality_evaluator.evaluate_run(
        run_record=record,
        journeys=journey_artifacts,
        repo_dir=None if container_name else str(APP_REPO_DIR),
        git_diff=diff if "diff" in locals() else None,
        llm_usage=llm_usage,
    )
    quality_report = quality_report_obj.to_dict()

    # Structured, user-facing result model: one test case per executed journey
    # plus a dismissible finding per failure. Built from the evidence collected
    # above, so the API, the dashboard and the PR comment cannot disagree.
    from agent.runner.test_cases import build_test_cases

    # Previous run's structured cases for this branch, so the report is
    # incremental: regression / fixed / carried-forward are decided against what
    # actually happened last time, not guessed from the diff. Best-effort — a
    # lookup failure just means every case is reported as new.
    previous_cases: list[dict[str, Any]] = []
    try:
        from agent.db.pr_insights import default_pr_insight_store

        previous_cases = default_pr_insight_store.previous_test_cases(
            repo_full_name=f"{owner}/{repo}" if owner and repo else repo,
            branch=branch,
            exclude_run_id=record.run_id,
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not load previous test cases: %s", exc)

    test_cases, case_findings, severity_summary = build_test_cases(
        journey_artifacts=journey_artifacts,
        passed_journeys=passed_journeys,
        failed_journeys=failed_journeys,
        additional_findings=additional_findings,
        analysis=analysis,
        baseline_comparison=baseline_comparison,
        change_impact=change_impact,
        seeded_account=test_user_email,
        login_enabled=bool(test_user_email),
        pr_number=pr_number,
        previous_cases=previous_cases,
    )

    run_result = {
        "status": overall_status,
        "test_cases": test_cases,
        "severity_summary": severity_summary,
        # What repository context the run was given, by name only. Secret values
        # are never echoed back into a stored result.
        "environment_context": (
            project_context.to_summary() if "project_context" in locals() else {}
        ),
        # Repository identity is persisted so POST /runs/{id}/apply can target
        # the right repo. Without these, the apply endpoint fell back to
        # owner="local"/repo="web" and the GitHub Contents-API path was
        # unreachable for every real run.
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "installation_id": installation_id,
        "risk_tag": analysis.risk_tag,
        "rationale": analysis.rationale,
        "affected_surfaces": analysis.affected_surfaces,
        "passed_journeys": passed_journeys,
        "failed_journeys": failed_journeys,
        "additional_findings": additional_findings,
        "baseline_comparison": baseline_comparison,
        "trace_url": primary_trace_url,
        "video_url": primary_video_url,
        "session_replay_url": session_replay_url,
        # Why this run tested what it tested: targeted / global_ui / unmapped /
        # no_ui_impact. Surfaced so "it only visited one page" is explainable
        # rather than mysterious.
        "change_impact": (
            change_impact.to_dict()
            if change_impact is not None
            else journeys.get("change_impact")
        ),
        "effective_scope": effective_scope,
        # Advisory agent exploration: what it did, what it noted, how it stopped.
        # These notes never decide pass/fail — see the session call site.
        "agentic_session": (
            {
                "steps_used": agentic_session.get("steps_used", 0),
                "budget": agentic_session.get("budget", 0),
                "pages_visited": agentic_session.get("pages_visited", []),
                "stop_reason": agentic_session.get("stop_reason"),
                "notes": agentic_session.get("notes", []),
                "findings": agentic_session.get("findings", []),
                "duration_ms": agentic_session.get("duration_ms", 0.0),
                "video_url": agentic_video_url,
            }
            if agentic_session
            else None
        ),
        "screenshot_url": primary_screenshot_url,
        "journey_artifacts": journey_artifacts,
        "remediation_prompts": remediation_prompts,
        "remediation_prompt": remediation_prompts[0] if remediation_prompts else None,
        "suggested_fixes": journeys.get("suggested_fixes", []),
        "fix_proposals": [fp.model_dump() for fp in journeys.get("fix_proposals", [])],
        "timing": timing,
        # Top-level duration, so an API consumer does not have to know that the
        # total lives inside `timing` (the dashboard's run list read "0s" for
        # every completed run because this key did not exist).
        "duration_s": timing.get("total_duration_s"),
        "quality_dimensions": quality_report,
        "per_path_analysis": quality_report.get("per_path_analysis", {}),
        # Coverage accounting: `journeys_executed == 0` with
        # `overall_status == "inconclusive"` is a *not-verified* result, not a pass.
        "journeys_executed": journeys_executed,
        "coverage_gate": "no_journeys" if journeys_executed == 0 else "ok",
    }
    default_run_store.update(
        run_id=record.run_id,
        status="failed" if overall_status == "failure" else "completed",
        result=run_result,
        completed=True,
        video_url=primary_video_url,
        trace_url=primary_trace_url,
    )

    # Materialize the PR-centric projection: the PR row, one row per test case,
    # and one dismissible finding per failure. Best-effort by design — a database
    # write failure must never change the outcome of a verification run.
    try:
        from agent.db.pr_insights import default_pr_insight_store

        _pr_repo_full = f"{owner}/{repo}" if owner and repo else repo
        default_pr_insight_store.record_run_result(
            repo_full_name=_pr_repo_full,
            run_id=record.run_id,
            pr_number=pr_number,
            test_cases=test_cases,
            findings=case_findings,
            head_sha=sha,
            base_branch=base_branch,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist PR insights for run %s: %s", record.run_id, exc)

    # 6b. Notify email watchers. Best-effort and non-fatal: a notification must
    # never change the outcome of a verification run. Delivery is attempted
    # inline (off the event loop) so a finished run's mail goes out immediately;
    # the outbox retries anything that does not.
    try:
        from agent.email.notifications import notify_run_completed

        await notify_run_completed(
            repo_full_name=f"{owner}/{repo}" if owner and repo else repo,
            run_id=record.run_id,
            branch=branch,
            sha=sha,
            status=overall_status,
            risk_tag=analysis.risk_tag if analysis else None,
            journeys_executed=journeys_executed,
            passed=len(passed_journeys),
            failed=len(failed_journeys),
            findings=case_findings,
            pr_number=pr_number,
            summary=remediation_prompts[0] if remediation_prompts else None,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not send run-completed notification for %s: %s", record.run_id, exc)

    # 7. Notify GitHub Check Run
    if check_run_id:
        # "inconclusive" (zero journeys executed) maps to GitHub's `neutral`
        # conclusion so an unverified run cannot present itself as green.
        conclusion = {
            "success": "success",
            "inconclusive": "neutral",
        }.get(overall_status, "failure")
        summary = (
            f"Autonomous PR verification {overall_status.upper()}.\n"
            f"Risk: {analysis.risk_tag} | Journeys run: {journeys_executed} | "
            f"Passed: {len(passed_journeys)} | Failed: {len(failed_journeys)}"
        )
        # Zero journeys has two very different meanings. A deliberate
        # "nothing user-visible changed" is not a harness failure, and saying so
        # explicitly is the difference between a check people trust and one they
        # learn to ignore.
        no_ui_impact = change_impact is not None and change_impact.kind == "no_ui_impact"
        if no_ui_impact:
            summary += (
                f"\n\nNo user-visible surface changed — {change_impact.rationale} "
                "The build was still verified; no browser journeys were required."
            )
        elif journeys_executed == 0:
            summary += (
                "\n\nNo journeys were executed (no routes discovered, no credentials, "
                "or login disabled), so nothing was verified."
            )
        detail_text = "\n\n".join(remediation_prompts) if remediation_prompts else "All user journeys verified clean."
        try:
            await github_client.update_check_run(
                owner=owner,
                repo=repo,
                check_run_id=check_run_id,
                conclusion=conclusion,
                title=f"Autonomous Verification: {overall_status.capitalize()}",
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

    # 9. Post PR Comment if PR number provided and the repository's automation
    #    policy allows posting back to GitHub (mode=silent keeps results in the
    #    dashboard only).
    if pr_number and post_comments:
        comment_body = generate_pr_summary_comment(
            status=overall_status,
            passed_journeys=passed_journeys,
            failed_journeys=failed_journeys,
            analysis=analysis,
            remediation_prompts=remediation_prompts,
            additional_findings=additional_findings if additional_findings else None,
            branch=branch,
            fix_proposals=journeys.get("fix_proposals"),
            custom_secrets=custom_secrets,
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
