#!/usr/bin/env python3
"""通知メール共通モジュール（Resend API 版）

ローカルの Gmail SMTP（smtp.gmail.com + ~/.gmail_app_password）への依存を廃止し、
GitHub Actions / クラウドのスケジュールタスクからそのまま実行できるようにしたもの。
標準ライブラリのみで動作する（このリポジトリは依存パッケージを持たない方針）。

必要な環境変数:
  RESEND_API_KEY  Resend の API キー（送信時のみ必須。DRY_RUN=1 なら不要）
  REPORT_EMAIL    送信先メールアドレス

オプション:
  DRY_RUN=1       実際には送信せず、件名・宛先・本文の冒頭を標準出力に表示する
  FROM_EMAIL      送信元アドレス（既定: info@terra-realty.jp）
  FROM_NAME       送信元表示名（既定: TERRA REALTY 自動改善）
"""

import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import timezone, timedelta
from pathlib import Path

JST = timezone(timedelta(hours=9))

# このファイルは <repo>/scripts/ に置かれている前提。絶対パスは持たない。
REPO_ROOT = Path(__file__).resolve().parent.parent

RESEND_ENDPOINT = "https://api.resend.com/emails"

SITE_URL = "https://terra-realty-jp.github.io/real-estate"
COMMITS_URL = "https://github.com/terra-realty-jp/real-estate/commits/main"

DRY_RUN = os.environ.get("DRY_RUN") == "1"
FROM_EMAIL = os.environ.get("FROM_EMAIL", "info@terra-realty.jp")
FROM_NAME = os.environ.get("FROM_NAME", "TERRA REALTY 自動改善")


def _require(name):
    value = os.environ.get(name, "").strip()
    if not value:
        print(
            f"エラー: 環境変数 {name} が未設定です（テスト時は DRY_RUN=1 を指定してください）",
            file=sys.stderr,
        )
        sys.exit(1)
    return value


def git_log(since=None, limit=None):
    """リポジトリのコミットログを1行形式で返す。失敗時は空文字。"""
    cmd = ["git", "-C", str(REPO_ROOT), "log", "--oneline"]
    if since:
        cmd.append(f"--since={since}")
    if limit:
        cmd.append(f"-{limit}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def read_latest_improvement_section():
    """improvement-log.md の最後の ## セクション（＝最新の記録）を返す。

    improvement-log.md は古い記録が先頭・新しい記録が末尾に追記される形式のため、
    「今回の改善内容」として載せるべきなのは最後のセクションである。
    """
    path = REPO_ROOT / "improvement-log.md"
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    section = []
    for line in content.split("\n"):
        if line.startswith("## "):
            section = [line]
        elif section:
            section.append(line)
    return "\n".join(section).strip()


def zip_attachment(file_path):
    """HTML などのファイルを zip にして Resend 用の添付 dict を返す。"""
    import io
    import zipfile

    src = Path(file_path)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(src, src.name)
    data = buf.getvalue()
    return {
        "filename": src.with_suffix(".zip").name,
        "content": base64.b64encode(data).decode("ascii"),
        "_size_kb": len(data) // 1024,
    }


def send_email(subject, text=None, html=None, attachments=None):
    """Resend API でメールを送信する。DRY_RUN=1 のときは送信せず内容を表示する。"""
    to_email = _require("REPORT_EMAIL") if not DRY_RUN else os.environ.get(
        "REPORT_EMAIL", "(REPORT_EMAIL 未設定)"
    )

    if DRY_RUN:
        print("*** DRY RUN モード — 実際には送信しません ***")
        print(f"  送信元: {FROM_NAME} <{FROM_EMAIL}>")
        print(f"  送信先: {to_email}")
        print(f"  件名  : {subject}")
        if attachments:
            for a in attachments:
                print(f"  添付  : {a['filename']} ({a.get('_size_kb', '?')}KB)")
        body_preview = (text or html or "").strip().split("\n")
        print("  本文(冒頭10行):")
        for line in body_preview[:10]:
            print(f"    | {line}")
        if len(body_preview) > 10:
            print(f"    | … 他 {len(body_preview) - 10} 行")
        return {"id": "dry-run"}

    api_key = _require("RESEND_API_KEY")

    payload = {
        "from": f"{FROM_NAME} <{FROM_EMAIL}>",
        "to": [to_email],
        "subject": subject,
    }
    if text:
        payload["text"] = text
    if html:
        payload["html"] = html
    if attachments:
        payload["attachments"] = [
            {"filename": a["filename"], "content": a["content"]} for a in attachments
        ]

    request = urllib.request.Request(
        RESEND_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        print(f"エラー: Resend API が HTTP {e.code} を返しました: {detail}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"エラー: Resend API に接続できませんでした: {e.reason}", file=sys.stderr)
        sys.exit(1)
