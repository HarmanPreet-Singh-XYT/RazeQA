/**
 * Input sanitization, XSS defense, and prompt injection mitigation utilities.
 */

export function sanitizeHtml(input: string): string {
  if (!input) return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

export function maskSensitiveTokens(text: string): string {
  if (!text) return "";
  return text
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]{12,}/gi, "Bearer [REDACTED]")
    .replace(/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, "[GITHUB_TOKEN_REDACTED]")
    .replace(/session=[A-Za-z0-9_\-\.%]{6,}/gi, "session=[REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[JWT_REDACTED]");
}

export function validatePromptSafety(prompt: string): { safe: boolean; reason?: string } {
  if (!prompt || prompt.trim().length === 0) {
    return { safe: false, reason: "Prompt cannot be empty." };
  }
  if (prompt.length > 5000) {
    return { safe: false, reason: "Prompt exceeds maximum length threshold (5000 chars)." };
  }

  // Check for overt system prompt override attempts
  const lower = prompt.toLowerCase();
  if (
    lower.includes("ignore previous instructions") ||
    lower.includes("disregard all previous") ||
    lower.includes("system override")
  ) {
    return { safe: false, reason: "Input rejected: Potential instruction override pattern detected." };
  }

  return { safe: true };
}
