#!/usr/bin/env python3
"""Run Agent Decision Kit on one BrowserGym MiniWoB task through Chrome CDP."""
import argparse
import json
import os
import queue
import re
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from benchmark_records import collect_runtime_metadata, sanitize_record

ROOT = Path(__file__).resolve().parents[1]
MARKER = "@@ADK_BROWSERGYM@@"
MINIWOB_COMMIT = "7fd85d71a4b60325c6585396ec4f48377d049838"
BROWSERGYM_PACKAGE_COMMIT = "0a785fbed075224ae81ca9c1fe924f66050696fe"


def normalized(value):
    return re.sub(r"[^\w]+", " ", value.casefold()).strip()


def extract_visual_click_target(task):
    if not re.search(r"\bclick(?:\s+on)?\s+(?:the\s+)?link\b", task, re.IGNORECASE):
        return None
    match = re.search(r'"([^"\r\n]+)"|“([^”\r\n]+)”', task)
    target = (match.group(1) or match.group(2)).strip() if match else ""
    return target or None


def is_expected_local_task_url(current_url, base_url, task):
    return base_url.startswith("file://") and current_url == base_url + f"{task}.html"


def multi_tool_action(task, candidates, completed_fields, visible_text=""):
    """Extract only explicit MiniWoB task values for the tool integration smoke path."""
    radio_match = re.search(r"\b(?:check|select|choose|tick)\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)?\s+radio(?:\s+button)?\b", task, re.IGNORECASE)
    if radio_match:
        radios = [candidate for candidate in candidates if candidate.get("kind") == "radio" or candidate.get("role") in {"radio", "menuitemradio"}]
        ordinal = int(radio_match.group(1))
        if 1 <= ordinal <= len(radios):
            candidate = radios[ordinal - 1]
            if candidate.get("checked") is not True and field_key(candidate) not in completed_fields:
                return "act", {"ref": candidate["ref"]}, {"fieldKind": "radio", "fieldOrdinal": ordinal}

    date_match = re.search(r"\b(\d{1,2}/\d{1,2}/\d{4})\b", task)
    if date_match:
        try:
            parsed_date = datetime.strptime(date_match.group(1), "%m/%d/%Y")
        except ValueError:
            parsed_date = None
        if parsed_date:
            target_date = f"{parsed_date.strftime('%B')} {parsed_date.day}, {parsed_date.year}"
            date_controls = [item for item in candidates if item.get("role") in {"button", "link"} and field_key(item) not in completed_fields and normalized(target_date) in normalized(item["label"])]
            if len(date_controls) == 1:
                return "act", {"ref": date_controls[0]["ref"]}, {"fieldKind": "calendar-day", "dateMatch": "exact-visible-label"}
            target_month = parsed_date.strftime("%B %Y")
            if normalized(target_month) in normalized(visible_text):
                day_matches = [item for item in candidates if item.get("role") in {"button", "link"} and field_key(item) not in completed_fields and normalized(item["label"]) == str(parsed_date.day)]
                if len(day_matches) == 1:
                    return "act", {"ref": day_matches[0]["ref"]}, {"fieldKind": "calendar-day", "dateMatch": "visible-month-and-day"}
            candidate = next((item for item in candidates if item["kind"] in {"date", "text"} and item.get("role") in {"input", "textbox"} and field_key(item) not in completed_fields), None)
            if candidate:
                if candidate.get("readOnly"):
                    return "act", {"ref": candidate["ref"]}, {"fieldKind": "read-only-date-picker"}
                date_value = parsed_date.strftime("%Y-%m-%d") if candidate["kind"] == "date" else date_match.group(1)
                return "fill", {"ref": candidate["ref"], "text": date_value}, {"fieldKind": candidate["kind"], "characterCount": len(date_value)}

    list_match = re.search(r"\bselect\s+(.+?)\s+(?:from|in)\s+(?:the\s+)?(?:list|dropdown|menu)\b", task, re.IGNORECASE)
    if list_match:
        target = normalized(list_match.group(1))
        for candidate in candidates:
            if candidate["kind"] not in {"select-one", "select-multiple"} or field_key(candidate) in completed_fields:
                continue
            options_match = re.search(r"\bOptions:\s*(.*)$", candidate["label"])
            if not options_match:
                continue
            options = [option.strip() for option in options_match.group(1).split(",") if option.strip()]
            matches = [option for option in options if normalized(option) == target]
            if len(matches) == 1:
                return "select-option", {"ref": candidate["ref"], "optionLabel": matches[0]}, {"fieldKind": candidate["kind"]}

    quoted = [match.group(1) or match.group(2) for match in re.finditer(r'"([^"\r\n]+)"|“([^”\r\n]+)”', task)]
    target = next((value for value in quoted if value.strip()), None)
    if target:
        if re.search(r"\b(?:all\s+)?upper\s+case\b|\buppercase\b", task, re.IGNORECASE):
            target = target.upper()
        if not re.search(r"\b(?:type|enter|input|write|fill)\b", task, re.IGNORECASE):
            return None
        text_kinds = {"text", "search", "email", "tel", "url", "number", "textarea"}
        ordinal_match = re.search(r"\b(?:into|in)\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+(?:(?:input\s+)?(?:text\s*box|textbox|text\s+field))\b", task, re.IGNORECASE)
        if ordinal_match:
            fields = [item for item in candidates if item["kind"] in text_kinds and item.get("role") in {"input", "textbox", "textarea"} and not item.get("readOnly")]
            ordinal = int(ordinal_match.group(1))
            if not 1 <= ordinal <= len(fields):
                return None
            candidate = fields[ordinal - 1]
            if field_key(candidate) in completed_fields:
                if radio_match:
                    radios = [item for item in candidates if item.get("kind") == "radio" or item.get("role") in {"radio", "menuitemradio"}]
                    radio_ordinal = int(radio_match.group(1))
                    radio_is_checked = 1 <= radio_ordinal <= len(radios) and radios[radio_ordinal - 1].get("checked") is True
                    submit_controls = [
                        item for item in candidates
                        if item.get("kind") in {"submit", "button"}
                        and (item.get("kind") == "submit" or normalized(item.get("label", "").split("—", 1)[0]) == "submit")
                    ]
                    if radio_is_checked and len(submit_controls) == 1:
                        return "act", {"ref": submit_controls[0]["ref"]}, {"fieldKind": "submit-after-explicit-local-form-entry"}
                return None
            return "fill", {"ref": candidate["ref"], "text": target}, {"fieldKind": candidate["kind"], "characterCount": len(target), "fieldOrdinal": ordinal}
        candidate = next((item for item in candidates if item["kind"] in text_kinds and field_key(item) not in completed_fields), None)
        if candidate:
            return "fill", {"ref": candidate["ref"], "text": target}, {"fieldKind": candidate["kind"], "characterCount": len(target)}
    return None


def field_key(candidate):
    stable_label = re.split(r"\s*[—–]\s*Currently selected:", candidate["label"], maxsplit=1, flags=re.IGNORECASE)[0]
    if stable_label.casefold().startswith("currently selected:"):
        stable_label = ""
    stable_label = re.sub(r"\bOptions:\s*.*$", "", stable_label, flags=re.IGNORECASE)
    return f"{candidate['ref']}\0{candidate['kind']}\0{candidate.get('role', '')}\0{normalized(stable_label)}"


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
    parser.add_argument("--max-actions", type=int, default=5, help="Maximum BrowserManager decision/action rounds for this task")
    parser.add_argument("--approve-synthetic-actions", action="store_true", help="Confirm approval-gated actions only when the benchmark page uses a local file:// URL")
    parser.add_argument("--multi-tool", action="store_true", help="Exercise explicit text/date/select tool flows and optional local visual tools; this is a tool-integration harness, not an autonomous agent")
    parser.add_argument("--visual-ocr-actions", action="store_true", help="On visual-only pages, try only a quoted link target with local OCR and the mandatory approval gate")
    parser.add_argument("--output", type=Path, help="Optional path for one raw JSON episode record")
    args = parser.parse_args()
    if args.max_actions < 1 or args.max_actions > 20:
        raise SystemExit("--max-actions must be between 1 and 20")
    if args.visual_ocr_actions and not args.multi_tool:
        raise SystemExit("--visual-ocr-actions requires --multi-tool")

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
    episode_start = time.perf_counter()
    reset_start = time.perf_counter()
    reset_latency_ms = 0
    action_latency_ms = 0
    decision = {}
    decision_provider = "semantic-local"
    decision_model = None
    browser_info = {}
    playwright_node_version = "not-reported"
    node_version = "not-reported"
    decision_selection_rule = None
    selected_action = None
    decision_confidence = None
    decision_calibration = None
    candidate_count = None
    decision_latencies = []
    decision_trace = []
    tool_action_trace = []
    tool_coverage = {"browser_connect"}
    action_count = 0
    synthetic_approval_count = 0
    ocr_cache_dir = Path(os.environ.get("AGENT_DECISION_OCR_CACHE_DIR", Path.home() / ".agent-decision-kit" / "ocr-cache"))
    try:
        ocr_language_cache_existed = ocr_cache_dir.is_dir() and any("eng.traineddata" in path.name for path in ocr_cache_dir.rglob("*"))
    except OSError:
        ocr_language_cache_existed = None
    visual_ocr_used = False
    current_search_page = 1
    search_page_size = None
    attempted_search_results = set()
    task = args.task_prompt or ""
    record = None
    completed_fields = set()
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
        bridge_versions = bridge.call("versions")
        playwright_node_version = bridge_versions.get("playwright", "not-reported")
        node_version = bridge_versions.get("node", "not-reported")

        action_start = time.perf_counter()
        for step_index in range(args.max_actions):
            if args.multi_tool:
                inspected = bridge.call("inspect")
                planned = multi_tool_action(task, inspected.get("candidates", []), completed_fields, inspected.get("textExcerpt", ""))
                if planned:
                    operation, fields, metadata = planned
                    action_result = bridge.call(operation, **fields)
                    tool_name = {"select-option": "browser_select_option", "fill": "browser_fill", "act": "browser_action"}[operation]
                    tool_coverage.add(tool_name)
                    action_count += 1
                    synthetic_approval = False
                    if action_result.get("status") == "awaiting-user-approval":
                        if args.approve_synthetic_actions and is_expected_local_task_url(env.unwrapped.page.url, base_url, args.task):
                            action_result = bridge.call("confirm", approvalToken=action_result["approvalToken"], approve=True)
                            synthetic_approval = True
                            synthetic_approval_count += 1
                            tool_coverage.add("browser_confirm")
                    if operation in {"fill", "select-option", "act"}:
                        candidate = next(item for item in inspected["candidates"] if item["ref"] == fields["ref"])
                        completed_fields.add(field_key(candidate))
                    tool_action_trace.append({"step": step_index + 1, "tool": tool_name, "status": action_result.get("status"), "syntheticApproval": synthetic_approval, **metadata})
                    if action_result.get("status") == "awaiting-user-approval":
                        reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                        break
                    reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                    if reward > 0 or terminated:
                        break
                    continue

                links = [candidate for candidate in inspected.get("candidates", []) if candidate.get("role") == "link"]
                ordinal = re.search(r"\b(\d+)(?:st|nd|rd|th)\s+(?:search\s+)?result\b", task, re.IGNORECASE)
                result_links = [candidate for candidate in links if not candidate["label"].strip().isdigit() and candidate["label"].strip() not in {">", "›", "Next", "next"}]
                if ordinal and result_links:
                    target_ordinal = int(ordinal.group(1))
                    search_page_size = search_page_size or len(result_links)
                    target_page = (target_ordinal + search_page_size - 1) // search_page_size
                    if current_search_page < target_page:
                        page_link = next((candidate for candidate in links if candidate["label"].strip() == str(target_page)), None)
                        if page_link is None:
                            page_link = next((candidate for candidate in links if candidate["label"].strip() in {">", "›", "Next", "next"}), None)
                            if page_link:
                                current_search_page += 1
                        else:
                            current_search_page = target_page
                        if page_link is None:
                            break
                        action_result = bridge.call("act", ref=page_link["ref"])
                        tool_coverage.add("browser_action")
                        action_count += 1
                        tool_action_trace.append({"step": step_index + 1, "tool": "browser_action", "status": action_result.get("status"), "targetPage": current_search_page, "targetLabel": page_link["label"], "targetRole": "pagination-link"})
                        reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                        if reward > 0 or terminated:
                            break
                        continue

                    local_ordinal = target_ordinal - ((target_page - 1) * search_page_size)
                    if local_ordinal < 1 or local_ordinal > len(result_links):
                        break
                    result_key = (current_search_page, local_ordinal)
                    if result_key in attempted_search_results:
                        break
                    attempted_search_results.add(result_key)
                    target = result_links[local_ordinal - 1]
                    action_result = bridge.call("act", ref=target["ref"])
                    tool_coverage.add("browser_action")
                    action_count += 1
                    tool_action_trace.append({"step": step_index + 1, "tool": "browser_action", "status": action_result.get("status"), "targetOrdinal": target_ordinal, "targetRole": "link", "targetLabel": target["label"], "page": current_search_page, "pageOrdinal": local_ordinal, "visibleResultLabels": [candidate["label"] for candidate in result_links]})
                    if action_result.get("status") == "awaiting-user-approval":
                        if not args.approve_synthetic_actions or not is_expected_local_task_url(env.unwrapped.page.url, base_url, args.task):
                            break
                        action_result = bridge.call("confirm", approvalToken=action_result["approvalToken"], approve=True)
                        synthetic_approval_count += 1
                        tool_coverage.add("browser_confirm")
                    reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                    if reward > 0 or terminated:
                        break
                    continue

                if not inspected.get("candidates"):
                    visual_target = extract_visual_click_target(task) if args.visual_ocr_actions else None
                    if visual_target:
                        visual_ocr_used = True
                        ocr_result = bridge.call("visual-text", maxLines=40)
                        tool_coverage.add("browser_visual_text")
                        tool_action_trace.append({
                            "step": step_index + 1,
                            "tool": "browser_visual_text",
                            "status": ocr_result.get("status", "read"),
                            "engine": ocr_result.get("engine"),
                            "lineCount": len(ocr_result.get("lines", [])),
                            "latencyMs": ocr_result.get("latencyMs"),
                            "targetPresentInText": normalized(visual_target) in normalized(" ".join(line.get("text", "") for line in ocr_result.get("lines", []))),
                            "recognizedLines": [{"text": line.get("text", ""), "confidence": line.get("confidence")} for line in ocr_result.get("lines", [])],
                        })
                        proposed = bridge.call("visual-action", text=visual_target)
                        tool_coverage.add("browser_visual_action")
                        action_count += int(proposed.get("status") == "awaiting-user-approval")
                        decision = proposed
                        decision_provider = "local-ocr-exact-match"
                        decision_model = ocr_result.get("engine", "tesseract.js")
                        selected_action = proposed.get("proposedAction")
                        candidate_count = 0
                        proposal_trace = {
                            "step": step_index + 1,
                            "tool": "browser_visual_action",
                            "status": proposed.get("status"),
                            "requestedText": visual_target,
                            "proposedAction": proposed.get("proposedAction"),
                            "matchSource": proposed.get("proposedAction", {}).get("matchSource"),
                            "fallbackLatencyMs": proposed.get("proposedAction", {}).get("fallbackLatencyMs"),
                            "sparseTextFallback": proposed.get("sparseTextFallback"),
                        }
                        if proposed.get("status") == "awaiting-user-approval":
                            if args.approve_synthetic_actions and is_expected_local_task_url(env.unwrapped.page.url, base_url, args.task):
                                decision = bridge.call("confirm", approvalToken=proposed["approvalToken"], approve=True)
                                synthetic_approval_count += 1
                                tool_coverage.add("browser_confirm")
                                proposal_trace["executionStatus"] = decision.get("status")
                            else:
                                proposal_trace["executionStatus"] = "awaiting-explicit-local-benchmark-approval"
                        tool_action_trace.append(proposal_trace)
                        if proposed.get("status") == "awaiting-user-approval" and decision.get("status") != "action-executed-after-approval":
                            decision["status"] = proposal_trace["executionStatus"]
                        reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                        break

                    decision = bridge.call("visual-inspect", question=task)
                    decision_provider = decision.get("provider", decision_provider)
                    decision_model = decision.get("model", decision_model)
                    tool_coverage.add("browser_visual_inspect")
                    tool_action_trace.append({"step": step_index + 1, "tool": "browser_visual_inspect", "status": decision.get("status", "described"), "latencyMs": decision.get("latencyMs"), "descriptionReturned": bool(decision.get("description"))})
                    reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                    break

            decision = bridge.call("decide-and-act", task=task)
            tool_coverage.add("browser_decide_and_act")
            selected_action = decision.get("proposedAction") or decision.get("action")
            decision_provider = decision.get("provider", "semantic-local")
            decision_model = decision.get("model")
            decision_selection_rule = decision.get("selectionRule")
            decision_confidence = decision.get("confidence")
            decision_calibration = decision.get("calibration")
            step_decision_latency = decision.get("decisionLatencyMs")
            if isinstance(step_decision_latency, (int, float)) and decision_provider != "local-literal-match":
                decision_latencies.append(step_decision_latency)
            candidate_count = decision.get("candidateCount")
            trace_item = {
                "step": step_index + 1,
                "decisionStatus": decision.get("status"),
                "provider": decision_provider,
                "model": decision.get("model"),
                "selectionRule": decision_selection_rule,
                "selectedAction": selected_action,
                "availableCandidates": decision.get("candidateSnapshot", decision.get("candidates")),
                "decisionLatencyMs": step_decision_latency,
                "candidateCount": candidate_count,
                "confidence": decision_confidence,
                "calibration": decision_calibration,
            }
            decision_trace.append(trace_item)
            if decision.get("status") == "awaiting-user-approval":
                if not args.approve_synthetic_actions:
                    break
                if not is_expected_local_task_url(env.unwrapped.page.url, base_url, args.task):
                    raise RuntimeError("Refusing benchmark auto-approval: the page is not the expected local MiniWoB file")
                decision = bridge.call("confirm", approvalToken=decision["approvalToken"], approve=True)
                synthetic_approval_count += 1
                tool_coverage.add("browser_confirm")
            trace_item["executionStatus"] = decision.get("status")

            if decision.get("status") not in {"action-executed", "action-executed-after-approval"}:
                reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
                break

            action_count += 1
            reward, terminated, _, task_info = env.unwrapped.task.validate(env.unwrapped.page, env.unwrapped.chat.messages)
            if reward > 0 or terminated:
                break
        action_latency_ms = round((time.perf_counter() - action_start) * 1000)
        episode_latency_ms = reset_latency_ms + action_latency_ms

        bridge.close()
        bridge = None
        browser_still_open = not env.unwrapped.page.is_closed()
        if not browser_still_open:
            raise RuntimeError("Closing the CDP connection closed BrowserGym's browser page")

        record = {
            "benchmark": "miniwob",
            "task": args.task,
            "taskPrompt": task,
            "runnerMode": "bounded-visual-ocr-approval-smoke" if visual_ocr_used else ("bounded-multi-tool-integration-smoke" if args.multi_tool else "bounded-repeated-browser-decide-and-act"),
            "toolCoverage": sorted(tool_coverage),
            "notExercisedTools": sorted({"browser_connect", "browser_decide_and_act", "browser_confirm", "browser_action", "browser_fill", "browser_select_option", "browser_visual_inspect", "browser_visual_text", "browser_visual_action"} - tool_coverage),
            "toolActionTrace": tool_action_trace,
            "success": bool(reward > 0),
            "timeout": False,
            "failureReason": None if reward > 0 else (task_info.get("REWARD_REASON") or "task-goal-not-achieved"),
            "actions": action_count,
            "selectedAction": selected_action,
            "decisionConfidence": decision_confidence,
            "decisionCalibration": decision_calibration,
            "decisionLatencyMs": sum(decision_latencies),
            "decisionCallLatenciesMs": decision_latencies,
            "decisionSnapshot": decision.get("snapshot"),
            "availableCandidates": decision.get("candidates"),
            "decisionTrace": decision_trace,
            "candidateCount": candidate_count,
            "selectionRule": decision_selection_rule,
            "syntheticApprovalCount": synthetic_approval_count,
            "latencyMs": episode_latency_ms,
            "environmentResetLatencyMs": reset_latency_ms,
            "agentActionLatencyMs": action_latency_ms,
            "reward": reward,
            "terminated": bool(terminated),
            "decisionStatus": decision.get("status"),
            "decisionProvider": decision_provider,
            "decisionModel": decision_model or "not-reported",
            **collect_runtime_metadata(ROOT, browser_info=browser_info, playwright_node_version=playwright_node_version, node_version=node_version, browsergym_package_commit=BROWSERGYM_PACKAGE_COMMIT),
            "modelCacheState": ("not-used: the OCR visual path does not invoke the semantic model" if visual_ocr_used else "local cache already populated before this episode"),
            "ocrLanguageCacheExistedBeforeEpisode": ocr_language_cache_existed if visual_ocr_used else None,
            "decisionWarmState": ("first semantic provider inference in a fresh Node bridge process; model files are cached" if decision_latencies else "no semantic decision-provider inference occurred; explicit browser/OCR tools handled this episode" if visual_ocr_used else "no semantic decision-provider inference occurred; deterministic local rules and explicit tool calls handled the DOM path"),
            "miniWobCommit": MINIWOB_COMMIT,
            "browserStillOpenAfterDisconnect": browser_still_open,
            "rawTaskInfo": task_info,
            "timestampUtc": datetime.now(timezone.utc).isoformat(),
            "maxActions": args.max_actions,
            "note": "A curated MiniWoB integration smoke check, not a representative BrowserGym benchmark or a full autonomous agent. Multi-tool mode extracts only explicit task values and visible native options; field values are omitted from the raw record. The optional OCR path attempts only the quoted link target and its coordinate click remains behind the standard one-use approval gate; synthetic approval is possible only for the exact local MiniWoB file URL.",
            "visualOcrActionsEnabled": args.visual_ocr_actions,
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(sanitize_record(record), indent=2) + "\n", encoding="utf-8")
        print(json.dumps(sanitize_record(record), indent=2))
        if not record["success"]:
            raise SystemExit(1)
    except Exception as error:
        if record is None:
            message = str(error)
            timed_out = isinstance(error, TimeoutError) or "timeout" in message.lower()
            action_latency_ms = round((time.perf_counter() - episode_start) * 1000 - reset_latency_ms)
            record = {
                "benchmark": "miniwob",
                "task": args.task,
                "taskPrompt": task,
                "runnerMode": "bounded-visual-ocr-approval-smoke" if visual_ocr_used else ("bounded-multi-tool-integration-smoke" if args.multi_tool else "bounded-repeated-browser-decide-and-act"),
                "toolCoverage": sorted(tool_coverage),
                "notExercisedTools": sorted({"browser_connect", "browser_decide_and_act", "browser_confirm", "browser_action", "browser_fill", "browser_select_option", "browser_visual_inspect", "browser_visual_text", "browser_visual_action"} - tool_coverage),
                "toolActionTrace": tool_action_trace,
                "success": False,
                "timeout": timed_out,
                "failureReason": message[:500],
                "actions": action_count,
                "selectedAction": selected_action,
                "decisionConfidence": decision_confidence,
                "decisionCalibration": decision_calibration,
                "decisionLatencyMs": sum(decision_latencies),
                "decisionCallLatenciesMs": decision_latencies,
                "decisionSnapshot": decision.get("snapshot"),
                "availableCandidates": decision.get("candidates"),
                "decisionTrace": decision_trace,
                "candidateCount": candidate_count,
                "selectionRule": decision_selection_rule,
                "syntheticApprovalCount": synthetic_approval_count,
                "latencyMs": reset_latency_ms + action_latency_ms,
                "environmentResetLatencyMs": reset_latency_ms,
                "agentActionLatencyMs": action_latency_ms,
                "decisionStatus": decision.get("status", "error"),
                "decisionProvider": decision_provider,
                "decisionModel": decision_model or "not-reported",
                **collect_runtime_metadata(ROOT, browser_info=browser_info, playwright_node_version=playwright_node_version, node_version=node_version, browsergym_package_commit=BROWSERGYM_PACKAGE_COMMIT),
                "modelCacheState": "not-used: the OCR visual path does not invoke the semantic model" if visual_ocr_used else None,
                "ocrLanguageCacheExistedBeforeEpisode": ocr_language_cache_existed if visual_ocr_used else None,
                "decisionWarmState": "first semantic provider inference in a fresh Node bridge process; model files are cached" if decision_latencies else "no semantic decision-provider inference occurred; deterministic local rules and explicit tool calls handled the DOM path",
                "miniWobCommit": MINIWOB_COMMIT,
                "timestampUtc": datetime.now(timezone.utc).isoformat(),
                "visualOcrActionsEnabled": args.visual_ocr_actions,
                "note": "Failed episode record from the bounded BrowserGym integration runner, not a full autonomous agent. Timeout is detected from the harness deadline or a reported timeout; inspect failureReason for the source.",
            }
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(sanitize_record(record), indent=2) + "\n", encoding="utf-8")
            print(json.dumps(sanitize_record(record), indent=2))
        raise
    finally:
        if bridge is not None:
            bridge.close()
        env.close()


if __name__ == "__main__":
    main()
