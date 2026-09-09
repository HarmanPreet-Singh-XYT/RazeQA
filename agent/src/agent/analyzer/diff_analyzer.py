"""Diff + Intent Analyzer powered by Claude via the Strands Agents SDK
(with a deterministic fallback when no API key is configured)."""

from __future__ import annotations

import logging
import os

from pydantic import BaseModel, Field

from agent.bridge.models import IntentEvent
from agent.models.factory import ModelRole, create_strands_agent

logger = logging.getLogger("agent.analyzer")


class AnalysisResult(BaseModel):
    affected_surfaces: list[str] = Field(default_factory=list)
    risk_tag: str = "Medium"  # Low, Medium, High
    rationale: str = ""
    recommended_journeys: list[str] = Field(default_factory=list)


SYSTEM_PROMPT = """You are an Autonomous PR Testing Analyzer.
Analyze the provided git diff and developer intent log to determine:
1. Affected surfaces (routes, components, features).
2. Risk assessment (Low, Medium, High) with explicit rationale.
3. Recommended browser journeys to verify (e.g., 'login', 'dashboard', 'form-validation').
"""

DEFAULT_MODEL_ID = "claude-sonnet-4-5-20250929"


class DiffAnalyzer:
    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")

    def _fallback_heuristic(self, diff: str, intents: list[IntentEvent]) -> AnalysisResult:
        """Deterministic heuristic fallback when Anthropic API key is absent."""
        affected: set[str] = set()
        for it in intents:
            affected.update(it.files)

        diff_lower = diff.lower()
        risk = "Low"
        rationale_parts: list[str] = []

        if "login" in diff_lower or "auth" in diff_lower or "password" in diff_lower:
            risk = "High"
            rationale_parts.append("Authentication or credential flows were touched.")
            affected.add("/login")
            affected.add("/dashboard")
        elif "payment" in diff_lower or "checkout" in diff_lower or "card" in diff_lower:
            risk = "High"
            rationale_parts.append("Payment or transaction flow modified.")
            affected.add("/checkout")
        elif "form" in diff_lower or "validation" in diff_lower or "api" in diff_lower:
            risk = "Medium"
            rationale_parts.append("Form validation or API contract altered.")
            affected.add("/dashboard")
        else:
            rationale_parts.append("Cosmetic or low-risk component updates.")

        if intents:
            rationale_parts.append(f"Reviewed {len(intents)} intent events from coding agent bridge.")

        recommended = ["login", "dashboard"]
        if "/checkout" in affected or "payment" in diff_lower:
            recommended.append("checkout")

        return AnalysisResult(
            affected_surfaces=sorted(affected) if affected else ["/dashboard"],
            risk_tag=risk,
            rationale=" ".join(rationale_parts),
            recommended_journeys=recommended,
        )


    def analyze(self, diff: str, intents: list[IntentEvent]) -> AnalysisResult:
        """Run AI diff + intent analysis via a Strands agent."""
        if not self.api_key:
            return self._fallback_heuristic(diff, intents)

        try:
            agent = create_strands_agent(
                role=ModelRole.CODE_REASONING,
                api_key=self.api_key,
                system_prompt=SYSTEM_PROMPT,
                max_tokens=1500,
            )

            formatted_intents = [
                {
                    "files": i.files,
                    "action": i.action,
                    "prompt": i.prompt_summary,
                    "reasoning": i.reasoning,
                }
                for i in intents
            ]

            prompt = (
                f"GIT DIFF:\n{diff[:8000]}\n\n"
                f"DEVELOPER INTENT LOG:\n{formatted_intents}\n\n"
                "Analyze this change and provide your assessment."
            )

            return agent.structured_output(AnalysisResult, prompt)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Strands analysis call failed (%s), using fallback.", exc)
            return self._fallback_heuristic(diff, intents)
