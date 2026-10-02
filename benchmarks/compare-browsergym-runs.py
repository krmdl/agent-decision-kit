#!/usr/bin/env python3
"""Compare two aggregate BrowserGym reports containing paired raw episodes."""
import argparse
import importlib.util
import json
import math
import statistics
from collections import Counter
from pathlib import Path


AGGREGATOR_PATH = Path(__file__).with_name("aggregate-browsergym.py")
SPEC = importlib.util.spec_from_file_location("aggregate_browsergym", AGGREGATOR_PATH)
AGGREGATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGGREGATOR)


def percentile(values, quantile):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(quantile * len(ordered)) - 1)]


def keyed_records(report, path):
    records = report.get("rawRecords")
    if not isinstance(records, list) or not records:
        raise ValueError(f"{path} must contain a non-empty rawRecords array")
    keyed = {}
    for index, record in enumerate(records):
        seed = record.get("runSeed")
        task = record.get("task", record.get("taskId"))
        if not isinstance(seed, int) or not isinstance(task, str) or not task:
            raise ValueError(f"{path} raw record {index} must contain integer runSeed and task")
        key = (seed, task)
        if key in keyed:
            raise ValueError(f"{path} contains duplicate seed/task pair {key}")
        keyed[key] = record
    return keyed


def summarize_condition(report):
    records = report["rawRecords"]
    summary = AGGREGATOR.summarize(records)
    summary.pop("rawRecords", None)
    providers = Counter(
        decision.get("provider", "unreported")
        for record in records
        for decision in record.get("decisionTrace", [])
    )
    summary["decisionProviders"] = dict(providers)
    return summary


def paired_delta(baseline, candidate, keys, field):
    differences = [candidate[key][field] - baseline[key][field] for key in keys]
    return {
        "sampleCount": len(differences),
        "candidateMinusBaselineMs": {
            "median": statistics.median(differences),
            "p95": percentile(differences, 0.95),
            "mean": round(statistics.mean(differences), 2),
        },
    }


def paired_decision_call_delta(baseline, candidate, keys):
    baseline_calls = []
    candidate_calls = []
    paired_episode_count = 0
    excluded_episode_count = 0
    for key in keys:
        left_calls = baseline[key].get("decisionCallLatenciesMs", [])
        right_calls = candidate[key].get("decisionCallLatenciesMs", [])
        if not isinstance(left_calls, list) or not isinstance(right_calls, list):
            raise ValueError(f"Task/seed pair {key} has invalid decisionCallLatenciesMs")
        if len(left_calls) != len(right_calls):
            excluded_episode_count += 1
            continue
        if left_calls:
            paired_episode_count += 1
        for left, right in zip(left_calls, right_calls):
            if any(not isinstance(value, (int, float)) or isinstance(value, bool) for value in (left, right)):
                raise ValueError(f"Task/seed pair {key} has non-numeric decision-call latency")
            baseline_calls.append(left)
            candidate_calls.append(right)

    differences = [right - left for left, right in zip(baseline_calls, candidate_calls)]
    delta = None
    if differences:
        delta = {
            "median": statistics.median(differences),
            "p95": percentile(differences, 0.95),
            "mean": round(statistics.mean(differences), 2),
        }
    return {
        "pairedEpisodeCount": paired_episode_count,
        "excludedEpisodesWithDifferentCallCounts": excluded_episode_count,
        "sampleCount": len(differences),
        "baselineLatencyMs": {"p50": percentile(baseline_calls, 0.5), "p95": percentile(baseline_calls, 0.95)},
        "candidateLatencyMs": {"p50": percentile(candidate_calls, 0.5), "p95": percentile(candidate_calls, 0.95)},
        "candidateMinusBaselineMs": delta,
    }


def compare_reports(baseline, candidate, baseline_path="baseline.json", candidate_path="candidate.json"):
    for field in ("sourceCommit", "taskSet", "runSeeds", "environment", "configuration"):
        if baseline.get(field) != candidate.get(field):
            raise ValueError(f"Reports have different {field}")
    baseline_provider = baseline.get("decisionProviderCondition")
    candidate_provider = candidate.get("decisionProviderCondition")
    if not isinstance(baseline_provider, str) or not isinstance(candidate_provider, str) or baseline_provider == candidate_provider:
        raise ValueError("Reports must identify two different decisionProviderCondition values")

    baseline_records = keyed_records(baseline, baseline_path)
    candidate_records = keyed_records(candidate, candidate_path)
    if baseline_records.keys() != candidate_records.keys():
        raise ValueError("Reports do not contain identical task/seed pairs")
    keys = sorted(baseline_records)
    for key in keys:
        left = baseline_records[key]
        right = candidate_records[key]
        for field in ("latencyMs", "agentActionLatencyMs"):
            if not isinstance(left.get(field), (int, float)) or not isinstance(right.get(field), (int, float)):
                raise ValueError(f"Task/seed pair {key} is missing numeric {field}")

    baseline_summary = summarize_condition(baseline)
    candidate_summary = summarize_condition(candidate)
    disagreements = sum(
        baseline_records[key].get("success") != candidate_records[key].get("success")
        for key in keys
    )
    return {
        "reportType": "paired BrowserGym provider comparison",
        "benchmarkName": baseline.get("benchmarkName", "BrowserGym paired provider comparison"),
        "sourceCommit": baseline["sourceCommit"],
        "episodesPerProvider": len(baseline_records),
        "pairedTaskSeedCount": len(keys),
        "sameTasksAndSeeds": True,
        "outcomeDisagreements": disagreements,
        "providerReports": {
            baseline_provider: Path(baseline_path).name,
            candidate_provider: Path(candidate_path).name,
        },
        "conditions": {
            baseline_provider: baseline_summary,
            candidate_provider: candidate_summary,
        },
        "pairedEndToEndLatencyDelta": paired_delta(baseline_records, candidate_records, keys, "latencyMs"),
        "pairedAgentActionLatencyDelta": paired_delta(baseline_records, candidate_records, keys, "agentActionLatencyMs"),
        "pairedDecisionCallLatencyDelta": paired_decision_call_delta(baseline_records, candidate_records, keys),
        "note": "This is a project-authored, curated integration sample, not a representative BrowserGym score. Consult each report's environment and rawRecords. Paired differences describe these episodes only; they do not establish warm persistent-server latency, hardware-wide performance, or broad quality.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path, help="Aggregate report with rawRecords and runSeed values")
    parser.add_argument("--candidate", required=True, type=Path, help="Paired aggregate report with rawRecords and runSeed values")
    parser.add_argument("--output", type=Path, help="Optional path for the comparison JSON")
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
    try:
        comparison = compare_reports(baseline, candidate, args.baseline, args.candidate)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    rendered = json.dumps(comparison, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
