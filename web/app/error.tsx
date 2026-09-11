"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function RootErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("AutoQA Client Error Boundary caught exception:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6 py-12">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-xl text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center ring-8 ring-rose-50/50">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 tracking-tight">
          Application Error Encountered
        </h1>
        <p className="text-xs text-slate-600 leading-relaxed">
          The autonomous dashboard encountered an unexpected rendering anomaly.
          Our automated telemetry tracker has captured the stack trace.
        </p>
        {error.digest && (
          <div className="rounded-lg bg-slate-100 p-2 font-mono text-[11px] text-slate-700">
            Error Digest: {error.digest}
          </div>
        )}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => reset()}
            className="flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors shadow-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try Recovery
          </button>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Home className="h-3.5 w-3.5" />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
