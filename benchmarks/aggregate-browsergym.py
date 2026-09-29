#!/usr/bin/env python3
"""Aggregate real BrowserGym episode records into a JSON summary."""
import json
import math
import statistics
import sys
from pathlib import Path


def percentile(values, quantile):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(quantile * len(ordered)) - 1)]


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python benchmarks/aggregate-browsergym.py episode-records.json")
    records = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if not isinstance(records, list) or not records:
        raise SystemExit("Input must be a non-empty JSON array of episode records")
    required = {"benchmark", "task", "success", "actions", "latencyMs"}
    for index, record in enumerate(records):
        missing = required - set(record)
        if missing:
            raise SystemExit(f"Record {index} is missing: {', '.join(sorted(missing))}")
        if not isinstance(record["success"], bool) or record["actions"] < 0 or record["latencyMs"] < 0:
            raise SystemExit(f"Record {index} has invalid success/actions/latencyMs fields")
    latencies = [item["latencyMs"] for item in records]
    action_counts = [item["actions"] for item in records]
    summary = {
        "episodeCount": len(records),
        "taskSuccessRate": sum(item["success"] for item in records) / len(records),
        "latencyMs": {"p50": percentile(latencies, 0.5), "p95": percentile(latencies, 0.95)},
        "actions": {"mean": statistics.mean(action_counts), "p50": percentile(action_counts, 0.5), "p95": percentile(action_counts, 0.95)},
        "rawRecords": records,
        "note": "Do not publish without benchmark versions, environment setup, hardware, model/provider and raw episode records.",
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
