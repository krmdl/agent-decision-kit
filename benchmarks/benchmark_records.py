"""Helpers for keeping machine-local paths out of checked-in benchmark data."""
import re
from urllib.parse import unquote, urlsplit


LOCAL_MINIWOB_ROOT = "<local-miniwob-root>"
_FILE_URL = re.compile(r"(?i)file:///[^\s\"'<>]+")
_WINDOWS_USER_PATH = re.compile(r"(?i)\b[A-Z]:[\\/]+Users[\\/]+[^\\/\s\"'<>]+(?:[\\/][^\s\"'<>]*)?")
_UNIX_USER_PATH = re.compile(r"(?i)(?:/Users|/home)/[^/\s\"'<>]+(?:/[^\s\"'<>]*)?")


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
