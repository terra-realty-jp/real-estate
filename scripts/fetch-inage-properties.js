#!/usr/bin/env node
/**
 * 国土交通省 不動産情報ライブラリ API（reinfolib）から
 * 千葉市稲毛区（コード: 12103）の取引データを取得し
 * Supabase の inage_properties テーブルに保存するスクリプト
 *
 * 実行: node scripts/fetch-inage-properties.js
 * 依存: Node.js 標準モジュールのみ（npm install 不要）
 * 環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY, MLIT_API_KEY
 *
 * API: https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001
 * 認証: Ocp-Apim-Subscription-Key ヘッダー
 */

const https = require('https');
const zlib  = require('zlib');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const MLIT_API_KEY = process.env.MLIT_API_KEY || '';
const CITY_CODE = '12103'; // 千葉市稲毛区

// 稲毛区内の主要町丁目 → town_name の正規化マップ
// includes() による部分一致: 例) '作草部町'.includes('作草部') = true
const TOWN_NORMALIZE = {
  '穴川':     '穴川',    // 穴川, 穴川町, 穴川1〜4丁目
  '小仲台':   '小仲台',  // 小仲台, 小仲台1〜6丁目
  '小中台':   '小仲台',  // 小中台町（旧称・API返却値）→ 小仲台
  '天台':     '天台',    // 天台, 天台町
  '長沼町':   '長沼町',  // 長沼町
  '作草部':   '作草部',  // 作草部, 作草部町
  '稲毛本町': '稲毛本町',
  '宮野木町': '宮野木町',
  '緑町':     '緑町',
  '轟町':     '轟町',
  '黒砂台':   '黒砂台',
  '柏台':     '柏台',
  '千草台':   '千草台',
  '萩台':     '萩台町',  // 萩台町
  // 追加マッピング（旧称・隣接地区）
  '稲毛東':   '稲毛本町', // 稲毛東1〜4丁目 → JR稲毛駅東側
  '稲毛町':   '稲毛本町', // 稲毛町 → JR稲毛駅周辺
  '園生':     '轟町',    // 園生町 → 轟川沿い・轟町に近い
  '山王町':   '穴川',    // 山王町 → 穴川エリア南部
  '山王':     '穴川',    // 山王（丁目あり）
};

// 直近 N 四半期のリストを返す（古い順）
function getRecentQuarters(n) {
  const d = new Date();
  let year = d.getFullYear();
  let q = Math.ceil((d.getMonth() + 1) / 3);
  const list = [];
  for (let i = 0; i < n; i++) {
    list.unshift({ year, q });
    if (q === 1) { year--; q = 4; } else { q--; }
  }
  return list;
}

// reinfolib API から1四半期分のデータを取得
function fetchInageQuarter(year, quarter) {
  return new Promise((resolve, reject) => {
    if (!MLIT_API_KEY) {
      return reject(new Error('MLIT_API_KEY が設定されていません'));
    }
    const path = `/ex-api/external/XIT001?priceClassification=01&year=${year}&quarter=${quarter}&city=${CITY_CODE}`;
    const options = {
      hostname: 'www.reinfolib.mlit.go.jp',
      path,
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': MLIT_API_KEY,
        'Accept-Encoding': 'gzip',
      },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const decompress = (res.headers['content-encoding'] === 'gzip')
          ? cb => zlib.gunzip(buf, cb)
          : cb => cb(null, buf);
        decompress((err, data) => {
          if (err) return reject(err);
          try { resolve(JSON.parse(data.toString('utf8'))); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
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

// reinfolib API の Type 文字列 → property_type
function classifyType(typeStr) {
  if (!typeStr) return null;
  if (typeStr.includes('マンション') || typeStr.includes('区分')) return 'mansion';
  if (typeStr.includes('宅地(土地と建物)') || typeStr.includes('住宅')) return 'house';
  if (typeStr.includes('宅地(土地)') || typeStr.includes('土地')) return 'land';
  return null;
}

// 取引年 / 四半期を数値に変換（新 API は Period フィールド: "2024年第3四半期"）
function parseTradeTime(r) {
  const timeStr = r.Period || r.TimeOfTransaction || '';
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

async function fetchInageData(quarters) {
  const allRecords = [];

  for (const { year, q } of quarters) {
    console.log(`  取得中: ${year}年第${q}四半期 ...`);
    try {
      const json = await fetchInageQuarter(year, q);
      if (json.data && json.data.length) {
        allRecords.push(...json.data);
        console.log(`    → ${json.data.length}件取得`);
      } else {
        console.log(`    → データなし (status: ${json.status})`);
      }
    } catch (e) {
      console.warn(`    [WARN] ${year}Q${q}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return allRecords;
}

function transformRecords(rawData, fallbackYear, fallbackQuarter) {
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
    const { year, quarter } = parseTradeTime(r);

    rows.push({
      town_name:     townName,
      property_type: propertyType,
      price:         price,
      area_sqm:      areaSqm,
      price_per_sqm: pricePerSqm,
      trade_year:    year || fallbackYear,
      trade_quarter: quarter || fallbackQuarter,
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
  const quarters = getRecentQuarters(5); // 直近5四半期（約1年強）を取得
  const fromLabel = `${quarters[0].year}Q${quarters[0].q}`;
  const toLabel   = `${quarters[quarters.length-1].year}Q${quarters[quarters.length-1].q}`;

  console.log('=== 稲毛区 不動産取引データ取得（不動産情報ライブラリ API）===');
  console.log(`取得期間: ${fromLabel} 〜 ${toLabel}（${quarters.length}四半期）`);
  console.log(`市区町村コード: ${CITY_CODE}（千葉市稲毛区）`);
  console.log(`API KEY: ${MLIT_API_KEY ? '設定済み' : '未設定（スキップ）'}\n`);

  const rawData = await fetchInageData(quarters);
  console.log(`\n合計取得: ${rawData.length}件`);

  const lastQ = quarters[quarters.length - 1];
  const rows = transformRecords(rawData, lastQ.year, lastQ.q);
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
