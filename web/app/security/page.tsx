import React from "react";
import Link from "next/link";
import { ArrowLeft, Shield, ShieldCheck, Lock, Key, Server, Terminal } from "lucide-react";

export const metadata = {
  title: "Security Overview — RazeQA",
  description: "Enterprise security architecture, isolation boundaries, and encryption mechanisms of RazeQA.",
};

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans selection:bg-slate-200">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors rounded-md border border-slate-200 px-2.5 py-1.5 bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to RazeQA</span>
            </Link>
          </div>
          <span className="font-mono text-xs text-slate-500">Security Model v2.4</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2 border-b border-slate-200 pb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200 mb-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Infrastructure Security
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
            Security Overview
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Our architectural guarantees for sandbox isolation, token protection, and network safety.
          </p>
        </div>

        <section className="space-y-6 text-sm text-slate-700 leading-relaxed">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <div className="flex items-center gap-2 text-slate-950 font-bold">
              <Server className="h-4 w-4 text-emerald-600" />
              <span>Containerized Sandbox Isolation</span>
            </div>
            <p className="text-xs text-slate-600">
              Every PR verification run boots a single-tenant Docker container for the app under test, capped on memory, CPU and PIDs, with all capabilities dropped (plus DAC_OVERRIDE) and <code className="font-mono">no-new-privileges</code> set. The container is created on demand and removed with <code className="font-mono">--rm</code> when the run completes.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <div className="flex items-center gap-2 text-slate-950 font-bold">
              <Lock className="h-4 w-4 text-indigo-600" />
              <span>SSRF Mitigation &amp; Safe Network Egress</span>
            </div>
            <p className="text-xs text-slate-600">
              External verification and developer tools strictly enforce IP denylisting. Loopback ranges (127.0.0.0/8), RFC1918 private subnets, link-local addresses (169.254.169.254 cloud metadata), and multicast pools are blocked at the DNS and socket levels before any HTTP connection is established.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <div className="flex items-center gap-2 text-slate-950 font-bold">
              <Key className="h-4 w-4 text-amber-600" />
              <span>Encrypted Credential Storage</span>
            </div>
            <p className="text-xs text-slate-600">
              Test-user credentials are encrypted at rest with AES-256-GCM using a key supplied out-of-band via <code className="font-mono">CREDENTIAL_STORE_KEY</code> (required when running in production). Credentials are injected into the sandbox as environment variables at boot and are excluded from intent logs, LLM prompts, and generated remediation text.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <div className="flex items-center gap-2 text-slate-950 font-bold">
              <Shield className="h-4 w-4 text-blue-600" />
              <span>Strict Content Security Policy (CSP)</span>
            </div>
            <p className="text-xs text-slate-600">
              All dashboard routes enforce strict CSP headers, restricting script executions, blocking unsafe inline code injections, and locking frame ancestors to prevent clickjacking.
            </p>
          </div>
        </section>

        <div className="pt-8 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <p>© 2026 RazeQA Platform. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:underline">Terms of Service</Link>
            <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
