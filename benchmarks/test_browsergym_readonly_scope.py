import importlib.util
import unittest
from pathlib import Path


SCOPE_PATH = Path(__file__).with_name("browsergym_readonly_scope.py")
SPEC = importlib.util.spec_from_file_location("browsergym_readonly_scope", SCOPE_PATH)
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)


def task(**overrides):
    item = {
        "task_id": 274,
        "intent_template_id": 91,
        "intent": 'Search for "usb wifi"',
        "sites": ["shopping"],
        "require_reset": False,
        "eval": {"eval_types": ["url_match"], "reference_url": "must-not-be-returned"},
    }
    item.update(overrides)
    return item


class BrowserGymReadOnlyScopeTests(unittest.TestCase):
    def test_selects_a_single_site_url_task_and_redacts_evaluator_details(self):
        selected = SCOPE.select_read_only_task([task()], "webarena", 274, "shopping")

        self.assertEqual(selected["intent"], 'Search for "usb wifi"')
        self.assertEqual(selected["taskType"], "read-only-url-navigation")
        self.assertNotIn("reference_url", selected)

    def test_rejects_ambiguous_task_ids_and_wrong_sites(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            SCOPE.select_read_only_task([], "webarena", 274, "shopping")
        with self.assertRaisesRegex(ValueError, "found 2"):
            SCOPE.select_read_only_task([task(), task()], "webarena", 274, "shopping")
        with self.assertRaisesRegex(ValueError, "selected site"):
            SCOPE.select_read_only_task([task(sites=["shopping", "reddit"])], "webarena", 274, "shopping")

    def test_rejects_reset_stateful_image_and_mutating_tasks(self):
        invalid = (
            task(require_reset=True),
            task(require_reset=None),
            task(eval={"eval_types": ["string_match"]}),
            task(image=["https://example.test/reference.png"]),
            task(intent="Show me the latest item and add it to my cart"),
            task(intent="Create a customer"),
            task(intent="Find this listing and publish it"),
        )
        for item in invalid:
            with self.subTest(item=item), self.assertRaises(ValueError):
                SCOPE.select_read_only_task([item], "webarena", 274, "shopping")

    def test_visual_task_must_use_its_explicit_single_classifieds_site(self):
        visual = task(task_id=0, intent="Find me the cheapest blue kayak on this site.", sites=["classifieds"])
        selected = SCOPE.select_read_only_task([visual], "visualwebarena", 0, "classifieds")
        self.assertEqual(selected["site"], "classifieds")
        with self.assertRaisesRegex(ValueError, "selected site"):
            SCOPE.select_read_only_task([visual], "visualwebarena", 0, "shopping")

    def test_site_url_rejects_credentials_queries_fragments_and_non_http_schemes(self):
        self.assertEqual(SCOPE.validate_site_url("http://localhost:7770/"), "http://localhost:7770")
        for value in (
            "http://user:password@localhost:7770",
            "https://example.test/path?token=secret",
            "https://example.test/path#fragment",
            "http://localhost:7770/path\\admin",
            "http://local host:7770",
            "file:///tmp/page.html",
            "http://localhost:99999",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                SCOPE.validate_site_url(value)

    def test_redacted_task_page_match_includes_origin_and_path(self):
        expected = "http://127.0.0.1:7770/search?q=usb"
        self.assertTrue(SCOPE.same_task_page(expected, expected))
        self.assertFalse(SCOPE.same_task_page(expected, "http://127.0.0.2:7770/search?q=usb"))
        self.assertFalse(SCOPE.same_task_page(expected, "http://127.0.0.1:7770/other?q=usb"))
        # BrowserManager deliberately redacts query strings from its response.
        self.assertTrue(SCOPE.same_task_page(expected, "http://127.0.0.1:7770/search"))

    def test_environment_maps_only_to_the_operator_selected_site_and_disables_reset(self):
        webarena = SCOPE.scoped_environment("webarena", "shopping", "http://localhost:7770/")
        self.assertEqual(set(webarena), set(SCOPE.SUITE_ENV["webarena"].values()) | {"WA_FULL_RESET"})
        self.assertEqual(set(webarena.values()), {"http://localhost:7770", ""})
        visual = SCOPE.scoped_environment("visualwebarena", "classifieds", "http://localhost:9980/")
        self.assertEqual(visual["DATASET"], "visualwebarena")
        self.assertEqual(visual["VWA_FULL_RESET"], "")
        self.assertEqual(visual["VWA_CLASSIFIEDS_RESET_TOKEN"], "unused-read-only-task")
        self.assertTrue(all(value in {"http://localhost:9980", "", "visualwebarena", "unused-read-only-task"} for value in visual.values()))


if __name__ == "__main__":
    unittest.main()
