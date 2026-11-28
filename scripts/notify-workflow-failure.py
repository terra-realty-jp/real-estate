#!/usr/bin/env python3
"""GitHub Actions のワークフローが失敗したことをメールで通知する。

各ワークフローから .github/workflows/notify-failure.yml 経由で呼ばれる。

背景:
  2026-06-27 から 2026-11-28 まで、supabase-keepalive が75回連続で失敗していたのに
  誰も気づけなかった。失敗が通知されず、Supabase に依存する他のワークフローは
  エラーを握りつぶして success を返していたため、GitHub 上は緑のままだった。
  その結果、サイトのデータ層が5か月間死んでいることに気づけなかった。
  二度と「静かに壊れる」ことがないよう、失敗したら必ずメールが飛ぶようにする。

環境変数: RESEND_API_KEY, REPORT_EMAIL, WORKFLOW_NAME, RUN_URL, REPO
"""

import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notify_mailer import JST, send_email  # noqa: E402


def main():
    workflow = os.environ.get("WORKFLOW_NAME", "(不明なワークフロー)")
    run_url = os.environ.get("RUN_URL", "")
    repo = os.environ.get("REPO", "")
    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M")

    subject = f"🔴 ワークフロー失敗: {workflow} — {now}"
    body = f"""GitHub Actions のワークフローが失敗しました。

ワークフロー: {workflow}
リポジトリ  : {repo}
検知時刻    : {now} (JST)

実行ログ:
{run_url}

━━━━━━━━━━━━━━━━━━━━━━━
確認の順番
━━━━━━━━━━━━━━━━━━━━━━━
1. 上のログを開いて、どのステップで落ちたかを見る
2. Supabase 由来なら https://supabase.com/dashboard でプロジェクトの状態を確認する
   （無料プランは無活動が続くと一時停止する。2026-06〜11 に5か月停止した前例あり）
3. 外部APIの仕様変更なら scripts/ の該当スクリプトを直す

このメールが届かなくなったときが一番危険です。
最低でも月に一度は Actions の実行履歴を見てください。

---
TERRA REALTY 自動化 監視
"""
    send_email(subject, text=body)
    print(f"失敗通知を送信しました: {workflow}")


if __name__ == "__main__":
    main()
