#!/usr/bin/env python3
"""Run Agent Decision Kit on one BrowserGym MiniWoB task through Chrome CDP."""
import argparse
import importlib.metadata
import json
import os
import platform
import queue
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "@@ADK_BROWSERGYM@@"
MINIWOB_COMMIT = "7fd85d71a4b60325c6585396ec4f48377d049838"
BROWSERGYM_PACKAGE_COMMIT = "0a785fbed075224ae81ca9c1fe924f66050696fe"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class NodeBridge:
    def __init__(self):
        env = {**os.environ, "AGENT_DECISION_PROVIDER": "semantic"}
        self.process = subprocess.Popen(
            ["node", str(ROOT / "benchmarks" / "browsergym-bridge.mjs")],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )
        self.lines = queue.Queue()
        self.reader = threading.Thread(target=self._read_lines, daemon=True)
        self.reader.start()
        self.next_id = 0

    def _read_lines(self):
        for line in self.process.stdout:
            self.lines.put(line.rstrip("\r\n"))

    def call(self, op, timeout=300, **fields):
        self.next_id += 1
        request_id = self.next_id
        payload = json.dumps({"id": request_id, "op": op, **fields})
        self.process.stdin.write(payload + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"Node bridge did not answer '{op}' within {timeout}s")
            try:
                line = self.lines.get(timeout=remaining)
            except queue.Empty as error:
                raise TimeoutError(f"Node bridge did not answer '{op}' within {timeout}s") from error
            if not line.startswith(MARKER):
                if line:
                    print(f"[node] {line}", file=sys.stderr)
                if self.process.poll() is not None:
                    raise RuntimeError(f"Node bridge exited with code {self.process.returncode}")
                continue
            response = json.loads(line[len(MARKER):])
            if response.get("id") != request_id:
                continue
            if response.get("error"):
                raise RuntimeError(response["error"])
            return response.get("result")

    def close(self):
        if self.process.poll() is None:
            try:
                self.call("close", timeout=10)
            except Exception:
                self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", default="click-test", help="MiniWoB task ID without the browsergym/miniwob. prefix")
    parser.add_argument("--task-prompt", help="Instruction passed to the local decision provider; defaults to BrowserGym's task goal")
    parser.add_argument("--miniwob-root", required=True, type=Path, help="Path to miniwob-plusplus/miniwob/html/miniwob")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--approve-synthetic-actions", action="store_true", help="Confirm approval-gated actions only when the benchmark page uses a local file:// URL")
    parser.add_argument("--output", type=Path, help="Optional path for one raw JSON episode record")
    args = parser.parse_args()

    miniwob_root = args.miniwob_root.resolve()
    if not (miniwob_root / f"{args.task}.html").is_file():
        raise SystemExit(f"MiniWoB task file not found: {miniwob_root / f'{args.task}.html'}")

    import gymnasium as gym
    import browsergym.miniwob
    import browsergym.core.env as browsergym_env

    from urllib.parse import urlsplit
    port = free_port()
    base_url = miniwob_root.as_uri().rstrip("/") + "/"
    playwright = browsergym_env._get_global_playwright()
    original_launch = playwright.chromium.launch

    def launch_with_debug_endpoint(*launch_args, **kwargs):
        kwargs["args"] = [*(kwargs.get("args") or []), f"--remote-debugging-port={port}"]
        return original_launch(*launch_args, **kwargs)

    playwright.chromium.launch = launch_with_debug_endpoint
    env = gym.make(
        f"browsergym/miniwob.{args.task}",
        task_kwargs={"base_url": base_url},
        headless=True,
        pre_observation_delay=0.1,
    )
    bridge = None
    reset_start = time.perf_counter()
    try:
        observation, _ = env.reset(seed=args.seed)
        reset_latency_ms = round((time.perf_counter() - reset_start) * 1000)
        task = args.task_prompt or observation["goal"]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as response:
            browser_info = json.load(response)
        endpoint = browser_info["webSocketDebuggerUrl"]
        if urlsplit(endpoint).hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("BrowserGym returned a non-loopback CDP endpoint")

        bridge = NodeBridge()
        connection = bridge.call("connect", endpoint=endpoint, pageIndex=0)
        if not connection.get("connected"):
            raise RuntimeError(f"Could not attach to BrowserGym page: {connection}")
        playwright_node_version = bridge.call("versions")["playwright"]

        action_start = time.perf_counter()
        decision = bridge.call("decide-and-act", task=task)
        synthetic_approval_count = 0
        if decision.get("status") == "awaiting-user-approval" and args.approve_synthetic_actions:
            expected_url = base_url + f"{args.task}.html"
            if not base_url.startswith("file://") or env.unwrapped.page.url != expected_url:
                raise RuntimeError("Refusing benchmark auto-approval: the page is not the expected local MiniWoB file")
            decision = bridge.call("confirm", approvalToken=decision["approvalToken"], approve=True)
            synthetic_approval_count = 1
        action_latency_ms = round((time.perf_counter() - action_start) * 1000)
        reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
        episode_latency_ms = reset_latency_ms + action_latency_ms

        bridge.close()
        bridge = None
        browser_still_open = not env.unwrapped.page.is_closed()
        if not browser_still_open:
            raise RuntimeError("Closing the CDP connection closed BrowserGym's browser page")

        record = {
            "benchmark": "miniwob",
            "task": args.task,
            "success": bool(reward > 0),
            "actions": 1 if decision.get("status") in {"action-executed", "action-executed-after-approval"} else 0,
            "syntheticApprovalCount": synthetic_approval_count,
            "latencyMs": episode_latency_ms,
            "environmentResetLatencyMs": reset_latency_ms,
            "agentActionLatencyMs": action_latency_ms,
            "reward": reward,
            "terminated": bool(terminated),
            "decisionStatus": decision.get("status"),
            "decisionProvider": "semantic-local",
            "decisionModel": "Xenova/all-MiniLM-L6-v2",
            "browserGymVersion": importlib.metadata.version("browsergym-core"),
            "browserGymPackageCommit": BROWSERGYM_PACKAGE_COMMIT,
            "playwrightPythonVersion": importlib.metadata.version("playwright"),
            "playwrightNodeVersion": playwright_node_version,
            "browserVersion": browser_info.get("Browser", "not reported"),
            "pythonVersion": platform.python_version(),
            "nodeVersion": subprocess.run(["node", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "operatingSystem": platform.platform(),
            "cpu": platform.processor() or "not reported by Python",
            "accelerator": "CPU",
            "modelCacheState": "local cache already populated before this episode",
            "miniWobCommit": MINIWOB_COMMIT,
            "browserStillOpenAfterDisconnect": browser_still_open,
            "rawTaskInfo": task_info,
            "timestampUtc": datetime.now(timezone.utc).isoformat(),
            "note": "Single-task integration smoke check. Not a representative BrowserGym benchmark, model-quality estimate, or speed claim. Synthetic approvals are possible only for the exact local MiniWoB file URL.",
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(record, indent=2))
        if not record["success"]:
            raise SystemExit(1)
    finally:
        if bridge is not None:
            bridge.close()
        env.close()


if __name__ == "__main__":
    main()
