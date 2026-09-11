"""CLI interface for Coding Agent Bridge (agent-bridge)."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx

from agent.bridge.daemon import BridgeDaemon, get_git_branch, get_git_sha
from agent.config import load_env

load_env()

DEFAULT_PLATFORM_URL = os.environ.get("PLATFORM_URL", "http://localhost:8000")
DEFAULT_DAEMON_URL = os.environ.get("BRIDGE_DAEMON_URL", "http://127.0.0.1:8765")
AGENT_API_KEY = os.environ.get("AGENT_API_KEY")


def _platform_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {AGENT_API_KEY}"} if AGENT_API_KEY else {}


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
        res = httpx.post(
            f"{args.platform_url}/bridge/events",
            json=direct_payload,
            headers=_platform_headers(),
            timeout=3.0,
        )
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
            res = httpx.post(
                f"{args.platform_url}/runs",
                json=check_payload,
                headers=_platform_headers(),
                timeout=10.0,
            )
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
                    poll_res = httpx.get(
                        f"{args.platform_url}/runs/{run_id}",
                        headers=_platform_headers(),
                        timeout=5.0,
                    )
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

                suggested_fixes = result.get("suggested_fixes", [])
                if getattr(args, "autofix", False) and suggested_fixes:
                    print("\n[Bridge] Autonomous fix available! Inspecting patches...")
                    _apply_fixes_locally(suggested_fixes, auto_confirm=getattr(args, "yes", False))

    print("==================================================")


def _apply_fixes_locally(fixes: list[dict[str, Any]], auto_confirm: bool = False) -> bool:
    """Apply synthesized patches directly to local workspace files."""
    from agent.remediation.fix_synthesizer import FilePatch, apply_patch_to_text

    cwd = Path.cwd().resolve()
    success_all = True

    for f_dict in fixes:
        try:
            patch = FilePatch(**f_dict)
        except ValueError as exc:
            print(f"[Bridge Error] Skipping unsafe patch: {exc}")
            success_all = False
            continue

        target_path = (cwd / patch.file_path).resolve()
        web_target_path = (cwd / "web" / patch.file_path).resolve()
        if not target_path.exists() and web_target_path.exists():
            target_path = web_target_path

        # Defense in depth: FilePatch already rejects '..'/absolute paths,
        # but re-verify containment against the resolved cwd here since this
        # is the actual filesystem write site.
        if not (target_path.is_relative_to(cwd) or target_path.is_relative_to(cwd / "web")):
            print(f"[Bridge Error] Refusing to write outside workspace: {patch.file_path}")
            success_all = False
            continue

        if not target_path.exists():
            print(f"[Bridge Error] Target file not found locally: {patch.file_path}")
            success_all = False
            continue

        print(f"\n--- Proposed Patch for {patch.file_path} ---")
        print(patch.unified_diff if patch.unified_diff else f"+ {patch.replacement_snippet}")
        print(f"Explanation: {patch.explanation}")

        if not auto_confirm:
            try:
                ans = input(f"Apply this patch to {target_path.name}? [y/N]: ").strip().lower()
                if ans not in ("y", "yes"):
                    print("[Bridge] Patch skipped by user.")
                    continue
            except (EOFError, KeyboardInterrupt):
                print("\n[Bridge] Patch skipped.")
                return False

        try:
            content = target_path.read_text(encoding="utf-8")
            updated, ok = apply_patch_to_text(content, patch)
            if not ok:
                print(f"[Bridge Warning] Could not apply anchor-context patch to {target_path}. Target lines may have shifted.")
                success_all = False
                continue

            target_path.write_text(updated, encoding="utf-8")
            print(f"[Bridge ✅] Successfully patched {target_path.relative_to(cwd)}.")
        except Exception as exc:
            print(f"[Bridge Error] Failed to write patch to {target_path}: {exc}")
            success_all = False

    if success_all and fixes:
        print("\n[Bridge] All patches applied. You can run 'git diff' to inspect changes.")
    return success_all


def cmd_apply_fix(args: argparse.Namespace) -> None:
    """Fetch and apply suggested fixes for a specific run ID."""
    run_id = args.run_id
    print(f"Fetching verification results for run: {run_id} ...")
    try:
        res = httpx.get(
            f"{args.platform_url}/runs/{run_id}",
            headers=_platform_headers(),
            timeout=10.0,
        )
        res.raise_for_status()
        data = res.json()
    except (httpx.HTTPError, OSError) as exc:
        print(f"Error fetching run {run_id}: {exc}", file=sys.stderr)
        sys.exit(1)

    result = data.get("result") or {}
    fixes = result.get("suggested_fixes", [])
    if not fixes:
        print(f"No suggested fixes found for run {run_id}. Status: {data.get('status')}")
        return

    _apply_fixes_locally(fixes, auto_confirm=getattr(args, "yes", False))


def cmd_test_site(args: argparse.Namespace) -> None:
    """Test an external, staging, or non-GitHub website directly."""
    url = args.url.strip()
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    test_type = getattr(args, "test_type", "functional")
    routes = [r.strip() for r in args.routes.split(",") if r.strip()] if getattr(args, "routes", None) else ["/"]
    name = getattr(args, "name", None) or url.split("://")[-1].split("/")[0]

    print("==================================================")
    print("   AUTONOMOUS EXTERNAL SITE VERIFICATION")
    print("==================================================")
    print(f"Target URL: {url}")
    print(f"Test Type:  {test_type}")
    print(f"Routes:     {routes}")
    print("--------------------------------------------------")

    payload = {
        "url": url,
        "name": name,
        "test_type": test_type,
        "routes": routes,
        "wait": getattr(args, "wait", False),
    }

    try:
        res = httpx.post(
            f"{args.platform_url}/runs/external",
            json=payload,
            headers=_platform_headers(),
            timeout=180.0 if getattr(args, "wait", False) else 15.0,
        )
        res.raise_for_status()
        data = res.json()
    except (httpx.HTTPError, OSError) as exc:
        print(f"Error communicating with platform backend: {exc}", file=sys.stderr)
        sys.exit(1)

    run_id = data.get("run_id")
    print(f"External Run ID: {run_id}")
    print(f"Status:          {data.get('status')}")

    if getattr(args, "wait", False):
        if data.get("status") not in ("completed", "failed"):
            print("\nWaiting for Playwright browser execution, scroll inspection & video recording...")
            for _ in range(120):
                time.sleep(1.0)
                try:
                    poll = httpx.get(
                        f"{args.platform_url}/runs/{run_id}",
                        headers=_platform_headers(),
                        timeout=5.0,
                    )
                    if poll.status_code == 200:
                        data = poll.json()
                        if data.get("status") in ("completed", "failed"):
                            break
                except (httpx.HTTPError, OSError):
                    pass

        status = data.get("status", "unknown")
        result = data.get("result") or {}
        print("\n" + "=" * 50)
        print(f"  VERIFICATION RESULT: {status.upper()}")
        print("=" * 50)
        print(f"Summary: {result.get('summary', 'Run completed')}")
        print(f"Passed:  {result.get('passed_journeys', [])}")
        if result.get("failed_journeys"):
            print(f"Failed:  {result.get('failed_journeys')}")
        if result.get("additional_findings"):
            print("\nFindings:")
            for f in result["additional_findings"]:
                print(f"  • {f}")
        v_url = data.get("video_url") or result.get("video_url")
        t_url = data.get("trace_url") or result.get("trace_url")
        if v_url:
            print(f"Video Proof: {v_url}")
        if t_url:
            print(f"Trace Proof: {t_url}")
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
    p_check.add_argument("--autofix", action="store_true", help="Prompt to apply synthesized fixes to local workspace")
    p_check.add_argument("--yes", "-y", action="store_true", help="Auto-confirm applying patches")

    # apply-fix
    p_apply = subparsers.add_parser("apply-fix", help="Apply synthesized fix from a previous run to local workspace")
    p_apply.add_argument("run_id", help="Verification run ID")
    p_apply.add_argument("--yes", "-y", action="store_true", help="Auto-confirm applying patches")

    # test-site / test-url
    for sub_name in ("test-site", "test-url"):
        p_ext = subparsers.add_parser(sub_name, help="Test an external, staging, or non-GitHub website")
        p_ext.add_argument("url", help="URL of website to test (e.g. https://example.com)")
        p_ext.add_argument("--name", help="Friendly name/label for site")
        p_ext.add_argument("--test-type", default="functional", choices=["functional", "functional+visual"])
        p_ext.add_argument("--routes", help="Comma-separated paths or URLs to test (default: /)")
        p_ext.add_argument("--wait", action="store_true", help="Wait for browser execution to finish and print report")

    args = parser.parse_args()
    if args.subcommand == "daemon":
        cmd_daemon(args)
    elif args.subcommand == "status":
        cmd_status(args)
    elif args.subcommand == "emit":
        cmd_emit(args)
    elif args.subcommand == "check":
        cmd_check(args)
    elif args.subcommand == "apply-fix":
        cmd_apply_fix(args)
    elif args.subcommand in ("test-site", "test-url"):
        cmd_test_site(args)


if __name__ == "__main__":
    main()
