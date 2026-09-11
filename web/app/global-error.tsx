"use client";

import { AlertOctagon, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-slate-900 text-white font-sans p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center ring-8 ring-rose-500/5">
            <AlertOctagon className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-white">
            Critical Failure
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            A fatal root-level application fault occurred. Click below to reload the container instance.
          </p>
          <div className="pt-2">
            <button
              onClick={() => reset()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
