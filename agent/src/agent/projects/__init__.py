"""Projects package for multi-repo registration and build detection."""

from agent.projects.build_detection import ProjectConfig, detect_project_config

__all__ = ["ProjectConfig", "detect_project_config"]
