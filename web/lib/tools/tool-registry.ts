export type ToolCategory =
  | "seo"
  | "security"
  | "css"
  | "converters"
  | "networking";

export interface ToolDefinition {
  id: string;
  name: string;
  shortName?: string;
  category: ToolCategory;
  categoryLabel: string;
  description: string;
  detailedDescription: string;
  tags: string[];
  icon: string;
  badge?: "Popular" | "Essential" | "Security" | "New" | "Pro";
  synergyHint: string;
}

export const TOOL_CATEGORIES: { id: ToolCategory; label: string; description: string; icon: string }[] = [
  {
    id: "seo",
    label: "SEO & Webmaster",
    description: "Sitemaps, Open Graph social cards, JSON-LD rich schemas, canonicals, and redirect rules.",
    icon: "Globe",
  },
  {
    id: "security",
    label: "Security, Headers & Auth",
    description: "CSP builders, JWT inspection, CORS testers, hashing, and certificate checkers.",
    icon: "ShieldCheck",
  },
  {
    id: "css",
    label: "CSS & UI Design",
    description: "Fluid clamp typography, WCAG contrast checkers, modern CSS generator suite, and SVG converters.",
    icon: "Palette",
  },
  {
    id: "converters",
    label: "Data & Converters",
    description: "JSON to TypeScript/Go/Rust, format transpilers, Base64/URL encoders, and visual node inspectors.",
    icon: "FileCode2",
  },
  {
    id: "networking",
    label: "Dev & Networking",
    description: "Regex parsers, Cron schedule translators, cURL to Fetch/Axios, CIDR subnet calculators, and UUID generators.",
    icon: "Terminal",
  },
];

export const TOOLS_REGISTRY: ToolDefinition[] = [
  // 1. SEO & Webmaster
  {
    id: "open-graph-previewer",
    name: "Social Card & Open Graph Previewer",
    shortName: "OG Previewer",
    category: "seo",
    categoryLabel: "SEO & Webmaster",
    description: "Preview how URLs and meta tags render across Twitter/X, Facebook, LinkedIn, and Discord.",
    detailedDescription: "Test and visualize Open Graph and Twitter Card tags in real time. Validate required titles, descriptions, canonical URLs, and image aspect ratios to ensure rich social previews.",
    tags: ["Open Graph", "Social", "Twitter Cards", "SEO", "Meta Tags", "Facebook"],
    icon: "Share2",
    badge: "Popular",
    synergyHint: "Failed social preview audit? Use this tool to generate missing og:image and twitter:card meta tags.",
  },
  {
    id: "schema-generator",
    name: "Structured Data / JSON-LD Schema Builder",
    shortName: "Schema Generator",
    category: "seo",
    categoryLabel: "SEO & Webmaster",
    description: "Visual schema builder producing validated JSON-LD for rich snippets, FAQs, and products.",
    detailedDescription: "Generate syntactically correct Schema.org JSON-LD scripts for Articles, FAQs, Products, Breadcrumbs, and Local Businesses to boost search visibility.",
    tags: ["JSON-LD", "Schema.org", "SEO", "Rich Snippets", "Google Search"],
    icon: "Boxes",
    badge: "Essential",
    synergyHint: "Ensure search crawlers parse rich snippets by embedding verified JSON-LD in your document head.",
  },
  {
    id: "sitemap-generator",
    name: "XML Sitemap & Robots Tag Builder",
    shortName: "Sitemap Builder",
    category: "seo",
    categoryLabel: "SEO & Webmaster",
    description: "Generate standards-compliant XML sitemaps and index directive tags for search consoles.",
    detailedDescription: "Build XML sitemaps conforming to sitemaps.org standards with change frequency, priority, and last-modified timestamps ready to submit to Google Search Console.",
    tags: ["Sitemap", "XML", "Robots", "SEO", "Webmaster"],
    icon: "FileSpreadsheet",
    badge: "Essential",
    synergyHint: "Seed your AutoQA automated crawler journeys directly from an exported sitemap.",
  },
  {
    id: "canonical-hreflang",
    name: "Canonical URL & Hreflang Tag Builder",
    shortName: "Hreflang Builder",
    category: "seo",
    categoryLabel: "SEO & Webmaster",
    description: "Generate multi-language and internationalization alternate tags to avoid duplicate content.",
    detailedDescription: "Create bi-directional hreflang links and canonical link tags for global e-commerce and international localization architectures.",
    tags: ["Canonical", "Hreflang", "i18n", "Localization", "SEO"],
    icon: "Languages",
    synergyHint: "Verify international routing without duplicate content penalties during synthetic PR checks.",
  },
  {
    id: "redirect-generator",
    name: "Redirect Rule Generator",
    shortName: "Redirect Rules",
    category: "seo",
    categoryLabel: "SEO & Webmaster",
    description: "Generate pre-configured redirect rules for NGINX, Cloudflare Page Rules, and Apache .htaccess.",
    detailedDescription: "Instantly transpile redirect patterns, permanent 301 migrations, and temporary 302 rules into production server configuration blocks.",
    tags: ["Redirects", "NGINX", "Cloudflare", "Apache", "301", "302"],
    icon: "ArrowLeftRight",
    synergyHint: "Prevent broken 404 links discovered in automated journeys by deploying clean 301 rewrite directives.",
  },

  // 2. Security, Headers & Auth
  {
    id: "csp-builder",
    name: "CSP (Content-Security-Policy) Builder",
    shortName: "CSP Builder",
    category: "security",
    categoryLabel: "Security & Headers",
    description: "Interactively construct strict Content-Security-Policy headers with script-src, nonces, and reporting.",
    detailedDescription: "Mitigate XSS and data injection attacks by building strict, modern CSP headers. Includes granular directive controls, preset templates, and hash generators.",
    tags: ["CSP", "Security", "Headers", "XSS", "Nonces", "AppSec"],
    icon: "ShieldAlert",
    badge: "Security",
    synergyHint: "When journey tests detect blocked inline scripts or insecure endpoints, fine-tune your CSP directives here.",
  },
  {
    id: "jwt-debugger",
    name: "JWT Debugger & Claims Inspector",
    shortName: "JWT Inspector",
    category: "security",
    categoryLabel: "Security & Headers",
    description: "Parse and inspect JSON Web Tokens in-browser to view decoded header, payload claims, and expiration status.",
    detailedDescription: "Client-side JWT decoder with zero network egress. Inspect exp, iat, aud, iss claims, view time-to-live countdowns, and spot expired authentication tokens.",
    tags: ["JWT", "Auth", "Tokens", "Security", "Bearer", "Claims"],
    icon: "KeyRound",
    badge: "Popular",
    synergyHint: "Inspect auth session tokens captured during synthetic login journeys to verify claims and expiry.",
  },
  {
    id: "cors-tester",
    name: "CORS Header Tester & Preflight Simulator",
    shortName: "CORS Tester",
    category: "security",
    categoryLabel: "Security & Headers",
    description: "Simulate browser preflight OPTIONS requests to validate Access-Control-Allow-Origin, Headers, and Credentials.",
    detailedDescription: "Troubleshoot CORS failures by testing custom origins, HTTP methods, authorization headers, and cookies against real or simulated API endpoints.",
    tags: ["CORS", "Preflight", "Headers", "API", "Security"],
    icon: "Network",
    badge: "Essential",
    synergyHint: "Fix 403 / CORS preflight errors in test network logs by exporting copy-paste Express/Next.js middleware.",
  },
  {
    id: "hash-generator",
    name: "Bcrypt & Web Crypto Hash Generator",
    shortName: "Hash Generator",
    category: "security",
    categoryLabel: "Security & Headers",
    description: "One-click cryptographic hashing using SHA-256, SHA-512, MD5, SHA-1, and Base64.",
    detailedDescription: "Generate cryptographically secure hashes directly in your browser using the native Web Crypto API for test data seeding and integrity checks.",
    tags: ["Hash", "SHA-256", "MD5", "Crypto", "Passwords", "Security"],
    icon: "Fingerprint",
    synergyHint: "Create SRI (Subresource Integrity) hashes for CDNs and script tags verified by your testing suites.",
  },
  {
    id: "ssl-checker",
    name: "SSL / TLS Certificate & Cipher Checker",
    shortName: "SSL Checker",
    category: "security",
    categoryLabel: "Security & Headers",
    description: "Tests certificate chains, expiration countdowns, SAN domains, and TLS 1.3 cipher suite support.",
    detailedDescription: "Inspect SSL/TLS certificate chains, verify issuing CA trust hierarchy, identify expiring certificates before outages occur, and validate cipher suite configurations.",
    tags: ["SSL", "TLS", "HTTPS", "Certificate", "Security", "Cipher"],
    icon: "Lock",
    badge: "Security",
    synergyHint: "Prevent deployment outages by running automated SSL health and expiration assertions during synthetic journeys.",
  },

  // 3. CSS & UI Design
  {
    id: "clamp-calculator",
    name: "Fluid Typography & Clamp Calculator",
    shortName: "Clamp Calculator",
    category: "css",
    categoryLabel: "CSS & UI Design",
    description: "Compute responsive CSS clamp(min, preferred, max) formulas based on viewport boundaries.",
    detailedDescription: "Eliminate disjointed breakpoint media queries. Calculate mathematically smooth typography and spacing transitions between mobile and desktop viewports.",
    tags: ["CSS", "clamp", "Fluid Typography", "Responsive", "Design"],
    icon: "Type",
    badge: "Popular",
    synergyHint: "Pass responsive visual regression checks by adopting fluid clamp typography across all viewport sizes.",
  },
  {
    id: "contrast-checker",
    name: "Color Palette & WCAG Contrast Checker",
    shortName: "Contrast Checker",
    category: "css",
    categoryLabel: "CSS & UI Design",
    description: "Evaluate WCAG 2.1 AA and AAA contrast ratios for normal, large text, and interactive UI components.",
    detailedDescription: "Real-time luminance contrast calculator with compliance badges for normal text, large headings, and graphical components. Includes palette preview and swap controls.",
    tags: ["Accessibility", "a11y", "WCAG", "Contrast", "Colors", "UI"],
    icon: "Eye",
    badge: "Essential",
    synergyHint: "Direct remediation tool when AutoQA accessibility audits flag failing color contrast ratios.",
  },
  {
    id: "css-generator",
    name: "Modern CSS Generators (Shadows, Glass, Gradients & Clip-Path)",
    shortName: "CSS Generator",
    category: "css",
    categoryLabel: "CSS & UI Design",
    description: "Interactive sliders for layered smooth box-shadows, multi-stop gradients, glassmorphism, and clip-path polygon shapes.",
    detailedDescription: "Design smooth, non-harsh multi-layer shadows, frosted glass effects with backdrop-filter blur, multi-stop linear gradients, and CSS clip-path shapes with one-click code copy.",
    tags: ["CSS", "Box Shadow", "Glassmorphism", "Gradients", "Clip Path", "Design System"],
    icon: "Sliders",
    badge: "New",
    synergyHint: "Generate copy-paste CSS variables that match your team's design system tokens.",
  },
  {
    id: "svg-optimizer",
    name: "SVG Optimizer & Clean React/JSX Converter",
    shortName: "SVG Optimizer",
    category: "css",
    categoryLabel: "CSS & UI Design",
    description: "Strips redundant XML metadata, comments, and IDs from SVG code, or converts SVG into clean React/JSX icon components.",
    detailedDescription: "Minify vector graphics for production web performance. Strips editor junk (Illustrator/Figma artifacts) and transforms kebab-case attributes into camelCase React JSX properties.",
    tags: ["SVG", "Optimizer", "JSX", "React", "Icons", "Vector"],
    icon: "FileCode2",
    badge: "Essential",
    synergyHint: "Optimize test icon fixtures and assets before bundling into production applications.",
  },

  // 4. Data Transformation & Converters
  {
    id: "json-to-types",
    name: "JSON to TypeScript, Go & Rust Converter",
    shortName: "JSON to Types",
    category: "converters",
    categoryLabel: "Data & Converters",
    description: "Transforms raw JSON payloads directly into TypeScript interfaces, Go structs, or Rust structs.",
    detailedDescription: "Paste API payloads or network test responses to instantly derive clean, strongly-typed type definitions with automatic optional fields and nested interfaces.",
    tags: ["TypeScript", "Go", "Rust", "JSON", "Types", "API"],
    icon: "Binary",
    badge: "Popular",
    synergyHint: "Convert API network step response payloads captured in test runs directly into typed test fixtures.",
  },
  {
    id: "format-transpiler",
    name: "Format Transpiler (JSON / YAML / CSV / XML)",
    shortName: "Format Transpiler",
    category: "converters",
    categoryLabel: "Data & Converters",
    description: "Bi-directional format transpiler converting between JSON, YAML, CSV, and XML with syntax validation.",
    detailedDescription: "Easily switch configuration and mock data files between formats. Features instant parsing, format detection, and error highlighting.",
    tags: ["JSON", "YAML", "CSV", "XML", "Transpiler", "Data"],
    icon: "Repeat",
    synergyHint: "Convert test data fixtures between CSV datasets and JSON structures for synthetic journey runs.",
  },
  {
    id: "encoding-decoding",
    name: "Encoding & Decoding Suite",
    shortName: "Encoder / Decoder",
    category: "converters",
    categoryLabel: "Data & Converters",
    description: "Instant conversions for Base64, URL encoding, HTML entities, and Hex strings.",
    detailedDescription: "Multi-encoder and decoder supporting standard Base64, URL-safe Base64, percent-encoding for URLs, and HTML character entities.",
    tags: ["Base64", "URL Encode", "HTML Entity", "Hex", "Decode"],
    icon: "Code",
    synergyHint: "Decode encrypted query parameters and payload bodies found in journey network traces.",
  },
  {
    id: "json-inspector",
    name: "JSON Visual Inspector & Tree Graph",
    shortName: "JSON Visualizer",
    category: "converters",
    categoryLabel: "Data & Converters",
    description: "Explore complex nested JSON payloads with interactive collapsible tree views and path copy.",
    detailedDescription: "Visualize nested arrays and dictionaries with deep object folding, key-path generation (e.g. data.items[0].id), and payload size metrics.",
    tags: ["JSON", "Visualizer", "Tree", "Inspector", "Debugging"],
    icon: "FolderTree",
    synergyHint: "Inspect heavy JSON responses from failed API assertions with direct path-to-property copying.",
  },

  // 5. Developer Utilities & Networking
  {
    id: "regex-tester",
    name: "Regex Tester & Token Explainer",
    shortName: "Regex Tester",
    category: "networking",
    categoryLabel: "Dev & Networking",
    description: "Interactive regular expression parser highlighting capture groups, match indices, and flags.",
    detailedDescription: "Test regular expressions against multi-line sample strings. Highlights full matches, sub-groups, and provides a plain-English explanation of pattern tokens.",
    tags: ["Regex", "RegExp", "Pattern", "Validation", "Developer"],
    icon: "SearchCode",
    badge: "Popular",
    synergyHint: "Refine DOM selector regexes and URL routing patterns used in autonomous Playwright tests.",
  },
  {
    id: "cron-parser",
    name: "Cron Expression Parser & Schedule Projector",
    shortName: "Cron Parser",
    category: "networking",
    categoryLabel: "Dev & Networking",
    description: "Human-readable schedule translator with projection of the next 5 execution timestamps.",
    detailedDescription: "Decode standard 5-part cron syntax (e.g., */15 * * * *) into plain English with a schedule simulator showing upcoming execution times in your local timezone.",
    tags: ["Cron", "Schedule", "Parser", "Automation", "DevOps"],
    icon: "Clock",
    badge: "Essential",
    synergyHint: "Configure scheduled autonomous synthetic runs and nightly regression runs with confidence.",
  },
  {
    id: "curl-converter",
    name: "cURL to Fetch, Axios & Python Converter",
    shortName: "cURL Converter",
    category: "networking",
    categoryLabel: "Dev & Networking",
    description: "Converts terminal cURL commands into native JavaScript fetch, Axios, or Python requests code.",
    detailedDescription: "Import raw cURL commands from browser DevTools or terminal and immediately convert them into production-ready client code with parsed headers, query params, and body data.",
    tags: ["cURL", "Fetch", "Axios", "Python", "API", "Requests"],
    icon: "Send",
    badge: "Popular",
    synergyHint: "Transform failing test network requests from the forensics waterfall into reproducible cURL and fetch scripts.",
  },
  {
    id: "uuid-generator",
    name: "UUID / ULID / NanoID Batch Generator",
    shortName: "ID Generator",
    category: "networking",
    categoryLabel: "Dev & Networking",
    description: "Batch generation of cryptographically secure v4 UUIDs, sortable ULIDs, and lightweight NanoIDs.",
    detailedDescription: "Generate up to 100 random or time-sortable unique identifiers at once with uppercase/lowercase toggles, hyphen strip, and bulk copy.",
    tags: ["UUID", "ULID", "NanoID", "Random", "ID", "Crypto"],
    icon: "Sparkles",
    badge: "Essential",
    synergyHint: "Generate mock user IDs and transaction reference numbers for parameterized test runs.",
  },
  {
    id: "cidr-calculator",
    name: "IPv4 & CIDR Subnet Calculator",
    shortName: "CIDR Calculator",
    category: "networking",
    categoryLabel: "Dev & Networking",
    description: "Computes broadcast addresses, netmasks, usable host ranges, and wildcard masks from CIDR notation.",
    detailedDescription: "Calculate IP subnet allocations, total usable addresses, binary representations, and wildcard masks for cloud network rules and firewall configurations.",
    tags: ["IPv4", "CIDR", "Subnet", "Networking", "IP", "DevOps"],
    icon: "Network",
    synergyHint: "Configure firewall whitelisting for AutoQA runner IPs accessing staging environments.",
  },
];

export function getToolById(id: string): ToolDefinition | undefined {
  return TOOLS_REGISTRY.find((t) => t.id === id);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOLS_REGISTRY.filter((t) => t.category === category);
}

export function searchTools(query: string, category?: ToolCategory | "all"): ToolDefinition[] {
  const normalized = query.trim().toLowerCase();
  return TOOLS_REGISTRY.filter((tool) => {
    const matchesCategory = !category || category === "all" || tool.category === category;
    if (!matchesCategory) return false;
    if (!normalized) return true;

    return (
      tool.name.toLowerCase().includes(normalized) ||
      tool.description.toLowerCase().includes(normalized) ||
      tool.detailedDescription.toLowerCase().includes(normalized) ||
      tool.tags.some((tag) => tag.toLowerCase().includes(normalized))
    );
  });
}
