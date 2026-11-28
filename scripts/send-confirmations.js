#!/usr/bin/env node
/**
 * ダブルオプトイン: 登録確認メールの送信
 *
 * notify_subscribers / investor_profiles に新しく登録された（未確認の）メールアドレスへ
 * 「登録を確認するリンク」を送る。リンクを踏むまで、相場通知・物件通知は届かない。
 * これにより、他人のメールアドレスを勝手に登録されても配信は始まらない。
 *
 * 実行: node scripts/send-confirmations.js
 * 環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 * オプション: DRY_RUN=true（または 1）で送信せずに対象だけ表示
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const DRY_RUN      = ['1', 'true'].includes(String(process.env.DRY_RUN || '').toLowerCase());
const FROM_EMAIL   = 'info@terra-realty.jp';
const FROM_NAME    = 'TERRA REALTY';
const SITE_URL     = 'https://terra-realty-jp.github.io/real-estate';

const MAX_PER_RUN  = 50;                  // 1回の実行で送る上限（悪用時の被害を抑える）
const RESEND_WINDOW_HOURS = 24;           // 同じアドレスへの確認メールは24時間に1通まで

const TABLES = [
  { name: 'notify_subscribers', label: '稲毛区・千葉市の相場更新通知' },
  { name: 'investor_profiles',  label: '投資物件の新着通知' },
];

function sbHeaders(extra) {
  return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}

async function sbGet(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase GET ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function sbPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table} ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

function buildHtml(label, token) {
  const confirmUrl = `${SITE_URL}/subscription.html?a=confirm&t=${encodeURIComponent(token)}`;
  const cancelUrl  = `${SITE_URL}/subscription.html?a=unsubscribe&t=${encodeURIComponent(token)}`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
  <div style="background:#1a1917;padding:24px 28px;text-align:center">
    <div style="color:#c9a84c;font-size:12px;font-weight:700;letter-spacing:2px">TERRA REALTY</div>
    <div style="color:#fff;font-size:18px;font-weight:700;margin-top:6px">ご登録の確認</div>
  </div>
  <div style="padding:24px 28px;font-size:14px;color:#444;line-height:1.8">
    <p>「${label}」へのご登録ありがとうございます。</p>
    <p>下のボタンを押すと登録が完了し、通知のお届けを開始します。<br>
       ボタンを押すまで、通知メールは送信されません。</p>
    <p style="text-align:center;margin:24px 0">
      <a href="${confirmUrl}" style="display:inline-block;background:#c0522b;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:700">登録を確認する</a>
    </p>
    <p style="font-size:12px;color:#888">お心当たりがない場合は、このメールを破棄してください。登録は完了せず、今後メールが届くこともありません。
       念のため登録を取り消す場合は <a href="${cancelUrl}" style="color:#888">こちら</a>。</p>
  </div>
</div></body></html>`;
}

async function sendEmail(to, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [to], subject: '【TERRA REALTY】ご登録の確認', html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定'); process.exit(1); }
  if (!RESEND_KEY && !DRY_RUN) { console.error('RESEND_API_KEY が未設定（テスト時は DRY_RUN=true）'); process.exit(1); }

  // 直近24時間に確認メールを送ったアドレス（同じ人に何通も送らないため）
  const since = new Date(Date.now() - RESEND_WINDOW_HOURS * 3600 * 1000).toISOString();
  const recentlySent = new Set();
  for (const t of TABLES) {
    const rows = await sbGet(t.name, `confirm_sent_at=gte.${encodeURIComponent(since)}&select=email`);
    rows.forEach(r => r.email && recentlySent.add(String(r.email).toLowerCase()));
  }

  let sent = 0, suppressed = 0, failed = 0;
  for (const t of TABLES) {
    if (sent >= MAX_PER_RUN) break;
    const rows = await sbGet(t.name,
      `confirmed_at=is.null&confirm_sent_at=is.null&is_active=eq.true&email=not.is.null` +
      `&select=id,email,token&order=created_at.asc&limit=${MAX_PER_RUN}`);

    for (const row of rows) {
      if (sent >= MAX_PER_RUN) break;
      const email = String(row.email || '').toLowerCase();
      const now = new Date().toISOString();

      if (recentlySent.has(email)) {
        // 24時間以内に送信済み → 送らずに「送信済み」扱いにする（連続登録による迷惑メール化を防ぐ）
        if (!DRY_RUN) await sbPatch(t.name, `id=eq.${encodeURIComponent(row.id)}`, { confirm_sent_at: now });
        suppressed++;
        continue;
      }

      try {
        if (DRY_RUN) {
          console.log(`[DRY] ${t.name} → ${email}`);
        } else {
          await sendEmail(row.email, buildHtml(t.label, row.token));
          await sbPatch(t.name, `id=eq.${encodeURIComponent(row.id)}`, { confirm_sent_at: now });
          console.log(`✓ ${t.name} → ${email}`);
        }
        recentlySent.add(email);
        sent++;
      } catch (e) {
        failed++;
        console.error(`✗ ${t.name} → ${email}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 250)); // Resend のレート制限対策
    }
  }

  console.log(`完了: 送信 ${sent} / 重複のため省略 ${suppressed} / 失敗 ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('エラー:', e.message); process.exit(1); });
