"""SSRF guard for externally-triggered runs.

``POST /runs/external`` takes a URL from a caller and drives a real headless
browser at it. Without a guard that is a server-side request forgery primitive:
a caller can point the engine at ``http://169.254.169.254/…`` (cloud instance
metadata), an internal admin panel, or anything else the engine host can reach
but the caller cannot.

This mirrors the dashboard's ``lib/network-safety.ts`` rules. The dashboard had
these checks; the engine — which is the process that actually opens the socket
and can carry cloud credentials — did not.

Residual risk: the address is validated once and then resolved again by the
browser, so a DNS-rebinding attacker can in principle answer differently the
second time. Pinning the resolved IP through the whole request is not possible
with Playwright's ``goto``, so the guard rejects the obvious cases and is
documented as defence in depth rather than a proof.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from urllib.parse import urlsplit

#: Hosts that must never be reached even if DNS resolves them publicly.
_BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "metadata",
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
}

_ALLOWED_SCHEMES = ("http", "https")


class UnsafeTargetError(ValueError):
    """Raised when a requested target must not be fetched by the engine."""


def _is_blocked_ip(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return True  # an unparseable address is not something we should dial
    # An IPv4-mapped IPv6 address (::ffff:127.0.0.1) must be judged on the
    # IPv4 it carries, or loopback slips through.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _allow_private_targets() -> bool:
    """Whether private/loopback targets are permitted.

    Off by default. A self-hosted operator who genuinely wants to verify an app
    on their own network can set ``ALLOW_PRIVATE_EXTERNAL_TARGETS=true``, which
    knowingly re-enables server-side request forgery from the engine host. It
    must never be enabled on a deployment that accepts targets from untrusted
    users.
    """
    return os.environ.get("ALLOW_PRIVATE_EXTERNAL_TARGETS", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _validate_syntax(url: str) -> tuple[str, str, int]:
    candidate = (url or "").strip()
    if not candidate:
        raise UnsafeTargetError("A target URL is required.")
    parts = urlsplit(candidate)
    if parts.scheme.lower() not in _ALLOWED_SCHEMES:
        raise UnsafeTargetError("Only http:// and https:// targets can be tested.")
    hostname = (parts.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        raise UnsafeTargetError("The target URL has no hostname.")
    if (
        hostname in _BLOCKED_HOSTNAMES
        or hostname.endswith(".localhost")
        or hostname.endswith(".local")
    ) and not _allow_private_targets():
        raise UnsafeTargetError("Targets on the local network cannot be tested.")
    port = parts.port or (443 if parts.scheme.lower() == "https" else 80)
    return candidate, hostname, port


async def validate_external_url(url: str) -> str:
    """Return the URL when it is safe to drive a browser at, else raise.

    Every address the hostname resolves to must be public; a single private
    answer rejects the target, so a split-horizon DNS record cannot smuggle one
    internal address past the check.
    """
    candidate, hostname, port = _validate_syntax(url)

    # Explicit, documented opt-out for self-hosted deployments that verify apps
    # on their own network. Never enabled by default.
    if _allow_private_targets():
        return candidate

    # A literal IP never needs DNS.
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None:
        if _is_blocked_ip(str(literal)):
            raise UnsafeTargetError("Targets on the private or link-local network cannot be tested.")
        return candidate

    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeTargetError(f"Could not resolve the target host: {exc}") from exc

    addresses = {info[4][0] for info in infos if info[4]}
    if not addresses:
        raise UnsafeTargetError("The target host did not resolve to any address.")
    for address in addresses:
        if _is_blocked_ip(address):
            raise UnsafeTargetError("Targets on the private or link-local network cannot be tested.")
    return candidate
