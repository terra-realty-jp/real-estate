#!/usr/bin/env node
/**
 * 国土交通省 不動産取引価格情報 WebLand API から
 * 主要都市のマンション取引単価（円/㎡）を取得し
 * data/area-prices.json に保存するスクリプト
 *
 * 実行: node scripts/fetch-area-prices.js
 * 依存: Node.js 標準モジュールのみ（npm install 不要）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 出力先
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'area-prices.json');

// 現在の四半期を求める (YYYYQ 形式: 例 20244 = 2024年第4四半期)
function getCurrentQuarter() {
  const d = new Date();
  const year = d.getFullYear();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return { year, q, code: `${year}${q}` };
}

function getPrevQuarter(year, q) {
  if (q === 1) return { year: year - 1, q: 4 };
  return { year, q: q - 1 };
}

// 直近2四半期のコードを返す
function getRecentQuarters() {
  const cur = getCurrentQuarter();
  const prev = getPrevQuarter(cur.year, cur.q);
  return {
    from: `${prev.year}${prev.q}`,
    to: `${cur.year}${cur.q}`
  };
}

// MLIT API: 市区町村コード → エリアキー のマッピング
// 市区町村コードは国土交通省の市区町村コード体系に準拠
const CITY_MAP = {
  // 東京都心5区（渋谷・港・千代田・中央・新宿）
  tokyo_central: ['13104', '13103', '13101', '13102', '13104'],
  // 山手線内側エリア（豊島・文京・台東・品川）
  tokyo_yamate:  ['13116', '13112', '13106', '13109'],
  // 東京23区（代表として江東・墨田・足立）
  tokyo_23:      ['13108', '13107', '13121'],
  // 東京市部（八王子・立川・武蔵野）
  tokyo_city:    ['13201', '13202', '13203'],
  // 神奈川主要（横浜・川崎）
  kanagawa:      ['14101', '14130'],
  // 神奈川その他（相模原・横須賀）
  kanagawa_other:['14150', '14201'],
  // 埼玉（さいたま・川口）
  saitama:       ['11101', '11202'],
  // 千葉（千葉市中央区・市川・船橋）
  chiba:         ['12101', '12203', '12204'],
  // 千葉市稲毛区（全域）
  chiba_inage:   ['12103'],
  // 大阪都心（大阪市北区・中央区）
  osaka_central: ['27102', '27128'],
  // 大阪その他（堺・東大阪）
  osaka_other:   ['27201', '27227'],
  // 京都（京都市中京区・左京区）
  kyoto:         ['26104', '26106'],
  // 兵庫（神戸市中央区・灘区）
  hyogo:         ['28101', '28102'],
  // 兵庫その他（姫路）
  hyogo_other:   ['28201'],
  // 愛知（名古屋市中区・千種区）
  aichi:         ['23102', '23101'],
  // 愛知その他（豊田・岡崎）
  aichi_other:   ['23211', '23202'],
  // 福岡（福岡市中央区・博多区）
  fukuoka:       ['40131', '40132'],
  // 福岡その他（北九州・久留米）
  fukuoka_other: ['40100', '40203'],
  // 静岡（静岡市葵区・浜松市）
  shizuoka:      ['22101', '22130'],
  // 仙台（仙台市青葉区・宮城野区）
  sendai:        ['04101', '04102'],
  // 札幌（札幌市中央区・北区）
  sapporo:       ['01101', '01102'],
  // 広島（広島市中区・西区）
  hiroshima:     ['34101', '34104'],
  // 新潟（新潟市中央区）
  niigata:       ['15101'],
  // 石川（金沢市）
  ishikawa:      ['17201'],
  // 富山（富山市）
  toyama:        ['16201'],
  // 福井（福井市）
  fukui:         ['18201'],
};

// フォールバック値（APIエラー時・データなし時）
const FALLBACK_PRICES = {
  tokyo_central:   1500000,
  tokyo_yamate:    1200000,
  tokyo_23:         800000,
  tokyo_city:       500000,
  kanagawa:         650000,
  kanagawa_other:   420000,
  saitama:          380000,
  chiba:            350000,
  chiba_inage:      290000,
  osaka_central:    720000,
  osaka_other:      450000,
  kyoto:            520000,
  hyogo:            580000,
  hyogo_other:      350000,
  aichi:            580000,
  aichi_other:      320000,
  fukuoka:          480000,
  fukuoka_other:    280000,
  shizuoka:         300000,
  sendai:           320000,
  sapporo:          320000,
  hiroshima:        320000,
  niigata:          180000,
  ishikawa:         200000,
  toyama:           190000,
  fukui:            175000,
  other:            200000,
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
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

// 数値の中央値を計算
function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// 1都市コードのマンション取引データを取得し、中央値単価（円/㎡）を返す
async function fetchCityUnitPrice(cityCode, fromQ, toQ) {
  const url = `https://www.land.mlit.go.jp/webland/api/TradeListSearch?from=${fromQ}&to=${toQ}&city=${cityCode}&type=1`;
  try {
    const json = await fetchJson(url);
    if (!json.data || !json.data.length) return null;

    const prices = json.data
      .filter(r => r.Area && r.TradePrice && r.Type && r.Type.includes('マンション'))
      .map(r => Math.round(Number(r.TradePrice) / Number(r.Area)))
      .filter(v => v > 50000 && v < 5000000); // 外れ値除去

    return median(prices);
  } catch (e) {
    console.warn(`  [WARN] city=${cityCode}: ${e.message}`);
    return null;
  }
}

// エリアキーごとに複数市区町村を取得し、代表単価を算出
async function fetchAreaPrice(areaKey, cityCodes, fromQ, toQ) {
  const results = [];
  for (const code of cityCodes) {
    const price = await fetchCityUnitPrice(code, fromQ, toQ);
    if (price) results.push(price);
    // API負荷軽減のため短いウェイト
    await new Promise(r => setTimeout(r, 500));
  }
  if (!results.length) return null;
  return Math.round(results.reduce((a, b) => a + b, 0) / results.length);
}

async function main() {
  const { from, to } = getRecentQuarters();
  console.log(`取得期間: ${from} 〜 ${to}`);
  console.log('国土交通省 WebLand API からデータ取得中...\n');

  const prices = { ...FALLBACK_PRICES };
  let updated = 0;

  for (const [areaKey, cityCodes] of Object.entries(CITY_MAP)) {
    process.stdout.write(`  ${areaKey} ... `);
    const price = await fetchAreaPrice(areaKey, cityCodes, from, to);
    if (price) {
      prices[areaKey] = price;
      updated++;
      console.log(`${price.toLocaleString()} 円/㎡`);
    } else {
      console.log(`データなし → フォールバック値 ${FALLBACK_PRICES[areaKey].toLocaleString()} 円/㎡`);
    }
  }

  const output = {
    updated: new Date().toISOString(),
    source: `国土交通省 不動産取引価格情報 WebLand API（取引期間: ${from}〜${to}）`,
    period: `${from}-${to}`,
    note: 'prices は円/㎡（マンション実取引中央値ベース）。GitHub Actionsで月次自動更新されます。',
    prices,
    age_factor: {
      '0':  1.00, '5':  0.97, '10': 0.90, '15': 0.82,
      '20': 0.74, '25': 0.65, '30': 0.57, '35': 0.50, '40': 0.44
    },
    type_factor: {
      mansion:        1.00,
      kodate:         0.88,
      tochi:          0.65,
      mansion_rental: 1.05,
      apartment:      0.92
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
