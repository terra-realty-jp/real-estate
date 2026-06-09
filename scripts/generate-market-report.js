#!/usr/bin/env node
/**
 * 月次相場レポート自動生成（Google向け自動コンテンツフライホイール）
 *
 * Supabaseの実取引データ（inage_properties + ward_properties）から
 * 「千葉市6区 不動産相場レポート YYYY年M月」ページを生成する。
 * 毎月7日に GitHub Actions (monthly-market-report.yml) が実行し main にコミット
 * → sitemap-ping.yml の IndexNow が自動発火 → 検索エンジンに即通知。
 *
 * 生成物:
 *   reports/market/YYYY-MM.html  … 当月レポート（6区の中央値・取引件数・前年比）
 *   reports/market/index.html    … アーカイブ一覧
 *   sitemap.xml                  … 当月URLを追記（未登録の場合のみ）
 *
 * 実行: node scripts/generate-market-report.js
 * 環境変数: SUPABASE_URL / SUPABASE_ANON_KEY（未設定時は公開anonキーを使用）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://egiklnkfwynogawdfnjw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_3M5DgUWoMnXvelUiILMiAQ_aQQeGFlf';
const BASE_URL = 'https://terra-realty-jp.github.io/real-estate';
const ROOT = path.join(__dirname, '..');

const WARDS = [
  { key: 'inage',  name: '稲毛区',   table: 'inage_properties', filter: '' },
  { key: 'chuo',   name: '中央区',   table: 'ward_properties',  filter: '&ward=eq.中央区' },
  { key: 'hanami', name: '花見川区', table: 'ward_properties',  filter: '&ward=eq.花見川区' },
  { key: 'wakaba', name: '若葉区',   table: 'ward_properties',  filter: '&ward=eq.若葉区' },
  { key: 'midori', name: '緑区',     table: 'ward_properties',  filter: '&ward=eq.緑区' },
  { key: 'mihama', name: '美浜区',   table: 'ward_properties',  filter: '&ward=eq.美浜区' },
];
const TYPE_LABEL = { house: '一戸建て', mansion: 'マンション', land: '土地' };

function sbGet(pathAndQuery) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + pathAndQuery);
    https.get(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        resolve(JSON.parse(body));
      });
    }).on('error', reject);
  });
}

const median = arr => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const qIndex = r => r.trade_year * 4 + r.trade_quarter; // 四半期の通し番号

async function fetchWardStats(ward) {
  const cols = 'select=property_type,town_name,price_per_sqm,trade_year,trade_quarter';
  const rows = await sbGet(`/rest/v1/${ward.table}?${cols}${ward.filter}&price_per_sqm=not.is.null&limit=5000`);
  if (!rows.length) return null;

  const latestQ = Math.max(...rows.map(qIndex));
  const recent = rows.filter(r => qIndex(r) > latestQ - 4);          // 直近4四半期
  const prevYear = rows.filter(r => qIndex(r) > latestQ - 8 && qIndex(r) <= latestQ - 4); // その前の4四半期

  const types = {};
  for (const t of ['house', 'mansion', 'land']) {
    const cur = recent.filter(r => r.property_type === t).map(r => r.price_per_sqm);
    const prev = prevYear.filter(r => r.property_type === t).map(r => r.price_per_sqm);
    const curMed = median(cur), prevMed = median(prev);
    types[t] = {
      count: cur.length,
      median: curMed,
      yoy: (curMed && prevMed) ? ((curMed - prevMed) / prevMed) * 100 : null,
    };
  }

  const townCount = {};
  recent.forEach(r => { townCount[r.town_name] = (townCount[r.town_name] || 0) + 1; });
  const topTowns = Object.entries(townCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const y = Math.floor((latestQ - 1) / 4), q = ((latestQ - 1) % 4) + 1;
  return { types, topTowns, total: recent.length, latestLabel: `${y}年Q${q}` };
}

const fmtMan = v => v == null ? '—' : `${(Math.round(v * 10) / 10).toFixed(1)}万円/㎡`;
const fmtYoy = v => {
  if (v == null) return '—';
  const s = v >= 0 ? '+' : '';
  return `<span style="color:${v >= 0 ? '#c45e3d' : '#2a7a4b'}">${s}${v.toFixed(1)}%</span>`;
};

function wardSection(ward, st) {
  if (!st) return '';
  const rows = ['house', 'mansion', 'land'].map(t => `
        <tr><td>${TYPE_LABEL[t]}</td><td>${fmtMan(st.types[t].median)}</td><td>${st.types[t].count}件</td><td>${fmtYoy(st.types[t].yoy)}</td></tr>`).join('');
  const towns = st.topTowns.map(([n, c]) => `${n}（${c}件）`).join('、');
  return `
    <section class="ward">
      <h2>${ward.name}の相場（直近1年・成約ベース）</h2>
      <table>
        <thead><tr><th>種別</th><th>㎡単価 中央値</th><th>取引件数</th><th>前年比</th></tr></thead>
        <tbody>${rows}
        </tbody>
      </table>
      <p class="towns"><b>取引が多かった町:</b> ${towns}</p>
      <p class="cta"><a href="../../${ward.key}/map.html">→ ${ward.name}の町ごとの相場マップを見る（無料・登録不要）</a></p>
    </section>`;
}

function buildReportHtml(ym, ymLabel, sections, latestLabel) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>千葉市の不動産相場レポート ${ymLabel}｜実際に売れた価格（国交省成約データ）</title>
<meta name="description" content="${ymLabel}時点の千葉市6区（稲毛区・中央区・花見川区・若葉区・緑区・美浜区）の不動産相場。国土交通省の成約データに基づく㎡単価の中央値・取引件数・前年比を毎月自動更新。">
<link rel="canonical" href="${BASE_URL}/reports/market/${ym}.html">
<meta property="og:title" content="千葉市の不動産相場レポート ${ymLabel}">
<meta property="og:description" content="国土交通省の成約データに基づく千葉市6区の最新相場。広告の売出価格ではなく「実際に売れた価格」です。">
<meta property="og:image" content="${BASE_URL}/ogp.svg">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif; color:#333; background:#fff; line-height:1.7; }
  .wrap { max-width:760px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:1.5rem; line-height:1.4; margin:16px 0 8px; }
  .sub { color:#666; font-size:.9rem; margin-bottom:24px; }
  .note { background:#faf3ef; border-radius:8px; padding:12px 16px; font-size:.9rem; margin-bottom:24px; }
  .ward { margin-bottom:32px; }
  h2 { font-size:1.15rem; color:#c45e3d; border-left:4px solid #c45e3d; padding-left:10px; margin-bottom:12px; }
  table { width:100%; border-collapse:collapse; font-size:.92rem; }
  th,td { padding:8px 10px; border-bottom:1px solid #eee; text-align:left; }
  th { background:#faf3ef; font-size:.85rem; }
  .towns { font-size:.88rem; color:#555; margin-top:8px; }
  .cta { margin-top:8px; font-size:.92rem; }
  a { color:#c45e3d; }
  .foot { border-top:1px solid #eee; margin-top:32px; padding-top:16px; font-size:.85rem; color:#666; }
  .back { display:inline-block; margin-bottom:8px; font-size:.9rem; }
</style>
</head>
<body>
<div class="wrap">
  <a class="back" href="./">← レポート一覧</a>
  <h1>千葉市の不動産相場レポート ${ymLabel}</h1>
  <p class="sub">データ最終四半期: ${latestLabel}｜出典: 国土交通省 不動産情報ライブラリ（成約ベース）｜毎月自動更新</p>
  <div class="note">このレポートの価格は、広告に出る「売出価格」ではなく<b>実際に売れた価格（成約価格）</b>の中央値です。売出価格は成約価格より高く出るのが一般的なため、売却・購入の検討にはこちらが現実的な目安になります。なお取引件数が少ない種別は、中央値・前年比が大きくぶれることがあります。</div>
${sections}
  <div class="foot">
    <p>より詳しく町ごとの価格を知りたい方は <a href="../../index.html">TERRA REALTY 不動産かんたんツール</a> をご利用ください。相場マップ・AI査定・売りやすさ診断すべて無料・登録不要です。</p>
    <p>powered by TERRA REALTY</p>
  </div>
</div>
</body>
</html>
`;
}

function buildIndexHtml(entries) {
  const list = entries.map(e => `      <li><a href="${e.file}">${e.label} 千葉市6区 不動産相場レポート</a></li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>千葉市の不動産相場レポート一覧（毎月自動更新）｜TERRA REALTY</title>
<meta name="description" content="国土交通省の成約データに基づく千葉市6区の月次不動産相場レポート。実際に売れた価格の中央値・取引件数・前年比を毎月公開しています。">
<link rel="canonical" href="${BASE_URL}/reports/market/">
<style>
  body { font-family:"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif; color:#333; line-height:1.7; max-width:760px; margin:0 auto; padding:24px 16px; }
  h1 { font-size:1.4rem; margin-bottom:16px; }
  li { margin-bottom:8px; }
  a { color:#c45e3d; }
</style>
</head>
<body>
  <h1>千葉市の不動産相場レポート（毎月自動更新）</h1>
  <p>国土交通省の成約データに基づく、千葉市6区の「実際に売れた価格」の月次レポートです。</p>
  <ul>
${list}
  </ul>
  <p><a href="../../index.html">← TERRA REALTY トップへ</a></p>
</body>
</html>
`;
}

function addToSitemap(urls) {
  const p = path.join(ROOT, 'sitemap.xml');
  let xml = fs.readFileSync(p, 'utf8');
  let added = 0;
  for (const u of urls) {
    if (xml.includes(`<loc>${u}</loc>`)) continue;
    xml = xml.replace('</urlset>', `  <url><loc>${u}</loc></url>\n</urlset>`);
    added++;
  }
  if (added) fs.writeFileSync(p, xml);
  return added;
}

(async () => {
  const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
  const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const ymLabel = `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月`;

  let sections = '', latestLabel = '';
  for (const ward of WARDS) {
    const st = await fetchWardStats(ward);
    if (st) { sections += wardSection(ward, st); latestLabel = st.latestLabel; }
    console.log(`${ward.name}: ${st ? st.total + '件' : 'データなし'}`);
  }
  if (!sections) { console.error('全区でデータが取得できませんでした'); process.exit(1); }

  const dir = path.join(ROOT, 'reports', 'market');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ym}.html`), buildReportHtml(ym, ymLabel, sections, latestLabel));

  const entries = fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}\.html$/.test(f)).sort().reverse()
    .map(f => {
      const [y, m] = f.replace('.html', '').split('-');
      return { file: f, label: `${y}年${Number(m)}月` };
    });
  fs.writeFileSync(path.join(dir, 'index.html'), buildIndexHtml(entries));

  const added = addToSitemap([
    `${BASE_URL}/reports/market/`,
    `${BASE_URL}/reports/market/${ym}.html`,
  ]);
  console.log(`生成完了: reports/market/${ym}.html（アーカイブ${entries.length}件 / sitemap追加${added}件）`);
})().catch(e => { console.error(e.message); process.exit(1); });
