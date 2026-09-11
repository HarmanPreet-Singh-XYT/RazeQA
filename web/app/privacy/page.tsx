import React from "react";
import Link from "next/link";
import { ArrowLeft, Lock, ShieldCheck, EyeOff } from "lucide-react";

export const metadata = {
  title: "Privacy Policy — AutoQA",
  description: "Privacy practices and data handling policies of the AutoQA verification platform.",
};

export default function PrivacyPage() {
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
              <span>Back to AutoQA</span>
            </Link>
          </div>
          <span className="font-mono text-xs text-slate-500">Last Updated: September 2026</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-8">
        <div className="space-y-2 border-b border-slate-200 pb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200 mb-2">
            <Lock className="h-3.5 w-3.5" />
            Data Protection
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-950">
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            How AutoQA collects, handles, redacts, and stores telemetry and source code data.
          </p>
        </div>

        <section className="space-y-4 text-sm text-slate-700 leading-relaxed">
          <h2 className="text-lg font-bold text-slate-950">1. Information We Collect</h2>
          <p>
            AutoQA collects authentication credentials via Supabase Auth (email address and GitHub OAuth user identifiers). During PR verification runs, we collect ephemeral test execution artifacts including DOM snapshots, Playwright execution traces, console logs, and network telemetry.
          </p>

          <h2 className="text-lg font-bold text-slate-950">2. Automated Secret Redaction</h2>
          <p>
            All captured network waterfalls, HTTP request bodies, and console error diagnostics pass through an automated high-entropy regex redaction filter. Bearer tokens, private keys, API secrets, and sensitive authentication headers are stripped before storage.
          </p>

          <h2 className="text-lg font-bold text-slate-950">3. Ephemeral Sandbox Retention</h2>
          <p>
            Containerized test instances and browser execution recordings are retained for diagnostic review and automatically expired pursuant to your project retention policy. Source code clones are kept in isolated, transient volumes discarded immediately following journey execution.
          </p>

          <h2 className="text-lg font-bold text-slate-950">4. Third-Party Integrations</h2>
          <p>
            When utilizing AI remediation features, sanitized error diagnostics and AST code diffs are transmitted to AI providers solely for synthesized patch generation. Your private source code is never used to train generalized foundation models.
          </p>

          <h2 className="text-lg font-bold text-slate-950">5. Contact &amp; Data Subject Rights</h2>
          <p>
            To request deletion of your account, organization telemetry, or connected repositories, please contact your AutoQA workspace administrator or email <code className="text-indigo-600 font-mono text-xs">privacy@autoqa.dev</code>.
          </p>
        </section>

        <div className="pt-8 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <p>© 2026 AutoQA Platform. All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/terms" className="hover:underline">Terms of Service</Link>
            <Link href="/security" className="hover:underline">Security Overview</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
