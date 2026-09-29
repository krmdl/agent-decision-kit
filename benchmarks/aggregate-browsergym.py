#!/usr/bin/env python3
"""Aggregate real BrowserGym episode records into a JSON summary."""
import json
import math
import statistics
import argparse
from pathlib import Path


def percentile(values, quantile):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(quantile * len(ordered)) - 1)]


def summarize(records):
    if not isinstance(records, list) or not records:
        raise ValueError("Input must contain at least one BrowserGym episode record")
    required = {"benchmark", "task", "success", "actions", "latencyMs"}
    for index, record in enumerate(records):
        missing = required - set(record)
        if missing:
            raise SystemExit(f"Record {index} is missing: {', '.join(sorted(missing))}")
        if not isinstance(record["success"], bool) or record["actions"] < 0 or record["latencyMs"] < 0:
            raise SystemExit(f"Record {index} has invalid success/actions/latencyMs fields")
    latencies = [item["latencyMs"] for item in records]
    action_latencies = [item["agentActionLatencyMs"] for item in records if isinstance(item.get("agentActionLatencyMs"), (int, float))]
    decision_latencies = [
        latency
        for item in records
        for latency in item.get("decisionCallLatenciesMs", ([item["decisionLatencyMs"]] if isinstance(item.get("decisionLatencyMs"), (int, float)) else []))
        if isinstance(latency, (int, float))
    ]
    decision_episode_latencies = [item["decisionLatencyMs"] for item in records if isinstance(item.get("decisionLatencyMs"), (int, float))]
    action_counts = [item["actions"] for item in records]
    timeouts = [bool(item.get("timeout", False)) for item in records]
    failure_reasons = {}
    decision_statuses = {}
    decision_providers = {}
    for item in records:
        reason = item.get("failureReason")
        if reason:
            failure_reasons[reason] = failure_reasons.get(reason, 0) + 1
        status = item.get("decisionStatus", "unreported")
        decision_statuses[status] = decision_statuses.get(status, 0) + 1
        provider = item.get("decisionProvider", "unreported")
        decision_providers[provider] = decision_providers.get(provider, 0) + 1
    return {
        "episodeCount": len(records),
        "successCount": sum(item["success"] for item in records),
        "taskSuccessRate": sum(item["success"] for item in records) / len(records),
        "timeoutRate": sum(timeouts) / len(records),
        "failureReasons": failure_reasons,
        "decisionStatuses": decision_statuses,
        "decisionProviders": decision_providers,
        "syntheticApprovalCount": sum(item.get("syntheticApprovalCount", 0) for item in records),
        "latencyMs": {"p50": percentile(latencies, 0.5), "p95": percentile(latencies, 0.95)},
        "agentActionLatencyMs": {"sampleCount": len(action_latencies), "p50": percentile(action_latencies, 0.5), "p95": percentile(action_latencies, 0.95)},
        "decisionCallLatencyMs": {"sampleCount": len(decision_latencies), "p50": percentile(decision_latencies, 0.5), "p95": percentile(decision_latencies, 0.95)},
        "decisionLatencyPerEpisodeMs": {"sampleCount": len(decision_episode_latencies), "p50": percentile(decision_episode_latencies, 0.5), "p95": percentile(decision_episode_latencies, 0.95)},
        "actions": {"mean": statistics.mean(action_counts), "p50": percentile(action_counts, 0.5), "p95": percentile(action_counts, 0.95)},
        "rawRecords": records,
        "note": "Episode latency includes environment reset. Agent action latency includes browser inspection, decision, and any synthetic approval round-trip; decision latency is reported separately when available. These task and hardware samples are not representative quality or performance claims.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("records", nargs="+", type=Path, help="JSON file(s), each containing one record or an array of records")
    parser.add_argument("--output", type=Path, help="Optional path to write the combined summary and raw records")
    args = parser.parse_args()
    records = []
    for record_path in args.records:
        loaded = json.loads(record_path.read_text(encoding="utf-8"))
        if isinstance(loaded, list):
            records.extend(loaded)
        elif isinstance(loaded, dict):
            records.append(loaded)
        else:
            raise SystemExit(f"{record_path} must contain one episode record or an array")
    try:
        summary = summarize(records)
    except ValueError as error:
        raise SystemExit(str(error)) from error
    rendered = json.dumps(summary, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
