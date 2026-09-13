"""mini-swe-agent Environment adapter that runs actions inside an existing container.

The upstream ``minisweagent.environments.docker.DockerEnvironment`` unconditionally
boots its *own* container in ``_start_container()`` and offers no attach-by-id
mode, so it cannot be pointed at the sandbox container the pipeline already
created and cloned the PR into. Subclassing it to skip that would mean
overriding essentially all of ``__init__``. This is therefore a small
repo-owned implementation of the same protocol.

The protocol surface used by the rest of the codebase is ``execute()`` plus
``_check_finished()`` (the ``COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`` sentinel),
``get_template_vars()`` and ``serialize()`` — matching
``minisweagent.environments.local.LocalEnvironment``.

Running actions via ``docker exec`` against the live sandbox container (rather
than against a host-side checkout) is what keeps source code from ever being
persisted on the host: the working tree exists only inside the container, which
is destroyed when the run ends.
"""

from __future__ import annotations

import logging
import os
import platform
import subprocess
from typing import Any

from minisweagent.exceptions import Submitted

logger = logging.getLogger("agent.sandbox.docker_exec_environment")

DEFAULT_EXEC_TIMEOUT = 60


class DockerExecEnvironment:
    """Runs commands inside an already-running container via ``docker exec``.

    Signature-compatible with ``minisweagent.environments.local.LocalEnvironment``
    as far as this codebase uses it (``execute``, ``_check_finished``,
    ``get_template_vars``, ``serialize``).
    """

    def __init__(
        self,
        container: str,
        cwd: str = "/app",
        *,
        timeout: int = DEFAULT_EXEC_TIMEOUT,
        env: dict[str, str] | None = None,
    ) -> None:
        if not container:
            raise ValueError("DockerExecEnvironment requires a container name/id")
        self.container = container
        self.cwd = cwd
        self.timeout = timeout
        # Only a minimal, non-secret set is forwarded: the container already has
        # its own environment (including test credentials injected at boot), and
        # passing the host env through would leak host variables into the sandbox.
        self.env = {"PAGER": "cat", "CI": "true", **(env or {})}

    def _docker_exec_argv(self, command: str, cwd: str) -> list[str]:
        argv = ["docker", "exec"]
        for key, value in self.env.items():
            argv += ["-e", f"{key}={value}"]
        argv += ["-w", cwd or self.cwd, self.container, "sh", "-c", command]
        return argv

    def execute(
        self,
        action: dict,
        cwd: str = "",
        *,
        timeout: int | None = None,
    ) -> dict[str, Any]:
        """Execute ``action['command']`` in the container and return a result dict."""
        command = action.get("command", "")
        workdir = cwd or self.cwd
        effective_timeout = timeout or self.timeout
        try:
            result = subprocess.run(
                self._docker_exec_argv(command, workdir),
                capture_output=True,
                text=True,
                timeout=effective_timeout,
            )
            output = {
                "output": result.stdout,
                "returncode": result.returncode,
                "exception_info": "",
            }
            if result.returncode != 0 and result.stderr:
                # Surface stderr to the agent — otherwise a failing command looks
                # like a silent empty success and the repair loop flails.
                output["output"] = result.stdout + result.stderr
        except subprocess.TimeoutExpired as exc:
            raw = exc.stdout or ""
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="replace")
            output = {
                "output": raw,
                "returncode": -1,
                "exception_info": f"Command timed out after {effective_timeout}s",
                "extra": {"exception_type": "TimeoutExpired", "exception": str(exc)},
            }
        except Exception as exc:  # noqa: BLE001
            output = {
                "output": "",
                "returncode": -1,
                "exception_info": f"An error occurred while executing the command: {exc}",
                "extra": {"exception_type": type(exc).__name__, "exception": str(exc)},
            }

        self._check_finished(output)
        return output

    def _check_finished(self, output: dict) -> None:
        """Raise ``Submitted`` when the agent signals task completion."""
        lines = output.get("output", "").lstrip().splitlines(keepends=True)
        if lines and lines[0].strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" and output["returncode"] == 0:
            submission = "".join(lines[1:])
            raise Submitted(
                {
                    "role": "exit",
                    "content": submission,
                    "extra": {"exit_status": "Submitted", "submission": submission},
                }
            )

    def get_template_vars(self, **kwargs: Any) -> dict[str, Any]:
        """Template variables exposed to mini-swe-agent prompts."""
        return {
            "cwd": self.cwd,
            "container": self.container,
            "timeout": self.timeout,
            **platform.uname()._asdict(),
            **os.environ,
            **kwargs,
        }

    def serialize(self) -> dict:
        """Serialisable description for trajectory records."""
        return {
            "info": {
                "config": {
                    "environment": {
                        "container": self.container,
                        "cwd": self.cwd,
                        "timeout": self.timeout,
                    },
                    "environment_type": f"{self.__class__.__module__}.{self.__class__.__name__}",
                }
            }
        }
