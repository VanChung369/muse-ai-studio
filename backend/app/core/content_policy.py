"""Content the studio refuses to send to Muse.

Gambling, drugs, weapons and explosives, sexual content (and anything sexual
involving minors), terrorism, fraud, hacking, trafficking and self-harm
instructions are refused before anything is queued: no quota is spent and
the user is told which category and which words were the reason.

Requests are checked where they enter the app (`ContentPolicyMiddleware`:
JSON bodies sent to projects, Quick Create and the /v1 API), and a film's
stored texts again before a render starts (`project_violation`). The lists
are phrases, matched as whole words in lower case; Vietnamese is matched
with its diacritics so unaccented look-alikes do not trip it. Extra terms
come from MUSE_BLOCKED_TERMS (comma-separated, category "custom"), and
MUSE_CONTENT_POLICY=false turns the check off.
"""

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

from starlette.responses import JSONResponse

TERMS: dict[str, tuple[str, ...]] = {
    "gambling": (
        "cờ bạc", "đánh bạc", "đánh bài ăn tiền", "cá độ", "cá cược", "lô đề",
        "số đề", "đánh đề", "xóc đĩa", "tài xỉu", "nhà cái", "sòng bạc", "sòng bài",
        "nổ hũ", "game bài đổi thưởng", "bắn cá đổi thưởng", "casino", "gambling",
        "gamble", "betting", "sportsbook", "bookmaker", "slot machine", "roulette",
        "baccarat", "online poker", "poker online",
    ),
    "drugs": (
        "ma túy", "ma tuý", "ma túy đá", "ma tuý đá", "thuốc lắc", "cần sa",
        "buôn ma túy", "buôn ma tuý", "heroin", "cocaine", "methamphetamine",
        "crystal meth", "cook meth", "ketamine", "fentanyl", "mdma", "marijuana",
        "cannabis", "drug dealing", "drug trafficking",
    ),
    "weapons": (
        "chế tạo bom", "bom tự chế", "chế tạo súng", "súng tự chế", "thuốc nổ",
        "mua bán súng", "buôn bán vũ khí", "make a bomb", "build a bomb",
        "pipe bomb", "homemade explosive", "homemade explosives", "ghost gun",
        "3d printed gun", "arms trafficking",
    ),
    "child_abuse": (
        "ấu dâm", "khiêu dâm trẻ em", "trẻ em khỏa thân", "trẻ em khoả thân",
        "child porn", "child pornography", "csam", "pedophile", "pedophilia",
        "underage sex",
    ),
    "sexual": (
        "khiêu dâm", "phim sex", "clip sex", "ảnh sex", "phim người lớn",
        "mại dâm", "gái gọi", "porn", "porno", "pornography", "pornographic", "xxx",
        "hentai", "sex tape", "prostitution", "escort service",
    ),
    "terrorism": (
        "khủng bố", "đánh bom liều chết", "terrorism", "terrorist attack",
        "suicide bombing", "mass shooting", "isis propaganda",
    ),
    "fraud": (
        "tiền giả", "rửa tiền", "làm giả giấy tờ", "chiếm đoạt tài sản",
        "lừa đảo chiếm đoạt", "counterfeit money", "money laundering", "phishing",
        "fake passport", "ponzi scheme",
    ),
    "hacking": (
        "hack tài khoản", "hack facebook", "đánh cắp tài khoản", "đánh cắp mật khẩu",
        "steal passwords", "ransomware", "ddos attack",
    ),
    "trafficking": (
        "buôn người", "mua bán người", "mua bán nội tạng", "human trafficking",
        "organ trafficking", "wildlife trafficking", "buôn bán động vật hoang dã",
    ),
    "self_harm": (
        "hướng dẫn tự tử", "cách tự tử", "how to kill yourself", "suicide method",
    ),
}

# JSON keys whose values are identifiers, addresses or enums, never prose.
SKIPPED_KEYS = re.compile(r"(?i)(id|ids|url|path|file|mime|kind|status|model|ratio|role|look|language|tone|key)$")
# Requests that can carry text to Muse (or into a film).
GUARDED = ("/api/projects", "/api/quick-create", "/v1/")


@dataclass
class Violation:
    category: str
    term: str

    def message(self) -> str:
        return (
            f'This request was blocked: "{self.term}" is not allowed '
            f"({self.category.replace('_', ' ')}). Remove it and try again."
        )

    def api_detail(self) -> dict:
        return {
            "code": "content_blocked",
            "message": self.message(),
            "category": self.category,
            "term": self.term,
        }


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text).casefold()


@lru_cache(maxsize=8)
def _patterns(extra: str) -> list[tuple[str, str, re.Pattern]]:
    terms = [(category, term) for category, items in TERMS.items() for term in items]
    terms += [
        ("custom", term.strip())
        for term in extra.split(",")
        if term.strip()
    ]
    return [
        (category, term, re.compile(r"(?<!\w)" + re.escape(_normalize(term)) + r"(?!\w)"))
        for category, term in terms
    ]


def _settings():
    from app.core.config import Settings

    return Settings()


def violation(*texts, settings=None) -> Violation | None:
    """The first refused phrase in the given texts, or None."""
    settings = settings or _settings()
    if not getattr(settings, "content_policy", True):
        return None
    text = _normalize("\n".join(t for t in texts if isinstance(t, str) and t))
    if not text:
        return None
    for category, term, pattern in _patterns(getattr(settings, "blocked_terms", "") or ""):
        if pattern.search(text):
            return Violation(category, term)
    return None


def _strings(value, key=""):
    if isinstance(value, str):
        if not SKIPPED_KEYS.search(key):
            yield value
    elif isinstance(value, dict):
        for name, item in value.items():
            yield from _strings(item, str(name))
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item, key)


def project_violation(project, settings=None) -> Violation | None:
    """A film's stored texts: what a render would send to Muse."""
    texts = [
        project.name,
        project.idea,
        project.character_bible,
        project.visual_style,
        project.music,
    ]
    for scene in project.scenes:
        texts += [scene.title, scene.prompt, scene.narration]
    for reference in getattr(project, "references", ()):
        texts.append(reference.name)
    return violation(*texts, settings=settings)


class ContentPolicyMiddleware:
    """Refuses a JSON request with blocked content before any route runs:
    422 `content_blocked` for the app's API, an OpenAI-style 400
    `content_policy_violation` for /v1."""

    def __init__(self, app, settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] not in ("POST", "PUT", "PATCH")
            or not scope["path"].startswith(GUARDED)
            or not getattr(self.settings, "content_policy", True)
        ):
            await self.app(scope, receive, send)
            return
        content_type = dict(scope["headers"]).get(b"content-type", b"").decode("latin-1").lower()
        # Binary upload routes stream up to 200 MB; only skip them when not JSON.
        if "json" not in content_type and scope["path"].endswith(("/media", "/references")):
            await self.app(scope, receive, send)
            return
        body, more, messages = b"", True, []
        while more:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break
            body += message.get("body", b"")
            more = message.get("more_body", False)
        found = None
        try:
            found = violation(*_strings(json.loads(body or b"null")), settings=self.settings)
        except (ValueError, UnicodeDecodeError):
            pass  # Not JSON after all: the route reports it.
        if found:
            if scope["path"].startswith("/v1/"):
                response = JSONResponse(
                    {
                        "error": {
                            "message": found.message(),
                            "type": "invalid_request_error",
                            "param": None,
                            "code": "content_policy_violation",
                        }
                    },
                    status_code=400,
                )
            else:
                response = JSONResponse({"detail": found.api_detail()}, status_code=422)
            await response(scope, receive, send)
            return

        replay = iter(messages)

        async def replayed():
            message = next(replay, None)
            return message if message is not None else await receive()

        await self.app(scope, replayed, send)
