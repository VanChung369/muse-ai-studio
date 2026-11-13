import unicodedata


def normalize_search_text(value: str) -> str:
    """Case- and accent-insensitive key for search and name sorting.

    Mirrors `normalizeSearchText` in frontend/src/lib/string.ts so server-side
    search matches what users expect from the previous client-side filter.
    """
    decomposed = unicodedata.normalize("NFD", value.lower())
    stripped = "".join(char for char in decomposed if not "̀" <= char <= "ͯ")
    return stripped.replace("đ", "d")
