"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Video,
  XCircle,
} from "lucide-react";


function GithubIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
      <path d="M9 18c-4.51 2-5-2-7-2" />
    </svg>
  );
}

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<"remediation" | "video" | "trace" | "intent">("remediation");
  const [copied, setCopied] = useState(false);
  const [cliCopied, setCliCopied] = useState(false);

  const sampleRemediation = `## 🚨 Autonomous PR Verification Failed: checkout
> **Risk Assessment:** HIGH RISK
> **Affected Surfaces:** /checkout, /dashboard

### 🔍 Forensic Evidence
- **Error:** 'Invalid customer address for Apple Pay token invoice generation'
- **Video:** artifacts/runs/feat-quick-checkout_f1e2d3c4/video.webm
- **Trace:** artifacts/runs/feat-quick-checkout_f1e2d3c4/trace.zip

### 🧠 Intent Context Hand-off
- User Prompt: "Add instant Apple Pay button to checkout"
- Agent Intent: "Bypass standard address form for 1-tap checkout"
- Touched: components/pay-button.tsx, app/checkout/page.tsx

### 📋 Ready-to-Paste Remediation Prompt for Claude Code:
Fix regression in /checkout: Ensure the Apple Pay session handler passes the default billing address token downstream to the invoice service.`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCli = () => {
    navigator.clipboard.writeText("uv run agent-bridge check");
    setCliCopied(true);
    setTimeout(() => setCliCopied(false), 2000);
  };

  return (
    <div className="relative min-h-screen bg-[#fafaf9] text-slate-900 font-sans selection:bg-slate-200">
      {/* Structural graph grid pattern */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light mask-radial-light opacity-70" />

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white font-mono font-bold text-xs shadow-sm">
              QA
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900 tracking-tight text-base">AutoQA</span>
              <span className="hidden sm:inline-block rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-600">
                v1.0
              </span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold text-slate-600">
            <a href="#how-it-works" className="hover:text-slate-950 transition-colors">How it works</a>
            <a href="#forensics" className="hover:text-slate-950 transition-colors">Forensics</a>
            <a href="#comparison" className="hover:text-slate-950 transition-colors">Comparison</a>
            <a href="#architecture" className="hover:text-slate-950 transition-colors">Architecture</a>
            <Link href="/tools" className="text-indigo-600 hover:text-indigo-900 transition-colors font-bold">
              Dev Tools Hub
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/tools"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-2 py-1.5 transition-colors hidden sm:inline-block"
            >
              Tools
            </Link>
            <Link
              href="/dashboard"
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 transition-colors"
            >
              Control Center
            </Link>
            <Link
              href="/api/github/install"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-95 transition-all"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              Connect GitHub
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 border-b border-slate-200">
        <div className="mx-auto max-w-4xl px-6 text-center">
          {/* Status Badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3.5 py-1 text-xs font-medium text-slate-800 shadow-sm mb-7">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <span>Autonomous QA for Claude Code</span>
            <ChevronRight className="h-3 w-3 text-slate-400" />
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-950 leading-[1.08] mb-6">
            AI writes code in seconds.
            <br />
            <span className="text-slate-600">
              Catching what it broke shouldn&apos;t take all afternoon.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto max-w-2xl text-base sm:text-lg text-slate-600 leading-relaxed mb-9 font-normal">
            A background bridge that captures the <em>intent</em> behind your prompt, runs headless browser journeys on every change, and produces video proof + a <strong>ready-to-paste fix</strong> before you merge.
          </p>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-12">
            <Link
              href="/api/github/install"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-6 py-3 text-xs font-bold text-white shadow-sm hover:bg-slate-800 active:scale-95 transition-all"
            >
              Install GitHub App
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>

            <button
              onClick={copyCli}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-5 py-3 text-xs font-mono text-slate-800 shadow-sm hover:bg-slate-50 active:scale-95 transition-all"
            >
              <Terminal className="h-3.5 w-3.5 text-slate-600" />
              <span>uv run agent-bridge check</span>
              {cliCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
            </button>
          </div>

          {/* Feature Highlights */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-slate-600 font-medium">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>Zero manual test writing</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-slate-700" />
              <span>Encrypted test accounts</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="h-4 w-4 text-slate-700" />
              <span>SHA-based freshness cache</span>
            </div>
          </div>
        </div>

        {/* Light Mode Split Console (Completely Clean) */}
        <div className="mx-auto max-w-5xl px-6 mt-14">
          <div className="rounded-xl border border-slate-300 bg-white shadow-lg shadow-slate-200/60 overflow-hidden">
            {/* Window Bar */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full bg-slate-300 border border-slate-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-slate-300 border border-slate-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-slate-300 border border-slate-400" />
                <span className="ml-2 font-mono text-xs text-slate-600 font-medium">closed-loop-qa.sh</span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-mono font-semibold text-slate-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Bridge Connected (daemon → platform)
              </span>
            </div>

            {/* Split View */}
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              {/* Left Pane: Coding Agent Activity (Clean Light) */}
              <div className="p-5 font-mono text-xs bg-white text-slate-800">
                <div className="flex items-center justify-between text-slate-500 mb-3 pb-2 border-b border-slate-100 font-sans">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-3.5 w-3.5 text-slate-800" />
                    <span className="font-semibold text-slate-900">Coding Agent (Claude Code / Cursor)</span>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">branch: feat/quick-checkout</span>
                </div>

                <div className="space-y-3 leading-relaxed">
                  <p className="text-slate-700">
                    <span className="font-bold text-slate-900">&gt; user:</span> &quot;Add Apple Pay button to checkout form&quot;
                  </p>
                  <p className="text-slate-700">
                    <span className="font-bold text-slate-900">&gt; agent:</span> Modifying <code className="bg-slate-100 text-slate-900 px-1 py-0.5 rounded border border-slate-200">components/pay-button.tsx</code>...
                  </p>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5 text-[11px]">
                    <div className="font-bold text-slate-900 mb-1">
                      [Bridge Intent Stream Captured]
                    </div>
                    <div className="text-slate-600 space-y-0.5">
                      <div>• Intent: Bypass address form on Apple Pay token</div>
                      <div>• Rationale: Accelerate checkout completion</div>
                      <div>• SHA: <span className="font-mono text-slate-900 font-bold">f1e2d3c4</span> (Pushed to platform)</div>
                    </div>
                  </div>
                  <div className="text-slate-600">
                    <span className="text-slate-400 font-mono">$ agent-bridge check</span><br />
                    <span className="text-slate-900 font-medium">✓ Verification enqueued. Booting sandbox + headless browser...</span>
                  </div>
                </div>
              </div>

              {/* Right Pane: Autonomous Playwright Sandbox (Clean Light) */}
              <div className="p-5 font-mono text-xs bg-slate-50/60 text-slate-800">
                <div className="flex items-center justify-between text-slate-500 mb-3 pb-2 border-b border-slate-200 font-sans">
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-slate-800" />
                    <span className="font-semibold text-slate-900">Autonomous QA Sandbox</span>
                  </div>
                  <span className="rounded border border-rose-300 bg-rose-50 text-rose-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                    High Risk Flagged
                  </span>
                </div>

                <div className="space-y-2.5 leading-relaxed">
                  <div className="flex items-center justify-between text-slate-500 text-[11px]">
                    <span>Analysis: Touched checkout flow</span>
                    <span className="font-bold text-slate-900">Risk: High</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-slate-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Seeded Auth Journey: /login -&gt; passed (190ms)</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-800">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span>Nested Scroll: Dashboard container scrolled (element-targeted)</span>
                    </div>
                    <div className="flex items-start gap-2 border border-rose-200 bg-rose-50/70 p-2.5 rounded text-rose-900">
                      <XCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Journey &apos;checkout&apos; FAILED</span><br />
                        <span className="text-slate-600 text-[11px]">Invoice creation error: customer_address missing</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Video className="h-3 w-3 text-rose-600" />
                      video.webm (session recording)
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Layers className="h-3 w-3 text-slate-600" />
                      trace.zip (DOM snapshots)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Bar */}
            <div className="border-t border-slate-200 bg-white p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <strong className="text-slate-900">Forensic Proof Produced:</strong> Copy-paste this remediation prompt back to Claude Code to fix in seconds.
              </div>
              <button
                onClick={() => copyToClipboard(sampleRemediation)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 hover:bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-all active:scale-95 shadow-sm"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied to Clipboard!" : "Copy Remediation Prompt"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* The Core Problems */}
      <section className="py-20 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-3">
              Why traditional CI fails AI coding workflows
            </h2>
            <p className="text-sm text-slate-600">
              When developers generate features at 10x speed, testing blindspots compound instantly.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card-light rounded-xl p-6">
              <div className="font-mono text-xs font-bold text-slate-900 mb-2">01 / ADJACENT REGRESSIONS</div>
              <h3 className="font-bold text-slate-900 text-base mb-2">Nobody re-tests unmentioned flows</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your coding agent fixes an input validation rule, but silently breaks a checkout invoice flow 3 screens downstream that nobody wrote a test for.
              </p>
            </div>

            <div className="card-light rounded-xl p-6">
              <div className="font-mono text-xs font-bold text-slate-900 mb-2">02 / REPRODUCTION WASTE</div>
              <h3 className="font-bold text-slate-900 text-base mb-2">Hours spent reproducing stack traces</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                CI reports a red failure with a cryptic stack trace — no video replay, no network waterfall, and zero record of <em>why</em> the code was changed.
              </p>
            </div>

            <div className="card-light rounded-xl p-6">
              <div className="font-mono text-xs font-bold text-slate-900 mb-2">03 / MANUAL REMEDIATION</div>
              <h3 className="font-bold text-slate-900 text-base mb-2">Humans stuck bridging the gap</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Developers manually copy error messages, craft new prompts explaining the failure context, and hope the agent fixes it without breaking something else.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works (The 4 Steps) */}
      <section id="how-it-works" className="py-20 border-b border-slate-200 bg-[#fafaf9]">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1 block">
              Workflow
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-3">
              The closed loop in 4 steps
            </h2>
            <p className="text-sm text-slate-600">
              The AI that wrote your code hands off intent to the AI that tests it.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            <div className="card-light rounded-xl p-5">
              <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-xs text-slate-800 mb-3">
                1
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">Code naturally</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Use Claude Code as you always do. The bridge hook captures each edit — no extra workflow steps.
              </p>
            </div>

            <div className="card-light rounded-xl p-5">
              <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-xs text-slate-800 mb-3">
                2
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">Intent Capture</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The local bridge daemon captures files touched, prompt summaries, and agent reasoning, and streams them to the platform.
              </p>
            </div>

            <div className="card-light rounded-xl p-5">
              <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-xs text-slate-800 mb-3">
                3
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">Playwright Sandbox</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Spins up a preview container, logs in with test credentials, and exercises user journeys.
              </p>
            </div>

            <div className="card-light rounded-xl p-5">
              <div className="h-8 w-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-xs text-slate-800 mb-3">
                4
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">One-Click Fix</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Failures yield exact remediation markdown prompts. Paste back into your agent to resolve.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Forensic Proof Explorer */}
      <section id="forensics" className="py-20 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1 block">
              Forensic Artifacts
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-3">
              Forensic proof for every run
            </h2>
            <p className="text-sm text-slate-600">
              Recordings and traces captured together for every run, so nobody has to reproduce failures by hand.
            </p>
          </div>

          <div className="card-light rounded-xl overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
              <button
                onClick={() => setActiveTab("remediation")}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-all shrink-0 ${
                  activeTab === "remediation"
                    ? "border-slate-950 text-slate-950 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                Remediation Prompt
              </button>

              <button
                onClick={() => setActiveTab("video")}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-all shrink-0 ${
                  activeTab === "video"
                    ? "border-slate-950 text-slate-950 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Video className="h-3.5 w-3.5" />
                Session Video
              </button>

              <button
                onClick={() => setActiveTab("trace")}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-all shrink-0 ${
                  activeTab === "trace"
                    ? "border-slate-950 text-slate-950 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Playwright Trace & DOM
              </button>

              <button
                onClick={() => setActiveTab("intent")}
                className={`flex items-center gap-1.5 px-4 py-3 text-xs font-bold border-b-2 transition-all shrink-0 ${
                  activeTab === "intent"
                    ? "border-slate-950 text-slate-950 bg-white"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                <GitBranch className="h-3.5 w-3.5" />
                Developer Intent Log
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-5">
              {activeTab === "remediation" && (
                <div>
                  <div className="flex items-center justify-between mb-3 text-xs">
                    <span className="font-mono text-slate-500">remediation-prompt.md</span>
                    <button
                      onClick={() => copyToClipboard(sampleRemediation)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
                    >
                      <Copy className="h-3 w-3" />
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <pre className="rounded-lg border border-slate-200 bg-slate-50 text-slate-800 p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                    {sampleRemediation}
                  </pre>
                </div>
              )}

              {activeTab === "video" && (
                /*
                  This panel used to embed
                  "/artifacts/runs/feat-quick-checkout_f1e2d3c4/video.webm". No such
                  file exists, this app has no /artifacts route (real artifacts are
                  served from /api/artifacts/runs/...), and next.config defines no
                  rewrite — so the player always 404'd and reported "Unsupported
                  video format" to every visitor. Rather than point at another
                  invented path, the panel states what appears here on a real run.
                */
                <div className="text-center py-8">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 mb-3">
                    <Video className="h-6 w-6" />
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1">Journey Video</h4>
                  <p className="text-xs text-slate-600 max-w-sm mx-auto">
                    Every journey records an H.264 video alongside the trace, DOM snapshot, and
                    network waterfall. Open a run in the dashboard to watch the real recording for
                    your own application — no sample is embedded here.
                  </p>
                  <code className="mt-3 inline-block text-xs font-mono bg-slate-100 border border-slate-200 text-slate-800 px-2.5 py-1 rounded">
                    /api/artifacts/runs/&lt;run&gt;/video/&lt;route&gt;.mp4
                  </code>
                </div>
              )}

              {activeTab === "trace" && (
                <div className="text-center py-8">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 mb-3">
                    <Layers className="h-6 w-6" />
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1">Playwright Trace Archive</h4>
                  <p className="text-xs text-slate-600 max-w-sm mx-auto mb-3">
                    Network waterfalls, DOM snapshots at failure, and console warnings in a single zip file.
                  </p>
                  <code className="text-xs font-mono bg-slate-100 border border-slate-200 text-slate-800 px-2.5 py-1 rounded">
                    npx playwright show-trace artifacts/runs/trace.zip
                  </code>
                </div>
              )}

              {activeTab === "intent" && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-sans">
                      <span className="text-slate-900 font-bold">[edit] components/pay-button.tsx</span>
                      <span>2m ago</span>
                    </div>
                    <p className="text-slate-800">Prompt: &quot;Add instant Apple Pay button to checkout&quot;</p>
                    <p className="text-slate-500 mt-1">Intent: &quot;Bypass standard address form for 1-tap checkout&quot;</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1 font-sans">
                      <span className="text-slate-900 font-bold">[create] app/api/charge/route.ts</span>
                      <span>1m ago</span>
                    </div>
                    <p className="text-slate-800">Prompt: &quot;Add Apple Pay token charge handler&quot;</p>
                    <p className="text-slate-500 mt-1">Intent: &quot;Forward token to payment gateway server-side&quot;</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section id="comparison" className="py-20 border-b border-slate-200 bg-[#fafaf9]">
        <div className="mx-auto max-w-4xl px-6">
          <div className="text-center max-w-xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1 block">
              Comparison
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
              Traditional CI vs. Autonomous QA Engine
            </h2>
          </div>

          <div className="card-light rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <th className="py-3 px-5">Capability</th>
                  <th className="py-3 px-5 text-slate-500">Traditional CI Suite</th>
                  <th className="py-3 px-5 text-slate-950 font-bold">AutoQA Platform</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-normal text-slate-700">
                <tr>
                  <td className="py-3 px-5 font-semibold text-slate-900">Test Generation</td>
                  <td className="py-3 px-5 text-slate-500">Only what engineers hardcoded</td>
                  <td className="py-3 px-5 text-slate-900 font-semibold">Intent-driven user journeys</td>
                </tr>
                <tr>
                  <td className="py-3 px-5 font-semibold text-slate-900">Adjacent Bug Detection</td>
                  <td className="py-3 px-5 text-slate-500">Regressions slip through to prod</td>
                  <td className="py-3 px-5 text-slate-900 font-semibold">AI analyzer flags downstream routes</td>
                </tr>
                <tr>
                  <td className="py-3 px-5 font-semibold text-slate-900">Forensic Proof</td>
                  <td className="py-3 px-5 text-slate-500">Plain text terminal logs</td>
                  <td className="py-3 px-5 text-slate-900 font-semibold">Session video + Playwright trace</td>
                </tr>
                <tr>
                  <td className="py-3 px-5 font-semibold text-slate-900">Remediation</td>
                  <td className="py-3 px-5 text-slate-500">Manual reproducing & debugging</td>
                  <td className="py-3 px-5 text-slate-900 font-semibold">1-click prompt for Claude / Cursor</td>
                </tr>
                <tr>
                  <td className="py-3 px-5 font-semibold text-slate-900">Freshness Caching</td>
                  <td className="py-3 px-5 text-slate-500">Re-runs identical tests on push</td>
                  <td className="py-3 px-5 text-slate-900 font-semibold">SHA dedup returns the cached run on re-check</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* System Architecture & Security Deep Dive */}
      <section id="architecture" className="py-20 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-1 block">
              System Architecture
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-3">
              Isolated sandboxes with a clear data-retention story
            </h2>
            <p className="text-sm text-slate-600">
              Built for teams that need per-run isolation, auditable artifacts, and a retention window they control.
            </p>
          </div>

          {/* Architecture Pipeline Flow Diagram */}
          <div className="card-light rounded-xl p-6 sm:p-8 mb-10">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-slate-900" />
                <span className="font-bold text-slate-900 text-xs sm:text-sm">
                  Autonomous QA Execution Pipeline
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-mono text-slate-600">
                Disposable container per run
              </span>
            </div>

            {/* Pipeline Step Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between text-slate-500 text-[11px] font-mono mb-2">
                  <span>STAGE 01</span>
                  <Terminal className="h-3.5 w-3.5 text-slate-700" />
                </div>
                <h4 className="font-bold text-slate-900 text-xs mb-1">Local Bridge Daemon</h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Hooks into the Claude Code tool loop. Streams captured intent, prompt summaries, and the files touched to the platform.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between text-slate-500 text-[11px] font-mono mb-2">
                  <span>STAGE 02</span>
                  <Database className="h-3.5 w-3.5 text-slate-700" />
                </div>
                <h4 className="font-bold text-slate-900 text-xs mb-1">Intent &amp; SHA Cache</h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Indexes branch sha, touches Supabase intent logs, and validates freshness against existing baselines.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between text-slate-500 text-[11px] font-mono mb-2">
                  <span>STAGE 03</span>
                  <Cpu className="h-3.5 w-3.5 text-slate-700" />
                </div>
                <h4 className="font-bold text-slate-900 text-xs mb-1">Ephemeral Sandbox</h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Boots a disposable container for the app under test, injects test credentials, and drives it with a headless browser that records video and trace.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between text-slate-500 text-[11px] font-mono mb-2">
                  <span>STAGE 04</span>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <h4 className="font-bold text-slate-900 text-xs mb-1">PR Forensics &amp; Fix</h4>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Posts native GitHub Check Run, embeds forensic video link, and generates instant fix prompt for your AI.
                </p>
              </div>
            </div>
          </div>

          {/* 3 Core Security & Reliability Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card-light rounded-xl p-6">
              <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 mb-3">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">Disposable Runtime</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The pull request is cloned inside a &quot;--rm&quot; container and provisioned there; the container is destroyed when the run ends. Forensic artifacts (video, trace, screenshots, redacted DOM) are stored in a private bucket behind short-lived signed URLs and removed on a configurable retention window.
              </p>
            </div>

            <div className="card-light rounded-xl p-6">
              <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 mb-3">
                <Lock className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">AES-256-GCM Credential Vault</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Test-user credentials are encrypted at rest with AES-256-GCM. The key is supplied out-of-band via <code className="font-mono">CREDENTIAL_STORE_KEY</code>; credentials are injected into the sandbox as environment variables at boot and are never written to the repo, the intent log, or an LLM prompt.
              </p>
            </div>

            <div className="card-light rounded-xl p-6">
              <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 mb-3">
                <Layers className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-slate-900 text-sm mb-1.5">Resource-Limited Sandboxes</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Each run gets a container capped on memory, CPU and PIDs, with dropped capabilities and no privilege escalation. The headless browser runs from the engine against that container, and session state is reused across journeys within a single run for deterministic replay.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section (Clean Light Background) */}
      <section className="py-20 bg-white border-b border-slate-200 text-center">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3 text-slate-950">
            Catch regressions before your users do.
          </h2>
          <p className="text-slate-600 text-sm max-w-lg mx-auto mb-8">
            Connect the bridge daemon to your repo in 60 seconds. Start getting forensic proof and one-click fixes for every commit.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/api/github/install"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-6 py-3 text-xs font-bold text-white shadow-sm hover:bg-slate-800 active:scale-95 transition-all"
            >
              Get Started with GitHub App
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/dashboard"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all shadow-sm"
            >
              Open Live Console
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-8 bg-slate-50 text-xs text-slate-500">
        <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <span className="font-bold text-slate-950">AutoQA</span>
            <span>—</span>
            <span>Autonomous PR verification for AI coding agents</span>
          </div>

          <div className="flex items-center gap-5 font-medium flex-wrap">
            <Link href="/terms" className="hover:text-slate-900 transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-slate-900 transition-colors">Privacy</Link>
            <Link href="/security" className="hover:text-slate-900 transition-colors">Security</Link>
            <span className="text-slate-300">•</span>
            <Link href="/tools" className="text-indigo-600 hover:text-indigo-900 transition-colors font-semibold">Dev Tools Hub</Link>
            <Link href="/dashboard" className="hover:text-slate-900 transition-colors">Console</Link>
            <Link href="/design-system" className="hover:text-slate-900 transition-colors">Design System</Link>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-slate-900 transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
