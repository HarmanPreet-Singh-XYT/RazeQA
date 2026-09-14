"""AutoQA AI Copilot — a grounded chat endpoint for the dashboard assistant.

The dashboard copilot used to be pure theatre: ``web/components/agent-modal.tsx``
keyword-matched the user's message and replied with canned strings, inventing a
``run-<timestamp>`` id whenever it "triggered" a run. This module replaces that
with a real model call grounded in the actual project document and run history,
plus a genuine dispatch through the normal run pipeline.

Design notes
------------
* **The web layer supplies context.** The dashboard already resolves the active
  project (tenant-scoped) and its recent runs, so the request carries a compact
  context block rather than the engine re-deriving ownership. Nothing here
  trusts the caller for authorisation — the endpoint sits behind the same
  bearer-token middleware as every other route, and the web proxy refuses to
  forward a repo outside the caller's scope.
* **Triggering is explicit and observable.** A trigger only happens when the
  caller passes ``allow_trigger`` and the message clearly asks for a run. The
  reply then reports the *real* run id and status returned by the pipeline, so
  a failed dispatch is never dressed up as a success.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field
from strands import tool

from agent.models.factory import (
    ModelRole,
    create_strands_agent,
    has_api_key_for_role,
    resolve_model_id,
)

logger = logging.getLogger("agent.api.copilot")
router = APIRouter(prefix="/api/copilot", tags=["copilot"])

#: Conversation turns kept for the model. Older turns are dropped first so a
#: long-lived modal session cannot grow the prompt without bound.
MAX_HISTORY_MESSAGES = 16

#: Run records included in the grounding context.
MAX_CONTEXT_RUNS = 12

#: Hard ceiling on the per-turn tool budget, whatever the caller asks for.
MAX_TOOL_BUDGET = 20

#: Permission modes, from least to most capable. The mode decides which tools
#: are callable at all, and which need an explicit human approval first.
#:
#: - ``read_only``   — inspection only; nothing changes anywhere.
#: - ``standard``    — reads, reversible triage, and dispatching a run. Actions
#:                     that touch code or third parties need an approval.
#: - ``autonomous``  — everything, without asking. Still fully trace-recorded.
AgentMode = Literal["read_only", "standard", "autonomous"]

#: Tools that never change state, in any mode.
READ_ONLY_TOOLS = frozenset(
    {
        "get_project_overview",
        "list_recent_runs",
        "get_run_details",
        "list_findings",
        "search_findings",
        "compare_runs",
        "list_pull_requests",
        "get_pull_request",
        "list_recent_commits",
        "list_saved_tests",
        "get_quality_analytics",
        # Workspace reads. Listed here so read-only mode does not block them —
        # they are the *only* reads available in a workspace session.
        "list_projects",
        "get_workspace_overview",
    }
)

#: Reads that only mean something when no single project is selected. They are
#: built into the toolset only for a workspace turn (a project session has no
#: use for them), but they are ordinary read-only tools for authorization.
WORKSPACE_TOOLS = frozenset(
    {
        "list_projects",
        "get_workspace_overview",
    }
)

#: Tools that change state but are cheap and reversible. Allowed in ``standard``
#: and ``autonomous``; refused in ``read_only``.
REVERSIBLE_TOOLS = frozenset(
    {
        "trigger_verification",
        "audit_external_site",
        "set_finding_status",
    }
)

#: Tools that change code or reach a third party. Allowed without asking only in
#: ``autonomous``; in ``standard`` they pause for an explicit approval.
APPROVAL_REQUIRED_TOOLS = frozenset(
    {
        "apply_run_fix",
        "comment_on_pull_request",
    }
)

ALL_TOOLS = READ_ONLY_TOOLS | REVERSIBLE_TOOLS | APPROVAL_REQUIRED_TOOLS | WORKSPACE_TOOLS


def action_signature(name: str, args: dict[str, Any]) -> str:
    """Stable id for "this tool with these arguments", used for approvals.

    The signature is what the user approves and what the next turn presents
    back, so an approval cannot be replayed against different arguments.
    """
    payload = json.dumps(args, sort_keys=True, default=str)
    digest = hashlib.sha256(payload.encode()).hexdigest()[:16]
    return f"{name}:{digest}"


class PendingApproval(BaseModel):
    """A tool call the agent wanted to make but is waiting on the user for."""

    action_id: str
    tool: str
    input: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    risk: Literal["write", "external"] = "write"


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ProjectContext(BaseModel):
    """The active project as the dashboard sees it."""

    repo_full_name: str = ""
    name: str = ""
    type: str = "git"
    default_branch: str = "main"
    framework: str = ""
    target_url: str = ""
    settings: dict[str, Any] = Field(default_factory=dict)


class WorkspaceContext(BaseModel):
    """The repositories this turn may read when no single project is selected.

    The web layer resolves this from the caller's tenant scope. It exists so a
    fleet-wide question can be answered across *their* projects without the
    copilot ever being able to name a repository itself: every workspace tool
    validates against this allowlist, and an unknown repo is refused rather
    than looked up.
    """

    label: str = "Workspace"
    repos: list[ProjectContext] = Field(default_factory=list)

    def allowlist(self) -> set[str]:
        return {r.repo_full_name for r in self.repos if r.repo_full_name}


class RunContext(BaseModel):
    run_id: str = ""
    branch: str = ""
    sha: str = ""
    status: str = ""
    scope: str = ""
    test_type: str = ""
    created_at: str = ""
    completed_at: str | None = None
    summary: str = ""


class CopilotChatRequest(BaseModel):
    message: str
    history: list[ChatTurn] = Field(default_factory=list)
    project: ProjectContext | None = None
    #: Set *instead of* ``project`` when the question is about the whole
    #: workspace rather than one project. Mutually exclusive by construction:
    #: the web layer sends one or the other.
    workspace: WorkspaceContext | None = None
    runs: list[RunContext] = Field(default_factory=list)
    #: Whether the caller permits this turn to dispatch a real test run.
    allow_trigger: bool = True
    #: Commit/branch the web layer already resolved for the active project.
    branch: str = "main"
    sha: str | None = None
    #: Permission mode for this session (see :data:`AgentMode`).
    mode: AgentMode = "standard"
    #: Action ids the user approved for this turn, from a previous response's
    #: ``pending_approvals``. Replaying the turn with these lets the same tool
    #: call through.
    approvals: list[str] = Field(default_factory=list)
    #: Maximum tool calls the agent may make this turn.
    max_tool_calls: int = 8
    #: Optional provider override for the reasoning model ("anthropic", "bedrock", "gemini").
    provider: str | None = None
    #: Defaults used when the agent dispatches a run.
    scope: str = "changed"
    test_type: str = "functional"


class ToolCallTrace(BaseModel):
    """One tool invocation, recorded for the transcript and the UI."""

    name: str
    status: Literal["ok", "error", "denied", "pending_approval"] = "ok"
    input: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""


class CopilotChatResponse(BaseModel):
    reply: str
    model: str
    provider: str
    triggered_run: dict[str, Any] | None = None
    #: Tools the agent chose to call this turn, in order. The dashboard renders
    #: these so the user can see what the answer was actually grounded in.
    tool_calls: list[ToolCallTrace] = Field(default_factory=list)
    #: Write actions the agent wanted to take but could not without approval.
    pending_approvals: list[PendingApproval] = Field(default_factory=list)
    #: Tool calls used this turn, against the budget that was in force.
    steps_used: int = 0
    max_tool_calls: int = 8


# ---------------------------------------------------------------------------
# Intent routing
# ---------------------------------------------------------------------------

#: Verbs that mean "start a run". Kept deliberately narrow: "explain the
#: failures" must not dispatch anything, and the model is not asked to decide
#: whether to spend money — this deterministic check gates it.
_TRIGGER_PHRASES = (
    "run test",
    "run the test",
    "run a test",
    "run tests",
    "run the tests",
    "trigger test",
    "trigger a test",
    "trigger run",
    "trigger a run",
    "trigger verification",
    "trigger an audit",
    "trigger audit",
    "start a run",
    "start the run",
    "verify this branch",
    "verify the branch",
    "verify my branch",
    "verify active branch",
    "test this branch",
    "audit this site",
    "audit the site",
    "run an audit",
    "run a full audit",
    "re-run",
    "rerun",
)

#: Phrases that look like a trigger but are questions about runs, not requests
#: to start one.
_NON_TRIGGER_QUESTIONS = (
    "how do i",
    "how can i",
    "what happens",
    "what does",
    "why did",
    "status of my",
    "status of the",
    "when did",
)


def wants_run(message: str) -> bool:
    """True when the message is a request to start a test run.

    This is intentionally a small, auditable rule set rather than a model call:
    dispatching a run spends real time and tokens, so the decision to do it
    should be predictable and testable.
    """
    text = message.strip().lower()
    if not text:
        return False
    if any(q in text for q in _NON_TRIGGER_QUESTIONS):
        return False
    if any(phrase in text for phrase in _TRIGGER_PHRASES):
        return True
    # Bare imperatives ("verify all routes", "test the checkout flow") only
    # count when the message reads as a command rather than a question.
    if text.endswith("?"):
        return False
    return text.startswith(("run ", "trigger ", "verify ", "audit ", "re-test ", "retest "))


# ---------------------------------------------------------------------------
# Agent tools
#
# The copilot is a tool-using agent, not a single grounded prompt. Every tool is
# built per request and closes over the *resolved* project, so a tool can never
# be pointed at a repository the caller did not ask about — the model supplies
# arguments like `run_id`, never a repo name.
# ---------------------------------------------------------------------------

#: Rows a single tool call may return. The model does not need more, and this
#: keeps a tool result from swallowing the context window.
MAX_TOOL_ROWS = 25

#: Result keys worth surfacing in a prompt or a run card. Everything else in a
#: run payload stays out of the model's context.
_RESULT_SUMMARY_KEYS = (
    "passed",
    "failed",
    "total",
    "duration_ms",
    "duration",
    "status",
    "error",
    "message",
)


@dataclass
class _TurnState:
    """Mutable per-turn state shared by the tools built for one request."""

    request: CopilotChatRequest
    triggered: dict[str, Any] | None = None
    #: Tool calls used so far this turn, against ``request.max_tool_calls``.
    steps: int = 0
    #: Write actions the agent asked for but was not allowed to take yet.
    pending: list[PendingApproval] = field(default_factory=list)
    #: The request's background-task collector. Tools that schedule work (the
    #: apply-fix re-verification) attach to it so the work actually runs after
    #: the response is sent, instead of being dropped.
    background: Any = None

    @property
    def mode(self) -> str:
        return self.request.mode

    @property
    def budget(self) -> int:
        return max(1, min(int(self.request.max_tool_calls or 8), MAX_TOOL_BUDGET))

    def exhausted(self) -> bool:
        return self.steps >= self.budget


def _text_result(payload: Any, status: str = "success") -> dict[str, Any]:
    """Wrap a tool payload in the shape Strands expects from a tool."""
    return {"status": status, "content": [{"text": json.dumps(payload, default=str)}]}


def _record(
    trace: list[ToolCallTrace],
    name: str,
    args: dict[str, Any],
    status: Literal["ok", "error", "denied", "pending_approval"],
    summary: str,
) -> None:
    trace.append(
        ToolCallTrace(name=name, status=status, input=args, summary=summary[:600])
    )


def _authorize(
    state: _TurnState,
    trace: list[ToolCallTrace],
    name: str,
    args: dict[str, Any],
    summary: str,
    risk: Literal["write", "external"] = "write",
) -> dict[str, Any] | None:
    """Gate one tool call. Returns a refusal payload, or ``None`` to proceed.

    Order matters: the budget is spent first (so a refusal still counts, which
    stops the model from spinning), then the mode, then the approval.
    """
    if state.exhausted():
        _record(trace, name, args, "error", "Tool budget exhausted")
        return _text_result(
            {
                "error": (
                    f"Tool budget exhausted ({state.budget} calls this turn). "
                    "Answer now using what you already have."
                )
            },
            status="error",
        )

    state.steps += 1

    if name not in ALL_TOOLS:
        _record(trace, name, args, "denied", "Unknown tool")
        return _text_result({"error": f"Unknown tool: {name}"}, status="error")

    if state.mode == "read_only" and name not in READ_ONLY_TOOLS:
        _record(trace, name, args, "denied", "Blocked by read-only mode")
        return _text_result(
            {
                "error": (
                    f"'{name}' is blocked: this session is in read-only mode. Tell the "
                    "user the action needs a more permissive mode."
                )
            },
            status="error",
        )

    if name in APPROVAL_REQUIRED_TOOLS and state.mode != "autonomous":
        action_id = action_signature(name, args)
        if action_id not in set(state.request.approvals or ()):
            state.pending.append(
                PendingApproval(
                    action_id=action_id,
                    tool=name,
                    input=args,
                    summary=summary,
                    risk=risk,
                )
            )
            _record(trace, name, args, "pending_approval", summary)
            return _text_result(
                {
                    "status": "pending_approval",
                    "action_id": action_id,
                    "message": (
                        "Not executed: this action needs the user's explicit approval. "
                        "Tell the user what you want to do and stop."
                    ),
                },
                status="error",
            )

    return None


def _project_key(repo: str) -> str | None:
    """Resolve a repo full name to its project row id, when Supabase is on."""
    try:
        from agent.db.pr_insights import PRInsightStore

        return PRInsightStore()._project_id(repo)
    except Exception as exc:  # noqa: BLE001 - absence is not an error here
        logger.debug("Could not resolve project id for %s: %s", repo, exc)
        return None


def _split_repo(repo: str) -> tuple[str, str]:
    owner, _, name = (repo or "").partition("/")
    return owner, name


def _installation_id(request: CopilotChatRequest) -> int | None:
    """The GitHub App installation for this project, when the web layer sent one."""
    raw = (request.project.settings if request.project else {}) or {}
    value = raw.get("installation_id")
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _summarize_result(result: Any) -> str:
    """A short, human-readable digest of a run payload.

    Run results are large and provider-specific; the model only needs the
    outcome, not the whole artifact tree.
    """
    if not isinstance(result, dict):
        return ""

    bits: list[str] = []
    for key in _RESULT_SUMMARY_KEYS:
        value = result.get(key)
        if value not in (None, "", [], {}):
            bits.append(f"{key}={value}")

    findings = result.get("findings") or result.get("issues") or []
    if isinstance(findings, list) and findings:
        titles: list[str] = []
        for item in findings[:5]:
            if isinstance(item, dict):
                title = item.get("title") or item.get("message") or item.get("category")
                severity = item.get("severity")
                if title:
                    titles.append(f"[{severity}] {title}" if severity else str(title))
            elif item:
                titles.append(str(item))
        if titles:
            bits.append("findings: " + "; ".join(titles))

    return " ".join(bits)[:700]


def _record_repo(data: dict[str, Any]) -> str:
    """The repository a run record really belongs to.

    Every engine record is stamped ``repo: "default"`` and keeps the real
    repository in ``result.owner`` / ``result.repo``. Comparing against
    "default" denied every run, so resolve it before any ownership check.
    """
    direct = str(data.get("repo_full_name") or data.get("repo") or "")
    if direct and direct != "default":
        return direct
    result = data.get("result")
    if isinstance(result, dict):
        name = str(result.get("repo_full_name") or result.get("repo") or "")
        if name:
            if "/" in name:
                return name
            owner = str(result.get("owner") or data.get("owner") or "")
            if owner:
                return f"{owner}/{name}"
    return direct


def _run_row(record: Any) -> dict[str, Any]:
    """Normalise an in-memory or Supabase RunRecord into a compact row."""
    if hasattr(record, "model_dump"):
        data = record.model_dump()
    elif isinstance(record, dict):
        data = record
    else:
        data = {}

    sha = str(data.get("sha") or "")
    return {
        "run_id": str(data.get("run_id") or data.get("id") or ""),
        "status": data.get("status") or "",
        "branch": data.get("branch") or "",
        "sha": sha[:12],
        "scope": data.get("scope") or "",
        "test_type": data.get("test_type") or "",
        "repo": _record_repo(data),
        "created_at": data.get("created_at") or "",
        "completed_at": data.get("completed_at"),
        "summary": _summarize_result(data.get("result")),
        "video_url": data.get("video_url"),
        "trace_url": data.get("trace_url"),
    }


def build_copilot_tools(state: _TurnState, trace: list[ToolCallTrace]) -> list[Any]:
    """Build the tool set for one copilot turn.

    Every tool is scoped to the project this turn resolved: the model chooses
    *what* to look at or change, never *which* repository. Each call is checked
    against the session's permission mode and tool budget by :func:`_authorize`
    before it runs, and recorded in ``trace`` either way.

    Args:
        state: Per-turn state carrying the mode, budget, approvals, and the
            shared dispatch slot.
        trace: Append-only record of tool calls, returned to the dashboard.

    Returns:
        Tools to hand to :func:`create_strands_agent`.
    """
    request = state.request
    project = request.project
    repo = (project.repo_full_name if project else "") or ""
    owner, repo_name = _split_repo(repo)
    installation_id = _installation_id(request)

    # Workspace mode: no single project, an allowlist of repos instead. The
    # model may choose *among* these and nothing else — the allowlist is the
    # only thing standing between a fleet-wide question and another tenant.
    workspace = request.workspace
    workspace_repos: dict[str, ProjectContext] = (
        {r.repo_full_name: r for r in workspace.repos if r.repo_full_name}
        if workspace
        else {}
    )
    is_workspace = bool(workspace_repos) and not repo

    def target_repo(target: str = "") -> tuple[str, dict[str, Any] | None]:
        """Resolve a model-supplied repo to what this turn may actually read.

        A project turn may only touch its own repo; a workspace turn may touch
        any repo the web layer allowlisted, and an empty value means "all of
        them" — never "whatever the model happened to name".
        """
        wanted = (target or "").strip()
        if is_workspace:
            if not wanted:
                return "", None
            if wanted not in workspace_repos:
                return "", {"error": f"'{wanted}' is not one of this workspace's projects."}
            return wanted, None
        if wanted and wanted != repo:
            return "", {"error": f"'{wanted}' is not the active project."}
        return repo, None

    def repo_may_read(candidate: str) -> bool:
        """True when this turn is allowed to read the given repository."""
        name = (candidate or "").strip()
        if not name:
            return False
        return name in workspace_repos if is_workspace else name == repo

    def denied(name: str, args: dict[str, Any], summary: str, risk: Literal["write", "external"] = "write") -> dict[str, Any] | None:
        return _authorize(state, trace, name, args, summary, risk)

    async def dispatch(scope: str, test_type: str) -> dict[str, Any]:
        """Dispatch through the shared slot so a turn never starts two runs."""
        if state.triggered is not None:
            return {"already_dispatched": True, **state.triggered}
        dispatched = await _dispatch_run_async(request, scope=scope, test_type=test_type)
        state.triggered = {
            "run_id": dispatched.get("run_id"),
            "status": dispatched.get("status"),
            "repo": dispatched.get("repo") or repo,
            "branch": dispatched.get("branch") or request.branch,
            "message": dispatched.get("message"),
            "fresh": dispatched.get("fresh"),
        }
        return dict(state.triggered)

    # -- reads --------------------------------------------------------------

    @tool
    def get_project_overview(target: str = "") -> dict[str, Any]:
        """Get one project's identity, configuration, and recorded totals.

        Use this for "what is this project?" / "how is it configured?" questions,
        or to find the framework, default branch, and live URL.

        #Args:
            target: The project's `repo_full_name`. Only needed in a workspace
                session; a project session always means its own project.

        #Returns:
            A JSON object with the project row, its non-secret settings, and how
            many runs and findings are recorded for it.
        """
        args: dict[str, Any] = {"target": (target or "").strip()}
        if refusal := denied("get_project_overview", args, "Read project overview"):
            return refusal

        chosen, err = target_repo(target)
        if err:
            _record(trace, "get_project_overview", args, "denied", err["error"])
            return _text_result(err, status="error")
        if not chosen:
            _record(trace, "get_project_overview", args, "error", "No project selected")
            return _text_result(
                {
                    "error": (
                        "No single project is selected. Pass `target` (the repo_full_name "
                        "from list_projects), or call get_workspace_overview for the whole "
                        "workspace."
                    )
                },
                status="error",
            )

        ctx = workspace_repos.get(chosen) if is_workspace else project
        overview: dict[str, Any] = {
            "repo_full_name": chosen,
            "name": (ctx.name if ctx else "") or chosen.split("/")[-1],
            "kind": (ctx.type if ctx else "git"),
            "default_branch": (ctx.default_branch if ctx else "") or "main",
            "framework": (ctx.framework if ctx else "") or "",
            "target_url": (ctx.target_url if ctx else "") or "",
            "settings": _safe_settings(ctx.settings if ctx else {}),
        }

        try:
            runs = get_run_store().list_all(repo=chosen, limit=200)
            overview["run_count"] = len(runs)
            last = runs[0] if runs else None
            if last is not None:
                overview["latest_run"] = _run_row(last)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Copilot tool get_project_overview: runs unavailable: %s", exc)

        try:
            from agent.db.pr_insights import PRInsightStore

            findings = PRInsightStore().list_findings(chosen)
            by_status: dict[str, int] = {}
            for row in findings or []:
                key = str((row or {}).get("status") or "unknown")
                by_status[key] = by_status.get(key, 0) + 1
            overview["finding_counts"] = by_status
        except Exception as exc:  # noqa: BLE001
            logger.debug("Copilot tool get_project_overview: findings unavailable: %s", exc)

        _record(trace, "get_project_overview", args, "ok", f"overview for {chosen}")
        return _text_result(overview)
    @tool
    def list_recent_runs(limit: int = 10, target: str = "") -> dict[str, Any]:
        """List the most recent test runs, newest first.

        Use this when the run history already in the prompt is not enough: to
        look further back, to count how often something failed, or to find the
        run id of a specific commit before drilling into it.

        #Args:
            limit: How many runs to return, from 1 to 25 (default: 10).
            target: A `repo_full_name` to narrow to. In a workspace session an
                empty value covers every project; in a project session this is
                always its own project.

        #Returns:
            A JSON object with the scope covered, the row count, and one compact
            row per run (repo, run_id, status, branch, sha, timestamps, summary).
        """
        count = max(1, min(int(limit or 10), MAX_TOOL_ROWS))
        args = {"limit": count, "target": (target or "").strip()}

        if refusal := denied("list_recent_runs", args, "Read recent runs"):
            return refusal
        chosen, err = target_repo(target)
        if err:
            _record(trace, "list_recent_runs", args, "denied", err["error"])
            return _text_result(err, status="error")
        if not chosen and not is_workspace:
            _record(trace, "list_recent_runs", args, "error", "No active project")
            return _text_result(
                {"error": "No active project is selected, so there are no runs to list."},
                status="error",
            )

        names = [chosen] if chosen else sorted(workspace_repos)

        try:
            from agent.api.runs import get_run_store

            store = get_run_store()
            rows: list[dict[str, Any]] = []
            for name in names:
                for record in (store.list_all(repo=name, limit=count) or [])[:count]:
                    row = _run_row(record)
                    row["repo"] = row.get("repo") or name
                    rows.append(row)
        except Exception as exc:  # noqa: BLE001 - a tool failure must not 500 the turn
            logger.warning("Copilot tool list_recent_runs failed: %s", exc)
            _record(trace, "list_recent_runs", args, "error", str(exc))
            return _text_result({"error": f"Could not read runs: {exc}"}, status="error")

        rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        rows = rows[:count]
        scope = chosen or ("workspace" if is_workspace else repo)
        _record(trace, "list_recent_runs", args, "ok", f"{len(rows)} run(s) from {scope}")
        return _text_result({"scope": scope, "count": len(rows), "runs": rows})
    @tool
    def get_run_details(run_id: str) -> dict[str, Any]:
        """Fetch one run by id, with its recorded result and per-test-case rows.

        Use this after `list_recent_runs` when the user asks *why* a specific
        run failed, rather than how the project is doing overall.

        #Args:
            run_id: The run id exactly as shown in the dashboard, e.g. run_ab12cd34ef56.

        #Returns:
            A JSON object with the run row, its result summary, and up to 25 test
            cases (name, status, severity, error).
        """
        rid = (run_id or "").strip()
        args = {"run_id": rid}

        if refusal := denied("get_run_details", args, "Read run details"):
            return refusal
        if not rid:
            _record(trace, "get_run_details", args, "error", "No run id supplied")
            return _text_result({"error": "A run_id is required."}, status="error")

        try:
            from agent.api.runs import get_run_store

            record = get_run_store().get(rid)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Copilot tool get_run_details failed: %s", exc)
            _record(trace, "get_run_details", args, "error", str(exc))
            return _text_result({"error": f"Could not read run {rid}: {exc}"}, status="error")

        if not record:
            _record(trace, "get_run_details", args, "error", "Run not found")
            return _text_result({"error": f"Run {rid} was not found."}, status="error")

        row = _run_row(record)

        # A run fetched by id must still belong to the project this turn is
        # scoped to; otherwise the model could read across projects.
        record_repo = str(row.get("repo") or "")
        # A workspace turn must prove the run belongs to an allowlisted repo.
        # A project turn is already confined to its own repo; a record whose
        # repo could not be resolved (legacy in-memory rows) is still its own.
        if is_workspace:
            allowed = repo_may_read(record_repo)
        else:
            allowed = not record_repo or record_repo == "default" or record_repo == repo
        if not allowed:
            _record(trace, "get_run_details", args, "denied", "Run belongs to another project")
            return _text_result(
                {"error": f"Run {rid} does not belong to the projects in scope."},
                status="error",
            )

        cases = _test_case_rows(rid)
        _record(
            trace,
            "get_run_details",
            args,
            "ok",
            f"run {rid} status={row.get('status') or 'unknown'}, {len(cases)} case(s)",
        )
        return _text_result({"run": row, "test_cases": cases})

    @tool
    def list_findings(status: str = "open", limit: int = 15, target: str = "") -> dict[str, Any]:
        """List recorded findings (defects).

        Use this for "what is broken", "what is still open", or "what keeps
        regressing" — it is the deduplicated view, unlike raw per-run payloads.

        #Args:
            status: "open" (default), "dismissed", or "all".
            limit: How many findings to return, from 1 to 25 (default: 15).
            target: A `repo_full_name` to narrow to. In a workspace session an
                empty value covers every project.

        #Returns:
            A JSON object with one row per finding: repo, id, title, severity,
            category, status, how many runs it appeared in, and last seen run.
        """
        wanted = (status or "open").strip().lower()
        count = max(1, min(int(limit or 15), MAX_TOOL_ROWS))
        args = {"status": wanted or "open", "limit": count, "target": (target or "").strip()}

        if refusal := denied("list_findings", args, "Read findings"):
            return refusal
        chosen, err = target_repo(target)
        if err:
            _record(trace, "list_findings", args, "denied", err["error"])
            return _text_result(err, status="error")
        if not chosen and not is_workspace:
            _record(trace, "list_findings", args, "error", "No active project")
            return _text_result(
                {"error": "No active project is selected, so there are no findings to list."},
                status="error",
            )

        names = [chosen] if chosen else sorted(workspace_repos)
        findings: list[dict[str, Any]] = []
        for name in names:
            rows, error = _load_findings(name, None if wanted in ("all", "") else wanted)
            if error:
                _record(trace, "list_findings", args, "error", error)
                return _text_result({"error": error}, status="error")
            for row in rows:
                findings.append({**_finding_row(row), "repo_full_name": name})

        findings = findings[:count]
        scope = chosen or ("workspace" if is_workspace else repo)
        _record(trace, "list_findings", args, "ok", f"{len(findings)} finding(s) from {scope}")
        return _text_result(
            {"scope": scope, "status": args["status"], "count": len(findings), "findings": findings}
        )
    @tool
    def search_findings(query: str, limit: int = 10) -> dict[str, Any]:
        """Search the active project's findings by text, across every status.

        Use this for "have we seen this before?", "is there anything about
        checkout?", or to check whether a specific error is already tracked.

        #Args:
            query: Text to match against a finding's title, category, or message.
            limit: How many matches to return, from 1 to 25 (default: 10).

        #Returns:
            A JSON object with the matching findings, newest first.
        """
        needle = (query or "").strip().lower()
        count = max(1, min(int(limit or 10), MAX_TOOL_ROWS))
        args = {"query": needle, "limit": count}

        if refusal := denied("search_findings", args, "Search findings"):
            return refusal
        if not needle:
            _record(trace, "search_findings", args, "error", "Empty query")
            return _text_result({"error": "A search query is required."}, status="error")
        if not repo:
            _record(trace, "search_findings", args, "error", "No active project")
            return _text_result({"error": "No active project is selected."}, status="error")

        rows, error = _load_findings(repo, None)
        if error:
            _record(trace, "search_findings", args, "error", error)
            return _text_result({"error": error}, status="error")

        matches: list[dict[str, Any]] = []
        for row in rows:
            haystack = " ".join(
                str((row or {}).get(key) or "")
                for key in ("title", "category", "message", "description", "severity")
            ).lower()
            if needle in haystack:
                matches.append(_finding_row(row))
            if len(matches) >= count:
                break

        _record(trace, "search_findings", args, "ok", f"{len(matches)} match(es)")
        return _text_result({"repo": repo, "query": needle, "count": len(matches), "findings": matches})

    @tool
    def compare_runs(base_run_id: str, head_run_id: str) -> dict[str, Any]:
        """Compare two runs' test cases to find regressions and recoveries.

        Use this for "what broke between these two runs?" — a case that passed in
        the base run and failed in the head run is a regression.

        #Args:
            base_run_id: The earlier run id (the known-good side).
            head_run_id: The later run id (the side being judged).

        #Returns:
            A JSON object listing the base and head statuses, plus regressions,
            recoveries, and cases that are still failing in both.
        """
        args = {"base_run_id": (base_run_id or "").strip(), "head_run_id": (head_run_id or "").strip()}
        if refusal := denied("compare_runs", args, "Compare two runs"):
            return refusal
        if not args["base_run_id"] or not args["head_run_id"]:
            _record(trace, "compare_runs", args, "error", "Two run ids are required")
            return _text_result({"error": "Both base_run_id and head_run_id are required."}, status="error")

        base = _test_case_rows(args["base_run_id"])
        head = _test_case_rows(args["head_run_id"])
        if not base and not head:
            _record(trace, "compare_runs", args, "error", "No test cases recorded")
            return _text_result(
                {"error": "Neither run has recorded test cases to compare."}, status="error"
            )

        base_by_name = {row["name"]: row for row in base if row.get("name")}
        head_by_name = {row["name"]: row for row in head if row.get("name")}

        regressions: list[dict[str, Any]] = []
        recoveries: list[dict[str, Any]] = []
        still_failing: list[dict[str, Any]] = []

        for name, head_row in head_by_name.items():
            head_failed = _is_failure(head_row.get("status"))
            base_row = base_by_name.get(name)
            if base_row is None:
                continue
            base_failed = _is_failure(base_row.get("status"))
            if not base_failed and head_failed:
                regressions.append({"name": name, "base": base_row["status"], "head": head_row["status"]})
            elif base_failed and not head_failed:
                recoveries.append({"name": name, "base": base_row["status"], "head": head_row["status"]})
            elif base_failed and head_failed:
                still_failing.append({"name": name, "status": head_row["status"]})

        summary = (
            f"{len(regressions)} regression(s), {len(recoveries)} recovery(ies), "
            f"{len(still_failing)} still failing"
        )
        _record(trace, "compare_runs", args, "ok", summary)
        return _text_result(
            {
                "base_run_id": args["base_run_id"],
                "head_run_id": args["head_run_id"],
                "regressions": regressions[:MAX_TOOL_ROWS],
                "recoveries": recoveries[:MAX_TOOL_ROWS],
                "still_failing": still_failing[:MAX_TOOL_ROWS],
            }
        )

    @tool
    def list_pull_requests(state_filter: str = "open", limit: int = 10) -> dict[str, Any]:
        """List pull requests recorded for the active project.

        Use this for "which PRs are at risk?" or to find a PR number before
        looking at it or commenting on it.

        #Args:
            state_filter: "open" (default), "closed", "merged", or "all".
            limit: How many PRs to return, from 1 to 25 (default: 10).

        #Returns:
            A JSON object with one row per PR: number, title, author, state,
            branch, and its latest recorded verification status.
        """
        wanted = (state_filter or "open").strip().lower()
        count = max(1, min(int(limit or 10), MAX_TOOL_ROWS))
        args = {"state_filter": wanted, "limit": count}

        if refusal := denied("list_pull_requests", args, "Read pull requests"):
            return refusal
        if not repo:
            _record(trace, "list_pull_requests", args, "error", "No active project")
            return _text_result({"error": "No active project is selected."}, status="error")

        rows: list[dict[str, Any]] = []
        project_id = _project_key(repo)
        if project_id:
            try:
                from agent.db.pr_insights import PRInsightStore

                rows = PRInsightStore().list_pull_requests([project_id]) or []
            except Exception as exc:  # noqa: BLE001
                logger.debug("Copilot tool list_pull_requests: store unavailable: %s", exc)

        if wanted not in ("all", ""):
            rows = [
                row
                for row in rows
                if str((row or {}).get("state") or "").lower() == wanted
            ]

        pulls = [
            {
                "pr_number": row.get("pr_number") or row.get("number"),
                "title": row.get("title") or "",
                "author": row.get("author_login") or row.get("author") or "",
                "state": row.get("state") or "",
                "head_branch": row.get("head_branch") or row.get("branch") or "",
                "base_branch": row.get("base_branch") or "",
                "last_status": row.get("last_status") or row.get("status") or "",
                "updated_at": row.get("updated_at") or row.get("opened_at") or "",
            }
            for row in rows[:count]
        ]
        _record(trace, "list_pull_requests", args, "ok", f"{len(pulls)} pull request(s)")
        return _text_result({"repo": repo, "count": len(pulls), "pull_requests": pulls})

    @tool
    def get_pull_request(pr_number: int) -> dict[str, Any]:
        """Fetch one pull request's recorded detail for the active project.

        #Args:
            pr_number: The pull request number, as shown on GitHub.

        #Returns:
            A JSON object with the PR row, including its branch and last recorded
            verification status.
        """
        number = int(pr_number or 0)
        args = {"pr_number": number}

        if refusal := denied("get_pull_request", args, "Read a pull request"):
            return refusal
        if not number:
            _record(trace, "get_pull_request", args, "error", "A pr_number is required")
            return _text_result({"error": "A pr_number is required."}, status="error")

        project_id = _project_key(repo)
        if not project_id:
            _record(trace, "get_pull_request", args, "error", "Project not resolvable")
            return _text_result(
                {"error": "This project has no stored rows yet, so PR detail is unavailable."},
                status="error",
            )

        try:
            from agent.db.pr_insights import PRInsightStore

            rows = PRInsightStore().list_pull_requests([project_id]) or []
        except Exception as exc:  # noqa: BLE001
            _record(trace, "get_pull_request", args, "error", str(exc))
            return _text_result({"error": f"Could not read pull requests: {exc}"}, status="error")

        for row in rows:
            candidate = row.get("pr_number") or row.get("number")
            if str(candidate) == str(number):
                _record(trace, "get_pull_request", args, "ok", f"PR #{number}")
                return _text_result({"pull_request": row})

        _record(trace, "get_pull_request", args, "error", "PR not found")
        return _text_result({"error": f"PR #{number} is not recorded for this project."}, status="error")

    @tool
    def list_recent_commits(limit: int = 10, ref: str = "") -> dict[str, Any]:
        """List recent commits on the active project's repository.

        Use this to answer "what changed recently?" or to find a SHA to verify.

        #Args:
            limit: How many commits to return, from 1 to 25 (default: 10).
            ref: Branch or SHA to start from; the default branch when omitted.

        #Returns:
            A JSON object with one row per commit: sha, first line, author, date.
        """
        count = max(1, min(int(limit or 10), MAX_TOOL_ROWS))
        args = {"limit": count, "ref": (ref or "").strip()}

        if refusal := denied("list_recent_commits", args, "Read recent commits"):
            return refusal
        if not owner or not repo_name:
            _record(trace, "list_recent_commits", args, "error", "Not a GitHub project")
            return _text_result(
                {"error": "This project is not a GitHub repository, so commits cannot be listed."},
                status="error",
            )

        try:
            from agent.github.app import GitHubAppClient

            client = GitHubAppClient()
            commits = _run_async(
                client.list_commits(
                    owner,
                    repo_name,
                    ref=args["ref"] or None,
                    per_page=count,
                    installation_id=installation_id,
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Copilot tool list_recent_commits failed: %s", exc)
            _record(trace, "list_recent_commits", args, "error", str(exc))
            return _text_result({"error": f"Could not list commits: {exc}"}, status="error")

        rows = [
            {
                "sha": (item.get("sha") or "")[:12],
                "message": item.get("message") or "",
                "author": item.get("author") or "",
                "date": item.get("date") or item.get("committed_at") or "",
            }
            for item in (commits or [])[:count]
        ]
        _record(trace, "list_recent_commits", args, "ok", f"{len(rows)} commit(s)")
        return _text_result({"repo": repo, "count": len(rows), "commits": rows})

    @tool
    def list_saved_tests(limit: int = 20) -> dict[str, Any]:
        """List the project's saved (reusable) regression journeys.

        Use this for "what do we protect?" or to find a saved flow by name before
        a targeted run.

        #Args:
            limit: How many saved tests to return, from 1 to 25 (default: 20).

        #Returns:
            A JSON object with one row per saved test: name, route, category,
            and whether it is enabled.
        """
        count = max(1, min(int(limit or 20), MAX_TOOL_ROWS))
        args = {"limit": count}

        if refusal := denied("list_saved_tests", args, "Read saved tests"):
            return refusal
        if not repo:
            _record(trace, "list_saved_tests", args, "error", "No active project")
            return _text_result({"error": "No active project is selected."}, status="error")

        try:
            from agent.projects.saved_tests import load_saved_tests

            saved = load_saved_tests(repo, limit=count) or []
        except Exception as exc:  # noqa: BLE001
            _record(trace, "list_saved_tests", args, "error", str(exc))
            return _text_result({"error": f"Could not read saved tests: {exc}"}, status="error")

        rows = [
            {
                "name": row.get("name") or row.get("title") or "",
                "route": row.get("route") or "",
                "category": row.get("category") or "",
                "enabled": row.get("enabled"),
            }
            for row in saved[:count]
        ]
        _record(trace, "list_saved_tests", args, "ok", f"{len(rows)} saved test(s)")
        return _text_result({"repo": repo, "count": len(rows), "saved_tests": rows})

    @tool
    def get_quality_analytics(limit: int = 100) -> dict[str, Any]:
        """Get aggregated quality metrics and insights for the active project.

        Use this for trend questions — pass rate, flakiness, where quality is
        drifting — rather than for a single run.

        #Args:
            limit: How many recent runs to aggregate, from 1 to 200 (default: 100).

        #Returns:
            A JSON object with the fleet metrics for this project and any generated
            insights.
        """
        count = max(1, min(int(limit or 100), 200))
        args = {"limit": count}

        if refusal := denied("get_quality_analytics", args, "Read quality analytics"):
            return refusal
        if not repo:
            _record(trace, "get_quality_analytics", args, "error", "No active project")
            return _text_result({"error": "No active project is selected."}, status="error")

        try:
            from agent.analyzer.fleet_analytics import default_fleet_aggregator

            records = get_run_store().list_all(repo=repo, limit=count)
            # Aggregate this project's runs only: the fleet endpoint is
            # cross-tenant and must never be called from a scoped turn.
            metrics = default_fleet_aggregator.aggregate_runs(records)
            payload = metrics.to_dict() if hasattr(metrics, "to_dict") else dict(metrics)
        except Exception as exc:  # noqa: BLE001
            _record(trace, "get_quality_analytics", args, "error", str(exc))
            return _text_result({"error": f"Could not compute analytics: {exc}"}, status="error")

        _record(trace, "get_quality_analytics", args, "ok", f"aggregated {len(records)} run(s)")
        return _text_result({"repo": repo, "analyzed_runs": len(records), "metrics": payload})

    # -- state changes ------------------------------------------------------

    @tool
    async def trigger_verification(scope: str = "", test_type: str = "") -> dict[str, Any]:
        """Start a real verification run for the active project.

        Only call this when the user clearly asked for a run to be started — not
        when they asked a question about existing runs. It dispatches the same
        pipeline as the dashboard's run button, so it costs real execution time
        and tokens.

        #Args:
            scope: "changed" tests only the diff; "full" tests everything. Defaults to the session's scope setting.
            test_type: "functional" or "exploratory". Defaults to the session's setting.

        #Returns:
            A JSON object with the real run_id and status, or the refusal reason.
        """
        wanted_scope = (scope or request.scope or "changed").strip().lower()
        wanted_scope = "full" if wanted_scope == "full" else "changed"
        wanted_type = (test_type or request.test_type or "functional").strip().lower()
        args = {"scope": wanted_scope, "test_type": wanted_type}

        if refusal := denied(
            "trigger_verification",
            args,
            f"Start a {wanted_scope} {wanted_type} verification run",
            risk="write",
        ):
            return refusal

        if not request.allow_trigger:
            _record(trace, "trigger_verification", args, "denied", "Triggering not permitted")
            return _text_result(
                {
                    "error": (
                        "Triggering a run is not permitted for this turn. Ask the user to "
                        "confirm before dispatching one."
                    )
                },
                status="error",
            )

        if not project or not project.repo_full_name:
            _record(trace, "trigger_verification", args, "error", "No active project")
            return _text_result(
                {"error": "No active project is selected, so there is nothing to verify."},
                status="error",
            )

        try:
            result = await dispatch(wanted_scope, wanted_type)
        except HTTPException as exc:
            _record(trace, "trigger_verification", args, "error", str(exc.detail))
            return _text_result({"error": str(exc.detail)}, status="error")
        except Exception as exc:
            logger.exception("Copilot tool trigger_verification failed")
            _record(trace, "trigger_verification", args, "error", str(exc))
            return _text_result({"error": f"Dispatch failed: {exc}"}, status="error")

        _record(
            trace,
            "trigger_verification",
            args,
            "ok",
            f"run {result.get('run_id')} ({result.get('status')})",
        )
        return _text_result(result)

    @tool
    async def audit_external_site() -> dict[str, Any]:
        """Audit the active project's own live website (external projects only).

        Use this when the user asks to check a live site they have already added
        to the dashboard. There is no way to audit an arbitrary URL: only the
        active project's configured target is reachable.

        #Returns:
            A JSON object with the real run_id and status, or the refusal reason.
        """
        args: dict[str, Any] = {"repo": repo}

        if refusal := denied(
            "audit_external_site", args, "Run a live audit of the project's website", risk="external"
        ):
            return refusal

        if not project or project.type != "external":
            _record(trace, "audit_external_site", args, "error", "Not an external project")
            return _text_result(
                {"error": "The active project is not an external website."}, status="error"
            )
        if not request.allow_trigger:
            _record(trace, "audit_external_site", args, "denied", "Triggering not permitted")
            return _text_result(
                {"error": "Auditing is not permitted for this turn."}, status="error"
            )

        try:
            result = await dispatch("full", "functional")
        except HTTPException as exc:
            _record(trace, "audit_external_site", args, "error", str(exc.detail))
            return _text_result({"error": str(exc.detail)}, status="error")
        except Exception as exc:
            logger.exception("Copilot tool audit_external_site failed")
            _record(trace, "audit_external_site", args, "error", str(exc))
            return _text_result({"error": f"Audit dispatch failed: {exc}"}, status="error")

        _record(trace, "audit_external_site", args, "ok", f"run {result.get('run_id')}")
        return _text_result(result)

    @tool
    def set_finding_status(finding_id: str, status: str = "dismissed", reason: str = "") -> dict[str, Any]:
        """Dismiss or reopen a finding for the active project.

        Reversible triage: dismissing hides a known/accepted defect from the open
        list, reopening brings it back. Use it when the user says a finding is
        expected, fixed, or should be tracked again.

        #Args:
            finding_id: The finding's id, as returned by list_findings.
            status: "dismissed" (default) or "open".
            reason: Optional short reason, recorded with the dismissal.

        #Returns:
            A JSON object confirming the new status.
        """
        fid = (finding_id or "").strip()
        wanted = "dismissed" if (status or "").strip().lower() == "dismissed" else "open"
        args = {"finding_id": fid, "status": wanted, "reason": (reason or "")[:200]}

        if refusal := denied("set_finding_status", args, f"Mark finding {wanted}"):
            return refusal
        if not fid:
            _record(trace, "set_finding_status", args, "error", "A finding_id is required")
            return _text_result({"error": "A finding_id is required."}, status="error")

        project_id = _project_key(repo)
        if not project_id:
            _record(trace, "set_finding_status", args, "error", "Project not resolvable")
            return _text_result(
                {"error": "This finding's project could not be resolved, so it was not changed."},
                status="error",
            )

        try:
            from agent.db.pr_insights import PRInsightStore

            updated = PRInsightStore().set_finding_status(
                project_ids=[project_id],
                finding_id=fid,
                status=wanted,
                reason=args["reason"] or None,
            )
        except Exception as exc:  # noqa: BLE001
            _record(trace, "set_finding_status", args, "error", str(exc))
            return _text_result({"error": f"Could not update finding: {exc}"}, status="error")

        if not updated:
            _record(trace, "set_finding_status", args, "error", "Finding not found in this project")
            return _text_result(
                {"error": f"Finding {fid} was not found in the active project."}, status="error"
            )

        _record(trace, "set_finding_status", args, "ok", f"finding {fid} -> {wanted}")
        return _text_result({"finding_id": fid, "status": wanted})

    @tool
    async def apply_run_fix(run_id: str) -> dict[str, Any]:
        """Apply a run's AI-synthesized fix and re-verify it.

        This changes real files (or commits to the PR branch). Only use it when
        the user explicitly asked to apply the fix for a specific run.

        #Args:
            run_id: The failed run whose fix proposals should be applied.

        #Returns:
            A JSON object with the applied files and the re-verification outcome.
        """
        rid = (run_id or "").strip()
        args = {"run_id": rid}

        if refusal := denied(
            "apply_run_fix", args, f"Apply the generated fix from run {rid} and re-verify"
        ):
            return refusal
        if not rid:
            _record(trace, "apply_run_fix", args, "error", "A run_id is required")
            return _text_result({"error": "A run_id is required."}, status="error")

        try:
            from starlette.background import BackgroundTasks

            from agent.api.runs import apply_run_fix as apply_fix_route

            record = get_run_store().get(rid)
            if record is None:
                _record(trace, "apply_run_fix", args, "error", "Run not found")
                return _text_result({"error": f"Run {rid} was not found."}, status="error")
            row = _run_row(record)
            if repo and row.get("repo") and row["repo"] != repo:
                _record(trace, "apply_run_fix", args, "denied", "Run belongs to another project")
                return _text_result(
                    {"error": f"Run {rid} does not belong to the active project."}, status="error"
                )

            # The route schedules re-verification on the BackgroundTasks it is
            # handed. Attaching to the request's collector (rather than a
            # throwaway) is what makes "and re-verify" actually happen.
            tasks = state.background if state.background is not None else BackgroundTasks()
            result = await apply_fix_route(rid, tasks)
        except HTTPException as exc:
            _record(trace, "apply_run_fix", args, "error", str(exc.detail))
            return _text_result({"error": str(exc.detail)}, status="error")
        except Exception as exc:
            logger.exception("Copilot tool apply_run_fix failed")
            _record(trace, "apply_run_fix", args, "error", str(exc))
            return _text_result({"error": f"Could not apply the fix: {exc}"}, status="error")

        applied = result.get("applied_files") if isinstance(result, dict) else None
        _record(trace, "apply_run_fix", args, "ok", f"applied {len(applied or [])} file(s) from {rid}")
        return _text_result(result)

    @tool
    async def comment_on_pull_request(pr_number: int, body: str) -> dict[str, Any]:
        """Post a comment on a pull request in the active project's repository.

        This reaches GitHub and is visible to everyone on the PR. Only use it
        when the user asked for a comment to be posted.

        #Args:
            pr_number: The pull request number to comment on.
            body: The comment body, in markdown.

        #Returns:
            A JSON object with the URL of the posted comment.
        """
        number = int(pr_number or 0)
        text = (body or "").strip()
        args = {"pr_number": number, "body": text[:2000]}

        if refusal := denied(
            "comment_on_pull_request", args, f"Post a comment on PR #{number}"
        ):
            return refusal
        if not number or not text:
            _record(trace, "comment_on_pull_request", args, "error", "pr_number and body required")
            return _text_result({"error": "Both pr_number and body are required."}, status="error")
        if not owner or not repo_name:
            _record(trace, "comment_on_pull_request", args, "error", "Not a GitHub project")
            return _text_result(
                {"error": "This project is not a GitHub repository."}, status="error"
            )

        try:
            from agent.github.app import GitHubAppClient

            client = GitHubAppClient()
            url = await client.post_pr_comment(
                owner, repo_name, number, text, installation_id=installation_id
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Copilot tool comment_on_pull_request failed: %s", exc)
            _record(trace, "comment_on_pull_request", args, "error", str(exc))
            return _text_result({"error": f"Could not post the comment: {exc}"}, status="error")

        _record(trace, "comment_on_pull_request", args, "ok", f"commented on PR #{number}")
        return _text_result({"pr_number": number, "comment_url": url})

    # -- workspace reads ------------------------------------------------------
    # Only meaningful when no single project is selected. They exist so the
    # model can answer fleet-wide questions without ever naming a repository
    # that the caller's tenant scope did not put in the allowlist.

    @tool
    def list_projects() -> dict[str, Any]:
        """List every project in this workspace.

        Only available in a workspace session. Use it to find what repositories
        exist, and to get the exact `repo_full_name` to pass as `target` to the
        other tools.

        #Returns:
            A JSON object with one row per project: repo_full_name, name, kind,
            default_branch, and live url.
        """
        args: dict[str, Any] = {}
        if refusal := denied("list_projects", args, "Read workspace projects"):
            return refusal
        if not is_workspace:
            _record(trace, "list_projects", args, "error", "Not a workspace session")
            return _text_result(
                {"error": "This session is scoped to a single project, not a workspace."},
                status="error",
            )

        rows = [
            {
                "repo_full_name": name,
                "name": ctx.name or name,
                "kind": ctx.type or "git",
                "default_branch": ctx.default_branch or "main",
                "target_url": ctx.target_url or "",
            }
            for name, ctx in sorted(workspace_repos.items())
        ]
        _record(trace, "list_projects", args, "ok", f"{len(rows)} project(s)")
        return _text_result(
            {
                "workspace": workspace.label if workspace else "Workspace",
                "count": len(rows),
                "projects": rows,
            }
        )

    @tool
    def get_workspace_overview(limit: int = 5) -> dict[str, Any]:
        """Summarise the health of every project in this workspace.

        Only available in a workspace session. Use it for "how are my projects
        doing?", "what is failing across the workspace?", or "which project needs
        attention?" before drilling in with a `target`.

        #Args:
            limit: Recent runs to inspect per project, from 1 to 25 (default: 5).

        #Returns:
            A JSON object with per-project run counts and latest run, workspace
            totals, and the most recent failures attributed to their project.
        """
        per_project = max(1, min(int(limit or 5), MAX_TOOL_ROWS))
        args = {"limit": per_project}
        if refusal := denied("get_workspace_overview", args, "Read workspace overview"):
            return refusal
        if not is_workspace:
            _record(trace, "get_workspace_overview", args, "error", "Not a workspace session")
            return _text_result(
                {"error": "This session is scoped to a single project, not a workspace."},
                status="error",
            )

        try:
            from agent.api.runs import get_run_store

            store = get_run_store()
        except Exception as exc:  # noqa: BLE001
            _record(trace, "get_workspace_overview", args, "error", str(exc))
            return _text_result({"error": f"Could not read runs: {exc}"}, status="error")

        projects: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        inspected = 0
        for name, ctx in sorted(workspace_repos.items()):
            entry: dict[str, Any] = {
                "repo_full_name": name,
                "name": ctx.name or name,
                "kind": ctx.type or "git",
            }
            try:
                records = store.list_all(repo=name, limit=per_project) or []
            except Exception as exc:  # noqa: BLE001
                logger.debug("workspace overview: runs unavailable for %s: %s", name, exc)
                entry["error"] = f"runs unavailable: {exc}"
                projects.append(entry)
                continue

            runs = [_run_row(r) for r in records]
            inspected += len(runs)
            entry["run_count"] = len(runs)
            entry["failing_runs"] = sum(1 for r in runs if _is_failure(r.get("status")))
            if runs:
                entry["latest_run"] = runs[0]
            projects.append(entry)
            for r in runs:
                if _is_failure(r.get("status")):
                    failures.append({**r, "repo_full_name": name})

        failures.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        _record(
            trace,
            "get_workspace_overview",
            args,
            "ok",
            f"{len(projects)} project(s), {len(failures)} failure(s) in window",
        )
        return _text_result(
            {
                "workspace": workspace.label if workspace else "Workspace",
                "project_count": len(projects),
                "runs_inspected": inspected,
                "projects": projects,
                "recent_failures": failures[:MAX_TOOL_ROWS],
            }
        )

    tools: list[Any] = [
        get_project_overview,
        list_recent_runs,
        get_run_details,
        list_findings,
        search_findings,
        compare_runs,
        list_pull_requests,
        get_pull_request,
        list_recent_commits,
        list_saved_tests,
        get_quality_analytics,
        trigger_verification,
        audit_external_site,
        set_finding_status,
        apply_run_fix,
        comment_on_pull_request,
    ]

    # Workspace reads exist only where they mean something. Handing them to a
    # project session would just be two more tools that always refuse.
    if is_workspace:
        tools.extend([list_projects, get_workspace_overview])

    return tools


def _run_async(coro: Any) -> Any:
    """Run a coroutine from inside a *sync* tool.

    Strands executes sync tools in a worker thread, so there is normally no
    running loop here. When there is one (a direct call from async code), the
    coroutine is run on a private thread rather than deadlocking the loop.
    """
    import asyncio
    import concurrent.futures

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


def _safe_settings(settings: dict[str, Any] | None) -> dict[str, Any]:
    """The non-secret slice of a project's settings.

    Secrets are never handed to a model. This mirrors ``_format_settings`` but
    returns structured data for the ``get_project_overview`` tool.
    """
    if not isinstance(settings, dict):
        return {}
    allowed = (
        "framework",
        "package_manager",
        "build_command",
        "test_command",
        "start_command",
        "scope",
        "test_type",
        "root_directory",
        "domain",
    )
    safe = {key: settings[key] for key in allowed if settings.get(key) not in (None, "", {})}
    roles = settings.get("roles")
    if isinstance(roles, dict) and roles:
        safe["configured_test_roles"] = sorted(roles.keys())
    auto_repair = settings.get("auto_repair")
    if isinstance(auto_repair, dict):
        safe["auto_repair"] = {
            "enabled": bool(auto_repair.get("enabled")),
            "max_steps": auto_repair.get("max_steps"),
            "cost_limit_usd": auto_repair.get("cost_limit_usd"),
        }
    return safe


def _load_findings(repo: str, status: str | None) -> tuple[list[dict[str, Any]], str | None]:
    """Read findings for a repo, returning ``(rows, error)``."""
    try:
        from agent.db.pr_insights import PRInsightStore

        rows = PRInsightStore().list_findings(repo, status)
        return [row for row in (rows or []) if isinstance(row, dict)], None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read findings for %s: %s", repo, exc)
        return [], f"Could not read findings: {exc}"


def _finding_row(row: dict[str, Any]) -> dict[str, Any]:
    """The fields of a finding worth showing a model."""
    return {
        "finding_id": row.get("id") or row.get("finding_id") or "",
        "title": row.get("title") or row.get("category") or "",
        "severity": row.get("severity") or "",
        "category": row.get("category") or "",
        "status": row.get("status") or "",
        "occurrences": row.get("occurrences"),
        "last_seen_run_id": row.get("last_seen_run_id") or "",
        "updated_at": row.get("updated_at") or "",
    }


def _is_failure(status: Any) -> bool:
    return str(status or "").strip().lower() in {"failed", "failure", "error", "timed_out", "timeout"}


def _test_case_rows(run_id: str) -> list[dict[str, Any]]:
    """Per-test-case rows for a run, capped and shaped for the model."""
    try:
        from agent.db.pr_insights import PRInsightStore

        cases = PRInsightStore().list_test_cases(run_id)
    except Exception as exc:  # noqa: BLE001 - cases are supplementary
        logger.debug("Could not load test cases for %s: %s", run_id, exc)
        return []

    rows: list[dict[str, Any]] = []
    for case in cases[:MAX_TOOL_ROWS]:
        if not isinstance(case, dict):
            continue
        rows.append(
            {
                "name": case.get("name") or case.get("title") or "",
                "status": case.get("status") or "",
                "severity": case.get("severity") or "",
                "error": str(case.get("error") or case.get("error_message") or "")[:300],
            }
        )
    return rows


def get_run_store() -> Any:
    """The active run store, imported lazily to avoid a circular import."""
    from agent.api.runs import get_run_store as _get

    return _get()


# ---------------------------------------------------------------------------
# Grounding context
# ---------------------------------------------------------------------------


def _format_settings(settings: dict[str, Any]) -> str:
    """Render the meaningful slice of project settings for the prompt."""
    if not settings:
        return "  (no saved settings)"
    lines: list[str] = []
    simple_keys = (
        "framework",
        "package_manager",
        "build_command",
        "test_command",
        "start_command",
        "scope",
        "test_type",
        "root_directory",
        "domain",
    )
    for key in simple_keys:
        value = settings.get(key)
        if value not in (None, "", {}):
            lines.append(f"  {key}: {value}")

    auto_repair = settings.get("auto_repair")
    if isinstance(auto_repair, dict):
        lines.append(
            "  auto_repair: "
            f"enabled={bool(auto_repair.get('enabled'))}, "
            f"max_steps={auto_repair.get('max_steps')}, "
            f"cost_limit_usd={auto_repair.get('cost_limit_usd')}"
        )
    roles = settings.get("roles")
    if isinstance(roles, dict) and roles:
        lines.append(f"  configured_test_roles: {', '.join(sorted(roles.keys()))}")
    return "\n".join(lines) if lines else "  (no saved settings)"


def build_context_block(request: CopilotChatRequest) -> str:
    """Describe the active project and its recent runs for the system prompt."""
    project = request.project
    parts: list[str] = []

    if request.workspace and request.workspace.repos and not (project and project.repo_full_name):
        ws = request.workspace
        lines = [
            "ACTIVE WORKSPACE (no single project selected)",
            f"  label: {ws.label or 'Workspace'}",
            f"  projects: {len(ws.repos)}",
        ]
        for ctx in ws.repos[:MAX_CONTEXT_RUNS]:
            kind = "external website" if ctx.type == "external" else "repo"
            lines.append(
                f"  - {ctx.repo_full_name} ({ctx.name or ctx.repo_full_name}, {kind}"
                + (f", {ctx.target_url}" if ctx.target_url else "")
                + ")"
            )
        lines.append(
            "This is a read-only workspace session: no single project is selected, so "
            "state-changing tools are unavailable. Pass a `target` to the read tools "
            "to look at one project."
        )
        parts.append("\n".join(lines))
    elif project and project.repo_full_name:
        kind = "external website" if project.type == "external" else "GitHub repository"
        parts.append(
            "ACTIVE PROJECT\n"
            f"  repo: {project.repo_full_name}\n"
            f"  display name: {project.name or project.repo_full_name}\n"
            f"  kind: {kind}\n"
            f"  default branch: {project.default_branch or 'main'}\n"
            + (f"  live url: {project.target_url}\n" if project.target_url else "")
            + "SETTINGS\n"
            + _format_settings(project.settings)
        )
    else:
        parts.append("ACTIVE PROJECT\n  (none selected)")

    if request.runs:
        rows = ["RECENT RUNS (newest first)"]
        for run in request.runs[:MAX_CONTEXT_RUNS]:
            bits = [
                f"  - {run.run_id or 'unknown'}",
                f"status={run.status or 'unknown'}",
                f"branch={run.branch or 'n/a'}",
                f"sha={(run.sha or 'n/a')[:12]}",
                f"scope={run.scope or 'n/a'}",
                f"started={run.created_at or 'n/a'}",
            ]
            if run.completed_at:
                bits.append(f"completed={run.completed_at}")
            if run.summary:
                bits.append(f"summary={run.summary[:300]}")
            rows.append(" ".join(bits))
        parts.append("\n".join(rows))
    else:
        parts.append("RECENT RUNS (newest first)\n  (no runs recorded for this project)")

    return "\n\n".join(parts)


SYSTEM_PROMPT = """You are the AutoQA AI Copilot, an agent embedded in an automated QA dashboard.

You help users understand their test runs, diagnose failures, and decide what to
verify next. You are talking to an engineer who is already looking at the
dashboard. You are the primary way they work with their project.

You have tools. Use them.

1. Prefer a tool call over guessing or over saying you cannot see something.
   Reading: `get_project_overview`, `list_recent_runs`, `get_run_details`,
   `list_findings`, `search_findings`, `compare_runs`, `list_pull_requests`,
   `get_pull_request`, `list_recent_commits`, `list_saved_tests`,
   `get_quality_analytics`.
   Acting: `trigger_verification`, `audit_external_site`, `set_finding_status`,
   `apply_run_fix`, `comment_on_pull_request`.
2. Ground every factual claim in the context block or a tool result from this
   conversation. If neither has the answer, say so plainly and name where in the
   dashboard the user can look.
3. Never invent run ids, commit SHAs, pass/fail counts, timings, token or cost
   savings, or error messages. If a value is absent, say it is not recorded.
4. Never claim a test run was started unless a tool result explicitly reports a
   run id and status. When it does, report the real run id, status, and branch,
   and note that results appear under Activity & Runs.
5. Do not call `trigger_verification` for questions *about* runs ("why did the
   last run fail?", "what is the status?"). Those are answered by reading.
6. Some actions are gated. If a tool result says `pending_approval`, the action
   did NOT happen: tell the user exactly what you want to do and why, and wait.
   If it says the session is read-only, explain that the action needs a more
   permissive mode. Never claim a gated action succeeded.
7. If a tool result says the tool budget is exhausted, stop calling tools and
   answer with what you already have.

If the context block says ACTIVE WORKSPACE, no single project is selected. Use
`list_projects` and `get_workspace_overview` for fleet-wide questions, and pass a
`target` to `list_recent_runs`, `list_findings`, or `get_project_overview` to
drill into one project. State-changing tools are unavailable until the user picks
a project — say so instead of trying one. Attribute every run, finding, and
failure to its `repo_full_name`: never present one project's number as the
workspace's, or another project's.

Formatting: markdown is rendered. Use `code` for identifiers, commands, and
paths. Keep answers under roughly 200 words unless asked to go deeper."""


#: How each permission mode reads in the prompt. The model is told its mode so
#: it can ask rather than waste a call that will be refused.
_MODE_NOTES = {
    "read_only": (
        "MODE: read-only. Reading tools only — requesting a state change will be "
        "refused. Tell the user what you would run and that it needs a more "
        "permissive mode."
    ),
    "standard": (
        "MODE: standard. Reading, triage, and dispatching a run are allowed. "
        "`apply_run_fix` and `comment_on_pull_request` pause for the user's "
        "approval."
    ),
    "autonomous": (
        "MODE: autonomous. All tools are callable without asking. Still report "
        "exactly what you did."
    ),
}


def _extract_text(result: Any) -> str:
    """Pull assistant text out of a Strands AgentResult defensively.

    ``AgentResult.message`` is a plain dict (``{"role": ..., "content": [...]}``)
    in current Strands releases, but older or alternate wrappers expose objects,
    so both shapes are handled. Reasoning blocks carry their own nested ``text``
    fields and must not be mistaken for the answer.
    """
    message = getattr(result, "message", None)
    if message is None and isinstance(result, dict):
        message = result.get("message")

    if isinstance(message, dict):
        content = message.get("content")
    else:
        content = getattr(message, "content", None)

    chunks: list[str] = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                # Skip reasoning/signature blocks: not user-facing answer text.
                if "reasoningContent" in block or "reasoning_content" in block:
                    continue
                text = block.get("text")
                if text:
                    chunks.append(str(text))
            else:
                text = getattr(block, "text", None)
                if text:
                    chunks.append(str(text))
    elif isinstance(content, str):
        chunks.append(content)

    text = "\n".join(c for c in chunks if c).strip()
    if not text:
        fallback = getattr(result, "text", None)
        if isinstance(fallback, str):
            text = fallback.strip()
    return text


@router.get("/health")
async def copilot_health() -> dict[str, Any]:
    """Report whether the copilot can actually reach a model, and with what."""
    from agent.models.factory import (
        has_anthropic_key,
        has_bedrock_credentials,
        has_gemini_key,
    )

    ready = has_api_key_for_role(ModelRole.CODE_REASONING)
    providers = [
        {
            "id": "bedrock",
            "label": "AWS Bedrock",
            "available": bool(has_bedrock_credentials()),
        },
        {
            "id": "anthropic",
            "label": "Anthropic",
            "available": bool(has_anthropic_key()),
        },
        {
            "id": "gemini",
            "label": "Google Gemini",
            "available": bool(has_gemini_key()),
        },
    ]
    return {
        "status": "ready" if ready else "unconfigured",
        "model": resolve_model_id(ModelRole.CODE_REASONING),
        "providers": providers,
        "tool_count": len(ALL_TOOLS),
        "modes": ["read_only", "standard", "autonomous"],
        "hint": (
            None
            if ready
            else "Set ANTHROPIC_API_KEY or GEMINI_API_KEY for the engine to enable copilot replies."
        ),
    }


@router.post("/chat")
async def copilot_chat(
    request: CopilotChatRequest, background_tasks: BackgroundTasks
) -> CopilotChatResponse:
    """Answer a dashboard question, driving tools and optionally dispatching a run."""
    message = (request.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")

    # Each turn is an LLM call (and may dispatch a run), so cap the rate per
    # conversation/project to bound a runaway loop.
    from agent.api.rate_limit import copilot_chat_limiter

    limiter_key = (request.project.repo_full_name if request.project else None) or request.branch or "global"
    retry_after = copilot_chat_limiter.check(limiter_key)
    if retry_after > 0:
        raise HTTPException(
            status_code=429,
            detail=(
                "Rate limit exceeded: at most 20 copilot turns per minute. "
                f"Retry in {int(retry_after) + 1}s."
            ),
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    if not has_api_key_for_role(ModelRole.CODE_REASONING):
        raise HTTPException(
            status_code=503,
            detail=(
                "The copilot has no model configured. Set ANTHROPIC_API_KEY or "
                "GEMINI_API_KEY for the engine and restart it."
            ),
        )

    provider = "unknown"
    model_id = resolve_model_id(ModelRole.CODE_REASONING)
    triggered: dict[str, Any] | None = None

    # 1. Optionally dispatch a run before answering, so the reply can report the
    #    real outcome instead of promising one.
    if request.allow_trigger and request.project and wants_run(message):
        try:
            result = await _dispatch_run_async(request)
            triggered = {
                "run_id": result.get("run_id"),
                "status": result.get("status"),
                "repo": result.get("repo") or request.project.repo_full_name,
                "branch": result.get("branch") or request.branch,
                "message": result.get("message"),
                "fresh": result.get("fresh"),
            }
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Copilot run dispatch failed")
            triggered = {
                "run_id": None,
                "status": "failed",
                "repo": request.project.repo_full_name,
                "branch": request.branch,
                "message": f"Dispatch failed: {exc}",
            }

    # 2. Ask the model, grounded in the supplied context.
    context_block = build_context_block(request)
    history = request.history[-MAX_HISTORY_MESSAGES:]

    transcript: list[str] = []
    for turn in history:
        speaker = "User" if turn.role == "user" else "Assistant"
        transcript.append(f"{speaker}: {turn.content}")

    # The session's mode, approvals, and tool budget travel with the turn.
    turn = _TurnState(
        request=request,
        triggered=triggered,
        background=background_tasks,
    )

    dispatch_note = ""
    if triggered is not None:
        dispatch_note = (
            "\n\nTEST RUN DISPATCH RESULT (this just happened for this turn)\n"
            + json.dumps(triggered, indent=2)
        )

    # Sessions are stateless per request, so the mode travels in the prompt as
    # well as in the request model: the model can then ask instead of spending a
    # call that _authorize will refuse.
    mode_note = _MODE_NOTES.get(request.mode, _MODE_NOTES["standard"])
    approved_note = ""
    if request.approvals:
        approved_note = (
            "\n\nThe user has already approved these action ids for this turn: "
            + ", ".join(request.approvals)
        )

    prompt = (
        f"{context_block}{dispatch_note}\n\n{mode_note}{approved_note}\n\n"
        + ("CONVERSATION SO FAR\n" + "\n".join(transcript) + "\n\n" if transcript else "")
        + f"User: {message}\n\n"
        f"Answer the user's latest message. You may make at most {turn.budget} tool "
        "calls this turn. Call a tool if you need data that is not already above."
    )

    # Tools are built per turn and close over the resolved project, so the model
    # chooses *what* to look up but never *which* repository to look in.
    trace: list[ToolCallTrace] = []
    tools = build_copilot_tools(turn, trace)

    try:
        agent = create_strands_agent(
            ModelRole.CODE_REASONING,
            system_prompt=SYSTEM_PROMPT,
            tools=tools,
            provider=request.provider,
        )
        # ``create_strands_agent`` logs token usage; resolve the provider label
        # for the response from the same routing helper.
        from agent.models.factory import get_active_provider_for_role

        provider = get_active_provider_for_role(ModelRole.CODE_REASONING)
        result = await _invoke_agent(agent, prompt)
        reply = _extract_text(result)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Copilot model call failed")
        raise HTTPException(
            status_code=502,
            detail=f"The copilot model call failed: {exc}",
        ) from exc

    # A tool may have dispatched the run for this turn; report that one.
    triggered = turn.triggered

    if not reply:
        reply = (
            "I could not produce an answer for that. Check the engine logs for the "
            "model response, or try rephrasing the question."
        )

    return CopilotChatResponse(
        reply=reply,
        model=model_id,
        provider=provider,
        triggered_run=triggered,
        tool_calls=trace,
        pending_approvals=turn.pending,
        steps_used=turn.steps,
        max_tool_calls=turn.budget,
    )


async def _invoke_agent(agent: Any, prompt: str) -> Any:
    """Invoke a Strands agent without blocking the event loop.

    ``Agent.__call__`` is synchronous, so it runs in a worker thread; Strands
    also exposes ``invoke_async`` on newer versions, which we prefer when
    present.
    """
    invoke_async = getattr(agent, "invoke_async", None)
    if callable(invoke_async):
        return await invoke_async(prompt)

    import anyio

    return await anyio.to_thread.run_sync(lambda: agent(prompt))


async def _dispatch_run_async(
    request: CopilotChatRequest,
    *,
    scope: str = "changed",
    test_type: str = "functional",
) -> dict[str, Any]:
    """Dispatch the run for this request from async route code."""
    from starlette.background import BackgroundTasks

    from agent.api.runs import (
        ExternalRunRequest,
        RunRequest,
        trigger_external_run,
        trigger_run,
    )

    project = request.project
    assert project is not None

    tasks = BackgroundTasks()
    if project.type == "external":
        url = project.target_url or ""
        if not url:
            raise HTTPException(
                status_code=400,
                detail="This external project has no target URL configured, so it cannot be verified.",
            )
        return await trigger_external_run(
            ExternalRunRequest(url=url, name=project.name or project.repo_full_name),
            tasks,
        )

    payload = RunRequest(
        branch=request.branch or project.default_branch or "main",
        sha=request.sha or "HEAD",
        repo=project.repo_full_name,
        scope=scope,
        test_type=test_type,
    )
    return await trigger_run(payload, tasks)
