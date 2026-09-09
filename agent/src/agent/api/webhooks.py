"""GitHub Webhook API router for pull request events."""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request

from agent.db.supabase import default_intent_store
from agent.github.app import GitHubAppClient, verify_webhook_signature
from agent.runner.pipeline import run_pipeline

logger = logging.getLogger("agent.api.webhooks")
router = APIRouter(prefix="/webhooks", tags=["webhooks"])
github_client = GitHubAppClient()


@router.post("/github")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_github_event: str = Header(..., alias="X-GitHub-Event"),
    x_hub_signature_256: str | None = Header(None, alias="X-Hub-Signature-256"),
) -> dict[str, Any]:
    """Handle incoming GitHub App webhooks, focusing on pull_request events."""
    raw_body = await request.body()
    secret = os.environ.get("GITHUB_WEBHOOK_SECRET")
    if secret and not verify_webhook_signature(raw_body, x_hub_signature_256, secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()

    if x_github_event == "ping":
        return {"status": "pong", "zen": payload.get("zen")}

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

    # Fetch captured intent events for this branch
    intents = default_intent_store.get(branch)
    logger.info("Found %s captured intent events for branch '%s'", len(intents), branch)

    # Create GitHub Check Run in progress
    check_run_id = await github_client.create_check_run(
        owner=owner,
        repo=repo_name,
        head_sha=head_sha,
        installation_id=installation_id,
    )

    # Launch background testing pipeline
    background_tasks.add_task(
        run_pipeline,
        owner=owner,
        repo=repo_name,
        branch=branch,
        base_branch=base_branch,
        sha=head_sha,
        pr_number=pr_number,
        check_run_id=check_run_id,
        installation_id=installation_id,
        intents=intents,
    )

    return {
        "status": "accepted",
        "action": action,
        "repo": full_name,
        "branch": branch,
        "sha": head_sha,
        "pr_number": pr_number,
        "check_run_id": check_run_id,
        "intents_found": len(intents),
    }
