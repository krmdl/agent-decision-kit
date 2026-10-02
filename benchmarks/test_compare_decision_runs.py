import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "benchmarks" / "compare-decision-runs.mjs"
NODE = shutil.which("node")


def report(provider, predictions, expected_override=None):
    expected_override = expected_override or {}
    cases = [
        {
            "id": "private-choice-case",
            "questionType": "choice",
            "expected": expected_override.get("private-choice-case", "target"),
            "prediction": predictions[0],
            "correct": predictions[0] == expected_override.get("private-choice-case", "target"),
            "confidence": 0.8,
            "confidenceSource": "maximum-probability",
            "calibration": "uncalibrated-estimate",
            "probabilities": {"target": 0.8, "other": 0.2},
            "warmWithinProcess": False,
            "latencyMs": 100,
        },
        {
            "id": "yes-no-case",
            "questionType": "noul",
            "expected": False,
            "prediction": predictions[1],
            "correct": predictions[1] is False,
            "confidence": 0.6,
            "confidenceSource": "maximum-probability",
            "calibration": "uncalibrated-estimate",
            "probabilities": {"true": 0.4, "false": 0.6},
            "warmWithinProcess": True,
            "latencyMs": 50,
        },
        {
            "id": "score-case",
            "questionType": "score",
            "expected": 2,
            "prediction": predictions[2],
            "scoreAbsoluteError": abs(predictions[2] - 2),
            "scoreWithinHalfPoint": abs(predictions[2] - 2) <= 0.5,
            "scoreExactMatch": round(predictions[2]) == 2,
            "confidence": 0.5,
            "confidenceSource": "maximum-probability",
            "calibration": "uncalibrated-estimate",
            "probabilities": {"0": 0.1, "1": 0.2, "2": 0.5, "3": 0.2},
            "warmWithinProcess": True,
            "latencyMs": 40,
        },
    ]
    return {
        "provider": provider,
        "model": f"{provider}-model",
        "runtime": {
            "node": "v22.14.0",
            "platform": "win32",
            "architecture": "x64",
            "osVersion": "10.0.19045",
            "cpuModel": "Example CPU",
        },
        "latencyMs": {"firstCallIncludingInitialization": 100},
        "records": cases,
    }


class CompareDecisionRunsTests(unittest.TestCase):
    def run_comparison(self, baseline, candidate):
        self.assertIsNotNone(NODE, "Node.js is required by the repository CI")
        with tempfile.TemporaryDirectory(prefix="adk-compare-") as directory:
            baseline_path = Path(directory) / "baseline.json"
            candidate_path = Path(directory) / "candidate.json"
            baseline_path.write_text(json.dumps(baseline), encoding="utf-8")
            candidate_path.write_text(json.dumps(candidate), encoding="utf-8")
            return subprocess.run(
                [NODE, str(SCRIPT), "--baseline", str(baseline_path), "--candidate", str(candidate_path)],
                cwd=ROOT,
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )

    def test_compares_paired_metrics_without_emitting_case_ids(self):
        baseline = report("semantic-local", ["other", True, 1.25])
        candidate = report("jev", ["target", False, 2.0])

        result = self.run_comparison(baseline, candidate)

        self.assertEqual(result.returncode, 0, result.stderr)
        comparison = json.loads(result.stdout)
        self.assertEqual(comparison["comparedCaseCount"], 3)
        self.assertTrue(comparison["comparability"]["sameLabeledCases"])
        self.assertTrue(comparison["comparability"]["sourceDatasetMetadataMatches"])
        self.assertTrue(comparison["comparability"]["sameHost"])
        self.assertEqual(comparison["pairedOutcomes"]["choice"]["predictionDisagreementCount"], 1)
        self.assertEqual(comparison["pairedOutcomes"]["choice"]["candidateOnlyCorrectCount"], 1)
        self.assertEqual(comparison["deltas"]["accuracyPercentagePoints"]["choice"], 100)
        self.assertEqual(comparison["deltas"]["accuracyPercentagePoints"]["yesNo"], 100)
        self.assertAlmostEqual(comparison["deltas"]["scoreMeanAbsoluteError"], -0.75)
        self.assertEqual(comparison["candidate"]["byQuestionType"]["score"]["exactMatchRate"], 1)
        self.assertEqual(comparison["deltas"]["latencyMs"]["warmP50"], 0)
        self.assertFalse(comparison["comparability"]["providerCostsIncluded"])
        self.assertNotIn("private-choice-case", result.stdout)

    def test_rejects_reports_with_different_expected_labels(self):
        baseline = report("semantic-local", ["target", False, 2.0])
        candidate = report("jev", ["target", False, 2.0], {"private-choice-case": "other"})

        result = self.run_comparison(baseline, candidate)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expected label", result.stderr)
        self.assertNotIn("private-choice-case", result.stderr)

    def test_rejects_reports_with_different_source_dataset_metadata(self):
        baseline = report("semantic-local", ["target", False, 2.0])
        candidate = report("jev", ["target", False, 2.0])
        baseline["sourceDataset"] = {"id": "dataset-a"}
        candidate["sourceDataset"] = {"id": "dataset-b"}

        result = self.run_comparison(baseline, candidate)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("different source dataset metadata", result.stderr)

    def test_accepts_equivalent_source_metadata_with_different_key_order(self):
        baseline = report("semantic-local", ["target", False, 2.0])
        candidate = report("jev", ["target", False, 2.0])
        baseline["sourceDataset"] = {"id": "boolq", "details": {"revision": "v1", "split": "validation"}}
        candidate["sourceDataset"] = {"details": {"split": "validation", "revision": "v1"}, "id": "boolq"}

        result = self.run_comparison(baseline, candidate)

        self.assertEqual(result.returncode, 0, result.stderr)
        comparison = json.loads(result.stdout)
        self.assertTrue(comparison["comparability"]["sourceDatasetMetadataMatches"])


if __name__ == "__main__":
    unittest.main()
