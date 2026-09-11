# Autonomous PR Testing Engine — Python Agent & Testing Daemon Dockerfile
# Based on Python 3.12 with uv and headless Chromium Playwright browser.

FROM python:3.12-slim AS base

# Install uv from official binary image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Install system utilities, git (for sandbox worktree checkouts), and the
# Docker CLI (the engine shells out to `docker` to build/run/stop per-run
# sandbox containers via the host's Docker socket — see docker-compose.yml).
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ca-certificates \
    docker.io \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY pyproject.toml uv.lock ./

# Install python dependencies without the root project
RUN uv sync --frozen --no-install-project --no-dev

# Install Playwright browser and OS-level dependencies for Chromium
RUN uv run playwright install --with-deps chromium

# Copy application source and documentation
COPY src/ ./src/
COPY README.md ./

# Sync project package
RUN uv sync --frozen --no-dev

# Create directory for runtime traces, videos, and credentials
RUN mkdir -p /app/artifacts/runs /app/artifacts/video /app/artifacts/workspaces

# NOTE on privilege: this container is granted access to the host's Docker
# socket (docker-compose.yml mounts /var/run/docker.sock) so it can build and
# run per-PR sandbox containers directly on the host's Docker daemon.
# Socket access is inherently equivalent to root on the host regardless of
# the UID inside this container — a non-root USER here does not sandbox that
# access. Real isolation for this component requires either a rootless Docker
# daemon, a remote Docker-in-Docker host dedicated to this service, or
# swapping the shell-out-to-`docker` approach for a proper container
# orchestrator (e.g. Firecracker/gVisor-backed job runner) — tracked as a
# follow-up, not solved by chmod tricks in this Dockerfile.
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH"
ENV PORT=8000
ENV HOST=0.0.0.0
ENV PYTHONUNBUFFERED=1

EXPOSE 8000 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f "http://localhost:${PORT:-8000}/ping" || curl -f "http://localhost:${PORT:-8000}/health" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn agent.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
