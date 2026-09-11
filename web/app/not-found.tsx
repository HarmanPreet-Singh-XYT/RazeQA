import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#fafaf9] px-6 py-12">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center ring-8 ring-slate-100/50">
          <FileQuestion className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          404 — Page Not Found
        </h1>
        <p className="text-xs text-slate-600 leading-relaxed">
          The route or forensic artifact you requested does not exist or may have been purged in retention cycle.
        </p>
        <div className="pt-2 flex justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors shadow-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
