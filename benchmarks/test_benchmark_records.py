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
    def test_loop_detection_after_an_action_counts_but_a_blocked_action_does_not(self):
        trace = [
            {"status": "action-executed"},
            {"status": "action-loop-detected"},
            {"status": "action-loop-blocked"},
        ]

        self.assertEqual(count_executed_actions(trace), 2)

    def test_published_webarena_record_matches_its_trace(self):
        record_path = Path(__file__).parent / "results" / "webarena-verified-shopping-admin-157-loop-guard.json"
        record = json.loads(record_path.read_text(encoding="utf-8"))

        self.assertEqual(record["actions"], count_executed_actions(record["trace"]))
        self.assertEqual(record["loopDetected"], any(item["status"] == "action-loop-detected" for item in record["trace"]))
        self.assertEqual(record["success"], record["reward"] >= 1.0)

    def test_target_visible_webarena_record_is_full_reward_and_matches_its_trace(self):
        record_path = Path(__file__).parent / "results" / "webarena-verified-shopping-admin-157-target-visible.json"
        record = json.loads(record_path.read_text(encoding="utf-8"))

        self.assertEqual(record["actions"], count_executed_actions(record["trace"]))
        self.assertEqual(record["loopDetected"], any(item["status"] == "action-loop-detected" for item in record["trace"]))
        self.assertEqual(record["success"], record["reward"] >= 1.0)
        self.assertEqual(record["reward"], 1.0)
        self.assertEqual(record["trace"][-1]["taskTargetVisible"], "Customers")


class WebArenaReproductionDocsTests(unittest.TestCase):
    def test_reproduction_matches_the_site_default_ports_and_image(self):
        readme = (Path(__file__).parent / "README.md").read_text(encoding="utf-8")

        self.assertIn("127.0.0.1:7780:80 -p 127.0.0.1:7781:8877", readme)
        self.assertIn("--shopping-admin-url http://localhost:7780/admin", readme)
        self.assertIn("am1n3e/webarena-verified-shopping_admin@sha256:d0531dd27ed98d0c459ff9e88118bf2ed8b660b0ed99c38837db46c065a5be13", readme)
        self.assertIn("webarena-verified-shopping-admin-157-target-visible.json", readme)


if __name__ == "__main__":
    unittest.main()
