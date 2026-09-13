"""Persistence for the PR-centric result model.

The engine already stores a run's raw payload in ``runs.result``. That is enough
to render one run, but not enough to answer the questions a reviewer actually
asks — "which PRs are at risk", "what keeps regressing", "have I already
dismissed this" — because those need rows keyed by PR and by finding.

This store materializes the derived structure into ``pull_requests``,
``test_cases`` and ``findings``. It is deliberately best-effort: a database
write failure must never change the outcome of a verification run, so every
method logs and returns rather than raising into the pipeline.

Dismissal is preserved across runs: a finding a human has dismissed stays
dismissed and only has its ``occurrences`` and ``last_seen_run_id`` refreshed.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

logger = logging.getLogger("agent.db.pr_insights")


def _now() -> str:
    return datetime.now(UTC).isoformat()


class PRInsightStore:
    """Writes the PR / test-case / finding projections of a run."""

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    @property
    def client(self) -> Any | None:
        if self._client is not None:
            return self._client
        try:
            from agent.db.supabase import get_supabase_client

            self._client = get_supabase_client()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Supabase unavailable for PR insights: %s", exc)
            self._client = None
        return self._client

    def _project_id(self, repo_full_name: str) -> str | None:
        client = self.client
        if not client or not repo_full_name:
            return None
        try:
            res = (
                client.table("projects")
                .select("id")
                .eq("repo_full_name", repo_full_name)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0]["id"] if rows else None
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not resolve project for %s: %s", repo_full_name, exc)
            return None

    # -- pull requests -------------------------------------------------------

    def upsert_pull_request(
        self,
        *,
        repo_full_name: str,
        pr_number: int | None,
        title: str | None = None,
        author_login: str | None = None,
        author_type: str = "user",
        state: str = "open",
        is_draft: bool = False,
        head_branch: str | None = None,
        base_branch: str = "main",
        head_sha: str | None = None,
        html_url: str | None = None,
        added_lines: int | None = None,
        removed_lines: int | None = None,
        changed_files: int | None = None,
        opened_at: str | None = None,
        latest_run_id: str | None = None,
        tested: bool = False,
    ) -> None:
        """Insert or refresh the PR row. A PR-less run (push trigger) is a no-op."""
        client = self.client
        if not client or not repo_full_name or pr_number is None:
            return

        project_id = self._project_id(repo_full_name)
        payload: dict[str, Any] = {
            "repo_full_name": repo_full_name,
            "pr_number": int(pr_number),
            "updated_at": _now(),
        }
        for key, value in (
            ("title", title),
            ("author_login", author_login),
            ("head_branch", head_branch),
            ("head_sha", head_sha),
            ("html_url", html_url),
            ("opened_at", opened_at),
            ("added_lines", added_lines),
            ("removed_lines", removed_lines),
            ("changed_files", changed_files),
        ):
            if value is not None:
                payload[key] = value
        payload["author_type"] = author_type
        payload["state"] = state
        payload["is_draft"] = bool(is_draft)
        if base_branch:
            payload["base_branch"] = base_branch
        if project_id:
            payload["project_id"] = project_id
        if latest_run_id:
            payload["latest_run_id"] = latest_run_id
        if tested:
            payload["tested_at"] = _now()

        try:
            client.table("pull_requests").upsert(
                payload, on_conflict="repo_full_name,pr_number"
            ).execute()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not upsert pull request %s#%s: %s", repo_full_name, pr_number, exc)

    # -- test cases ----------------------------------------------------------

    def record_run_result(
        self,
        *,
        repo_full_name: str,
        run_id: str,
        pr_number: int | None,
        test_cases: list[dict[str, Any]],
        findings: list[dict[str, Any]],
        head_sha: str | None = None,
        pr_title: str | None = None,
        author_login: str | None = None,
        author_type: str = "user",
        is_draft: bool = False,
        head_branch: str | None = None,
        base_branch: str = "main",
        html_url: str | None = None,
        opened_at: str | None = None,
        added_lines: int | None = None,
        removed_lines: int | None = None,
        changed_files: int | None = None,
    ) -> None:
        """Persist a completed run's cases and findings, and refresh its PR row."""
        client = self.client
        if not client:
            return

        project_id = self._project_id(repo_full_name)
        self.upsert_pull_request(
            repo_full_name=repo_full_name,
            pr_number=pr_number,
            title=pr_title,
            author_login=author_login,
            author_type=author_type,
            is_draft=is_draft,
            head_branch=head_branch,
            base_branch=base_branch,
            head_sha=head_sha,
            html_url=html_url,
            opened_at=opened_at,
            added_lines=added_lines,
            removed_lines=removed_lines,
            changed_files=changed_files,
            latest_run_id=run_id,
            tested=True,
        )

        # Re-running the same run id (a retry) must not duplicate its cases.
        try:
            client.table("test_cases").delete().eq("run_id", run_id).execute()
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not clear previous test cases for %s: %s", run_id, exc)

        rows: list[dict[str, Any]] = []
        for case in test_cases:
            row = dict(case)
            row["run_id"] = run_id
            if project_id:
                row["project_id"] = project_id
            # `pr_number` is nullable in the table; drop an explicit None so the
            # insert does not fight the column default.
            if row.get("pr_number") is None:
                row.pop("pr_number", None)
            rows.append(row)
        if rows:
            try:
                client.table("test_cases").insert(rows).execute()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not persist test cases for run %s: %s", run_id, exc)

        self._upsert_findings(
            repo_full_name=repo_full_name,
            run_id=run_id,
            findings=findings,
            project_id=project_id,
        )

    # -- findings ------------------------------------------------------------

    def _upsert_findings(
        self,
        *,
        repo_full_name: str,
        run_id: str,
        findings: list[dict[str, Any]],
        project_id: str | None,
    ) -> None:
        client = self.client
        if not client or not findings:
            return

        # Look up existing rows in one round trip so dismissal survives.
        fingerprints = [f["fingerprint"] for f in findings if f.get("fingerprint")]
        existing: dict[str, dict[str, Any]] = {}
        if fingerprints:
            try:
                res = (
                    client.table("findings")
                    .select("id, fingerprint, status, occurrences")
                    .eq("repo_full_name", repo_full_name)
                    .in_("fingerprint", fingerprints)
                    .execute()
                )
                for row in res.data or []:
                    existing[str(row["fingerprint"])] = row
            except Exception as exc:  # noqa: BLE001
                logger.debug("Could not read existing findings: %s", exc)

        now = _now()
        for finding in findings:
            fp = finding.get("fingerprint")
            if not fp:
                continue
            current = existing.get(str(fp))
            if current:
                payload: dict[str, Any] = {
                    "severity": finding.get("severity") or "medium",
                    "category": finding.get("category"),
                    "title": finding.get("title"),
                    "detail": finding.get("detail"),
                    "route": finding.get("route"),
                    "last_seen_run_id": run_id,
                    "occurrences": int(current.get("occurrences") or 1) + 1,
                    "updated_at": now,
                }
                # A dismissed finding stays dismissed; a resolved one that comes
                # back is reopened, because that is new information.
                if current.get("status") == "resolved":
                    payload["status"] = "open"
                try:
                    client.table("findings").update(payload).eq("id", current["id"]).execute()
                except Exception as exc:  # noqa: BLE001
                    logger.debug("Could not update finding %s: %s", fp, exc)
                continue

            payload = {
                "repo_full_name": repo_full_name,
                "fingerprint": fp,
                "severity": finding.get("severity") or "medium",
                "category": finding.get("category"),
                "title": finding.get("title") or "Finding",
                "detail": finding.get("detail"),
                "route": finding.get("route"),
                "first_seen_run_id": run_id,
                "last_seen_run_id": run_id,
                "status": "open",
                "occurrences": 1,
                "created_at": now,
                "updated_at": now,
            }
            if project_id:
                payload["project_id"] = project_id
            try:
                client.table("findings").insert(payload).execute()
            except Exception as exc:  # noqa: BLE001
                logger.debug("Could not insert finding %s: %s", fp, exc)

    # -- reads used by the API ----------------------------------------------

    def list_pull_requests(self, project_ids: list[str]) -> list[dict[str, Any]]:
        client = self.client
        if not client or not project_ids:
            return []
        try:
            res = (
                client.table("pull_requests")
                .select("*")
                .in_("project_id", project_ids)
                .order("opened_at", desc=True)
                .limit(200)
                .execute()
            )
            return res.data or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not list pull requests: %s", exc)
            return []

    def list_test_cases(self, run_id: str) -> list[dict[str, Any]]:
        client = self.client
        if not client or not run_id:
            return []
        try:
            res = (
                client.table("test_cases")
                .select("*")
                .eq("run_id", run_id)
                .order("severity")
                .execute()
            )
            return res.data or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not list test cases for %s: %s", run_id, exc)
            return []

    def previous_test_cases(
        self,
        *,
        repo_full_name: str,
        branch: str,
        exclude_run_id: str | None = None,
        limit: int = 300,
    ) -> list[dict[str, Any]]:
        """The most recent earlier run's test cases for this repo and branch.

        This is what makes the incremental report honest: a case that passed
        before and fails now is a regression, and a case the diff did not touch
        is carried forward rather than dropped from the report.
        """
        client = self.client
        if not client or not repo_full_name or not branch:
            return []
        project_id = self._project_id(repo_full_name)
        if not project_id:
            return []
        try:
            query = (
                client.table("runs")
                .select("id")
                .eq("project_id", project_id)
                .eq("branch", branch)
            )
            if exclude_run_id:
                query = query.neq("id", exclude_run_id)
            runs = query.order("created_at", desc=True).limit(1).execute()
            rows = runs.data or []
            if not rows:
                return []
            previous_run_id = rows[0]["id"]
            cases = (
                client.table("test_cases")
                .select("*")
                .eq("run_id", previous_run_id)
                .limit(limit)
                .execute()
            )
            return cases.data or []
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not load previous test cases for %s: %s", repo_full_name, exc)
            return []

    def list_findings(self, repo_full_name: str, status: str | None = None) -> list[dict[str, Any]]:
        client = self.client
        if not client or not repo_full_name:
            return []
        try:
            query = client.table("findings").select("*").eq("repo_full_name", repo_full_name)
            if status:
                query = query.eq("status", status)
            res = query.order("updated_at", desc=True).limit(500).execute()
            return res.data or []
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not list findings for %s: %s", repo_full_name, exc)
            return []

    def set_finding_status(
        self,
        *,
        project_ids: list[str],
        finding_id: str,
        status: str,
        dismissed_by: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any] | None:
        """Dismiss / reopen a finding, scoped to projects the caller owns."""
        client = self.client
        if not client or not finding_id:
            return None
        try:
            lookup = client.table("findings").select("id, project_id").eq("id", finding_id).limit(1).execute()
            rows = lookup.data or []
            if not rows:
                return None
            row = rows[0]
            if row.get("project_id") not in project_ids:
                return None
            payload: dict[str, Any] = {"status": status, "updated_at": _now()}
            if status == "dismissed":
                payload["dismissed_at"] = _now()
                payload["dismissed_by"] = dismissed_by
                payload["dismiss_reason"] = reason
            else:
                payload["dismissed_at"] = None
                payload["dismissed_by"] = None
                payload["dismiss_reason"] = None
            res = client.table("findings").update(payload).eq("id", finding_id).execute()
            return (res.data or [None])[0]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not update finding %s: %s", finding_id, exc)
            return None


default_pr_insight_store = PRInsightStore()
