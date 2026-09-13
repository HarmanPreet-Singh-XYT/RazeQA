"""Real LLM token-usage telemetry for Strands agent invocations.

Nothing here invents numbers. The values come from the Strands SDK's own
``Agent.event_loop_metrics`` (an :class:`~strands.telemetry.metrics.EventLoopMetrics`),
whose ``accumulated_usage`` is the provider-reported token accounting for every
model call the agent made.

Usage is captured through a :func:`contextmanager`-scoped accumulator:
``agent.models.factory.create_strands_agent`` registers each agent it constructs
with whatever accumulator is active for the current context, and the caller
(e.g. the pipeline) takes a :meth:`UsageAccumulator.snapshot` once the run is
done. Outside a scope, registration is a no-op.
"""

from __future__ import annotations

import contextvars
import logging
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

logger = logging.getLogger("agent.models.usage")


#: Operator-maintained pricing configuration, in USD per 1,000,000 tokens.
#:
#: These are *configuration*, not measurements: published list prices are
#: subject to change, enterprise agreements differ, and this table will drift
#: until an operator updates it. A model id that does not match any family here
#: yields no cost at all (``None``) rather than a guessed number. Keys are
#: matched as case-insensitive substrings, longest key first, against the
#: resolved model id.
MODEL_PRICING_USD_PER_MTOK: dict[str, dict[str, float]] = {
    # Anthropic Claude families
    "sonnet": {"input": 3.00, "output": 15.00},
    "haiku": {"input": 1.00, "output": 5.00},
    "opus": {"input": 15.00, "output": 75.00},
    # Google Gemini families ("flash-lite" must be matched before "flash")
    "flash-lite": {"input": 0.075, "output": 0.30},
    "flash": {"input": 0.30, "output": 2.50},
    "pro": {"input": 1.25, "output": 10.00},
}


def estimate_cost_usd(
    model_id: str | None,
    prompt_tokens: int | None,
    completion_tokens: int | None,
) -> float | None:
    """Compute USD cost from *real* token counts and the pricing table.

    Returns ``None`` when the model is unknown/unset or when either token count
    was not measured — an unknown model's price must never be guessed.
    """
    if not model_id or prompt_tokens is None or completion_tokens is None:
        return None
    lowered = model_id.lower()
    for family in sorted(MODEL_PRICING_USD_PER_MTOK, key=len, reverse=True):
        if family in lowered:
            prices = MODEL_PRICING_USD_PER_MTOK[family]
            return round(
                (prompt_tokens / 1_000_000.0) * prices["input"]
                + (completion_tokens / 1_000_000.0) * prices["output"],
                6,
            )
    return None


@dataclass
class LlmUsage:
    """Aggregated, real token usage for every Strands agent invocation in a run.

    Every numeric field is ``None`` when nothing was measured; a measured-but-
    zero value stays ``0``.
    """

    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    invocation_count: int = 0
    model_names: list[str] = field(default_factory=list)
    measured: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "invocation_count": self.invocation_count,
            "model_names": list(self.model_names),
            "measured": self.measured,
        }


def _agent_model_id(agent: Any) -> str | None:
    """Best-effort resolution of the concrete model id behind a Strands agent."""
    try:
        model = getattr(agent, "model", None)
        config = model.get_config() if model is not None else None
        if isinstance(config, dict):
            model_id = config.get("model_id") or config.get("model")
            if model_id:
                return str(model_id)
    except Exception as exc:  # noqa: BLE001 - telemetry must never break a run
        logger.debug("Could not resolve model id for usage tracking: %s", exc)
    return None


def _agent_usage_summary(agent: Any) -> dict[str, Any] | None:
    try:
        metrics = getattr(agent, "event_loop_metrics", None)
        if metrics is None or not hasattr(metrics, "get_summary"):
            return None
        summary = metrics.get_summary()
        return summary if isinstance(summary, dict) else None
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not read Strands usage summary: %s", exc)
        return None


class UsageAccumulator:
    """Collects real usage from every Strands agent created within a scope."""

    def __init__(self) -> None:
        self._agents: list[Any] = []
        self._seen_ids: set[int] = set()
        self._model_names: list[str] = []

    def record_agent(self, agent: Any) -> None:
        if agent is None:
            return
        key = id(agent)
        if key in self._seen_ids:
            return
        self._seen_ids.add(key)
        self._agents.append(agent)
        model_id = _agent_model_id(agent)
        if model_id and model_id not in self._model_names:
            self._model_names.append(model_id)

    @property
    def agent_count(self) -> int:
        return len(self._agents)

    def snapshot(self) -> LlmUsage:
        """Sum the real per-agent usage reports into a single :class:`LlmUsage`."""
        if not self._agents:
            return LlmUsage()

        prompt = completion = total = cache_read = cache_write = 0
        invocations = 0
        observed = False
        for agent in self._agents:
            summary = _agent_usage_summary(agent)
            if summary is None:
                continue
            observed = True
            usage = summary.get("accumulated_usage") or {}
            if isinstance(usage, dict):
                prompt += int(usage.get("inputTokens") or 0)
                completion += int(usage.get("outputTokens") or 0)
                total += int(usage.get("totalTokens") or 0)
                cache_read += int(usage.get("cacheReadInputTokens") or 0)
                cache_write += int(usage.get("cacheWriteInputTokens") or 0)
            invocations += int(summary.get("total_cycles") or 0)

        if not observed:
            return LlmUsage(model_names=list(self._model_names))

        return LlmUsage(
            prompt_tokens=prompt,
            completion_tokens=completion,
            total_tokens=total,
            cache_read_tokens=cache_read,
            cache_write_tokens=cache_write,
            invocation_count=invocations,
            model_names=list(self._model_names),
            measured=True,
        )


_CURRENT_USAGE: contextvars.ContextVar[UsageAccumulator | None] = contextvars.ContextVar(
    "agent_usage_accumulator", default=None
)


@contextmanager
def usage_scope() -> Iterator[UsageAccumulator]:
    """Activate a fresh usage accumulator for the current context.

    Contexts copied into worker threads (``asyncio.to_thread``) see the same
    accumulator object, so agents created on a worker thread are still counted.
    """
    accumulator = UsageAccumulator()
    token = _CURRENT_USAGE.set(accumulator)
    try:
        yield accumulator
    finally:
        _CURRENT_USAGE.reset(token)


def record_agent_usage(agent: Any) -> None:
    """Register an agent with the active accumulator, if any."""
    accumulator = _CURRENT_USAGE.get()
    if accumulator is not None:
        accumulator.record_agent(agent)


def install_usage_accumulator(accumulator: UsageAccumulator | None) -> None:
    """Activate ``accumulator`` for the current context (see :func:`usage_scope`).

    Provided for long async call chains that cannot be wrapped in a single
    ``with`` block; callers must :func:`clear_usage_accumulator` when done.
    """
    _CURRENT_USAGE.set(accumulator)


def clear_usage_accumulator() -> None:
    """Deactivate the current context's accumulator (idempotent)."""
    _CURRENT_USAGE.set(None)
