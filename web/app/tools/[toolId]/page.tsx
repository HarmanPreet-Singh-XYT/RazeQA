import React from "react";
import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { TOOLS_REGISTRY, getToolById } from "@/lib/tools/tool-registry";
import { ToolRenderer } from "@/components/tools/tool-renderer";

interface ToolPageProps {
  params: Promise<{ toolId: string }>;
}

export async function generateStaticParams() {
  return TOOLS_REGISTRY.map((t) => ({
    toolId: t.id,
  }));
}

export async function generateMetadata({ params }: ToolPageProps): Promise<Metadata> {
  const { toolId } = await params;
  const tool = getToolById(toolId);
  if (!tool) {
    return {
      title: "Tool Not Found | RazeQA",
    };
  }

  return {
    title: `${tool.name} — Free In-Browser Webmaster Tool`,
    description: tool.detailedDescription,
    keywords: [...tool.tags, "Developer Tool", "Free Online Tool", "RazeQA"],
    openGraph: {
      title: `${tool.name} | RazeQA Developer Suite`,
      description: tool.detailedDescription,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${tool.name} | RazeQA Developer Suite`,
      description: tool.description,
    },
  };
}

export default async function ToolDetailPage({ params }: ToolPageProps) {
  const { toolId } = await params;
  const tool = getToolById(toolId);

  if (!tool) {
    notFound();
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: tool.name,
    description: tool.detailedDescription,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web Browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-slate-900 font-sans antialiased selection:bg-slate-200">
      {/* Structural background graph grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid-light mask-radial-light opacity-60" />

      {/* Structured Schema markup for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Global Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-white font-mono font-bold text-xs shadow-xs group-hover:bg-slate-800 transition-colors">
                PR
              </div>
              <span className="font-bold text-slate-900 tracking-tight text-base">
                RazeQA Platform
              </span>
            </Link>
            <span className="text-slate-300">/</span>
            <Link
              href="/tools"
              className="text-xs font-bold text-slate-600 hover:text-slate-900 uppercase tracking-wider transition-colors"
            >
              Tools Hub
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-none">
              {tool.shortName || tool.name}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">All Tools</span>
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-xs transition-colors"
            >
              <span>Dashboard</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Main Tool Shell Container */}
      <main className="relative z-10 mx-auto max-w-7xl px-6 py-8">
        <ToolRenderer tool={tool} />
      </main>
    </div>
  );
}
