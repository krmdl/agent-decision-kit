import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("prepare-boolq-evaluation.py")
SPEC = importlib.util.spec_from_file_location("prepare_boolq_evaluation", SCRIPT)
PREPARE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PREPARE)


class BoolQSelectionTests(unittest.TestCase):
    def test_full_selection_keeps_every_row_and_marks_it(self):
        rows = list(range(6))

        selected, description, indexes = PREPARE.select_rows(rows, len(rows))

        self.assertEqual(selected, rows)
        self.assertEqual(indexes, list(range(len(rows))))
        self.assertIn("Every row", description)
        self.assertIn("no resampling", description)

    def test_small_selection_uses_evenly_spaced_rows(self):
        rows = list(range(9))

        selected, description, indexes = PREPARE.select_rows(rows, 3)

        self.assertEqual(selected, [0, 4, 8])
        self.assertEqual(indexes, [0, 4, 8])
        self.assertIn("3 evenly spaced row indices", description)
        self.assertIn("instrumentation", description)

    def test_single_row_selection_is_deterministic(self):
        rows = list(range(9))

        selected, description, indexes = PREPARE.select_rows(rows, 1)

        self.assertEqual(selected, [0])
        self.assertEqual(indexes, [0])
        self.assertIn("1 evenly spaced row indices", description)

    def test_selection_rejects_invalid_sizes(self):
        for sample_size in (0, -1, 10):
            with self.subTest(sample_size=sample_size), self.assertRaises(ValueError):
                PREPARE.select_rows(list(range(9)), sample_size)

    def test_selected_fixture_ids_preserve_source_indices(self):
        rows = [{"answer": True, "passage": "p", "question": "q"} for _ in range(3)]

        records = list(PREPARE.fixture_records(rows, "sample", [3, 18, 42]))

        self.assertEqual([record["id"] for record in records], [
            "boolq-validation-0003",
            "boolq-validation-0018",
            "boolq-validation-0042",
        ])


if __name__ == "__main__":
    unittest.main()
