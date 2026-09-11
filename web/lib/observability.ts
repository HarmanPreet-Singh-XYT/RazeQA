"use client";

/**
 * Client-Side Real-Time Observability & Core Web Vitals Monitor.
 */

export interface TelemetryEvent {
  type: "web_vital" | "error" | "route_change";
  name: string;
  value?: number;
  rating?: "good" | "needs-improvement" | "poor";
  url: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export function sendTelemetry(event: TelemetryEvent) {
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(event)], { type: "application/json" });
      navigator.sendBeacon("/api/telemetry", blob);
    } else {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Fail silently so user experience is never blocked
  }
}

export function initClientObservability() {
  if (typeof window === "undefined") return;

  // Unhandled Exception Monitor
  window.addEventListener("error", (event) => {
    sendTelemetry({
      type: "error",
      name: "uncaught_exception",
      url: window.location.pathname,
      timestamp: new Date().toISOString(),
      metadata: {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  // Unhandled Promise Rejection Monitor
  window.addEventListener("unhandledrejection", (event) => {
    sendTelemetry({
      type: "error",
      name: "unhandled_rejection",
      url: window.location.pathname,
      timestamp: new Date().toISOString(),
      metadata: {
        reason: String(event.reason),
      },
    });
  });

  // Performance Observer for Paint & Layout Shift
  if ("PerformanceObserver" in window) {
    try {
      const paintObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.name === "first-contentful-paint") {
            sendTelemetry({
              type: "web_vital",
              name: "FCP",
              value: Math.round(entry.startTime),
              rating: entry.startTime < 1800 ? "good" : entry.startTime < 3000 ? "needs-improvement" : "poor",
              url: window.location.pathname,
              timestamp: new Date().toISOString(),
            });
          }
        }
      });
      paintObserver.observe({ type: "paint", buffered: true });
    } catch {
      // PerformanceObserver unsupported/restricted
    }
  }
}
