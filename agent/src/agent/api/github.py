"""GitHub App installation and repository discovery endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from agent.db.supabase import get_supabase_client
from agent.github.app import GitHubAppClient, GitHubNotConfiguredError

logger = logging.getLogger("agent.api.github")
router = APIRouter(prefix="/api/github", tags=["github"])


@router.get("/repos")
async def list_github_app_repos() -> dict[str, Any]:
    """Return all repositories granted across all active installations of the GitHub App."""
    client = GitHubAppClient()
    try:
        repos = await client.get_all_installed_repositories()
        return {"repositories": repos, "count": len(repos)}
    except GitHubNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to query GitHub App repositories: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to query GitHub API: {exc}") from exc


@router.post("/sync")
async def sync_github_app_repos() -> dict[str, Any]:
    """Fetch all installed repositories from GitHub App and synchronize them into Supabase.

    Upserts installation records into the `installations` table and registers default
    project records in the `projects` table for any newly discovered repositories.
    """
    client = GitHubAppClient()
    try:
        installations = await client.get_installations()
    except GitHubNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Failed to list GitHub App installations: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to list installations: {exc}") from exc

    supabase = get_supabase_client()
    synced_repos: list[dict[str, Any]] = []

    for inst in installations:
        inst_id = inst.get("id")
        if not inst_id:
            continue

        account_info = inst.get("account") or {}
        account_login = account_info.get("login", "")
        account_id = account_info.get("id", 0)

        try:
            repo_data = await client.get_installation_repositories(inst_id)
            repos = repo_data.get("repositories", [])
            repo_list = [
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "full_name": r.get("full_name"),
                    "private": r.get("private", False),
                    "default_branch": r.get("default_branch", "main"),
                    "html_url": r.get("html_url", ""),
                }
                for r in repos
            ]

            # Upsert into Supabase installations table if available
            if supabase:
                try:
                    supabase.table("installations").upsert(
                        {
                            "installation_id": inst_id,
                            "account_login": account_login,
                            "account_id": account_id,
                            "repositories": repo_list,
                        },
                        on_conflict="installation_id",
                    ).execute()
                except Exception as db_err:
                    logger.warning("Failed to upsert installation %s into Supabase: %s", inst_id, db_err)

                # Upsert into projects table for each repo if not already present
                for r in repos:
                    full_name = r.get("full_name")
                    if not full_name:
                        continue
                    try:
                        # Only insert if not exists to avoid overwriting user custom settings
                        existing = (
                            supabase.table("projects")
                            .select("id")
                            .eq("repo_full_name", full_name)
                            .maybe_single()
                            .execute()
                        )
                        if not existing or not existing.data:
                            supabase.table("projects").insert(
                                {
                                    "installation_id": inst_id,
                                    "repo_full_name": full_name,
                                    "settings": {
                                        "framework": "nextjs",
                                        "package_manager": "npm",
                                        "build_command": "npm run build",
                                        "start_command": "npm start",
                                        "port": 3000,
                                        "scope": "changed",
                                        "test_type": "functional",
                                        "enable_on_push": True,
                                        "enable_on_pr": True,
                                    },
                                }
                            ).execute()
                    except Exception as proj_err:
                        logger.warning("Failed to register project %s: %s", full_name, proj_err)

            for r in repos:
                synced_repos.append({
                    "installation_id": inst_id,
                    "account": account_login,
                    "repo_full_name": r.get("full_name"),
                    "repo_name": r.get("name"),
                    "default_branch": r.get("default_branch", "main"),
                    "private": r.get("private", False),
                    "html_url": r.get("html_url", ""),
                })

        except Exception as exc:
            logger.error("Failed to sync repos for installation %s: %s", inst_id, exc)

    return {
        "status": "synced",
        "installations_count": len(installations),
        "repositories_count": len(synced_repos),
        "repositories": synced_repos,
    }
