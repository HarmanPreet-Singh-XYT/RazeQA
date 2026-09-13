"""GitHub App authentication, Check Runs API, and PR commenting client."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import jwt
from urllib.parse import quote

logger = logging.getLogger("agent.github.app")


class GitHubNotConfiguredError(RuntimeError):
    """Raised when GitHub App/PAT credentials are required but not configured.

    A prior version of this client silently logged a "[Mock GitHub App]" line
    and returned a fabricated success response when credentials were missing —
    that made misconfiguration invisible (checks/comments looked like they
    posted when nothing was ever sent to GitHub). Fail loudly instead.
    """


def verify_webhook_signature(payload_bytes: bytes, signature_header: str | None, secret: str) -> bool:
    """Verify GitHub webhook payload HMAC-SHA256 signature."""
    if not signature_header or not secret:
        return False
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
    received = signature_header.split("sha256=")[1]
    return hmac.compare_digest(expected, received)


class GitHubAppClient:
    """Client for interacting with GitHub App API: Check Runs and PR Comments."""

    def __init__(
        self,
        app_id: str | None = None,
        private_key: str | None = None,
        token: str | None = None,
    ) -> None:
        self.app_id = app_id or os.environ.get("GITHUB_APP_ID")
        self.private_key = private_key or os.environ.get("GITHUB_APP_PRIVATE_KEY")
        if not self.private_key:
            key_path = os.environ.get("GITHUB_APP_PRIVATE_KEY_PATH")
            if key_path and os.path.exists(key_path):
                try:
                    with open(key_path, encoding="utf-8") as f:
                        self.private_key = f.read()
                except Exception as exc:
                    logger.warning("Failed to read GITHUB_APP_PRIVATE_KEY_PATH '%s': %s", key_path, exc)
        self.token = token or os.environ.get("GITHUB_TOKEN")
        self._installation_tokens: dict[int, tuple[str, float]] = {}

    def _generate_jwt(self) -> str:
        """Create a RS256 JWT for GitHub App authentication."""
        if not self.app_id or not self.private_key:
            raise ValueError("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to generate JWT")
        now = int(time.time())
        payload = {
            "iat": now - 60,
            "exp": now + (10 * 60),
            "iss": self.app_id,
        }
        return jwt.encode(payload, self.private_key, algorithm="RS256")

    async def get_installation_token(self, installation_id: int) -> str:
        """Obtain or reuse a scoped installation token for the repository."""
        if self.token:
            return self.token

        cached = self._installation_tokens.get(installation_id)
        if cached and time.time() < cached[1]:
            return cached[0]

        app_jwt = self._generate_jwt()
        url = f"https://api.github.com/app/installations/{installation_id}/access_tokens"
        headers = {
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers)
            res.raise_for_status()
            data = res.json()
            token = data["token"]
            expires_at = datetime.fromisoformat(data["expires_at"]).timestamp()
            self._installation_tokens[installation_id] = (token, expires_at - 60)

            return token

    async def _get_auth_header(self, installation_id: int | None = None) -> dict[str, str]:
        if self.token:
            return {
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
            }
        if installation_id:
            tok = await self.get_installation_token(installation_id)
            return {
                "Authorization": f"Bearer {tok}",
                "Accept": "application/vnd.github+json",
            }
        return {"Accept": "application/vnd.github+json"}

    async def create_check_run(
        self,
        owner: str,
        repo: str,
        head_sha: str,
        name: str = "Autonomous PR Testing Engine",
        installation_id: int | None = None,
    ) -> int:
        """Create an in-progress Check Run on the commit."""
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError(
                "Cannot create Check Run: neither GITHUB_TOKEN nor "
                "GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY are configured."
            )

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/check-runs"
        payload = {
            "name": name,
            "head_sha": head_sha,
            "status": "in_progress",
            "started_at": datetime.now(UTC).isoformat(),
            "output": {
                "title": "Autonomous Verification Running",
                "summary": "Analyzing changed code and running sandboxed browser journeys...",
            },
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            res.raise_for_status()
            return res.json()["id"]

    async def update_check_run(
        self,
        owner: str,
        repo: str,
        check_run_id: int,
        conclusion: str,  # success, failure, neutral, action_required
        title: str,
        summary: str,
        text: str = "",
        installation_id: int | None = None,
    ) -> dict[str, Any]:
        """Update Check Run with final conclusion and forensic output."""
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError(
                "Cannot update Check Run: neither GITHUB_TOKEN nor "
                "GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY are configured."
            )

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/check-runs/{check_run_id}"
        payload = {
            "status": "completed",
            "conclusion": conclusion,
            "completed_at": datetime.now(UTC).isoformat(),
            "output": {
                "title": title,
                "summary": summary,
                "text": text,
            },
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.patch(url, headers=headers, json=payload)
            res.raise_for_status()
            return res.json()

    async def post_pr_comment(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        installation_id: int | None = None,
    ) -> str:
        """Post a forensic summary comment directly to the Pull Request."""
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError(
                "Cannot post PR comment: neither GITHUB_TOKEN nor "
                "GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY are configured."
            )

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json={"body": body})
            res.raise_for_status()
            return res.json()["html_url"]

    async def get_pr(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        installation_id: int | None = None,
    ) -> dict[str, Any]:
        """Fetch details of a Pull Request (head SHA, ref branch, author)."""
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GitHub credentials are required to fetch PR details.")

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            return res.json()

    async def list_pull_requests(
        self,
        owner: str,
        repo: str,
        state: str = "open",
        per_page: int = 50,
        installation_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """List pull requests for a repository, most recently updated first.

        Read-only discovery for the manual "pick PRs and run" flow. The payload
        is normalized so the caller does not depend on GitHub's nesting.
        """
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GitHub credentials are required to list pull requests.")

        headers = await self._get_auth_header(installation_id)
        params = {
            "state": state,
            "per_page": max(1, min(per_page, 100)),
            "sort": "updated",
            "direction": "desc",
        }
        url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers, params=params)
            res.raise_for_status()
            payload = res.json()

        pulls: list[dict[str, Any]] = []
        for pr in payload if isinstance(payload, list) else []:
            user = pr.get("user") or {}
            head = pr.get("head") or {}
            base = pr.get("base") or {}
            pulls.append(
                {
                    "pr_number": pr.get("number"),
                    "title": pr.get("title"),
                    "author_login": user.get("login"),
                    "author_type": user.get("type", "User"),
                    "state": pr.get("state"),
                    "is_draft": bool(pr.get("draft")),
                    "head_branch": head.get("ref"),
                    "head_sha": head.get("sha"),
                    "base_branch": base.get("ref"),
                    "html_url": pr.get("html_url"),
                    "created_at": pr.get("created_at"),
                    "updated_at": pr.get("updated_at"),
                    "changed_files": pr.get("changed_files"),
                    "additions": pr.get("additions"),
                    "deletions": pr.get("deletions"),
                }
            )
        return pulls

    async def get_file_content(
        self,
        owner: str,
        repo: str,
        path: str,
        ref: str,
        installation_id: int | None = None,
    ) -> tuple[str, str]:
        """Fetch file content and blob SHA from a repository at a given ref/branch.

        Returns:
            (decoded_utf8_text, blob_sha)
        """
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GitHub credentials are required to fetch file contents.")

        headers = await self._get_auth_header(installation_id)
        quoted_path = quote(path.lstrip("/"), safe="/")
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{quoted_path}?ref={ref}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            data = res.json()
            raw_content = data.get("content", "")
            encoding = data.get("encoding", "")
            blob_sha = data.get("sha", "")

            if encoding == "base64":
                decoded = base64.b64decode(raw_content).decode("utf-8", errors="replace")
            else:
                decoded = raw_content

            return decoded, blob_sha

    async def update_file_content(
        self,
        owner: str,
        repo: str,
        path: str,
        message: str,
        content: str,
        sha: str,
        branch: str,
        installation_id: int | None = None,
    ) -> dict[str, Any]:
        """Atomically commit an updated file to a branch on GitHub."""
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GitHub credentials are required to commit file updates.")

        headers = await self._get_auth_header(installation_id)
        quoted_path = quote(path.lstrip("/"), safe="/")
        url = f"https://api.github.com/repos/{owner}/{repo}/contents/{quoted_path}"
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("ascii")
        payload = {
            "message": message,
            "content": encoded_content,
            "sha": sha,
            "branch": branch,
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.put(url, headers=headers, json=payload)
            res.raise_for_status()
            return res.json()

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        title: str,
        head: str,
        base: str,
        body: str = "",
        draft: bool = False,
        installation_id: int | None = None,
    ) -> str:
        """Open a pull request and return its HTML URL.

        Used to publish an agent-authored fix: the fix lands as an ordinary PR
        against the branch under review, so CI, branch protection and human
        review apply unchanged rather than being bypassed.
        """
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GitHub credentials are required to open a pull request.")

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
        payload = {"title": title, "head": head, "base": base, "body": body, "draft": draft}
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(url, headers=headers, json=payload)
            res.raise_for_status()
            return res.json()["html_url"]

    async def create_reaction(
        self,
        owner: str,
        repo: str,
        comment_id: int,
        reaction: str = "rocket",
        installation_id: int | None = None,
    ) -> dict[str, Any]:
        """Add an emoji reaction to an issue comment."""
        if not self.token and not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GitHub credentials are required to create reactions.")

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/issues/comments/{comment_id}/reactions"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json={"content": reaction})
            res.raise_for_status()
            return res.json()

    async def get_installations(self) -> list[dict[str, Any]]:
        """Fetch all installations of this GitHub App."""
        if not (self.app_id and self.private_key):
            raise GitHubNotConfiguredError("GITHUB_APP_ID and private key are required to list installations.")

        app_jwt = self._generate_jwt()
        url = "https://api.github.com/app/installations"
        headers = {
            "Authorization": f"Bearer {app_jwt}",
            "Accept": "application/vnd.github+json",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            return res.json()

    async def get_installation_repositories(self, installation_id: int) -> dict[str, Any]:
        """Fetch all repositories accessible to a specific installation."""
        token = await self.get_installation_token(installation_id)
        url = "https://api.github.com/installation/repositories"
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            return res.json()

    async def get_all_installed_repositories(self) -> list[dict[str, Any]]:
        """Retrieve a unified list of all repositories granted across all app installations."""
        installations = await self.get_installations()
        all_repos: list[dict[str, Any]] = []

        for inst in installations:
            inst_id = inst.get("id")
            if not inst_id:
                continue
            account_info = inst.get("account") or {}
            account_login = account_info.get("login", "")
            account_type = account_info.get("type", "User")

            try:
                repo_data = await self.get_installation_repositories(inst_id)
                for r in repo_data.get("repositories", []):
                    all_repos.append({
                        "installation_id": inst_id,
                        "account": account_login,
                        "account_type": account_type,
                        "repo_full_name": r.get("full_name"),
                        "repo_name": r.get("name"),
                        "default_branch": r.get("default_branch", "main"),
                        "private": r.get("private", False),
                        "html_url": r.get("html_url") or f"https://github.com/{r.get('full_name')}",
                        "description": r.get("description") or "",
                        # GitHub's `homepage` is where the deployed site lives for most
                        # apps (Vercel/Netlify set it, and users set it by hand). The
                        # dashboard prefers it over inventing a localhost URL.
                        "homepage": r.get("homepage") or "",
                    })
            except Exception as exc:
                logger.error("Failed to fetch repositories for installation %s (%s): %s", inst_id, account_login, exc)

        return all_repos

    async def list_commits(
        self,
        owner: str,
        repo: str,
        ref: str | None = None,
        per_page: int = 30,
        installation_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """List recent commits reachable from ``ref`` (default branch when omitted).

        Normalised for the first-run briefing's commit picker. Each entry carries
        ``parents`` so the dashboard can express "only the changes this commit
        introduced" (``parents[0]...sha``) without a second round trip. Nothing is
        invented: a commit GitHub does not return simply is not listed.
        """
        headers = await self._get_auth_header(installation_id)
        params: dict[str, Any] = {"per_page": max(1, min(int(per_page), 100))}
        if ref:
            params["sha"] = ref

        url = f"https://api.github.com/repos/{owner}/{repo}/commits"
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.get(url, headers=headers, params=params)
            res.raise_for_status()
            raw = res.json()

        commits: list[dict[str, Any]] = []
        for item in raw if isinstance(raw, list) else []:
            commit = item.get("commit") or {}
            author = commit.get("author") or {}
            committer = commit.get("committer") or {}
            message = (commit.get("message") or "").strip()
            commits.append(
                {
                    "sha": item.get("sha"),
                    "message": message.splitlines()[0] if message else "(no message)",
                    "message_full": message,
                    "author": author.get("name")
                    or (item.get("author") or {}).get("login")
                    or "unknown",
                    "date": author.get("date") or committer.get("date"),
                    "parents": [p.get("sha") for p in (item.get("parents") or []) if p.get("sha")],
                    "html_url": item.get("html_url"),
                }
            )
        return commits

