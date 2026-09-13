"""GitHub App installation and repository discovery endpoints."""

from __future__ import annotations

import logging
from typing import Any

import httpx
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


@router.get("/commits")
async def list_repo_commits(
    repo: str,
    ref: str | None = None,
    per_page: int = 30,
    installation_id: int | None = None,
) -> dict[str, Any]:
    """List recent commits for a repository, newest first.

    Powers the first-run briefing's commit picker and commit-range selector. The
    listing is read-only and never creates a project or a run. ``ref`` defaults to
    whatever GitHub treats as the repository's default branch so the picker works
    before the caller knows the branch name.
    """
    if "/" not in repo:
        raise HTTPException(status_code=400, detail="repo must be in 'owner/repository' form.")

    owner, name = repo.split("/", 1)
    if not owner or not name:
        raise HTTPException(status_code=400, detail="repo must be in 'owner/repository' form.")

    client = GitHubAppClient()
    try:
        commits = await client.list_commits(
            owner=owner,
            repo=name,
            ref=ref,
            per_page=per_page,
            installation_id=installation_id,
        )
        return {"repo": repo, "ref": ref or "default", "commits": commits, "count": len(commits)}
    except GitHubNotConfiguredError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        detail = (
            "GitHub denied access to this repository's commits. Confirm the App is "
            "installed on it and the branch exists."
            if status in (401, 403, 404)
            else f"GitHub returned {status} while listing commits."
        )
        raise HTTPException(status_code=502 if status >= 500 else status, detail=detail) from exc
    except Exception as exc:
        logger.error("Failed to list commits for %s: %s", repo, exc)
        raise HTTPException(status_code=500, detail=f"Failed to list commits: {exc}") from exc


@router.post("/sync")
async def sync_github_app_repos() -> dict[str, Any]:
    """Fetch all installed repositories from GitHub App and catalogue them in Supabase.

    Upserts installation records into the `installations` table only. This
    endpoint is *discovery*, not import: it must never create `projects` rows,
    because a project is something the user explicitly opts into from the
    dashboard. Auto-creating one per installed repo made every granted
    repository show up as an already-configured project the user never imported.
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
