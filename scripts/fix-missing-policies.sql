-- =============================================================================
-- investor_profiles / property_listings に不足している RLS ポリシーを追加する
--
-- 何度流しても同じ結果になるよう DROP POLICY IF EXISTS を前置してある。
-- Supabase の SQL Editor は複数文を1トランザクションで実行するため、途中で
-- 42710（policy already exists）が出ると REVOKE / GRANT ごと巻き戻る。
--
-- 背景:
--   2026-11-28 の調査で、この2テーブルだけ RLS が有効（relrowsecurity = true）
--   なのに **ポリシーが1つも存在しない** ことが判明した。
--   PostgreSQL の RLS は「ポリシーが無い＝全拒否」なので、GRANT を正しく付けても
--   anon からの INSERT は必ず弾かれ、SELECT は常に0行を返す。
--
--   つまり各区 sell.html の売主物件登録と tools/3-owner-direct.html の投資家登録は、
--   これまで一度も保存されていなかった。両テーブルが0件なのは「誰も使わなかった」
--   のではなく「書き込めなかった」ためである。
--
--   さらに悪いことに、フロントエンドは insert の失敗を握りつぶして
--   「✓ 登録しました！」と表示していた（.catch(function(){}) ／ .catch(done)）。
--   利用者には成功したように見えていた。
--
--   既存テーブルは qa_questions / notify_subscribers / area_buyer_count と同じ
--   「public insert」「count select」の形でポリシーを持っているため、それに揃える。
-- =============================================================================

-- property_listings ----------------------------------------------------------
--   ブラウザは INSERT のみ（各区 sell.html の売主登録フォーム）。
--   contact_email を含むため SELECT ポリシーは作らない。
--   運営側の閲覧と match-notify.js の UPDATE は service_role（RLS を迂回）で行う。
DROP POLICY IF EXISTS "public insert" ON public.property_listings;
CREATE POLICY "public insert" ON public.property_listings
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- investor_profiles ----------------------------------------------------------
--   ブラウザは INSERT と、「現在○人が探しています」の件数取得のための SELECT。
DROP POLICY IF EXISTS "public insert" ON public.investor_profiles;
CREATE POLICY "public insert" ON public.investor_profiles
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

--   USING (true) は「全行が対象」という意味なので、どの列まで見せるかは
--   列単位 GRANT だけが決めている。その GRANT が将来うっかり
--   `GRANT SELECT ON investor_profiles TO anon` で上書きされると、
--   予算や融資条件まで一度に露出する。実際このプロジェクトでは
--   2026-11-28 にその取り違えが起きている。
--   そのためポリシーと列制限を同じファイルに入れ、この SQL を単体で流しても
--   広がらないようにしておく。対象ロールも public ではなく anon/authenticated に絞る。
REVOKE SELECT ON public.investor_profiles FROM anon, authenticated;
GRANT  SELECT (id, town_interests, is_active) ON public.investor_profiles TO anon, authenticated;

DROP POLICY IF EXISTS "count select" ON public.investor_profiles;
CREATE POLICY "count select" ON public.investor_profiles
  FOR SELECT TO anon, authenticated
  USING (true);

--   より堅くするなら、基底テーブルを一切見せず件数だけ返す関数に置き換える方法がある。
--   ただし各区 sell.html 6本の呼び出しを .rpc() に書き換える必要があるため、ここでは採らない。
--     CREATE FUNCTION public.investor_count(town text) RETURNS bigint
--       LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
--         SELECT count(*) FROM investor_profiles
--         WHERE is_active AND town = ANY(town_interests) $$;
--     GRANT EXECUTE ON FUNCTION public.investor_count(text) TO anon;
--     -- そのうえで "count select" ポリシーと列 GRANT を削除する

-- =============================================================================
-- 確認用（上を実行したあとに流す）
-- =============================================================================

-- ポリシーが付いたか
SELECT tablename, policyname, cmd, roles
FROM   pg_policies
WHERE  schemaname = 'public'
  AND  tablename IN ('investor_profiles','property_listings')
ORDER  BY tablename, policyname;

-- 実際に書き込めるか（anon になりきって試し、最後に必ず巻き戻す）
BEGIN;
  SET LOCAL ROLE anon;
  INSERT INTO public.property_listings (town_name, property_type, hope_price, status)
    VALUES ('__test__', 'house', 1, 'pending');
  INSERT INTO public.investor_profiles (town_interests, budget_max, is_active)
    VALUES (ARRAY['__test__'], 1, true);
  RESET ROLE;
  SELECT 'INSERT 成功。下の ROLLBACK でテストデータは消えます' AS result;
ROLLBACK;
