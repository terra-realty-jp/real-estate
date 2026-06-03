#!/usr/bin/env node
/**
 * 稲毛区 地価更新メール通知 送信スクリプト
 *
 * 処理フロー:
 *   1. Supabase notify_subscribers から有効な登録者を取得
 *   2. Supabase inage_properties から各エリアの最新相場を集計
 *   3. Supabase qa_questions から直近公開Q&Aを取得
 *   4. Resend API でパーソナライズされたHTMLメールを送信
 *
 * 実行: node scripts/send-inage-notify.js
 * 環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 * オプション: DRY_RUN=1 で送信せずに内容を確認
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND_KEY   = process.env.RESEND_API_KEY || '';
const DRY_RUN      = process.env.DRY_RUN === '1';
const FROM_EMAIL   = 'info@terra-realty.jp';
const FROM_NAME    = 'TERRA REALTY 稲毛区';
const SITE_URL     = 'https://terra-realty-jp.github.io/real-estate';

// ---- HTTP ヘルパー -------------------------------------------------------
function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data || '{}'));
        else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function supabaseGet(table, query) {
  return new Promise((resolve, reject) => {
    const sbUrl = new URL(SUPABASE_URL + '/rest/v1/' + table + '?' + query);
    const opts = {
      hostname: sbUrl.hostname,
      path: sbUrl.pathname + sbUrl.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      timeout: 15000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data || '[]'));
        else reject(new Error(`Supabase ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ---- Supabase データ取得 -------------------------------------------------
async function getSubscribers(freq) {
  const q = `is_active=eq.true&notify_freq=eq.${freq}&select=email,town_interests,property_type`;
  return supabaseGet('notify_subscribers', q);
}

async function getAreaPrices(towns) {
  // 直近2四半期の平均 price_per_sqm を町丁目・物件種別で集計
  const q = `town_name=in.(${towns.map(t => `"${t}"`).join(',')})&select=town_name,property_type,price_per_sqm,trade_year,trade_quarter&order=trade_year.desc,trade_quarter.desc`;
  const rows = await supabaseGet('inage_properties', q);
  // 町丁目×種別ごとに最新中央値を算出
  const map = {};
  rows.forEach(r => {
    const key = `${r.town_name}::${r.property_type}`;
    if (!map[key]) map[key] = [];
    if (r.price_per_sqm) map[key].push(r.price_per_sqm);
  });
  const result = {};
  Object.entries(map).forEach(([key, vals]) => {
    const [town, type] = key.split('::');
    if (!result[town]) result[town] = {};
    const sorted = vals.slice().sort((a, b) => a - b);
    result[town][type] = Math.round(sorted[Math.floor(sorted.length / 2)] || 0);
  });
  return result;
}

async function getRecentQA(towns) {
  const q = `status=eq.published&order=created_at.desc&limit=5&select=title,category,town_name`;
  const rows = await supabaseGet('qa_questions', q);
  return rows.filter(r => !r.town_name || !towns || towns.some(t => r.town_name.includes(t)));
}

// ---- メール HTML 生成 ---------------------------------------------------
function buildHtml(subscriber, priceData, qaList) {
  const towns = subscriber.town_interests || [];
  const propType = subscriber.property_type || 'any';

  const typeJa = { mansion: 'マンション', house: '一戸建て', land: '土地', any: '全種別' };
  const priceLabel = (万) => 万 ? `${Math.round(万).toLocaleString()}万円/㎡` : 'データなし';

  // 対象エリアの相場テーブル
  let priceRows = '';
  towns.forEach(town => {
    const d = priceData[town] || {};
    const types = propType === 'any' ? ['mansion', 'house', 'land'] : [propType];
    types.forEach(t => {
      if (d[t]) {
        priceRows += `<tr><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${town}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${typeJa[t]}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:700;color:#c9a84c">${priceLabel(d[t])}</td></tr>`;
      }
    });
  });
  if (!priceRows) priceRows = '<tr><td colspan="3" style="padding:12px;color:#888;text-align:center">データ取得中（来月更新予定）</td></tr>';

  // 新着Q&A
  let qaRows = '';
  qaList.slice(0, 3).forEach(q => {
    qaRows += `<li style="margin-bottom:10px;padding:10px 12px;background:#f9f7f1;border-radius:8px;font-size:14px;line-height:1.6"><strong>[${q.category || '相談'}]</strong> ${q.title}${q.town_name ? ` <span style="color:#888;font-size:12px">（${q.town_name}）</span>` : ''}</li>`;
  });
  if (!qaRows) qaRows = '<li style="color:#888;font-size:14px">新着Q&Aはありません</li>';

  return `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>稲毛区 不動産情報アップデート</title></head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <!-- ヘッダー -->
  <div style="background:#1a1917;padding:28px 32px;text-align:center">
    <div style="color:#c9a84c;font-size:13px;font-weight:700;letter-spacing:2px;margin-bottom:8px">TERRA REALTY</div>
    <div style="color:#fff;font-size:20px;font-weight:700">稲毛区 不動産情報アップデート</div>
    <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:6px">${new Date().toLocaleDateString('ja-JP', { year:'numeric', month:'long' })}号</div>
  </div>

  <!-- 本文 -->
  <div style="padding:28px 32px">
    <p style="font-size:14px;color:#444;line-height:1.8;margin-bottom:24px">
      ご登録いただいているエリア（<strong>${towns.join('・') || '稲毛区全域'}</strong>）の最新不動産情報をお届けします。
    </p>

    <!-- 相場テーブル -->
    <h2 style="font-size:16px;font-weight:700;color:#1a1917;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #c9a84c">📊 最新取引相場（国土交通省データ）</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
      <thead>
        <tr style="background:#f4f1eb">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">エリア</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">種別</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#666">㎡単価</th>
        </tr>
      </thead>
      <tbody>${priceRows}</tbody>
    </table>

    <!-- 新着Q&A -->
    <h2 style="font-size:16px;font-weight:700;color:#1a1917;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #c9a84c">💬 新着 Q&A</h2>
    <ul style="list-style:none;padding:0;margin:0 0 24px 0">${qaRows}</ul>

    <!-- CTA -->
    <div style="background:#f4f1eb;border-radius:10px;padding:20px;text-align:center;margin-bottom:16px">
      <div style="font-size:15px;font-weight:700;color:#1a1917;margin-bottom:8px">「うちの物件、今いくら？」</div>
      <div style="font-size:13px;color:#666;margin-bottom:16px;line-height:1.7">上記の相場データを使ってAI概算査定が無料でできます。<br>稲毛区専門スタッフへの相談も承ります。</div>
      <a href="${SITE_URL}/tools/1-ai-satei.html" style="display:inline-block;background:#c9a84c;color:#000;border-radius:8px;padding:12px 28px;font-size:14px;font-weight:700;text-decoration:none;margin-bottom:10px">AI査定を試す（無料）</a>
      <br>
      <a href="${SITE_URL}/inage/map.html" style="display:inline-block;background:transparent;color:#c9a84c;border:1px solid #c9a84c;border-radius:8px;padding:10px 24px;font-size:13px;font-weight:600;text-decoration:none">相場マップを見る</a>
    </div>
  </div>

  <!-- フッター -->
  <div style="background:#f4f1eb;padding:20px 32px;text-align:center;font-size:12px;color:#888">
    <p style="margin:0 0 8px">このメールは稲毛区不動産情報の更新通知を希望された方へお送りしています。</p>
    <p style="margin:0">TERRA REALTY — <a href="mailto:info@terra-realty.jp" style="color:#c9a84c">info@terra-realty.jp</a></p>
  </div>
</div>
</body>
</html>`;
}

// ---- Resend 送信 ---------------------------------------------------------
async function sendEmail(to, subject, html) {
  if (DRY_RUN) {
    console.log(`  [DRY RUN] 送信先: ${to} / 件名: ${subject}`);
    return { id: 'dry-run' };
  }
  return httpPost('api.resend.com', '/emails', { Authorization: `Bearer ${RESEND_KEY}` }, {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [to],
    subject,
    html,
  });
}

// ---- メイン -------------------------------------------------------------
async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('エラー: SUPABASE_URL と SUPABASE_SERVICE_KEY が必要です');
    process.exit(1);
  }
  if (!RESEND_KEY && !DRY_RUN) {
    console.error('エラー: RESEND_API_KEY が必要です（テスト時は DRY_RUN=1 を設定）');
    process.exit(1);
  }

  const thisMonth = new Date().getMonth();
  // weekly 登録者は毎回送信、monthly 登録者は毎回送信（ワークフロー側で月次スケジュール）
  const freqToSend = process.env.NOTIFY_FREQ || 'monthly';
  console.log(`=== 稲毛区メール通知送信 (${freqToSend}) ===`);
  if (DRY_RUN) console.log('*** DRY RUN モード ***\n');

  let subscribers;
  try {
    subscribers = await getSubscribers(freqToSend);
  } catch (e) {
    if (e.message.includes('403') || e.message.includes('42501') || e.message.includes('permission denied')) {
      console.log('⚠️  Supabase権限エラー: notify_subscribersへのSELECT権限が必要です');
      console.log('   Supabase SQL Editorで以下を実行してください:');
      console.log('   GRANT SELECT ON public.notify_subscribers TO service_role;');
      console.log('   GRANT SELECT ON public.inage_properties TO service_role;');
      console.log('   GRANT SELECT ON public.qa_questions TO service_role;');
      process.exit(0); // graceful exit（権限設定待ち）
    }
    throw e;
  }
  console.log(`登録者数: ${subscribers.length}件\n`);

  let sent = 0;
  let failed = 0;

  for (const sub of subscribers) {
    const towns = sub.town_interests || [];
    try {
      const [priceData, qaList] = await Promise.all([
        towns.length ? getAreaPrices(towns) : Promise.resolve({}),
        getRecentQA(towns),
      ]);
      const html = buildHtml(sub, priceData, qaList);
      const subject = `【稲毛区相場更新】${towns.slice(0,2).join('・')}${towns.length > 2 ? 'など' : ''}の最新情報`;
      await sendEmail(sub.email, subject, html);
      sent++;
      console.log(`✓ 送信: ${sub.email}`);
    } catch (e) {
      failed++;
      console.error(`✗ 失敗: ${sub.email} — ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200)); // Resend rate limit
  }

  console.log(`\n完了: 送信${sent}件 / 失敗${failed}件`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
