-- schema-v2.sql
-- Tool2（空き家ハンター）・Tool3（売主・買主マッチング）のSupabaseテーブル追加
-- Supabase SQL Editor で実行してください

-- ─────────────────────────────────────────────
-- Tool2: 空き家案件管理
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS akiya_deals (
  id        text PRIMARY KEY,
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name      text,
  addr      text,
  status    text,
  buy       integer DEFAULT 0,
  sell      integer DEFAULT 0,
  score     integer DEFAULT 0,
  memo      text,
  date      text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE akiya_deals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own akiya_deals" ON akiya_deals;
CREATE POLICY "users own akiya_deals" ON akiya_deals FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- Tool3: 売主情報
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS od_sellers (
  id        text PRIMARY KEY,
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name      text,
  phone     text,
  email     text,
  price     integer DEFAULT 0,
  type      text,
  area      text,
  sqm       integer DEFAULT 0,
  age       integer DEFAULT 0,
  timing    text,
  status    text,
  memo      text,
  date      text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE od_sellers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own od_sellers" ON od_sellers;
CREATE POLICY "users own od_sellers" ON od_sellers FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- Tool3: 買主情報
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS od_buyers (
  id        text PRIMARY KEY,
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name      text,
  phone     text,
  email     text,
  budget    integer DEFAULT 0,
  type      text,
  area      text,
  sqm       integer DEFAULT 0,
  purpose   text,
  timing    text,
  loan      text,
  memo      text,
  date      text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE od_buyers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own od_buyers" ON od_buyers;
CREATE POLICY "users own od_buyers" ON od_buyers FOR ALL USING (auth.uid() = user_id);
