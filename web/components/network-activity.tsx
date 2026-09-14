"use client";

import * as React from "react";

/**
 * App-wide network activity indicator.
 *
 * The dashboard issues a lot of client-side `fetch` calls, and only some of
 * them are paired with a local loading state — so requests can be in flight
 * with nothing on screen acknowledging them. Rather than requiring every
 * feature to remember its own flag, this wraps `window.fetch` once and counts
 * in-flight same-origin API requests. A thin indeterminate bar at the top of
 * the viewport renders whenever any are outstanding, which means *every*
 * current and future call site gets feedback for free.
 *
 * Route transitions are intentionally not the target here: Next.js request
 * prefetching fires constantly on hover, and real navigations are already
 * covered by route-level `loading.tsx` boundaries. Prefetch requests are
 * therefore excluded so the bar stays meaningful.
 */

let inFlight = 0;
const subscribers = new Set<() => void>();
let patched = false;

function notify() {
  for (const subscriber of subscribers) subscriber();
}

function isTrackedRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    // Next.js fires these on link hover; counting them would make the bar
    // flicker while the user is only reading the page.
    if (headers.get("Next-Router-Prefetch") === "1") return false;

    const origin = window.location.origin;
    return url.startsWith("/") || url.startsWith(origin);
  } catch {
    // If we cannot classify it, treat it as app traffic rather than hiding it.
    return true;
  }
}

function patchFetch() {
  if (patched || typeof window === "undefined") return;
  patched = true;

  const original = window.fetch;
  window.fetch = function trackedFetch(input: RequestInfo | URL, init?: RequestInit) {
    if (!isTrackedRequest(input, init)) {
      return original.call(window, input, init);
    }

    inFlight += 1;
    notify();

    const settle = () => {
      inFlight = Math.max(0, inFlight - 1);
      notify();
    };

    try {
      return Promise.resolve(original.call(window, input, init)).finally(settle);
    } catch (error) {
      settle();
      throw error;
    }
  } as typeof window.fetch;
}

// Patch at module scope: this module is imported by the root layout, so it
// evaluates before any component effect can issue its first request.
patchFetch();

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

function getSnapshot() {
  return inFlight;
}

function getServerSnapshot() {
  return 0;
}

/** Holds the bar back briefly so fast requests do not flash it on and off. */
function useDelayedVisible(active: boolean, delayMs = 150) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return visible;
}

export function NetworkActivityBar() {
  const inFlightCount = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const visible = useDelayedVisible(inFlightCount > 0);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
    >
      {visible && (
        <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-indigo-500 to-transparent" />
      )}
    </div>
  );
}
