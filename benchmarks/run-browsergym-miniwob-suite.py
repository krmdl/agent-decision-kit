#!/usr/bin/env python3
"""Run a fixed MiniWoB smoke suite and preserve every episode, including failures."""
import argparse
import importlib.util
import json
import platform
import subprocess
import sys
import time
from pathlib import Path
from benchmark_records import attach_runtime_metadata, collect_runtime_metadata, sanitize_record

ROOT = Path(__file__).resolve().parents[1]
RUNNER = Path(__file__).with_name("run-browsergym-miniwob.py")
AGGREGATOR = Path(__file__).with_name("aggregate-browsergym.py")
BROWSERGYM_PACKAGE_COMMIT = "0a785fbed075224ae81ca9c1fe924f66050696fe"
DEFAULT_TASKS = [
    "click-test",
    "click-button",
    "click-link",
    "click-tab",
    "click-collapsible",
    "click-dialog",
    "click-menu",
    "click-checkboxes",
]


def load_aggregator():
    spec = importlib.util.spec_from_file_location("aggregate_browsergym", AGGREGATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the BrowserGym aggregation module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def suite_identity(records):
    modes = {record.get("runnerMode") for record in records if record.get("runnerMode")}
    if not modes:
        return "miniwob-runner-error-smoke", "runner-mode-unavailable"
    if len(modes) > 1:
        return "miniwob-mixed-smoke", "mixed-tool-integration"
    mode = next(iter(modes))
    names = {
        "bounded-visual-ocr-approval-smoke": "miniwob-visual-ocr-smoke",
        "bounded-multi-tool-integration-smoke": "miniwob-multi-tool-smoke",
        "bounded-repeated-browser-decide-and-act": "miniwob-smoke",
    }
    return names.get(mode, "miniwob-mixed-smoke"), mode


def attach_runner_diagnostics(record, return_code, stderr):
    record["runnerExitCode"] = return_code
    diagnostic = (stderr or "").strip()
    if return_code != 0 and diagnostic:
        record["runnerDiagnostic"] = diagnostic[-2_000:]
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--miniwob-root", required=True, type=Path, help="Path to miniwob-plusplus/miniwob/html/miniwob")
    parser.add_argument("--output", required=True, type=Path, help="Summary path; per-task episode JSON files are written beside it")
    parser.add_argument("--tasks", nargs="+", default=DEFAULT_TASKS, help="MiniWoB task IDs; defaults to the included 8-task smoke suite")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--max-actions", type=int, default=5)
    parser.add_argument("--timeout-seconds", type=int, default=120, help="Outer time limit per task process")
    parser.add_argument("--approve-synthetic-actions", action="store_true", help="Allow gated actions only when the runner confirms the exact local file:// task URL")
    parser.add_argument("--multi-tool", action="store_true", help="Run the explicit value extraction and local visual tool-integration smoke path")
    parser.add_argument("--visual-ocr-actions", action="store_true", help="In multi-tool mode, try an exact quoted visual target with local OCR and the mandatory approval gate")
    args = parser.parse_args()

    miniwob_root = args.miniwob_root.resolve()
    if not args.tasks or len(args.tasks) != len(set(args.tasks)):
        raise SystemExit("Supply at least one distinct MiniWoB task ID")
    missing = [task for task in args.tasks if not (miniwob_root / f"{task}.html").is_file()]
    if missing:
        raise SystemExit(f"MiniWoB task file(s) not found: {', '.join(missing)}")
    if args.timeout_seconds < 1:
        raise SystemExit("--timeout-seconds must be positive")
    if args.visual_ocr_actions and not args.multi_tool:
        raise SystemExit("--visual-ocr-actions requires --multi-tool")

    records = []
    episode_files = []
    suite_environment = collect_runtime_metadata(ROOT, browsergym_package_commit=BROWSERGYM_PACKAGE_COMMIT)
    for task in args.tasks:
        episode_path = args.output.parent / f"{args.output.stem}-{task}.json"
        episode_files.append(episode_path)
        command = [
            sys.executable, str(RUNNER),
            "--task", task,
            "--task-prompt", "",
            "--miniwob-root", str(miniwob_root),
            "--seed", str(args.seed),
            "--max-actions", str(args.max_actions),
            "--output", str(episode_path),
        ]
        if args.approve_synthetic_actions:
            command.append("--approve-synthetic-actions")
        if args.multi_tool:
            command.append("--multi-tool")
        if args.visual_ocr_actions:
            command.append("--visual-ocr-actions")

        start = time.perf_counter()
        try:
            completed = subprocess.run(
                command,
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=args.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            record = {
                "benchmark": "miniwob",
                "task": task,
                "success": False,
                "timeout": True,
                "failureReason": f"suite-runner-timeout-{args.timeout_seconds}s",
                "actions": 0,
                "latencyMs": args.timeout_seconds * 1000,
                "decisionStatus": "suite-timeout",
                "operatingSystem": platform.platform(),
                "pythonVersion": platform.python_version(),
                "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            record = attach_runtime_metadata(record, suite_environment)
            episode_path.parent.mkdir(parents=True, exist_ok=True)
            episode_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        else:
            if episode_path.is_file():
                record = json.loads(episode_path.read_text(encoding="utf-8"))
            else:
                error = completed.stderr.strip() or completed.stdout.strip() or f"runner-exit-{completed.returncode}-without-record"
                record = {
                    "benchmark": "miniwob",
                    "task": task,
                    "success": False,
                    "timeout": False,
                    "failureReason": error[-500:],
                    "actions": 0,
                    "latencyMs": round((time.perf_counter() - start) * 1000),
                    "decisionStatus": "runner-error",
                    "operatingSystem": platform.platform(),
                    "pythonVersion": platform.python_version(),
                    "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
                episode_path.parent.mkdir(parents=True, exist_ok=True)
                episode_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
            record = attach_runner_diagnostics(record, completed.returncode, completed.stderr)
            record = attach_runtime_metadata(record, suite_environment)
            episode_path.write_text(json.dumps(sanitize_record(record), indent=2) + "\n", encoding="utf-8")
        records.append(record)
        print(f"{task}: {'PASS' if record['success'] else 'FAIL'}; actions={record['actions']}; timeout={record.get('timeout', False)}; latencyMs={record['latencyMs']}")

    summary = load_aggregator().summarize(records)
    exercised_tools = sorted({tool for record in records for tool in record.get("toolCoverage", [])})
    supported_tools = {"browser_connect", "browser_decide_and_act", "browser_confirm", "browser_action", "browser_fill", "browser_select_option", "browser_set_range", "browser_visual_inspect", "browser_visual_text", "browser_visual_action"}
    suite_name, runner_mode = suite_identity(records)
    summary["suite"] = {
        "name": suite_name,
        "runnerMode": runner_mode,
        "agentDecisionKitCommit": suite_environment["agentDecisionKitCommit"],
        "toolCoverage": exercised_tools,
        "notExercisedTools": sorted(supported_tools - set(exercised_tools)),
        "limitation": "This is a curated integration harness, not a full autonomous agent or representative BrowserGym benchmark. In multi-tool mode, it extracts only explicit values from synthetic task instructions and selects exact visible options. The optional visual OCR path tries only an explicitly quoted link label, and its coordinate click is approved only for the exact local file:// task page.",
        "seed": args.seed,
        "maxActionsPerTask": args.max_actions,
        "timeoutSecondsPerTask": args.timeout_seconds,
        "syntheticApprovalsEnabled": args.approve_synthetic_actions,
        "visualOcrActionsEnabled": args.visual_ocr_actions,
        "miniwobRoot": str(miniwob_root),
        "episodeFiles": [str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path) for path in episode_files],
        "pythonVersion": platform.python_version(),
        "operatingSystem": platform.platform(),
    }
    summary["note"] += " The selected MiniWoB task set is a reproducible smoke suite, not a representative BrowserGym sample. It measures bounded tool integration, not a complete coding agent."
    summary = sanitize_record(summary)
    rendered = json.dumps(summary, indent=2) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("episodeCount", "successCount", "taskSuccessRate", "timeoutRate", "latencyMs", "agentActionLatencyMs", "decisionCallLatencyMs", "decisionLatencyPerEpisodeMs", "actions")}, indent=2))


if __name__ == "__main__":
    main()
