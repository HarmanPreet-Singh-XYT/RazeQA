import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";

const connectSrc = isDev
  ? "'self' https://*.supabase.co wss://*.supabase.co ws: http:"
  : "'self' https://*.supabase.co wss://*.supabase.co";

// Forensic run videos are uploaded to Supabase Storage and handed back as
// signed cross-origin URLs (see agent.db.storage.upload_artifact). Without the
// Supabase origin listed here, Chromium rejects every <video> request with
// MEDIA_ELEMENT_ERROR code 4 "Media load rejected by URL safety check", which
// the player surfaces as "Unsupported video format" — while the exact same URL
// still downloads fine, because a download is a top-level navigation and is
// not subject to media-src.
const mediaSrc = "'self' data: blob: https://*.supabase.co";

const cspHeader = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https: blob:",
  `media-src ${mediaSrc}`,
  `connect-src ${connectSrc}`,
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Content-Security-Policy",
    value: cspHeader,
  },
];

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : "standalone",
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
