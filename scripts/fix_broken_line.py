#!/usr/bin/env python3
"""Fix broken LINE share buttons with escaped single-quote literal JS in href."""
import re
import os

TOOLS = [
    '/home/sishizaw/real-estate-project/tools/1-ai-satei.html',
    '/home/sishizaw/real-estate-project/tools/2-akiya-hunter.html',
    '/home/sishizaw/real-estate-project/tools/3-owner-direct.html',
    '/home/sishizaw/real-estate-project/tools/4-kanri-saas.html',
    '/home/sishizaw/real-estate-project/tools/5-toushi-bunseki.html',
]

ESC_SQ = re.escape("\\'")   # matches literal backslash-singlequote in file

# Match the broken button pattern, capturing the share text
pattern_str = (
    r'<div style="margin-top:10px;text-align:center">'
    r'<a href="https://social-plugins\.line\.me/lineit/share[^"]*'
    + ESC_SQ + r'&text=' + ESC_SQ + r'\s*\+\s*encodeURIComponent\('
    + ESC_SQ + r'(.*?)' + ESC_SQ
    + r'(?:\s*\+\s*encodeURIComponent\([^)]+\))?'
    + r'\)\s*\+\s*' + ESC_SQ + r'"'
    + r'[^>]+><svg[^/]+/></svg>LINEでシェア</a></div>'
)

BROKEN_RE = re.compile(pattern_str, re.DOTALL)

BS = chr(92)  # backslash
SQ = chr(39)  # singlequote

def make_btn(share_text):
    esc = share_text.replace(SQ, BS + SQ)
    onclick = "shareLine(" + BS + SQ + esc + BS + SQ + ")"
    style = ("width:100%;padding:10px;background:#06C755;color:#fff;border:none;"
             "border-radius:8px;font-size:14px;font-weight:700;cursor:pointer")
    return (
        '<div style="margin-top:10px">'
        '<button onclick="' + onclick + '" style="' + style + '">'
        "\U0001f4e4 LINEでシェアする"
        "</button></div>"
    )


total = 0
for fpath in TOOLS:
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()

    matches = list(BROKEN_RE.finditer(content))
    if not matches:
        print(f'{os.path.basename(fpath)}: 0')
        continue

    new_content = content
    for m in reversed(matches):
        share_text = m.group(1).rstrip()
        repl = make_btn(share_text)
        new_content = new_content[:m.start()] + repl + new_content[m.end():]

    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f'{os.path.basename(fpath)}: {len(matches)} fixed')
    total += len(matches)

print(f'Total fixed: {total}')
