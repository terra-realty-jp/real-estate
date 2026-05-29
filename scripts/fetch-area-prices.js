#!/usr/bin/env node
/**
 * 国土交通省 不動産情報ライブラリ API（reinfolib）から
 * 主要都市のマンション取引単価（円/㎡）を取得し
 * data/area-prices.json に保存するスクリプト
 *
 * 実行: node scripts/fetch-area-prices.js
 * 依存: Node.js 標準モジュールのみ（npm install 不要）
 * 環境変数: MLIT_API_KEY（不動産情報ライブラリ APIキー）
 *
 * API: https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001
 * 旧 WebLand API (www.land.mlit.go.jp) から移行
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'area-prices.json');
const MLIT_API_KEY = process.env.MLIT_API_KEY || '';

// 利用可能な直近2四半期を返す
// 取引事例データは公開まで約6ヶ月のラグがあるため、6ヶ月前の四半期を基準にする
function getRecentQuarterPairs() {
  const d = new Date();
  d.setMonth(d.getMonth() - 6); // 6ヶ月前（公開済み四半期）
  let year = d.getFullYear();
  let q = Math.ceil((d.getMonth() + 1) / 3);
  const pairs = [];
  for (let i = 0; i < 2; i++) {
    pairs.unshift({ year, q });
    if (q === 1) { year--; q = 4; } else { q--; }
  }
  return pairs;
}

// MLIT API: 市区町村コード → エリアキー のマッピング
const CITY_MAP = {
  tokyo_central:   ['13104', '13103', '13101', '13102'],
  tokyo_yamate:    ['13116', '13112', '13106', '13109'],
  tokyo_23:        ['13108', '13107', '13121'],
  tokyo_city:      ['13201', '13202', '13203'],
  kanagawa:        ['14101', '14130'],
  kanagawa_other:  ['14150', '14201'],
  saitama:         ['11101', '11202'],
  chiba:           ['12101', '12203', '12204'],
  chiba_inage:     ['12103'],
  osaka_central:   ['27102', '27128'],
  osaka_other:     ['27201', '27227'],
  kyoto:           ['26104', '26106'],
  hyogo:           ['28101', '28102'],
  hyogo_other:     ['28201'],
  aichi:           ['23102', '23101'],
  aichi_other:     ['23211', '23202'],
  fukuoka:         ['40131', '40132'],
  fukuoka_other:   ['40100', '40203'],
  shizuoka:        ['22101', '22130'],
  sendai:          ['04101', '04102'],
  sapporo:         ['01101', '01102'],
  hiroshima:       ['34101', '34104'],
  niigata:         ['15101'],
  ishikawa:        ['17201'],
  toyama:          ['16201'],
  fukui:           ['18201'],
};

const FALLBACK_PRICES = {
  tokyo_central:   1830000,
  tokyo_yamate:    1420000,
  tokyo_23:         920000,
  tokyo_city:       550000,
  kanagawa:         730000,
  kanagawa_other:   450000,
  saitama:          420000,
  chiba:            380000,
  chiba_inage:      290000,
  osaka_central:    900000,
  osaka_other:      520000,
  kyoto:            580000,
  hyogo:            640000,
  hyogo_other:      370000,
  aichi:            650000,
  aichi_other:      340000,
  fukuoka:          580000,
  fukuoka_other:    310000,
  shizuoka:         320000,
  sendai:           370000,
  sapporo:          460000,
  hiroshima:        350000,
  niigata:          190000,
  ishikawa:         220000,
  toyama:           200000,
  fukui:            180000,
  other:            210000,
};

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// reinfolib API から1市区町村・1四半期のデータを取得
function fetchReinfolib(cityCode, year, quarter) {
  return new Promise((resolve, reject) => {
    if (!MLIT_API_KEY) {
      return reject(new Error('MLIT_API_KEY が設定されていません'));
    }
    // priceClassification=03: 中古マンション等（マンション取引単価取得に使用）
    const reqPath = `/ex-api/external/XIT001?priceClassification=03&year=${year}&quarter=${quarter}&city=${cityCode}`;
    const options = {
      hostname: 'www.reinfolib.mlit.go.jp',
      path: reqPath,
      method: 'GET',
      headers: {
        'Ocp-Apim-Subscription-Key': MLIT_API_KEY,
      },
      timeout: 20000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data || []);
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// 1都市コードのマンション取引データを複数四半期で取得し、中央値単価（円/㎡）を返す
async function fetchCityUnitPrice(cityCode, quarterPairs) {
  const allData = [];
  for (const { year, q } of quarterPairs) {
    try {
      const records = await fetchReinfolib(cityCode, year, q);
      allData.push(...records);
    } catch (e) {
      console.warn(`  [WARN] city=${cityCode} ${year}Q${q}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (!allData.length) return null;

  const prices = allData
    .filter(r => r.Area && r.TradePrice && r.Type && r.Type.includes('マンション'))
    .map(r => Math.round(Number(r.TradePrice) / Number(r.Area)))
    .filter(v => v > 50000 && v < 5000000);

  return median(prices);
}

// エリアキーごとに複数市区町村を取得し、代表単価を算出
async function fetchAreaPrice(areaKey, cityCodes, quarterPairs) {
  const results = [];
  for (const code of cityCodes) {
    const price = await fetchCityUnitPrice(code, quarterPairs);
    if (price) results.push(price);
  }
  if (!results.length) return null;
  return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
}

async function main() {
  if (!MLIT_API_KEY) {
    console.error('❌ MLIT_API_KEY が設定されていません。環境変数を確認してください。');
    process.exit(1);
  }

  const quarterPairs = getRecentQuarterPairs();
  const periodLabel = quarterPairs.map(p => `${p.year}Q${p.q}`).join('〜');
  console.log(`取得期間: ${periodLabel}`);
  console.log('不動産情報ライブラリ API (reinfolib) からデータ取得中...\n');

  const prices = { ...FALLBACK_PRICES };
  let updated = 0;

  for (const [areaKey, cityCodes] of Object.entries(CITY_MAP)) {
    process.stdout.write(`  ${areaKey} ... `);
    const price = await fetchAreaPrice(areaKey, cityCodes, quarterPairs);
    if (price) {
      prices[areaKey] = price;
      updated++;
      console.log(`${price.toLocaleString()} 円/㎡`);
    } else {
      console.log(`データなし → フォールバック値 ${FALLBACK_PRICES[areaKey]?.toLocaleString() ?? '—'} 円/㎡`);
    }
  }

  const output = {
    updated: new Date().toISOString(),
    source: `国土交通省 不動産情報ライブラリ API（reinfolib）取引期間: ${periodLabel}`,
    period: periodLabel,
    note: 'prices は円/㎡（マンション実取引中央値ベース）。GitHub Actionsで月次自動更新されます。手動更新時は MLIT_API_KEY 環境変数が必要。',
    prices,
    age_factor: {
      '0':  1.00, '5':  0.97, '10': 0.90, '15': 0.82,
      '20': 0.74, '25': 0.65, '30': 0.57, '35': 0.50, '40': 0.44
    },
    type_factor: {
      mansion:         1.00,
      kodate:          0.88,
      tochi:           0.65,
      mansion_rental:  1.05,
      apartment:       0.92
    }
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n完了: ${updated}/${Object.keys(CITY_MAP).length} エリアを実データで更新`);
  console.log(`保存先: ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
