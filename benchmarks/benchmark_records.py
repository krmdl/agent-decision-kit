"""Helpers for keeping machine-local paths out of checked-in benchmark data."""
import importlib.metadata
import json
import platform
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit


LOCAL_MINIWOB_ROOT = "<local-miniwob-root>"
_FILE_URL = re.compile(r"(?i)file:///[^\s\"'<>]+")
_WINDOWS_USER_PATH = re.compile(r"(?i)\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s\"'<>]+(?:[\\/][^\s\"'<>]*)?")
_UNIX_USER_PATH = re.compile(r"(?i)(?:/Users|/home)/[^/\s\"'<>]+(?:/[^\s\"'<>]*)?")


def count_executed_actions(trace):
    """Count browser actions that ran, including one whose result detected a loop."""
    return sum(1 for entry in trace if entry.get("status") in {"action-executed", "action-loop-detected"})


def collect_runtime_metadata(root, *, browser_info=None, playwright_node_version=None, node_version=None, browsergym_package_commit=None):
    """Collect version and host details for successful and failed browser episodes."""
    root = Path(root)

    def package_version(name):
        try:
            return importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            return "not-reported"

    if node_version is None:
        try:
            node_version = subprocess.run(["node", "--version"], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            node_version = "not-reported"

    if playwright_node_version is None:
        package_file = root / "node_modules" / "playwright" / "package.json"
        try:
            playwright_node_version = json.loads(package_file.read_text(encoding="utf-8")).get("version", "not-reported")
        except (OSError, json.JSONDecodeError):
            playwright_node_version = "not-reported"

    try:
        agent_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        agent_commit = "not-reported"

    return {
        "agentDecisionKitCommit": agent_commit,
        "browserGymVersion": package_version("browsergym-core"),
        "browserGymPackageCommit": browsergym_package_commit or "not-reported",
        "playwrightPythonVersion": package_version("playwright"),
        "playwrightNodeVersion": playwright_node_version,
        "browserVersion": (browser_info or {}).get("Browser", "not-reported"),
        "pythonVersion": platform.python_version(),
        "nodeVersion": node_version,
        "operatingSystem": platform.platform(),
        "cpu": platform.processor() or "not reported by Python",
        "accelerator": "CPU",
    }


def attach_runtime_metadata(record, metadata):
    """Fill fields missing from a failed episode using its enclosing suite environment."""
    for key, value in metadata.items():
        if record.get(key) in (None, "", "not-reported"):
            record[key] = value
    return record


def sanitize_record(value):
    """Redact local URLs and home-directory paths recursively in JSON data."""
    if isinstance(value, dict):
        return {
            key: LOCAL_MINIWOB_ROOT if key == "miniwobRoot" else sanitize_record(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_record(item) for item in value]
    if not isinstance(value, str):
        return value

    def sanitize_file_url(match):
        filename = unquote(urlsplit(match.group(0)).path).rsplit("/", 1)[-1]
        safe_filename = re.sub(r"[^A-Za-z0-9._-]", "_", filename)
        return f"file:///MINIWOB/{safe_filename}" if safe_filename else "file:///MINIWOB/"

    sanitized = _FILE_URL.sub(sanitize_file_url, value)
    sanitized = _WINDOWS_USER_PATH.sub("<local-windows-path>", sanitized)
    return _UNIX_USER_PATH.sub("<local-user-path>", sanitized)
