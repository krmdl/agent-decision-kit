import importlib.util
import unittest
from pathlib import Path


RUNNER_PATH = Path(__file__).with_name("run-browsergym-miniwob.py")
SPEC = importlib.util.spec_from_file_location("run_browsergym_miniwob", RUNNER_PATH)
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)
SUITE_PATH = Path(__file__).with_name("run-browsergym-miniwob-suite.py")
SUITE_SPEC = importlib.util.spec_from_file_location("run_browsergym_miniwob_suite", SUITE_PATH)
SUITE = importlib.util.module_from_spec(SUITE_SPEC)
SUITE_SPEC.loader.exec_module(SUITE)


class MultiToolPlanningTests(unittest.TestCase):
    def test_suite_metadata_uses_tools_that_ran_not_just_enabled_flags(self):
        self.assertEqual(
            SUITE.suite_identity([{"runnerMode": "bounded-multi-tool-integration-smoke"}]),
            ("miniwob-multi-tool-smoke", "bounded-multi-tool-integration-smoke"),
        )
        self.assertEqual(
            SUITE.suite_identity([{"runnerMode": "bounded-visual-ocr-approval-smoke"}]),
            ("miniwob-visual-ocr-smoke", "bounded-visual-ocr-approval-smoke"),
        )
        self.assertEqual(
            SUITE.suite_identity([{"runnerMode": "bounded-multi-tool-integration-smoke"}, {"runnerMode": "bounded-visual-ocr-approval-smoke"}]),
            ("miniwob-mixed-smoke", "mixed-tool-integration"),
        )

    def test_extracts_only_an_explicitly_quoted_visual_link_target(self):
        self.assertEqual(RUNNER.extract_visual_click_target('Click on the link "adipiscing.".'), "adipiscing.")
        self.assertEqual(RUNNER.extract_visual_click_target("Click the link “Continue” now."), "Continue")
        self.assertIsNone(RUNNER.extract_visual_click_target("Click on the link adipiscing."))
        self.assertIsNone(RUNNER.extract_visual_click_target('Click the button "Continue".'))

    def test_synthetic_visual_approval_requires_the_exact_local_task_url(self):
        base_url = "file:///MINIWOB/"
        self.assertTrue(RUNNER.is_expected_local_task_url("file:///MINIWOB/click-link.html", base_url, "click-link"))
        self.assertFalse(RUNNER.is_expected_local_task_url("https://example.test/click-link.html", base_url, "click-link"))
        self.assertFalse(RUNNER.is_expected_local_task_url("file:///MINIWOB/click-test.html", base_url, "click-link"))

    def test_extracts_and_transforms_an_explicit_text_value(self):
        candidates = [{"ref": "r1", "role": "input", "kind": "text", "label": "Text input"}]
        planned = RUNNER.multi_tool_action(
            'Type "chas" in all upper case letters in the text input and press Submit.',
            candidates,
            set(),
        )
        self.assertEqual(planned[0], "fill")
        self.assertEqual(planned[1], {"ref": "r1", "text": "CHAS"})
        self.assertEqual(planned[2], {"fieldKind": "text", "characterCount": 4})

    def test_checks_the_explicit_radio_ordinal_before_filling_the_numbered_textbox(self):
        radios = [
            {"ref": "r1", "role": "input", "kind": "radio", "label": "Alpha", "checked": False},
            {"ref": "r2", "role": "input", "kind": "radio", "label": "Beta", "checked": False},
            {"ref": "r3", "role": "input", "kind": "radio", "label": "Gamma", "checked": False},
        ]
        textbox_one = {"ref": "r4", "role": "input", "kind": "text", "label": "Text one"}
        textbox_two = {"ref": "r5", "role": "input", "kind": "text", "label": "Text two"}
        candidates = radios + [textbox_one, textbox_two]
        task = 'Check the 3rd radio button and enter the number "-3" into the 2nd textbox.'

        radio_action = RUNNER.multi_tool_action(task, candidates, set())
        self.assertEqual(radio_action[0], "act")
        self.assertEqual(radio_action[1], {"ref": "r3"})
        self.assertEqual(radio_action[2], {"fieldKind": "radio", "fieldOrdinal": 3})

        completed = {RUNNER.field_key(radios[2])}
        field_action = RUNNER.multi_tool_action(task, candidates, completed)
        self.assertEqual(field_action[0], "fill")
        self.assertEqual(field_action[1], {"ref": "r5", "text": "-3"})
        self.assertEqual(field_action[2], {"fieldKind": "text", "characterCount": 2, "fieldOrdinal": 2})

    def test_never_falls_back_to_a_different_field_when_the_requested_ordinal_is_missing(self):
        candidates = [{"ref": "r1", "role": "input", "kind": "text", "label": "Only textbox"}]
        task = 'Enter the number "-3" into the 2nd textbox.'

        self.assertIsNone(RUNNER.multi_tool_action(task, candidates, set()))

    def test_converts_an_explicit_date_to_native_input_format(self):
        candidates = [{"ref": "r2", "role": "input", "kind": "date", "label": "Date"}]
        planned = RUNNER.multi_tool_action("Select 12/22/2016 as the date and hit submit.", candidates, set())
        self.assertEqual(planned[0], "fill")
        self.assertEqual(planned[1], {"ref": "r2", "text": "2016-12-22"})

    def test_preserves_the_visible_date_format_for_a_text_date_field(self):
        candidates = [{"ref": "r2", "role": "input", "kind": "text", "label": "input 1"}]
        planned = RUNNER.multi_tool_action("Select 12/22/2016 as the date and hit submit.", candidates, set())
        self.assertEqual(planned[0], "fill")
        self.assertEqual(planned[1], {"ref": "r2", "text": "12/22/2016"})

    def test_opens_a_readonly_date_picker_then_selects_the_exact_visible_day(self):
        readonly = {"ref": "r2", "role": "input", "kind": "text", "label": "Appointment date", "readOnly": True}
        first = RUNNER.multi_tool_action("Select 12/22/2016 as the date and hit submit.", [readonly], set())
        self.assertEqual(first[0], "act")
        self.assertEqual(first[1], {"ref": "r2"})
        completed = {RUNNER.field_key(readonly)}

        visible_picker = [readonly, {"ref": "r3", "role": "link", "kind": "a", "label": "22"}]
        second = RUNNER.multi_tool_action("Select 12/22/2016 as the date and hit submit.", visible_picker, completed, "December 2016")
        self.assertEqual(second[0], "act")
        self.assertEqual(second[1], {"ref": "r3"})
        self.assertEqual(second[2], {"fieldKind": "calendar-day", "dateMatch": "visible-month-and-day"})
        self.assertIsNone(RUNNER.multi_tool_action("Select 12/22/2016 as the date.", visible_picker, completed | {RUNNER.field_key(visible_picker[1])}, "December 2016"))
        self.assertIsNone(RUNNER.multi_tool_action("Select 12/22/2016 as the date.", visible_picker, completed, "November 2016"))

    def test_selects_only_an_exact_visible_native_option(self):
        candidates = [{
            "ref": "r3",
            "role": "combobox",
            "kind": "select-one",
            "label": "Currently selected: Gibraltar — Options: Gibraltar, Indonesia, France, China",
        }]
        planned = RUNNER.multi_tool_action("Select China from the list and click Submit.", candidates, set())
        self.assertEqual(planned[0], "select-option")
        self.assertEqual(planned[1], {"ref": "r3", "optionLabel": "China"})

        selected = dict(candidates[0], label="Currently selected: China — Options: Gibraltar, Indonesia, France, China")
        self.assertEqual(RUNNER.field_key(candidates[0]), RUNNER.field_key(selected))

    def test_does_not_invent_values_when_goal_or_visible_option_is_missing(self):
        candidates = [{"ref": "r3", "role": "combobox", "kind": "select-one", "label": "Country — Options: Japan, India"}]
        self.assertIsNone(RUNNER.multi_tool_action("Select China from the list.", candidates, set()))
        self.assertIsNone(RUNNER.multi_tool_action("Enter a suitable value.", candidates, set()))


if __name__ == "__main__":
    unittest.main()
