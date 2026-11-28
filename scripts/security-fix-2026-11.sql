-- =====================================================================
-- セキュリティ修正 2026-11（Supabase SQL Editor で全体を1回実行）
-- ---------------------------------------------------------------------
-- 何度実行しても同じ結果になるように書いてあります（冪等）。
-- 前提: 2026-11-28 に実行済みの緊急SQL（notify_subscribers の SELECT 取り消し）
--
-- 内容
--   1. qa_questions   : 投稿は「審査待ち・住民投稿」だけ受け付ける（直接公開を防ぐ）
--   2. 投稿・登録系    : 文字数・形式の上限をポリシーで強制
--   3. 件数表示        : 個人情報テーブルを公開せず、件数だけ返す関数（RPC）
--   4. ダブルオプトイン : 確認リンクを踏むまで配信しない／ワンクリック配信停止
--   5. 関数の権限      : rls_auto_enable を外部から実行不可に、search_path 固定
--   6. 不要な権限      : anon/authenticated の TRUNCATE・TRIGGER・REFERENCES を取り消し
--   7. service_role   : 配信スクリプトに必要な権限
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. qa_questions
-- ---------------------------------------------------------------------
alter table public.qa_questions add column if not exists source text default 'user';

drop policy if exists "public insert" on public.qa_questions;
drop policy if exists "qa insert pending only" on public.qa_questions;
create policy "qa insert pending only" on public.qa_questions
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and coalesce(source, 'user') = 'user'
    and coalesce(view_count, 0) = 0
    and char_length(title) between 1 and 120
    and char_length(body)  between 1 and 3000
    and char_length(coalesce(category, ''))  <= 20
    and char_length(coalesce(town_name, '')) <= 50
    and char_length(coalesce(session_id, '')) <= 100
  );

-- ---------------------------------------------------------------------
-- 2. 投稿・登録系の入力制限
-- ---------------------------------------------------------------------
-- 売却物件の掲載依頼（誰でも INSERT 可だが、形と長さを制限）
drop policy if exists "public insert" on public.property_listings;
drop policy if exists "listing insert pending only" on public.property_listings;
create policy "listing insert pending only" on public.property_listings
  for insert to anon, authenticated
  with check (
    status = 'pending'
    and char_length(coalesce(town_name, '')) between 1 and 50
    and char_length(coalesce(notes, '')) <= 1000
    and char_length(coalesce(contact_email, '')) <= 254
    and hope_price between 1 and 1000000
  );

-- 買い手の関心（需要カウント用。個人情報なし）
drop policy if exists "public insert" on public.area_buyer_count;
drop policy if exists "buyer count insert limited" on public.area_buyer_count;
create policy "buyer count insert limited" on public.area_buyer_count
  for insert to anon, authenticated
  with check (
    char_length(town_name) between 1 and 50
    and char_length(coalesce(property_type, '')) <= 20
    and char_length(coalesce(session_id, '')) <= 100
  );

-- 利用ログ
drop policy if exists "card_usage_log_insert" on public.card_usage_log;
drop policy if exists "usage log insert limited" on public.card_usage_log;
create policy "usage log insert limited" on public.card_usage_log
  for insert to anon, authenticated
  with check (
    char_length(coalesce(card_id, '')) <= 100
    and char_length(coalesce(action, '')) <= 20
    and char_length(coalesce(session_id, '')) <= 100
  );

-- ---------------------------------------------------------------------
-- 4. ダブルオプトイン用の列とトリガー（3 の関数より先に作る）
-- ---------------------------------------------------------------------
alter table public.notify_subscribers
  add column if not exists token uuid not null default gen_random_uuid(),
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirm_sent_at timestamptz;
alter table public.investor_profiles
  add column if not exists token uuid not null default gen_random_uuid(),
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirm_sent_at timestamptz;

create unique index if not exists notify_subscribers_token_key on public.notify_subscribers(token);
create unique index if not exists investor_profiles_token_key  on public.investor_profiles(token);

-- 利用者が token や確認済みフラグを自分で入れられないよう、INSERT 時に必ず上書きする
create or replace function public.reset_optin_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.token := gen_random_uuid();
  new.confirmed_at := null;
  new.confirm_sent_at := null;
  return new;
end;
$$;
revoke all on function public.reset_optin_fields() from public, anon, authenticated;

drop trigger if exists notify_subscribers_reset_optin on public.notify_subscribers;
create trigger notify_subscribers_reset_optin
  before insert on public.notify_subscribers
  for each row execute function public.reset_optin_fields();

drop trigger if exists investor_profiles_reset_optin on public.investor_profiles;
create trigger investor_profiles_reset_optin
  before insert on public.investor_profiles
  for each row execute function public.reset_optin_fields();

-- 通知登録（メールアドレスの形式と長さを制限）
drop policy if exists "public insert" on public.notify_subscribers;
drop policy if exists "subscriber insert limited" on public.notify_subscribers;
create policy "subscriber insert limited" on public.notify_subscribers
  for insert to anon, authenticated
  with check (
    char_length(email) <= 254
    and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and coalesce(array_length(town_interests, 1), 0) <= 30
  );

-- 投資家登録（メールは任意。入れる場合は形式チェック）
drop policy if exists "public insert" on public.investor_profiles;
drop policy if exists "investor insert limited" on public.investor_profiles;
create policy "investor insert limited" on public.investor_profiles
  for insert to anon, authenticated
  with check (
    (email is null or (char_length(email) <= 254
                       and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
    and coalesce(array_length(town_interests, 1), 0) <= 30
  );

-- 件数のためだけに全行を公開していたポリシーを削除（現在は権限が無く読めないが、将来の事故防止）
drop policy if exists "count select" on public.investor_profiles;
drop policy if exists "count select" on public.notify_subscribers;
revoke select on public.investor_profiles  from anon, authenticated;
revoke select on public.notify_subscribers from anon, authenticated;

-- 確認リンク: token が一致する登録を「確認済み」にする
create or replace function public.confirm_subscription(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare n int := 0; m int := 0;
begin
  update public.notify_subscribers set confirmed_at = now()
   where token = p_token and confirmed_at is null and is_active;
  get diagnostics n = row_count;
  update public.investor_profiles set confirmed_at = now()
   where token = p_token and confirmed_at is null and is_active;
  get diagnostics m = row_count;
  return (n + m) > 0
      or exists (select 1 from public.notify_subscribers where token = p_token and confirmed_at is not null)
      or exists (select 1 from public.investor_profiles  where token = p_token and confirmed_at is not null);
end;
$$;

-- 配信停止リンク: token が一致する登録を停止する
create or replace function public.unsubscribe(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare n int := 0; m int := 0;
begin
  update public.notify_subscribers set is_active = false where token = p_token;
  get diagnostics n = row_count;
  update public.investor_profiles  set is_active = false where token = p_token;
  get diagnostics m = row_count;
  return (n + m) > 0;
end;
$$;

revoke all on function public.confirm_subscription(uuid) from public;
revoke all on function public.unsubscribe(uuid) from public;
grant execute on function public.confirm_subscription(uuid) to anon, authenticated;
grant execute on function public.unsubscribe(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. 件数だけを返す関数（確認済み・有効な登録だけ数える）
-- ---------------------------------------------------------------------
create or replace function public.count_active_subscribers(p_town text default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(*)::int from public.notify_subscribers
  where is_active and confirmed_at is not null
    and (p_town is null or p_town = any(town_interests));
$$;

-- sell ページの「このエリアで探している人」= 確認済み投資家 + 買い手の関心登録
create or replace function public.count_town_demand(p_town text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*) from public.investor_profiles
      where is_active and confirmed_at is not null and p_town = any(town_interests))::int
  + (select count(*) from public.area_buyer_count where town_name = p_town)::int;
$$;

revoke all on function public.count_active_subscribers(text) from public;
revoke all on function public.count_town_demand(text) from public;
grant execute on function public.count_active_subscribers(text) to anon, authenticated;
grant execute on function public.count_town_demand(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. 既存関数の権限
-- ---------------------------------------------------------------------
-- RLS 自動有効化用の管理関数: 外部から呼べる必要はない
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 閲覧数カウント: search_path を固定（関数の乗っ取り対策）
alter function public.increment_qa_view(uuid) set search_path = public;

-- ---------------------------------------------------------------------
-- 6. 不要な権限の取り消し（API からは使えないが、多層防御として）
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on public.%I from anon, authenticated', t.tablename);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. 配信スクリプト（GitHub Actions / service_role）に必要な権限
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.notify_subscribers to service_role;
grant select, insert, update, delete on public.investor_profiles  to service_role;
grant select, insert, update, delete on public.property_listings  to service_role;

commit;

-- ---------------------------------------------------------------------
-- 確認（実行後に結果を見る）
-- ---------------------------------------------------------------------
select tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public' order by 1, 2;
