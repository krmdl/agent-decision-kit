import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("compare-browsergym-runs.py")
SPEC = importlib.util.spec_from_file_location("compare_browsergym_runs", SCRIPT_PATH)
COMPARATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPARATOR)


def report(provider, latency_delta=0):
    return {
        "benchmarkName": "fixture",
        "decisionProviderCondition": provider,
        "sourceCommit": "fixture-commit",
        "taskSet": ["click-test"],
        "runSeeds": [7, 8],
        "environment": {"cpu": "fixture"},
        "configuration": {"maxActions": 5},
        "rawRecords": [
            {
                "task": "click-test",
                "runSeed": seed,
                "benchmark": "miniwob",
                "success": True,
                "timeout": False,
                "actions": 1,
                "latencyMs": 100 + latency_delta,
                "agentActionLatencyMs": 20 + latency_delta,
                "decisionCallLatenciesMs": [10 + latency_delta],
                "decisionTrace": [{"provider": provider}],
            }
            for seed in (7, 8)
        ],
    }


class CompareBrowserGymRunsTests(unittest.TestCase):
    def test_compares_matching_raw_task_seed_pairs_and_reports_actual_provider_calls(self):
        result = COMPARATOR.compare_reports(
            report("semantic-local"),
            report("semantic-nli", latency_delta=5),
        )

        self.assertEqual(result["pairedTaskSeedCount"], 2)
        self.assertEqual(result["outcomeDisagreements"], 0)
        self.assertEqual(result["conditions"]["semantic-nli"]["decisionProviders"], {"semantic-nli": 2})
        self.assertEqual(result["pairedEndToEndLatencyDelta"]["candidateMinusBaselineMs"]["median"], 5)
        self.assertEqual(result["pairedDecisionCallLatencyDelta"]["sampleCount"], 2)
        self.assertEqual(result["pairedDecisionCallLatencyDelta"]["candidateMinusBaselineMs"]["median"], 5)

    def test_excludes_episodes_with_different_decision_call_counts(self):
        baseline = report("semantic-local")
        candidate = report("semantic-nli", latency_delta=5)
        baseline["rawRecords"][0]["decisionCallLatenciesMs"] = [10, 11]

        result = COMPARATOR.compare_reports(baseline, candidate)

        paired = result["pairedDecisionCallLatencyDelta"]
        self.assertEqual(paired["sampleCount"], 1)
        self.assertEqual(paired["pairedEpisodeCount"], 1)
        self.assertEqual(paired["excludedEpisodesWithDifferentCallCounts"], 1)

    def test_rejects_reports_with_different_task_seed_pairs(self):
        baseline = report("semantic-local")
        candidate = report("semantic-nli")
        candidate["rawRecords"][0]["runSeed"] = 9

        with self.assertRaisesRegex(ValueError, "identical task/seed pairs"):
            COMPARATOR.compare_reports(baseline, candidate)

    def test_rejects_reports_with_different_environments(self):
        baseline = report("semantic-local")
        candidate = report("semantic-nli")
        candidate["environment"]["cpu"] = "different fixture"

        with self.assertRaisesRegex(ValueError, "different environment"):
            COMPARATOR.compare_reports(baseline, candidate)


if __name__ == "__main__":
    unittest.main()
