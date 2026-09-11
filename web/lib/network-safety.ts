import dns from "node:dns/promises";
import net from "node:net";

export class NetworkSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkSafetyError";
  }
}

/**
 * Checks if an IPv4 address is in a private, loopback, link-local, or reserved range.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0) return true;
  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private, loopback, link-local, or IPv4-mapped range.
 */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback ::1
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  // Unspecified ::
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
  // Unique local addresses fc00::/7 (fc00... or fd00...)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  // Link-local addresses fe80::/10
  if (
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  ) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  if (normalized.includes("::ffff:")) {
    const ipv4Part = normalized.split("::ffff:")[1];
    if (net.isIPv4(ipv4Part)) {
      return isPrivateIPv4(ipv4Part);
    }
    return true;
  }

  return false;
}

/**
 * Validates whether an IP address is a safe public IP.
 */
export function isSafePublicIP(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    return !isPrivateIPv4(ip);
  }
  if (family === 6) {
    return !isPrivateIPv6(ip);
  }
  return false;
}

export interface TargetValidationOptions {
  allowedProtocols?: string[];
  allowedPorts?: number[];
  allowSubdomains?: boolean;
}

/**
 * Validates a user-supplied URL or host against SSRF vulnerabilities:
 * - Checks scheme (http/https only)
 * - Checks for forbidden hostnames (localhost, internal, etc.)
 * - Resolves all DNS records and ensures none point to private/loopback/cloud-metadata IPs
 * - Enforces allowed ports
 */
export async function validateExternalTarget(
  input: string,
  options: TargetValidationOptions = {}
): Promise<{ url: URL; hostname: string; port: number }> {
  if (!input || typeof input !== "string") {
    throw new NetworkSafetyError("Missing or invalid target parameter");
  }

  const trimmed = input.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new NetworkSafetyError("Malformed URL format");
  }

  const allowedProtocols = options.allowedProtocols || ["http:", "https:"];
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    throw new NetworkSafetyError(`Unsupported protocol: ${parsedUrl.protocol}`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const defaultPort = parsedUrl.protocol === "https:" ? 443 : 80;
  const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : defaultPort;

  if (options.allowedPorts && !options.allowedPorts.includes(port)) {
    throw new NetworkSafetyError(`Port ${port} is not permitted`);
  }

  // Deny internal hostnames & domain patterns
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".lan")
  ) {
    throw new NetworkSafetyError("Access to internal/private targets is forbidden");
  }

  // Check if hostname is direct IP literal
  if (net.isIP(hostname)) {
    if (!isSafePublicIP(hostname)) {
      throw new NetworkSafetyError("Access to internal/private targets is forbidden");
    }
    return { url: parsedUrl, hostname, port };
  }

  // Resolve hostname via DNS to protect against DNS rebinding & private domain aliasing
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      throw new NetworkSafetyError("Could not resolve host");
    }

    for (const record of records) {
      if (!isSafePublicIP(record.address)) {
        throw new NetworkSafetyError("Access to internal/private targets is forbidden");
      }
    }
  } catch (err: any) {
    if (err instanceof NetworkSafetyError) throw err;
    throw new NetworkSafetyError("Failed to resolve target host");
  }

  return { url: parsedUrl, hostname, port };
}
