#!/usr/bin/env node
/**
 * 国土交通省 不動産情報ライブラリ API から千葉市各区の取引データを取得し
 * Supabase の ward_properties テーブルに保存するスクリプト
 *
 * 実行: node scripts/fetch-ward-properties.js
 * 依存: Node.js 標準モジュールのみ
 * 環境変数:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, MLIT_API_KEY
 *   WARD_CODE  (省略時は全区) 例: 12101=中央区
 *
 * 千葉市区コード:
 *   12101 中央区  12102 花見川区  12103 稲毛区
 *   12104 若葉区  12105 緑区      12106 美浜区
 *
 * ※ ward_properties テーブルは先に schema-ward.sql で作成してください
 */

const https = require('https');
const zlib  = require('zlib');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const MLIT_API_KEY = process.env.MLIT_API_KEY || '';

// 千葉市6区の設定
const WARDS = {
  '12101': {
    name: '中央区',
    normalize: {
      '千葉中央': '千葉中央', '富士見': '富士見', '蘇我': '蘇我',
      '川崎町': '蘇我', '中央': '千葉中央', '院内': '院内',
      '生浜': '生浜', '本町': '本町', '市場': '本町',
      '椿森': '椿森', '都町': '都町', '南町': '南町',
      '大森': '大森', '新町': '本町', '問屋町': '本町',
    },
  },
  '12102': {
    name: '花見川区',
    normalize: {
      '幕張本郷': '幕張本郷', '幕張町': '幕張本郷', '花見川': '花見川',
      '八千代台': '八千代台', 'こてはし台': 'こてはし台',
      '天戸': '天戸', '横戸': '横戸', '長作': '長作',
      '武石': '武石', '犢橋': '犢橋', '検見川': '検見川',
      '真砂': '真砂',
    },
  },
  '12104': {
    name: '若葉区',
    normalize: {
      '千城台': '千城台', '都賀': '都賀', '桜木': '桜木',
      'みつわ台': 'みつわ台', '大宮台': '大宮台', '泉町': '泉',
      '泉': '泉', '野呂': '野呂', '若松': '若松',
      '更科': '更科', '多部田': '若松', '川井': '若松',
    },
  },
  '12105': {
    name: '緑区',
    normalize: {
      'おゆみ野': 'おゆみ野', '鎌取': '鎌取', '土気': '土気',
      'あすみが丘': 'あすみが丘', '誉田': '誉田', '椎名': '椎名',
      '辺田': '辺田', '平山': '平山', '高田': '高田',
      '越智': '越智', '小食土': '土気', '大金沢': '土気',
    },
  },
  '12106': {
    name: '美浜区',
    normalize: {
      '幕張': '幕張', '幕張本郷': '幕張本郷', '検見川浜': '検見川浜',
      '浜田': '浜田', '稲毛海岸': '稲毛海岸', '高洲': '高洲',
      '磯辺': '磯辺', '真砂': '真砂', '打瀬': '打瀬',
      '美浜': '美浜', '新港': '新港', '港': '新港',
    },
  },
};

// 処理対象区（環境変数で絞り込み可）
const TARGET_CODES = process.env.WARD_CODE
  ? [process.env.WARD_CODE]
  : Object.keys(WARDS);

function normalizeTown(rawName, normalizeMap) {
  for (const [key, val] of Object.entries(normalizeMap)) {
    if (rawName.includes(key)) return val;
  }
  return null;
}

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

function fetchQuarter(cityCode, year, quarter) {
  return new Promise((resolve, reject) => {
    if (!MLIT_API_KEY) return reject(new Error('MLIT_API_KEY が設定されていません'));
    const path = `/ex-api/external/XIT001?priceClassification=01&year=${year}&quarter=${quarter}&city=${cityCode}`;
    const options = {
      hostname: 'www.reinfolib.mlit.go.jp',
      path, method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': MLIT_API_KEY, 'Accept-Encoding': 'gzip' },
      timeout: 30000,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const decompress = res.headers['content-encoding'] === 'gzip'
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
      timeout: 30000,
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

function classifyType(typeStr) {
  if (!typeStr) return null;
  if (typeStr.includes('マンション') || typeStr.includes('区分')) return 'mansion';
  if (typeStr.includes('宅地(土地と建物)') || typeStr.includes('住宅')) return 'house';
  if (typeStr.includes('宅地(土地)') || typeStr.includes('土地')) return 'land';
  return null;
}

function parseTradeTime(item) {
  // API は英語フィールド Period: "2024年第3四半期" を返す
  const timeStr = item.Period || item.TimeOfTransaction || item['取引時点'] || '';
  const m = timeStr.match(/(\d{4})年第(\d)四半期/);
  if (m) return { year: parseInt(m[1]), quarter: parseInt(m[2]) };
  // フォールバック: "2024年第１四半期" 形式（全角数字）
  const m2 = timeStr.match(/(\d{4})年第([１２３４])四半期/);
  if (m2) {
    const qMap = { '１': 1, '２': 2, '３': 3, '４': 4 };
    return { year: parseInt(m2[1]), quarter: qMap[m2[2]] || null };
  }
  return { year: null, quarter: null };
}

function parseRecord(item, normalizeMap, wardName) {
  // API は英語フィールド名で返す（fetch-inage-properties.js と同じ）
  const districtName = item.DistrictName || item['所在地名称'] || '';
  const town = normalizeTown(districtName, normalizeMap);
  if (!town) return null;

  const propType = classifyType(item.Type || item['種類'] || '');
  if (!propType) return null;

  // TradePrice は円単位、万円に変換
  const priceRaw = item.TradePrice || item['取引価格（総額）'] || '0';
  const price = Math.round(Number(priceRaw) / 10000);
  const area = parseFloat(item.Area || item['面積（㎡）'] || '0');
  if (price <= 0 || area <= 0) return null;
  if (price < 100 || price > 100000) return null; // 明らかな異常値除外
  if (area < 10 || area > 5000) return null;

  const pricePerSqm = Math.round((price * 10000) / area) / 10000; // 万円/㎡

  const { year: tradeYear, quarter: tradeQuarter } = parseTradeTime(item);
  if (!tradeYear || !tradeQuarter) return null;

  return {
    ward: wardName,
    town_name: town,
    property_type: propType,
    price: price,
    area_sqm: area,
    price_per_sqm: pricePerSqm,
    trade_year: tradeYear,
    trade_quarter: tradeQuarter,
    source: 'mlit',
  };
}

async function processWard(cityCode) {
  const ward = WARDS[cityCode];
  if (!ward) { console.error(`未知の区コード: ${cityCode}`); return; }
  console.log(`\n=== ${ward.name}（${cityCode}）処理開始 ===`);

  const quarters = getRecentQuarters(12);
  const allRecords = [];
  let unmapped = new Set();

  for (const { year, q } of quarters) {
    console.log(`  ${year}年Q${q} 取得中...`);
    try {
      const data = await fetchQuarter(cityCode, year, q);
      const items = data?.data || [];
      let count = 0;
      for (const item of items) {
        const townRaw = item.DistrictName || item['所在地名称'] || '';
        const typeRaw = item.Type || item['種類'] || '';
        const rec = parseRecord(item, ward.normalize, ward.name);
        if (rec) { allRecords.push(rec); count++; }
        else if (townRaw && !['農地', '林地', '工業用途'].some(t => typeRaw.includes(t))) {
          unmapped.add(townRaw.slice(0, 20));
        }
      }
      console.log(`    → ${count}件 取得`);
    } catch (e) {
      console.warn(`    → スキップ: ${e.message}`);
    }
  }

  console.log(`  合計: ${allRecords.length}件 取得`);
  if (unmapped.size > 0) {
    console.log(`  未マッピング地名サンプル:`, [...unmapped].slice(0, 10).join(', '));
  }
  if (allRecords.length === 0) { console.log('  データなし'); return; }

  // 既存データを削除してから INSERT
  console.log(`  既存データ削除中...`);
  const del = await supabaseRequest(`/rest/v1/ward_properties?ward=eq.${encodeURIComponent(ward.name)}`, 'DELETE', null);
  console.log(`  削除: ${del.status}`);

  // バッチ INSERT (100件ずつ)
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < allRecords.length; i += BATCH) {
    const batch = allRecords.slice(i, i + BATCH);
    const res = await supabaseRequest('/rest/v1/ward_properties', 'POST', batch);
    if (res.status >= 200 && res.status < 300) { inserted += batch.length; }
    else { console.error(`  INSERT エラー (${res.status}):`, JSON.stringify(res.data).slice(0, 200)); }
  }
  console.log(`  INSERT 完了: ${inserted}件`);
}

async function main() {
  console.log('千葉市 各区 不動産取引データ取得スクリプト');
  console.log(`対象区コード: ${TARGET_CODES.join(', ')}`);
  console.log(`SUPABASE_URL: ${SUPABASE_URL ? '設定済み' : '未設定'}`);
  console.log(`MLIT_API_KEY: ${MLIT_API_KEY ? '設定済み' : '未設定（スキップ）'}\n`);

  if (!MLIT_API_KEY) {
    console.log('MLIT_API_KEY が未設定のためスキップします');
    console.log('GitHub Secrets に MLIT_API_KEY を設定してください');
    process.exit(0);
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定です');
    process.exit(1);
  }

  for (const code of TARGET_CODES) {
    try { await processWard(code); }
    catch (e) { console.error(`区${code}エラー:`, e.message); }
  }
  console.log('\n完了');
}

main();
