"""Autonomous PR Testing & QA Engine package."""

from agent.config import load_env

load_env()


def hello() -> str:
    return "Hello from agent!"

