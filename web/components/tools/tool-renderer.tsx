"use client";

import React from "react";
import { ToolDefinition } from "@/lib/tools/tool-registry";
import {
  OpenGraphPreviewer,
  SchemaGenerator,
  SitemapGenerator,
  CanonicalHreflangBuilder,
  RedirectGenerator,
} from "./seo-tools";
import {
  CSPBuilder,
  JWTDebugger,
  CORSTester,
  HashGenerator,
  SSLChecker,
} from "./security-tools";
import {
  ClampCalculator,
  ContrastChecker,
  CSSGenerator,
  SVGOptimizer,
} from "./css-ui-tools";
import {
  JsonToTypesConverter,
  EncodingDecoding,
  FormatTranspiler,
  JSONVisualizer,
} from "./data-converters";
import {
  RegexTester,
  CronParser,
  CurlConverter,
  UUIDGenerator,
  CidrCalculator,
} from "./dev-networking-tools";

interface ToolRendererProps {
  tool: ToolDefinition;
}

export function ToolRenderer({ tool }: ToolRendererProps) {
  switch (tool.id) {
    // 1. SEO & Webmaster
    case "open-graph-previewer":
      return <OpenGraphPreviewer />;
    case "schema-generator":
      return <SchemaGenerator />;
    case "sitemap-generator":
      return <SitemapGenerator />;
    case "canonical-hreflang":
      return <CanonicalHreflangBuilder />;
    case "redirect-generator":
      return <RedirectGenerator />;

    // 2. Security & Auth
    case "csp-builder":
      return <CSPBuilder />;
    case "jwt-debugger":
      return <JWTDebugger />;
    case "cors-tester":
      return <CORSTester />;
    case "hash-generator":
      return <HashGenerator />;
    case "ssl-checker":
      return <SSLChecker />;

    // 3. CSS & UI
    case "clamp-calculator":
      return <ClampCalculator />;
    case "contrast-checker":
      return <ContrastChecker />;
    case "css-generator":
      return <CSSGenerator />;
    case "svg-optimizer":
      return <SVGOptimizer />;

    // 4. Data & Converters
    case "json-to-types":
      return <JsonToTypesConverter />;
    case "format-transpiler":
      return <FormatTranspiler />;
    case "encoding-decoding":
      return <EncodingDecoding />;
    case "json-inspector":
      return <JSONVisualizer />;

    // 5. Networking & Dev
    case "regex-tester":
      return <RegexTester />;
    case "cron-parser":
      return <CronParser />;
    case "curl-converter":
      return <CurlConverter />;
    case "uuid-generator":
      return <UUIDGenerator />;
    case "cidr-calculator":
      return <CidrCalculator />;

    default:
      return <OpenGraphPreviewer />;
  }
}
