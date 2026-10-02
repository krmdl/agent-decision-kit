#!/usr/bin/env python3
"""Combine seeded BrowserGym suite summaries into a paired-comparison report."""
import argparse
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AGGREGATOR_PATH = Path(__file__).with_name("aggregate-browsergym.py")
SPEC = importlib.util.spec_from_file_location("aggregate_browsergym", AGGREGATOR_PATH)
AGGREGATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGGREGATOR)

ENVIRONMENT_FIELDS = (
    "operatingSystem",
    "cpu",
    "pythonVersion",
    "nodeVersion",
    "browserGymVersion",
    "browserGymPackageCommit",
    "playwrightPythonVersion",
    "playwrightNodeVersion",
    "browserVersion",
    "miniWobCommit",
)
CONFIGURATION_FIELDS = (
    "runnerMode",
    "maxActionsPerTask",
    "timeoutSecondsPerTask",
    "syntheticApprovalsEnabled",
    "visualOcrActionsEnabled",
)


def one_value(values, label):
    values = list(values)
    if not values or any(value != values[0] for value in values[1:]):
        raise ValueError(f"Suite reports have inconsistent {label}")
    return values[0]


def aggregate_suites(suite_reports, *, provider, requested_device, reported_accelerator=None):
    if not suite_reports:
        raise ValueError("Supply at least one BrowserGym suite summary")
    if not provider.strip() or not requested_device.strip():
        raise ValueError("Provider and requested device must be non-empty")

    records = []
    seeds = []
    task_sets = []
    configurations = []
    for path, report in suite_reports:
        suite = report.get("suite")
        episodes = report.get("rawRecords")
        if not isinstance(suite, dict) or not isinstance(episodes, list) or not episodes:
            raise ValueError(f"{path} must be a BrowserGym suite summary with rawRecords")
        seed = suite.get("seed")
        if not isinstance(seed, int) or isinstance(seed, bool):
            raise ValueError(f"{path} suite metadata must contain an integer seed")
        if seed in seeds:
            raise ValueError(f"Duplicate suite seed {seed}")
        seeds.append(seed)
        tasks = [record.get("task", record.get("taskId")) for record in episodes]
        if any(not isinstance(task, str) or not task for task in tasks) or len(set(tasks)) != len(tasks):
            raise ValueError(f"{path} contains missing or duplicate task records")
        task_sets.append(tuple(sorted(tasks)))
        configurations.append({field: suite.get(field) for field in CONFIGURATION_FIELDS})

        for record in episodes:
            existing_device = record.get("requestedDevice")
            if existing_device is not None and existing_device != requested_device:
                raise ValueError(f"{path} episode requestedDevice disagrees with --requested-device")
            existing_accelerator = record.get("reportedAccelerator")
            if reported_accelerator and existing_accelerator not in (None, reported_accelerator):
                raise ValueError(f"{path} episode reportedAccelerator disagrees with --reported-accelerator")
            record["runSeed"] = seed
            record["requestedDevice"] = requested_device
            if reported_accelerator:
                record["reportedAccelerator"] = reported_accelerator
            records.append(record)

    if any(tasks != task_sets[0] for tasks in task_sets[1:]):
        raise ValueError("Suite reports have different task sets")
    configuration = one_value(configurations, "run configuration")
    commits = {record.get("agentDecisionKitCommit") for record in records}
    if len(commits) != 1 or None in commits:
        raise ValueError("Episode records must report one shared source commit")
    source_commit = next(iter(commits))

    environment = {}
    for field in ENVIRONMENT_FIELDS:
        environment[field] = one_value((record.get(field) for record in records), field)
    reported_labels = [record.get("reportedAccelerator") for record in records]
    if reported_accelerator:
        environment["reportedAccelerator"] = reported_accelerator
    elif any(reported_labels):
        environment["reportedAccelerator"] = one_value(reported_labels, "reported accelerator")
    else:
        environment["reportedAccelerator"] = None
    working_tree_states = {record.get("workingTreeModified") for record in records}
    environment["trackedWorkingTreeModified"] = (
        next(iter(working_tree_states)) if len(working_tree_states) == 1 else "mixed-or-unreported"
    )

    task_set = list(task_sets[0])
    summary = AGGREGATOR.summarize(records)
    summary.update({
        "benchmarkName": "BrowserGym seeded provider/device comparison",
        "sourceCommit": source_commit,
        "decisionProviderCondition": f"{provider} / {requested_device} requested",
        "provider": provider,
        "requestedDevice": requested_device,
        "reportedAccelerator": reported_accelerator or environment["reportedAccelerator"],
        "taskSet": task_set,
        "runSeeds": sorted(seeds),
        "environment": environment,
        "configuration": configuration,
        "decisionDeviceNote": "requested device is recorded per episode; browser-task per-node execution providers were not profiled by this suite",
    })
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("suite_reports", nargs="+", type=Path, help="Seeded BrowserGym suite summary JSON files")
    parser.add_argument("--provider", required=True, help="Decision provider, such as semantic-nli")
    parser.add_argument("--requested-device", required=True, help="Device value used for AGENT_DECISION_DEVICE")
    parser.add_argument("--reported-accelerator", help="Operator-reported hardware label; not proof of execution")
    parser.add_argument("--output", required=True, type=Path, help="Comparison-ready aggregate JSON path")
    args = parser.parse_args(argv)
    try:
        suite_reports = [(path, json.loads(path.read_text(encoding="utf-8"))) for path in args.suite_reports]
        report = aggregate_suites(
            suite_reports,
            provider=args.provider,
            requested_device=args.requested_device,
            reported_accelerator=args.reported_accelerator,
        )
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Aggregated {report['episodeCount']} episodes across {len(report['runSeeds'])} seeds to {args.output}")


if __name__ == "__main__":
    main()
