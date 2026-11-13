#!/usr/bin/env python3
"""Expand authoring macros in src/*.dc.html -> canvas/project/*.dc.html (self-contained artboards)."""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).parent
CSS = (ROOT / 'muse.css').read_text()
CSS = re.sub(r'/\*.*?\*/', '', CSS, flags=re.S)
CSS = re.sub(r'\s*\n\s*', '\n', CSS).strip()

FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&amp;family=JetBrains+Mono:wght@400;500&amp;display=swap">'

I = {
 'home':'<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
 'film':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
 'spark':'<path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 15.5v4M17 17.5h4"/>',
 'image':'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
 'activity':'<path d="M3 12h4l3-8 4 16 3-8h4"/>',
 'users':'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
 'key':'<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M17 6l3 3M14 9l2 2"/>',
 'terminal':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
 'book':'<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20"/>',
 'sliders':'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'search':'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 'check':'<path d="m5 12.5 4.5 4.5L19 7"/>',
 'x':'<path d="M6 6l12 12M18 6 6 18"/>',
 'alert':'<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
 'alertc':'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
 'info':'<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
 'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 'spin':'<path d="M12 3a9 9 0 1 0 9 9"/>',
 'slash':'<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
 'play':'<path d="M7 4.5v15l13-7.5z"/>',
 'pause':'<path d="M8 5v14M16 5v14"/>',
 'download':'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
 'upload':'<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
 'copy':'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
 'eye':'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
 'eyeoff':'<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
 'retry':'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
 'trash':'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
 'more':'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
 'chevr':'<path d="m9 6 6 6-6 6"/>',
 'chevl':'<path d="m15 6-6 6 6 6"/>',
 'chevd':'<path d="m6 9 6 6 6-6"/>',
 'arrowl':'<path d="M19 12H5M11 6l-6 6 6 6"/>',
 'arrowr':'<path d="M5 12h14M13 6l6 6-6 6"/>',
 'edit':'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
 'grid':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
 'list':'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
 'music':'<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
 'user':'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 'palette':'<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1.2-1-1.5-1-2.5s.8-1.5 2-1.5H17a4 4 0 0 0 4-4c0-4.7-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
 'video':'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
 'globe':'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
 'login':'<path d="M10 17l5-5-5-5M15 12H3M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/>',
 'puzzle':'<path d="M9 4h6v3a1.5 1.5 0 0 0 3 0V4h2v6h-3a1.5 1.5 0 0 0 0 3h3v7H4v-7h3a1.5 1.5 0 0 0 0-3H4V4h2v3a1.5 1.5 0 0 0 3 0z"/>',
 'file':'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
 'layers':'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
 'external':'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
 'r169':'<rect x="2.5" y="6.5" width="19" height="11" rx="2"/>',
 'r916':'<rect x="7" y="2.5" width="10" height="19" rx="2"/>',
 'r11':'<rect x="4.5" y="4.5" width="15" height="15" rx="2"/>',
 'filter':'<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
 'keyboard':'<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
 'stop':'<rect x="6" y="6" width="12" height="12" rx="2"/>',
 'merge':'<path d="M6 3v6a6 6 0 0 0 6 6h6M18 15l-3-3M18 15l-3 3M6 21v-4"/>',
 'scissors':'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
 'paste':'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
 'shield':'<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/>',
 'zap':'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
 'calendar':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
 'send':'<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
 'monitor':'<rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
 'phone':'<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>',
 'tablet':'<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M11 18h2"/>',
}

def icon(name, cls=''):
    body = I[name]
    c = 'ic' + (' ' + cls if cls else '')
    if name == 'spin':
        c += ' spin'
    if name == 'play':
        c += ' fill'
    return f'<svg class="{c}" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'

SB = {  # static badge kinds -> (class, icon)
 'wait':('b-wait','clock'), 'run':('b-run','spin'), 'ok':('b-ok','check'), 'err':('b-err','alertc'),
 'cancel':('b-cancel','slash'), 'next':('b-next','edit'), 'warn':('b-warn','alert'), 'neutral':('b-neutral',None),
}

def sbadge(kind, label):
    cls, ic = SB[kind]
    return f'<span class="badge {cls}">' + (icon(ic) if ic else '') + f'<span>{label}</span></span>'

def dbadge(v):
    parts = [f'<span class="badge {{{{{v}.cls}}}}">']
    for flag, ic in [('isRun','spin'),('isOk','check'),('isErr','alertc'),('isWait','clock'),('isCancel','slash'),('isNext','edit'),('isWarn','alert')]:
        parts.append(f'<sc-if value="{{{{{v}.{flag}}}}}" hint-placeholder-val="{{{{ false }}}}">{icon(ic)}</sc-if>')
    parts.append(f'<span>{{{{{v}.label}}}}</span></span>')
    return ''.join(parts)

STAT = """stat(k){var M={wait:['Đang chờ','b-wait'],run:['Đang xử lý','b-run'],ok:['Hoàn tất','b-ok'],err:['Lỗi','b-err'],cancel:['Đã hủy','b-cancel'],next:['Chờ duyệt','b-next'],draft:['Bản nháp','b-wait'],warn:['Cần xử lý','b-warn'],merge:['Đang ghép','b-run'],render:['Đang render','b-run']};var m=M[k]||M.wait;return{k:k,label:m[0],cls:m[1],isWait:k==='wait'||k==='draft',isRun:k==='run'||k==='merge'||k==='render',isOk:k==='ok',isErr:k==='err',isCancel:k==='cancel',isNext:k==='next',isWarn:k==='warn'};}"""

NAV1 = [('dashboard','Dashboard.dc.html','home','Tổng quan',''),
        ('projects','Projects.dc.html','film','Video Studio',''),
        ('quick','QuickCreate.dc.html','spark','Tạo nhanh',''),
        ('library','Library.dc.html','image','Thư viện',''),
        ('tasks','Tasks.dc.html','activity','Tác vụ','<span class="cnt err" title="2 tác vụ lỗi">2</span><span class="dot-badge err"></span>')]
NAV2 = [('accounts','Accounts.dc.html','users','Tài khoản Muse','<span class="cnt warn" title="3 tài khoản cần xử lý">3</span><span class="dot-badge warn"></span>'),
        ('api','Api.dc.html','key','Kết nối &amp; API',''),
        ('playground','Playground.dc.html','terminal','Playground',''),
        ('docs','Api.dc.html#docs','book','Tài liệu','')]

def side(key, rail=False):
    def items(lst):
        out = []
        for k, href, ic, label, extra in lst:
            cur = 'page' if k == key else 'false'
            out.append(f'<a href="{href}" aria-current="{cur}" title="{label}">{icon(ic)}<span class="lbl">{label}</span>{extra}</a>')
        return '\n'.join(out)
    cls = 'side rail' if rail else 'side'
    return f'''<nav class="{cls}" aria-label="Điều hướng chính">
<a class="brand" href="Dashboard.dc.html" aria-label="MUSE2API – Tổng quan"><span class="brand-mark">M2</span><span class="brand-name">MUSE2API</span></a>
<div class="nav-g">Sáng tạo</div>
<div class="nav">
{items(NAV1)}
</div>
<div class="nav-sep"></div>
<div class="nav-g">Quản trị &amp; tích hợp</div>
<div class="nav">
{items(NAV2)}
</div>
<div class="side-foot">
<a class="health" href="Accounts.dc.html"><span style="display: flex; justify-content: space-between"><span>Tài khoản khả dụng</span><b class="num">4/7</b></span><span class="hbar" aria-hidden="true"><i class="ok"></i><i class="ok"></i><i class="ok"></i><i class="warn"></i><i class="err"></i><i class="err"></i><i></i></span></a>
<div class="nav"><a href="Settings.dc.html" aria-current="{'page' if key=='settings' else 'false'}" title="Cài đặt">{icon('sliders')}<span class="lbl">Cài đặt</span></a></div>
</div>
</nav>'''

TOP = f'''<header class="topbar">
<button class="search" type="button" aria-label="Tìm kiếm (Ctrl K)">{icon('search')}<span>Tìm dự án, media, tài khoản…</span><span class="kbd">Ctrl K</span></button>
<div class="top-r">
<a class="pill-link" href="Tasks.dc.html"><span class="dot run"></span><span class="num">2 đang chạy</span><span class="vsep"></span><span style="color: var(--err)" class="num">2 lỗi</span></a>
<span class="demo-tag">DỮ LIỆU DEMO</span>
</div>
</header>'''

def head(extra=''):
    return f'{FONT}\n<style>\n{CSS}\n{extra}\n</style>'

def expand(src):
    s = src
    s = re.sub(r'<!--@HEAD-->', lambda m: head(), s)
    s = re.sub(r'<!--@SIDE:(\w+)-->', lambda m: side(m.group(1)), s)
    s = re.sub(r'<!--@RAIL:(\w+)-->', lambda m: side(m.group(1), rail=True), s)
    s = s.replace('<!--@TOP-->', TOP)
    s = s.replace('/*@STAT*/', STAT)
    s = re.sub(r'%%sb:(\w+):([^%]+)%%', lambda m: sbadge(m.group(1), m.group(2)), s)
    s = re.sub(r'%%badge:([\w.]+)%%', lambda m: dbadge(m.group(1)), s)
    s = re.sub(r'%%(\w+)(?:\|([\w ]+))?%%', lambda m: icon(m.group(1), m.group(2) or ''), s)
    left = re.findall(r'%%|<!--@', s)
    if left:
        sys.exit(f'unexpanded macro in output: {left[:3]}')
    return s

if __name__ == '__main__':
    out = ROOT.parent / 'canvas' / 'project'
    out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:]:
        src = (ROOT / 'src' / name).read_text()
        res = expand(src)
        (out / name).write_text(res)
        print(name, len(res), 'bytes')
