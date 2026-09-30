import io
import unittest
from unittest.mock import patch
from urllib.error import URLError

import check_browsergym_services as preflight


class MockResponse:
    def __init__(self, status):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class BrowserGymPreflightTests(unittest.TestCase):
    def test_missing_environment_reports_names_without_network_calls(self):
        output = io.StringIO()
        with patch.object(preflight, "urlopen") as opener:
            passed = preflight.check_suite("webarena", {}, 1.0, output.write, opener)

        self.assertFalse(passed)
        self.assertIn("MISSING WA_SHOPPING", output.getvalue())
        opener.assert_not_called()

    def test_successful_suite_checks_only_status_and_hides_secret(self):
        environment = {name: "https://example.test/" for name in preflight.ENDPOINTS["visualwebarena"]}
        environment["VWA_CLASSIFIEDS_RESET_TOKEN"] = "do-not-print-this-token"
        output = io.StringIO()
        with patch.object(preflight, "urlopen", return_value=MockResponse(200)):
            passed = preflight.check_suite("visualwebarena", environment, 1.0, output.write)

        self.assertTrue(passed)
        self.assertIn("OK VWA_CLASSIFIEDS_RESET_TOKEN: configured (value hidden)", output.getvalue())
        self.assertNotIn("do-not-print-this-token", output.getvalue())

    def test_head_not_supported_falls_back_to_a_ranged_get(self):
        output = io.StringIO()
        with patch.object(preflight, "urlopen", side_effect=[MockResponse(405), MockResponse(200)]) as opener:
            passed = preflight.check_url("WA_SHOPPING", "https://example.test/", 1.0, output.write)

        self.assertTrue(passed)
        self.assertEqual(opener.call_count, 2)
        self.assertEqual(opener.call_args_list[0].args[0].get_method(), "HEAD")
        self.assertEqual(opener.call_args_list[1].args[0].get_method(), "GET")

    def test_network_errors_do_not_echo_credentials_or_urls(self):
        output = io.StringIO()
        with patch.object(preflight, "urlopen", side_effect=URLError("credential=secret url=https://example.test?token=hidden")):
            passed = preflight.check_url("WA_SHOPPING", "https://example.test/path", 1.0, output.write)

        self.assertFalse(passed)
        self.assertNotIn("secret", output.getvalue())
        self.assertNotIn("https://example.test?token=hidden", output.getvalue())

    def test_credentials_in_endpoint_urls_are_rejected_without_echoing_values(self):
        output = io.StringIO()
        secret_url = "https://user:secret@example.test/path?token=hidden"
        with patch.object(preflight, "urlopen") as opener:
            passed = preflight.check_url("WA_SHOPPING", secret_url, 1.0, output.write)

        self.assertFalse(passed)
        self.assertNotIn("user:secret", output.getvalue())
        self.assertNotIn("?token=hidden", output.getvalue())
        opener.assert_not_called()

    def test_malformed_url_is_reported_without_network_access(self):
        output = io.StringIO()
        with patch.object(preflight, "urlopen") as opener:
            passed = preflight.check_url("WA_SHOPPING", "http://[broken", 1.0, output.write)

        self.assertFalse(passed)
        self.assertIn("malformed URL", output.getvalue())
        opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
