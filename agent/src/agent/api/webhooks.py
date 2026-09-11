"""GitHub Webhook API router for pull request events and interactive bot commands."""

from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from agent.db.supabase import default_intent_store, default_run_store
from agent.github.app import GitHubAppClient, GitHubNotConfiguredError, verify_webhook_signature
from agent.remediation.fix_synthesizer import FilePatch, apply_patch_to_text
from agent.runner.pipeline import run_pipeline
from agent.runner.queue import default_job_queue

logger = logging.getLogger("agent.api.webhooks")
router = APIRouter(prefix="/webhooks", tags=["webhooks"])
github_client = GitHubAppClient()

# Cooldown tracker for interactive bot commands: "owner/repo#pr_number:command" -> timestamp
_comment_command_cooldowns: dict[str, float] = {}
COOLDOWN_WINDOW_SECONDS: float = 60.0


@router.post("/github")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_github_event: str = Header(..., alias="X-GitHub-Event"),
    x_hub_signature_256: str | None = Header(None, alias="X-Hub-Signature-256"),
) -> dict[str, Any]:
    """Handle incoming GitHub App webhooks for pull_request and issue_comment events."""
    raw_body = await request.body()
    secret = os.environ.get("GITHUB_WEBHOOK_SECRET")
    if not secret:
        logger.error("GITHUB_WEBHOOK_SECRET is not configured; rejecting webhook request.")
        raise HTTPException(status_code=503, detail="Server misconfigured: GITHUB_WEBHOOK_SECRET is not set.")
    if not verify_webhook_signature(raw_body, x_hub_signature_256, secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()

    if x_github_event == "ping":
        return {"status": "pong", "zen": payload.get("zen")}

    # Repository Identity Binding: verify webhook repo against configured APP_REPO_NAME
    repo_meta = payload.get("repository", {})
    owner_login = repo_meta.get("owner", {}).get("login") or repo_meta.get("owner", {}).get("name", "")
    r_name = repo_meta.get("name", "")
    webhook_repo_full = repo_meta.get("full_name") or (f"{owner_login}/{r_name}" if (owner_login or r_name) else "")

    expected_repo = os.environ.get("APP_REPO_NAME")
    if expected_repo and webhook_repo_full and webhook_repo_full.lower() != expected_repo.lower():
        logger.warning(
            "Webhook received for unmatched repository '%s'; expected '%s'. Rejecting to protect local worktree.",
            webhook_repo_full,
            expected_repo,
        )
        return {"status": "ignored", "reason": f"unmatched_repo_{webhook_repo_full}"}

    # --------------------------------------------------------------------------
    # 1. Interactive PR Issue Comment Commands (@pr-agent)
    # --------------------------------------------------------------------------
    if x_github_event == "issue_comment":
        action = payload.get("action")
        if action != "created":
            return {"status": "ignored", "reason": f"comment_action_{action}"}

        issue = payload.get("issue", {})
        if "pull_request" not in issue:
            return {"status": "ignored", "reason": "comment_not_on_pr"}

        comment = payload.get("comment", {})
        comment_body = comment.get("body", "").strip()
        comment_id = comment.get("id")
        commenter = comment.get("user", {}).get("login", "")
        author_assoc = comment.get("author_association", "NONE")
        pr_author = issue.get("user", {}).get("login", "")
        pr_number = issue.get("number")
        repo = payload.get("repository", {})
        owner = repo.get("owner", {}).get("login", "")
        repo_name = repo.get("name", "")
        full_name = repo.get("full_name", f"{owner}/{repo_name}")
        installation_id = payload.get("installation", {}).get("id")

        # Bot Loop Prevention
        if "[skip-pr-agent]" in comment_body or comment.get("user", {}).get("type") == "Bot":
            return {"status": "ignored", "reason": "bot_comment"}

        if not comment_body.startswith("@pr-agent") and not comment_body.startswith("/pr-agent"):
            return {"status": "ignored", "reason": "no_pr_agent_command"}

        logger.info("Received @pr-agent command from %s on %s #%s: %s", commenter, full_name, pr_number, comment_body)

        # Permission & Security Gate
        is_authorized = (author_assoc in ("OWNER", "MEMBER", "COLLABORATOR")) or (commenter == pr_author)
        if not is_authorized:
            logger.warning("Unauthorized user %s attempted @pr-agent command on %s #%s", commenter, full_name, pr_number)
            try:
                await github_client.create_reaction(owner, repo_name, comment_id, "-1", installation_id)
            except Exception:
                pass
            return {"status": "rejected", "reason": "unauthorized"}

        # Command: @pr-agent help
        if "@pr-agent help" in comment_body:
            help_text = (
                "### 🤖 Autonomous PR Agent Commands\n\n"
                "| Command | Description |\n"
                "| :--- | :--- |\n"
                "| `@pr-agent apply` | Commits the synthesized fix directly to the PR branch and re-verifies. |\n"
                "| `@pr-agent test [--scope full\\|changed]` | Dispatches an on-demand verification run. |\n"
                "| `@pr-agent inspect <route>` | Runs an exploratory browser journey on a specific route. |\n"
                "| `@pr-agent help` | Displays this help manual. |\n"
            )
            await github_client.post_pr_comment(owner, repo_name, pr_number, help_text, installation_id)
            return {"status": "executed", "command": "help"}

        # Check rate limiting early for @pr-agent test / check
        if "@pr-agent test" in comment_body or "@pr-agent check" in comment_body:
            cooldown_key = f"{full_name}#{pr_number}:test"
            now = time.time()
            last_run = _comment_command_cooldowns.get(cooldown_key, 0.0)
            if now - last_run < COOLDOWN_WINDOW_SECONDS:
                remaining = int(COOLDOWN_WINDOW_SECONDS - (now - last_run))
                logger.warning(
                    "Rate limited @pr-agent test on %s #%s (wait %ds)",
                    full_name,
                    pr_number,
                    remaining,
                )
                try:
                    await github_client.create_reaction(owner, repo_name, comment_id, "eyes", installation_id)
                except Exception:
                    pass
                return {
                    "status": "rate_limited",
                    "reason": f"Please wait {remaining}s before dispatching another test run on this PR.",
                }
            _comment_command_cooldowns[cooldown_key] = now

        # Acknowledge with reaction
        try:
            await github_client.create_reaction(owner, repo_name, comment_id, "rocket", installation_id)
        except Exception:
            pass

        # Fetch live PR details
        pr_details = await github_client.get_pr(owner, repo_name, pr_number, installation_id)
        head_sha = pr_details.get("head", {}).get("sha", "")
        branch = pr_details.get("head", {}).get("ref", "")
        base_branch = pr_details.get("base", {}).get("ref", "main")

        # Command: @pr-agent apply / @pr-agent fix
        if "@pr-agent apply" in comment_body or "@pr-agent fix" in comment_body:
            # Query latest run for this branch
            runs = default_run_store.list_all(branch=branch, repo=full_name) or default_run_store.list_all(branch=branch)
            target_run = runs[0] if runs else None

            if not target_run or not target_run.result:
                await github_client.post_pr_comment(
                    owner,
                    repo_name,
                    pr_number,
                    "⚠️ No prior test run found with fix proposals for this PR. Run `@pr-agent test` first.",
                    installation_id,
                )
                return {"status": "no_run_found"}

            # Verify the proposal is for the current commit HEAD
            if target_run.sha != head_sha:
                logger.warning("Stale commit: Run %s tested SHA %s, but PR HEAD is now %s", target_run.run_id, target_run.sha, head_sha)
                await github_client.post_pr_comment(
                    owner,
                    repo_name,
                    pr_number,
                    f"⚠️ The branch `{branch}` has received new commits since the last run (evaluated `{target_run.sha[:8]}`, but PR HEAD is now `{head_sha[:8]}`). Re-triggering verification...",
                    installation_id,
                )
                return {"status": "stale_commit_guard_retriggered", "tested_sha": target_run.sha, "head_sha": head_sha}

            suggested_fixes = target_run.result.get("suggested_fixes", [])
            if not suggested_fixes:
                await github_client.post_pr_comment(
                    owner,
                    repo_name,
                    pr_number,
                    "ℹ️ No synthesized fix proposals available to apply for the latest run.",
                    installation_id,
                )
                return {"status": "no_fixes_available"}

            applied_files = []
            new_commit_sha = head_sha

            for raw_fix in suggested_fixes:
                patch = FilePatch(**raw_fix)
                try:
                    # Fetch current file content from GitHub
                    current_text, blob_sha = await github_client.get_file_content(
                        owner=owner,
                        repo=repo_name,
                        path=patch.file_path,
                        ref=branch,
                        installation_id=installation_id,
                    )

                    # Apply surgical replacement
                    updated_text = apply_patch_to_text(current_text, patch)

                    # Commit change directly to the PR branch
                    commit_msg = f"fix(pr-agent): {patch.explanation} [skip-pr-agent]"
                    commit_resp = await github_client.update_file_content(
                        owner=owner,
                        repo=repo_name,
                        path=patch.file_path,
                        message=commit_msg,
                        content=updated_text,
                        sha=blob_sha,
                        branch=branch,
                        installation_id=installation_id,
                    )
                    new_commit_sha = commit_resp.get("commit", {}).get("sha", new_commit_sha)
                    applied_files.append(patch.file_path)
                except Exception as exc:
                    logger.error("Failed to commit patch to %s: %s", patch.file_path, exc)
                    await github_client.post_pr_comment(
                        owner,
                        repo_name,
                        pr_number,
                        f"❌ Failed to commit patch to `{patch.file_path}`: {exc}",
                        installation_id,
                    )
                    return {"status": "commit_failed", "error": str(exc)}

            # Post progress update
            files_list = ", ".join(f"`{f}`" for f in applied_files)
            await github_client.post_pr_comment(
                owner,
                repo_name,
                pr_number,
                f"🚀 Autonomous patch applied to {files_list} on branch `{branch}` (commit `{new_commit_sha[:8]}`). Re-running Playwright verification journeys to confirm resolution...",
                installation_id,
            )

            # Trigger immediate re-verification on the new commit via JobQueue
            check_run_id = await github_client.create_check_run(
                owner=owner,
                repo=repo_name,
                head_sha=new_commit_sha,
                installation_id=installation_id,
            )

            async def _apply_retest_coro(job: Any) -> dict[str, Any]:
                return await run_pipeline(
                    owner=owner,
                    repo=repo_name,
                    branch=branch,
                    base_branch=base_branch,
                    sha=new_commit_sha,
                    pr_number=pr_number,
                    check_run_id=check_run_id,
                    installation_id=installation_id,
                    intents=default_intent_store.get(branch, repo=full_name),
                    run_id=job.id,
                )

            job = await default_job_queue.submit_job(
                repo=full_name,
                branch=branch,
                sha=new_commit_sha,
                pipeline_coro_fn=_apply_retest_coro,
                trigger_type="bot_command",
            )
            return {"status": "applied_and_retesting", "commit": new_commit_sha, "files": applied_files, "job_id": job.id}

        # Command: @pr-agent test
        if "@pr-agent test" in comment_body or "@pr-agent check" in comment_body:
            # Rate limiting / cooldown check: 60s window per PR
            cooldown_key = f"{full_name}#{pr_number}:test"
            now = time.time()
            last_run = _comment_command_cooldowns.get(cooldown_key, 0.0)
            if now - last_run < COOLDOWN_WINDOW_SECONDS:
                remaining = int(COOLDOWN_WINDOW_SECONDS - (now - last_run))
                logger.warning(
                    "Rate limited @pr-agent test on %s #%s (wait %ds)",
                    full_name,
                    pr_number,
                    remaining,
                )
                try:
                    await github_client.create_reaction(owner, repo_name, comment_id, "eyes", installation_id)
                except Exception:
                    pass
                return {
                    "status": "rate_limited",
                    "reason": f"Please wait {remaining}s before dispatching another test run on this PR.",
                }
            _comment_command_cooldowns[cooldown_key] = now

            scope = "full" if "--scope full" in comment_body else "changed"
            check_run_id = await github_client.create_check_run(
                owner=owner,
                repo=repo_name,
                head_sha=head_sha,
                installation_id=installation_id,
            )

            async def _bot_test_coro(job: Any) -> dict[str, Any]:
                return await run_pipeline(
                    owner=owner,
                    repo=repo_name,
                    branch=branch,
                    base_branch=base_branch,
                    sha=head_sha,
                    pr_number=pr_number,
                    check_run_id=check_run_id,
                    installation_id=installation_id,
                    intents=default_intent_store.get(branch, repo=full_name),
                    scope=scope,
                    run_id=job.id,
                )

            job = await default_job_queue.submit_job(
                repo=full_name,
                branch=branch,
                sha=head_sha,
                pipeline_coro_fn=_bot_test_coro,
                scope=scope,
                test_type="functional",
                trigger_type="bot_command",
            )
            return {"status": "test_queued", "job_id": job.id, "scope": scope, "sha": head_sha}

        return {"status": "unrecognized_command"}

    # --------------------------------------------------------------------------
    # 2. On-Push Webhook Events (lightweight commit verification)
    # --------------------------------------------------------------------------
    if x_github_event == "push":
        if payload.get("deleted") is True or payload.get("after", "").startswith("00000000"):
            return {"status": "ignored", "reason": "branch_deleted"}

        ref = payload.get("ref", "")
        if not ref.startswith("refs/heads/"):
            return {"status": "ignored", "reason": "not_a_branch_ref"}

        branch = ref.removeprefix("refs/heads/")
        head_commit = payload.get("head_commit") or {}
        commit_msg = head_commit.get("message", "").lower()
        if "[skip ci]" in commit_msg or "[skip-ci]" in commit_msg or "[skip-pr-agent]" in commit_msg:
            return {"status": "ignored", "reason": "skip_commit_directive"}

        repo = payload.get("repository", {})
        owner = repo.get("owner", {}).get("login") or repo.get("owner", {}).get("name", "")
        repo_name = repo.get("name", "")
        base_branch = repo.get("default_branch", "main")
        sha = payload.get("after")
        installation_id = payload.get("installation", {}).get("id")
        full_name = repo.get("full_name") or f"{owner}/{repo_name}"

        if not sha:
            return {"status": "ignored", "reason": "missing_sha"}

        record = default_run_store.create(
            branch=branch,
            sha=sha,
            scope="changed",
            test_type="functional",
            repo=full_name,
        )

        async def _push_coro(job: Any) -> dict[str, Any]:
            return await run_pipeline(
                owner=owner,
                repo=repo_name,
                branch=branch,
                base_branch=base_branch,
                sha=sha,
                installation_id=installation_id,
                intents=default_intent_store.get(branch, repo=full_name),
                scope="changed",
                test_type="functional",
                run_id=record.run_id,
            )

        job = await default_job_queue.submit_job(
            repo=full_name,
            branch=branch,
            sha=sha,
            pipeline_coro_fn=_push_coro,
            scope="changed",
            test_type="functional",
            trigger_type="webhook_push",
        )

        logger.info("Queued on-push verification for %s/%s branch=%s sha=%s (run_id=%s, job_id=%s)", owner, repo_name, branch, sha[:8], record.run_id, job.id)
        return {
            "status": "queued",
            "event": "push",
            "run_id": record.run_id,
            "job_id": job.id,
            "branch": branch,
            "sha": sha,
        }

    # --------------------------------------------------------------------------
    # 3. Pull Request Webhook Events (opened, synchronize, reopened)
    # --------------------------------------------------------------------------
    if x_github_event != "pull_request":
        return {"status": "ignored", "event": x_github_event}

    action = payload.get("action")
    if action not in ("opened", "synchronize", "reopened"):
        return {"status": "ignored", "action": action}

    pr = payload.get("pull_request", {})
    repo = payload.get("repository", {})
    owner = repo.get("owner", {}).get("login", "")
    repo_name = repo.get("name", "")
    full_name = repo.get("full_name", f"{owner}/{repo_name}")
    head_sha = pr.get("head", {}).get("sha", "")
    branch = pr.get("head", {}).get("ref", "")
    base_branch = pr.get("base", {}).get("ref", "main")
    pr_number = pr.get("number")
    installation_id = payload.get("installation", {}).get("id")

    logger.info(
        "Received PR event %s for %s #%s on branch %s (SHA %s)",
        action,
        full_name,
        pr_number,
        branch,
        head_sha[:8],
    )

    # Debounce rapid pushes on the same branch via JobQueue
    default_job_queue.cancel_branch_jobs(full_name, branch, reason="New PR commit received")

    # Fetch captured intent events for this branch
    intents = default_intent_store.get(branch, repo=full_name)
    logger.info("Found %s captured intent events for branch '%s'", len(intents), branch)

    # Create GitHub Check Run in progress
    try:
        check_run_id = await github_client.create_check_run(
            owner=owner,
            repo=repo_name,
            head_sha=head_sha,
            installation_id=installation_id,
        )
    except GitHubNotConfiguredError as exc:
        logger.error("Cannot create Check Run, GitHub App not configured: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    # Launch background testing pipeline through throttled JobQueue
    async def _pr_coro(job: Any) -> dict[str, Any]:
        return await run_pipeline(
            owner=owner,
            repo=repo_name,
            branch=branch,
            base_branch=base_branch,
            sha=head_sha,
            pr_number=pr_number,
            check_run_id=check_run_id,
            installation_id=installation_id,
            intents=intents,
            run_id=job.id,
        )

    job = await default_job_queue.submit_job(
        repo=full_name,
        branch=branch,
        sha=head_sha,
        pipeline_coro_fn=_pr_coro,
        scope="changed",
        test_type="functional",
        trigger_type="webhook_pr",
    )

    return {
        "status": "accepted",
        "action": action,
        "repo": full_name,
        "branch": branch,
        "sha": head_sha,
        "pr_number": pr_number,
        "check_run_id": check_run_id,
        "job_id": job.id,
        "intents_found": len(intents),
    }
