#!/usr/bin/env python3
"""Check BrowserGym WebArena endpoints without exposing configured URLs."""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ENDPOINTS = {
    "webarena": (
        "WA_SHOPPING",
        "WA_SHOPPING_ADMIN",
        "WA_REDDIT",
        "WA_GITLAB",
        "WA_WIKIPEDIA",
        "WA_MAP",
        "WA_HOMEPAGE",
    ),
    "visualwebarena": (
        "VWA_CLASSIFIEDS",
        "VWA_SHOPPING",
        "VWA_REDDIT",
        "VWA_WIKIPEDIA",
        "VWA_HOMEPAGE",
    ),
}
PRESENCE_ONLY = {"visualwebarena": ("VWA_CLASSIFIEDS_RESET_TOKEN",)}
USER_AGENT = "AgentDecisionKit-BrowserGym-Preflight/0.1"


def check_url(name: str, value: str, timeout: float, output, opener=None) -> bool:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname
    except ValueError:
        output(f"FAIL {name}: malformed URL; value hidden")
        return False
    if parsed.scheme not in {"http", "https"} or not host:
        output(f"FAIL {name}: expected an http(s) URL with a host; value hidden")
        return False
    try:
        if parsed.port is not None and not 1 <= parsed.port <= 65535:
            output(f"FAIL {name}: invalid port; value hidden")
            return False
    except ValueError:
        output(f"FAIL {name}: invalid port; value hidden")
        return False
    if parsed.username or parsed.password:
        output(f"FAIL {name}: credentials in URLs are unsupported; value hidden")
        return False

    request_url = opener or urlopen
    for method in ("HEAD", "GET"):
        headers = {"User-Agent": USER_AGENT}
        if method == "GET":
            headers["Range"] = "bytes=0-0"
        request = Request(value, headers=headers, method=method)
        try:
            with request_url(request, timeout=timeout) as response:
                status = response.status
        except HTTPError as error:
            status = error.code
            error.close()
        except (URLError, TimeoutError, OSError, ValueError):
            output(f"FAIL {name}: endpoint did not respond; URL hidden")
            return False

        if method == "HEAD" and status in {405, 501}:
            continue
        if 200 <= status < 400:
            output(f"OK {name}: HTTP {status}")
            return True
        output(f"FAIL {name}: HTTP {status}; check endpoint reachability or access")
        return False

    output(f"FAIL {name}: endpoint does not support HEAD or a ranged GET; URL hidden")
    return False


def check_suite(suite: str, environ: Mapping[str, str], timeout: float, output, opener=None) -> bool:
    success = True
    for name in ENDPOINTS[suite]:
        value = environ.get(name, "").strip()
        if not value:
            output(f"MISSING {name}")
            success = False
            continue
        success = check_url(name, value, timeout, output, opener) and success

    for name in PRESENCE_ONLY.get(suite, ()):
        if environ.get(name, "").strip():
            output(f"OK {name}: configured (value hidden)")
        else:
            output(f"MISSING {name} (value is never displayed)")
            success = False

    return success


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=("webarena", "visualwebarena", "all"), default="all")
    parser.add_argument("--timeout", type=float, default=5.0, help="Per-endpoint timeout in seconds")
    args = parser.parse_args(argv)
    if args.timeout <= 0:
        parser.error("--timeout must be greater than zero")

    suites = tuple(ENDPOINTS) if args.suite == "all" else (args.suite,)
    results = [check_suite(suite, os.environ, args.timeout, print) for suite in suites]
    if all(results):
        print("BrowserGym service preflight passed. No URL values or response bodies were printed.")
        return 0
    print("BrowserGym service preflight incomplete. Set the missing variables before running these suites.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
