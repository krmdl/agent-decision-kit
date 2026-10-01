#!/usr/bin/env python3
"""Run one read-only BrowserGym WebArena Lite task on a compatible local backend.

The included backend adapter targets the synthetic WebArena Verified shopping
admin service. This is a cross-backend compatibility smoke, not a canonical
WebArena Lite benchmark result.
"""
import argparse
import importlib.metadata
import importlib.resources
import json
import os
import platform
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from benchmark_records import count_executed_actions
from webarena_lite_scope import select_read_only_task

ROOT = Path(__file__).resolve().parents[1]
MARKER = "@@ADK_BROWSERGYM@@"
DEFAULT_TASK_ID = 157
DEFAULT_IMAGE = "am1n3e/webarena-verified-shopping_admin"
DEFAULT_IMAGE_DIGEST = "sha256:d0531dd27ed98d0c459ff9e88118bf2ed8b660b0ed99c38837db46c065a5be13"
ADMIN_AUTH_HEADER = ("X-M2-Admin-Auto-Login", "admin:admin1234")


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


def load_task(task_id):
    configs = json.loads(
        importlib.resources.files("browsergym.webarenalite")
        .joinpath("test_webarena_lite.raw.json")
        .read_text()
    )
    return select_read_only_task(configs, task_id)


def validate_backend_url(raw_url):
    parsed = urllib.parse.urlsplit(raw_url)
    backend_path = parsed.path.rstrip("/")
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or backend_path not in {"", "/admin"}
    ):
        raise ValueError("--shopping-admin-url must be a loopback HTTP(S) origin, optionally ending in /admin")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, backend_path, "", ""))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", type=int, default=DEFAULT_TASK_ID, help="Only tasks passing the read-only scope filter are accepted")
    parser.add_argument("--shopping-admin-url", required=True, help="Loopback origin forwarded to synthetic shopping_admin; use /admin for the Verified backend")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--max-actions", type=int, default=8)
    parser.add_argument("--debug", action="store_true", help="Print runner and bridge operation progress to stderr")
    parser.add_argument("--output", type=Path, help="Optional JSON path for the sanitized episode record")
    parser.add_argument("--backend-image", default=DEFAULT_IMAGE)
    parser.add_argument("--backend-image-digest", default=DEFAULT_IMAGE_DIGEST)
    args = parser.parse_args()
    if not 1 <= args.max_actions <= 12:
        raise SystemExit("--max-actions must be between 1 and 12")
    try:
        backend_url = validate_backend_url(args.shopping_admin_url)
        task_info = load_task(args.task_id)
    except (ValueError, ModuleNotFoundError, FileNotFoundError) as error:
        raise SystemExit(str(error)) from error
    if args.debug:
        os.environ["ADK_BROWSERGYM_DEBUG"] = "1"

    def debug(message):
        if args.debug:
            print(f"[debug] {message}", file=sys.stderr, flush=True)

    os.environ["WA_SHOPPING_ADMIN"] = backend_url
    for name in ("WA_SHOPPING", "WA_REDDIT", "WA_GITLAB", "WA_WIKIPEDIA", "WA_MAP", "WA_HOMEPAGE"):
        os.environ[name] = "todo"

    header_file = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
    try:
        # Clear BrowserGym's context-wide headers. The synthetic auth header
        # is injected per request only for this exact loopback origin below.
        json.dump({}, header_file)
        header_file.close()
        os.environ["PW_EXTRA_HEADERS"] = header_file.name

        import gymnasium as gym
        import browsergym.core.env as browsergym_env
        import browsergym.webarenalite as browsergym_webarenalite
        from browsergym.webarena.instance import WebArenaInstance

        # This local compatibility backend authenticates from a synthetic
        # request header. Skip BrowserGym's interactive login form only for
        # shopping_admin; the task and its URL evaluator remain BrowserGym Lite.
        backend_parts = urllib.parse.urlsplit(backend_url)

        def verified_header_login(instance, site, page):
            if site != "shopping_admin":
                raise RuntimeError("Compatibility runner refused a non-shopping_admin login")
            page.context.set_extra_http_headers({})

            def scoped_admin_header(route):
                request_parts = urllib.parse.urlsplit(route.request.url)
                headers = route.request.all_headers()
                if (request_parts.scheme, request_parts.netloc) == (backend_parts.scheme, backend_parts.netloc):
                    headers[ADMIN_AUTH_HEADER[0]] = ADMIN_AUTH_HEADER[1]
                route.continue_(headers=headers)

            page.context.route("**/*", scoped_admin_header)

        WebArenaInstance.ui_login = verified_header_login
        try:
            task_index = browsergym_webarenalite.config.TASK_IDS.index(args.task_id)
        except ValueError as error:
            raise SystemExit(f"Task {args.task_id} is not registered by BrowserGym WebArena Lite") from error
        gym_id = "browsergym/" + browsergym_webarenalite.ALL_WEBARENA_TASK_IDS[task_index]

        port = free_port()
        playwright = browsergym_env._get_global_playwright()
        original_launch = playwright.chromium.launch
        launch_count = 0

        def launch_with_debug_endpoint(*launch_args, **kwargs):
            nonlocal launch_count
            launch_count += 1
            # BrowserGym launches the task page first, then a separate chat
            # window. Only the task page should expose the loopback CDP port.
            if launch_count == 1:
                kwargs["args"] = [
                    *(kwargs.get("args") or []),
                    "--remote-debugging-address=127.0.0.1",
                    f"--remote-debugging-port={port}",
                ]
            return original_launch(*launch_args, **kwargs)

        playwright.chromium.launch = launch_with_debug_endpoint
        env = gym.make(gym_id, headless=True, pre_observation_delay=0.1)
        bridge = None
        started = time.perf_counter()
        reset_ms = None
        bridge_ms = []
        trace = []
        browser_info = {}
        initial_page = {}
        failure_stage = "BrowserGym reset"
        reward = 0.0
        terminated = False
        try:
            reset_started = time.perf_counter()
            debug("BrowserGym reset started")
            observation, _ = env.reset(seed=args.seed)
            reset_ms = round((time.perf_counter() - reset_started) * 1000)
            debug(f"BrowserGym reset finished in {reset_ms} ms")
            task = observation["goal"].split("\n\n---\n", 1)[0]

            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as response:
                browser_info = json.load(response)
            endpoint = browser_info["webSocketDebuggerUrl"]
            if urllib.parse.urlsplit(endpoint).hostname not in {"127.0.0.1", "localhost", "::1"}:
                raise RuntimeError("BrowserGym returned a non-loopback CDP endpoint")

            bridge = NodeBridge()
            failure_stage = "CDP connection"
            debug("Connecting the Node bridge to the task page")
            connect = bridge.call("connect", endpoint=endpoint, pageIndex=0)
            if not connect.get("connected"):
                raise RuntimeError(f"Could not attach to BrowserGym page: {connect}")

            initial_page = connect.get("page") or {}
            initial_url = urllib.parse.urlsplit(initial_page.get("url", ""))
            initial_location = (initial_url.path, initial_url.query)
            browsergym_initial_url = urllib.parse.urlsplit(env.unwrapped.page.url)
            if browsergym_initial_url.path != initial_url.path:
                raise RuntimeError("The selected browser tab does not match BrowserGym's task page")

            for step in range(1, args.max_actions + 1):
                decision_started = time.perf_counter()
                failure_stage = f"browser decision/action step {step}"
                debug(f"Browser decision/action step {step} started")
                result = bridge.call("decide-and-act", task=task)
                call_ms = round((time.perf_counter() - decision_started) * 1000)
                debug(f"Browser decision/action step {step} finished in {call_ms} ms with status {result.get('status')}")
                bridge_ms.append(call_ms)
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
                    "elapsedMs": call_ms,
                    "confidenceSource": result.get("confidenceSource"),
                    "calibration": result.get("calibration"),
                    "taskTargetVisible": result.get("taskTargetVisible"),
                })
                if result.get("status") != "action-executed" or result.get("taskTargetVisible"):
                    break

            final_page = bridge.call("inspect")
            final_url = urllib.parse.urlsplit(final_page.get("url", ""))
            navigated = (final_url.path, final_url.query) != initial_location
            response_text = json.dumps({
                "task_type": "NAVIGATE",
                "status": "SUCCESS" if navigated else "UNKNOWN_ERROR",
                "retrieved_data": None,
                "error_details": None,
            })
            failure_stage = "BrowserGym URL evaluation"
            debug("Submitting the status message to BrowserGym's URL evaluator")
            _, reward, terminated, _, _ = env.step(f"send_msg_to_user({json.dumps(response_text)})")
            debug(f"BrowserGym evaluator returned reward {reward}")

            def version(package_name):
                try:
                    return importlib.metadata.version(package_name)
                except importlib.metadata.PackageNotFoundError:
                    return "not-reported"

            try:
                commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
            except (OSError, subprocess.CalledProcessError):
                commit = "not-reported"
            node_version = subprocess.run(["node", "--version"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
            record = {
                "benchmark": "browsergym-webarenalite-cross-backend-compat",
                "taskId": args.task_id,
                "intentTemplateId": task_info["intentTemplateId"],
                "taskType": "read-only-navigation",
                "taskPrompt": task_info["intent"],
                "runnerMode": "bounded-cross-backend-browsergym-lite-compatibility-smoke",
                "canonicalBenchmark": False,
                "seed": args.seed,
                "maxActions": args.max_actions,
                "success": reward >= 1.0,
                "reward": reward,
                "terminated": terminated,
                "actions": count_executed_actions(trace),
                "loopDetected": any(entry["status"] == "action-loop-detected" for entry in trace),
                "trace": trace,
                "initialPage": {"title": initial_page.get("title", ""), "path": initial_location[0]},
                "finalPage": {"title": final_page.get("title", ""), "path": final_url.path},
                "resetLatencyMs": reset_ms,
                "decisionCallLatenciesMs": bridge_ms,
                "latencyMs": round((time.perf_counter() - started) * 1000),
                "browserGymVersion": version("browsergym-core"),
                "browserGymLiteVersion": version("browsergym-webarenalite"),
                "playwrightPythonVersion": version("playwright"),
                "playwrightNodeVersion": json.loads((ROOT / "node_modules" / "playwright" / "package.json").read_text()).get("version", "not-reported"),
                "browserVersion": browser_info.get("Browser", "not-reported"),
                "pythonVersion": sys.version.split()[0],
                "nodeVersion": node_version,
                "agentDecisionKitCommit": commit,
                "workingTreeModified": subprocess.run(["git", "diff", "--quiet"], cwd=ROOT).returncode != 0,
                "testedSourceFile": "src/browser/manager.ts",
                "operatingSystem": platform.platform(),
                "cpu": platform.processor() or "not reported by Python",
                "accelerator": "CPU",
                "backendImage": args.backend_image,
                "backendImageDigest": args.backend_image_digest,
                "backendBaseUrl": backend_url,
                "timestampUtc": datetime.now(timezone.utc).isoformat(),
                "note": "One read-only BrowserGym WebArena Lite task on a synthetic WebArena Verified shopping_admin backend. The task and URL evaluator come from BrowserGym Lite, but this is a cross-backend compatibility smoke, not a canonical Lite environment, representative task sample, quality/speed claim, or aggregate benchmark score. Approval-required actions are never auto-approved. Expected evaluator URLs and reference answers are omitted.",
            }
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(record, indent=2), flush=True)
            return 0 if record["success"] else 1
        except Exception as error:
            try:
                commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
            except (OSError, subprocess.CalledProcessError):
                commit = "not-reported"
            failure_record = {
                "benchmark": "browsergym-webarenalite-cross-backend-compat",
                "taskId": args.task_id,
                "intentTemplateId": task_info["intentTemplateId"],
                "taskType": "read-only-navigation",
                "taskPrompt": task_info["intent"],
                "runnerMode": "bounded-cross-backend-browsergym-lite-compatibility-smoke",
                "canonicalBenchmark": False,
                "seed": args.seed,
                "maxActions": args.max_actions,
                "status": "runner-error",
                "success": False,
                "reward": None,
                "errorType": type(error).__name__,
                "errorCode": "browser-inspection-timeout" if "Browser page inspection timed out" in str(error) else "browser-operation-failed",
                "failureStage": failure_stage,
                "actions": count_executed_actions(trace),
                "trace": trace,
                "resetLatencyMs": reset_ms,
                "decisionCallLatenciesMs": bridge_ms,
                "latencyMs": round((time.perf_counter() - started) * 1000),
                "agentDecisionKitCommit": commit,
                "browserVersion": browser_info.get("Browser", "not-reported"),
                "pythonVersion": sys.version.split()[0],
                "accelerator": "CPU",
                "backendImage": args.backend_image,
                "backendImageDigest": args.backend_image_digest,
                "backendBaseUrl": backend_url,
                "timestampUtc": datetime.now(timezone.utc).isoformat(),
                "note": "The compatibility runner stopped before BrowserGym returned a task reward. This is a harness or browser operation error, not a scored task failure. Expected evaluator URLs and reference answers are omitted.",
            }
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(failure_record, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(failure_record, indent=2), flush=True)
            return 1
        finally:
            if bridge:
                bridge.close()
            env.close()
    finally:
        try:
            os.unlink(header_file.name)
        except FileNotFoundError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
