"use client";

import React, { useState } from "react";
import { ToolShell } from "./tool-shell";
import { getToolById } from "@/lib/tools/tool-registry";
import {
  Boxes,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Layers,
  Plus,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";

// ==========================================
// 1. OPEN GRAPH & SOCIAL CARD PREVIEWER
// ==========================================
export function OpenGraphPreviewer() {
  const tool = getToolById("open-graph-previewer")!;
  const [title, setTitle] = useState("RazeQA — Autonomous PR Testing Engine & Quality Forensics");
  const [description, setDescription] = useState(
    "Continuous autonomous verification for pull requests and live websites with per-path quality analysis and AI insights."
  );
  const [url, setUrl] = useState("https://razeqa.dev/features");
  const [siteName, setSiteName] = useState("RazeQA Platform");
  const [imageUrl, setImageUrl] = useState("https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop&q=80");
  const [twitterCard, setTwitterCard] = useState<"summary_large_image" | "summary">("summary_large_image");
  const [previewPlatform, setPreviewPlatform] = useState<"twitter" | "facebook" | "linkedin" | "discord">("twitter");

  // Automation & Loading State
  const [scrapeTargetUrl, setScrapeTargetUrl] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [scrapeSuccess, setScrapeSuccess] = useState<string | null>(null);

  const handleScrapeLiveUrl = async () => {
    if (!scrapeTargetUrl.trim()) return;
    setIsScraping(true);
    setScrapeError(null);
    setScrapeSuccess(null);

    try {
      const res = await fetch("/api/tools/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: scrapeTargetUrl, type: "opengraph" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to extract metadata");
      }

      if (data.title) setTitle(data.title);
      if (data.description) setDescription(data.description);
      if (data.imageUrl) setImageUrl(data.imageUrl);
      if (data.canonicalUrl) setUrl(data.canonicalUrl);
      if (data.siteName) setSiteName(data.siteName);
      if (data.twitterCard) setTwitterCard(data.twitterCard);

      setScrapeSuccess(`Successfully extracted OpenGraph tags from ${new URL(data.canonicalUrl || scrapeTargetUrl).hostname}!`);
      setTimeout(() => setScrapeSuccess(null), 4000);
    } catch (err: any) {
      setScrapeError(err.message || "Failed to scrape URL");
    } finally {
      setIsScraping(false);
    }
  };

  const generatedHtml = `<!-- Primary Meta Tags -->
<title>${title}</title>
<meta name="title" content="${title}" />
<meta name="description" content="${description}" />
<link rel="canonical" href="${url}" />

<!-- Open Graph / Facebook / LinkedIn -->
<meta property="og:type" content="website" />
<meta property="og:url" content="${url}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${imageUrl}" />
<meta property="og:site_name" content="${siteName}" />

<!-- Twitter / X -->
<meta property="twitter:card" content="${twitterCard}" />
<meta property="twitter:url" content="${url}" />
<meta property="twitter:title" content="${title}" />
<meta property="twitter:description" content="${description}" />
<meta property="twitter:image" content="${imageUrl}" />`;

  return (
    <ToolShell
      tool={tool}
      outputCode={generatedHtml}
      outputFilename="meta-tags.html"
      onReset={() => {
        setTitle("RazeQA — Autonomous PR Testing Engine");
        setDescription("Continuous autonomous verification for pull requests and live websites.");
        setUrl("https://razeqa.dev");
        setImageUrl("https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&auto=format&fit=crop&q=80");
      }}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Input Form (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Automated Web Scrape Bar */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                <span>Auto-Extract from Live URL</span>
              </span>
              <span className="text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded">
                Web Scraper
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                value={scrapeTargetUrl}
                onChange={(e) => setScrapeTargetUrl(e.target.value)}
                placeholder="https://example.com/blog/article"
                className="flex-1 rounded border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-mono"
              />
              <button
                onClick={handleScrapeLiveUrl}
                disabled={isScraping || !scrapeTargetUrl.trim()}
                className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {isScraping ? (
                  <>
                    <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
                    <span>Scraping…</span>
                  </>
                ) : (
                  <span>Fetch</span>
                )}
              </button>
            </div>
            {scrapeSuccess && (
              <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <Check className="h-3 w-3 shrink-0" />
                <span>{scrapeSuccess}</span>
              </div>
            )}
            {scrapeError && (
              <div className="text-[11px] text-rose-600 font-medium">
                {scrapeError}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
              Card Parameters
            </h2>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Page Title (og:title)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900"
                placeholder="Title (recommended: 40-60 chars)"
              />
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {title.length} characters
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Description (og:description)
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900 resize-none"
                placeholder="Description (recommended: 120-160 chars)"
              />
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                {description.length} characters
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Canonical URL (og:url)
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Open Graph Image URL (og:image)
              </label>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900 font-mono"
              />
              <span className="text-[11px] text-slate-400 mt-0.5 block">
                Recommended aspect ratio: 1200x630 (1.91:1)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Site Name
                </label>
                <input
                  type="text"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Twitter Card
                </label>
                <select
                  value={twitterCard}
                  onChange={(e) => setTwitterCard(e.target.value as any)}
                  className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-slate-900 bg-white"
                >
                  <option value="summary_large_image">summary_large_image</option>
                  <option value="summary">summary</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Live Card Visual Preview & Generated Tags (7 cols) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Platform Switcher */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Live Feed Rendering
            </span>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
              {(["twitter", "facebook", "linkedin", "discord"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreviewPlatform(p)}
                  className={`capitalize text-xs font-medium px-2.5 py-1 rounded transition-colors ${
                    previewPlatform === p
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {p === "twitter" ? "Twitter / X" : p}
                </button>
              ))}
            </div>
          </div>

          {/* Card Mockup */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 flex items-center justify-center">
            {previewPlatform === "twitter" && (
              <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="relative aspect-[1.91/1] w-full bg-slate-100 overflow-hidden">
                  <img
                    src={imageUrl}
                    alt="Preview"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        "https://via.placeholder.com/1200x630?text=Preview+Image+Missing";
                    }}
                  />
                  <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    {new URL(url || "https://razeqa.dev").hostname}
                  </span>
                </div>
                <div className="p-3.5 space-y-1">
                  <div className="text-[11px] text-slate-400 truncate">
                    {new URL(url || "https://razeqa.dev").hostname}
                  </div>
                  <div className="text-xs font-bold text-slate-900 line-clamp-1">
                    {title}
                  </div>
                  <div className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {description}
                  </div>
                </div>
              </div>
            )}

            {previewPlatform === "facebook" && (
              <div className="w-full max-w-md border border-slate-200 bg-[#f0f2f5] rounded-lg overflow-hidden shadow-xs">
                <div className="aspect-[1.91/1] w-full bg-slate-200 overflow-hidden">
                  <img src={imageUrl} alt="Preview" className="h-full w-full object-cover" />
                </div>
                <div className="p-3 bg-white border-t border-slate-200 space-y-0.5">
                  <div className="text-[10px] uppercase font-mono text-slate-400">
                    {new URL(url || "https://razeqa.dev").hostname}
                  </div>
                  <div className="text-xs font-bold text-slate-900 line-clamp-1">{title}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">{description}</div>
                </div>
              </div>
            )}

            {previewPlatform === "linkedin" && (
              <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="aspect-[1.91/1] w-full bg-slate-200 overflow-hidden">
                  <img src={imageUrl} alt="Preview" className="h-full w-full object-cover" />
                </div>
                <div className="p-3 space-y-1">
                  <div className="text-xs font-bold text-slate-900 line-clamp-2">{title}</div>
                  <div className="text-[10px] text-slate-400">
                    {new URL(url || "https://razeqa.dev").hostname} • 1 min read
                  </div>
                </div>
              </div>
            )}

            {previewPlatform === "discord" && (
              <div className="w-full max-w-md rounded-lg bg-[#2b2d31] p-4 text-white border-l-4 border-[#5865f2] shadow-sm space-y-2">
                <div className="text-[11px] text-slate-300 font-semibold">{siteName}</div>
                <div className="text-xs font-bold text-[#00a8fc] hover:underline cursor-pointer">
                  {title}
                </div>
                <div className="text-[11px] text-slate-300 leading-relaxed">{description}</div>
                <div className="aspect-[1.91/1] w-full rounded-md overflow-hidden bg-slate-800">
                  <img src={imageUrl} alt="Preview" className="h-full w-full object-cover" />
                </div>
              </div>
            )}
          </div>

          {/* Generated Code Output */}
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-4 text-slate-100">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2 border-b border-slate-800 pb-2">
              <span>HTML &lt;head&gt; Code</span>
              <span className="text-[11px]">Ready to inject</span>
            </div>
            <pre className="font-mono text-[11px] text-emerald-400 overflow-x-auto p-1 leading-relaxed max-h-56">
              {generatedHtml}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 2. STRUCTURED DATA / SCHEMA BUILDER (JSON-LD)
// ==========================================
export function SchemaGenerator() {
  const tool = getToolById("schema-generator")!;
  const [schemaType, setSchemaType] = useState<"FAQPage" | "Product" | "Article" | "Organization">("FAQPage");

  // FAQ Schema State
  const [faqs, setFaqs] = useState([
    {
      q: "What is RazeQA?",
      a: "RazeQA is an autonomous PR verification engine and synthetic journey testing platform.",
    },
    {
      q: "Does RazeQA run headless Playwright sandboxes?",
      a: "Yes, RazeQA spins up deterministic headless browser environments with video and trace recording.",
    },
  ]);

  // Product Schema State
  const [productName, setProductName] = useState("Enterprise QA Fleet License");
  const [productPrice, setProductPrice] = useState("499");
  const [currency, setCurrency] = useState("USD");
  const [productSku, setProductSku] = useState("RAZEQA-ENT-01");

  // Article Schema State
  const [articleHeadline, setArticleHeadline] = useState("How Autonomous PR Testing Eliminates Flaky Regressions");
  const [authorName, setAuthorName] = useState("RazeQA Engineering");

  const buildJsonLd = () => {
    if (schemaType === "FAQPage") {
      return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: f.a,
          },
        })),
      };
    }
    if (schemaType === "Product") {
      return {
        "@context": "https://schema.org",
        "@type": "Product",
        name: productName,
        sku: productSku,
        offers: {
          "@type": "Offer",
          price: productPrice,
          priceCurrency: currency,
          availability: "https://schema.org/InStock",
        },
      };
    }
    if (schemaType === "Article") {
      return {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: articleHeadline,
        author: {
          "@type": "Person",
          name: authorName,
        },
        datePublished: new Date().toISOString(),
      };
    }
    return {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "RazeQA Platform",
      url: "https://razeqa.dev",
      logo: "https://razeqa.dev/logo.png",
    };
  };

  const jsonLdString = JSON.stringify(buildJsonLd(), null, 2);
  const snippet = `<script type="application/ld+json">\n${jsonLdString}\n</script>`;

  return (
    <ToolShell
      tool={tool}
      outputCode={snippet}
      outputFilename="schema.jsonld"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Interactive Schema Builder */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Select Schema Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["FAQPage", "Product", "Article", "Organization"] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setSchemaType(st)}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold text-left transition-all ${
                      schemaType === st
                        ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Controls based on Schema */}
            {schemaType === "FAQPage" && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">FAQ Pairs ({faqs.length})</span>
                  <button
                    onClick={() => setFaqs([...faqs, { q: "New Question?", a: "New Answer text." }])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Item</span>
                  </button>
                </div>
                {faqs.map((faq, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-500">Question #{i + 1}</span>
                      {faqs.length > 1 && (
                        <button
                          onClick={() => setFaqs(faqs.filter((_, idx) => idx !== i))}
                          className="text-rose-500 hover:text-rose-700"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={faq.q}
                      onChange={(e) => {
                        const updated = [...faqs];
                        updated[i].q = e.target.value;
                        setFaqs(updated);
                      }}
                      className="w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-xs"
                      placeholder="Question"
                    />
                    <textarea
                      rows={2}
                      value={faq.a}
                      onChange={(e) => {
                        const updated = [...faqs];
                        updated[i].a = e.target.value;
                        setFaqs(updated);
                      }}
                      className="w-full rounded border border-slate-200 bg-white px-2.5 py-1 text-xs resize-none"
                      placeholder="Answer"
                    />
                  </div>
                ))}
              </div>
            )}

            {schemaType === "Product" && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Product Name</label>
                  <input
                    type="text"
                    value={productName}
                    onChange={(e) => setProductName(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Price</label>
                    <input
                      type="number"
                      value={productPrice}
                      onChange={(e) => setProductPrice(e.target.value)}
                      className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Currency</label>
                    <input
                      type="text"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SKU</label>
                  <input
                    type="text"
                    value={productSku}
                    onChange={(e) => setProductSku(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {schemaType === "Article" && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Article Headline</label>
                  <input
                    type="text"
                    value={articleHeadline}
                    onChange={(e) => setArticleHeadline(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Author Name</label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Validated JSON-LD Output */}
        <div className="lg:col-span-7 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Valid Schema.org JSON-LD Output
              </span>
              <span>{schemaType}</span>
            </div>
            <pre className="font-mono text-xs text-amber-300 overflow-x-auto leading-relaxed max-h-[480px]">
              {snippet}
            </pre>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 3. SITEMAP & CANONICAL BUILDER
// ==========================================
export function SitemapGenerator() {
  const tool = getToolById("sitemap-generator")!;
  const [baseUrl, setBaseUrl] = useState("https://example.com");
  const [paths, setPaths] = useState("/\n/about\n/pricing\n/blog\n/checkout");
  const [changefreq, setChangefreq] = useState("weekly");
  const [priority, setPriority] = useState("0.8");

  // Automation & Loading State
  const [crawlUrl, setCrawlUrl] = useState("https://razeqa.dev");
  const [isCrawling, setIsCrawling] = useState(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawlSuccess, setCrawlSuccess] = useState<string | null>(null);

  const handleAutoCrawl = async () => {
    if (!crawlUrl.trim()) return;
    setIsCrawling(true);
    setCrawlError(null);
    setCrawlSuccess(null);

    try {
      const res = await fetch("/api/tools/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: crawlUrl, type: "sitemap-paths" }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to crawl routes");
      }

      if (data.baseUrl) setBaseUrl(data.baseUrl);
      if (Array.isArray(data.paths) && data.paths.length > 0) {
        setPaths(data.paths.join("\n"));
        setCrawlSuccess(`Discovered and normalized ${data.paths.length} internal routes!`);
        setTimeout(() => setCrawlSuccess(null), 4000);
      }
    } catch (err: any) {
      setCrawlError(err.message || "Failed to crawl website");
    } finally {
      setIsCrawling(false);
    }
  };

  const urlList = paths
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlList
  .map((p) => {
    const full = `${baseUrl.replace(/\/$/, "")}${p.startsWith("/") ? p : `/${p}`}`;
    return `  <url>
    <loc>${full}</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  })
  .join("\n")}
</urlset>`;

  return (
    <ToolShell tool={tool} outputCode={xml} outputFilename="sitemap.xml">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          {/* Automated Web Crawler Bar */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                <span>Auto-Crawl Website Routes</span>
              </span>
              <span className="text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded">
                Path Scraper
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                value={crawlUrl}
                onChange={(e) => setCrawlUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 rounded border border-indigo-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 font-mono"
              />
              <button
                onClick={handleAutoCrawl}
                disabled={isCrawling || !crawlUrl.trim()}
                className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {isCrawling ? (
                  <>
                    <span className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" />
                    <span>Crawling…</span>
                  </>
                ) : (
                  <span>Crawl Site</span>
                )}
              </button>
            </div>
            {crawlSuccess && (
              <div className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                <Check className="h-3 w-3 shrink-0" />
                <span>{crawlSuccess}</span>
              </div>
            )}
            {crawlError && (
              <div className="text-[11px] text-rose-600 font-medium">
                {crawlError}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Base Domain</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Paths (One per line)
            </label>
            <textarea
              rows={6}
              value={paths}
              onChange={(e) => setPaths(e.target.value)}
              className="w-full rounded-md border border-slate-200 p-2.5 text-xs font-mono resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Change Frequency</label>
              <select
                value={changefreq}
                onChange={(e) => setChangefreq(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs bg-white"
              >
                <option value="always">always</option>
                <option value="hourly">hourly</option>
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
                <option value="yearly">yearly</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs bg-white"
              >
                <option value="1.0">1.0 (Highest)</option>
                <option value="0.8">0.8 (High)</option>
                <option value="0.5">0.5 (Default)</option>
                <option value="0.3">0.3 (Low)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
          <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
            XML Sitemap Output ({urlList.length} URLs)
          </div>
          <pre className="font-mono text-xs text-sky-300 overflow-x-auto leading-relaxed max-h-[440px]">
            {xml}
          </pre>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 4. REDIRECT RULE GENERATOR
// ==========================================
export function RedirectGenerator() {
  const tool = getToolById("redirect-generator")!;
  const [sourcePath, setSourcePath] = useState("/old-store/product-123");
  const [targetPath, setTargetPath] = useState("/products/product-123");
  const [statusCode, setStatusCode] = useState<"301" | "302">("301");
  const [serverType, setServerType] = useState<"nginx" | "cloudflare" | "apache">("nginx");

  const buildRule = () => {
    if (serverType === "nginx") {
      const code = statusCode === "301" ? "permanent" : "redirect";
      return `# NGINX Redirect Rule\nrewrite ^${sourcePath}$ ${targetPath} ${code};`;
    }
    if (serverType === "apache") {
      return `# Apache .htaccess Rule\nRewriteEngine On\nRewriteRule ^${sourcePath.replace(/^\//, "")}$ ${targetPath} [R=${statusCode},L]`;
    }
    return `// Cloudflare Transform Rule / Page Rule\nURL Redirect (HTTP ${statusCode}):\nWhen Incoming Request matches:\n(http.request.uri.path eq "${sourcePath}")\nThen Redirect to:\n${targetPath} (Status: ${statusCode})`;
  };

  const ruleOutput = buildRule();

  return (
    <ToolShell tool={tool} outputCode={ruleOutput} outputFilename="redirects.conf">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Server Platform</label>
            <div className="grid grid-cols-3 gap-2">
              {(["nginx", "cloudflare", "apache"] as const).map((srv) => (
                <button
                  key={srv}
                  onClick={() => setServerType(srv)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold capitalize transition-all ${
                    serverType === srv
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {srv}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Source Path (Old URL)</label>
            <input
              type="text"
              value={sourcePath}
              onChange={(e) => setSourcePath(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Target Destination (New URL)</label>
            <input
              type="text"
              value={targetPath}
              onChange={(e) => setTargetPath(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">HTTP Status</label>
            <select
              value={statusCode}
              onChange={(e) => setStatusCode(e.target.value as any)}
              className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs bg-white"
            >
              <option value="301">301 Moved Permanently (SEO standard)</option>
              <option value="302">302 Found / Temporary Redirect</option>
            </select>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
          <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
            Generated {serverType.toUpperCase()} Configuration
          </div>
          <pre className="font-mono text-xs text-lime-400 overflow-x-auto leading-relaxed">
            {ruleOutput}
          </pre>
        </div>
      </div>
    </ToolShell>
  );
}

// ==========================================
// 5. CANONICAL URL & HREFLANG TAG BUILDER
// ==========================================
export function CanonicalHreflangBuilder() {
  const tool = getToolById("canonical-hreflang")!;
  const [canonicalUrl, setCanonicalUrl] = useState("https://example.com/products/wireless-headphones");
  const [locales, setLocales] = useState([
    { code: "en-US", url: "https://example.com/en-us/products/wireless-headphones" },
    { code: "en-GB", url: "https://example.com/en-gb/products/wireless-headphones" },
    { code: "de-DE", url: "https://example.com/de/produkte/kabellose-kopfhoerer" },
    { code: "fr-FR", url: "https://example.com/fr/produits/ecouteurs-sans-fil" },
    { code: "x-default", url: "https://example.com/products/wireless-headphones" },
  ]);

  const generatedTags = `<!-- Canonical URL -->
<link rel="canonical" href="${canonicalUrl}" />

<!-- Multi-Language / International Hreflang Alternates -->
${locales.map((l) => `<link rel="alternate" hreflang="${l.code}" href="${l.url}" />`).join("\n")}`;

  return (
    <ToolShell tool={tool} outputCode={generatedTags} outputFilename="hreflang-tags.html">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Canonical & Locale Mapping
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Primary Canonical URL
            </label>
            <input
              type="url"
              value={canonicalUrl}
              onChange={(e) => setCanonicalUrl(e.target.value)}
              className="w-full rounded border border-slate-200 px-3 py-1.5 text-xs font-mono"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              The authoritative master URL search engines should index.
            </span>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">Alternate Regional Locales ({locales.length})</span>
              <button
                onClick={() => setLocales([...locales, { code: "es-ES", url: canonicalUrl.replace(".com/", ".com/es/") }])}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                + Add Locale
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {locales.map((loc, idx) => (
                <div key={idx} className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-200 text-xs font-mono">
                  <input
                    type="text"
                    value={loc.code}
                    onChange={(e) => {
                      const updated = [...locales];
                      updated[idx].code = e.target.value;
                      setLocales(updated);
                    }}
                    placeholder="hreflang"
                    className="w-24 rounded border border-slate-200 bg-white px-2 py-1 text-slate-900"
                  />
                  <input
                    type="url"
                    value={loc.url}
                    onChange={(e) => {
                      const updated = [...locales];
                      updated[idx].url = e.target.value;
                      setLocales(updated);
                    }}
                    placeholder="alternate url"
                    className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-slate-900 text-[11px]"
                  />
                  {locales.length > 1 && (
                    <button
                      onClick={() => setLocales(locales.filter((_, i) => i !== idx))}
                      className="text-slate-400 hover:text-rose-600 px-1"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-slate-950 p-5 text-slate-100">
          <div className="text-xs font-mono text-slate-400 mb-3 border-b border-slate-800 pb-2">
            HTML &lt;head&gt; Link Elements
          </div>
          <pre className="font-mono text-xs text-sky-300 overflow-x-auto leading-relaxed">
            {generatedTags}
          </pre>
        </div>
      </div>
    </ToolShell>
  );
}
