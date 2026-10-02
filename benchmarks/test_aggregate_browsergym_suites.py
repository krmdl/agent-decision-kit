import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("aggregate-browsergym-suites.py")
SPEC = importlib.util.spec_from_file_location("aggregate_browsergym_suites", SCRIPT_PATH)
AGGREGATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AGGREGATOR)


ENVIRONMENT = {
    "operatingSystem": "Windows test",
    "cpu": "Test CPU",
    "pythonVersion": "3.12.0",
    "nodeVersion": "v22.0.0",
    "browserGymVersion": "0.14.3",
    "browserGymPackageCommit": "browsergym-commit",
    "playwrightPythonVersion": "1.44.0",
    "playwrightNodeVersion": "1.63.0",
    "browserVersion": "HeadlessChrome/test",
    "miniWobCommit": "miniwob-commit",
}


def suite_report(seed, tasks=("click-test",)):
    records = [
        {
            "benchmark": "miniwob",
            "task": task,
            "success": True,
            "actions": 1,
            "latencyMs": 100 + seed,
            "agentActionLatencyMs": 20 + seed,
            "decisionCallLatenciesMs": [10 + seed],
            "decisionProvider": "semantic-nli",
            "agentDecisionKitCommit": "agent-commit",
            "workingTreeModified": False,
            **ENVIRONMENT,
        }
        for task in tasks
    ]
    return {
        "suite": {
            "seed": seed,
            "runnerMode": "bounded-repeated-browser-decide-and-act",
            "maxActionsPerTask": 5,
            "timeoutSecondsPerTask": 45,
            "syntheticApprovalsEnabled": True,
            "visualOcrActionsEnabled": False,
        },
        "rawRecords": records,
    }


class AggregateBrowserGymSuiteTests(unittest.TestCase):
    def test_combines_seeded_runs_and_tags_device_condition(self):
        reports = [(Path("seed-7.json"), suite_report(7)), (Path("seed-8.json"), suite_report(8))]

        result = AGGREGATOR.aggregate_suites(
            reports,
            provider="semantic-nli",
            requested_device="dml",
            reported_accelerator="GTX 1650 (operator reported)",
        )

        self.assertEqual(result["episodeCount"], 2)
        self.assertEqual(result["sourceCommit"], "agent-commit")
        self.assertEqual(result["runSeeds"], [7, 8])
        self.assertEqual(result["decisionProviderCondition"], "semantic-nli / dml requested")
        self.assertEqual({record["requestedDevice"] for record in result["rawRecords"]}, {"dml"})
        self.assertEqual({record["runSeed"] for record in result["rawRecords"]}, {7, 8})
        self.assertEqual(result["environment"]["reportedAccelerator"], "GTX 1650 (operator reported)")

    def test_rejects_duplicate_seed_reports(self):
        reports = [(Path("first.json"), suite_report(7)), (Path("second.json"), suite_report(7))]

        with self.assertRaisesRegex(ValueError, "Duplicate suite seed"):
            AGGREGATOR.aggregate_suites(reports, provider="semantic-nli", requested_device="cpu")

    def test_rejects_different_task_sets(self):
        reports = [(Path("seed-7.json"), suite_report(7)), (Path("seed-8.json"), suite_report(8, ("click-link",)))]

        with self.assertRaisesRegex(ValueError, "different task sets"):
            AGGREGATOR.aggregate_suites(reports, provider="semantic-nli", requested_device="cpu")

    def test_rejects_device_metadata_that_conflicts_with_cli(self):
        report = suite_report(7)
        report["rawRecords"][0]["requestedDevice"] = "cpu"

        with self.assertRaisesRegex(ValueError, "requestedDevice disagrees"):
            AGGREGATOR.aggregate_suites(
                [(Path("seed-7.json"), report)],
                provider="semantic-nli",
                requested_device="dml",
            )


if __name__ == "__main__":
    unittest.main()
