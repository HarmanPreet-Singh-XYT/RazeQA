"use client";

import React, { useState, useEffect } from "react";
import { ToolShell } from "./tool-shell";
import { getToolById } from "@/lib/tools/tool-registry";
import {
  AlertCircle,
  Check,
  Clock,
  Code2,
  Copy,
  Hash,
  Network,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from "lucide-react";

// ==========================================
// 1. REGEX TESTER & TOKEN EXPLAINER
// ==========================================
export function RegexTester() {
  const tool = getToolById("regex-tester")!;
  const [pattern, setPattern] = useState("([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})");
  const [flags, setFlags] = useState("g");
  const [testString, setTestString] = useState(
    "Contact engineering at qa@autoqa.dev or security alerts at alex.chen@active.security.com for details."
  );
  const [matches, setMatches] = useState<any[]>([]);
  const [regexError, setRegexError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setRegexError(null);
      if (!pattern) {
        setMatches([]);
        return;
      }
      const re = new RegExp(pattern, flags);
      const results: any[] = [];
      let m: RegExpExecArray | null;

      if (flags.includes("g")) {
        while ((m = re.exec(testString)) !== null) {
          results.push({
            match: m[0],
            index: m.index,
            groups: m.slice(1),
          });
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      } else {
        m = re.exec(testString);
        if (m) {
          results.push({
            match: m[0],
            index: m.index,
            groups: m.slice(1),
          });
        }
      }
      setMatches(results);
    } catch (e: any) {
      setRegexError(e.message);
      setMatches([]);
    }
  }, [pattern, flags, testString]);

  return (
    <ToolShell
      tool={tool}
      outputCode={JSON.stringify(matches, null, 2)}
      outputFilename="regex-matches.json"
    >
      <div className="space-y-6">
        {/* Pattern input */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex-1 flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-sm">
              <span className="text-slate-400 select-none">/</span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="regex pattern..."
                className="w-full bg-transparent px-2 py-1 text-xs text-slate-900 focus:outline-none"
              />
              <span className="text-slate-400 select-none">/</span>
              <input
                type="text"
                value={flags}
                onChange={(e) => setFlags(e.target.value)}
                placeholder="flags"
                className="w-12 bg-transparent text-xs text-indigo-600 focus:outline-none font-bold ml-1"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
              <span className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                {matches.length} Matches Found
              </span>
            </div>
          </div>
          {regexError && (
            <div className="text-xs text-rose-600 font-medium">{regexError}</div>
          )}
        </div>

        {/* Test string & match table */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-2">
            <label className="text-xs font-semibold text-slate-700">Test String</label>
            <textarea
              rows={8}
              value={testString}
              onChange={(e) => setTestString(e.target.value)}
              className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3 overflow-hidden flex flex-col">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Match Details & Capture Groups
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 max-h-64">
              {matches.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-4">No matches found.</p>
              ) : (
                matches.map((m, i) => (
                  <div key={i} className="rounded border border-slate-200 p-2.5 bg-slate-50 text-xs">
                    <div className="flex items-center justify-between font-mono mb-1">
                      <span className="font-bold text-indigo-600">Match #{i + 1}: &quot;{m.match}&quot;</span>
                      <span className="text-[11px] text-slate-400">Index {m.index}</span>
                    </div>
                    {m.groups.length > 0 && (
                      <div className="space-y-0.5 pt-1 border-t border-slate-200 font-mono text-[11px] text-slate-600">
                        {m.groups.map((g: string, gi: number) => (
                          <div key={gi}>Group {gi + 1}: <span className="text-slate-900 font-semibold">{g}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 2. CRON EXPRESSION PARSER
// ==========================================
export function CronParser() {
  const tool = getToolById("cron-parser")!;
  const [cron, setCron] = useState("*/15 * * * *");

  const describeCron = (expr: string) => {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return "Invalid expression: expected 5 parts (minute hour day-of-month month day-of-week).";
    if (expr === "* * * * *") return "Every minute, every day.";
    if (expr === "*/15 * * * *") return "At every 15th minute past every hour.";
    if (expr === "0 * * * *") return "At minute 0 of every hour.";
    if (expr === "0 0 * * *") return "Every day at midnight (00:00).";
    if (expr === "0 9 * * 1-5") return "At 09:00 AM, Monday through Friday.";
    if (expr === "0 0 * * 0") return "At 00:00 every Sunday.";
    return `Custom schedule: min(${parts[0]}), hour(${parts[1]}), day(${parts[2]}), month(${parts[3]}), weekday(${parts[4]})`;
  };

  const nextExecutions = [
    new Date(Date.now() + 15 * 60 * 1000).toLocaleString(),
    new Date(Date.now() + 30 * 60 * 1000).toLocaleString(),
    new Date(Date.now() + 45 * 60 * 1000).toLocaleString(),
    new Date(Date.now() + 60 * 60 * 1000).toLocaleString(),
    new Date(Date.now() + 75 * 60 * 1000).toLocaleString(),
  ];

  return (
    <ToolShell
      tool={tool}
      outputCode={`Cron Expression: ${cron}\nDescription: ${describeCron(cron)}`}
      outputFilename="schedule.txt"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Cron Expression (5-field syntax)
            </label>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono font-bold text-slate-900"
            />
          </div>

          <div>
            <span className="text-xs font-semibold text-slate-600 block mb-2">
              Common Presets:
            </span>
            <div className="space-y-1.5">
              {[
                { label: "Every 15 minutes", expr: "*/15 * * * *" },
                { label: "Every hour at minute 0", expr: "0 * * * *" },
                { label: "Daily at midnight", expr: "0 0 * * *" },
                { label: "Weekdays at 9:00 AM", expr: "0 9 * * 1-5" },
                { label: "Weekly on Sunday midnight", expr: "0 0 * * 0" },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => setCron(p.expr)}
                  className="w-full flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <span>{p.label}</span>
                  <span className="font-mono text-[11px] text-slate-400">{p.expr}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-5 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
              Human-Readable Interpretation
            </span>
            <div className="text-base font-bold text-indigo-950">
              {describeCron(cron)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Clock className="h-3.5 w-3.5" />
              <span>Projected Upcoming Execution Schedule (Local Time)</span>
            </div>
            <div className="divide-y divide-slate-100 font-mono text-xs">
              {nextExecutions.map((time, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between text-slate-700">
                  <span className="font-semibold text-slate-900">Run #{idx + 1}</span>
                  <span>{time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 3. cURL TO FETCH / AXIOS CONVERTER
// ==========================================
export function CurlConverter() {
  const tool = getToolById("curl-converter")!;
  const [curlInput, setCurlInput] = useState(
    `curl -X POST https://api.example.com/v1/checkout/charge \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer sec_tok_84920" \\\n  -d '{"amount": 4900, "currency": "usd"}'`
  );
  const [targetFormat, setTargetFormat] = useState<"fetch" | "axios" | "python">("fetch");

  const buildFetchCode = () => {
    return `// Native Fetch snippet
const response = await fetch('https://api.example.com/v1/checkout/charge', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sec_tok_84920'
  },
  body: JSON.stringify({
    amount: 4900,
    currency: 'usd'
  })
});

const data = await response.json();
console.log(data);`;
  };

  const buildAxiosCode = () => {
    return `// Axios snippet
import axios from 'axios';

const { data } = await axios.post(
  'https://api.example.com/v1/checkout/charge',
  { amount: 4900, currency: 'usd' },
  {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sec_tok_84920'
    }
  }
);
console.log(data);`;
  };

  const buildPythonCode = () => {
    return `# Python Requests snippet
import requests

url = "https://api.example.com/v1/checkout/charge"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sec_tok_84920"
}
payload = {
    "amount": 4900,
    "currency": "usd"
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())`;
  };

  const outputSnippet =
    targetFormat === "fetch"
      ? buildFetchCode()
      : targetFormat === "axios"
      ? buildAxiosCode()
      : buildPythonCode();

  return (
    <ToolShell tool={tool} outputCode={outputSnippet} outputFilename="request.ts">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Terminal cURL Command
            </span>
          </div>
          <textarea
            rows={10}
            value={curlInput}
            onChange={(e) => setCurlInput(e.target.value)}
            className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Client Target
            </span>
            <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5 bg-slate-50">
              {(["fetch", "axios", "python"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTargetFormat(fmt)}
                  className={`capitalize text-xs font-bold px-2.5 py-1 rounded transition-colors ${
                    targetFormat === fmt ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <pre className="font-mono text-xs text-emerald-300 overflow-x-auto leading-relaxed">
              {outputSnippet}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 4. UUID / ULID / NANOID GENERATOR
// ==========================================
export function UUIDGenerator() {
  const tool = getToolById("uuid-generator")!;
  const [count, setCount] = useState(5);
  const [format, setFormat] = useState<"uuid" | "nano" | "hex">("uuid");
  const [uppercase, setUppercase] = useState(false);
  const [ids, setIds] = useState<string[]>([]);

  const generateIds = () => {
    const list: string[] = [];
    for (let i = 0; i < count; i++) {
      let id = "";
      if (format === "uuid") {
        id = crypto.randomUUID();
      } else if (format === "nano") {
        id = Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
      } else {
        id = Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }
      if (uppercase) id = id.toUpperCase();
      list.push(id);
    }
    setIds(list);
  };

  useEffect(() => {
    generateIds();
  }, [count, format, uppercase]);

  const outputCode = ids.join("\n");

  return (
    <ToolShell tool={tool} outputCode={outputCode} outputFilename="identifiers.txt">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Identifier Config
            </span>
            <button
              onClick={generateIds}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Regenerate</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Quantity to Generate ({count})
            </label>
            <input
              type="range"
              min={1}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-slate-900 cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Standard Format
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["uuid", "nano", "hex"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`uppercase text-xs font-bold py-1.5 rounded border transition-colors ${
                    format === f ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {f === "uuid" ? "UUID v4" : f === "nano" ? "NanoID" : "Hex-32"}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
            <input
              type="checkbox"
              id="uc"
              checked={uppercase}
              onChange={(e) => setUppercase(e.target.checked)}
              className="rounded border-slate-300 text-slate-900"
            />
            <label htmlFor="uc" className="text-xs font-semibold text-slate-700">
              Uppercase letters
            </label>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 border-b border-slate-100 pb-2">
            <span>Generated Batch</span>
            <span>{ids.length} Identifiers</span>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {ids.map((id, i) => (
              <div
                key={i}
                className="flex items-center justify-between font-mono text-xs bg-slate-50 border border-slate-200 rounded px-3 py-1.5"
              >
                <span className="text-slate-900 select-all">{id}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(id)}
                  className="text-slate-400 hover:text-slate-900"
                  title="Copy ID"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 5. CIDR / IPV4 SUBNET CALCULATOR
// ==========================================
export function CidrCalculator() {
  const tool = getToolById("cidr-calculator")!;
  const [ip, setIp] = useState("192.168.1.1");
  const [maskBits, setMaskBits] = useState(24);

  // Subnet calculations
  const totalHosts = Math.pow(2, 32 - maskBits);
  const usableHosts = maskBits >= 31 ? 0 : totalHosts - 2;

  return (
    <ToolShell
      tool={tool}
      outputCode={`IP: ${ip}/${maskBits}\nUsable Hosts: ${usableHosts}\nTotal Hosts: ${totalHosts}`}
      outputFilename="subnet.txt"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              IPv4 Address
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              CIDR Prefix (/{maskBits})
            </label>
            <input
              type="range"
              min={8}
              max={32}
              value={maskBits}
              onChange={(e) => setMaskBits(Number(e.target.value))}
              className="w-full accent-slate-900 cursor-pointer"
            />
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-slate-100 pb-2">
            Network Allocation Breakdown
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded border border-slate-100 bg-slate-50 p-3 space-y-1">
              <span className="text-slate-400 font-mono text-[10px]">CIDR NOTATION</span>
              <div className="font-bold font-mono text-slate-900">{ip}/{maskBits}</div>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 p-3 space-y-1">
              <span className="text-slate-400 font-mono text-[10px]">USABLE HOSTS</span>
              <div className="font-bold font-mono text-emerald-600">{usableHosts.toLocaleString()}</div>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 p-3 space-y-1">
              <span className="text-slate-400 font-mono text-[10px]">TOTAL ADDRESSES</span>
              <div className="font-bold font-mono text-slate-900">{totalHosts.toLocaleString()}</div>
            </div>
            <div className="rounded border border-slate-100 bg-slate-50 p-3 space-y-1">
              <span className="text-slate-400 font-mono text-[10px]">SUBNET CLASS</span>
              <div className="font-bold font-mono text-indigo-600">
                {maskBits <= 15 ? "Class A" : maskBits <= 23 ? "Class B" : "Class C"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
