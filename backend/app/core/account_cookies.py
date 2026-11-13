"""Read Muse cookies from whatever users paste, without echoing secrets.

Users copy cookies in many shapes: a Cookie header, `document.cookie`, a
whole DevTools request-header block, "Copy as cURL"/"Copy as fetch", browser
extension JSON exports (often containing every site's cookies), Playwright
storage state, Netscape `cookies.txt`, or rows from the DevTools cookie table.
Parsing is lenient: anything that is not a usable muse.ai cookie is skipped.
Only two outcomes are errors: no cookie could be read at all
(`invalid_cookies`), or no non-empty `hatch_sess` was found
(`missing_session`). Error messages never include the input.
"""

import json
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

SESSION_COOKIE = "hatch_sess"
MAX_COOKIES = 100
MAX_VALUE_LENGTH = 8192
# 9999-12-31T23:59:59Z; larger values are not real expiry timestamps.
MAX_EXPIRY = 253402300800

COOKIE_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$")
# A `cookie:` header line in a raw request-header block (any case, HTTP/1 or 2).
HEADER_LINE = re.compile(
    r"^[ \t]*cookie[ \t]*:[ \t]*(.+?)[ \t]*$", re.IGNORECASE | re.MULTILINE
)
# curl: -H 'Cookie: …' / --header "cookie: …" / -b '…' / --cookie "…"
CURL_HEADER = re.compile(
    r"""(?:-H|--header)\s+(['"])\s*cookie\s*:\s*(.*?)\1""", re.IGNORECASE | re.DOTALL
)
CURL_COOKIE = re.compile(r"""(?:\s|^)(?:-b|--cookie)\s+(['"])(.*?)\1""", re.DOTALL)
# fetch(): headers: { "cookie": "…" }
FETCH_HEADER = re.compile(
    r"""(['"])cookie\1\s*[:=]\s*(['"])(.*?)\2""", re.IGNORECASE | re.DOTALL
)
# Cookie values: printable ASCII except ";" (no spaces, controls, or Unicode).
INVALID_VALUE_CHARACTER = re.compile(r"[^\x21-\x3a\x3c-\x7e]")
# Response headers: only the first name=value of each Set-Cookie line counts.
SET_COOKIE_LINE = re.compile(
    r"^[ \t]*set-cookie[ \t]*:[ \t]*(.+?)[ \t]*$", re.IGNORECASE | re.MULTILINE
)
# "Copy as PowerShell": New-Object System.Net.Cookie("name", "value", "/", "domain")
POWERSHELL_COOKIE = re.compile(
    r'System\.Net\.Cookie\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"'
)
# Set-Cookie attributes that appear when users copy response headers.
COOKIE_ATTRIBUTES = {
    "path",
    "domain",
    "expires",
    "max-age",
    "samesite",
    "secure",
    "httponly",
    "priority",
    "partitioned",
}


class CookieImportError(ValueError):
    def __init__(self, code="invalid_cookies"):
        super().__init__(
            "A session cookie is required."
            if code == "missing_session"
            else "Invalid cookie import format."
        )
        self.code = code


@dataclass(frozen=True)
class _Candidate:
    name: object
    value: object
    domain: object = None
    expiry: object = None


def parse_cookie_bundle(text: str) -> tuple[dict[str, str], dict[str, int]]:
    """Return (cookies, expiries) for muse.ai from pasted text."""
    candidates = _candidates(_unwrap(text))
    now = time.time()
    cookies: dict[str, str] = {}
    expiries: dict[str, int] = {}
    ranks: dict[str, tuple] = {}
    for candidate in candidates:
        domain_rank = _rank(candidate)
        if domain_rank is None:
            continue
        name, expiry = candidate.name, _expiry(candidate.expiry)
        # Duplicate names (several domains, paths, or stale exports): prefer a
        # non-empty value, then one that has not expired, then one that
        # applies to muse.ai itself, then the first one seen.
        rank = (
            candidate.value == "",
            expiry is not None and expiry <= now,
            domain_rank,
        )
        if name in cookies and ranks[name] <= rank:
            continue
        cookies[name], ranks[name] = candidate.value, rank
        if expiry is None:
            expiries.pop(name, None)
        else:
            expiries[name] = expiry
    if not cookies:
        raise CookieImportError
    if not cookies.get(SESSION_COOKIE):
        raise CookieImportError("missing_session")
    return limit_cookies(cookies, expiries)


def limit_cookies(
    cookies: dict[str, str], expiries: dict[str, int]
) -> tuple[dict[str, str], dict[str, int]]:
    """Keep at most MAX_COOKIES (the stored limit), always including the session.

    Used for imports and for cookie jars Muse grows during operations.
    """
    if len(cookies) <= MAX_COOKIES:
        return cookies, expiries
    others = [name for name in cookies if name != SESSION_COOKIE]
    kept = (
        [SESSION_COOKIE, *others[: MAX_COOKIES - 1]]
        if SESSION_COOKIE in cookies
        else others[:MAX_COOKIES]
    )
    cookies = {name: cookies[name] for name in kept}
    return cookies, {name: value for name, value in expiries.items() if name in cookies}


def account_expiry(expiries: dict[str, int]):
    value = expiries.get("hatch_vml") or expiries.get(SESSION_COOKIE)
    return datetime.fromtimestamp(value, UTC) if value else None


def _unwrap(text: str) -> str:
    text = text.replace("﻿", "").strip()
    # `document.cookie` copied from the console is wrapped in quotes.
    if (
        len(text) >= 2
        and text[0] == text[-1]
        and text[0] in "'\"`"
        and text[0] not in text[1:-1]
    ):
        text = text[1:-1].strip()
    return text


def _candidates(text: str) -> list[_Candidate]:
    # Windows "Copy as cURL (cmd)" escapes quotes and specials with ^.
    if re.match(r'\s*curl(?:\.exe)?\s+\^"', text, re.IGNORECASE):
        text = re.sub(r"\^(.)", r"\1", text)
    powershell = POWERSHELL_COOKIE.findall(text)
    if powershell:
        return [_Candidate(name, value, domain) for name, value, domain in powershell]
    if text[:1] in "{[":
        try:
            return _from_json(json.loads(text))
        except (ValueError, RecursionError):
            pass  # Not JSON after all; try the text formats.
    embedded = _embedded_headers(text)
    set_cookies = [_from_set_cookie(line) for line in SET_COOKIE_LINE.findall(text)]
    if embedded or set_cookies:
        # Response Set-Cookie lines come first: they are newer than the
        # request's Cookie header (e.g. a hatch_sess Muse just rotated), and
        # the first cookie wins a tie.
        return [candidate for candidate in set_cookies if candidate is not None] + [
            candidate for header in embedded for candidate in _from_header(header)
        ]
    if "\t" in text:
        rows = _from_tab_separated(text)
        if rows:
            return rows
    return _from_header(text)


def _embedded_headers(text: str) -> list[str]:
    for pattern, group in ((CURL_HEADER, 2), (FETCH_HEADER, 3), (CURL_COOKIE, 2)):
        found = [match.group(group) for match in pattern.finditer(text)]
        if found:
            return found
    # Request-header block (cookie:); Set-Cookie lines are read separately.
    return HEADER_LINE.findall(text)


def _from_set_cookie(line: str) -> _Candidate | None:
    """First name=value of a Set-Cookie line, with Domain and expiry kept."""
    pair, *attributes = line.split(";")
    name, separator, value = pair.strip().partition("=")
    if not separator:
        return None
    domain, expiry = None, None
    for attribute in attributes:
        key, _, attribute_value = attribute.strip().partition("=")
        key, attribute_value = key.strip().lower(), attribute_value.strip()
        if key == "domain":
            domain = attribute_value
        elif key == "max-age":
            try:
                seconds = int(attribute_value)
            except ValueError:
                continue
            # Max-Age wins over Expires; <= 0 means already expired.
            expiry = time.time() + seconds if seconds > 0 else 1
        elif key == "expires" and expiry is None:
            try:
                # Clamp so dates at or before the epoch still count as expired.
                expiry = max(parsedate_to_datetime(attribute_value).timestamp(), 1)
            except (TypeError, ValueError):
                pass
    return _Candidate(name.strip(), value.strip(), domain, expiry)


def _from_json(data) -> list[_Candidate]:
    if isinstance(data, dict) and isinstance(data.get("cookies"), list):
        data = data["cookies"]  # Playwright/Puppeteer storage state.
    if isinstance(data, dict):
        return [_Candidate(name, value) for name, value in data.items()]
    if isinstance(data, list):
        return [
            _Candidate(
                entry.get("name"),
                entry.get("value"),
                entry.get("domain"),
                entry.get("expirationDate", entry.get("expires")),
            )
            for entry in data
            if isinstance(entry, dict)
        ]
    return []


def _from_header(text: str) -> list[_Candidate]:
    candidates = []
    for part in re.split(r"[;\r\n]+", text):
        name, separator, value = part.strip().partition("=")
        name = name.strip()
        # Skip flags (HttpOnly), Set-Cookie attributes (Path=/), stray words.
        if separator and name.lower() not in COOKIE_ATTRIBUTES:
            candidates.append(_Candidate(name, value.strip()))
    return candidates


def _from_tab_separated(text: str) -> list[_Candidate]:
    candidates = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#HttpOnly_"):
            line = stripped[len("#HttpOnly_") :]
        elif not stripped or stripped.startswith("#"):
            continue
        fields = [field.strip() for field in line.split("\t")]
        if len(fields) >= 7 and fields[1].upper() in ("TRUE", "FALSE"):
            # Netscape cookies.txt: domain, subdomains, path, secure, expiry, name, value
            candidates.append(
                _Candidate(fields[5], fields[6], fields[0], _number(fields[4]))
            )
        elif len(fields) >= 3:
            # DevTools cookie table: name, value, domain, path, expires, …
            candidates.append(
                _Candidate(
                    fields[0],
                    fields[1],
                    fields[2],
                    _iso_timestamp(fields[4]) if len(fields) > 4 else None,
                )
            )
    return candidates


def _rank(candidate: _Candidate) -> int | None:
    """0 = applies to muse.ai, 1 = a muse.ai subdomain, None = unusable."""
    name, value, domain = candidate.name, candidate.value, candidate.domain
    if not isinstance(name, str) or not COOKIE_NAME.fullmatch(name):
        return None
    if (
        not isinstance(value, str)
        or len(value) > MAX_VALUE_LENGTH
        or INVALID_VALUE_CHARACTER.search(value)
    ):
        return None
    if domain is None or domain == "":
        return 0
    if not isinstance(domain, str):
        return None
    host = domain.strip().lower().lstrip(".")
    if host == "muse.ai":
        return 0
    return 1 if host.endswith(".muse.ai") else None


def _expiry(value) -> int | None:
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and 0 < value < MAX_EXPIRY
    ):
        return int(value)
    return None


def _number(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def _iso_timestamp(value: str) -> float | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None  # "Session" or an unrecognized date.
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)).timestamp()
