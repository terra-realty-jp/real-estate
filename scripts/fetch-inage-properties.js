#!/usr/bin/env node
/**
 * 国土交通省 不動産取引価格情報 WebLand API から
 * 千葉市稲毛区（コード: 12103）の取引データを取得し
 * Supabase の inage_properties テーブルに保存するスクリプト
 *
 * 実行: node scripts/fetch-inage-properties.js
 * 依存: Node.js 標準モジュールのみ（npm install 不要）
 * 環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const CITY_CODE = '12103'; // 千葉市稲毛区

// 稲毛区内の主要町丁目 → town_name の正規化マップ
const TOWN_NORMALIZE = {
  '穴川':     '穴川',
  '小仲台':   '小仲台',
  '天台':     '天台',
  '長沼町':   '長沼町',
  '作草部':   '作草部',
  '稲毛本町': '稲毛本町',
  '宮野木町': '宮野木町',
  '緑町':     '緑町',
  '轟町':     '轟町',
  '黒砂台':   '黒砂台',
  '柏台':     '柏台',
  '千草台':   '千草台',
};

function getCurrentQuarter() {
  const d = new Date();
  const year = d.getFullYear();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return { year, q };
}

function getPrevQuarter(year, q) {
  if (q === 1) return { year: year - 1, q: 4 };
  return { year, q: q - 1 };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function supabaseRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      timeout: 15000,
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// MLIT の物件タイプ文字列 → property_type
function classifyType(typeStr) {
  if (!typeStr) return null;
  if (typeStr.includes('マンション') || typeStr.includes('区分')) return 'mansion';
  if (typeStr.includes('宅地(土地と建物)') || typeStr.includes('住宅')) return 'house';
  if (typeStr.includes('宅地(土地)') || typeStr.includes('土地')) return 'land';
  return null;
}

// 取引年 / 四半期を数値に変換
function parseTradeTime(timeStr) {
  if (!timeStr) return { year: null, quarter: null };
  const m = timeStr.match(/(\d{4})年第(\d)四半期/);
  if (m) return { year: parseInt(m[1]), quarter: parseInt(m[2]) };
  return { year: null, quarter: null };
}

// 町丁目名を正規化（部分一致）
function normalizeTown(districtName) {
  if (!districtName) return null;
  for (const [key, normalized] of Object.entries(TOWN_NORMALIZE)) {
    if (districtName.includes(key)) return normalized;
  }
  return null;
}

async function fetchInageData(fromQ, toQ) {
  // type=1: 宅地（マンション等）、type=2: 宅地（土地と建物）、type=3: 宅地（土地）
  const types = ['1', '2', '3'];
  const allRecords = [];

  for (const t of types) {
    const url = `https://www.land.mlit.go.jp/webland/api/TradeListSearch?from=${fromQ}&to=${toQ}&city=${CITY_CODE}&type=${t}`;
    console.log(`  取得中: type=${t} ...`);
    try {
      const json = await fetchJson(url);
      if (json.data && json.data.length) {
        allRecords.push(...json.data);
        console.log(`    → ${json.data.length}件取得`);
      } else {
        console.log(`    → データなし`);
      }
    } catch (e) {
      console.warn(`    [WARN] type=${t}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  return allRecords;
}

function transformRecords(rawData, tradeYear, tradeQuarter) {
  const rows = [];
  for (const r of rawData) {
    const propertyType = classifyType(r.Type);
    if (!propertyType) continue;

    const price = r.TradePrice ? Math.round(Number(r.TradePrice) / 10000) : null; // 万円
    const areaSqm = r.Area ? Number(r.Area) : null;
    const pricePerSqm = (price && areaSqm) ? Math.round(price * 10000 / areaSqm) / 10000 : null; // 万円/㎡

    if (!price || price < 100 || price > 100000) continue; // 明らかな異常値除外
    if (areaSqm && (areaSqm < 10 || areaSqm > 5000)) continue;

    const townName = normalizeTown(r.DistrictName) || '稲毛区その他';
    const { year, quarter } = parseTradeTime(r.TimeOfTransaction);

    rows.push({
      town_name:     townName,
      property_type: propertyType,
      price:         price,
      area_sqm:      areaSqm,
      price_per_sqm: pricePerSqm,
      trade_year:    year || tradeYear,
      trade_quarter: quarter || tradeQuarter,
      source:        'mlit',
    });
  }
  return rows;
}

async function upsertToSupabase(rows) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[SKIP] SUPABASE_URL/SUPABASE_SERVICE_KEY が未設定のためSupabase保存をスキップ');
    return;
  }
  // バッチ100件ずつ INSERT
  const batchSize = 100;
  let saved = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      await supabaseRequest('/rest/v1/inage_properties', 'POST', batch);
      saved += batch.length;
      console.log(`  Supabase: ${saved}/${rows.length}件保存完了`);
    } catch (e) {
      console.error(`  [ERROR] Supabase INSERT失敗: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
}

async function main() {
  const cur = getCurrentQuarter();
  const prev = getPrevQuarter(cur.year, cur.q);
  const fromQ = `${prev.year}${prev.q}`;
  const toQ = `${cur.year}${cur.q}`;

  console.log('=== 稲毛区 不動産取引データ取得 ===');
  console.log(`取得期間: ${fromQ} 〜 ${toQ}`);
  console.log(`市区町村コード: ${CITY_CODE}（千葉市稲毛区）\n`);

  const rawData = await fetchInageData(fromQ, toQ);
  console.log(`\n合計取得: ${rawData.length}件`);

  const rows = transformRecords(rawData, cur.year, cur.q);
  console.log(`変換後: ${rows.length}件（異常値除外後）`);

  // 町丁目別集計を表示
  const summary = {};
  rows.forEach(r => {
    if (!summary[r.town_name]) summary[r.town_name] = { mansion: 0, house: 0, land: 0 };
    summary[r.town_name][r.property_type]++;
  });
  console.log('\n町丁目別件数:');
  Object.entries(summary).sort((a, b) => {
    const aTotal = a[1].mansion + a[1].house + a[1].land;
    const bTotal = b[1].mansion + b[1].house + b[1].land;
    return bTotal - aTotal;
  }).forEach(([town, counts]) => {
    console.log(`  ${town}: マンション${counts.mansion} 戸建${counts.house} 土地${counts.land}`);
  });

  await upsertToSupabase(rows);
  console.log('\n完了');
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
