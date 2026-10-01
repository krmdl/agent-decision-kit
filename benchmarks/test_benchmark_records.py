import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from benchmark_records import attach_runtime_metadata, collect_runtime_metadata, count_executed_actions, sanitize_record


class SanitizeRecordTests(unittest.TestCase):
    def test_redacts_windows_file_url_and_root_metadata(self):
        record = {
            "snapshot": {"url": "file:///C:/Users/sampleuser/AppData/Local/Temp/miniwob/click-test.html"},
            "suite": {"miniwobRoot": "C:\\Users\\sampleuser\\AppData\\Local\\Temp\\miniwob"},
        }

        self.assertEqual(
            sanitize_record(record),
            {
                "snapshot": {"url": "file:///MINIWOB/click-test.html"},
                "suite": {"miniwobRoot": "<local-miniwob-root>"},
            },
        )

    def test_redacts_home_paths_in_failure_text(self):
        self.assertEqual(
            sanitize_record("Could not open /home/alice/private/task.html or C:\\Users\\sampleuser\\AppData\\task.html"),
            "Could not open <local-user-path> or <local-windows-path>",
        )


class RuntimeMetadataTests(unittest.TestCase):
    def test_collects_runtime_metadata_for_failed_episodes(self):
        with TemporaryDirectory() as temporary_directory:
            metadata = collect_runtime_metadata(
                Path(temporary_directory),
                browser_info={"Browser": "HeadlessChrome/125.0"},
                playwright_node_version="1.63.0",
                node_version="v24.20.0",
                browsergym_package_commit="browsergym-commit",
            )

        self.assertEqual(metadata["agentDecisionKitCommit"], "not-reported")
        self.assertEqual(metadata["browserGymPackageCommit"], "browsergym-commit")
        self.assertEqual(metadata["playwrightNodeVersion"], "1.63.0")
        self.assertEqual(metadata["nodeVersion"], "v24.20.0")
        self.assertEqual(metadata["browserVersion"], "HeadlessChrome/125.0")
        self.assertIn("pythonVersion", metadata)
        self.assertIn("operatingSystem", metadata)
        self.assertIn("cpu", metadata)

    def test_suite_environment_fills_missing_fields_without_replacing_episode_values(self):
        record = {"browserGymVersion": "0.14.3", "browserVersion": None}
        metadata = {"browserGymVersion": "other", "browserVersion": "HeadlessChrome/125", "nodeVersion": "v24.20.0"}

        enriched = attach_runtime_metadata(record, metadata)

        self.assertEqual(enriched["browserGymVersion"], "0.14.3")
        self.assertEqual(enriched["browserVersion"], "HeadlessChrome/125")
        self.assertEqual(enriched["nodeVersion"], "v24.20.0")


class BrowserActionCountTests(unittest.TestCase):
    def test_blocked_loop_proposal_is_not_counted_as_an_executed_action(self):
        trace = [
            {"status": "action-executed"},
            {"status": "action-executed"},
            {"status": "action-loop-detected"},
        ]

        self.assertEqual(count_executed_actions(trace), 2)

    def test_published_webarena_record_matches_its_trace(self):
        record_path = Path(__file__).parent / "results" / "webarena-verified-shopping-admin-157-loop-guard.json"
        record = json.loads(record_path.read_text(encoding="utf-8"))

        self.assertEqual(record["actions"], count_executed_actions(record["trace"]))
        self.assertEqual(record["loopDetected"], any(item["status"] == "action-loop-detected" for item in record["trace"]))
        self.assertEqual(record["success"], record["reward"] >= 1.0)


if __name__ == "__main__":
    unittest.main()
