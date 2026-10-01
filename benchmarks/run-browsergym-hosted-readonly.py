#!/usr/bin/env python3
"""Run one guarded, read-only task with BrowserGym's WebArena evaluator.

The operator supplies exactly one site's base URL. All other BrowserGym URL
variables point to that same endpoint because BrowserGym requires each one to
exist during setup. Only a single-site, explicit no-reset, URL-match task can
start, and the runner never calls the approval tool.
"""

from __future__ import annotations

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
from browsergym_readonly_scope import same_task_page, scoped_environment, select_read_only_task, validate_site_url


ROOT = Path(__file__).resolve().parents[1]
MARKER = "@@ADK_BROWSERGYM@@"
TASK_DATA = {
    "webarena": ("webarena", "test.raw.json"),
    "visualwebarena": ("visualwebarena", "test_raw.json"),
}


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
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
        self.next_id = 0

    def call(self, op, **fields):
        self.next_id += 1
        request_id = self.next_id
        self.process.stdin.write(json.dumps({"id": request_id, "op": op, **fields}) + "\n")
        self.process.stdin.flush()
        while True:
            line = self.process.stdout.readline()
            if not line:
                raise RuntimeError(f"Node bridge exited with code {self.process.poll()}")
            line = line.rstrip("\r\n")
            if not line.startswith(MARKER):
                if line:
                    print("[node] non-protocol output omitted", file=sys.stderr)
                continue
            response = json.loads(line[len(MARKER):])
            if response.get("id") != request_id:
                continue
            if response.get("error"):
                raise RuntimeError("BrowserManager bridge operation failed")
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


def free_loopback_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def load_task(suite: str, task_id: int, site: str) -> dict:
    package, filename = TASK_DATA[suite]
    configs = json.loads(importlib.resources.files(package).joinpath(filename).read_text())
    return select_read_only_task(configs, suite, task_id, site)


def goal_text(goal) -> str:
    if isinstance(goal, str):
        return goal.split("\n\n---\n", 1)[0].strip()
    if isinstance(goal, list):
        return "\n".join(
            str(block.get("text", ""))
            for block in goal
            if isinstance(block, dict)
            and block.get("type") == "text"
            and not str(block.get("text", "")).startswith("Input image ")
        ).strip()
    raise ValueError("BrowserGym returned an unsupported task goal")


def version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "not-reported"


def current_commit() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "not-reported"


def disable_visual_captioner_for_url_evaluator():
    """Avoid downloading BLIP2 for a task whose sole evaluator is URL matching.

    The replacement raises if an image-caption evaluator unexpectedly calls
    it, so the runner cannot silently award an incomplete visual-evaluator score.
    """
    from visualwebarena.evaluation_harness import image_utils

    def no_captioner(**_kwargs):
        def unexpected_caption_request(*_args, **_inner_kwargs):
            raise RuntimeError("URL-match-only VisualWebArena task requested an image caption")

        return unexpected_caption_request

    image_utils.get_captioning_fn = no_captioner


def make_record_base(args, task, *, started, reset_ms, call_ms, trace, browser_info, status):
    try:
        node_version = subprocess.run(
            ["node", "--version"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        node_version = "not-reported"

    return {
        "benchmark": f"browsergym-{args.suite}-single-site-readonly",
        "taskId": args.task_id,
        "intentTemplateId": task["intentTemplateId"],
        "taskType": task["taskType"],
        "taskPrompt": task["intent"],
        "site": args.site,
        "runnerMode": "bounded-browsergym-url-match-task",
        "canonicalBenchmark": False,
        "seed": args.seed,
        "maxActions": args.max_actions,
        "status": status,
        "actions": count_executed_actions(trace),
        "loopDetected": any(entry.get("status") == "action-loop-detected" for entry in trace),
        "trace": trace,
        "resetLatencyMs": reset_ms,
        "decisionCallLatenciesMs": call_ms,
        "latencyMs": round((time.perf_counter() - started) * 1000),
        "browserGymCoreVersion": version("browsergym-core"),
        "browserGymSuiteVersion": version(f"browsergym-{args.suite}"),
        "pythonPlaywrightVersion": version("playwright"),
        "nodePlaywrightVersion": json.loads((ROOT / "node_modules" / "playwright" / "package.json").read_text()).get("version", "not-reported"),
        "browserVersion": browser_info.get("Browser", "not-reported"),
        "pythonVersion": sys.version.split()[0],
        "nodeVersion": node_version,
        "agentDecisionKitCommit": current_commit(),
        "workingTreeModified": subprocess.run(["git", "diff", "--quiet"], cwd=ROOT).returncode != 0,
        "testedSourceFile": "src/browser/manager.ts",
        "operatingSystem": platform.platform(),
        "cpu": platform.processor() or "not reported by Python",
        "accelerator": "CPU",
        "configuredEndpoint": "redacted; see operator environment",
        "timestampUtc": datetime.now(timezone.utc).isoformat(),
        "note": "One selected single-site BrowserGym task using the official task definition and URL-match evaluator. The operator-supplied site is not independently authenticated as the canonical benchmark deployment; this is not a full-suite score, quality estimate, or speed claim. Reset tasks, non-URL evaluators, reference-image prompts, and approval-required actions are never accepted or auto-approved.",
    }


def write_record(record, output):
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(record, indent=2), flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", required=True, choices=tuple(TASK_DATA))
    parser.add_argument("--site", required=True, help="One site named by the selected BrowserGym task")
    parser.add_argument("--task-id", required=True, type=int, help="Only explicit no-reset URL-match tasks are accepted")
    parser.add_argument("--site-url", required=True, help="Base URL for the selected site; other required BrowserGym URLs are scoped to it")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--max-actions", type=int, default=8)
    parser.add_argument("--debug", action="store_true", help="Emit operation stages to stderr")
    parser.add_argument("--output", type=Path, help="Optional path for the sanitized episode record")
    args = parser.parse_args(argv)
    if not 1 <= args.max_actions <= 12:
        parser.error("--max-actions must be between 1 and 12")

    try:
        site_url = validate_site_url(args.site_url)
        task = load_task(args.suite, args.task_id, args.site)
        env_values = scoped_environment(args.suite, args.site, site_url)
    except (ValueError, ModuleNotFoundError, FileNotFoundError) as error:
        parser.error(str(error))

    os.environ.update(env_values)
    if args.suite == "webarena":
        os.environ["WA_FULL_RESET"] = ""
    else:
        os.environ["VWA_FULL_RESET"] = ""
        os.environ["ADK_VISUALWEB_ARENA_CAPTIONING"] = "disabled-url-match-only"

    debug = lambda message: print(f"[debug] {message}", file=sys.stderr, flush=True) if args.debug else None
    started = time.perf_counter()
    bridge = None
    env = None
    reset_ms = None
    call_ms = []
    trace = []
    browser_info = {}
    initial_page = {}
    final_page = {}
    reward = None
    terminated = False
    failure_stage = "BrowserGym package initialization"
    try:
        import gymnasium as gym
        import browsergym.core.env as browsergym_env

        if args.suite == "webarena":
            import browsergym.webarena  # noqa: F401 - registers the BrowserGym tasks
            gym_id = f"browsergym/webarena.{args.task_id}"
        else:
            import browsergym.visualwebarena  # noqa: F401 - registers the VisualWebArena tasks
            disable_visual_captioner_for_url_evaluator()
            gym_id = f"browsergym/visualwebarena.{args.task_id}"

        port = free_loopback_port()
        playwright = browsergym_env._get_global_playwright()
        original_launch = playwright.chromium.launch
        launch_count = 0

        def launch_with_loopback_debug_endpoint(*launch_args, **kwargs):
            nonlocal launch_count
            launch_count += 1
            if launch_count == 1:
                kwargs["args"] = [
                    *(kwargs.get("args") or []),
                    "--remote-debugging-address=127.0.0.1",
                    f"--remote-debugging-port={port}",
                ]
            return original_launch(*launch_args, **kwargs)

        playwright.chromium.launch = launch_with_loopback_debug_endpoint
        failure_stage = "BrowserGym environment creation"
        env = gym.make(gym_id, headless=True, pre_observation_delay=0.1)
        failure_stage = "BrowserGym reset"
        reset_started = time.perf_counter()
        debug("BrowserGym reset started")
        observation, _ = env.reset(seed=args.seed)
        reset_ms = round((time.perf_counter() - reset_started) * 1000)
        task_goal = goal_text(observation.get("goal"))
        if not task_goal:
            raise RuntimeError("BrowserGym returned an empty scoped task goal")
        debug(f"BrowserGym reset finished in {reset_ms} ms")

        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as response:
            browser_info = json.load(response)
        endpoint = browser_info["webSocketDebuggerUrl"]
        if urllib.parse.urlsplit(endpoint).hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise RuntimeError("BrowserGym returned a non-loopback CDP endpoint")

        bridge = NodeBridge()
        failure_stage = "BrowserManager CDP connection"
        connection = bridge.call("connect", endpoint=endpoint, pageIndex=0)
        if not connection.get("connected"):
            raise RuntimeError("BrowserManager could not attach to the BrowserGym task page")
        location_match = bridge.call("matches-task-location", expectedUrl=env.unwrapped.page.url)
        if not location_match.get("matches"):
            raise RuntimeError("The selected CDP tab is not BrowserGym's exact task page")
        initial_page = connection.get("page") or {}
        browsergym_url = urllib.parse.urlsplit(env.unwrapped.page.url)
        if not same_task_page(browsergym_url.geturl(), initial_page.get("url", "")):
            raise RuntimeError("The selected CDP tab is not BrowserGym's task page")
        initial_location = (browsergym_url.path, browsergym_url.query)

        reached_target = False
        for step in range(1, args.max_actions + 1):
            failure_stage = f"browser decision/action step {step}"
            debug(f"{failure_stage} started")
            decision_started = time.perf_counter()
            result = bridge.call("decide-and-act", task=task_goal)
            elapsed = round((time.perf_counter() - decision_started) * 1000)
            call_ms.append(elapsed)
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
                "elapsedMs": elapsed,
                "confidenceSource": result.get("confidenceSource"),
                "calibration": result.get("calibration"),
                "taskTargetVisible": result.get("taskTargetVisible"),
            })
            debug(f"{failure_stage} finished with status {result.get('status')}")
            reached_target = bool(result.get("taskTargetVisible"))
            # The runner deliberately stops at any confirmation request. It
            # never calls browser_confirm, even for a benchmark task.
            if result.get("status") != "action-executed" or reached_target or action.get("risk") not in (None, "low"):
                break

        failure_stage = "BrowserManager final inspection"
        final_page = bridge.call("inspect")
        final_url = urllib.parse.urlsplit(final_page.get("url", ""))
        task_final_url = urllib.parse.urlsplit(env.unwrapped.page.url)
        navigated = (task_final_url.path, task_final_url.query) != initial_location
        response_text = json.dumps({
            "task_type": "NAVIGATE",
            "status": "SUCCESS" if navigated else "UNKNOWN_ERROR",
            "retrieved_data": None,
            "error_details": None,
        })
        failure_stage = "BrowserGym URL-match evaluator"
        debug("Sending the final URL state to BrowserGym's evaluator")
        _, reward, terminated, _, _ = env.step(f"send_msg_to_user({json.dumps(response_text)})")
        record = make_record_base(
            args, task, started=started, reset_ms=reset_ms, call_ms=call_ms,
            trace=trace, browser_info=browser_info, status="scored",
        )
        record.update({
            "success": reward >= 1.0,
            "reward": reward,
            "terminated": terminated,
            "initialPage": {"title": initial_page.get("title", ""), "path": initial_location[0]},
            "finalPage": {"title": final_page.get("title", ""), "path": final_url.path},
        })
        if args.suite == "visualwebarena":
            record["captioningEvaluator"] = "unloaded; this URL-match task does not use screenshot-caption evaluation"
        write_record(record, args.output)
        return 0 if record["success"] else 1
    except Exception as error:
        error_code = "browser-inspection-timeout" if "inspection timed out" in str(error).lower() else "browser-operation-failed"
        record = make_record_base(
            args, task, started=started, reset_ms=reset_ms, call_ms=call_ms,
            trace=trace, browser_info=browser_info, status="runner-error",
        )
        record.update({
            "success": False,
            "reward": None,
            "errorType": type(error).__name__,
            "errorCode": error_code,
            "failureStage": failure_stage,
            "note": "The selected task stopped before BrowserGym returned a task reward. This is a runner or browser error, not a scored task failure. The configured endpoint, URL evaluator details, expected answers, and exception text are omitted.",
        })
        write_record(record, args.output)
        return 1
    finally:
        if bridge:
            bridge.close()
        if env is not None:
            try:
                env.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
