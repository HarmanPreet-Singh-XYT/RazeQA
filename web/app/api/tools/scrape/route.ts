import { NextRequest, NextResponse } from "next/server";
import { validateExternalTarget, NetworkSafetyError } from "@/lib/network-safety";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Rate limiting: 10 requests per minute
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit("tools:scrape", clientId, 10, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rateLimit.resetMs / 1000).toString() },
      }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { url, type } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing or invalid url parameter" }, { status: 400 });
    }

    let targetValidation;
    try {
      targetValidation = await validateExternalTarget(url, {
        allowedProtocols: ["http:", "https:"],
        allowedPorts: [80, 443],
      });
    } catch (valErr: any) {
      const message = valErr instanceof NetworkSafetyError ? valErr.message : "Target validation failed";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const parsedUrl = targetValidation.url;

    // SSR fetch target website
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let html = "";
    try {
      const resp = await fetch(parsedUrl.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 RazeQA/1.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        return NextResponse.json(
          { error: `Remote host responded with HTTP ${resp.status}` },
          { status: 502 }
        );
      }
      html = await resp.text();
    } catch {
      clearTimeout(timeout);
      return NextResponse.json(
        { error: "Failed to fetch target website or request timed out" },
        { status: 504 }
      );
    }

    // 1. Sitemap Paths Crawler
    if (type === "sitemap-paths") {
      const linkRegex = /<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1/gi;
      const discoveredPaths = new Set<string>();
      discoveredPaths.add("/");

      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null) {
        const rawHref = match[2]?.trim();
        if (!rawHref) continue;
        if (
          rawHref.startsWith("#") ||
          rawHref.startsWith("mailto:") ||
          rawHref.startsWith("tel:") ||
          rawHref.startsWith("javascript:")
        ) {
          continue;
        }

        try {
          const resolved = new URL(rawHref, parsedUrl.origin);
          // Only collect internal domain links
          if (resolved.hostname === parsedUrl.hostname) {
            let pathname = resolved.pathname.replace(/\/$/, "");
            if (!pathname) pathname = "/";
            // Ignore asset extensions
            if (!pathname.match(/\.(png|jpe?g|gif|svg|webp|css|js|ico|pdf|zip)$/i)) {
              discoveredPaths.add(pathname);
            }
          }
        } catch {
          // Ignore invalid URL
        }
      }

      const pathsList = Array.from(discoveredPaths).sort();

      return NextResponse.json({
        success: true,
        baseUrl: parsedUrl.origin,
        paths: pathsList,
        totalFound: pathsList.length,
      });
    }

    // 2. OpenGraph / Social Metadata Extractor
    if (type === "opengraph") {
      const getMeta = (propOrName: string) => {
        const re = new RegExp(
          `<meta\\s+(?:[^>]*?\\s+)?(?:property|name)=["'](?:og:|twitter:)?${propOrName}["']\\s+(?:[^>]*?\\s+)?content=["'](.*?)["']`,
          "i"
        );
        const altRe = new RegExp(
          `<meta\\s+(?:[^>]*?\\s+)?content=["'](.*?)["']\\s+(?:[^>]*?\\s+)?(?:property|name)=["'](?:og:|twitter:)?${propOrName}["']`,
          "i"
        );
        const m = re.exec(html) || altRe.exec(html);
        return m ? m[1] : undefined;
      };

      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = getMeta("title") || (titleMatch ? titleMatch[1].trim() : "");
      const description = getMeta("description") || "";
      const image = getMeta("image") || "";
      const siteName = getMeta("site_name") || parsedUrl.hostname;
      const twitterCard = getMeta("card") || "summary_large_image";

      const canonicalMatch = html.match(/<link\s+[^>]*?rel=["']canonical["'][^>]*?href=["']([^"']+)["']/i);
      const canonicalUrl = canonicalMatch ? canonicalMatch[1] : parsedUrl.toString();

      return NextResponse.json({
        success: true,
        title,
        description,
        imageUrl: image,
        canonicalUrl,
        siteName,
        twitterCard: twitterCard.includes("summary") ? twitterCard : "summary_large_image",
      });
    }

    // 3. Structured Data / Schema.org JSON-LD Extractor
    if (type === "schema") {
      const scriptRegex = /<script\s+[^>]*?type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      const schemas: any[] = [];
      let m: RegExpExecArray | null;

      while ((m = scriptRegex.exec(html)) !== null) {
        try {
          const parsed = JSON.parse(m[1].trim());
          schemas.push(parsed);
        } catch {
          // invalid JSON in script tag
        }
      }

      return NextResponse.json({
        success: true,
        schemas,
        count: schemas.length,
      });
    }

    return NextResponse.json({ error: "Unknown automation type" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
