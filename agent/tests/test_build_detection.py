"""Tests for zero-config build detection and framework sniffing."""

from __future__ import annotations

import json
from pathlib import Path

from agent.projects.build_detection import detect_project_config


def test_detect_nextjs_project(tmp_path: Path) -> None:
    pkg = {
        "name": "my-next-app",
        "scripts": {"build": "next build", "start": "next start"},
        "dependencies": {"next": "14.2.0", "react": "18.3.0"},
    }
    (tmp_path / "package.json").write_text(json.dumps(pkg))
    (tmp_path / "pnpm-lock.yaml").write_text("")

    config = detect_project_config(tmp_path)
    assert config.framework == "nextjs"
    assert config.package_manager == "pnpm"
    assert config.port == 3000
    assert config.build_command == "pnpm run build"
    assert config.start_command == "pnpm run start"
    assert config.has_custom_dockerfile is False
    assert config.dockerfile_content is not None
    assert "pnpm" in config.dockerfile_content


def test_detect_vite_project(tmp_path: Path) -> None:
    pkg = {
        "name": "my-vite-app",
        "scripts": {"build": "vite build", "preview": "vite preview"},
        "devDependencies": {"vite": "5.0.0"},
    }
    (tmp_path / "package.json").write_text(json.dumps(pkg))

    config = detect_project_config(tmp_path)
    assert config.framework == "vite"
    assert config.package_manager == "npm"
    assert config.port == 4173
    assert config.build_command == "npm run build"
    assert config.start_command == "npm run preview"


def test_custom_dockerfile_priority(tmp_path: Path) -> None:
    (tmp_path / "Dockerfile").write_text("FROM alpine\n")
    pkg = {"name": "app", "dependencies": {"next": "14.0.0"}}
    (tmp_path / "package.json").write_text(json.dumps(pkg))

    config = detect_project_config(tmp_path)
    assert config.has_custom_dockerfile is True
    assert config.dockerfile_content is None
