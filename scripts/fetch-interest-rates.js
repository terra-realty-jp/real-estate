#!/usr/bin/env node
/**
 * 日銀政策金利・住宅ローン金利を取得して data/interest-rates.json を更新
 * 日銀のAPIが変更/不安定なため、複数のソースを試みて失敗時はフォールバック値を使用
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'interest-rates.json');

const FALLBACK = {
  policy: { boj_call_rate: 0.5, short_prime_rate: 1.625 },
  mortgage: {
    variable_typical: 0.5, fixed10_typical: 1.7, flat35_typical: 2.6,
    variable_low: 0.4, variable_high: 0.7,
    fixed10_low: 1.5, fixed10_high: 2.0,
    flat35_low: 2.5, flat35_high: 2.8,
  },
  investment: {
    apartment_typical: 2.0, apartment_low: 1.5, apartment_high: 3.5,
    regional_typical: 3.0, regional_low: 2.5, regional_high: 4.5,
  },
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 日銀時系列統計 無担保コールレート（e-Stat経由）
async function fetchBOJCallRate() {
  try {
    // 日銀統計の新しいエンドポイント（e-Stat）
    const url = 'https://api.e-stat.go.jp/rest/3.0/app/json/getStatsData?appId=&statsDataId=0003411226&cnt=1&startPosition=1';
    const text = await fetchText(url);
    const json = JSON.parse(text);
    const values = json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE;
    if (Array.isArray(values) && values.length > 0) {
      const rate = parseFloat(values[values.length - 1]['$']);
      if (!isNaN(rate)) return rate;
    }
  } catch (e) {
    console.warn('[BOJ call rate] e-Stat失敗:', e.message);
  }
  return null;
}

// 住宅金融支援機構 フラット35金利（ページから取得試み）
async function fetchFlat35Rate() {
  try {
    const url = 'https://www.flat35.com/loan/loan_rates.html';
    const html = await fetchText(url);
    // 金利パターンを検索: X.XX%
    const match = html.match(/(\d\.\d{2})%.*?フラット35/);
    if (match) return parseFloat(match[1]);
  } catch (e) {
    console.warn('[Flat35] 取得失敗:', e.message);
  }
  return null;
}

async function main() {
  console.log('金利データ取得中...');

  const results = { ...FALLBACK };
  let updated_from_api = false;

  const callRate = await fetchBOJCallRate();
  if (callRate !== null) {
    results.policy.boj_call_rate = callRate;
    updated_from_api = true;
    console.log(`  日銀政策金利: ${callRate}%`);
  } else {
    console.log(`  日銀政策金利: API取得失敗 → フォールバック ${FALLBACK.policy.boj_call_rate}%`);
  }

  const flat35 = await fetchFlat35Rate();
  if (flat35 !== null) {
    results.mortgage.flat35_typical = flat35;
    results.mortgage.flat35_low = Math.round((flat35 - 0.15) * 100) / 100;
    results.mortgage.flat35_high = Math.round((flat35 + 0.15) * 100) / 100;
    updated_from_api = true;
    console.log(`  フラット35金利: ${flat35}%`);
  } else {
    console.log(`  フラット35金利: API取得失敗 → フォールバック ${FALLBACK.mortgage.flat35_typical}%`);
  }

  // 変動金利はコールレートに連動する目安で推算
  if (callRate !== null) {
    const varTypical = Math.round((callRate + 0.1) * 10) / 10;
    results.mortgage.variable_typical = varTypical;
    results.mortgage.variable_low = Math.max(0.1, varTypical - 0.2);
    results.mortgage.variable_high = varTypical + 0.3;
  }

  const source = updated_from_api
    ? 'API取得成功（日銀/住宅金融支援機構）'
    : '全ソースAPI取得失敗 → 前回フォールバック値を維持';

  const output = {
    updated: new Date().toISOString(),
    source,
    note: '金利は目安です。最新の金利は各金融機関・日銀サイトでご確認ください。',
    policy: {
      ...results.policy,
      label: `日銀政策金利（無担保コールレート）: ${results.policy.boj_call_rate}%`,
    },
    mortgage: {
      ...results.mortgage,
      variable_label: '住宅ローン変動金利（主要銀行・優遇後）',
      fixed10_label:  '住宅ローン固定10年（主要銀行）',
      flat35_label:   'フラット35（住宅金融支援機構）',
    },
    investment: {
      ...results.investment,
      apartment_label: 'アパートローン・不動産投資ローン（地銀・信金）',
      regional_label:  '地方物件・築古物件向け融資（信用金庫等）',
    },
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n完了: ${OUTPUT_PATH} を更新`);
  console.log(`  source: ${source}`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
