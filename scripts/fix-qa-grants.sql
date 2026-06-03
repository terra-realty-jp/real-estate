-- ============================================================
-- Q&A・利用ログ系テーブルの権限修正
-- Supabase SQL Editor で実行してください
-- ============================================================
--
-- 【症状】
--   ・公開ページ(qa.html)でDB登録のQ&A・回答が表示されない
--   ・週次レポートの「公開Q&A / 累計ログ / 登録者」が実際より少なく出る
--   ・anonアクセスで 42501 permission denied for table qa_questions 等
--
-- 【原因】
--   テーブル作成時にロールへの GRANT が付与されていない（ward_propertiesと同じ）。
--   RLSポリシーはあっても、テーブルレベルの GRANT が無いとアクセスできない。
--
-- 【効果】
--   anon に SELECT（公開ページ表示用）、service_role に全権限（自動処理・集計用）を付与。
--   RLSポリシー（published のみ等）はそのまま有効。
-- ============================================================

-- 公開ページが読む（SELECT）
GRANT SELECT ON public.qa_questions     TO anon, authenticated;
GRANT SELECT ON public.qa_answers       TO anon, authenticated;
GRANT SELECT ON public.area_buyer_count TO anon, authenticated;

-- 投稿・登録系は anon が INSERT する
GRANT INSERT ON public.qa_questions     TO anon, authenticated;
GRANT INSERT ON public.notify_subscribers TO anon, authenticated;
GRANT INSERT ON public.area_buyer_count TO anon, authenticated;
GRANT INSERT ON public.card_usage_log   TO anon, authenticated;

-- サービスロール（GitHub Actions・集計）に全権限
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_questions       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_answers         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notify_subscribers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.area_buyer_count   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_usage_log     TO service_role;

-- 確認
SELECT 'qa_questions(published)' AS t, COUNT(*) FROM qa_questions WHERE status = 'published'
UNION ALL SELECT 'qa_answers', COUNT(*) FROM qa_answers;
