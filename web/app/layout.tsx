import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/lib/i18n";
import { OfflineIndicator } from "@/components/offline-indicator";
import { CookieConsent } from "@/components/cookie-consent";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "AutoQA — Autonomous PR Testing Engine & Quality Forensics",
    template: "%s | AutoQA",
  },
  description:
    "Autonomous pull request testing engine, visual regression forensics, and non-functional quality dimension analysis with predictive AI insights.",
  keywords: [
    "Autonomous QA",
    "PR Testing",
    "Playwright",
    "Synthetic Tests",
    "Non-functional Requirements",
    "Quality Dimensions",
    "Visual Regression",
  ],
  authors: [{ name: "AutoQA Team" }],
  creator: "AutoQA",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://autoqa.dev",
    title: "AutoQA — Autonomous PR Testing Engine & Quality Forensics",
    description:
      "Continuous autonomous verification for pull requests and live websites with per-path quality analysis and AI insights.",
    siteName: "AutoQA Platform",
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoQA — Autonomous PR Testing Engine",
    description: "Autonomous PR verification, forensic artifact packaging, and non-functional quality attributes.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "AutoQA Autonomous Verification Platform",
  operatingSystem: "Cloud / Linux / macOS",
  applicationCategory: "DeveloperApplication",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  description:
    "Autonomous PR testing, visual regression forensics, per-path quality dimensions, and AI insights engine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <I18nProvider>
          <OfflineIndicator />
          <TooltipProvider>
            {children}
            <Toaster />
          </TooltipProvider>
          <CookieConsent />
        </I18nProvider>
      </body>
    </html>
  );
}
