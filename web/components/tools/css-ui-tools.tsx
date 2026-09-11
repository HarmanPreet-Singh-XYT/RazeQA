"use client";

import React, { useState } from "react";
import { ToolShell } from "./tool-shell";
import { getToolById } from "@/lib/tools/tool-registry";
import {
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Eye,
  Layers,
  Palette,
  Sliders,
  Sparkles,
  Type,
  XCircle,
} from "lucide-react";

// ==========================================
// 1. FLUID TYPOGRAPHY & CLAMP CALCULATOR
// ==========================================
export function ClampCalculator() {
  const tool = getToolById("clamp-calculator")!;
  const [minViewport, setMinViewport] = useState(375);
  const [maxViewport, setMaxViewport] = useState(1440);
  const [minFontSize, setMinFontSize] = useState(16);
  const [maxFontSize, setMaxFontSize] = useState(36);
  const [testViewport, setTestViewport] = useState(768);

  // Slope calculation
  const slope = (maxFontSize - minFontSize) / (maxViewport - minViewport);
  const yAxisIntersection = -minViewport * slope + minFontSize;
  const slopeVw = (slope * 100).toFixed(4);
  const yAxisRem = (yAxisIntersection / 16).toFixed(4);
  const minRem = (minFontSize / 16).toFixed(4);
  const maxRem = (maxFontSize / 16).toFixed(4);

  const clampCss = `clamp(${minRem}rem, ${yAxisRem}rem + ${slopeVw}vw, ${maxRem}rem)`;

  // Simulated current size at testViewport
  const currentPx = Math.min(
    maxFontSize,
    Math.max(minFontSize, minFontSize + slope * (testViewport - minViewport))
  ).toFixed(1);

  return (
    <ToolShell tool={tool} outputCode={`font-size: ${clampCss};`} outputFilename="typography.css">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Controls */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
            Viewport & Font Range
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Min Viewport (px)
              </label>
              <input
                type="number"
                value={minViewport}
                onChange={(e) => setMinViewport(Number(e.target.value))}
                className="w-full rounded border border-slate-200 p-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Viewport (px)
              </label>
              <input
                type="number"
                value={maxViewport}
                onChange={(e) => setMaxViewport(Number(e.target.value))}
                className="w-full rounded border border-slate-200 p-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Min Font Size (px)
              </label>
              <input
                type="number"
                value={minFontSize}
                onChange={(e) => setMinFontSize(Number(e.target.value))}
                className="w-full rounded border border-slate-200 p-1.5 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Font Size (px)
              </label>
              <input
                type="number"
                value={maxFontSize}
                onChange={(e) => setMaxFontSize(Number(e.target.value))}
                className="w-full rounded border border-slate-200 p-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Simulate Viewport Width:</span>
              <span className="font-mono text-indigo-600">{testViewport}px</span>
            </div>
            <input
              type="range"
              min={320}
              max={1920}
              value={testViewport}
              onChange={(e) => setTestViewport(Number(e.target.value))}
              className="w-full accent-indigo-600 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono">
              <span>320px (Mobile)</span>
              <span>768px (Tablet)</span>
              <span>1920px (4K)</span>
            </div>
          </div>
        </div>

        {/* Live Visual Demonstration */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <div className="text-xs font-mono text-slate-400 mb-2 border-b border-slate-800 pb-2 flex justify-between">
              <span>CSS Property Output</span>
              <span className="text-emerald-400">At {testViewport}px = {currentPx}px</span>
            </div>
            <pre className="font-mono text-xs text-amber-300 overflow-x-auto leading-relaxed">
              font-size: {clampCss};
            </pre>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 flex flex-col justify-center min-h-[220px]">
            <span className="text-[10px] font-mono uppercase text-slate-400 mb-2 block">
              Live Scaled Typography at simulated {testViewport}px
            </span>
            <h2
              style={{ fontSize: `${currentPx}px` }}
              className="font-bold text-slate-900 leading-tight tracking-tight transition-all duration-75"
            >
              The quick brown fox jumps over the lazy dog.
            </h2>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 2. COLOR CONTRAST & WCAG CHECKER
// ==========================================
function getLuminance(hex: string) {
  let clean = hex.replace("#", "");
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  const a = [r, g, b].map((v) => {
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

function calculateContrastRatio(fg: string, bg: string) {
  try {
    const l1 = getLuminance(fg);
    const l2 = getLuminance(bg);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  } catch {
    return 1;
  }
}

export function ContrastChecker() {
  const tool = getToolById("contrast-checker")!;
  const [fgColor, setFgColor] = useState("#0f172a");
  const [bgColor, setBgColor] = useState("#ffffff");

  const ratio = calculateContrastRatio(fgColor, bgColor);
  const ratioFormatted = ratio.toFixed(2);

  const passesAANormal = ratio >= 4.5;
  const passesAAANormal = ratio >= 7.0;
  const passesAALarge = ratio >= 3.0;
  const passesAAALarge = ratio >= 4.5;
  const passesUI = ratio >= 3.0;

  const handleSwap = () => {
    const temp = fgColor;
    setFgColor(bgColor);
    setBgColor(temp);
  };

  return (
    <ToolShell
      tool={tool}
      outputCode={`/* WCAG Contrast Ratio: ${ratioFormatted}:1 */\ncolor: ${fgColor};\nbackground-color: ${bgColor};`}
      outputFilename="colors.css"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Color Palette Inputs
            </span>
            <button
              onClick={handleSwap}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <ArrowLeftRight className="h-3 w-3" />
              <span>Swap</span>
            </button>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Foreground (Text) Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                className="h-8 w-12 rounded cursor-pointer border border-slate-200"
              />
              <input
                type="text"
                value={fgColor}
                onChange={(e) => setFgColor(e.target.value)}
                className="flex-1 rounded border border-slate-200 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Background Color
            </label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-8 w-12 rounded cursor-pointer border border-slate-200"
              />
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="flex-1 rounded border border-slate-200 px-3 py-1.5 text-xs font-mono"
              />
            </div>
          </div>

          {/* Quick Presets */}
          <div className="pt-2 border-t border-slate-100">
            <span className="text-xs font-semibold text-slate-600 block mb-2">Preset Combinations:</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "Slate / White", fg: "#0f172a", bg: "#ffffff" },
                { label: "Indigo / White", fg: "#4338ca", bg: "#ffffff" },
                { label: "Emerald / White", fg: "#047857", bg: "#ffffff" },
                { label: "Dark High-Contrast", fg: "#f8fafc", bg: "#020617" },
              ].map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setFgColor(p.fg);
                    setBgColor(p.bg);
                  }}
                  className="rounded border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Score & WCAG Badges */}
        <div className="lg:col-span-7 space-y-4">
          {/* Visual Canvas Demo */}
          <div
            style={{ backgroundColor: bgColor, color: fgColor }}
            className="rounded-xl border border-slate-200 p-6 min-h-[140px] flex flex-col justify-center space-y-2 transition-colors shadow-xs"
          >
            <h3 className="text-xl font-bold">Preview Heading 1 (Large Text)</h3>
            <p className="text-sm leading-relaxed">
              AutoQA autonomously tests modern web applications with synthetic journeys and visual
              regression forensics.
            </p>
          </div>

          {/* Contrast Score Ribbon */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-500 uppercase">Contrast Ratio</span>
              <div className="text-3xl font-black text-slate-900">{ratioFormatted}:1</div>
            </div>
            <div className="text-right">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ${
                  passesAANormal
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-rose-100 text-rose-800"
                }`}
              >
                {passesAANormal ? "WCAG AA Compliant" : "Fails Minimum AA"}
              </span>
            </div>
          </div>

          {/* Detailed Compliance Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Normal Text (AA)", pass: passesAANormal, req: "4.5:1" },
              { label: "Normal Text (AAA)", pass: passesAAANormal, req: "7.0:1" },
              { label: "Large Text (AA)", pass: passesAALarge, req: "3.0:1" },
              { label: "Large Text (AAA)", pass: passesAAALarge, req: "4.5:1" },
              { label: "UI Components", pass: passesUI, req: "3.0:1" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-slate-200 bg-white p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700">{item.label}</span>
                  {item.pass ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-rose-500" />
                  )}
                </div>
                <div className="text-[10px] text-slate-400 font-mono">Req: {item.req}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 3. CSS GENERATOR (SHADOWS, GLASS, GRADIENTS, CLIP-PATH)
// ==========================================
export function CSSGenerator() {
  const tool = getToolById("css-generator")!;
  const [activeTab, setActiveTab] = useState<"glass" | "gradient" | "clip">("glass");

  // Glass & Shadow state
  const [elevation, setElevation] = useState(3);
  const [glassBlur, setGlassBlur] = useState(16);
  const [glassOpacity, setGlassOpacity] = useState(0.65);

  // Gradient state
  const [gradAngle, setGradAngle] = useState(135);
  const [gradColor1, setGradColor1] = useState("#6366f1");
  const [gradColor2, setGradColor2] = useState("#a855f7");
  const [gradColor3, setGradColor3] = useState("#ec4899");

  // Clip-path state
  const [clipShape, setClipShape] = useState<"chevron" | "hexagon" | "triangle" | "circle">("hexagon");

  const shadowStyles = [
    "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
    "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
    "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
    "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
    "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
  ];

  const currentShadow = shadowStyles[elevation - 1];
  const glassCss = `background: rgba(255, 255, 255, ${glassOpacity});\nbackdrop-filter: blur(${glassBlur}px);\n-webkit-backdrop-filter: blur(${glassBlur}px);\nborder: 1px solid rgba(255, 255, 255, 0.3);\nbox-shadow: ${currentShadow};`;

  const gradientCss = `background: linear-gradient(${gradAngle}deg, ${gradColor1} 0%, ${gradColor2} 50%, ${gradColor3} 100%);`;

  const clipShapesMap = {
    hexagon: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
    chevron: "polygon(100% 0%, 75% 50%, 100% 100%, 25% 100%, 0% 50%, 25% 0%)",
    triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
    circle: "circle(50% at 50% 50%)",
  };
  const clipCss = `clip-path: ${clipShapesMap[clipShape]};\n-webkit-clip-path: ${clipShapesMap[clipShape]};`;

  const currentOutputCode =
    activeTab === "glass" ? glassCss : activeTab === "gradient" ? gradientCss : clipCss;

  return (
    <ToolShell tool={tool} outputCode={currentOutputCode} outputFilename="styles.css">
      <div className="space-y-6">
        {/* Generator Mode Tabs */}
        <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
          {[
            { id: "glass", label: "Glassmorphism & Shadows" },
            { id: "gradient", label: "Multi-stop Gradients" },
            { id: "clip", label: "Clip-Path Shapes" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? "bg-slate-900 text-white shadow-xs"
                  : "bg-white text-slate-700 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Controls Column */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            {activeTab === "glass" && (
              <>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Elevation & Glass Controls
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Shadow Elevation Level (1-5)
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={elevation}
                    onChange={(e) => setElevation(Number(e.target.value))}
                    className="w-full accent-slate-900 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Backdrop Blur ({glassBlur}px)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={glassBlur}
                    onChange={(e) => setGlassBlur(Number(e.target.value))}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Surface Opacity ({Math.round(glassOpacity * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.95}
                    step={0.05}
                    value={glassOpacity}
                    onChange={(e) => setGlassOpacity(Number(e.target.value))}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>
              </>
            )}

            {activeTab === "gradient" && (
              <>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Linear Gradient Parameters
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Angle ({gradAngle}deg)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={gradAngle}
                    onChange={(e) => setGradAngle(Number(e.target.value))}
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Stop 0%</label>
                    <input
                      type="color"
                      value={gradColor1}
                      onChange={(e) => setGradColor1(e.target.value)}
                      className="w-full h-8 rounded border border-slate-200 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Stop 50%</label>
                    <input
                      type="color"
                      value={gradColor2}
                      onChange={(e) => setGradColor2(e.target.value)}
                      className="w-full h-8 rounded border border-slate-200 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Stop 100%</label>
                    <input
                      type="color"
                      value={gradColor3}
                      onChange={(e) => setGradColor3(e.target.value)}
                      className="w-full h-8 rounded border border-slate-200 cursor-pointer"
                    />
                  </div>
                </div>
              </>
            )}

            {activeTab === "clip" && (
              <>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Select Preset Polygon
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["hexagon", "chevron", "triangle", "circle"] as const).map((shape) => (
                    <button
                      key={shape}
                      onClick={() => setClipShape(shape)}
                      className={`capitalize py-2 px-3 text-xs font-semibold rounded border transition-colors ${
                        clipShape === shape
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {shape}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Preview & Code Output Column */}
          <div className="lg:col-span-7 space-y-4">
            {/* Visual Canvas Demo */}
            <div className="rounded-xl border border-slate-200 p-8 min-h-[220px] flex items-center justify-center bg-gradient-to-tr from-indigo-500 via-purple-500 to-rose-400 overflow-hidden relative">
              {activeTab === "glass" && (
                <div
                  style={{
                    backgroundColor: `rgba(255, 255, 255, ${glassOpacity})`,
                    backdropFilter: `blur(${glassBlur}px)`,
                    WebkitBackdropFilter: `blur(${glassBlur}px)`,
                    boxShadow: currentShadow,
                  }}
                  className="rounded-2xl border border-white/40 p-6 max-w-sm text-slate-900 space-y-2 transition-all"
                >
                  <h4 className="font-bold text-base">Glassmorphism Card</h4>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    Adaptive blur surface reacting to underlying color contrast.
                  </p>
                </div>
              )}

              {activeTab === "gradient" && (
                <div
                  style={{
                    background: `linear-gradient(${gradAngle}deg, ${gradColor1} 0%, ${gradColor2} 50%, ${gradColor3} 100%)`,
                  }}
                  className="w-full h-36 rounded-xl shadow-lg flex items-center justify-center text-white font-bold text-sm tracking-wide"
                >
                  Live Multi-Stop Gradient
                </div>
              )}

              {activeTab === "clip" && (
                <div
                  style={{
                    clipPath: clipShapesMap[clipShape],
                    WebkitClipPath: clipShapesMap[clipShape],
                  }}
                  className="w-36 h-36 bg-slate-900 flex items-center justify-center text-white font-bold text-xs capitalize transition-all"
                >
                  {clipShape}
                </div>
              )}
            </div>

            {/* Generated Code */}
            <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
              <div className="text-xs font-mono text-slate-400 mb-2 border-b border-slate-800 pb-2">
                Generated CSS Property
              </div>
              <pre className="font-mono text-xs text-pink-300 overflow-x-auto leading-relaxed">
                {currentOutputCode}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 4. SVG OPTIMIZER & REACT/JSX CONVERTER
// ==========================================
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-shield">
  <!-- Generated by SVG Designer -->
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
</svg>`;

export function SVGOptimizer() {
  const tool = getToolById("svg-optimizer")!;
  const [rawSvg, setRawSvg] = useState(SAMPLE_SVG);
  const [componentName, setComponentName] = useState("ShieldIcon");

  // Clean SVG logic
  const cleanedSvg = rawSvg
    .replace(/<!--[\s\S]*?-->/g, "") // comments
    .replace(/<\?xml[\s\S]*?\?>/g, "") // xml decl
    .replace(/<!DOCTYPE[\s\S]*?>/g, "") // doctype
    .replace(/\s(data-name|id)="[^"]*"/g, "") // ids
    .trim();

  // Convert to React JSX
  const reactJsx = `export function ${componentName}(props: React.SVGProps<SVGSVGElement>) {
  return (
    ${cleanedSvg
      .replace(/class=/g, "className=")
      .replace(/stroke-width=/g, "strokeWidth=")
      .replace(/stroke-linecap=/g, "strokeLinecap=")
      .replace(/stroke-linejoin=/g, "strokeLinejoin=")
      .replace(/fill-rule=/g, "fillRule=")
      .replace(/clip-rule=/g, "clipRule=")
      .replace(/<svg\s/, "<svg {...props} ")}
  );
}`;

  return (
    <ToolShell tool={tool} outputCode={reactJsx} outputFilename={`${componentName}.tsx`}>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Raw SVG Input
            </span>
            <input
              type="text"
              value={componentName}
              onChange={(e) => setComponentName(e.target.value)}
              placeholder="ComponentName"
              className="rounded border border-slate-200 px-2 py-0.5 text-xs font-mono w-36"
            />
          </div>

          <textarea
            rows={12}
            value={rawSvg}
            onChange={(e) => setRawSvg(e.target.value)}
            className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none focus:outline-none focus:border-slate-900"
          />

          {/* Visual SVG render preview */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-center justify-center">
            <div
              className="h-16 w-16 text-slate-900 flex items-center justify-center [&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: cleanedSvg }}
            />
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100 flex flex-col">
          <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2 flex justify-between">
            <span>Optimized React / JSX Component</span>
            <span className="text-emerald-400 font-bold">Production Ready</span>
          </div>
          <pre className="font-mono text-xs text-sky-300 overflow-x-auto leading-relaxed flex-1 max-h-[460px]">
            {reactJsx}
          </pre>
        </div>
      </div>
    </ToolShell>
  );
}

