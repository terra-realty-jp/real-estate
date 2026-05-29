#!/usr/bin/env node
/**
 * 週次サービス自己評価レポート
 *
 * 毎週月曜に実行し、以下を計算してメール送信:
 * 1. Supabaseの実利用データ（card_usage_log, notify_subscribers, qa_questions）
 * 2. サービス健全度スコア（0〜100点）
 * 3. 「SUUMOとの差別化」チェックリスト自動評価
 * 4. 今週のアクション提案
 *
 * 環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 */

const https = require('https');

const SUPABASE_URL  = process.env.SUPABASE_URL  || '';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND_KEY    = process.env.RESEND_API_KEY || '';
const TO_EMAIL      = process.env.REPORT_EMAIL  || 'shinji.japaaan@gmail.com';
const FROM_EMAIL    = 'info@terra-realty.jp';
const DRY_RUN       = process.env.DRY_RUN === '1';

const now     = new Date();
const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
const fmt     = d => d.toISOString().slice(0, 10);

// ── HTTP ヘルパー ──────────────────────────────────────────────────────────
function httpGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const opts = { hostname, path, method: 'GET', headers, timeout: 15000 };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data || '[]')); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
      timeout: 15000,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

const sbHost = new URL(SUPABASE_URL).hostname;
const sbAuth = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

async function sbCount(table, filter = '') {
  try {
    const path = `/rest/v1/${table}?select=id${filter ? '&' + filter : ''}&limit=1`;
    const res = await httpGet(sbHost, path, { ...sbAuth, 'Prefer': 'count=exact', 'Range': '0-0' });
    // Supabase returns count in Content-Range header — parse from response
    if (Array.isArray(res)) return res.length;
    return 0;
  } catch(e) { return -1; }
}

async function sbQuery(table, select, filter = '', limit = 20) {
  try {
    const path = `/rest/v1/${table}?select=${select}${filter ? '&' + filter : ''}&limit=${limit}`;
    const res = await httpGet(sbHost, path, sbAuth);
    return Array.isArray(res) ? res : [];
  } catch(e) { return []; }
}

// ── メイン ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 週次自己評価レポート生成中 (${fmt(weekAgo)} → ${fmt(now)})\n`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('⚠️  SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定です。スコアを0で計算します。');
  }

  // ── データ取得 ───────────────────────────────────────────────────────────
  const thisWeekFilter = `created_at=gte.${weekAgo.toISOString()}`;

  const [
    totalLogs,    weekLogs,
    totalSubs,    weekSubs,
    totalQA,      weekQA,     pendingQA,
    totalBuyers,  weekBuyers,
    totalListings,
    topCards,
    newSubs,
  ] = await Promise.all([
    sbCount('card_usage_log'),
    sbCount('card_usage_log', thisWeekFilter),
    sbCount('notify_subscribers', 'is_active=eq.true'),
    sbCount('notify_subscribers', `is_active=eq.true&${thisWeekFilter}`),
    sbCount('qa_questions', 'status=eq.published'),
    sbCount('qa_questions', thisWeekFilter),
    sbCount('qa_questions', 'status=eq.pending'),
    sbCount('area_buyer_count'),
    sbCount('area_buyer_count', thisWeekFilter),
    sbCount('property_listings'),
    sbQuery('card_usage_log', 'card_id', `${thisWeekFilter}&order=created_at.desc`, 50),
    sbQuery('notify_subscribers', 'email,town_interests,property_type,created_at', `is_active=eq.true&${thisWeekFilter}&order=created_at.desc`, 10),
  ]);

  // ── 使われたカード集計 ────────────────────────────────────────────────────
  const cardFreq = {};
  topCards.forEach(r => {
    if (r.card_id) cardFreq[r.card_id] = (cardFreq[r.card_id] || 0) + 1;
  });
  const topCardList = Object.entries(cardFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // ── エリア別需要集計 ─────────────────────────────────────────────────────
  const buyersByArea = await sbQuery('area_buyer_count', 'town_name', thisWeekFilter, 100);
  const areaFreq = {};
  buyersByArea.forEach(r => { if (r.town_name) areaFreq[r.town_name] = (areaFreq[r.town_name] || 0) + 1; });
  const topAreas = Object.entries(areaFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // ── サービス健全度スコア（0〜100）────────────────────────────────────────
  // 各軸が「SUUMOには絶対できないデータ」を蓄積しているかを測定
  let score = 0;
  const scoreBreakdown = [];

  // データ蓄積軸（40点）
  const logScore = Math.min(20, Math.floor(totalLogs / 5));
  score += logScore;
  scoreBreakdown.push({ label: 'ツール利用ログ', score: logScore, max: 20, val: `累計${totalLogs}件` });

  const subScore = Math.min(15, totalSubs * 3);
  score += subScore;
  scoreBreakdown.push({ label: '通知登録者', score: subScore, max: 15, val: `${totalSubs}人` });

  const buyerScore = Math.min(5, Math.floor(totalBuyers / 3));
  score += buyerScore;
  scoreBreakdown.push({ label: '買い手需要データ', score: buyerScore, max: 5, val: `累計${totalBuyers}件` });

  // コンテンツ軸（30点）
  const qaScore = Math.min(20, totalQA);
  score += qaScore;
  scoreBreakdown.push({ label: 'Q&A公開件数', score: qaScore, max: 20, val: `${totalQA}件` });

  const listingScore = Math.min(10, totalListings * 2);
  score += listingScore;
  scoreBreakdown.push({ label: '物件登録', score: listingScore, max: 10, val: `${totalListings}件` });

  // 成長軸（30点）
  const weekGrowth = weekLogs > 0 ? Math.min(15, weekLogs * 3) : 0;
  score += weekGrowth;
  scoreBreakdown.push({ label: '今週のツール利用', score: weekGrowth, max: 15, val: `今週${weekLogs}件` });

  const weekSubGrowth = weekSubs > 0 ? Math.min(15, weekSubs * 5) : 0;
  score += weekSubGrowth;
  scoreBreakdown.push({ label: '今週の新規登録者', score: weekSubGrowth, max: 15, val: `今週${weekSubs}人` });

  score = Math.min(100, score);

  // ── SUUMOとの差別化チェック ──────────────────────────────────────────────
  const diffChecks = [
    { item: '稲毛区限定のQ&A（33件以上）',        ok: totalQA >= 33 },
    { item: '固定資産税評価額コンテンツあり',       ok: true },
    { item: '修繕積立金値上げコンテンツあり',       ok: true },
    { item: '相続登記義務化コンテンツあり',         ok: true },
    { item: '実際のユーザーが利用ログを残している', ok: totalLogs > 0 },
    { item: '通知登録者がいる（連絡できる見込み客）', ok: totalSubs > 0 },
    { item: '売主×投資家マッチング機能あり',        ok: totalListings >= 0 },
    { item: 'エリア別買い手需要データあり',          ok: totalBuyers > 0 },
  ];
  const diffScore = diffChecks.filter(c => c.ok).length;

  // ── アクション提案 ───────────────────────────────────────────────────────
  const actions = [];
  if (pendingQA > 0)  actions.push(`🔴 未回答Q&A ${pendingQA}件あり → Supabase Dashboardで回答してください`);
  if (weekSubs === 0) actions.push('🟡 今週の新規通知登録ゼロ → AIサテイの「メール保存」ボタンが露出しているか確認');
  if (weekLogs === 0) actions.push('🟡 今週のツール利用ゼロ → Google Search ConsoleでIndexing状況を確認');
  if (totalListings === 0) actions.push('🟡 売主登録ゼロ → sell.htmlへの導線（map.html・qa.html）を強化');
  if (score < 30)     actions.push('🔴 健全度スコアが低い → 実際のユーザーを1人獲得することが最優先');
  if (score >= 30 && score < 60) actions.push('🟡 サービスは形になっている → Google Search Console登録でインデックスを加速');
  if (score >= 60)    actions.push('🟢 サービスが成長中 → 回答済みQ&Aを増やしてGoogleの評価を上げる');
  if (actions.length === 0) actions.push('🟢 今週は問題なし。コンテンツ追加と相場データ更新を継続');

  // ── HTML メール生成 ──────────────────────────────────────────────────────
  const scoreColor = score >= 60 ? '#16a34a' : score >= 30 ? '#d97706' : '#dc2626';
  const diffBadge  = diffScore >= 6 ? '🟢 強い差別化' : diffScore >= 4 ? '🟡 差別化途上' : '🔴 まだSUUMOに勝てない';

  const cardRows = topCardList.length > 0
    ? topCardList.map(([id, cnt]) => `<tr><td style="padding:4px 8px;font-size:12px;color:#44403c">${id}</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:#c0522b">${cnt}回</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:8px;font-size:12px;color:#999;text-align:center">今週の利用なし</td></tr>';

  const areaRows = topAreas.length > 0
    ? topAreas.map(([area, cnt]) => `<tr><td style="padding:4px 8px;font-size:12px;color:#44403c">${area}</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:#c0522b">${cnt}件</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:8px;font-size:12px;color:#999;text-align:center">今週の需要登録なし</td></tr>';

  const newSubRows = newSubs.length > 0
    ? newSubs.map(s => `<tr><td style="padding:4px 8px;font-size:12px;color:#44403c">${s.email}</td><td style="padding:4px 8px;font-size:11px;color:#78716c">${(s.town_interests||[]).join(', ')||'未選択'} / ${s.property_type||'any'}</td></tr>`).join('')
    : '<tr><td colspan="2" style="padding:8px;font-size:12px;color:#999;text-align:center">今週の新規登録なし</td></tr>';

  const actionItems = actions.map(a => `<li style="padding:4px 0;font-size:13px;line-height:1.6">${a}</li>`).join('');
  const diffList = diffChecks.map(c => `<li style="padding:3px 0;font-size:12px">${c.ok ? '✅' : '❌'} ${c.item}</li>`).join('');
  const scoreRows = scoreBreakdown.map(s => {
    const pct = Math.round(s.score / s.max * 100);
    const barColor = pct >= 60 ? '#16a34a' : pct >= 30 ? '#d97706' : '#dc2626';
    return `<tr>
      <td style="padding:4px 8px;font-size:12px;color:#44403c;white-space:nowrap">${s.label}</td>
      <td style="padding:4px 8px"><div style="background:#eee;border-radius:4px;height:8px"><div style="background:${barColor};width:${pct}%;height:8px;border-radius:4px"></div></div></td>
      <td style="padding:4px 8px;font-size:12px;color:#78716c;white-space:nowrap">${s.score}/${s.max}点 (${s.val})</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"></head><body style="font-family:sans-serif;background:#f5ede8;padding:20px;margin:0">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">

  <div style="background:linear-gradient(135deg,#c0522b,#d4754e);padding:28px 28px 20px;color:#fff">
    <div style="font-size:13px;opacity:0.85;margin-bottom:4px">TERRA REALTY 週次自己評価レポート</div>
    <div style="font-size:22px;font-weight:900">${fmt(weekAgo)} 〜 ${fmt(now)}</div>
    <div style="margin-top:16px;display:flex;gap:24px">
      <div><div style="font-size:11px;opacity:0.8">健全度スコア</div><div style="font-size:40px;font-weight:900;color:#fff">${score}<span style="font-size:16px">/100</span></div></div>
      <div style="border-left:1px solid rgba(255,255,255,0.3);padding-left:24px"><div style="font-size:11px;opacity:0.8">SUUMOとの差別化</div><div style="font-size:18px;font-weight:700;margin-top:8px">${diffBadge}</div><div style="font-size:11px;opacity:0.8;margin-top:4px">${diffScore}/${diffChecks.length}項目達成</div></div>
    </div>
  </div>

  <div style="padding:24px 28px">

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 16px">📈 今週の数字</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px">
      <div style="background:#f8f5f2;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:#78716c">ツール利用</div>
        <div style="font-size:28px;font-weight:900;color:#c0522b">${weekLogs}</div>
        <div style="font-size:11px;color:#999">累計 ${totalLogs}</div>
      </div>
      <div style="background:#f8f5f2;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:#78716c">新規登録者</div>
        <div style="font-size:28px;font-weight:900;color:#c0522b">${weekSubs}</div>
        <div style="font-size:11px;color:#999">累計 ${totalSubs}人</div>
      </div>
      <div style="background:#f8f5f2;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:11px;color:#78716c">新規Q&A</div>
        <div style="font-size:28px;font-weight:900;color:${pendingQA > 0 ? '#dc2626' : '#c0522b'}">${pendingQA > 0 ? '⚠️' : weekQA}</div>
        <div style="font-size:11px;color:#999">${pendingQA > 0 ? `未回答${pendingQA}件` : `公開済${totalQA}件`}</div>
      </div>
    </div>

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 12px">🎯 今週やること</h2>
    <ul style="margin:0 0 24px;padding-left:16px">${actionItems}</ul>

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 12px">📊 健全度スコア内訳</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${scoreRows}</table>

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 12px">🔥 今週よく使われたツール</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tbody>${cardRows}</tbody></table>

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 12px">📍 今週の需要登録エリア</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tbody>${areaRows}</tbody></table>

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 12px">👤 今週の新規登録者</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tbody>${newSubRows}</tbody></table>

    <h2 style="font-size:15px;font-weight:700;border-bottom:2px solid #f5ede8;padding-bottom:8px;margin:0 0 12px">🏆 SUUMOとの差別化チェック</h2>
    <ul style="margin:0 0 24px;padding-left:16px">${diffList}</ul>

    <div style="background:#f8f5f2;border-radius:10px;padding:14px;margin-bottom:8px;font-size:12px;color:#78716c;line-height:1.7">
      💡 <strong>このレポートの使い方：</strong>健全度スコア60点以上で「一般ユーザーが使い始めると意味あるサービス」になります。まず通知登録者1人・Q&A回答1件・ツール利用ログ10件が最初のマイルストーンです。
    </div>
  </div>
</div>
</body></html>`;

  console.log('\n--- レポートサマリー ---');
  console.log(`健全度スコア: ${score}/100`);
  console.log(`差別化チェック: ${diffScore}/${diffChecks.length} ${diffBadge}`);
  console.log(`今週 ツール利用: ${weekLogs}件 / 新規登録: ${weekSubs}人 / 未回答Q&A: ${pendingQA}件`);
  console.log(`累計 ログ: ${totalLogs} / 登録者: ${totalSubs} / 公開Q&A: ${totalQA}`);
  console.log('\nアクション:');
  actions.forEach(a => console.log(' ', a));

  if (DRY_RUN) {
    console.log('\n[DRY_RUN] メール送信をスキップしました。');
    return;
  }

  if (!RESEND_KEY) {
    console.log('\n⚠️  RESEND_API_KEY が未設定のためメール送信をスキップします。');
    return;
  }

  // ── Resend API でメール送信 ──────────────────────────────────────────────
  const subject = `[TERRA自己評価] ${fmt(now)} 健全度${score}点 / ${diffBadge} / 今週${weekLogs}件利用`;
  const payload = {
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to: [TO_EMAIL],
    subject,
    html,
  };

  try {
    await httpPost('api.resend.com', '/emails', { 'Authorization': `Bearer ${RESEND_KEY}` }, payload);
    console.log(`\n✅ レポートメール送信完了 → ${TO_EMAIL}`);
  } catch(e) {
    console.error('\n❌ メール送信エラー:', e.message);
    process.exit(1);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
