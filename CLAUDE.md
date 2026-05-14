# CLAUDE.md — 不動産ツール 自律実装ルール

## 使命

`/home/sishizaw/real-estate-project` にある不動産ツールサービスを、**一般の人が気軽に使えて、使い続けたくなるサービス**に磨き続けることがあなたの役割です。

トークンが尽きるまで、以下のサイクルを繰り返し続けてください。1回で終わらず、何度も何度も改善を積み重ねてください。

## 最終目標

**一般の人がこのツールを使い続けることで、不動産取引に関する情報が大量に蓄積され、TERRA REALTYが情報優位の立場に立てるようにすること。**

- 一般ユーザーが「このサービス、使いやすい・役に立つ」と感じて繰り返し使いたくなる体験を作る
- ツールを使うことで「TERRA REALTYに相談してみようかな」という自然な流れを生む
- 多くの人が使うほど、査定データ・投資判断・物件情報が蓄積され、サービスの価値が高まる仕組みを意識する

---

## プロジェクト概要

- **サービス名**: 不動産かんたんツール（powered by TERRA REALTY）
- **ターゲット**: 不動産に詳しくない一般の人（売却検討者・賃貸オーナー・投資初心者）。40〜60代・スマートフォン利用者・非専門家
- **技術**: HTML / CSS / Vanilla JavaScript + Supabase（認証・クラウドDB）
- **データ**: Supabase DB（ログイン時）/ ブラウザ localStorage（未ログイン時フォールバック）
- **構成**:
  - `index.html` — トップページ（一般ユーザー向け入口）
  - `tools/1-ai-satei.html` — AI物件査定
  - `tools/2-akiya-hunter.html` — 空き家活用診断
  - `tools/3-owner-direct.html` — 売主・買主マッチング
  - `tools/4-kanri-saas.html` — 賃貸物件かんたん管理
  - `tools/5-toushi-bunseki.html` — 不動産投資シミュレーター

---

## 実装ループ（毎セッション・トークンが尽きるまで繰り返す）

### ループ開始時に必ず実行すること

```bash
# 1. 前回の実装履歴を確認（重複防止）
tail -100 /home/sishizaw/real-estate-project/improvement-log.md

# 2. 直近のgitコミットを確認（重複防止）
git -C /home/sishizaw/real-estate-project log --oneline -20

# 3. 各ツールの既存機能をgrepで確認
grep -n "card-title\|font-weight:900" /home/sishizaw/real-estate-project/tools/[対象ファイル]
```

前回何を改善したかを把握してから次を選ぶ。**同じ改善を重複して行わない。**

### 1サイクルの手順

1. improvement-log.md と git log で実装済みを確認
2. 未実装の機能を選ぶ（下記優先順位に従う）
3. 実装 → 動作検証 → 構文チェック → `git add [対象ファイル]` → `git commit` → `git push origin main`
4. improvement-log.md に記録
5. 次の機能へ。レートリミットに達するまで繰り返す

---

## 実装ルール

- **重複チェック必須**: 実装前に必ず `improvement-log.md` と `git log` で既存機能を確認し、重複しない機能を選ぶ
- **構文チェック必須**: コミット前に以下で JS 構文エラーがないことを確認する
  ```bash
  node -e "
  const fs = require('fs');
  const html = fs.readFileSync('[ファイルパス]','utf8');
  const match = html.match(/<script(?![^>]*type=\"application\/ld)[^>]*>([\s\S]*?)<\/script>/g);
  let combined = '';
  if(match) match.forEach(s => { combined += s.replace(/<\/?script[^>]*>/g,'') + '\n'; });
  try { new Function(combined); console.log('JS OK'); } catch(e) { console.error('JS Error:', e.message); }
  "
  ```
- **index.html の構文チェック**: JSON-LD ブロックを除外するフィルタを使うこと（上記の正規表現で対応済み）
- **1機能ずつコミット**: 機能単位でコミットし、push まで完了させてから次へ
- **ユーザーへの質問禁止**: 機能の選択・実装方針はすべて自律判断する
- **git add は個別指定**: `git add -A` や `git add .` は使わない。必ず対象ファイルを明示してステージングする
- **Supabase アクセス**: `supabase-client.js` を通じてのみDBアクセスすること。直接fetchでSupabaseを呼ばない
- **localStorageキー名・データ構造を変更しない**: 未ログインユーザーの既存データが消えるため
- **どこかのサーバーにファイルをアップロードしない**

---

## コミットメッセージ形式

```
Tool1: 〜機能を追加（〜の説明）
Tool2: 〜カード追加（〜）
Tool4: 〜カード追加（〜）+ Tool2: 〜修正
index: 〜
```

---

## 実装アイデアの優先順位

1. **実用性が高い**（オーナーが日常的に使う機能）
2. **スマホで見やすい**（カード形式・大きい数字・色分け）
3. **計算・自動診断系**（入力値から自動で結果を出す）
4. **ビジュアライゼーション**（グラフ・マトリックス・タイムライン）

---

## 品質の基準

「不動産のことをよく知らない40〜60代の方が、スマートフォンでツールを開いて、誰にも聞かずに5分以内に目的の操作を完了できる」状態を目指す。

- ボタンのラベルを見ただけで何ができるかわかる
- データがない状態で何をすればいいか画面から読み取れる
- 入力を間違えたとき、何が問題かが赤字などで伝わる
- 大事なデータを誤って削除しそうになったとき確認がある
- 専門用語には必ず説明が付いている
- スマホで操作しやすいボタンサイズ・フォントサイズ

---

## 実装後に必ずやること

### 動作検証（実装したら必ず確認）

- 追加・変更した機能が意図通りに動くかをコードで確認する
- 新しいJavaScript関数が既存の変数・関数名と衝突していないか確認する
- 追加したフォームフィールドのIDが既存のlocalStorage保存ロジックと整合しているか確認する
- 変更箇所の前後のコードを読み、副作用が生じていないか確認する
- モバイル幅（max-width: 640px）でのレイアウトに問題がないかCSSを確認する

### コード品質チェック

- JavaScriptに構文エラーがないか確認（上記の構文チェックコマンドを使用）
- `esc()` 関数を使うべき箇所（ユーザー入力の表示）で使っているか確認
- localStorageのキー名が既存と一致しているか確認
- モバイル表示が壊れていないか（max-width スタイルを確認）

### git commit & push

```bash
cd /home/sishizaw/real-estate-project
git add [変更したファイルを個別に指定]
git commit -m "Tool1: 〜機能追加（説明）"
git push origin main
```

### improvement-log.md に記録

`/home/sishizaw/real-estate-project/improvement-log.md` に追記：

```
## YYYY-MM-DD HH:MM（セッション継続N）

- **対象**: ファイル名
- **改善内容**: 何をどう直したか
- **理由**: なぜこの改善がユーザーに価値があるか
```

---

## 繰り返しの終了条件

トークンが尽きるまで止まらない。1つ改善したら次の改善へ。多くの一般ユーザーに「このツール、使いやすい」と思ってもらえるサービスを目指して、限界まで磨き続けること。
