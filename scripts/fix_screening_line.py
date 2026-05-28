#!/usr/bin/env python3
"""Fix the single corrupted shareLine button in calcScreening (line 7990)."""
import re

fpath = '/home/sishizaw/real-estate-project/tools/5-toushi-bunseki.html'

with open(fpath, 'r', encoding='utf-8') as f:
    content = f.read()

# The broken pattern: starts with correct share text but ends with leftover broken href content
# We need to replace from the start of that html += line to end of its broken content
broken_pattern = re.compile(
    r"    html \+= '<div style=\"margin-top:10px\"><button onclick=\"shareLine\(\\'📊 不動産投資物件スクリーニング診断！\\n\\n5軸総合評価で物件の投資適正をチェックしてみました。利回り×立地×融資の基準が一目でわかります！\\n\\n#不動産投資 #物件選び #TERRA_REALTY\\n[^;]+;",
    re.DOTALL
)

# The correct replacement - matching the working pattern from other buttons like line 7811
correct_line = (
    "    html += '<div style=\"margin-top:10px\">"
    "<button onclick=\"shareLine(\\'📊 不動産投資物件スクリーニング診断！\\n\\n"
    "5軸総合評価で物件の投資適正をチェックしてみました。利回り×立地×融資の基準が一目でわかります！\\n\\n"
    "#不動産投資 #物件選び #TERRA_REALTY\\n\\')\""
    " style=\"width:100%;padding:10px;background:#06C755;color:#fff;border:none;"
    "border-radius:8px;font-size:14px;font-weight:700;cursor:pointer\">"
    "📤 LINEでシェアする</button></div>';"
)

matches = list(broken_pattern.finditer(content))
print(f"Found {len(matches)} match(es)")

if matches:
    m = matches[0]
    print("Matched text (first 100 chars):", repr(content[m.start():m.start()+100]))
    print("Replacement (first 100 chars):", repr(correct_line[:100]))
    new_content = content[:m.start()] + correct_line + content[m.end():]
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Fixed!")
else:
    # Try a simpler search
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'calcScreening' in line or ('スクリーニング' in line and 'encodeURIComponent' in line):
            print(f"Line {i+1}: {repr(line[:120])}")
