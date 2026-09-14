"use client";

import React, { useState, useEffect } from "react";
import { ShieldCheck, X } from "lucide-react";

export function CookieConsent() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("razeqa_consent");
    if (!consent) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("razeqa_consent", "accepted");
    setIsVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem("razeqa_consent", "dismissed");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <aside
      role="region"
      aria-label="Privacy & Cookie Preferences"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md p-4 shadow-xl ring-1 ring-black/5 animate-in slide-in-from-bottom-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="flex-1 text-xs">
          <h2 className="font-bold text-slate-900 mb-1">Privacy & Data Preferences</h2>
          <p className="text-slate-600 leading-relaxed mb-3">
            We use essential session tokens and performance telemetry to detect test regressions and ensure security compliance.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAccept}
              className="rounded-lg bg-slate-950 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 transition-colors shadow-xs"
            >
              Accept Essential & Telemetry
            </button>
            <button
              onClick={handleDismiss}
              className="rounded-lg px-2.5 py-1.5 font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-400 hover:text-slate-700 transition-colors"
          aria-label="Close banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
