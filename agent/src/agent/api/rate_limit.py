"""In-process sliding-window limiter for expensive engine endpoints.

The engine already rate-limited *forced* runs per repository. That left the
other expensive entry points — spawning a browser against an external URL, or an
LLM-backed copilot turn — uncapped, so a single caller could saturate the worker
pool.

This is deliberately a small in-process limiter, not a distributed one: the
engine runs as a single service and the goal is to bound abuse and accidental
loops, not to meter billing. A multi-replica deployment should put a shared
limiter in front; this stays as the last line of defence.
"""

from __future__ import annotations

import threading
import time


class SlidingWindowLimiter:
    """Allow at most ``max_events`` per ``window_seconds`` for each key."""

    def __init__(self, max_events: int, window_seconds: float) -> None:
        self._max_events = max(1, int(max_events))
        self._window = max(1.0, float(window_seconds))
        self._events: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> float:
        """Record an attempt and return 0.0 when allowed, else seconds to wait."""
        now = time.time()
        bucket = key or "anonymous"
        with self._lock:
            history = [t for t in self._events.get(bucket, []) if now - t < self._window]
            if len(history) >= self._max_events:
                oldest = history[0]
                self._events[bucket] = history
                return max(0.0, self._window - (now - oldest))
            history.append(now)
            self._events[bucket] = history
            # Opportunistic cleanup so an unbounded set of keys cannot grow forever.
            if len(self._events) > 5000:
                self._events = {
                    k: [t for t in v if now - t < self._window]
                    for k, v in self._events.items()
                    if any(now - t < self._window for t in v)
                }
            return 0.0


#: External-site runs: a browser per request, so the cap is low.
external_run_limiter = SlidingWindowLimiter(max_events=6, window_seconds=60.0)
#: Copilot turns are LLM-backed; a generous but finite per-conversation cap.
copilot_chat_limiter = SlidingWindowLimiter(max_events=20, window_seconds=60.0)
