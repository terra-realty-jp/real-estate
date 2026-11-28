#!/usr/bin/env python3
"""夜間自動改善の完了／エラー通知メールを送信する（Resend API 版）

使い方: python3 scripts/send-notification-email.py [終了コード]

環境変数: RESEND_API_KEY, REPORT_EMAIL
オプション: DRY_RUN=1 で送信せずに内容を確認
           LOG_HINT  エラー時に本文へ載せるログの場所（既定: 実行環境のジョブログ）
"""

import os
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
    try:
        exit_code = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    except ValueError:
        exit_code = 1

    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M")
    commits = git_log(since="2 hours ago")
    commit_count = len(commits.splitlines()) if commits else 0
    log_section = read_latest_improvement_section()
    log_hint = os.environ.get("LOG_HINT", "実行環境のジョブログ（GitHub Actions の場合は該当ワークフローの実行ログ）")

    if exit_code == 0:
        subject = f"✅ 不動産ツール 自動改善完了 — {now}（{commit_count}件の改善）"
        body = f"""不動産かんたんツールの自動改善が完了しました。

実行日時: {now} (JST)
改善コミット数: {commit_count} 件

{SEPARATOR}
【今回の改善内容】
{SEPARATOR}
{log_section if log_section else "（ログなし）"}

{SEPARATOR}
【コミット一覧】
{SEPARATOR}
{commits if commits else "（新規コミットなし）"}

---
不動産かんたんツール 自動改善システム
"""
    else:
        subject = f"⚠️ 不動産ツール 自動改善エラー — {now}（終了コード: {exit_code}）"
        body = f"""自動改善の実行中にエラーが発生しました。

実行日時: {now} (JST)
終了コード: {exit_code}

詳細は次を確認してください:
{log_hint}

---
不動産かんたんツール 自動改善システム
"""

    send_email(subject, text=body)
    print(f"完了: {subject}")


if __name__ == "__main__":
    main()
