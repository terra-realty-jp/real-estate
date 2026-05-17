#!/usr/bin/env node
/**
 * 国土交通省 地価公示データから都道府県別平均地価を取得して data/koji-prices.json を更新
 * 毎年3月公示後にGitHub Actionsで実行
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'koji-prices.json');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchMLITKojiData() {
  // 国土交通省 地価公示 全国データ（CSVダウンロード）
  // https://www.land.mlit.go.jp/landPrice/ から最新年度データを取得
  const currentYear = new Date().getFullYear();
  const urls = [
    `https://www.land.mlit.go.jp/landPrice/getCsv.do?lang=0&year=${currentYear}&pref=00&searchKind=0`,
    `https://www.land.mlit.go.jp/landPrice/getCsv.do?lang=0&year=${currentYear - 1}&pref=00&searchKind=0`,
  ];

  for (const url of urls) {
    try {
      console.log(`試行: ${url}`);
      const csv = await fetchText(url);
      if (csv && csv.length > 1000 && csv.includes(',')) {
        console.log(`取得成功: ${csv.length}文字`);
        return { csv, year: url.includes(String(currentYear)) ? currentYear : currentYear - 1 };
      }
    } catch (e) {
      console.warn(`  失敗: ${e.message}`);
    }
  }
  return null;
}

// CSV から都道府県別住宅地平均を計算
function parseKojiCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  const result = {};

  for (const line of lines.slice(1)) { // ヘッダースキップ
    const cols = line.split(',');
    if (cols.length < 10) continue;

    const pref = cols[0]?.trim();        // 都道府県名
    const type = cols[3]?.trim();        // 用途区分
    const price = parseInt(cols[7]);     // 地価（円/㎡）

    if (!pref || isNaN(price) || price <= 0) continue;

    if (!result[pref]) result[pref] = { residential: [], commercial: [] };

    if (type === '住宅地') result[pref].residential.push(price);
    if (type === '商業地') result[pref].commercial.push(price);
  }

  // 平均値に変換
  const averaged = {};
  for (const [pref, data] of Object.entries(result)) {
    averaged[pref] = {
      residential: data.residential.length
        ? Math.round(data.residential.reduce((a, b) => a + b) / data.residential.length)
        : null,
      commercial: data.commercial.length
        ? Math.round(data.commercial.reduce((a, b) => a + b) / data.commercial.length)
        : null,
    };
  }
  return averaged;
}

async function main() {
  console.log('国土交通省 地価公示データ取得中...');

  // 既存JSONを読み込む（フォールバック用）
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch (e) {
    console.warn('既存JSONなし');
  }

  const mlitResult = await fetchMLITKojiData();
  let byPref = existing.by_prefecture || {};
  let source = '前回データを維持（API取得失敗）';

  if (mlitResult) {
    const parsed = parseKojiCSV(mlitResult.csv);
    if (Object.keys(parsed).length > 10) {
      byPref = { ...byPref, ...parsed };
      source = `国土交通省 ${mlitResult.year}年地価公示データ（API取得成功）`;
      console.log(`  ${Object.keys(parsed).length}都道府県のデータを更新`);
    } else {
      console.warn('  CSVパース結果が少ない → 既存データを維持');
    }
  }

  const output = {
    updated: new Date().toISOString(),
    source,
    note: '住宅地の全用途平均（円/㎡）。GitHub Actionsで年次自動更新（3月公示後）。',
    by_prefecture: byPref,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n完了: ${OUTPUT_PATH} を更新`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
