"""Credential and Secret Redaction Utility (idea.md Section 3.3).

Sanitizes passwords, auth tokens, session cookies, Bearer tokens, and sensitive HTTP
headers before DOM snapshots, error traces, or remediation prompts are packaged or
shared with developers.
"""

from __future__ import annotations

import re
from typing import Any

REDACTED_LABEL = "[REDACTED]"

#: Header names whose values are replaced wholesale rather than pattern-scanned.
SENSITIVE_HEADER_NAMES = {
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
    "x-csrf-token",
}

# Regex patterns for common credentials and sensitive tokens
PASSWORD_REGEX = re.compile(
    r"""(?i)(["']?(?:password|pass|pwd|secret|token|api_key|apikey)["']?\s*[:=]\s*["']?)([^"'\s,;]+)(["']?)"""
)
BEARER_REGEX = re.compile(r"""(?i)\b(Bearer\s+)[A-Za-z0-9_\-\.]{12,}\b""")
SESSION_COOKIE_REGEX = re.compile(r"""(?i)(session=)[A-Za-z0-9_\-\.%]{6,}""")
JWT_REGEX = re.compile(r"""\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b""")
GITHUB_TOKEN_REGEX = re.compile(r"""\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b""")
AUTH_HEADER_REGEX = re.compile(r"""(?i)(authorization:\s*)([^\r\n]+)""")
COOKIE_HEADER_REGEX = re.compile(r"""(?i)(cookie:\s*)([^\r\n]+)""")
HTML_PASSWORD_VALUE_REGEX = re.compile(
    r"""(?i)(<input[^>]*(?:name|id|type)=["']?(?:password|pass|pwd)["']?[^>]*value=)(["'])([^"']+)(["'])"""
)
HTML_PASSWORD_VALUE_REGEX2 = re.compile(
    r"""(?i)(<input[^>]*value=)(["'])([^"']+)(["'])([^>]*(?:name|id|type)=["']?(?:password|pass|pwd)["']?)"""
)

REDACTION_RULES: list[tuple[re.Pattern, str]] = [
    (BEARER_REGEX, rf"\g<1>{REDACTED_LABEL}"),
    (JWT_REGEX, REDACTED_LABEL),
    (GITHUB_TOKEN_REGEX, REDACTED_LABEL),
    (SESSION_COOKIE_REGEX, rf"\g<1>{REDACTED_LABEL}"),
    (AUTH_HEADER_REGEX, rf"\g<1>{REDACTED_LABEL}"),
    (COOKIE_HEADER_REGEX, rf"\g<1>{REDACTED_LABEL}"),
    (HTML_PASSWORD_VALUE_REGEX, rf"\g<1>\g<2>{REDACTED_LABEL}\g<4>"),
    (HTML_PASSWORD_VALUE_REGEX2, rf"\g<1>\g<2>{REDACTED_LABEL}\g<4>\g<5>"),
    (PASSWORD_REGEX, rf"\g<1>{REDACTED_LABEL}\g<3>"),
]

# Single source of truth for both detection counting and string sanitization
REDACTION_PATTERNS: list[re.Pattern] = [rule[0] for rule in REDACTION_RULES]


def redact_credentials(text: str, custom_secrets: list[str] | None = None) -> str:
    """Sanitize any sensitive credentials, tokens, or headers from a string."""
    if not text:
        return ""

    sanitized = text

    # Redact explicit custom secrets provided (e.g. test passwords, api keys)
    if custom_secrets:
        for secret in custom_secrets:
            if secret and len(secret) >= 4:
                sanitized = sanitized.replace(secret, REDACTED_LABEL)

    # Apply all unified redaction rules
    for pattern, replacement in REDACTION_RULES:
        sanitized = pattern.sub(replacement, sanitized)

    return sanitized


def redact_headers(headers: dict[str, Any] | None) -> dict[str, Any]:
    """Return a copy of an HTTP header map with credential-bearing headers masked."""
    if not headers:
        return {}
    out: dict[str, Any] = {}
    for name, value in headers.items():
        if isinstance(name, str) and name.lower() in SENSITIVE_HEADER_NAMES:
            out[name] = REDACTED_LABEL
        else:
            out[name] = value
    return out


def redact_data(value: Any, custom_secrets: list[str] | None = None) -> Any:
    """Recursively redact credentials from JSON-like structures.

    Applied *before persistence*: network request logs, response headers, DOM
    snapshots and console output were previously written to `runs.result` and
    object storage verbatim, so an Authorization/Cookie header or a test
    password in a rendered form survived in the forensic record.
    """
    if isinstance(value, str):
        return redact_credentials(value, custom_secrets=custom_secrets)
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            if isinstance(key, str) and key.lower() in SENSITIVE_HEADER_NAMES:
                redacted[key] = REDACTED_LABEL
            else:
                redacted[key] = redact_data(item, custom_secrets=custom_secrets)
        return redacted
    if isinstance(value, list):
        return [redact_data(item, custom_secrets=custom_secrets) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_data(item, custom_secrets=custom_secrets) for item in value)
    return value
