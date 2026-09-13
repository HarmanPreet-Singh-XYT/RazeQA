"""Redaction must be applied to persisted forensic data, not only to prompts.

Regression: `journey_artifacts` (DOM snapshot, network requests, response
headers, console output) was written to `runs.result` and object storage
verbatim, so an Authorization/Cookie header or a rendered test password
survived in the forensic record even though the LLM-facing prompts redacted it.
"""

from __future__ import annotations

from agent.credentials.redaction import REDACTED_LABEL, redact_data, redact_headers


def test_sensitive_headers_are_masked_wholesale():
    headers = {
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.qrstuvwx",
        "Cookie": "session=abc123def456",
        "Content-Type": "application/json",
    }
    redacted = redact_headers(headers)
    assert redacted["Authorization"] == REDACTED_LABEL
    assert redacted["Cookie"] == REDACTED_LABEL
    assert redacted["Content-Type"] == "application/json"


def test_redact_data_walks_nested_network_requests():
    payload = {
        "network_requests": [
            {
                "url": "https://api.example.com/checkout",
                "headers": {"Authorization": "Bearer supersecrettoken123456", "Accept": "*/*"},
            },
            {
                "url": "https://api.example.com/me?token=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "headers": {"Cookie": "sid=xyz"},
            },
        ]
    }
    result = redact_data(payload)
    first, second = result["network_requests"]
    assert first["headers"]["Authorization"] == REDACTED_LABEL
    assert first["headers"]["Accept"] == "*/*"
    assert second["headers"]["Cookie"] == REDACTED_LABEL
    # URL-embedded tokens are pattern-redacted as well.
    assert "ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" not in second["url"]


def test_redact_data_removes_known_test_password_from_dom():
    dom = "<input name='password' value='hunter2!'>"
    result = redact_data(dom, custom_secrets=["hunter2!"])
    assert "hunter2!" not in result
    assert REDACTED_LABEL in result


def test_redact_data_preserves_non_string_scalars():
    payload = {"duration_ms": 1420.0, "count": 3, "passed": True, "nothing": None}
    assert redact_data(payload) == payload
