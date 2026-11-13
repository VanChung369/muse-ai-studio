"""Quota UI selectors/parser adapted from MUSE2API; see LICENSE."""

import re
import unicodedata

QUOTA_SETTINGS_JS = "(() => {\n        const visible = e => e.getClientRects().length > 0\n            && getComputedStyle(e).visibility !== 'hidden';\n        const labels = ['Settings', '設定', '设置'];\n        const b = [...document.querySelectorAll('[data-testid=\"hatch-dock-more\"]')].find(visible)\n            || [...document.querySelectorAll('button,[role=button]')].find(e =>\n                visible(e) && labels.includes((e.getAttribute('aria-label') || '').trim()));\n        if (!b) return null;\n        const r = b.getBoundingClientRect();\n        return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});\n    })()"

QUOTA_MENU_JS = "(() => {\n        const visible = e => e.getClientRects().length > 0\n            && getComputedStyle(e).visibility !== 'hidden';\n        const labels = ['Settings', '設定', '设置'];\n        const exact = e => labels.includes((e.textContent || '').trim());\n        // Menu items include a shortcut suffix (for example 設定Ctrl+,).\n        const b = [...document.querySelectorAll('[role=menuitem]')].find(e =>\n            visible(e) && (exact(e) || [...e.querySelectorAll('span,div')].some(exact)))\n            || [...document.querySelectorAll('[role=menu] button,[role=menu] span,[role=menu] div')]\n                .find(e => visible(e) && exact(e));\n        if (!b) return null;\n        const r = b.getBoundingClientRect();\n        return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});\n    })()"

QUOTA_DIALOG_JS = "(() => {\n        const d = [...document.querySelectorAll('[role=dialog],[aria-modal=true]')]\n            .find(e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');\n        return d ? (d.innerText || '') : '';\n    })()"


def parse_quota(txt: str) -> dict:
    """Parse English, traditional Chinese and simplified Chinese usage text."""
    normalized = unicodedata.normalize("NFKC", txt or "")
    lines = [ln.strip() for ln in normalized.splitlines() if ln.strip()]
    start = next(
        (
            i + 1
            for i, ln in enumerate(lines)
            if ln.lower() in ("usage", "用量", "使用量")
        ),
        0,
    )
    lines = lines[start:]
    end = next(
        (i for i, ln in enumerate(lines) if ln.lower() in ("language", "语言", "語言")),
        len(lines),
    )
    lines = lines[:end]
    out: dict = {"raw": "\n".join(lines[:40])}
    for ln in lines:
        if re.fullmatch(".{1,60}?(?:\\s+plan|計劃|计划|方案)", ln, re.I):
            out["plan"] = ln
            break
    text = "\n".join(lines)
    reset = re.search("Weekly limit resets? on ([^\\n]+)", text, re.I)
    if not reset:
        reset = re.search(
            "(?:每(?:週|周|星期)|週|周)(?:上限|限額|限额|額度|额度)(?:會|会|將|将)?(?:於|于|在)\\s*([^\\n]+?)\\s*(?:重設|重置)",
            text,
        )
    if reset:
        out["weekly_reset"] = reset.group(1).strip()
    extra_at = next(
        (
            i
            for i, ln in enumerate(lines)
            if re.match(
                "^(?:(?:Additional|Extra)\\s+tokens|(?:額外|额外)(?:的)?(?:符元|符記|代幣|代币|令牌|憑證|凭证|tokens))",
                ln,
                re.I,
            )
        ),
        len(lines),
    )

    def percentage(line):
        m = re.search("(\\d+(?:\\.\\d+)?)\\s*%\\s*(?:used\\b|已(?:使)?用)", line, re.I)
        if not m:
            m = re.search("已(?:使)?用\\s*(\\d+(?:\\.\\d+)?)\\s*%", line)
        if not m:
            return None
        value = float(m.group(1))
        if not 0 <= value <= 100:
            return None
        return int(value) if value.is_integer() else value

    for ln in lines[:extra_at]:
        value = percentage(ln)
        if value is not None:
            out["weekly_used_pct"] = value
            break
    for ln in lines[extra_at:]:
        value = percentage(ln)
        if value is not None:
            out["extra_used_pct"] = value
            left = re.search("\\(([^)]+)\\)", ln)
            if left:
                out["extra_left"] = left.group(1).strip()
            break
    if re.search("Never expires|永不過期|永不过期", text, re.I):
        out["extra_expires"] = "never"
    out["found"] = "weekly_used_pct" in out
    return out
