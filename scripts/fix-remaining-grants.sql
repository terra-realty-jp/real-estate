-- =============================================================================
-- card_usage_log / investor_profiles / property_listings の権限を最小構成に直す
--
-- 背景:
--   2026-11-28、Supabase プロジェクトの一時停止からの復帰後に GRANT 漏れが判明し、
--   暫定対応として3テーブルに anon の SELECT を付与した。しかし property_listings
--   には contact_email（売主の連絡先）が入るため、anon に読ませてはいけない。
--   anon キーは公開JS（supabase-client.js）に載っているため、anon SELECT は
--   「インターネット上の誰でも読める」と同義である。
--
--   ブラウザが実際に行う操作を調べ直した結果は次のとおり:
--     card_usage_log     … INSERT のみ（supabase-client.js の logCardUsage）
--     property_listings  … INSERT のみ（各区 sell.html の売主登録フォーム）
--     investor_profiles  … INSERT と、件数表示のための SELECT
--                          select('id', {count:'exact', head:true})
--                            .contains('town_interests',[town]).eq('is_active',true)
--                          → 必要なのは id / town_interests / is_active の3列だけ
--
--   match-notify.js の property_listings.update と weekly-analytics.js の集計は
--   service_role で動くため、anon への UPDATE / SELECT は不要。
-- =============================================================================

-- 1) 広すぎた読み取り権限を取り消す ------------------------------------------
REVOKE SELECT ON public.property_listings FROM anon, authenticated;
REVOKE SELECT ON public.card_usage_log    FROM anon, authenticated;
REVOKE SELECT ON public.investor_profiles FROM anon, authenticated;

-- 2) 「現在○人が探しています」に必要な列だけ読めるようにする -----------------
--    列単位の GRANT。budget_max / min_yield / financing は読めないままにする。
GRANT SELECT (id, town_interests, is_active) ON public.investor_profiles TO anon, authenticated;

-- 3) ブラウザからの書き込み --------------------------------------------------
GRANT INSERT ON public.card_usage_log    TO anon, authenticated;
GRANT INSERT ON public.investor_profiles TO anon, authenticated;
GRANT INSERT ON public.property_listings TO anon, authenticated;

-- 4) サーバー側（GitHub Actions は service_role で接続する） -----------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_usage_log    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investor_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_listings TO service_role;

-- =============================================================================
-- 確認用（上を実行したあとに流す）
--
--   GRANT は「テーブルに触れるか」だけを決める。行単位の絞り込みは RLS の仕事なので、
--   RLS が有効になっているかを必ず確認すること。無効だと、付与した権限の範囲で
--   全行が対象になる。
-- =============================================================================

-- RLS が有効か
SELECT relname AS table_name,
       relrowsecurity AS rls_enabled
FROM   pg_class
WHERE  relnamespace = 'public'::regnamespace
  AND  relname IN ('card_usage_log','investor_profiles','property_listings',
                   'qa_questions','qa_answers','notify_subscribers','area_buyer_count')
ORDER  BY relname;

-- どんなポリシーが入っているか
SELECT tablename, policyname, cmd, roles
FROM   pg_policies
WHERE  schemaname = 'public'
ORDER  BY tablename, policyname;

-- 誰にどの権限が付いているか（最終確認）
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM   information_schema.role_table_grants
WHERE  table_schema = 'public'
  AND  grantee IN ('anon','authenticated','service_role')
  AND  table_name IN ('card_usage_log','investor_profiles','property_listings')
GROUP  BY table_name, grantee
ORDER  BY table_name, grantee;
