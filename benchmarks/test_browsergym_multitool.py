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
    def test_fills_fields_from_unique_visible_table_rows_and_submits_only_after_all_values(self):
        fields = [
            {"ref": "r1", "role": "input", "kind": "text", "label": "Color:"},
            {"ref": "r2", "role": "input", "kind": "text", "label": "Year:"},
        ]
        submit = {"ref": "r3", "role": "button", "kind": "button", "label": "Submit", "risk": "approval-required"}
        tables = [{"index": 1, "rows": [["Color", "Blue"], ["Year", "2001"]]}]
        task = "Enter the value that corresponds with each label into the form and submit when done."

        first = RUNNER.multi_tool_action(task, fields + [submit], set(), visible_tables=tables)
        self.assertEqual(first, ("fill", {"ref": "r1", "text": "Blue"}, {"fieldKind": "visible-table-value", "fieldOrdinal": 1, "characterCount": 4}))
        self.assertNotIn("Blue", str(first[2]))

        completed = {RUNNER.field_key(fields[0])}
        second = RUNNER.multi_tool_action(task, fields + [submit], completed, visible_tables=tables)
        self.assertEqual(second, ("fill", {"ref": "r2", "text": "2001"}, {"fieldKind": "visible-table-value", "fieldOrdinal": 2, "characterCount": 4}))

        completed.update(RUNNER.field_key(field) for field in fields)
        final = RUNNER.multi_tool_action(task, fields + [submit], completed, visible_tables=tables)
        self.assertEqual(final, ("act", {"ref": "r3"}, {"fieldKind": "submit-after-visible-table-values"}))

    def test_refuses_ambiguous_or_missing_table_rows(self):
        field = {"ref": "r1", "role": "input", "kind": "text", "label": "Color:"}
        task = "Enter the value that corresponds with each label into the form and submit when done."
        duplicate = [{"index": 1, "rows": [["Color", "Blue"], ["Color", "Red"]]}]
        self.assertIsNone(RUNNER.multi_tool_action(task, [field], set(), visible_tables=duplicate))
        self.assertIsNone(RUNNER.multi_tool_action(task, [field], set(), visible_tables=[]))
        duplicate_fields = [field, dict(field, ref="r2")]
        unique_row = [{"index": 1, "rows": [["Color", "Blue"]]}]
        self.assertIsNone(RUNNER.multi_tool_action(task, duplicate_fields, set(), visible_tables=unique_row))

    def test_replies_to_only_the_explicit_email_via_unique_search_and_confirmation_steps(self):
        task = 'Find the email by Blisse and reply to them with the text "Vitae ornare lectus.".'
        search_icon = {"ref": "r1", "role": "pointer-target", "kind": "custom-pointer", "label": "search icon", "risk": "approval-required"}
        self.assertEqual(
            RUNNER.multi_tool_action(task, [search_icon], set()),
            ("act", {"ref": "r1"}, {"fieldKind": "open-email-search"}),
        )

        search_field = {"ref": "r2", "role": "input", "kind": "search", "label": "Search"}
        self.assertEqual(
            RUNNER.multi_tool_action(task, [search_field], set()),
            ("fill", {"ref": "r2", "text": "Blisse"}, {"fieldKind": "email-search", "characterCount": 6}),
        )

        result = {"ref": "r3", "role": "pointer-target", "kind": "custom-pointer", "label": "Email sender — Blisse", "risk": "approval-required"}
        self.assertEqual(
            RUNNER.multi_tool_action(task, [search_field, result], {RUNNER.field_key(search_field)}),
            ("act", {"ref": "r3"}, {"fieldKind": "email-recipient"}),
        )

        reply = {"ref": "r4", "role": "pointer-target", "kind": "custom-pointer", "label": "Reply", "risk": "approval-required"}
        forward = {"ref": "r5", "role": "pointer-target", "kind": "custom-pointer", "label": "Forward", "risk": "approval-required"}
        self.assertEqual(
            RUNNER.multi_tool_action(task, [reply, forward], set()),
            ("act", {"ref": "r4"}, {"fieldKind": "open-email-reply"}),
        )

        body = {"ref": "r6", "role": "textarea", "kind": "textarea", "label": "Reply body"}
        send = {"ref": "r7", "role": "pointer-target", "kind": "custom-pointer", "label": "send reply icon", "risk": "approval-required"}
        self.assertEqual(
            RUNNER.multi_tool_action(task, [body, send], set()),
            ("fill", {"ref": "r6", "text": "Vitae ornare lectus."}, {"fieldKind": "email-reply-body", "characterCount": 20}),
        )
        self.assertEqual(
            RUNNER.multi_tool_action(task, [body, send], {RUNNER.field_key(body)}),
            ("act", {"ref": "r7"}, {"fieldKind": "submit-after-email-reply"}),
        )

        row_and_sender = [
            dict(result, label="Blisse Donec adipiscin.. Vulputate. Vive.."),
            dict(result, ref="r8", label="Blisse"),
        ]
        self.assertEqual(
            RUNNER.multi_tool_action(task, row_and_sender, set()),
            ("act", {"ref": "r8"}, {"fieldKind": "email-recipient"}),
        )
        self.assertIsNone(RUNNER.multi_tool_action(task, [dict(result, ref="r8", label="Blisse"), dict(result, ref="r9", label="Blisse")], set()))

    def test_batches_only_explicit_unique_native_checkbox_targets_then_submits_separately(self):
        task = "Select Alpha, Beta, Gamma and click Submit."
        checkboxes = [
            {"ref": "r1", "role": "input", "kind": "checkbox", "label": "Alpha — Currently unchecked", "checked": False, "risk": "low"},
            {"ref": "r2", "role": "input", "kind": "checkbox", "label": "Beta — Currently unchecked", "checked": False, "risk": "low"},
            {"ref": "r3", "role": "input", "kind": "checkbox", "label": "Gamma — Currently unchecked", "checked": False, "risk": "low"},
            {"ref": "r4", "role": "button", "kind": "button", "label": "Submit", "risk": "approval-required"},
        ]
        planned = RUNNER.multi_tool_action(task, checkboxes, set())
        self.assertEqual(planned, ("set-checkboxes", {"refs": ["r1", "r2", "r3"], "checked": True}, {"fieldKind": "explicit-checkbox-batch", "checkboxCount": 3}))

        checked = [dict(candidate, label=candidate["label"].replace("unchecked", "checked"), checked=True) if candidate["kind"] == "checkbox" else candidate for candidate in checkboxes]
        self.assertEqual(
            RUNNER.multi_tool_action(task, checked, set()),
            ("act", {"ref": "r4"}, {"fieldKind": "submit-after-explicit-checkbox-batch"}),
        )

        ambiguous = [*checkboxes, dict(checkboxes[0], ref="r5")]
        self.assertIsNone(RUNNER.multi_tool_action(task, ambiguous, set()))

    def test_copies_only_between_one_visible_textarea_and_one_editable_textbox(self):
        source = {"ref": "r1", "role": "textarea", "kind": "textarea", "label": "Source text"}
        target = {"ref": "r2", "role": "input", "kind": "text", "label": "Destination text"}
        submit = {"ref": "r3", "role": "button", "kind": "button", "label": "Submit", "risk": "approval-required"}
        candidates = [source, target, submit]
        task = "Copy the text in the textarea below, paste it into the textbox and press Submit."

        planned = RUNNER.multi_tool_action(task, candidates, set())
        self.assertEqual(planned, ("copy-field", {"sourceRef": "r1", "targetRef": "r2"}, {"fieldKind": "local-copy", "characterCount": "not-returned"}))
        completed = {RUNNER.field_key(target)}
        self.assertEqual(
            RUNNER.multi_tool_action(task, candidates, completed),
            ("act", {"ref": "r3"}, {"fieldKind": "submit-after-local-copy"}),
        )

        ambiguous = [source, target, dict(target, ref="r4", label="Second destination"), submit]
        self.assertIsNone(RUNNER.multi_tool_action(task, ambiguous, set()))

    def test_extracts_explicit_slider_targets_and_plans_one_direct_range_call_at_a_time(self):
        candidates = [
            {"ref": "r1", "role": "slider", "kind": "range", "label": "Slider one"},
            {"ref": "r2", "role": "slider", "kind": "range", "label": "Slider two"},
            {"ref": "r3", "role": "slider", "kind": "range", "label": "Slider three"},
        ]
        task = "Set the sliders to [16, 17, 0]."

        first = RUNNER.multi_tool_action(task, candidates, set())
        self.assertEqual(first, ("set-range", {"ref": "r1", "value": 16.0}, {"fieldKind": "range", "fieldOrdinal": 1}))
        self.assertNotIn("16", str(first[2]))

        completed = {RUNNER.field_key(candidates[0])}
        second = RUNNER.multi_tool_action(task, candidates, completed)
        self.assertEqual(second, ("set-range", {"ref": "r2", "value": 17.0}, {"fieldKind": "range", "fieldOrdinal": 2}))

        completed.update(RUNNER.field_key(candidate) for candidate in candidates[1:])
        self.assertIsNone(RUNNER.multi_tool_action(task, candidates, completed))

    def test_does_not_plan_range_tool_calls_with_invalid_values_or_mismatched_slider_count(self):
        candidates = [{"ref": "r1", "role": "slider", "kind": "range", "label": "Slider one"}]
        self.assertIsNone(RUNNER.multi_tool_action("Set the sliders to [1, nope].", candidates, set()))
        self.assertIsNone(RUNNER.multi_tool_action("Set the sliders to [1, 2].", candidates, set()))

    def test_submits_only_after_every_explicit_slider_target_is_complete(self):
        sliders = [
            {"ref": "r1", "role": "slider", "kind": "range", "label": "Slider one"},
            {"ref": "r2", "role": "slider", "kind": "range", "label": "Slider two"},
        ]
        submit = {"ref": "r3", "role": "button", "kind": "button", "label": "Submit", "risk": "approval-required"}
        task = "Set the sliders to [16, 17] and submit."

        first = RUNNER.multi_tool_action(task, sliders + [submit], set())
        self.assertEqual(first[0], "set-range")
        completed = {RUNNER.field_key(slider) for slider in sliders}
        final = RUNNER.multi_tool_action(task, sliders + [submit], completed)
        self.assertEqual(final, ("act", {"ref": "r3"}, {"fieldKind": "submit-after-explicit-slider-entry"}))
        self.assertNotIn("16", str(final[2]))

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

    def test_orders_five_unique_confident_visual_numbers_and_converts_screenshot_boxes(self):
        lines = []
        for number, x in [(4, 120), (1, 30), (5, 240), (2, 70), (3, 100)]:
            lines.append({
                "text": str(number),
                "confidence": 90,
                "box": {"x0": x, "y0": 20, "x1": x + 12, "y1": 40},
                "words": [{"text": str(number), "confidence": 90, "box": {"x0": x, "y0": 20, "x1": x + 12, "y1": 40}}],
            })
        result = RUNNER.extract_ascending_number_targets({
            "viewport": {"width": 332, "height": 214},
            "screenshotPixels": {"width": 664, "height": 428},
            "lines": lines,
        })
        self.assertEqual([target["number"] for target in result], [1, 2, 3, 4, 5])
        self.assertEqual([target["x"] for target in result], [18, 38, 53, 63, 123])
        self.assertTrue(all(target["y"] == 15 for target in result))

    def test_orders_per_character_symbols_when_ocr_groups_adjacent_digits(self):
        lines = [{
            "text": "345",
            "confidence": 31,
            "box": {"x0": 20, "y0": 20, "x1": 100, "y1": 40},
            "words": [
                {"text": "3", "confidence": 99, "box": {"x0": 20, "y0": 20, "x1": 30, "y1": 40}},
                {"text": "4", "confidence": 90, "box": {"x0": 50, "y0": 20, "x1": 60, "y1": 40}},
                {"text": "5", "confidence": 99, "box": {"x0": 90, "y0": 20, "x1": 100, "y1": 40}},
                {"text": "1", "confidence": 99, "box": {"x0": 20, "y0": 80, "x1": 30, "y1": 100}},
                {"text": "2", "confidence": 99, "box": {"x0": 80, "y0": 110, "x1": 90, "y1": 130}},
            ],
        }]

        result = RUNNER.extract_ascending_number_targets({
            "viewport": {"width": 120, "height": 140},
            "screenshotPixels": {"width": 120, "height": 140},
            "lines": lines,
        })

        self.assertEqual([target["number"] for target in result], [1, 2, 3, 4, 5])
        self.assertEqual([(target["x"], target["y"]) for target in result], [(25, 90), (85, 120), (25, 30), (55, 30), (95, 30)])

    def test_refuses_duplicate_missing_low_confidence_or_unscaled_visual_number_targets(self):
        def word(number, x, confidence=90):
            return {"text": str(number), "confidence": confidence, "box": {"x0": x, "y0": 20, "x1": x + 12, "y1": 40}}

        base = {
            "viewport": {"width": 332, "height": 214},
            "screenshotPixels": {"width": 332, "height": 214},
            "lines": [{"text": str(number), "confidence": 90, "box": word(number, number * 10)["box"], "words": [word(number, number * 10)]} for number in range(1, 6)],
        }
        duplicate = {**base, "lines": [*base["lines"], base["lines"][0]]}
        missing = {**base, "lines": base["lines"][:-1]}
        low_confidence = {**base, "lines": [*base["lines"][:4], {"text": "5", "confidence": 20, "box": word(5, 50, 20)["box"], "words": [word(5, 50, 20)]}]}
        invalid_dimensions = {**base, "screenshotPixels": {"width": 0, "height": 214}}
        for value in (duplicate, missing, low_confidence, invalid_dimensions):
            with self.subTest(value=value):
                self.assertIsNone(RUNNER.extract_ascending_number_targets(value))

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
        submit = {"ref": "r6", "role": "button", "kind": "button", "label": "Submit", "risk": "approval-required"}
        candidates = radios + [textbox_one, textbox_two, submit]
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

        checked_radios = [dict(item, checked=(item["ref"] == "r3")) for item in radios]
        completed_after_fill = completed | {RUNNER.field_key(textbox_two)}
        submit_action = RUNNER.multi_tool_action(task, checked_radios + [textbox_one, textbox_two, submit], completed_after_fill)
        self.assertEqual(submit_action[0], "act")
        self.assertEqual(submit_action[1], {"ref": "r6"})
        self.assertEqual(submit_action[2], {"fieldKind": "submit-after-explicit-local-form-entry"})

    def test_does_not_treat_a_quoted_widget_type_as_text_to_enter(self):
        candidates = [
            {"ref": "r1", "role": "textarea", "kind": "textarea", "label": "U"},
            {"ref": "r2", "role": "textarea", "kind": "textarea", "label": "qtpDp"},
        ]
        self.assertIsNone(RUNNER.multi_tool_action('Click on a "textarea" widget.', candidates, set()))

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
