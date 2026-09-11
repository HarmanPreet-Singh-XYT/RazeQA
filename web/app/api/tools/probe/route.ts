import { NextRequest, NextResponse } from "next/server";
import tls from "node:tls";
import { validateExternalTarget, NetworkSafetyError } from "@/lib/network-safety";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";

export const runtime = "nodejs";

function inspectTls(host: string, port = 443): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: false,
        timeout: 6000,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          const cipher = socket.getCipher();
          const protocol = socket.getProtocol();
          const authorized = socket.authorized;
          const authorizationError = socket.authorizationError;
          socket.end();

          resolve({
            host,
            cert,
            cipher,
            protocol,
            authorized,
            authorizationError,
          });
        } catch (e) {
          socket.destroy();
          reject(e);
        }
      }
    );

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timed out"));
    });
  });
}

export async function POST(req: NextRequest) {
  // Rate limiting: 10 requests per minute
  const clientId = getClientIdentifier(req);
  const rateLimit = checkRateLimit("tools:probe", clientId, 10, 60_000);
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
    const { type, host, endpoint, origin, method, headers } = body;

    // 1. SSL/TLS Certificate Probing
    if (type === "ssl") {
      if (!host) {
        return NextResponse.json({ error: "Missing host parameter" }, { status: 400 });
      }

      let targetValidation;
      try {
        targetValidation = await validateExternalTarget(host, {
          allowedProtocols: ["https:"],
          allowedPorts: [443, 8443],
        });
      } catch (valErr: any) {
        const message = valErr instanceof NetworkSafetyError ? valErr.message : "Target validation failed";
        return NextResponse.json({ error: message }, { status: 400 });
      }

      try {
        const tlsData = await inspectTls(targetValidation.hostname, targetValidation.port);
        const cert = tlsData.cert || {};
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : null;
        const now = Date.now();
        const daysRemaining = validTo
          ? Math.round((validTo.getTime() - now) / (1000 * 60 * 60 * 24))
          : 0;

        const sanList = cert.subjectaltname
          ? cert.subjectaltname.split(", ").map((s: string) => s.replace("DNS:", ""))
          : [tlsData.host];

        return NextResponse.json({
          success: true,
          host: tlsData.host,
          status: daysRemaining > 0 ? "valid" : "expired",
          daysRemaining,
          issuer: cert.issuer
            ? `${cert.issuer.O || cert.issuer.CN || "Unknown CA"} (${cert.issuer.C || "Global"})`
            : "Unknown",
          subject: cert.subject?.CN || tlsData.host,
          validFrom: validFrom ? validFrom.toISOString() : null,
          validTo: validTo ? validTo.toISOString() : null,
          tlsVersion: tlsData.protocol || "TLS 1.3",
          cipherSuite: tlsData.cipher?.name || "TLS_AES_256_GCM_SHA384",
          san: sanList,
          fingerprintSha256: cert.fingerprint256 || "N/A",
          authorized: tlsData.authorized,
        });
      } catch {
        return NextResponse.json(
          { error: "SSL connection probe failed or timed out" },
          { status: 502 }
        );
      }
    }

    // 2. CORS Preflight Live Tester
    if (type === "cors") {
      const targetUrl = endpoint || host;
      if (!targetUrl) {
        return NextResponse.json({ error: "Missing endpoint URL parameter" }, { status: 400 });
      }

      let targetValidation;
      try {
        targetValidation = await validateExternalTarget(targetUrl, {
          allowedProtocols: ["http:", "https:"],
          allowedPorts: [80, 443, 8443],
        });
      } catch (valErr: any) {
        const message = valErr instanceof NetworkSafetyError ? valErr.message : "Target validation failed";
        return NextResponse.json({ error: message }, { status: 400 });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const resp = await fetch(targetValidation.url.toString(), {
          method: "OPTIONS",
          signal: controller.signal,
          headers: {
            Origin: origin || "https://example.com",
            "Access-Control-Request-Method": method || "POST",
            "Access-Control-Request-Headers": headers || "Content-Type, Authorization",
          },
        });
        clearTimeout(timeout);

        const allowOrigin = resp.headers.get("access-control-allow-origin");
        const allowMethods = resp.headers.get("access-control-allow-methods");
        const allowHeaders = resp.headers.get("access-control-allow-headers");
        const allowCredentials = resp.headers.get("access-control-allow-credentials");

        const passesOrigin = Boolean(allowOrigin && (allowOrigin === "*" || allowOrigin === origin));

        return NextResponse.json({
          success: true,
          status: resp.status,
          statusText: resp.statusText,
          passesOrigin,
          allowOrigin: allowOrigin || "(Not Returned)",
          allowMethods: allowMethods || "(Not Returned)",
          allowHeaders: allowHeaders || "(Not Returned)",
          allowCredentials: allowCredentials === "true",
          allHeaders: Object.fromEntries(resp.headers.entries()),
        });
      } catch {
        clearTimeout(timeout);
        return NextResponse.json(
          { error: "CORS preflight request failed or timed out" },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ error: "Unknown probe type" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

