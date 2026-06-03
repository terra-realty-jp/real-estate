# CLAUDE.md — 稲毛区No.1不動産情報プラットフォーム 実装仕様書

---

## AI評価視点：PropTech Data Moat（データ優位性）フレームワーク

### Role
あなたはシリコンバレーのPropTech領域に精通したシニアプロダクトマネージャー兼データアーキテクトです。提示されたコードを単なる機能実装としてではなく、「不動産データ優位性（Data Moat）」を構築するための戦略的資産として評価してください。

### Mission
ユーザー体験の向上と、競合ポータルが持ち得ない「独自の解像度の高いデータ蓄積」を両立させる仕組みを構築すること。

### Review Criteria（優先順）

1. **【データ優位性】**: この実装によって、どの「独自の定性・定量データ」が蓄積されるか？そのデータは競合他社にとって模倣困難な「堀」となるか？
2. **【心理的摩擦と入力意欲】**: ユーザーが個人情報を開示してでも入力したくなる「圧倒的な価値（診断・シミュレーション結果など）」が提供できているか？
3. **【フィードバックループ】**: 蓄積されたデータが、即座にユーザー個人の体験向上（精度向上やパーソナライズ）に還元されているか？
4. **【技術的堅牢性と拡張性】**: Supabase/GASを活用した現在の実装において、将来的なデータ分析や機械学習への拡張を阻害する負債はないか？

### Output Guidelines（実装・評価時に必ず使うフレームワーク）

新機能の実装・評価・改善提案を行う際は、以下4軸を明示すること。

- **[ユーザー価値の言語化]**: なぜユーザーは入力を続けるのか？
- **[データ価値の特定]**: この機能で得られる「隠れたインサイト」は何か？
- **[差別化のロジック]**: 大手ポータルが真似をした際、何が決定打となって我々が勝つか？
- **[具体的改善案]**: 入力摩擦を下げ、データ質を高めるためのUX/コード修正案。

### Repository Context
このプロジェクトは現在、Webフロントエンド（HTML/JS）とSupabase、GASを用いた不動産評価ツールです。このベースを活かし、ポータルサイトの枠を超えた「インテリジェントな資産管理プラットフォーム」への進化を目指します。

### 現在蓄積しているデータとその戦略的意義

| テーブル | 蓄積データ | Data Moatとしての価値 |
|---|---|---|
| `inage_properties` | 国交省取引事例×稲毛区町丁目 | 「長沼町の直近5年㎡単価推移」を即答できる唯一のDB |
| `qa_questions` | 住民の生の悩み（カテゴリ×エリア×築年数） | SUUMOに絶対ない「稲毛団地を相続した人が何を聞くか」データ |
| `area_buyer_count` | エリア×予算×物件種別の潜在需要 | 「穴川で3,000万以下の一戸建てを探している人が現在○人」というリアルタイム需要データ |
| `notify_subscribers` | メール×エリア×物件種別の関心マッピング | 稲毛区住民のウォッチリスト。問合せ前段階の意向データ |
| `card_usage_log` | ツール利用パターン（どのカード×どのエリアで使われるか） | 「相続Q→稲毛団地チェッカー→査定」のファネルを可視化できる行動データ |
| `investor_profiles` | 投資家の条件（エリア×利回り×融資種別） | 稲毛区特化の投資家データベース。全国ポータルにはないローカル需要DB |

### 実装ループに追加する評価ステップ

各機能を実装したら、通常のJS構文チェック・コミットに加えて以下を自問すること：

1. **このユーザーアクションで何のデータが取れるか？** → Supabaseに記録しているか？
2. **取得データはエリア・物件種別・築年数・価格帯の4軸で切れるか？** → クロス集計できるスキーマか？
3. **ユーザーに「あなたのデータが活きた」と感じさせる瞬間があるか？** → フィードバックループが閉じているか？

---

## 使命

千葉市稲毛区に住む人が、不動産について何か気になったときに**最初に開く**サービスにする。
大手ポータル（SUUMO・ホームズ）にも地元業者にも作れない「稲毛区の固有情報」を蓄積し続けることで、競合が絶対に真似できない情報優位を確立する。

**TERRA REALTYが持つべき優位:**
- 大手ポータル：全国一律設計。「長沼町の相場」「稲毛団地の修繕積立金問題」といったハイパーローカル情報がない
- 地元業者：店舗型でデジタル情報発信が弱い。データを蓄積・公開している会社はほぼない
- **TERRAが埋める空白**：稲毛区住民が不動産について自分で情報収集できる唯一の場

---

## プロジェクト概要

- **サービス名**: 不動産かんたんツール（powered by TERRA REALTY）
- **対象エリア**: 千葉市6区（稲毛区・中央区・美浜区・緑区・花見川区・若葉区）※稲毛区が先行稼働・他区はデータ収集中
- **ターゲット**: 千葉市在住の40〜60代。昭和40〜50年代の団地・戸建てを持つ世帯が主軸。稲毛区が主軸
- **技術スタック**: HTML / CSS / Vanilla JavaScript + Supabase（DB・認証）
- **インフラ**: GitHub Pages（静的ホスティング）/ GitHub Actions（API自動更新・将来の通知）
- **ブランチ戦略**:
  - `main` ← 本番（触らない。GitHub Pagesはここを公開中）
  - `dev` ← 開発主軸（ここで作業する）
  - `feature/*` ← 機能1本ずつブランチを切る

**作業開始時は必ず確認する:**
```bash
git checkout dev
git pull origin dev
git branch  # 現在地を確認
```

---

## ディレクトリ構成

```
/
├── index.html                   ← エリア選択ファースト（千葉市6区カード）
├── tools/
│   ├── 1-ai-satei.html          ← AI物件査定
│   ├── 2-akiya-hunter.html      ← 空き家診断（稲毛団地チェッカータブ付き）
│   ├── 3-owner-direct.html      ← マッチング（稲毛区需要タブ付き）
│   ├── 4-kanri-saas.html        ← 賃貸管理（フッターのみ）
│   ├── 5-toushi-bunseki.html    ← 投資分析
│   └── 6-sozoku-zei.html        ← 相続税試算
├── inage/                       ← 稲毛区（先行・フル実装）
│   ├── index.html               ← 稲毛区ハブ
│   ├── map.html                 ← 相場ヒートマップ（Supabase実データ216件）
│   ├── qa.html                  ← Q&A掲示板（20件投入済み）
│   ├── notify.html              ← メール通知（GitHub Actions自動配信）
│   ├── sell.html                ← 売主物件登録
│   ├── souzoku.html             ← 相続ガイド
│   ├── baikyaku-guide.html      ← 売却ガイド
│   ├── koubai-guide.html        ← 購入ガイド
│   ├── chintai-guide.html       ← 賃貸ガイド
│   ├── toushi-guide.html        ← 投資ガイド
│   ├── akiya-guide.html         ← 空き家ガイド
│   ├── sumai-kae.html           ← 住み替えガイド
│   └── area-*.html              ← 12エリア個別ページ
├── chuo/                        ← 中央区（データ収集中・先行通知受付）
│   ├── index.html / qa.html / notify.html / map.html
│   └── sell.html / baikyaku-guide.html / souzoku.html
├── mihama/                      ← 美浜区（同上）
├── midori/                      ← 緑区（同上）
├── hanami/                      ← 花見川区（同上）
├── wakaba/                      ← 若葉区（同上）
├── data/
│   ├── inage-geojson.json       ← 稲毛区町境界
│   ├── area-prices.json         ← エリア別単価（月次更新）
│   └── interest-rates.json      ← 金利データ（月次更新）
├── scripts/
│   ├── fetch-inage-properties.js  ← 稲毛区MLIT取得（毎月自動）
│   ├── fetch-ward-properties.js   ← 他5区MLIT取得（毎月5日自動）
│   ├── seed-qa-all-wards.sql      ← Q&Aシードデータ（投入済み）
│   └── send-inage-notify.js       ← メール配信
├── schema-ward.sql              ← ward_propertiesテーブル定義
├── supabase-client.js           ← Supabase接続（全ページ共通）
├── llms.txt                     ← AI検索エンジン向けデータ（全6区対応）
├── sitemap.xml                  ← 全50+ページ登録済み
└── CLAUDE.md                    ← 本ファイル
```

---

## Supabase DBスキーマ設計（確定版）

### テーブル一覧

#### `inage_properties`（稲毛区相場データ）
施策①相場マップ用。国土交通省APIから月次自動取得。

```sql
CREATE TABLE inage_properties (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  town_name       TEXT NOT NULL,
  property_type   TEXT NOT NULL,        -- house / mansion / land
  price           INTEGER,              -- 万円
  area_sqm        NUMERIC,
  price_per_sqm   NUMERIC,              -- 万円/㎡（ヒートマップの色分けに使用）
  trade_year      INTEGER,
  trade_quarter   INTEGER,
  source          TEXT DEFAULT 'mlit',
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

#### `qa_questions`（Q&A質問）
ユーザー投稿。モデレーション後に公開。

```sql
CREATE TABLE qa_questions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id   TEXT,
  category     TEXT,                    -- 売却 / 相続 / 賃貸 / 購入 / 投資
  town_name    TEXT,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',  -- pending / published / rejected
  view_count   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

#### `qa_answers`（Q&A回答）
TERRA管理者が記入。

```sql
CREATE TABLE qa_answers (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id  UUID REFERENCES qa_questions(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  is_official  BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);
```

#### `notify_subscribers`（メール通知登録）
LINEなし。メールのみ。

```sql
CREATE TABLE notify_subscribers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email           TEXT NOT NULL,
  town_interests  TEXT[],               -- ['長沼町','天台'] など複数可
  property_type   TEXT,                 -- house / mansion / land / any
  notify_freq     TEXT DEFAULT 'monthly', -- weekly / monthly
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

#### `area_buyer_count`（買い手候補数）
施策⑤ローカルマッチング用。

```sql
CREATE TABLE area_buyer_count (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  town_name     TEXT NOT NULL,
  property_type TEXT,
  budget_max    INTEGER,                -- 上限予算（万円）
  session_id    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

#### `card_usage_log`（既存・継続）
既存の実装をそのまま流用。変更不要。

#### `ward_properties`（千葉市5区 取引データ）2026-06-01追加
`fetch-ward-properties.js` で毎月5日自動取得。`schema-ward.sql` で作成済み。

```sql
CREATE TABLE ward_properties (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ward            TEXT NOT NULL,           -- 中央区 / 花見川区 / 若葉区 / 緑区 / 美浜区
  town_name       TEXT NOT NULL,
  property_type   TEXT NOT NULL,           -- house / mansion / land
  price           INTEGER,
  area_sqm        NUMERIC,
  price_per_sqm   NUMERIC,
  trade_year      INTEGER,
  trade_quarter   INTEGER,
  source          TEXT DEFAULT 'mlit',
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### RLSポリシー方針

| テーブル | 一般ユーザー | 管理者 |
|----------|-------------|--------|
| inage_properties | SELECT のみ | 全権限 |
| qa_questions | INSERT + published のみ SELECT | 全権限 |
| qa_answers | published のみ SELECT | 全権限 |
| notify_subscribers | INSERT のみ | 全権限 |
| area_buyer_count | INSERT + 集計SELECT | 全権限 |
| card_usage_log | INSERT のみ | 全権限 |

---

## ページ構造とナビゲーション導線

```
/index.html
  └── 「稲毛区にお住まいの方はこちら」バナー（目立つ位置に追加）
        └── /inage/index.html（稲毛区ハブ）
              ├── 相場マップで調べる  → /inage/map.html
              ├── 質問・体験談を見る  → /inage/qa.html
              ├── 地価更新を受け取る  → /inage/notify.html
              ├── 稲毛団地チェック    → /tools/2-akiya-hunter.html（稲毛団地タブ）
              └── 買い手人数を見る    → /tools/3-owner-direct.html（稲毛区絞り込み）
```

---

## データフロー設計

### 施策①相場マップ
```
国土交通省WebLandAPI（月次）
  → GitHub Actions（自動）→ Supabase: inage_properties
  → /inage/map.html: Leaflet.js + inage-geojson.json
  → 町名クリック → 過去5年価格推移グラフ表示
```

### 施策②稲毛団地診断
```
/tools/2-akiya-hunter.html に「稲毛団地チェッカー」タブ追加
  → 築年数・管理費・積立金・建替え計画 を入力
  → JS計算 → 「今売るべき/賃貸/待つ」スコア表示
  → logCardUsage() で card_usage_log に記録
  → CTA: 計算結果付き相談ボタン
```

### 施策③Q&A掲示板
```
[投稿] ユーザー → qa_questions (status='pending') に INSERT
[管理] TERRA が Supabase Table Editor で確認 → published に更新 → qa_answers に INSERT
[閲覧] published の質問一覧 → カテゴリ・町名フィルター → 詳細+回答表示
```

### 施策④メール通知
```
[登録] /inage/notify.html → notify_subscribers に INSERT
[送信] Phase 1: 手動でリスト抽出してメール送信
       Phase 2: GitHub Actions + Resend API で自動化（3ヶ月後）
```

### 施策⑤ローカルマッチング
```
/tools/3-owner-direct.html に稲毛区絞り込み追加
  → エリア・予算・物件種別 → area_buyer_count に INSERT
  → 同エリアの count を SELECT → 「現在○人が探しています」表示
```

---

## 実装フェーズ（優先順位）

### 現在の実装状況（2026-06-03時点）

| 施策 | 状態 | 詳細 |
|------|------|------|
| ① 稲毛区 相場マップ | ✅ 完成 | Supabase実データ216件・TOWN_NORMALIZE完備・動的トレンド表示・取引件数表示済み |
| ② 稲毛団地チェッカー | ✅ 完成 | スコア計算・Supabaseログ・累計診断件数フィードバック済み |
| ③ Q&A掲示板 | ✅ 完成 | 全6区対応・各ページに埋め込みQ&A・Supabase INSERT・フィルター・view_count RPC |
| ④ メール通知 | ✅ 完成（Phase 1+2） | 稲毛区: GitHub Actions + Resend API自動配信済み。他5区: notify.html 先行登録受付中 |
| ⑤ ローカルマッチング | ✅ 完成 | 稲毛区: area_buyer_count・sell.html・investor_profiles完成 |
| 相続税ツール | ✅ 完成 | tools/6-sozoku-zei.html 稲毛団地FAQ・空き家特例・各区ガイドへのリンク |
| **他5区 相場マップ（稲毛区同等）** | ✅ 完成（2026-06-03） | 全5区にヒートマップ（町丁目ポリゴン色分け）＋重ね合わせ8レイヤー（洪水/土砂/高潮/津波/用途地域/標高/航空/立地適正化）。data/{ward}-geojson.json・yoto-*/ritchi-* 生成済み |
| **他5区MLIT実データ** | ✅ 完成（2026-06-03） | ward_propertiesに**計2,078件**投入（中央309/花見川410/若葉414/緑465/美浜480）。anon読取OK・トレンドグラフ稼働 |
| **他5区ガイド（25本）** | ✅ 完成（2026-06-03） | 全5区に akiya/chintai/koubai/toushi/sumai-kae を各区固有内容で作成・hub/sitemap反映 |
| **マップUI刷新** | ✅ 完成（2026-06-03） | ポップアップ→「情報シート」方式（スマホ=下部シート/PC=右下カード）。タップで地図が動かずヒートマップ常時表示。コンパクト化＋地図高さ拡大 |
| **トップ導線統一** | ✅ 完成（2026-06-03） | 6区を対等カードに統一・各区map.html直行。次のステップバーも全区統一 |
| **プライバシー/ブランディング** | ✅ 完成（2026-06-03） | GitHub Organization `terra-realty-jp` へ移行しURLから個人名除去。OGP/ロゴ/ツールページの実名（石澤）を全削除しTERRA REALTYに統一。クリーンなロゴ作成 |
| **Google Search Console** | ✅ 再設定（2026-06-03） | 新URL `terra-realty-jp.github.io/real-estate/` でプロパティ追加・HTMLファイル確認・sitemap送信 |
| **Googleビジネスプロフィール** | ✅ 素材準備（2026-06-03） | 説明文・初回投稿文・ロゴ/ヒートマップ画像を用意。登録は運営者対応 |
| **AIインデックス(llms.txt)** | ✅ 完成 | 全6区の相場データ・FAQ。新URLに更新済み |

### 次の実装優先順位（2026-06-03 更新）

| 優先度 | タスク | 理由 |
|--------|--------|------|
| 1 | **Q&A・利用ログ系テーブルのGRANT付与** | `qa_questions`/`qa_answers`/`notify_subscribers`/`area_buyer_count`/`card_usage_log` が anon SELECT不可（42501）。投入済みQ&A（回答9件）が公開ページに表示されず、週次レポートも実数を拾えない。`scripts/fix-qa-grants.sql` をSupabaseで実行すれば解消（ward_propertiesと同じ対応） |
| 2 | **集客の初動** | 健全度スコア1/100・実ユーザーほぼ0。GBP公開・SNS/LINEシェア・団地ポスティング(QR)で最初の訪問を作る。GA4/Search Consoleで効果測定 |
| 3 | **他区エリア個別ページ量産** | 稲毛区12に対し他区2〜3。各区主要町丁目のarea-*.htmlを増やし検索長尾を獲得 |
| 4 | **SNSシェアボタン/OGP最適化** | 各マップ・ガイドに共有ボタン。来訪者の拡散を促す |
| 5 | **notify_subscribers 他区配信** | 登録者が増えたら send-inage-notify を ward 対応に汎用化し各区配信 |

**※ ai-satei Phase2（実取引でAREA_UNIT動的更新）は `sbGetTownPrices` 実装済みで概ね完了。**

**実装ルール:**
- 1機能 = 1featureブランチ（新規機能の場合）
- devブランチで安定確認 → main にマージ = 本番リリース
- mainへのマージ = 本番リリース。必ず動作確認後に行う

---

## ユーザーペルソナ（稲毛区版）

実装後のレビューで「この人が2分以内に使えるか」を確認する。

### ペルソナ1: 田中みちこさん（52歳・専業主婦・スマホのみ）
- 先月、義母が亡くなり稲毛区内の実家（稲毛団地・築42年）を相続した
- 「管理費が毎月かかる」と初めて知った。売るべきか迷っている
- LINEとYahoo!ニュースのみ。「稲毛団地 どうする」で検索してこのサービスを発見
- **判定基準**: 「稲毛団地チェッカー」を見て「これは私のことだ」とわかるか

### ペルソナ2: 佐藤健一さん（47歳・会社員・副業投資に興味）
- 稲毛区の中古マンションを買って賃貸に出したいと考えている
- 「長沼町と穴川、どっちが利回りいいの？」が最初の疑問
- **判定基準**: 相場マップで「長沼町の価格帯」がすぐわかるか

### ペルソナ3: 鈴木幸子さん（58歳・パート・天台に30年住んでいる）
- 子どもが独立して夫婦2人に。天台の家を売って小さい家に住み替えを検討中
- 「天台で最近いくらで売れているの？」が知りたい
- **判定基準**: 相場マップで「天台エリア」をクリックして直近の価格がわかるか

---

## 品質チェックリスト（実装のたびに確認）

- [ ] 稲毛区の固有名詞（長沼町・天台・穴川・小仲台・作草部）がページに含まれているか
- [ ] 専門用語には必ず平易な説明が付いているか
- [ ] 入力欄に「例: 長沼町」などの参考値があるか
- [ ] 結果の数字に「良いのか悪いのか」の判断基準が書いてあるか
- [ ] スマホ幅（320〜390px）で読んだとき、テキストが詰まりすぎないか
- [ ] CTAボタン（「無料相談する」）が結果の近くにあるか

---

## gitワークフロー（セッション開始時に必ず実行）

```bash
# 1. 現在地確認
git status && git branch

# 2. リモートの最新を取得
git fetch origin

# 3. devの最新を確認
git log origin/dev --oneline -10

# 4. 作業ブランチに移動（例: 施策①なら）
git checkout feature/inage-map
git pull origin feature/inage-map
```

---

## コミットメッセージ形式

```
feat: 稲毛区相場マップ ヒートマップ表示実装
feat: Q&A掲示板 投稿フォーム追加
feat: 稲毛団地チェッカー スコア計算ロジック実装
fix: Q&A一覧 カテゴリフィルターが動かないバグ修正
chore: Supabase inage_properties テーブルRLS設定
docs: CLAUDE.md ページ構造設計を追記
```

---

## 構文チェック（コミット前に必ず実行）

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

---

## 実装ループ（トークンが尽きるまで繰り返す）

**このセクションを毎ループ開始時に読み、次のアクションを自律判断すること。**

### ループ開始時の確認手順

```bash
git status && git branch
git fetch origin
git log origin/dev --oneline -5
tail -50 /home/sishizaw/real-estate-project/improvement-log.md
```

### 優先順位（この順番を守る）

1. **重大バグ・動作不良** → 最優先で修正
2. **dev→main マージ** → 本番に未反映のコミットがあれば最優先でマージ
3. **他5区の完全実装** → 稲毛区と同等のUI/UX・実データ連携（後述の「他区実装方針」参照）
4. **qa_answers 回答投入** → Supabase Table Editorから質問20件に回答を追記
5. **稲毛区 ai-satei Phase 2** → 実取引データでAREA_UNIT動的更新

### 1サイクルの手順

1. 現在のfeatureブランチで作業中の機能を確認
2. 未実装の部分を1つ選んで実装
3. JS構文チェック（必須）
4. `git add [ファイル名]` → `git commit` → `git push`
5. improvement-log.md に記録
6. 次の実装へ。**止まらない**

### レポートルール（必須）

- **「次のアクション」の箇条書きをレスポンス末尾に書かない**
- 何をやったかを1〜2文で簡潔に報告し、そのまま次の実装に移る
- 外部APIキーや認証が必要で詰まった場合のみユーザーに確認する
- それ以外は自律判断で実装を続ける

### 各サイクル後に必ず記録（improvement-log.md）

```
## YYYY-MM-DD HH:MM

- **対象**: ファイル名
- **施策**: 施策①〜⑤
- **実装内容**: 何をどう作ったか
```

---

## 価格算定の現状と改善ロードマップ

### 現在の問題点

**現在の実装:** `AREA_UNIT['chiba'] = 350,000円/㎡` の固定値1つで千葉県全域を計算。

これは正確ではない。理由：
- 千葉県全域（市川・船橋・銚子・館山）を一律に扱っている
- 稲毛区の住宅地実勢は約16〜20万円/㎡（国土交通省2024年データ）で、現在の35万円は約2倍の過大評価
- 長沼町・天台・穴川など町丁目間の価格差（最大30%）が反映されない

### Phase 1: 稲毛区専用の基準単価を追加（即実装可能）

`AREA_UNIT` に `chiba_inage_*` キーを追加し、町丁目別の実勢に基づく値を設定する。

| キー | 基準単価（㎡） | 対象エリア |
|------|-------------|----------|
| `chiba_inage_anakai` | 210,000円 | 穴川・モノレール沿線 |
| `chiba_inage_kodai` | 195,000円 | 小仲台・天台 |
| `chiba_inage_naganuma` | 185,000円 | 長沼町・稲毛本町 |
| `chiba_inage_other` | 175,000円 | 稲毛区その他 |

これは国土交通省公示地価（2024年）と取引事例から導出した近似値。

### Phase 2: 施策①完成後（実取引データで動的更新）

`inage_properties` テーブルに実取引データが蓄積されたら：
- 町丁目 × 物件種別 × 築年帯 の組み合わせで実測 `price_per_sqm` を計算
- AREA_UNITの静的値をSupabaseの集計結果で上書き
- 「この計算に使用した実取引件数：○件」を結果に表示（信頼性の可視化）

### Phase 3: ユーザー報告データの活用（6ヶ月後）

通知登録ユーザーへのアンケート「実際にいくらで売れましたか？」で成約データを収集。
公的データ（国土交通省）+ TERRA独自データ（成約報告）の2層構造で精度を上げる。

### 重要な設計方針

**ツールの役割は「正確な査定」ではなく「相場感の取得と相談動機づけ」。**
精度を上げながらも「より正確な価格はTERRAに相談」という導線は維持する。
誤差±20%の概算でも、「自分のエリアの相場感が初めてわかった」という価値は十分ある。

---

## UI/UX方針：稲毛区ファーストへの完全切り替え（2026-05-26 追加）

### 基本方針

**このサービスは「稲毛区に住む人・稲毛区の不動産を持つ人」のためのサービス**として再設計する。
従来の「汎用不動産ツール群」から「稲毛区特化プラットフォーム（ツールは手段）」へ。

### ページ階層の逆転

```
旧: index.html（5ツール一覧） → ツールを選んで使う
新: index.html（稲毛区ハブ）  → 稲毛区の体験 → 必要時にツールへ飛ぶ
```

### index.html の役割変更

- **Before**: 5つのツールを並べた汎用ランディングページ
- **After**: 稲毛区住民向けサービスのハブ（`inage/index.html` と統合感のある入口）
  - ファーストビューに稲毛区の情報（最新相場・注目エリア・FAQ）を配置
  - 「稲毛区以外の方」向けには、5ツールへのリンクをフッター等に控えめに配置

### 既存ツールの扱い

- **削除しない**：既存5ツールはURLを変えずに残す（SEO・既存ユーザー保護）
- **入口を変える**：稲毛区コンテキスト（エリア・物件タイプ）を引き継いでツールを開く
  - 例: 相場マップで「穴川」クリック → 「穴川エリアで査定する」ボタン → AI査定ツールが穴川を初期選択した状態で開く
- **ツール単体でも使える**：直接URLアクセス時は従来通り機能する

### 実装上の注意

- `index.html` の既存CSSクラスは保持し、追加・上書きで対応する
- 既存5ツールの `<meta>` タグ・OGP・URLは変更しない（SEO維持）
- スマホ（320〜390px）での読みやすさを最優先。テキスト詰め込み禁止

---

## 実装ルール

- **Supabaseアクセスは `supabase-client.js` 経由のみ**。直接fetchでSupabaseを呼ばない
- **localStorageキー名・データ構造を変更しない**（既存ユーザーのデータが消えるため）
- **`git add` は個別ファイル指定**。`git add -A` や `git add .` は使わない
- **RLSを必ず設定**してからテーブルを公開する
- **1機能ずつコミット**。featureブランチ完成後にdevへマージ
- **mainへの直接コミット禁止**。必ずdev経由でマージ
- **どこかのサーバーにファイルをアップロードしない**

---

## 他区実装方針（2026-06-01 追加・最重要）

### 現状の問題

現在の他5区（中央・美浜・緑・花見川・若葉）は**稲毛区と同じUI/UXではない**。具体的な差分：

| 機能 | 稲毛区 | 他5区（現状） |
|------|--------|------------|
| 相場マップ | ✅ Leaflet.js + GeoJSON + Supabaseリアルタイムデータ | ❌ 静的テキスト表（「データ収集中」） |
| Q&A掲示板 | ✅ Supabase連携・カテゴリ/エリアフィルター | △ 同じコードだが区ごとのフィルタなし |
| 通知メール | ✅ GitHub Actions自動配信 | ❌ 登録フォームのみ（配信なし） |
| エリア個別ページ | ✅ 12ページ（area-*.html） | ❌ なし |
| 実取引データ | ✅ 216件（inage_properties） | ❌ 0件（ward_propertiesは空） |

### 完全実装のロードマップ

#### Step 1：実データ取得（前提条件）
`MLIT_API_KEY` を GitHub Secrets に登録 → `fetch-ward-properties.js` を手動実行（workflow_dispatch）または毎月5日の自動実行を待つ。

千葉市区コード:
- 中央区: 12101
- 花見川区: 12102
- 若葉区: 12104
- 緑区: 12105
- 美浜区: 12106

#### Step 2：各区の map.html を稲毛区版と同等に
- `inage/map.html` の構造をベースに、各区の GeoJSON + `ward_properties` クエリで再実装
- 各区の GeoJSON 境界データを `data/` に追加（scripts/fetch-ward-geojson.js を新規作成）
- ヒートマップ・ポップアップ・トレンドグラフを同等に実装

#### Step 3：通知メール自動配信を他区に拡張
- `send-inage-notify.js` を汎用化して `ward` パラメータ対応
- GitHub Actions で各区の配信をスケジュール

#### Step 4：エリア個別ページ作成
- 各区の主要エリア（3〜5エリア）に `area-*.html` を作成
- SEO長尾キーワード（「蘇我 不動産 相場」「千城台 団地 売却」等）で検索上位を狙う

### GeoJSON データの取得方法

```bash
# 国土土地情報ダウンロードサービスから各区の境界データを取得
# scripts/fetch-ward-geojson.js を実行（要: e-Stat API認証）
node scripts/fetch-ward-geojson.js --ward=chuo   # 中央区
node scripts/fetch-ward-geojson.js --ward=mihama  # 美浜区
# etc.
```

### 実装優先区の判断基準

Data Moat観点で最も価値が高い区から着手する:
1. **若葉区（千城台）** → 「千城台団地 売却」の検索需要が高い・競合ゼロ
2. **花見川区（八千代台）** → 「八千代台 築古 相続」需要・稲毛区に地理的に隣接
3. **緑区（おゆみ野）** → 「あすみが丘 空き家」「おゆみ野 売却」の検索需要
4. **美浜区（検見川浜）** → マンション売却需要・幕張エリアの投資家需要
5. **中央区** → 競合が多いため最後
