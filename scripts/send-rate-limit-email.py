#!/usr/bin/env python3
"""トークン制限に達したことを通知するメールを送信する（Resend API 版）

使い方: python3 scripts/send-rate-limit-email.py [実行出力ファイル]

引数のファイルから "resets 3:00am" のような文字列を探し、リセット予定時刻を本文に載せる。

環境変数: RESEND_API_KEY, REPORT_EMAIL
オプション: DRY_RUN=1 で送信せずに内容を確認
"""

import os
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notify_mailer import (  # noqa: E402
    JST,
    git_log,
    read_latest_improvement_section,
    send_email,
)

SEPARATOR = "━" * 23


def main():
    output_path = sys.argv[1] if len(sys.argv) > 1 else ""

    content = ""
    if output_path and os.path.exists(output_path):
        try:
            content = Path(output_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            content = ""

    match = re.search(r"resets (\d+:\d+\s*(?:am|pm))", content, re.IGNORECASE)
    reset_display = f"{match.group(1)} (Asia/Tokyo)" if match else "不明"

    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M")
    commits = git_log(since="6 hours ago")
    commit_count = len(commits.splitlines()) if commits else 0
    log_section = read_latest_improvement_section()

    subject = f"⏸️ トークン制限に達しました — {now}（本セッション {commit_count} 件の改善）"
    body = f"""Claudeのトークン制限に達しました。

検知時刻: {now} (Asia/Tokyo)
リセット予定: {reset_display}
本セッションの改善コミット数: {commit_count} 件

{SEPARATOR}
【今回のセッションで実装した内容】
{SEPARATOR}
{log_section if log_section else "（ログなし）"}

{SEPARATOR}
【コミット一覧】
{SEPARATOR}
{commits if commits else "（新規コミットなし）"}

次回のスケジュール実行時に改めて継続されます。

---
不動産かんたんツール 自動改善システム
"""

    send_email(subject, text=body)
    print(f"完了: {subject}")


if __name__ == "__main__":
    main()
