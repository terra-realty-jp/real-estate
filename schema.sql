-- =============================================
-- 不動産ツール — Supabase データベーススキーマ
-- =============================================
-- 【実行方法】
-- Supabase ダッシュボード > SQL Editor > New query
-- このファイルの内容を全て貼り付けて「Run」をクリック
-- =============================================

-- ─────────────────────────────────────────────
-- 1. 物件管理（Tool4）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS properties (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  name        TEXT        NOT NULL,
  addr        TEXT,
  type        TEXT,
  units       INTEGER     DEFAULT 1,
  rate        NUMERIC     DEFAULT 5,
  start       TEXT,
  memo        TEXT
);
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "properties_own" ON properties;
CREATE POLICY "properties_own" ON properties
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 2. テナント管理（Tool4）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  property_id TEXT,
  name        TEXT        NOT NULL,
  phone       TEXT,
  email       TEXT,
  room        TEXT,
  rent        NUMERIC     DEFAULT 0,
  deposit     NUMERIC     DEFAULT 0,
  start       TEXT,
  "end"       TEXT,
  status      TEXT        DEFAULT 'active',
  memo        TEXT
);
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenants_own" ON tenants;
CREATE POLICY "tenants_own" ON tenants
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 3. 家賃台帳（Tool4）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rents (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  tenant_id   TEXT,
  month       TEXT,
  charge      NUMERIC     DEFAULT 0,
  paid        NUMERIC     DEFAULT 0,
  date        TEXT,
  status      TEXT        DEFAULT 'unpaid',
  memo        TEXT
);
ALTER TABLE rents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rents_own" ON rents;
CREATE POLICY "rents_own" ON rents
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 4. 修繕記録（Tool4）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repairs (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  property_id TEXT,
  content     TEXT        NOT NULL,
  room        TEXT,
  priority    TEXT        DEFAULT 'normal',
  date        TEXT,
  cost        NUMERIC     DEFAULT 0,
  vendor      TEXT,
  status      TEXT        DEFAULT 'open',
  done        TEXT,
  memo        TEXT
);
ALTER TABLE repairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "repairs_own" ON repairs;
CREATE POLICY "repairs_own" ON repairs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 5. 長期修繕計画（Tool4）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planned_repairs (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  property_id TEXT,
  name        TEXT        NOT NULL,
  year        INTEGER     NOT NULL,
  cost        NUMERIC     NOT NULL
);
ALTER TABLE planned_repairs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "planned_repairs_own" ON planned_repairs;
CREATE POLICY "planned_repairs_own" ON planned_repairs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 6. 査定リード（Tool1）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS satei_leads (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  pref        TEXT,
  prop_type   TEXT,
  area_sqm    NUMERIC,
  age_years   INTEGER,
  price       NUMERIC,
  lead_name   TEXT,
  phone       TEXT,
  email       TEXT,
  remarks     TEXT
);
ALTER TABLE satei_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "satei_leads_own" ON satei_leads;
CREATE POLICY "satei_leads_own" ON satei_leads
  FOR ALL USING (auth.uid() = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- ─────────────────────────────────────────────
-- 7. 投資分析履歴（Tool5）
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inv_history (
  id          TEXT        PRIMARY KEY,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ DEFAULT now(),
  name        TEXT,
  data        JSONB
);
ALTER TABLE inv_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "inv_history_own" ON inv_history;
CREATE POLICY "inv_history_own" ON inv_history
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- 8. カード使用ログ（Phase 4-A 情報優位データ収集）
--    匿名ログ。個人特定なし。INSERTのみ許可。
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_usage_log (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  tool_id     INT,
  card_id     TEXT,
  action      TEXT        DEFAULT 'calc',
  session_id  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE card_usage_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "card_usage_log_insert" ON card_usage_log;
CREATE POLICY "card_usage_log_insert" ON card_usage_log
  FOR INSERT WITH CHECK (true);

-- ─────────────────────────────────────────────
-- 確認クエリ（実行後にテーブル一覧を確認）
-- ─────────────────────────────────────────────
SELECT table_name, pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
