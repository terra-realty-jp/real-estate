#!/usr/bin/env python3
"""実装完了通知メールを HTML 形式で送信する（Resend API 版）

使い方:
  python3 scripts/send-impl-email.py "ツール名" "実装タイトル" "詳細説明" "ユーザーへの価値" [添付HTMLファイル]

環境変数: RESEND_API_KEY, REPORT_EMAIL
オプション: DRY_RUN=1 で送信せずに内容を確認
"""

import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notify_mailer import (  # noqa: E402
    COMMITS_URL,
    JST,
    SITE_URL,
    git_log,
    send_email,
    zip_attachment,
)

TOOL_ICONS = {
    "Tool1": "🏷", "Tool2": "🏚", "Tool3": "🤝",
    "Tool4": "🏢", "Tool5": "📈", "index": "🌐",
}


def build_html(tool_name, title, detail, value, now,
               latest_commit, session_commits, session_count,
               attach_name):
    icon = TOOL_ICONS.get(tool_name, "✅")

    if session_commits:
        commit_rows = ""
        for line in session_commits.splitlines():
            sha, _, msg = line.partition(" ")
            commit_rows += (
                '<tr>'
                f'<td style="font-family:monospace;color:#888;padding:4px 8px;white-space:nowrap">{sha}</td>'
                f'<td style="padding:4px 8px;color:#ddd">{msg or line}</td>'
                '</tr>'
            )
    else:
        commit_rows = '<tr><td colspan="2" style="padding:8px;color:#555;text-align:center">（なし）</td></tr>'

    detail_html = "<br>".join(l.strip() for l in detail.split("\n") if l.strip())
    value_html = "<br>".join(l.strip() for l in value.split("\n") if l.strip())

    attach_banner = ""
    if attach_name:
        attach_banner = f"""
  <tr><td style="background:#1a2a1a;border-top:1px solid rgba(100,200,100,0.3);padding:12px 28px;text-align:center">
    <span style="font-size:12px;color:#7fc97f">📎 添付: {attach_name} — HTMLファイルを確認できます</span>
  </td></tr>"""

    return f"""<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0e0e0e;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#e8e4db">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0e;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:linear-gradient(135deg,#1a1a1a,#111);border-bottom:2px solid #c9a84c;border-radius:12px 12px 0 0;padding:28px 28px 20px;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">{icon}</div>
    <div style="font-size:20px;font-weight:900;color:#c9a84c;margin-bottom:4px">{tool_name} — 実装完了</div>
    <div style="font-size:13px;color:#888">{now} (JST)</div>
  </td></tr>

  <tr><td style="background:#111;padding:20px 28px">
    <div style="font-size:11px;color:#c9a84c;font-weight:700;letter-spacing:1px;margin-bottom:8px">実装した機能</div>
    <div style="font-size:17px;font-weight:700;color:#e8e4db;line-height:1.5">{title}</div>
  </td></tr>

  <tr><td style="background:#161616;border-top:1px solid rgba(255,255,255,0.06);padding:20px 28px">
    <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:1px;margin-bottom:10px">具体的な変更内容</div>
    <div style="font-size:13px;color:#ccc;line-height:1.8">{detail_html}</div>
  </td></tr>

  <tr><td style="background:#111;border-top:1px solid rgba(255,255,255,0.06);padding:20px 28px">
    <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:1px;margin-bottom:10px">なぜこの実装が価値があるか</div>
    <div style="font-size:13px;color:#ccc;line-height:1.8">{value_html}</div>
  </td></tr>

  <tr><td style="background:#161616;border-top:1px solid rgba(255,255,255,0.06);padding:16px 28px">
    <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:1px;margin-bottom:6px">最新コミット</div>
    <div style="font-family:monospace;font-size:12px;color:#c9a84c;background:#0e0e0e;padding:8px 12px;border-radius:6px">{latest_commit}</div>
  </td></tr>

  <tr><td style="background:#111;border-top:1px solid rgba(255,255,255,0.06);padding:16px 28px">
    <div style="font-size:11px;color:#888;font-weight:700;letter-spacing:1px;margin-bottom:10px">本セッションのコミット（直近3時間・合計 {session_count} 件）</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:12px">
      {commit_rows}
    </table>
  </td></tr>
{attach_banner}
  <tr><td style="background:#1a1a1a;border-top:1px solid rgba(201,168,76,0.3);padding:20px 28px;text-align:center;border-radius:0 0 12px 12px">
    <a href="{SITE_URL}/" style="display:inline-block;background:#c9a84c;color:#000;font-weight:700;font-size:13px;padding:11px 24px;border-radius:8px;text-decoration:none;margin-right:8px">ツールを開く →</a>
    <a href="{COMMITS_URL}" style="display:inline-block;background:rgba(255,255,255,0.1);color:#ccc;font-size:12px;padding:11px 18px;border-radius:8px;text-decoration:none">GitHubで確認</a>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>"""


def main():
    tool_name = sys.argv[1] if len(sys.argv) > 1 else "不明"
    title = sys.argv[2] if len(sys.argv) > 2 else "（タイトルなし）"
    detail = sys.argv[3] if len(sys.argv) > 3 else "（詳細なし）"
    value = sys.argv[4] if len(sys.argv) > 4 else "（説明なし）"
    html_file = sys.argv[5] if len(sys.argv) > 5 else ""

    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M")
    latest_commit = git_log(limit=1)
    session_commits = git_log(since="3 hours ago")
    session_count = len(session_commits.splitlines()) if session_commits else 0

    attachments = []
    if html_file and os.path.exists(html_file):
        attachments.append(zip_attachment(html_file))
    elif html_file:
        print(f"警告: 添付ファイルが見つかりません: {html_file}", file=sys.stderr)

    attach_name = attachments[0]["filename"] if attachments else ""

    subject = f"✅ [{tool_name}] {title} — {now}"
    html_body = build_html(tool_name, title, detail, value, now,
                           latest_commit, session_commits, session_count,
                           attach_name)
    text_body = (
        f"[{tool_name}] {title}\n実装日時: {now}\n\n"
        f"【変更内容】\n{detail}\n\n【価値】\n{value}\n\n"
        f"【最新コミット】\n{latest_commit}\n\n"
        f"【本セッションコミット】\n{session_commits or '（なし）'}\n（合計 {session_count} 件）\n\n"
        f"ツールURL: {SITE_URL}/\n"
    )

    send_email(subject, text=text_body, html=html_body, attachments=attachments or None)
    print(f"完了: {subject}")


if __name__ == "__main__":
    main()
