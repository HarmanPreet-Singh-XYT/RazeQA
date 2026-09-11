"""Credential and Secret Redaction Utility (idea.md Section 3.3).

Sanitizes passwords, auth tokens, session cookies, Bearer tokens, and sensitive HTTP
headers before DOM snapshots, error traces, or remediation prompts are packaged or
shared with developers.
"""

from __future__ import annotations

import re

REDACTED_LABEL = "[REDACTED]"

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
