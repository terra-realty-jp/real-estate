-- ============================================================
-- ward_properties 権限修正（緊急）
-- Supabase SQL Editor で実行してください
-- ============================================================
--
-- 【症状】
--   fetch-ward-properties.js の INSERT が全件 403 (42501 permission denied)
--   公開ページ（map.html）からも ward_properties が読めない。
--
-- 【原因】
--   ward_properties 作成時にロールへの GRANT が付与されなかった。
--   RLS ポリシー（USING true）はあるが、テーブルレベルの GRANT が無いと
--   そもそもアクセスできない。inage_properties には付いているが本テーブルには無い。
--
-- 【このSQLの効果】
--   anon/authenticated に SELECT、service_role に全権限を付与。
--   実行後に GitHub Actions の「月次 千葉市各区 不動産取引データ取得」を
--   workflow_dispatch で再実行すれば、各区 400〜480件が投入される。
-- ============================================================

GRANT SELECT ON public.ward_properties TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ward_properties TO service_role;

-- 確認：付与された権限を表示
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'ward_properties'
ORDER BY grantee, privilege_type;

-- 確認：（INSERT 後に）区別件数
-- SELECT ward, COUNT(*), ROUND(AVG(price_per_sqm)::numeric, 1) AS avg_per_sqm
-- FROM ward_properties GROUP BY ward ORDER BY ward;
