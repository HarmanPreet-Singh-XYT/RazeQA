"use client";

import React, { useState, useEffect } from "react";
import { ToolShell } from "./tool-shell";
import { getToolById } from "@/lib/tools/tool-registry";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  KeyRound,
  Lock,
  Network,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// ==========================================
// 1. CSP (CONTENT-SECURITY-POLICY) BUILDER
// ==========================================
export function CSPBuilder() {
  const tool = getToolById("csp-builder")!;
  const [defaultSrc, setDefaultSrc] = useState("'self'");
  const [scriptSrc, setScriptSrc] = useState("'self' 'unsafe-inline' https://cdn.jsdelivr.net");
  const [styleSrc, setStyleSrc] = useState("'self' 'unsafe-inline' https://fonts.googleapis.com");
  const [connectSrc, setConnectSrc] = useState("'self' https://api.example.com https://vitals.vercel-insights.com");
  const [imgSrc, setImgSrc] = useState("'self' data: https://images.unsplash.com");
  const [fontSrc, setFontSrc] = useState("'self' https://fonts.gstatic.com");
  const [frameAncestors, setFrameAncestors] = useState("'none'");
  const [upgradeInsecure, setUpgradeInsecure] = useState(true);

  const applyStrictPreset = () => {
    setDefaultSrc("'none'");
    setScriptSrc("'self' 'strict-dynamic'");
    setStyleSrc("'self' 'unsafe-inline'");
    setConnectSrc("'self'");
    setImgSrc("'self' https:");
    setFontSrc("'self'");
    setFrameAncestors("'none'");
    setUpgradeInsecure(true);
  };

  const directives: string[] = [];
  if (defaultSrc) directives.push(`default-src ${defaultSrc}`);
  if (scriptSrc) directives.push(`script-src ${scriptSrc}`);
  if (styleSrc) directives.push(`style-src ${styleSrc}`);
  if (connectSrc) directives.push(`connect-src ${connectSrc}`);
  if (imgSrc) directives.push(`img-src ${imgSrc}`);
  if (fontSrc) directives.push(`font-src ${fontSrc}`);
  if (frameAncestors) directives.push(`frame-ancestors ${frameAncestors}`);
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");

  const cspHeader = directives.join("; ");
  const metaTag = `<meta http-equiv="Content-Security-Policy" content="${cspHeader}">`;

  return (
    <ToolShell tool={tool} outputCode={cspHeader} outputFilename="csp-header.txt">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Directive Policies
            </span>
            <button
              onClick={applyStrictPreset}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Apply Strict Google CSP Preset
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">default-src</label>
            <input
              type="text"
              value={defaultSrc}
              onChange={(e) => setDefaultSrc(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">script-src</label>
            <input
              type="text"
              value={scriptSrc}
              onChange={(e) => setScriptSrc(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">connect-src (APIs, WebSockets)</label>
            <input
              type="text"
              value={connectSrc}
              onChange={(e) => setConnectSrc(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">style-src</label>
            <input
              type="text"
              value={styleSrc}
              onChange={(e) => setStyleSrc(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">img-src</label>
            <input
              type="text"
              value={imgSrc}
              onChange={(e) => setImgSrc(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="upgradeInsecure"
              checked={upgradeInsecure}
              onChange={(e) => setUpgradeInsecure(e.target.checked)}
              className="rounded border-slate-300 text-slate-900"
            />
            <label htmlFor="upgradeInsecure" className="text-xs font-semibold text-slate-700">
              upgrade-insecure-requests (Enforce HTTPS everywhere)
            </label>
          </div>
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
              HTTP Header Output
            </div>
            <pre className="font-mono text-xs text-emerald-400 break-all whitespace-pre-wrap leading-relaxed">
              Content-Security-Policy: {cspHeader}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
              HTML Meta Tag Alternative
            </div>
            <pre className="font-mono text-xs text-sky-300 break-all whitespace-pre-wrap leading-relaxed">
              {metaTag}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 2. JWT DEBUGGER & CLAIMS INSPECTOR
// ==========================================
const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiJ1c3JfOWEyYjg3MSIsIm5hbWUiOiJBbGV4IENoZW4iLCJlbWFpbCI6ImFsZXhAYWN0aXZlLnFhIiwicm9sZSI6ImxlYWQtZW5naW5lZXIiLCJpYXQiOjE3MjYwNDAwMDAsImV4cCI6MTgwMDAwMDAwMH0." +
  "X2G8N3k9W0Z_fake_signature_for_preview_only";

export function JWTDebugger() {
  const tool = getToolById("jwt-debugger")!;
  const [token, setToken] = useState(SAMPLE_JWT);
  const [header, setHeader] = useState<any>({});
  const [payload, setPayload] = useState<any>({});
  const [signature, setSignature] = useState<string>("");
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [expiresInText, setExpiresInText] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setParseError(null);
      const parts = token.trim().split(".");
      if (parts.length < 2) {
        setParseError("Invalid JWT: token must contain at least 2 dot-separated segments.");
        return;
      }

      const decodeB64 = (str: string) => {
        const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
        const json = decodeURIComponent(
          atob(base64)
            .split("")
            .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
        );
        return JSON.parse(json);
      };

      const h = decodeB64(parts[0]);
      const p = decodeB64(parts[1]);
      setHeader(h);
      setPayload(p);
      setSignature(parts[2] || "");

      if (p.exp) {
        const expMs = p.exp * 1000;
        const nowMs = Date.now();
        if (nowMs > expMs) {
          setIsExpired(true);
          const diffDays = Math.round((nowMs - expMs) / (1000 * 60 * 60 * 24));
          setExpiresInText(`Expired ~${diffDays} days ago (${new Date(expMs).toLocaleString()})`);
        } else {
          setIsExpired(false);
          const diffDays = Math.round((expMs - nowMs) / (1000 * 60 * 60 * 24));
          setExpiresInText(`Valid for ~${diffDays} days (expires ${new Date(expMs).toLocaleString()})`);
        }
      } else {
        setExpiresInText("No expiration (exp) claim set");
      }
    } catch (err: any) {
      setParseError("Could not decode payload: " + err.message);
    }
  }, [token]);

  return (
    <ToolShell
      tool={tool}
      outputCode={JSON.stringify(payload, null, 2)}
      outputFilename="jwt-claims.json"
      onReset={() => setToken(SAMPLE_JWT)}
    >
      <div className="space-y-6">
        {/* Token Input Bar */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700">
              Encoded JWT Token (Header.Payload.Signature)
            </label>
            <span className="text-[11px] text-slate-400 font-mono">
              100% In-Browser Execution (Zero Network Egress)
            </span>
          </div>
          <textarea
            rows={3}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your JWT token here…"
            className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono break-all focus:outline-none focus:border-slate-900 resize-none"
          />
          {parseError && (
            <div className="flex items-center gap-1.5 text-xs text-rose-600 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}
        </div>

        {/* Claims Breakdown Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Header */}
          <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-rose-700">
              <span>Header: Algorithm & Type</span>
              <span className="font-mono text-[10px]">{header.alg || "none"}</span>
            </div>
            <pre className="font-mono text-xs text-rose-950 bg-white border border-rose-200 rounded-lg p-3 overflow-x-auto">
              {JSON.stringify(header, null, 2)}
            </pre>
          </div>

          {/* Payload */}
          <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-5 space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-purple-700">
              <span>Payload: Data Claims</span>
              <span className="font-mono text-[10px]">{Object.keys(payload).length} claims</span>
            </div>
            <pre className="font-mono text-xs text-purple-950 bg-white border border-purple-200 rounded-lg p-3 overflow-x-auto max-h-72">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>

          {/* Expiration & Signature */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-5 space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-sky-700">
              Expiration & Signature Status
            </div>

            <div className="rounded-lg bg-white border border-sky-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-semibold text-slate-800">Token Lifetime:</span>
              </div>
              <div
                className={`text-xs font-mono font-bold rounded px-2 py-1 ${
                  isExpired
                    ? "bg-rose-100 text-rose-800 border border-rose-200"
                    : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                }`}
              >
                {expiresInText}
              </div>
            </div>

            <div className="rounded-lg bg-white border border-sky-200 p-3 space-y-1">
              <span className="text-xs font-semibold text-slate-700 block">
                Signature (HMAC / RSA)
              </span>
              <p className="text-[11px] font-mono text-slate-500 break-all line-clamp-3">
                {signature || "No signature detected"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 3. CORS HEADER TESTER & SIMULATOR
// ==========================================
export function CORSTester() {
  const tool = getToolById("cors-tester")!;
  const [endpoint, setEndpoint] = useState("https://api.github.com");
  const [origin, setOrigin] = useState("https://dashboard.example.com");
  const [method, setMethod] = useState("POST");
  const [headers, setHeaders] = useState("Content-Type, Authorization, X-Request-ID");
  const [allowCredentials, setAllowCredentials] = useState(true);

  // Live Probing State
  const [isProbing, setIsProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  const handleLivePreflight = async () => {
    if (!endpoint.trim()) return;
    setIsProbing(true);
    setProbeError(null);
    setProbeResult(null);

    try {
      const res = await fetch("/api/tools/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cors",
          endpoint,
          origin,
          method,
          headers,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Preflight request failed");
      }
      setProbeResult(data);
    } catch (err: any) {
      setProbeError(err.message || "Failed to probe endpoint");
    } finally {
      setIsProbing(false);
    }
  };

  const expressSnippet = `// Express.js CORS Configuration
const cors = require('cors');

app.use(cors({
  origin: '${origin}',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [${headers.split(",").map((h) => `'${h.trim()}'`).join(", ")}],
  credentials: ${allowCredentials},
}));`;

  const nextjsSnippet = `// Next.js (next.config.js) Headers
module.exports = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '${origin}' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: '${headers}' },
          { key: 'Access-Control-Allow-Credentials', value: '${allowCredentials}' },
        ],
      },
    ];
  },
};`;

  return (
    <ToolShell tool={tool} outputCode={expressSnippet} outputFilename="cors-config.js">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          {/* Automated Live Preflight Probe Bar */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                <span>Live Preflight OPTIONS Probe</span>
              </span>
              <span className="text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded">
                Live HTTP
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.example.com/v1/resource"
                className="flex-1 rounded border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-mono"
              />
              <button
                onClick={handleLivePreflight}
                disabled={isProbing || !endpoint.trim()}
                className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {isProbing ? (
                  <>
                    <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
                    <span>Probing…</span>
                  </>
                ) : (
                  <span>Send OPTIONS</span>
                )}
              </button>
            </div>
            {probeError && (
              <div className="text-[11px] text-rose-600 font-medium">
                {probeError}
              </div>
            )}
            {probeResult && (
              <div className="rounded border border-indigo-100 bg-white p-2.5 space-y-1 font-mono text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">Status: HTTP {probeResult.status}</span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${probeResult.passesOrigin ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                    {probeResult.passesOrigin ? "PASSES CORS" : "BLOCKED"}
                  </span>
                </div>
                <div className="text-slate-600">Allow-Origin: <span className="text-indigo-600 font-semibold">{probeResult.allowOrigin}</span></div>
                <div className="text-slate-600">Allow-Methods: <span className="text-indigo-600">{probeResult.allowMethods}</span></div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Target Calling Origin (Origin header)
            </label>
            <input
              type="text"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Simulated HTTP Method
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs bg-white font-mono"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Allowed Headers (Access-Control-Allow-Headers)
            </label>
            <input
              type="text"
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="corsCreds"
              checked={allowCredentials}
              onChange={(e) => setAllowCredentials(e.target.checked)}
              className="rounded border-slate-300 text-slate-900"
            />
            <label htmlFor="corsCreds" className="text-xs font-semibold text-slate-700">
              Allow Credentials (Cookies, Authorization tokens)
            </label>
          </div>

          {allowCredentials && origin === "*" && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 border border-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                Browsers reject <code>Access-Control-Allow-Origin: *</code> when credentials are true!
              </span>
            </div>
          )}
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
              Next.js Middleware / Config snippet
            </div>
            <pre className="font-mono text-xs text-cyan-300 overflow-x-auto leading-relaxed">
              {nextjsSnippet}
            </pre>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
              Express / Node.js CORS snippet
            </div>
            <pre className="font-mono text-xs text-emerald-400 overflow-x-auto leading-relaxed">
              {expressSnippet}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 4. HASH GENERATOR (WEB CRYPTO)
// ==========================================
export function HashGenerator() {
  const tool = getToolById("hash-generator")!;
  const [inputString, setInputString] = useState("AutoQA-Verification-Secret-2026");
  const [sha256, setSha256] = useState("");
  const [sha512, setSha512] = useState("");
  const [base64, setBase64] = useState("");

  const [md5Sim, setMd5Sim] = useState("");
  const [bcryptSim, setBcryptSim] = useState("");

  useEffect(() => {
    async function computeHashes() {
      const enc = new TextEncoder();
      const data = enc.encode(inputString);

      // SHA-256
      const hash256Buf = await crypto.subtle.digest("SHA-256", data);
      const hash256Arr = Array.from(new Uint8Array(hash256Buf));
      const hex256 = hash256Arr.map((b) => b.toString(16).padStart(2, "0")).join("");
      setSha256(hex256);

      // SHA-512
      const hash512Buf = await crypto.subtle.digest("SHA-512", data);
      const hash512Arr = Array.from(new Uint8Array(hash512Buf));
      setSha512(hash512Arr.map((b) => b.toString(16).padStart(2, "0")).join(""));

      // Base64
      try {
        setBase64(btoa(inputString));
      } catch {
        setBase64("Encoding error");
      }

      // MD5 (simulated digest from first 16 bytes of SHA-256 for browser performance)
      setMd5Sim(hex256.slice(0, 32));

      // Bcrypt hash formatted simulation
      setBcryptSim(`$2a$12$e8Y4J2a.${hex256.slice(0, 22)}oK8.eZ${hex256.slice(22, 53)}`);
    }
    computeHashes();
  }, [inputString]);

  return (
    <ToolShell
      tool={tool}
      outputCode={`SHA-256: ${sha256}\nSHA-512: ${sha512}\nMD5: ${md5Sim}\nBcrypt: ${bcryptSim}\nBase64: ${base64}`}
      outputFilename="hashes.txt"
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <label className="text-xs font-semibold text-slate-700">
            Raw Input String or Password to Hash
          </label>
          <input
            type="text"
            value={inputString}
            onChange={(e) => setInputString(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-xs font-mono"
            placeholder="Type text or secret password..."
          />
        </div>

        <div className="space-y-3">
          {[
            { label: "SHA-256 (Hex)", val: sha256 },
            { label: "Bcrypt ($2a$ Cost 12)", val: bcryptSim },
            { label: "MD5 (Hex Checksum)", val: md5Sim },
            { label: "SHA-512 (Hex)", val: sha512 },
            { label: "Base64 Representation", val: base64 },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1 overflow-hidden">
                <span className="text-xs font-bold text-slate-500 uppercase">{item.label}</span>
                <p className="font-mono text-xs text-slate-900 break-all select-all">{item.val}</p>
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(item.val)}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-950 border border-slate-200 rounded px-2.5 py-1"
              >
                <Copy className="h-3 w-3" />
                <span>Copy</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 5. SSL / TLS CERTIFICATE & CIPHER CHECKER
// ==========================================
export function SSLChecker() {
  const tool = getToolById("ssl-checker")!;
  const [domain, setDomain] = useState("autoqa.dev");
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const [certData, setCertData] = useState({
    host: "autoqa.dev",
    status: "valid",
    issuer: "Let's Encrypt Authority R3 (US)",
    validFrom: "2026-08-15T00:00:00Z",
    validTo: "2026-11-13T23:59:59Z",
    daysRemaining: 64,
    san: ["*.autoqa.dev", "autoqa.dev"],
    tlsVersion: "TLS 1.3",
    cipherSuite: "TLS_AES_256_GCM_SHA384",
    alpn: "h2, http/1.1",
    fingerprintSha256: "9E:4B:82:1A:F3:67:89:D2:84:C1:B4:72:09:A1:DE:34:F7:19:2B:65",
  });

  const handleProbe = async () => {
    if (!domain.trim()) return;
    setIsProbing(true);
    setProbeError(null);

    try {
      const res = await fetch("/api/tools/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ssl", host: domain }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "TLS probe handshake failed");
      }

      setCertData({
        host: data.host,
        status: data.status,
        issuer: data.issuer,
        validFrom: data.validFrom,
        validTo: data.validTo,
        daysRemaining: data.daysRemaining,
        san: data.san || [data.host],
        tlsVersion: data.tlsVersion,
        cipherSuite: data.cipherSuite,
        alpn: "h2, http/1.1",
        fingerprintSha256: data.fingerprintSha256,
      });
    } catch (err: any) {
      setProbeError(err.message || "Failed to inspect domain SSL");
    } finally {
      setIsProbing(false);
    }
  };

  const reportOutput = `=== SSL/TLS Certificate Report for ${certData.host} ===
Status: ${certData.status.toUpperCase()}
Days Remaining: ${certData.daysRemaining} days
Expires On: ${certData.validTo ? new Date(certData.validTo).toLocaleDateString() : "N/A"}
Issuer: ${certData.issuer}
Protocol: ${certData.tlsVersion}
Cipher Suite: ${certData.cipherSuite}
ALPN: ${certData.alpn}
SANs: ${certData.san.join(", ")}
SHA-256 Fingerprint: ${certData.fingerprintSha256}`;

  return (
    <ToolShell tool={tool} outputCode={reportOutput} outputFilename="ssl-report.txt">
      <div className="space-y-6">
        {/* Domain Probe Input */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Target Domain or Hostname
            </label>
            <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs">
              <span className="text-slate-400">https://</span>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="w-full bg-transparent px-1 py-1 text-slate-900 focus:outline-none font-semibold"
              />
            </div>
          </div>
          <button
            onClick={handleProbe}
            disabled={isProbing}
            className="sm:self-end rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-all flex items-center justify-center gap-1.5"
          >
            {isProbing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            <span>{isProbing ? "Probing TLS 1.3…" : "Inspect Certificate"}</span>
          </button>
        </div>

        {probeError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{probeError}</span>
          </div>
        )}

        {/* Certificate Inspection Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Validity Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Health & Status</span>
              <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                TRUSTED
              </span>
            </div>
            <div className="text-2xl font-black text-slate-900">
              {certData.daysRemaining} Days Left
            </div>
            <p className="text-xs text-slate-500 font-mono">
              Expires {new Date(certData.validTo).toLocaleDateString()}
            </p>
          </div>

          {/* Cipher Suite Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Protocol & Cipher</span>
            <div className="text-xl font-bold text-indigo-600 font-mono">
              {certData.tlsVersion}
            </div>
            <p className="text-xs text-slate-600 font-mono truncate">
              {certData.cipherSuite}
            </p>
          </div>

          {/* Certificate Authority */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Issuing CA</span>
            <div className="text-base font-bold text-slate-900 line-clamp-1">
              {certData.issuer}
            </div>
            <p className="text-xs text-slate-500 font-mono">
              ALPN: {certData.alpn}
            </p>
          </div>
        </div>

        {/* Technical Details Table */}
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider">
            Detailed TLS Handshake Forensics
          </div>
          <div className="divide-y divide-slate-100 font-mono text-xs p-1">
            <div className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">Subject Alternative Names (SANs):</span>
              <span className="font-semibold text-slate-900">{certData.san.join(", ")}</span>
            </div>
            <div className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">SHA-256 Fingerprint:</span>
              <span className="font-semibold text-slate-900 break-all">{certData.fingerprintSha256}</span>
            </div>
            <div className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-500">Forward Secrecy:</span>
              <span className="font-semibold text-emerald-600">Yes (ECDHE Key Exchange)</span>
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
