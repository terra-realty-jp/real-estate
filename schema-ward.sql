-- ward_properties テーブル
-- 千葉市6区の取引データを統合管理（稲毛区は inage_properties と並行）
-- Supabase SQL Editor で実行してください

CREATE TABLE IF NOT EXISTS ward_properties (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ward            TEXT NOT NULL,           -- 中央区 / 花見川区 / 若葉区 / 緑区 / 美浜区
  town_name       TEXT NOT NULL,
  property_type   TEXT NOT NULL,           -- house / mansion / land
  price           INTEGER,                 -- 万円
  area_sqm        NUMERIC,
  price_per_sqm   NUMERIC,                 -- 万円/㎡
  trade_year      INTEGER,
  trade_quarter   INTEGER,
  source          TEXT DEFAULT 'mlit',
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- インデックス（クエリ高速化）
CREATE INDEX IF NOT EXISTS ward_properties_ward_idx ON ward_properties(ward);
CREATE INDEX IF NOT EXISTS ward_properties_town_idx ON ward_properties(town_name);
CREATE INDEX IF NOT EXISTS ward_properties_type_idx ON ward_properties(property_type);

-- RLS有効化
ALTER TABLE ward_properties ENABLE ROW LEVEL SECURITY;

-- 一般ユーザー: SELECT のみ
CREATE POLICY "ward_properties_select" ON ward_properties
  FOR SELECT USING (true);

-- ★テーブルレベルの GRANT（RLSポリシーとは別に必須）
-- これが無いと anon は SELECT 不可、service_role は INSERT 不可（42501 permission denied）
-- inage_properties は作成時に自動付与されたが、本テーブルは明示が必要。
GRANT SELECT ON public.ward_properties TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ward_properties TO service_role;

-- 確認クエリ
-- SELECT ward, COUNT(*), AVG(price_per_sqm) FROM ward_properties GROUP BY ward ORDER BY ward;
