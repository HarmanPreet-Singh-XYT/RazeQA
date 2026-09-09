"""CLI interface for Coding Agent Bridge (agent-bridge)."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

from agent.bridge.daemon import BridgeDaemon, get_git_branch, get_git_sha

DEFAULT_PLATFORM_URL = os.environ.get("PLATFORM_URL", "http://localhost:8000")
DEFAULT_DAEMON_URL = os.environ.get("BRIDGE_DAEMON_URL", "http://127.0.0.1:8765")


def cmd_daemon(args: argparse.Namespace) -> None:
    """Start local background daemon."""
    project_dir = Path(args.project_dir).resolve()
    print(f"Starting Coding Agent Bridge Daemon for project: {project_dir}")
    print(f"Connecting to platform: {args.platform_url}")
    print(f"Listening for coding agent hooks on: http://{args.host}:{args.port}")

    daemon = BridgeDaemon(
        project_dir=project_dir,
        platform_url=args.platform_url,
        local_host=args.host,
        local_port=args.port,
    )
    daemon.run()


def cmd_status(args: argparse.Namespace) -> None:
    """Query daemon status."""
    try:
        res = httpx.get(f"{args.daemon_url}/status", timeout=2.0)
        res.raise_for_status()
        data = res.json()
        print("=== Coding Agent Bridge Status ===")
        print(f"Project Dir:       {data.get('project_dir')}")
        print(f"Active Branch:     {data.get('branch')}")
        print(f"Current SHA:       {data.get('sha')}")
        print(f"Platform URL:      {data.get('platform_url')}")
        print(f"Connected to WS:   {'YES' if data.get('connected') else 'NO (offline/reconnecting)'}")
        print(f"Events Forwarded:  {data.get('events_forwarded')}")
        print(f"Events Dropped:    {data.get('events_dropped')}")
    except (httpx.HTTPError, OSError) as exc:
        # Fallback local git inspection if daemon not running
        cwd = Path.cwd()
        branch = get_git_branch(cwd)
        sha = get_git_sha(cwd)
        print("=== Coding Agent Bridge Status (Daemon Inactive) ===")
        print(f"Project Dir:       {cwd}")
        print(f"Active Branch:     {branch}")
        print(f"Current SHA:       {sha}")
        print(f"Daemon error:      {exc}")
        print(f"Platform URL:      {args.platform_url}")


def cmd_emit(args: argparse.Namespace) -> None:
    """Emit an intent event from a coding agent tool hook."""
    files = [f.strip() for f in args.files.split(",") if f.strip()] if args.files else []
    payload = {
        "files": files,
        "action": args.action,
        "prompt_summary": args.prompt,
        "reasoning": args.reasoning,
    }

    # 1. Try sending to local daemon
    try:
        res = httpx.post(f"{args.daemon_url}/event", json=payload, timeout=2.0)
        if res.status_code == 200:
            data = res.json()
            if data.get("sent"):
                print(f"[Bridge] Intent logged -> branch '{data.get('branch')}' ({len(files)} files)")
            else:
                print(f"[Bridge Warning] {data.get('warning')}")
            return
    except (httpx.HTTPError, OSError):
        pass

    # 2. Fallback: direct HTTP to platform if daemon not running
    try:
        cwd = Path.cwd()
        branch = get_git_branch(cwd)
        sha = get_git_sha(cwd)
        direct_payload = {
            **payload,
            "branch": branch,
            "sha": sha,
            "working_dir": str(cwd),
        }
        res = httpx.post(f"{args.platform_url}/bridge/events", json=direct_payload, timeout=3.0)
        res.raise_for_status()
        data = res.json()
        print(f"[Bridge Direct] Intent logged -> branch '{branch}' (count: {data.get('count')})")
    except (httpx.HTTPError, OSError) as exc:
        print(f"[Bridge Warning] Platform unreachable, event dropped (always-online v1): {exc}", file=sys.stderr)


def cmd_check(args: argparse.Namespace) -> None:
    """Trigger 'check this against the platform' from inside the coding agent."""
    cwd = Path.cwd()
    branch = args.branch or get_git_branch(cwd)
    sha = args.sha or get_git_sha(cwd)

    print(f"Checking against platform for branch '{branch}' (SHA: {sha[:8] if len(sha) >= 8 else sha}) ...")

    check_payload = {
        "branch": branch,
        "sha": sha,
        "scope": args.scope,
        "test_type": args.test_type,
    }

    # 1. Try via local daemon
    data: dict[str, Any] | None = None
    try:
        res = httpx.post(f"{args.daemon_url}/check", json=check_payload, timeout=10.0)
        if res.status_code == 200:
            data = res.json()
    except (httpx.HTTPError, OSError):
        pass

    # 2. Fallback directly to platform API
    if data is None:
        try:
            res = httpx.post(f"{args.platform_url}/runs", json=check_payload, timeout=10.0)
            res.raise_for_status()
            data = res.json()
        except (httpx.HTTPError, OSError) as exc:
            print(f"Error communicating with platform at {args.platform_url}: {exc}", file=sys.stderr)
            sys.exit(1)


    # Format result for coding agent
    status = data.get("status")
    run_id = data.get("run_id", "n/a")
    fresh = data.get("fresh", False)

    print()
    print("==================================================")
    print("      PR TESTING PLATFORM VERIFICATION")
    print("==================================================")
    print(f"Branch:      {branch}")
    print(f"Commit SHA:  {sha}")
    print(f"Run ID:      {run_id}")
    print(f"Status:      {status.upper() if status else 'UNKNOWN'}")
    print(f"Fresh:       {'Yes (New test queued)' if fresh else 'No (Freshness check deduped)'}")
    print(f"Message:     {data.get('message', '')}")

    if status == "cached":
        print("Note: Exact commit SHA already validated. Reusing cached test result.")
        if data.get("result"):
            print(f"Cached Result: {json.dumps(data['result'], indent=2)}")
    elif status in ("queued", "running"):
        print(f"Sandbox pipeline is executing for {run_id}. Trace & video will stream to artifacts.")
        if getattr(args, "wait", False):
            import time
            print(f"Waiting for run {run_id} to complete ...")
            deadline = time.monotonic() + 45.0
            while time.monotonic() < deadline:
                time.sleep(1.0)
                try:
                    poll_res = httpx.get(f"{args.platform_url}/runs/{run_id}", timeout=5.0)
                    if poll_res.status_code == 200:
                        data = poll_res.json()
                        status = data.get("status")
                        if status in ("completed", "failed", "cached"):
                            break
                except (httpx.HTTPError, OSError):
                    time.sleep(0.5)

            print(f"Final Status: {status.upper() if status else 'TIMEOUT'}")
            result = data.get("result") or {}
            if result:
                print(f"Risk Tag: {result.get('risk_tag')} Risk")
                print(f"Passed Journeys: {result.get('passed_journeys')}")
                print(f"Failed Journeys: {result.get('failed_journeys')}")
                if result.get("remediation_prompt"):
                    print("\n" + "=" * 50)
                    print("      REMEDIATION PROMPT FOR CODING AGENT")
                    print("=" * 50)
                    print(result["remediation_prompt"])
                    print("=" * 50)
    print("==================================================")


def main() -> None:
    parser = argparse.ArgumentParser(prog="agent-bridge", description="Coding Agent Bridge CLI")
    parser.add_argument("--platform-url", default=DEFAULT_PLATFORM_URL, help="PR Testing platform backend URL")
    parser.add_argument("--daemon-url", default=DEFAULT_DAEMON_URL, help="Local bridge daemon URL")

    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    # daemon
    p_daemon = subparsers.add_parser("daemon", help="Run the local bridge daemon")
    p_daemon.add_argument("--project-dir", default=".", help="Project directory to watch")
    p_daemon.add_argument("--host", default="127.0.0.1", help="Local daemon host")
    p_daemon.add_argument("--port", type=int, default=8765, help="Local daemon port")

    # status
    subparsers.add_parser("status", help="Get daemon and branch status")

    # emit
    p_emit = subparsers.add_parser("emit", help="Emit an intent event")
    p_emit.add_argument("--files", "-f", default="", help="Comma-separated files touched")
    p_emit.add_argument("--action", "-a", default="edit", choices=["edit", "create", "delete", "inspect"])
    p_emit.add_argument("--prompt", "-p", required=True, help="Compressed prompt summary")
    p_emit.add_argument("--reasoning", "-r", required=True, help="Agent reasoning / intent for change")

    # check
    p_check = subparsers.add_parser("check", help="Trigger on-demand check against platform")
    p_check.add_argument("--branch", help="Override git branch")
    p_check.add_argument("--sha", help="Override git commit SHA")
    p_check.add_argument("--scope", default="changed", choices=["changed", "full"])
    p_check.add_argument("--test-type", default="functional", choices=["functional", "functional+visual"])
    p_check.add_argument("--wait", action="store_true", help="Wait for pipeline execution to complete and show results")

    args = parser.parse_args()
    if args.subcommand == "daemon":
        cmd_daemon(args)
    elif args.subcommand == "status":
        cmd_status(args)
    elif args.subcommand == "emit":
        cmd_emit(args)
    elif args.subcommand == "check":
        cmd_check(args)


if __name__ == "__main__":
    main()
