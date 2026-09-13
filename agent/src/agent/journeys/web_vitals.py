"""Real browser Web Vitals collection.

This module owns the browser-side collector that must be installed on a page
BEFORE any navigation (Playwright ``page.add_init_script``) so it observes the
whole page lifecycle, plus the Python reader that turns the collected raw
Performance API data into metric values.

Design rules (see the repository's "never invent a measured number" contract):

* Every metric is ``None`` when it was not actually observed.
* The module records *which* metrics were measured so downstream code can
  distinguish "measured as 0" from "not measured".
* ``tti_ms`` is explicitly an approximation (see ``_estimate_tti``); the
  approximation used is reported in ``tti_source``.
* ``inp_ms`` is only reported when a real interaction ``event`` (or
  ``first-input``) entry was observed. A page with no interaction has no INP —
  reporting one would be fabrication, so it stays ``None``.
"""

from __future__ import annotations

import logging
from typing import Any

from playwright.sync_api import Page

logger = logging.getLogger("agent.journeys.web_vitals")

#: Source label for metrics that came from the browser Performance API.
WEB_VITALS_SOURCE = "browser_performance_api"
#: Source label used when nothing at all could be observed.
WEB_VITALS_SOURCE_UNMEASURED = "unmeasured"

#: Quiet window (ms) required after the last observed long task for the TTI
#: approximation to consider the main thread "reliably interactive".
#:
#: True TTI (Time to Interactive) is not exposed by any browser API. The
#: approximation here is the long-task-based quiet window used by Lighthouse:
#: the moment after First Contentful Paint at which the main thread has had no
#: long task (>50ms) for at least this window. It is reported as an
#: approximation via ``tti_source`` — never as a directly measured value.
TTI_QUIET_WINDOW_MS = 500.0

#: Browser-side accumulator. Installed before navigation; accumulates into a
#: single global, ``window.__qaVitals``.
WEB_VITALS_INIT_SCRIPT = r"""
(() => {
  if (window.__qaVitals) return;
  const v = {
    fcp_ms: null,
    lcp_ms: null,
    cls: 0,
    cls_observed: false,
    inp_ms: null,
    ttfb_ms: null,
    long_tasks: [],
    now_ms: null,
    collector_errors: [],
  };
  window.__qaVitals = v;

  const safeObserve = (type, cb, opts) => {
    try {
      const observer = new PerformanceObserver((list) => {
        try { cb(list.getEntries()); } catch (e) { v.collector_errors.push(String(e)); }
      });
      observer.observe(Object.assign({ type: type, buffered: true }, opts || {}));
      return observer;
    } catch (e) {
      v.collector_errors.push(type + ': ' + String(e));
      return null;
    }
  };

  // TTFB: time from navigation start to the first byte of the response, read
  // from the navigation timing entry (responseStart - startTime). startTime is
  // 0 for the navigation entry, so this equals responseStart; using the actual
  // entry avoids hardcoding that assumption.
  const readTtfb = (entries) => {
    for (const e of entries) {
      if (e && typeof e.responseStart === 'number' && e.responseStart > 0) {
        v.ttfb_ms = Math.max(0, e.responseStart - (e.startTime || 0));
      }
    }
  };
  if (safeObserve('navigation', readTtfb) === null) {
    // Older engines may not deliver navigation entries through
    // PerformanceObserver; fall back to the buffered entry list directly.
    try { readTtfb(performance.getEntriesByType('navigation')); }
    catch (e) { v.collector_errors.push('navigation-fallback: ' + String(e)); }
  }

  safeObserve('paint', (entries) => {
    for (const e of entries) {
      if (e.name === 'first-contentful-paint' && typeof e.startTime === 'number') {
        v.fcp_ms = e.startTime;
      }
    }
  });

  safeObserve('largest-contentful-paint', (entries) => {
    for (const e of entries) {
      // LCP may be revised; the LAST reported candidate wins.
      if (typeof e.startTime === 'number') v.lcp_ms = e.startTime;
    }
  });

  if (safeObserve('layout-shift', (entries) => {
    for (const e of entries) {
      if (!e.hadRecentInput) v.cls += e.value;
    }
  }) !== null) {
    // A successfully installed observer plus zero entries means a genuinely
    // measured CLS of 0 (no unexpected layout shifts), not "unmeasured".
    v.cls_observed = true;
  }

  // INP: the browser has no "INP" entry. We record the worst observed event
  // duration as a practical proxy (INP is by definition interaction-driven),
  // and leave it null when no interaction ever happened.
  const recordEvent = (e) => {
    if (!e || typeof e.duration !== 'number') return;
    if (v.inp_ms === null || e.duration > v.inp_ms) v.inp_ms = e.duration;
  };
  if (safeObserve('event', (entries) => entries.forEach(recordEvent), { durationThreshold: 40 }) === null) {
    safeObserve('first-input', (entries) => entries.forEach(recordEvent));
  }

  // Long tasks feed the documented TTI approximation computed in Python.
  safeObserve('longtask', (entries) => {
    for (const e of entries) {
      if (typeof e.startTime === 'number' && typeof e.duration === 'number') {
        v.long_tasks.push({ start: e.startTime, duration: e.duration });
      }
    }
  });
})();
"""


#: Reads the accumulated global and stamps the observation end time so the
#: TTI approximation can verify its quiet window actually elapsed.
_READ_VITALS_SCRIPT = """() => {
  const v = window.__qaVitals;
  if (!v) return null;
  try { v.now_ms = performance.now(); } catch (e) { v.now_ms = null; }
  return v;
}"""


def _as_float(value: Any) -> float | None:
    """Return ``value`` as a finite float, or None when it is not a number."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if result != result or result in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return result


def _estimate_tti(fcp_ms: float | None, long_tasks: Any, now_ms: float | None) -> float | None:
    """Long-task quiet-window TTI approximation (see :data:`TTI_QUIET_WINDOW_MS`).

    Returns ``None`` when FCP was never observed, when the observation end time
    is unknown, or when the quiet window had not yet elapsed by the time the
    journey read the metrics — in that last case the page was demonstrably not
    quiet long enough to claim interactivity.
    """
    if fcp_ms is None or now_ms is None:
        return None
    last_busy_end = fcp_ms
    if isinstance(long_tasks, list):
        for task in long_tasks:
            if not isinstance(task, dict):
                continue
            start = _as_float(task.get("start"))
            duration = _as_float(task.get("duration"))
            if start is None or duration is None:
                continue
            last_busy_end = max(last_busy_end, start + duration)
    if now_ms - last_busy_end < TTI_QUIET_WINDOW_MS:
        return None
    return round(last_busy_end, 1)


def vitals_from_raw(raw: Any) -> dict[str, Any]:
    """Normalize a raw ``window.__qaVitals`` payload into a metric dict.

    Pure function (no browser needed) so the None-vs-measured behaviour is unit
    testable. Any metric that was not observed stays ``None``.
    """
    unmeasured: dict[str, Any] = {
        "lcp_ms": None,
        "cls": None,
        "inp_ms": None,
        "fcp_ms": None,
        "ttfb_ms": None,
        "tti_ms": None,
        "measured": False,
        "measured_metrics": [],
        "source": WEB_VITALS_SOURCE_UNMEASURED,
        "tti_source": None,
    }
    if not isinstance(raw, dict):
        return unmeasured

    fcp_ms = _as_float(raw.get("fcp_ms"))
    lcp_ms = _as_float(raw.get("lcp_ms"))
    ttfb_ms = _as_float(raw.get("ttfb_ms"))
    inp_ms = _as_float(raw.get("inp_ms"))
    # CLS of 0 is a real measurement once the observer is installed; a missing
    # observer leaves it unmeasured.
    cls = _as_float(raw.get("cls")) if raw.get("cls_observed") else None
    tti_ms = _estimate_tti(fcp_ms, raw.get("long_tasks"), _as_float(raw.get("now_ms")))

    measured_metrics = [
        name
        for name, value in (
            ("fcp_ms", fcp_ms),
            ("lcp_ms", lcp_ms),
            ("cls", cls),
            ("ttfb_ms", ttfb_ms),
            ("inp_ms", inp_ms),
            ("tti_ms", tti_ms),
        )
        if value is not None
    ]

    return {
        "lcp_ms": round(lcp_ms, 1) if lcp_ms is not None else None,
        "cls": round(cls, 4) if cls is not None else None,
        "inp_ms": round(inp_ms, 1) if inp_ms is not None else None,
        "fcp_ms": round(fcp_ms, 1) if fcp_ms is not None else None,
        "ttfb_ms": round(ttfb_ms, 1) if ttfb_ms is not None else None,
        "tti_ms": tti_ms,
        "measured": bool(measured_metrics),
        "measured_metrics": measured_metrics,
        "source": WEB_VITALS_SOURCE if measured_metrics else WEB_VITALS_SOURCE_UNMEASURED,
        "tti_source": "long_task_quiet_window_approx" if tti_ms is not None else None,
    }


def collect_web_vitals(page: Page) -> dict[str, Any]:
    """Read the metrics accumulated by :data:`WEB_VITALS_INIT_SCRIPT`.

    Must be called while the page is still open. Returns an all-``None``
    unmeasured payload if the collector was never installed or the read fails.
    """
    try:
        raw = page.evaluate(_READ_VITALS_SCRIPT)
    except Exception as exc:  # noqa: BLE001 - a failed read must degrade to unmeasured, never crash the journey
        logger.warning("Failed to read web vitals from page: %s", exc)
        raw = None
    return vitals_from_raw(raw)
