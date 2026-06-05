-- ============================================================
-- qa_questions に source 列を追加（実住民の投稿 vs TERRA作成シードの区別）
-- Supabase SQL Editor で1回実行してください
-- ============================================================
-- 1) source 列を追加（新規投稿は 'user' が既定。フォームからも source='user' で入る）
ALTER TABLE qa_questions ADD COLUMN IF NOT EXISTS source text DEFAULT 'user';

-- 2) 現在あるQ&Aは全てTERRA作成のシードなので 'seed' に印付け
UPDATE qa_questions SET source = 'seed';

-- 3) 確認（seed=作成事例 / user=実住民の投稿）
SELECT source, COUNT(*) FROM qa_questions GROUP BY source;
