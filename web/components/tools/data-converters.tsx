"use client";

import React, { useState, useEffect } from "react";
import { ToolShell } from "./tool-shell";
import { getToolById } from "@/lib/tools/tool-registry";
import {
  AlertTriangle,
  ArrowRight,
  Binary,
  Code,
  Copy,
  FileCode2,
  FolderTree,
  Repeat,
} from "lucide-react";

// ==========================================
// 1. JSON TO TYPESCRIPT / GO / RUST
// ==========================================
const SAMPLE_JSON = JSON.stringify(
  {
    id: "run_881920",
    branch: "feat/instant-checkout",
    commit: {
      sha: "9f8e7d6",
      message: "Add Apple Pay payment token handler",
      author: "alex@example.com",
    },
    passed: true,
    executionTimeMs: 1420.5,
    tags: ["e2e", "checkout", "regression"],
    metadata: {
      browser: "chromium",
      viewport: {
        width: 1280,
        height: 800,
      },
    },
  },
  null,
  2
);

function generateTypescript(obj: any, rootName = "Root"): string {
  const interfaces: string[] = [];

  function toPascalCase(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function getType(val: any, key: string): string {
    if (val === null) return "any";
    if (Array.isArray(val)) {
      if (val.length === 0) return "any[]";
      const elemType = getType(val[0], key.endsWith("s") ? key.slice(0, -1) : key + "Item");
      return `${elemType}[]`;
    }
    if (typeof val === "object") {
      const nestedName = toPascalCase(key);
      traverse(val, nestedName);
      return nestedName;
    }
    return typeof val;
  }

  function traverse(current: any, name: string) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(current)) {
      const type = getType(v, k);
      lines.push(`  ${k}: ${type};`);
    }
    interfaces.unshift(`export interface ${name} {\n${lines.join("\n")}\n}`);
  }

  traverse(obj, rootName);
  return interfaces.join("\n\n");
}

function generateGoStruct(obj: any, rootName = "Root"): string {
  const structs: string[] = [];

  function toPascalCase(str: string) {
    return str.replace(/(^|[_.-])(\w)/g, (_, __, letter) => letter.toUpperCase());
  }

  function getGoType(val: any, key: string): string {
    if (val === null) return "interface{}";
    if (Array.isArray(val)) {
      if (val.length === 0) return "[]interface{}";
      return `[]${getGoType(val[0], key)}`;
    }
    if (typeof val === "object") {
      const nestedName = toPascalCase(key);
      traverseGo(val, nestedName);
      return nestedName;
    }
    if (typeof val === "number") {
      return Number.isInteger(val) ? "int64" : "float64";
    }
    if (typeof val === "boolean") return "bool";
    return "string";
  }

  function traverseGo(current: any, name: string) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(current)) {
      const fieldName = toPascalCase(k);
      const fieldType = getGoType(v, k);
      lines.push(`\t${fieldName} ${fieldType} \`json:"${k}"\``);
    }
    structs.unshift(`type ${name} struct {\n${lines.join("\n")}\n}`);
  }

  traverseGo(obj, rootName);
  return structs.join("\n\n");
}

function generateRustStruct(obj: any, rootName = "Root"): string {
  const structs: string[] = [];

  function toPascalCase(str: string) {
    return str.replace(/(^|[_.-])(\w)/g, (_, __, letter) => letter.toUpperCase());
  }

  function getRustType(val: any, key: string): string {
    if (val === null) return "Option<serde_json::Value>";
    if (Array.isArray(val)) {
      if (val.length === 0) return "Vec<serde_json::Value>";
      return `Vec<${getRustType(val[0], key)}>`;
    }
    if (typeof val === "object") {
      const nestedName = toPascalCase(key);
      traverseRust(val, nestedName);
      return nestedName;
    }
    if (typeof val === "number") {
      return Number.isInteger(val) ? "i64" : "f64";
    }
    if (typeof val === "boolean") return "bool";
    return "String";
  }

  function traverseRust(current: any, name: string) {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(current)) {
      const fieldName = k.replace(/([A-Z])/g, "_$1").toLowerCase();
      const fieldType = getRustType(v, k);
      lines.push(`    #[serde(rename = "${k}")]\n    pub ${fieldName}: ${fieldType},`);
    }
    structs.unshift(`#[derive(Debug, Serialize, Deserialize)]\npub struct ${name} {\n${lines.join("\n")}\n}`);
  }

  traverseRust(obj, rootName);
  return structs.join("\n\n");
}

export function JsonToTypesConverter() {
  const tool = getToolById("json-to-types")!;
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [targetLang, setTargetLang] = useState<"ts" | "go" | "rust">("ts");
  const [rootName, setRootName] = useState("JourneyRunPayload");
  const [generatedCode, setGeneratedCode] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setParseError(null);
      const parsed = JSON.parse(jsonInput);
      if (targetLang === "ts") {
        setGeneratedCode(generateTypescript(parsed, rootName));
      } else if (targetLang === "go") {
        setGeneratedCode(generateGoStruct(parsed, rootName));
      } else {
        setGeneratedCode(generateRustStruct(parsed, rootName));
      }
    } catch (err: any) {
      setParseError(err.message);
    }
  }, [jsonInput, targetLang, rootName]);

  return (
    <ToolShell
      tool={tool}
      outputCode={generatedCode}
      outputFilename={`types.${targetLang === "ts" ? "ts" : targetLang === "go" ? "go" : "rs"}`}
      onReset={() => {
        setJsonInput(SAMPLE_JSON);
        setRootName("JourneyRunPayload");
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Target Language
              </span>
              <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5 bg-slate-50">
                {(["ts", "go", "rust"] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setTargetLang(l)}
                    className={`uppercase text-xs font-bold px-2.5 py-1 rounded transition-colors ${
                      targetLang === l
                        ? "bg-slate-900 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Root Interface / Struct Name
              </label>
              <input
                type="text"
                value={rootName}
                onChange={(e) => setRootName(e.target.value)}
                className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                JSON Payload Input
              </label>
              <textarea
                rows={14}
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
              />
              {parseError && (
                <div className="flex items-center gap-1.5 text-xs text-rose-600 font-medium mt-1">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Invalid JSON: {parseError}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100 h-full flex flex-col">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
              <span className="uppercase text-emerald-400 font-bold">
                {targetLang === "ts" ? "TypeScript Interface" : targetLang === "go" ? "Go Struct" : "Rust Struct"}
              </span>
              <span>Self-contained</span>
            </div>
            <pre className="font-mono text-xs text-emerald-300 overflow-x-auto leading-relaxed flex-1 max-h-[520px]">
              {generatedCode}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 2. ENCODING & DECODING SUITE
// ==========================================
export function EncodingDecoding() {
  const tool = getToolById("encoding-decoding")!;
  const [inputText, setInputText] = useState("Hello RazeQA World! 🚀 Let's verify routes.");
  const [mode, setMode] = useState<"base64" | "url" | "html">("base64");
  const [action, setAction] = useState<"encode" | "decode">("encode");
  const [result, setResult] = useState("");

  useEffect(() => {
    try {
      if (mode === "base64") {
        if (action === "encode") {
          setResult(btoa(unescape(encodeURIComponent(inputText))));
        } else {
          setResult(decodeURIComponent(escape(atob(inputText))));
        }
      } else if (mode === "url") {
        if (action === "encode") {
          setResult(encodeURIComponent(inputText));
        } else {
          setResult(decodeURIComponent(inputText));
        }
      } else if (mode === "html") {
        if (action === "encode") {
          setResult(
            inputText.replace(/[&<>"']/g, (m) => ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            }[m] || m))
          );
        } else {
          const doc = new DOMParser().parseFromString(inputText, "text/html");
          setResult(doc.documentElement.textContent || "");
        }
      }
    } catch (e: any) {
      setResult(`Conversion error: ${e.message}`);
    }
  }, [inputText, mode, action]);

  return (
    <ToolShell tool={tool} outputCode={result} outputFilename="encoded.txt">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5 bg-slate-50">
              {(["base64", "url", "html"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`capitalize text-xs font-semibold px-2.5 py-1 rounded transition-colors ${
                    mode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {m === "base64" ? "Base64" : m === "url" ? "URL" : "HTML Entities"}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-md border border-slate-200 p-0.5 bg-slate-50">
              <button
                onClick={() => setAction("encode")}
                className={`text-xs font-semibold px-2 py-1 rounded ${
                  action === "encode" ? "bg-indigo-600 text-white" : "text-slate-600"
                }`}
              >
                Encode
              </button>
              <button
                onClick={() => setAction("decode")}
                className={`text-xs font-semibold px-2 py-1 rounded ${
                  action === "decode" ? "bg-indigo-600 text-white" : "text-slate-600"
                }`}
              >
                Decode
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Source String
            </label>
            <textarea
              rows={8}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
            />
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100 h-full flex flex-col">
            <div className="text-xs font-mono text-slate-400 mb-2 border-b border-slate-800 pb-2">
              Result Output ({action.toUpperCase()}D)
            </div>
            <pre className="font-mono text-xs text-sky-300 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all flex-1">
              {result}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 3. FORMAT TRANSPILER (JSON / YAML / CSV / XML)
// ==========================================
function jsonToYaml(obj: any, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (obj === null) return "null";
  if (typeof obj !== "object") return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj
      .map((item) => `${pad}- ${typeof item === "object" ? "\n" + jsonToYaml(item, indent + 1) : jsonToYaml(item)}`)
      .join("\n");
  }

  return Object.entries(obj)
    .map(([k, v]) => {
      if (typeof v === "object" && v !== null) {
        return `${pad}${k}:\n${jsonToYaml(v, indent + 1)}`;
      }
      return `${pad}${k}: ${typeof v === "string" ? `"${v}"` : v}`;
    })
    .join("\n");
}

function jsonToCsv(arr: any[]): string {
  if (!Array.isArray(arr) || arr.length === 0) return "No array data found to convert to CSV.";
  const headers = Object.keys(arr[0] || {});
  const rows = arr.map((row) =>
    headers.map((h) => {
      const val = row[h] ?? "";
      return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
    }).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

function jsonToXml(obj: any, root = "root"): string {
  function toXml(val: any, tag: string): string {
    if (Array.isArray(val)) {
      return val.map((item) => toXml(item, tag)).join("\n");
    }
    if (typeof val === "object" && val !== null) {
      const inner = Object.entries(val)
        .map(([k, v]) => toXml(v, k))
        .join("\n");
      return `<${tag}>\n${inner}\n</${tag}>`;
    }
    return `<${tag}>${val}</${tag}>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${toXml(obj, root)}`;
}

export function FormatTranspiler() {
  const tool = getToolById("format-transpiler")!;
  const [sourceFormat, setSourceFormat] = useState<"json" | "csv">("json");
  const [targetFormat, setTargetFormat] = useState<"yaml" | "csv" | "xml" | "json">("yaml");
  const [inputData, setInputData] = useState(
    JSON.stringify(
      [
        { id: 1, name: "Checkout E2E Journey", status: "passed", durationMs: 1420 },
        { id: 2, name: "Auth Session Preflight", status: "passed", durationMs: 84 },
        { id: 3, name: "Apple Pay Token Issuance", status: "failed", durationMs: 320 },
      ],
      null,
      2
    )
  );
  const [outputData, setOutputData] = useState("");
  const [transpileError, setTranspileError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setTranspileError(null);
      if (sourceFormat === "json") {
        const parsed = JSON.parse(inputData);
        if (targetFormat === "yaml") {
          setOutputData(jsonToYaml(parsed));
        } else if (targetFormat === "csv") {
          setOutputData(jsonToCsv(Array.isArray(parsed) ? parsed : [parsed]));
        } else if (targetFormat === "xml") {
          setOutputData(jsonToXml(parsed, "response"));
        } else {
          setOutputData(JSON.stringify(parsed, null, 2));
        }
      } else {
        // CSV to JSON
        const lines = inputData.trim().split("\n");
        if (lines.length > 1) {
          const headers = lines[0].split(",").map((h) => h.trim());
          const rows = lines.slice(1).map((l) => {
            const vals = l.split(",").map((v) => v.trim());
            const obj: any = {};
            headers.forEach((h, i) => {
              obj[h] = vals[i] ?? "";
            });
            return obj;
          });
          setOutputData(JSON.stringify(rows, null, 2));
        }
      }
    } catch (e: any) {
      setTranspileError(e.message);
    }
  }, [inputData, sourceFormat, targetFormat]);

  return (
    <ToolShell tool={tool} outputCode={outputData} outputFilename={`export.${targetFormat}`}>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Source Format: {sourceFormat.toUpperCase()}
            </span>
            <div className="flex items-center gap-1 rounded border border-slate-200 p-0.5 bg-slate-50">
              <button
                onClick={() => setSourceFormat("json")}
                className={`text-xs font-semibold px-2 py-0.5 rounded ${sourceFormat === "json" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                JSON
              </button>
              <button
                onClick={() => setSourceFormat("csv")}
                className={`text-xs font-semibold px-2 py-0.5 rounded ${sourceFormat === "csv" ? "bg-slate-900 text-white" : "text-slate-600"}`}
              >
                CSV
              </button>
            </div>
          </div>

          <textarea
            rows={14}
            value={inputData}
            onChange={(e) => setInputData(e.target.value)}
            className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
          />
          {transpileError && (
            <div className="text-xs text-rose-600 font-medium">{transpileError}</div>
          )}
        </div>

        <div className="lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Target Output Format
            </span>
            <div className="flex items-center gap-1 rounded border border-slate-200 p-0.5 bg-slate-50">
              {(["yaml", "csv", "xml", "json"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setTargetFormat(fmt)}
                  className={`uppercase text-xs font-semibold px-2 py-0.5 rounded ${targetFormat === fmt ? "bg-slate-900 text-white" : "text-slate-600"}`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100 flex flex-col">
            <pre className="font-mono text-xs text-lime-400 overflow-x-auto leading-relaxed flex-1 max-h-[480px]">
              {outputData}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 4. JSON CRACK / VISUAL TREE GRAPH
// ==========================================
export function JSONVisualizer() {
  const tool = getToolById("json-inspector")!;
  const [jsonText, setJsonText] = useState(
    JSON.stringify(
      {
        endpoint: "/api/checkout",
        status: 200,
        data: {
          cartId: "cart_99182",
          currency: "USD",
          items: [
            { id: "p1", name: "Headphones", price: 199.99, inStock: true },
            { id: "p2", name: "Adapter USB-C", price: 29.0, inStock: true },
          ],
          customer: {
            id: "usr_44",
            email: "alex@example.com",
            verified: true,
          },
        },
      },
      null,
      2
    )
  );

  const [parsedObj, setParsedObj] = useState<any>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  useEffect(() => {
    try {
      setParsedObj(JSON.parse(jsonText));
    } catch {
      setParsedObj(null);
    }
  }, [jsonText]);

  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const renderNode = (key: string, val: any, currentPath: string): React.ReactNode => {
    const isArray = Array.isArray(val);
    const isObj = typeof val === "object" && val !== null;
    const typeLabel = isArray ? `Array(${val.length})` : typeof val;

    if (isObj) {
      return (
        <div key={currentPath} className="ml-3 pl-2.5 border-l border-slate-200 py-1 space-y-1">
          <div className="flex items-center gap-2 group">
            <span className="font-mono text-xs font-bold text-slate-800">{key}:</span>
            <span className="font-mono text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-1 rounded">
              {typeLabel}
            </span>
            <button
              onClick={() => copyPath(currentPath)}
              title="Copy property path"
              className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-slate-400 hover:text-slate-900 transition-opacity"
            >
              {copiedPath === currentPath ? "Copied!" : "Copy path"}
            </button>
          </div>
          <div className="space-y-1">
            {Object.entries(val).map(([subK, subV]) =>
              renderNode(subK, subV, isArray ? `${currentPath}[${subK}]` : `${currentPath}.${subK}`)
            )}
          </div>
        </div>
      );
    }

    // Scalar leaf
    return (
      <div key={currentPath} className="ml-3 pl-2.5 border-l border-slate-100 py-0.5 flex items-center gap-2 group">
        <span className="font-mono text-xs font-medium text-slate-700">{key}:</span>
        <span
          className={`font-mono text-xs font-semibold ${
            typeof val === "string"
              ? "text-emerald-600"
              : typeof val === "number"
              ? "text-blue-600"
              : typeof val === "boolean"
              ? "text-amber-600"
              : "text-slate-500"
          }`}
        >
          {JSON.stringify(val)}
        </span>
        <button
          onClick={() => copyPath(currentPath)}
          className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-slate-400 hover:text-slate-900 transition-opacity"
        >
          {copiedPath === currentPath ? "Copied!" : "path"}
        </button>
      </div>
    );
  };

  return (
    <ToolShell tool={tool} outputCode={jsonText} outputFilename="payload.json">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Raw JSON Payload
            </span>
          </div>
          <textarea
            rows={16}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
          />
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 space-y-3 flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Interactive Hierarchy Graph
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              Hover node to copy path
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[500px] p-2 bg-slate-50/50 rounded-lg border border-slate-100">
            {parsedObj ? (
              Object.entries(parsedObj).map(([k, v]) => renderNode(k, v, k))
            ) : (
              <p className="text-xs text-rose-500 font-mono italic">Invalid JSON structure</p>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
