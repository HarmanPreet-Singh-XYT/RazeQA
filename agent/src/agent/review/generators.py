"""Candidate generators: how a patch for one finding is actually produced.

:class:`MiniSweCandidateGenerator` is the real one. It runs
``mini-swe-agent`` in a throwaway clone of the repository — reusing the
command guardrails and trajectory logging already built for the repair loop in
:mod:`agent.remediation.agentic_repair` — and captures the resulting ``git diff``
as a candidate patch.

The generator only *produces* a patch. It makes no judgement about whether the
patch is any good; that is entirely :class:`~agent.review.fixer.VerifiedFixEngine`'s
job, and keeping the two apart is what stops the agent grading its own work.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from agent.review.fixer import FixCandidate, LocalGitSandbox
from agent.review.models import ReviewFinding
from agent.review.prompts import build_fix_system_prompt

logger = logging.getLogger("agent.review.generators")


def build_fix_task_prompt(finding: ReviewFinding, test_command: str, build_command: str) -> str:
    """The task handed to the repair agent for one finding."""
    lines = [
        f"A reviewer reported the following issue at {finding.location or 'an unspecified location'}:",
        "",
        f"Title: {finding.title}",
    ]
    if finding.detail:
        lines += ["", f"Why it matters: {finding.detail}"]
    if finding.evidence:
        lines += ["", "Evidence quoted from the diff:", "```", finding.evidence.strip()[:2000], "```"]
    if finding.remediation:
        lines += ["", f"Suggested remediation: {finding.remediation}"]
    lines += [
        "",
        "Mandatory: add a regression test in a NEW test file that fails on the current code and",
        "passes after your fix. Then run the project's tests and build.",
    ]
    if test_command:
        lines.append(f"Test command: `{test_command}`")
    if build_command:
        lines.append(f"Build command: `{build_command}`")
    lines += [
        "",
        "When everything passes, submit with: `echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`",
    ]
    return "\n".join(lines)


class MiniSweCandidateGenerator:
    """Produce a candidate patch by running mini-swe-agent in a scratch clone."""

    def __init__(
        self,
        repo_dir: str | Path,
        *,
        test_command: str = "",
        suite_command: str = "",
        build_command: str = "",
        model_name: str | None = None,
        max_steps: int = 16,
        cost_limit_usd: float = 1.5,
        wall_time_limit_seconds: int = 300,
        custom_secrets: list[str] | None = None,
    ) -> None:
        self.repo_dir = Path(repo_dir).resolve()
        self.test_command = test_command
        self.suite_command = suite_command
        self.build_command = build_command
        self.model_name = model_name
        self.max_steps = max_steps
        self.cost_limit_usd = cost_limit_usd
        self.wall_time_limit_seconds = wall_time_limit_seconds
        self.custom_secrets = custom_secrets or []
        self.trajectories: list[list[Any]] = []

    def _resolve_model(self) -> str:
        from agent.models.factory import normalize_model_id
        from agent.remediation.agentic_repair import resolve_model_name

        return normalize_model_id(self.model_name) or resolve_model_name()

    def __call__(self, finding: ReviewFinding, attempt: int) -> FixCandidate | None:
        from minisweagent.agents.default import DefaultAgent
        from minisweagent.models.litellm_model import LitellmModel

        from agent.remediation.agentic_repair import GuardrailedLocalEnvironment

        sandbox = LocalGitSandbox(self.repo_dir)
        try:
            task = build_fix_task_prompt(finding, self.test_command, self.build_command)
            system_template = build_fix_system_prompt(finding.title, finding.location or "unknown")

            model = LitellmModel(
                model_name=self._resolve_model(),
                model_kwargs={"drop_params": True},
                cost_tracking="default",
            )
            env = GuardrailedLocalEnvironment(
                cwd=str(sandbox.workdir),
                custom_secrets=self.custom_secrets,
                timeout=120,
            )
            agent = DefaultAgent(
                model=model,
                env=env,
                system_template=system_template,
                instance_template="{{task}}\n\nWorking directory: {{cwd}}",
                step_limit=self.max_steps,
                cost_limit=self.cost_limit_usd,
                wall_time_limit_seconds=self.wall_time_limit_seconds,
            )
            try:
                agent.run(task=task, cwd=str(sandbox.workdir))
            except Exception as exc:  # noqa: BLE001 - a halted agent still may have produced a patch
                logger.info("Attempt %s halted: %s", attempt, exc)

            self.trajectories.append(list(env.trajectory))
            patch = sandbox.diff()
            if not patch.strip():
                logger.info("Attempt %s produced no diff.", attempt)
                return None

            return FixCandidate(
                patch=patch,
                test_command=self.test_command,
                suite_command=self.suite_command,
                build_command=self.build_command,
                notes=f"mini-swe-agent attempt {attempt}",
                attempt=attempt,
            )
        except Exception as exc:  # noqa: BLE001 - generation failure loses one attempt
            logger.warning("Candidate generation failed on attempt %s: %s", attempt, exc)
            return None
        finally:
            sandbox.cleanup()
