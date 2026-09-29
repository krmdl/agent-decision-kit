import unittest

from benchmark_records import sanitize_record


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


if __name__ == "__main__":
    unittest.main()
