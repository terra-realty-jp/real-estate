# 夜間自動改善の仕組み（ローカル運用 → クラウド移行メモ）

このドキュメントは、これまでローカル PC（WSL）の cron で動いていた「夜間自動改善」の処理内容を、
クラウドのスケジュールタスクへ置き換えられる形で記録したものである。

元のスクリプトはリポジトリ外（`~/run-real-estate-nightly.sh`）にあり、Git で管理されていなかった。
そのため環境が変わると失われる・内容が追えないという問題があった。本ドキュメントがその代替となる。

---

## 1. これまで何をしていたか

ローカルの crontab に次の 2 本が登録されていた。

```cron
0  0 * * *  /home/sishizaw/run-real-estate-nightly.sh   # 毎日 0:00 JST 自動改善
0 12 * * *  /home/sishizaw/supabase-keepalive.sh        # 毎日 12:00 JST Supabase ping
```

### `run-real-estate-nightly.sh` の処理フロー

1. `PATH` に `~/.local/bin` を追加し、ログを `~/logs/real-estate-nightly.log` に追記する
2. 作業ディレクトリをリポジトリのルートへ移動する
3. **`CLAUDE.md` の全文をそのままプロンプトとして** Claude Code をヘッドレス実行する
   ```bash
   claude -p "$(cat CLAUDE.md)"
   ```
4. 出力に `You've hit your limit` が含まれていれば、**別アカウントの設定ディレクトリに切り替えて再実行**する
   ```bash
   CLAUDE_CONFIG_DIR="$HOME/.claude-sub" claude -p "$(cat CLAUDE.md)"
   ```
5. 終了コードと実行時刻をログに追記する
6. 結果に応じて通知メールを送る
   - レート制限で終わった場合 → `send-rate-limit-email.py`（実行出力を引数で渡し、リセット予定時刻を抽出）
   - それ以外 → `send-notification-email.py`（終了コードを引数で渡す）
7. 一時ファイルを削除する

### 毎晩の指示内容

プロンプトは固定文ではなく **`CLAUDE.md` をそのまま渡していた**。
実際に自律動作を決めていたのは `CLAUDE.md` の「実装ループ」セクションで、要点は次のとおり。

- ループ開始時に `git status` / `git fetch` / `git log origin/dev` と `improvement-log.md` の末尾を確認する
- 優先順位に従って 1 サイクル 1 機能を実装する
  1. 重大バグ・動作不良
  2. `dev` → `main` 未反映コミットのマージ
  3. Supabase の `GRANT` 確認
  4. 集客の初動支援（SEO・OGP・エリアページ）
  5. 通知メールの他区対応
- コミット前に JS 構文チェックを実行する
- `improvement-log.md` に実施内容を追記する
- レスポンス末尾に「次のアクション」の箇条書きを書かない

### 完了時の通知

| 結果 | 送信スクリプト | 件名の形 |
|---|---|---|
| 正常終了（終了コード 0） | `scripts/send-notification-email.py 0` | `✅ 不動産ツール 自動改善完了 — <日時>（N件の改善）` |
| 異常終了（0 以外） | `scripts/send-notification-email.py <code>` | `⚠️ 不動産ツール 自動改善エラー — <日時>（終了コード: N）` |
| レート制限 | `scripts/send-rate-limit-email.py <出力ファイル>` | `⏸️ トークン制限に達しました — <日時>（本セッション N 件の改善）` |

いずれも本文に「直近コミット一覧」と「`improvement-log.md` の最新セクション」を含める。

---

## 2. クラウド移行で変わる点

### サブアカウントへの切り替えは不要

元のスクリプトの中心的な複雑さは、**レート制限を検知して `CLAUDE_CONFIG_DIR=~/.claude-sub` に切り替えて再実行する**部分だった。
これは「1 台のローカル PC に 2 つの対話アカウントの認証情報を置いておく」というローカル固有の回避策であり、
**クラウドのスケジュールタスクに置き換える前提では不要**である。理由は次のとおり。

- クラウド実行は対話ログインではなくトークン／API キーで認証するため、`CLAUDE_CONFIG_DIR` の切り替えという概念がない
- `~/.claude-sub`（約 1.1GB・認証情報を含む）はリポジトリに取り込めず、取り込むべきでもない
- 制限に当たった場合は、別アカウントへ切り替えるのではなく **次回のスケジュール実行に任せる**のが素直な設計

そのため移行後の処理は次の 1 本道になる。

```
スケジュール起動 → リポジトリを checkout → 自動改善を 1 サイクル実行
  → 変更をコミット＆プッシュ → 結果を通知メールで送信
```

### 通知メールの移行

ローカルの 3 本（`~/send-impl-email.py`、`~/send-notification-email.py`、`~/send-rate-limit-email.py`）は
`scripts/` に取り込み済みで、Gmail SMTP と `~/.gmail_app_password` への依存を廃止して **Resend API** に統一した。
共通処理は `scripts/notify_mailer.py` にまとめてある。

```bash
# 送信せずに内容だけ確認する
DRY_RUN=1 REPORT_EMAIL=you@example.com python3 scripts/send-notification-email.py 0
```

必要な環境変数は `RESEND_API_KEY` と `REPORT_EMAIL` の 2 つだけで、どちらもリポジトリには値を書かない。

### Supabase keepalive は移行不要

`~/supabase-keepalive.sh` と同じ処理は **すでに `.github/workflows/supabase-keepalive.yml` が実行している**
（月・木・土の 09:00 JST）。ローカル cron 側は役目を終えているため、クラウドに持っていく必要はない。

---

## 3. 移行後に残る前提

- `main` への反映は人間が確認してからマージする運用を維持する（自動改善は `dev` までで止める）
- 実行ログはローカルの `~/logs/` ではなく、実行したジョブのログを参照する
- `improvement-log.md` への追記は引き続き自動改善側の責務とする
