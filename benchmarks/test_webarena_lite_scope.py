import importlib.util
import unittest
from pathlib import Path


SCOPE_PATH = Path(__file__).with_name("webarena_lite_scope.py")
SPEC = importlib.util.spec_from_file_location("webarena_lite_scope", SCOPE_PATH)
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)
RUNNER_PATH = Path(__file__).with_name("run-browsergym-webarenalite-compat.py")
RUNNER_SPEC = importlib.util.spec_from_file_location("browsergym_webarenalite_compat", RUNNER_PATH)
RUNNER = importlib.util.module_from_spec(RUNNER_SPEC)
RUNNER_SPEC.loader.exec_module(RUNNER)


def task(**overrides):
    record = {
        "old_task_id": 157,
        "intent_template_id": 255,
        "intent": "Show all customers",
        "sites": ["shopping_admin"],
        "require_reset": False,
        "eval": {"eval_types": ["url_match"], "reference_url": "must-not-be-returned"},
    }
    record.update(overrides)
    return record


class WebArenaLiteScopeTests(unittest.TestCase):
    def test_accepts_only_the_expected_shape_and_redacts_evaluator_details(self):
        selected = SCOPE.select_read_only_task([task()], 157)

        self.assertEqual(selected["intent"], "Show all customers")
        self.assertEqual(selected["sites"], ["shopping_admin"])
        self.assertNotIn("reference_url", selected)

    def test_rejects_other_sites(self):
        with self.assertRaisesRegex(ValueError, "shopping_admin"):
            SCOPE.select_read_only_task([task(sites=["shopping", "shopping_admin"])], 157)

    def test_rejects_reset_tasks_and_non_url_evaluators(self):
        with self.assertRaisesRegex(ValueError, "reset"):
            SCOPE.select_read_only_task([task(require_reset=True)], 157)
        with self.assertRaisesRegex(ValueError, "URL-navigation"):
            SCOPE.select_read_only_task([task(eval={"eval_types": ["program_html"]})], 157)

    def test_rejects_mutating_and_ambiguous_intents(self):
        for intent in ("Create a new customer", "Show all customers and delete one", "Find every customer"):
            with self.subTest(intent=intent), self.assertRaises(ValueError):
                SCOPE.select_read_only_task([task(intent=intent)], 157)

    def test_requires_one_matching_task(self):
        with self.assertRaisesRegex(ValueError, "found 0"):
            SCOPE.select_read_only_task([], 157)
        with self.assertRaisesRegex(ValueError, "found 2"):
            SCOPE.select_read_only_task([task(), task()], 157)

    def test_backend_url_is_loopback_and_path_bounded(self):
        self.assertEqual(RUNNER.validate_backend_url("http://localhost:7780/admin/"), "http://localhost:7780/admin")
        for url in (
            "https://user:password@localhost:7780/admin",
            "https://example.test/admin",
            "http://127.0.0.1:7780/admin/delete",
            "http://127.0.0.1:7780/admin?token=secret",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                RUNNER.validate_backend_url(url)


if __name__ == "__main__":
    unittest.main()
