#!/usr/bin/env python3
"""Run one read-only WebArena Verified navigation task through Agent Decision Kit."""
import argparse
import importlib.metadata
import importlib.resources
import json
import os
import platform
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from benchmark_records import count_executed_actions

ROOT = Path(__file__).resolve().parents[1]
MARKER = "@@ADK_BROWSERGYM@@"


class NodeBridge:
    """Small JSON-lines client for the shared Playwright BrowserManager bridge."""

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
        self.next_id = 0

    def call(self, op, **fields):
        self.next_id += 1
        request_id = self.next_id
        request = {"id": request_id, "op": op, **fields}
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError(f"Node bridge exited with code {self.process.poll()}")
            line = line.rstrip("\r\n")
            if not line.startswith(MARKER):
                if line:
                    print(f"[node] {line}", file=sys.stderr)
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
                self.call("close")
                self.process.wait(timeout=5)
            except Exception:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def task_record(task_id):
    records = json.loads(
        importlib.resources.files("webarena_verified")
        .joinpath("assets/dataset/webarena-verified.json")
        .read_text()
    )
    matches = [item for item in records if item.get("task_id") == task_id]
    if len(matches) != 1:
        raise ValueError(f"Expected one WebArena Verified task with id {task_id}; found {len(matches)}")
    item = matches[0]
    evaluators = item.get("eval", [])
    task_type = evaluators[0].get("expected", {}).get("task_type") if evaluators else None
    if item.get("sites") != ["shopping_admin"] or task_type != "navigate":
        raise ValueError("This harness only runs read-only shopping_admin navigation tasks")
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", type=int, default=676, help="Read-only navigation task ID; mutate tasks are refused")
    parser.add_argument("--shopping-admin-url", required=True, help="WebArena Verified shopping_admin URL")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--max-actions", type=int, default=12)
    parser.add_argument("--debug-candidates", action="store_true", help="Print candidate labels to stderr when the decision is unresolved")
    parser.add_argument("--output", type=Path, help="Optional JSON path for the sanitized episode record")
    args = parser.parse_args()
    if not 1 <= args.max_actions <= 20:
        raise SystemExit("--max-actions must be between 1 and 20")

    service_url = urllib.parse.urlsplit(args.shopping_admin_url)
    if service_url.scheme not in {"http", "https"} or not service_url.netloc:
        raise SystemExit("--shopping-admin-url must be an absolute HTTP(S) URL")

    item = task_record(args.task_id)
    os.environ["WA_SHOPPING_ADMIN"] = args.shopping_admin_url.rstrip("/")
    for name in ("WA_SHOPPING", "WA_REDDIT", "WA_GITLAB", "WA_WIKIPEDIA", "WA_MAP", "WA_HOMEPAGE"):
        os.environ[name] = "todo"

    import gymnasium as gym
    import browsergym.core.env as browsergym_env
    import browsergym.webarena_verified as browsergym_webarena_verified
    from browsergym.webarena_verified import config as verified_config

    try:
        task_index = verified_config.TASK_IDS.index(args.task_id)
    except ValueError as error:
        raise SystemExit(f"Task {args.task_id} is not registered by BrowserGym") from error
    gym_id = "browsergym/" + browsergym_webarena_verified.ALL_WEBARENA_TASK_IDS[task_index]

    port = free_port()
    playwright = browsergym_env._get_global_playwright()
    original_launch = playwright.chromium.launch

    def launch_with_debug_endpoint(*launch_args, **kwargs):
        kwargs["args"] = [*(kwargs.get("args") or []), f"--remote-debugging-port={port}"]
        return original_launch(*launch_args, **kwargs)

    playwright.chromium.launch = launch_with_debug_endpoint
    env = gym.make(gym_id, headless=True, pre_observation_delay=0.1)
    bridge = None
    started = time.perf_counter()
    reset_ms = None
    bridge_ms = []
    trace = []
    browser_info = {}
    reward = 0.0
    terminated = False
    failure = None

    try:
        reset_started = time.perf_counter()
        observation, _ = env.reset(seed=args.seed)
        reset_ms = round((time.perf_counter() - reset_started) * 1000)
        task = observation["goal"].split("\n\n---\n", 1)[0]

        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as response:
            browser_info = json.load(response)
        endpoint = browser_info["webSocketDebuggerUrl"]
        if urllib.parse.urlsplit(endpoint).hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("BrowserGym returned a non-loopback CDP endpoint")

        bridge = NodeBridge()
        connect = bridge.call("connect", endpoint=endpoint, pageIndex=0)
        if not connect.get("connected"):
            raise RuntimeError(f"Could not attach to BrowserGym page: {connect}")

        initial_url = urllib.parse.urlsplit(env.unwrapped.page.url)
        initial_location = (initial_url.path, initial_url.query)
        initial_title = env.unwrapped.page.title()

        for step in range(1, args.max_actions + 1):
            decision_started = time.perf_counter()
            result = bridge.call("decide-and-act", task=task)
            elapsed_ms = round((time.perf_counter() - decision_started) * 1000)
            bridge_ms.append(elapsed_ms)
            if args.debug_candidates and result.get("status") != "action-executed":
                print(json.dumps({
                    "status": result.get("status"),
                    "candidates": [
                        {key: item.get(key) for key in ("role", "label", "kind", "risk")}
                        for item in result.get("candidates", [])
                    ],
                }, ensure_ascii=False), file=sys.stderr)
            action = result.get("action") or result.get("proposedAction") or {}
            trace.append({
                "step": step,
                "status": result.get("status"),
                "action": {key: action.get(key) for key in ("role", "label", "kind", "risk") if key in action},
                "candidateCount": result.get("candidateCount"),
                "provider": result.get("provider"),
                "model": result.get("model"),
                "selectionRule": result.get("selectionRule"),
                "decisionLatencyMs": result.get("decisionLatencyMs"),
                "elapsedMs": elapsed_ms,
                "confidenceSource": result.get("confidenceSource"),
                "calibration": result.get("calibration"),
            })
            if result.get("status") != "action-executed":
                break

        active_page = env.unwrapped.page
        final_url = urllib.parse.urlsplit(active_page.url)
        # The navigation response is evaluated independently by BrowserGym. No
        # dataset answer, expected URL, or evaluator configuration is read here.
        navigated = (final_url.path, final_url.query) != initial_location
        response_text = json.dumps({
            "task_type": "NAVIGATE",
            "status": "SUCCESS" if navigated else "UNKNOWN_ERROR",
            "retrieved_data": None,
            "error_details": None,
        })
        _, reward, terminated, _, _ = env.step(f"send_msg_to_user({json.dumps(response_text)})")

        try:
            browsergym_version = importlib.metadata.version("browsergym-core")
        except importlib.metadata.PackageNotFoundError:
            browsergym_version = "not-reported"
        try:
            browsergym_verified_version = importlib.metadata.version("browsergym-webarena-verified")
        except importlib.metadata.PackageNotFoundError:
            browsergym_verified_version = "not-reported"
        try:
            playwright_python_version = importlib.metadata.version("playwright")
        except importlib.metadata.PackageNotFoundError:
            playwright_python_version = "not-reported"
        playwright_node_version = json.loads((ROOT / "node_modules" / "playwright" / "package.json").read_text()).get("version", "not-reported")
        try:
            commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            commit = "not-reported"

        record = {
            "benchmark": "webarena-verified",
            "taskId": args.task_id,
            "intentTemplateId": item.get("intent_template_id"),
            "taskType": "navigate",
            "taskPrompt": item.get("intent"),
            "runnerMode": "bounded-repeated-browser-decide-and-act",
            "seed": args.seed,
            "maxActions": args.max_actions,
            "success": reward >= 1.0,
            "reward": reward,
            "terminated": terminated,
            "actions": count_executed_actions(trace),
            "loopDetected": any(entry["status"] == "action-loop-detected" for entry in trace),
            "trace": trace,
            "initialPage": {"title": initial_title, "path": initial_location[0]},
            "finalPage": {"title": active_page.title(), "path": final_url.path},
            "resetLatencyMs": reset_ms,
            "decisionCallLatenciesMs": bridge_ms,
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "browserGymVersion": browsergym_version,
            "browserGymVerifiedVersion": browsergym_verified_version,
            "playwrightPythonVersion": playwright_python_version,
            "playwrightNodeVersion": playwright_node_version,
            "browserVersion": browser_info.get("Browser", "not-reported"),
            "pythonVersion": sys.version.split()[0],
            "nodeVersion": subprocess.run(["node", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
            "agentDecisionKitCommit": commit,
            "workingTreeModified": subprocess.run(["git", "diff", "--quiet"], cwd=ROOT).returncode != 0,
            "testedSourceFile": "src/browser/manager.ts",
            "operatingSystem": platform.platform(),
            "cpu": platform.processor() or "not reported by Python",
            "accelerator": "CPU",
            "containerImage": "am1n3e/webarena-verified-shopping_admin:latest",
            "containerImageDigest": "sha256:d0531dd27ed98d0c459ff9e88118bf2ed8b660b0ed99c38837db46c065a5be13",
            "timestampUtc": datetime.now(timezone.utc).isoformat(),
            "note": "One read-only navigation integration smoke, not a representative WebArena score or a general quality/speed claim. Only navigation tasks are accepted; pending confirmations are never auto-approved. The harness omits evaluator internals and expected answers.",
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(record, indent=2))
        return 0 if record["success"] else 1
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
        print(failure, file=sys.stderr)
        return 1
    finally:
        if bridge:
            bridge.close()
        env.close()


if __name__ == "__main__":
    raise SystemExit(main())
