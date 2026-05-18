import subprocess, datetime, os

def git(cmd):
    return subprocess.check_output(cmd, shell=True, text=True, errors='replace').strip()

now_jst = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
date_label = now_jst.strftime('%Y-%m-%d %H:%M')

week_ago = (datetime.datetime.utcnow() - datetime.timedelta(days=7)).strftime('%Y-%m-%dT%H:%M:%S')
log_raw = git(f"git log --format='%s' --after='{week_ago}'")
commits_this_week = [l for l in log_raw.splitlines() if l.strip()]
commit_count = len(commits_this_week)

log_path = 'improvement-log.md'
try:
    with open(log_path, 'r', encoding='utf-8') as f:
        log_content = f.read()
except FileNotFoundError:
    log_content = ''

entry = f"\n## {date_label}（週次ペルソナUXレビュー自動チェック）\n\n"
entry += f"- **フェーズ**: Phase 1/2 定期UXレビュー\n"
entry += f"- **改善内容**: 週次ペルソナUXレビューチェックリスト（GitHub Actions自動生成）\n"
entry += f"- **直近7日のコミット数**: {commit_count}件\n\n"
entry += "### 仮ユーザーレビューチェックリスト\n\n"
entry += "> 以下を確認してください（実施後にチェックを入れてください）\n\n"
entry += "#### ペルソナ1: 田中みちこさん（52歳・専業主婦・スマホのみ・空き家相続）\n"
entry += "- [ ] Tool2（空き家活用診断）のTOP3カードを読んで「自分のことだ」と感じるか\n"
entry += "- [ ] 「家賃目安の立地選択」ドロップダウンが直感的に使えるか\n"
entry += "- [ ] 解釈ガイドの文言に専門用語が残っていないか\n\n"
entry += "#### ペルソナ2: 佐藤健一さん（47歳・会社員・投資初心者）\n"
entry += "- [ ] Tool5（投資シミュレーター）の「この数字が良いのか悪いのか」の判断基準が見えるか\n"
entry += "- [ ] 利回り・CF・DSCRの解釈ガイドが「なるほど」と思える内容か\n"
entry += "- [ ] 金利・物件価格のデフォルト値が2026年の実態に合っているか\n\n"
entry += "#### ペルソナ3: 鈴木幸子さん（58歳・パート・売却検討中）\n"
entry += "- [ ] Tool1（AI物件査定）で「売ったらいくら手取り？」が2タップ以内でわかるか\n"
entry += "- [ ] 手取り額・税金の計算結果が大きく・はっきり表示されているか\n"
entry += "- [ ] 入力項目が多すぎて途中で萎えないか（5項目以内が理想）\n\n"
entry += "### 先週のコミット（上位10件）\n"

for c in commits_this_week[:10]:
    entry += f"- {c}\n"

entry += "\n### レビュー結果メモ欄\n"
entry += "（レビュー担当者が実施後にここに結果を記入してください）\n\n"
entry += "- **実施日**:\n"
entry += "- **確認者**:\n"
entry += "- **発見した問題**:\n"
entry += "- **対応内容**:\n\n"
entry += "---\n"

with open(log_path, 'a', encoding='utf-8') as f:
    f.write(entry)

print(f"週次ペルソナレビューチェックリストを improvement-log.md に追記しました")
print(f"   対象期間: 直近7日 / コミット数: {commit_count}件")
