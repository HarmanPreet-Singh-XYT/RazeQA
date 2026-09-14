"""Playwright trace capture configuration.

A full trace (``screenshots=True, snapshots=True, sources=True``) is the
richest forensic evidence, but it is also what makes a trace zip large enough
to exceed Supabase Storage's per-object limit — screenshots dominate, and
``sources`` bundles the app's own source files. These helpers let a deployment
shrink traces without editing every call site:

    PLAYWRIGHT_TRACE_SCREENSHOTS=false   # drop per-action screenshots
    PLAYWRIGHT_TRACE_SOURCES=false       # drop bundled source files

``snapshots`` stays on: without DOM snapshots a trace is barely replayable.
"""

from __future__ import annotations

import os
from typing import Any

_TRUTHY = {"1", "true", "yes", "on"}


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in _TRUTHY


def trace_screenshots() -> bool:
    """Whether traces capture a screenshot per action (largest trace component)."""
    return _flag("PLAYWRIGHT_TRACE_SCREENSHOTS", True)


def trace_sources() -> bool:
    """Whether traces bundle the tested app's source files."""
    return _flag("PLAYWRIGHT_TRACE_SOURCES", True)


def start_trace(tracing: Any) -> None:
    """Start tracing with the deployment's configured capture flags."""
    tracing.start(
        screenshots=trace_screenshots(),
        snapshots=True,
        sources=trace_sources(),
    )
