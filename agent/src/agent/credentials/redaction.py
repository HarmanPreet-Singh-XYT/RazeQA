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

    # Redact Bearer tokens
    sanitized = BEARER_REGEX.sub(rf"\g<1>{REDACTED_LABEL}", sanitized)

    # Redact JWT tokens
    sanitized = JWT_REGEX.sub(REDACTED_LABEL, sanitized)

    # Redact GitHub tokens
    sanitized = GITHUB_TOKEN_REGEX.sub(REDACTED_LABEL, sanitized)

    # Redact Session cookies
    sanitized = SESSION_COOKIE_REGEX.sub(rf"\g<1>{REDACTED_LABEL}", sanitized)

    # Redact Authorization headers
    sanitized = AUTH_HEADER_REGEX.sub(rf"\g<1>{REDACTED_LABEL}", sanitized)

    # Redact Cookie headers
    sanitized = COOKIE_HEADER_REGEX.sub(rf"\g<1>{REDACTED_LABEL}", sanitized)

    # Redact HTML password input field values
    sanitized = HTML_PASSWORD_VALUE_REGEX.sub(rf"\g<1>\g<2>{REDACTED_LABEL}\g<4>", sanitized)
    sanitized = HTML_PASSWORD_VALUE_REGEX2.sub(rf"\g<1>\g<2>{REDACTED_LABEL}\g<4>\g<5>", sanitized)

    # Redact general key=value or key: value passwords
    sanitized = PASSWORD_REGEX.sub(rf"\g<1>{REDACTED_LABEL}\g<3>", sanitized)

    return sanitized
