"""Ephemeral, read-only extraction of a path out of a running sandbox container.

Why this exists
---------------
Two things are true at the same time:

1. Source code under test must never be persisted on the host — no durable clone,
   no per-run worktree. It lives only inside the throwaway container.
2. Some static analysis is genuinely easier against a real local filesystem:
   ``agent.analyzer.dependency_graph`` and ``agent.projects.build_detection`` are
   written against ``pathlib.Path`` and walk directory trees recursively.

Rather than reimplementing those analyzers against a ``docker exec``-based
filesystem shim (slower, and a large surface area to get wrong), this module
streams the path out through ``docker cp ... -`` into a
``tempfile.TemporaryDirectory()`` that is deleted before the calling function
returns. The extracted tree is a read-only *view*: nothing is ever installed,
built, or executed against it. All execution happens via ``docker exec`` inside
the real container.

``docker cp <container>:<path> -`` writes a tar stream to stdout, which is piped
straight into ``tarfile`` — the archive is never materialised on disk as an
intermediate file, and the only bytes that touch the host are the extracted
contents of the short-lived temporary directory.
"""

from __future__ import annotations

import logging
import subprocess
import tarfile
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

logger = logging.getLogger("agent.sandbox.container_extract")


class ContainerExtractError(RuntimeError):
    """Raised when a path cannot be extracted out of the container."""


@contextmanager
def extract_container_path(
    container: str,
    remote_path: str = "/app",
    *,
    timeout: int = 300,
) -> Generator[Path, None, None]:
    """Stream ``remote_path`` out of ``container`` into a guaranteed-deleted temp dir.

    Yields the local ``Path`` of the extracted copy. The temporary directory is
    removed on context exit, including when the body raises.

    The yielded directory always exists for the duration of the ``with`` block
    but must not be retained beyond it — callers that need data past that point
    should copy the specific values they need, not the paths.
    """
    with tempfile.TemporaryDirectory(prefix="qa-extract-") as tmp:
        dest = Path(tmp)

        # `docker cp <container>:<path> -` emits a tar archive on stdout. `-L`
        # resolves symlinks so we don't extract dangling host-relative links.
        proc = subprocess.Popen(
            ["docker", "cp", "-L", f"{container}:{remote_path}", "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert proc.stdout is not None  # guaranteed by stdout=PIPE
        try:
            # r|* streams the archive rather than seeking, so it works on a pipe.
            with tarfile.open(fileobj=proc.stdout, mode="r|*") as tar:
                # filter="data" (PEP 706, Python 3.12+) rejects absolute paths,
                # parent-directory traversal, device nodes and other archive
                # attacks. The archive comes from a container running untrusted
                # PR code, so this filter is load-bearing, not decorative.
                tar.extractall(path=dest, filter="data")
        except tarfile.TarError as exc:
            stderr = b""
            if proc.stderr is not None:
                stderr = proc.stderr.read()
            raise ContainerExtractError(
                f"Failed to extract {remote_path} from {container}: {exc}. "
                f"docker cp stderr: {stderr.decode('utf-8', 'replace')[-1000:]}"
            ) from exc

        returncode = proc.wait(timeout=timeout)
        if returncode != 0:
            stderr = b""
            if proc.stderr is not None:
                stderr = proc.stderr.read()
            raise ContainerExtractError(
                f"docker cp of {remote_path} from {container} exited {returncode}: "
                f"{stderr.decode('utf-8', 'replace')[-1000:]}"
            )

        # `docker cp <container>:/app -` emits a tar whose single top-level entry
        # is the source basename (i.e. "app/"), not the contents directly. Unwrap
        # that one wrapper directory when present so callers get the directory's
        # contents, which is what DependencyGraph / resolve_build_root expect.
        # Guard on the basename so a genuine single-top-level-dir project
        # (e.g. /app containing only "packages/") is never unwrapped by mistake.
        entries = sorted(dest.iterdir())
        expected_wrapper = Path(remote_path).name
        if len(entries) == 1 and entries[0].is_dir() and entries[0].name == expected_wrapper:
            yielded = entries[0]
        else:
            yielded = dest

        logger.debug(
            "Extracted %s from container %s into ephemeral dir %s (%d top-level entries)",
            remote_path,
            container,
            yielded,
            len(entries),
        )
        yield yielded
