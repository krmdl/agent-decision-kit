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
            encoding="utf-8",
            errors="replace",
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


def browsergym_page_selection(page):
    browser = page.context.browser
    contexts = browser.contexts if browser is not None else [page.context]
    pages = [candidate for context in contexts for candidate in context.pages]
    for index, candidate in enumerate(pages):
        if candidate is page:
            return index, len(pages)
    raise RuntimeError("Could not identify BrowserGym's exact page in the CDP tab list")


def browsergym_target_id(page):
    session = page.context.new_cdp_session(page)
    try:
        target_info = session.send("Target.getTargetInfo").get("targetInfo", {})
        target_id = target_info.get("targetId")
        if not isinstance(target_id, str) or not target_id:
            raise RuntimeError("BrowserGym did not return a CDP target ID for its task page")
        return target_id
    finally:
        session.detach()


def print_debug_snapshot(phase, step, snapshot, include_page_content=False):
    url = urllib.parse.urlsplit(snapshot.get("url", ""))
    candidates = []
    for item in snapshot.get("candidates", [])[:40]:
        label = str(item.get("label", ""))
        candidates.append({
            "role": item.get("role"),
            "label": label[:100],
            "kind": item.get("kind"),
            "risk": item.get("risk"),
        })
    record = {
        "debugSnapshot": phase,
        "step": step,
        "title": snapshot.get("title"),
        "path": url.path,
        "headings": snapshot.get("headings", []),
        "candidates": candidates,
    }
    if include_page_content:
        record["textExcerpt"] = str(snapshot.get("textExcerpt", ""))[:2_000]
        record["tables"] = (snapshot.get("tables") or [])[:3]
    print(json.dumps(record, ensure_ascii=False), file=sys.stderr)


def print_debug_decision(step, result, retry_attempt=0):
    candidates = []
    for item in result.get("candidates", [])[:40]:
        candidates.append({
            "role": item.get("role"),
            "label": str(item.get("label", ""))[:100],
            "kind": item.get("kind"),
            "risk": item.get("risk"),
        })
    print(json.dumps({
        "debugDecision": step,
        "retryAttempt": retry_attempt,
        "status": result.get("status"),
        "provider": result.get("provider"),
        "model": result.get("model"),
        "decision": result.get("decision"),
        "selectedAction": result.get("action") or result.get("proposedAction"),
        "candidates": candidates,
    }, ensure_ascii=False), file=sys.stderr)


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
    parser.add_argument("--stale-page-retries", type=int, default=1, help="Re-inspect and request a fresh decision after a stale-snapshot response; capped at two retries")
    parser.add_argument("--debug-candidates", action="store_true", help="Print bounded visible candidates before and after every action to stderr")
    parser.add_argument("--debug-page-content", action="store_true", help="Include bounded visible text and table cells in debug output; this may contain page data")
    parser.add_argument("--debug-open-navigation", nargs="+", help="Debug only: follow exact visible low-risk link/menu labels, print the resulting snapshots, and exit without scoring")
    parser.add_argument("--debug-score-navigation", action="store_true", help="With --debug-open-navigation, ask BrowserGym for a diagnostic reward after the manual path; never writes a benchmark record")
    parser.add_argument("--output", type=Path, help="Optional JSON path for the sanitized episode record")
    args = parser.parse_args()
    if not 1 <= args.max_actions <= 20:
        raise SystemExit("--max-actions must be between 1 and 20")
    if not 0 <= args.stale_page_retries <= 2:
        raise SystemExit("--stale-page-retries must be between 0 and 2")
    if args.debug_open_navigation and not args.debug_candidates:
        raise SystemExit("--debug-open-navigation requires --debug-candidates")
    if args.debug_page_content and not args.debug_candidates:
        raise SystemExit("--debug-page-content requires --debug-candidates")
    if args.debug_score_navigation and not args.debug_open_navigation:
        raise SystemExit("--debug-score-navigation requires --debug-open-navigation")

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

        browsergym_page = env.unwrapped.page
        browsergym_page_index, browsergym_page_count = browsergym_page_selection(browsergym_page)
        selected_target_id = browsergym_target_id(browsergym_page)
        bridge = NodeBridge()
        connect = bridge.call("connect", endpoint=endpoint, targetId=selected_target_id)
        if not connect.get("connected"):
            raise RuntimeError(f"Could not attach to BrowserGym page: {connect}")

        initial_page = connect.get("page") or {}
        initial_url = urllib.parse.urlsplit(initial_page.get("url", ""))
        initial_location = (initial_url.path, initial_url.query)
        initial_title = initial_page.get("title", "")
        browsergym_initial_url = urllib.parse.urlsplit(browsergym_page.url)
        if browsergym_initial_url.path != initial_url.path:
            raise RuntimeError("The selected CDP tab does not match BrowserGym's exact task page")
        if initial_title != browsergym_page.title():
            raise RuntimeError("The selected CDP tab title does not match BrowserGym's exact task page")
        if args.debug_candidates:
            print(json.dumps({
                "debugBrowserGymPageSelection": {
                    "pageIndex": browsergym_page_index,
                    "pageCount": browsergym_page_count,
                    "title": browsergym_page.title(),
                    "path": browsergym_initial_url.path,
                },
            }, ensure_ascii=False), file=sys.stderr)

        if args.debug_open_navigation:
            for path_step, label in enumerate(args.debug_open_navigation, start=1):
                snapshot = bridge.call("inspect")
                matches = [
                    candidate for candidate in snapshot.get("candidates", [])
                    if candidate.get("role") in {"link", "menuitem"}
                    and str(candidate.get("label", "")).strip().casefold() == label.strip().casefold()
                ]
                if len(matches) != 1 or matches[0].get("risk") != "low":
                    raise RuntimeError(f"Debug navigation label must match exactly one visible low-risk link/menu item: {label}")
                result = bridge.call("act", ref=matches[0]["ref"])
                if result.get("status") != "action-executed":
                    raise RuntimeError("Debug navigation stopped because the requested menu action was not executed")
                print_debug_snapshot("debug-open-navigation", path_step, bridge.call("inspect"), args.debug_page_content)
            debug_result = {
                "debugNavigationInspection": "complete",
                "manualNavigationSteps": len(args.debug_open_navigation),
                "scored": False,
            }
            if args.debug_score_navigation:
                current_url = urllib.parse.urlsplit(env.unwrapped.page.url)
                moved = (current_url.path, current_url.query) != initial_location
                response_text = json.dumps({
                    "task_type": "NAVIGATE",
                    "status": "SUCCESS" if moved else "UNKNOWN_ERROR",
                    "retrieved_data": None,
                    "error_details": None,
                })
                _, debug_reward, _, _, _ = env.step(f"send_msg_to_user({json.dumps(response_text)})")
                debug_result.update({
                    "scored": True,
                    "reward": debug_reward,
                    "success": debug_reward >= 1.0,
                })
            print(json.dumps(debug_result), file=sys.stderr)
            return 0

        for step in range(1, args.max_actions + 1):
            retry_attempt = 0
            attempt_traces = []
            while True:
                if args.debug_candidates:
                    phase = "before" if retry_attempt == 0 else "stale-retry-before"
                    print_debug_snapshot(phase, step, bridge.call("inspect"), args.debug_page_content)
                decision_started = time.perf_counter()
                result = bridge.call("decide-and-act", task=task)
                elapsed_ms = round((time.perf_counter() - decision_started) * 1000)
                bridge_ms.append(elapsed_ms)
                browsergym_location = env.unwrapped.page.evaluate("window.location.href")
                same_page = bridge.call("matches-task-location", expectedUrl=browsergym_location)
                if not same_page.get("matches"):
                    raise RuntimeError(f"The decision bridge and BrowserGym no longer reference the same browser page: {same_page}")
                if args.debug_candidates:
                    print_debug_decision(step, result, retry_attempt)
                action = result.get("action") or result.get("proposedAction") or {}
                attempt_traces.append({
                    "step": step,
                    "retryAttempt": retry_attempt,
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
                    "taskTargetVisible": result.get("taskTargetVisible"),
                })
                if result.get("status") != "page-changed-during-decision" or retry_attempt >= args.stale_page_retries:
                    break
                retry_attempt += 1
                refreshed = bridge.call("inspect")
                if args.debug_candidates:
                    print_debug_snapshot("stale-retry-fresh", step, refreshed, args.debug_page_content)
            trace.extend(attempt_traces)
            if args.debug_candidates:
                print_debug_snapshot("after", step, bridge.call("inspect"), args.debug_page_content)
                browsergym_url = urllib.parse.urlsplit(env.unwrapped.page.url)
                print(json.dumps({
                    "debugBrowserGymPage": step,
                    "title": env.unwrapped.page.title(),
                    "path": browsergym_url.path,
                }, ensure_ascii=False), file=sys.stderr)
            if result.get("status") != "action-executed" or result.get("taskTargetVisible"):
                break

        final_page = bridge.call("inspect")
        final_url = urllib.parse.urlsplit(final_page.get("url", ""))
        browsergym_location = env.unwrapped.page.evaluate("window.location.href")
        same_page = bridge.call("matches-task-location", expectedUrl=browsergym_location)
        if not same_page.get("matches"):
            raise RuntimeError(f"The decision bridge and BrowserGym ended on different browser pages: {same_page}")
        browsergym_final_url = urllib.parse.urlsplit(browsergym_location)
        if final_url.path != browsergym_final_url.path:
            raise RuntimeError("The decision bridge and BrowserGym ended on different page paths")
        # The navigation response is evaluated independently by BrowserGym. No
        # dataset answer, expected URL, or evaluator configuration is read here.
        navigated = (browsergym_final_url.path, browsergym_final_url.query) != initial_location
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
            "runnerMode": "bounded-browser-decide-and-act-with-stale-retries",
            "seed": args.seed,
            "maxActions": args.max_actions,
            "maxStalePageRetries": args.stale_page_retries,
            "browserGymPageIndex": browsergym_page_index,
            "browserGymPageCount": browsergym_page_count,
            "success": reward >= 1.0,
            "reward": reward,
            "terminated": terminated,
            "actions": count_executed_actions(trace),
            "loopDetected": any(entry["status"] == "action-loop-detected" for entry in trace),
            "trace": trace,
            "initialPage": {"title": initial_title, "path": initial_location[0]},
            "finalPage": {"title": final_page.get("title", ""), "path": final_url.path},
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
