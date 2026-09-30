import importlib.util
import unittest
from pathlib import Path


SUITE_PATH = Path(__file__).with_name("run-browsergym-miniwob-suite.py")
SPEC = importlib.util.spec_from_file_location("browsergym_miniwob_suite", SUITE_PATH)
SUITE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUITE)


class RunnerDiagnosticTests(unittest.TestCase):
    def test_records_bounded_stderr_for_failed_runner(self):
        record = SUITE.attach_runner_diagnostics({"task": "click-test"}, 1, "  Error: browser disconnected  ")

        self.assertEqual(record["runnerExitCode"], 1)
        self.assertEqual(record["runnerDiagnostic"], "Error: browser disconnected")

    def test_omits_stderr_for_successful_runner(self):
        record = SUITE.attach_runner_diagnostics({"task": "click-button"}, 0, "warning: benign")

        self.assertEqual(record["runnerExitCode"], 0)
        self.assertNotIn("runnerDiagnostic", record)

    def test_caps_failed_runner_diagnostic_length(self):
        diagnostic = "x" * 2_500
        record = SUITE.attach_runner_diagnostics({}, 1, diagnostic)

        self.assertEqual(len(record["runnerDiagnostic"]), 2_000)


if __name__ == "__main__":
    unittest.main()
