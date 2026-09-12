"""Zero-config build and framework detector for arbitrary web repositories.

Inspects package manifests (package.json, lockfiles, etc.) to deduce
the web framework, package manager, build/start commands, and runtime port.
Synthesizes a minimal production-ready Dockerfile when one does not exist.

Also handles monorepo delegation patterns where the root package.json
delegates build/start to a subdirectory (e.g. `npm --prefix web run build`).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger("agent.projects.build_detection")


@dataclass
class ProjectConfig:
    framework: str  # nextjs, vite, cra, remix, astro, node, python, generic
    package_manager: str  # npm, pnpm, yarn, bun, pip
    build_command: str
    start_command: str
    port: int
    has_custom_dockerfile: bool = False
    dockerfile_content: str | None = None


_PREFIX_RE = re.compile(r"npm\s+--prefix\s+(\S+)")


def resolve_build_root(repo_dir: Path | str) -> Path:
    """Returns the actual directory to use as the Docker build context.

    Handles monorepo roots whose package.json delegates via
    ``npm --prefix <subdir> run build`` — a common pattern for repos that
    keep the web app in a subfolder (e.g. ``web/``). In that case the
    subfolder is returned so the Docker build context contains the real
    package.json, lockfiles, and source rather than the thin wrapper root.

    Falls back to ``repo_dir`` itself when no delegation is detected.
    """
    root = Path(repo_dir).resolve()
    pkg_path = root / "package.json"
    if not pkg_path.is_file():
        return root

    try:
        pkg: dict = json.loads(pkg_path.read_text(encoding="utf-8"))
    except Exception:
        return root

    scripts: dict = pkg.get("scripts", {})
    build_script: str = scripts.get("build", "")

    # Detect `npm --prefix <subdir> run build` delegation
    m = _PREFIX_RE.search(build_script)
    if m:
        subdir = root / m.group(1)
        if subdir.is_dir() and (subdir / "package.json").is_file():
            logger.debug(
                "Detected monorepo delegation: build context resolved to '%s' (from '%s')",
                subdir,
                root,
            )
            return subdir

    return root


def detect_project_config(repo_dir: Path | str) -> ProjectConfig:
    """Inspects a repository directory to deduce build/start configuration."""
    root = Path(repo_dir).resolve()
    has_dockerfile = (root / "Dockerfile").is_file()

    # 1. Check for Node/JS projects
    package_json_path = root / "package.json"
    if package_json_path.is_file():
        return _detect_node_project(root, package_json_path, has_dockerfile)

    # 2. Check for Python projects
    if (root / "pyproject.toml").is_file() or (root / "requirements.txt").is_file():
        return _detect_python_project(root, has_dockerfile)

    # Default fallback
    return ProjectConfig(
        framework="generic",
        package_manager="npm",
        build_command="npm run build",
        start_command="npm start",
        port=3000,
        has_custom_dockerfile=has_dockerfile,
        dockerfile_content=None if has_dockerfile else _synthesize_node_dockerfile("npm", "npm run build", "npm start", 3000),
    )


def _detect_node_project(root: Path, pkg_path: Path, has_dockerfile: bool) -> ProjectConfig:
    try:
        pkg_data: dict[str, Any] = json.loads(pkg_path.read_text(encoding="utf-8"))
    except Exception:
        pkg_data = {}

    scripts = pkg_data.get("scripts", {})
    deps = {**pkg_data.get("dependencies", {}), **pkg_data.get("devDependencies", {})}

    # Detect package manager
    pm = "npm"
    if (root / "pnpm-lock.yaml").is_file():
        pm = "pnpm"
    elif (root / "yarn.lock").is_file():
        pm = "yarn"
    elif (root / "bun.lockb").is_file() or (root / "bun.lock").is_file():
        pm = "bun"

    # Detect framework & defaults
    if "next" in deps:
        framework = "nextjs"
        port = 3000
        build_cmd = f"{pm} run build" if "build" in scripts else "npx next build"
        start_cmd = f"{pm} run start" if "start" in scripts else "npx next start"
    elif "vite" in deps:
        framework = "vite"
        port = 4173  # default vite preview port
        build_cmd = f"{pm} run build" if "build" in scripts else "npx vite build"
        start_cmd = f"{pm} run preview" if "preview" in scripts else "npx vite preview --host --port 4173"
    elif "react-scripts" in deps:
        framework = "cra"
        port = 3000
        build_cmd = f"{pm} run build" if "build" in scripts else "npx react-scripts build"
        start_cmd = "npx serve -s build -l 3000"
    elif "@remix-run/react" in deps:
        framework = "remix"
        port = 3000
        build_cmd = f"{pm} run build" if "build" in scripts else "npx remix build"
        start_cmd = f"{pm} run start" if "start" in scripts else "npx remix-serve ./build/index.js"
    elif "astro" in deps:
        framework = "astro"
        port = 4321
        build_cmd = f"{pm} run build" if "build" in scripts else "npx astro build"
        start_cmd = f"{pm} run preview" if "preview" in scripts else "npx astro preview --host"
    else:
        framework = "node"
        port = 3000
        build_cmd = f"{pm} run build" if "build" in scripts else "echo 'no build script'"
        start_cmd = f"{pm} run start" if "start" in scripts else "node index.js"

    dockerfile = None if has_dockerfile else _synthesize_node_dockerfile(pm, build_cmd, start_cmd, port)

    return ProjectConfig(
        framework=framework,
        package_manager=pm,
        build_command=build_cmd,
        start_command=start_cmd,
        port=port,
        has_custom_dockerfile=has_dockerfile,
        dockerfile_content=dockerfile,
    )


def _detect_python_project(root: Path, has_dockerfile: bool) -> ProjectConfig:
    port = 8000
    pm = "uv" if (root / "uv.lock").is_file() else "pip"
    build_cmd = "echo 'python ready'"
    start_cmd = "uvicorn main:app --host 0.0.0.0 --port 8000"

    dockerfile = None if has_dockerfile else _synthesize_python_dockerfile(pm, port)
    return ProjectConfig(
        framework="python",
        package_manager=pm,
        build_command=build_cmd,
        start_command=start_cmd,
        port=port,
        has_custom_dockerfile=has_dockerfile,
        dockerfile_content=dockerfile,
    )


def _synthesize_node_dockerfile(pm: str, build_cmd: str, start_cmd: str, port: int) -> str:
    """Synthesizes a minimal production Dockerfile for node web apps."""
    install_cmd = f"{pm} install --frozen-lockfile" if pm in ("pnpm", "yarn") else "npm ci"

    return f"""FROM node:20-alpine AS base
WORKDIR /app
ENV PORT={port}

# Install dependencies. NODE_ENV is deliberately NOT set to "production" here
# — that would make npm skip devDependencies, which commonly hold build-time
# tooling (e.g. @tailwindcss/postcss, TypeScript types) required by the build
# step below, causing "Cannot find module" failures.
COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lock* ./
RUN npm install -g pnpm yarn bun || true
RUN {install_cmd} || npm install

# Copy the rest of the source (app/pages, config, public assets, etc.) —
# without this, the build step below only sees package.json and fails with
# "Couldn't find any `pages` or `app` directory".
COPY . .

# Build. Deliberately NOT `|| true`: if the PR's code fails to build, the
# image build must fail so the pipeline reports a clear build-failure result
# instead of silently running browser journeys against stale/incomplete
# output from a prior successful layer.
RUN {build_cmd}

ENV NODE_ENV=production
EXPOSE {port}
CMD ["sh", "-c", "{start_cmd}"]
"""


def _synthesize_python_dockerfile(pm: str, port: int) -> str:
    return f"""FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PORT={port}

COPY requirements*.txt pyproject.toml* ./
RUN pip install --no-cache-dir -r requirements.txt || true
COPY . .

EXPOSE {port}
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "{port}"]
"""
