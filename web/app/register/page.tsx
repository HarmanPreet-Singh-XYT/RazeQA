import { Suspense } from "react";
import Link from "next/link";
import { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { AuthForm } from "@/app/login/page";

export const metadata: Metadata = {
  title: "Create Account | AutoQA Platform",
  description: "Sign up for AutoQA autonomous PR testing and quality forensics.",
};

export default function RegisterPage() {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-[#fafaf9] text-slate-900 px-4 py-12 selection:bg-slate-200">
      {/* Structural graph grid pattern */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light mask-radial-light opacity-70" />

      {/* Top Header Navigation */}
      <div className="absolute top-6 left-6 right-6 max-w-6xl mx-auto flex items-center justify-between z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-950 transition-colors rounded-lg border border-slate-200 bg-white/90 backdrop-blur-xs px-3 py-1.5 shadow-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Home</span>
        </Link>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-slate-200 bg-white/90 backdrop-blur-xs px-3 py-1 text-xs text-slate-600 shadow-xs">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-mono text-[11px] font-semibold text-slate-700">
              Supabase Auth v2 • Operational
            </span>
          </div>
        </div>
      </div>

      {/* Main Brand Identifier */}
      <div className="relative mb-6 flex flex-col items-center text-center z-10">
        <Link href="/" className="mb-2 flex items-center gap-2.5 group">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white font-mono font-bold text-sm shadow-md group-hover:scale-105 transition-transform">
            QA
          </div>
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-slate-950">
          AutoQA Platform
        </h1>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">
          Autonomous testing platform for Claude Code
        </p>
      </div>

      {/* Auth Card Container with initialTab="register" */}
      <div className="relative z-10 w-full flex justify-center">
        <Suspense
          fallback={
            <div className="w-full max-w-[420px] h-[480px] rounded-2xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-xs text-slate-400">
              Loading registration…
            </div>
          }
        >
          <AuthForm initialTab="register" />
        </Suspense>
      </div>
    </div>
  );
}
