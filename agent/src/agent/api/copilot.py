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

import json
import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
    runs: list[RunContext] = Field(default_factory=list)
    #: Whether the caller permits this turn to dispatch a real test run.
    allow_trigger: bool = True
    #: Commit/branch the web layer already resolved for the active project.
    branch: str = "main"
    sha: str | None = None


class CopilotChatResponse(BaseModel):
    reply: str
    model: str
    provider: str
    triggered_run: dict[str, Any] | None = None


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

    if project and project.repo_full_name:
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


SYSTEM_PROMPT = """You are the AutoQA AI Copilot, embedded in an automated QA dashboard.

You help users understand their test runs, diagnose failures, and decide what to
verify next. You are talking to an engineer who is already looking at the
dashboard.

Grounding rules — these matter more than being helpful:
1. Use ONLY the project context and run history supplied in the message. If the
   answer is not in that context, say so plainly and suggest where in the
   dashboard the user can find it.
2. Never invent run ids, commit SHAs, pass/fail counts, token or cost savings,
   timings, or error messages. If a value is absent, say it is not recorded.
3. Never claim a test run was started unless the tool result in the conversation
   explicitly reports a run id and status.
4. When the user asks for a run and a dispatch result is present, report the real
   run id, status, and branch, and note that results appear under Activity & Runs.
5. Be concise and concrete: short paragraphs or tight bullet lists, no filler,
   no restating the question, no emoji.

Formatting: markdown is rendered. Use `code` for identifiers, commands, and
paths. Keep answers under roughly 200 words unless asked to go deeper."""


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
    """Report whether the copilot can actually reach a model."""
    ready = has_api_key_for_role(ModelRole.CODE_REASONING)
    return {
        "status": "ready" if ready else "unconfigured",
        "model": resolve_model_id(ModelRole.CODE_REASONING),
        "hint": (
            None
            if ready
            else "Set ANTHROPIC_API_KEY or GEMINI_API_KEY for the engine to enable copilot replies."
        ),
    }


@router.post("/chat")
async def copilot_chat(request: CopilotChatRequest) -> CopilotChatResponse:
    """Answer a dashboard question, optionally dispatching a real test run."""
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

    dispatch_note = ""
    if triggered is not None:
        dispatch_note = (
            "\n\nTEST RUN DISPATCH RESULT (this just happened for this turn)\n"
            + json.dumps(triggered, indent=2)
        )

    prompt = (
        f"{context_block}{dispatch_note}\n\n"
        + ("CONVERSATION SO FAR\n" + "\n".join(transcript) + "\n\n" if transcript else "")
        + f"User: {message}\n\n"
        "Answer the user's latest message using only the context above."
    )

    try:
        agent = create_strands_agent(
            ModelRole.CODE_REASONING,
            system_prompt=SYSTEM_PROMPT,
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


async def _dispatch_run_async(request: CopilotChatRequest) -> dict[str, Any]:
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
        scope="changed",
        test_type="functional",
    )
    return await trigger_run(payload, tasks)
