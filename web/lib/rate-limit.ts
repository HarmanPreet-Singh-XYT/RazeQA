interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStores = new Map<string, Map<string, RateLimitRecord>>();

/**
 * Clean up expired rate limit entries periodically.
 */
function cleanupExpired(store: Map<string, RateLimitRecord>) {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (now > record.resetAt) {
      store.delete(key);
    }
  }
}

/**
 * Checks in-memory rate limit for a given namespace and key.
 *
 * @param namespace - Grouping identifier (e.g. "tools:scrape")
 * @param key - Client identifier (e.g. user ID or IP address)
 * @param maxRequests - Maximum allowed requests in window
 * @param windowMs - Time window in milliseconds
 */
export function checkRateLimit(
  namespace: string,
  key: string,
  maxRequests = 10,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetMs: number } {
  if (!rateLimitStores.has(namespace)) {
    rateLimitStores.set(namespace, new Map());
  }

  const store = rateLimitStores.get(namespace)!;
  const now = Date.now();

  // Periodic cleanup if store is getting large
  if (store.size > 1000) {
    cleanupExpired(store);
  }

  let record = store.get(key);

  if (!record || now > record.resetAt) {
    record = {
      count: 1,
      resetAt: now + windowMs,
    };
    store.set(key, record);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetMs: windowMs,
    };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, record.resetAt - now),
    };
  }

  record.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - record.count,
    resetMs: Math.max(0, record.resetAt - now),
  };
}

/**
 * Extracts a client identifier from Request headers (x-forwarded-for or fallback).
 */
export function getClientIdentifier(req: Request, fallback = "anonymous"): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return fallback;
}
