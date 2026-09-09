"""GitHub App authentication, Check Runs API, and PR commenting client."""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from datetime import UTC, datetime
from typing import Any

import httpx
import jwt

logger = logging.getLogger("agent.github.app")


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
        # If no GitHub credentials present, return simulated mock check_run_id
        if not self.token and not (self.app_id and self.private_key):
            logger.info("[Mock GitHub App] Created Check Run for %s/%s at %s", owner, repo, head_sha[:8])
            return 100000 + (hash(head_sha) % 900000)

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
            logger.info(
                "[Mock GitHub App] Updated Check Run %s: conclusion=%s title=%s",
                check_run_id,
                conclusion,
                title,
            )
            return {"status": "completed", "conclusion": conclusion, "check_run_id": check_run_id}

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
            logger.info("[Mock GitHub App] Posted comment to PR #%s on %s/%s", pr_number, owner, repo)
            return f"https://github.com/{owner}/{repo}/issues/{pr_number}#issuecomment-mock"

        headers = await self._get_auth_header(installation_id)
        url = f"https://api.github.com/repos/{owner}/{repo}/issues/{pr_number}/comments"
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(url, headers=headers, json={"body": body})
            res.raise_for_status()
            return res.json()["html_url"]
