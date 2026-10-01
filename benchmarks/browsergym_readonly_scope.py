"""Task and endpoint guards for single-site BrowserGym integration runs."""

from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit


SUITE_ENV = {
    "webarena": {
        "shopping": "WA_SHOPPING",
        "shopping_admin": "WA_SHOPPING_ADMIN",
        "reddit": "WA_REDDIT",
        "gitlab": "WA_GITLAB",
        "wikipedia": "WA_WIKIPEDIA",
        "map": "WA_MAP",
        "homepage": "WA_HOMEPAGE",
    },
    "visualwebarena": {
        "classifieds": "VWA_CLASSIFIEDS",
        "shopping": "VWA_SHOPPING",
        "reddit": "VWA_REDDIT",
        "wikipedia": "VWA_WIKIPEDIA",
        "homepage": "VWA_HOMEPAGE",
    },
}

READ_ONLY_INTENT = re.compile(
    r"^(show|view|list|open|display|browse|find|search|navigate|go to)\b",
    re.IGNORECASE,
)
MUTATING_INTENT = re.compile(
    r"\b(add|archive|book|buy|cancel|checkout|create|delete|disable|download|edit|follow|invite|join|like|login|make|mark|modify|notify|order|post|publish|purchase|register|remove|reply|reserve|reset|save|send|share|sign\s+in|log\s+in|subscribe|submit|transfer|update|upload|upvote|vote|write)\b",
    re.IGNORECASE,
)


def validate_site_url(raw_url: str) -> str:
    normalized = raw_url.strip()
    if "\\" in normalized or any(char.isspace() or ord(char) < 32 for char in normalized) or "?" in normalized or "#" in normalized:
        raise ValueError("--site-url must not contain whitespace, backslashes, queries, or fragments")
    parsed = urlsplit(normalized)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError("--site-url must contain a valid port") from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or (port is not None and not 1 <= port <= 65535)
    ):
        raise ValueError("--site-url must be an absolute HTTP(S) URL without credentials, query, or fragment")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def same_task_page(expected_url: str, connected_url: str) -> bool:
    """Match the visible origin and path; BrowserManager redacts URL queries."""
    expected = urlsplit(expected_url)
    connected = urlsplit(connected_url)
    return (
        expected.scheme,
        expected.netloc,
        expected.path,
    ) == (
        connected.scheme,
        connected.netloc,
        connected.path,
    )


def select_read_only_task(configs, suite: str, task_id: int, site: str) -> dict:
    if suite not in SUITE_ENV:
        raise ValueError(f"Unsupported suite: {suite}")
    if site not in SUITE_ENV[suite]:
        raise ValueError(f"Unsupported {suite} site: {site}")

    id_matches = [item for item in configs if item.get("task_id") == task_id]
    if len(id_matches) != 1:
        raise ValueError(f"Expected one {suite} task with id {task_id}; found {len(id_matches)}")

    item = id_matches[0]
    intent = str(item.get("intent", "")).strip()
    evaluator = item.get("eval") or {}
    if item.get("sites") != [site]:
        raise ValueError("This runner only accepts tasks that use exactly the selected site")
    if item.get("require_reset") is not False:
        raise ValueError("This runner refuses tasks that require or omit an explicit no-reset setting")
    if evaluator.get("eval_types") != ["url_match"]:
        raise ValueError("This runner only accepts URL-match tasks; remote or stateful evaluators are refused")
    if item.get("image"):
        raise ValueError("This text-only runner refuses tasks with reference images")
    if not READ_ONLY_INTENT.search(intent) or MUTATING_INTENT.search(intent):
        raise ValueError("This runner refuses tasks that do not clearly request read-only navigation")

    # Keep evaluator rules, expected URLs, reference answers, and task images
    # out of the record and away from the decision provider.
    return {
        "suite": suite,
        "taskId": task_id,
        "intentTemplateId": item.get("intent_template_id"),
        "intent": intent,
        "site": site,
        "taskType": "read-only-url-navigation",
    }


def scoped_environment(suite: str, site: str, site_url: str) -> dict[str, str]:
    """Point every unused BrowserGym domain at the selected endpoint.

    BrowserGym's instance preflight requires every URL variable to be present.
    Reusing one explicitly selected site prevents the runner from contacting
    unrelated domain services, and the selected task is checked to use only it.
    """
    if suite not in SUITE_ENV:
        raise ValueError(f"Unsupported suite: {suite}")
    if site not in SUITE_ENV[suite]:
        raise ValueError(f"Unsupported {suite} site: {site}")
    url = validate_site_url(site_url)
    values = {variable: url for variable in SUITE_ENV[suite].values()}
    values["WA_FULL_RESET" if suite == "webarena" else "VWA_FULL_RESET"] = ""
    if suite == "visualwebarena":
        values["DATASET"] = "visualwebarena"
        # Safe because reset-required tasks are rejected before environment startup.
        values["VWA_CLASSIFIEDS_RESET_TOKEN"] = "unused-read-only-task"
    return values
