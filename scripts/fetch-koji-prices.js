#!/usr/bin/env node
/**
 * 国土交通省 不動産情報ライブラリ API（reinfolib）から
 * 都道府県代表都市の取引事例を取得し、都道府県別住宅地平均単価を算出して
 * data/koji-prices.json を更新するスクリプト
 *
 * 実行: node scripts/fetch-koji-prices.js
 * 環境変数: MLIT_API_KEY
 *
 * 旧実装: www.land.mlit.go.jp/landPrice/getCsv.do（DNS不能のため移行）
 * 新実装: reinfolib.mlit.go.jp/ex-api/external/XIT001（取引事例から都道府県別平均を算出）
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_PATH  = path.join(__dirname, '..', 'data', 'koji-prices.json');
const MLIT_API_KEY = process.env.MLIT_API_KEY || '';

// 都道府県代表都市コード（住宅地単価の代表として使用）
const PREF_CITY_MAP = {
  '北海道':   { residential: '01101', commercial: '01101' },
  '青森県':   { residential: '02201', commercial: '02201' },
  '岩手県':   { residential: '03201', commercial: '03201' },
  '宮城県':   { residential: '04101', commercial: '04101' },
  '秋田県':   { residential: '05201', commercial: '05201' },
  '山形県':   { residential: '06201', commercial: '06201' },
  '福島県':   { residential: '07201', commercial: '07201' },
  '茨城県':   { residential: '08201', commercial: '08201' },
  '栃木県':   { residential: '09201', commercial: '09201' },
  '群馬県':   { residential: '10201', commercial: '10201' },
  '埼玉県':   { residential: '11101', commercial: '11101' },
  '千葉県':   { residential: '12101', commercial: '12101' },
  '東京都':   { residential: '13102', commercial: '13101' },
  '神奈川県': { residential: '14101', commercial: '14101' },
  '新潟県':   { residential: '15101', commercial: '15101' },
  '富山県':   { residential: '16201', commercial: '16201' },
  '石川県':   { residential: '17201', commercial: '17201' },
  '福井県':   { residential: '18201', commercial: '18201' },
  '山梨県':   { residential: '19201', commercial: '19201' },
  '長野県':   { residential: '20201', commercial: '20201' },
  '岐阜県':   { residential: '21201', commercial: '21201' },
  '静岡県':   { residential: '22101', commercial: '22101' },
  '愛知県':   { residential: '23101', commercial: '23101' },
  '三重県':   { residential: '24201', commercial: '24201' },
  '滋賀県':   { residential: '25201', commercial: '25201' },
  '京都府':   { residential: '26104', commercial: '26104' },
  '大阪府':   { residential: '27102', commercial: '27102' },
  '兵庫県':   { residential: '28101', commercial: '28101' },
  '奈良県':   { residential: '29201', commercial: '29201' },
  '和歌山県': { residential: '30201', commercial: '30201' },
  '鳥取県':   { residential: '31201', commercial: '31201' },
  '島根県':   { residential: '32201', commercial: '32201' },
  '岡山県':   { residential: '33101', commercial: '33101' },
  '広島県':   { residential: '34101', commercial: '34101' },
  '山口県':   { residential: '35201', commercial: '35201' },
  '徳島県':   { residential: '36201', commercial: '36201' },
  '香川県':   { residential: '37201', commercial: '37201' },
  '愛媛県':   { residential: '38201', commercial: '38201' },
  '高知県':   { residential: '39201', commercial: '39201' },
  '福岡県':   { residential: '40131', commercial: '40131' },
  '佐賀県':   { residential: '41201', commercial: '41201' },
  '長崎県':   { residential: '42201', commercial: '42201' },
  '熊本県':   { residential: '43101', commercial: '43101' },
  '大分県':   { residential: '44201', commercial: '44201' },
  '宮崎県':   { residential: '45201', commercial: '45201' },
  '鹿児島県': { residential: '46201', commercial: '46201' },
  '沖縄県':   { residential: '47201', commercial: '47201' },
};

// reinfolib API から指定市区町村・四半期の取引データを取得
function fetchReinfolib(cityCode, year, quarter) {
  return new Promise((resolve, reject) => {
    if (!MLIT_API_KEY) {
      return reject(new Error('MLIT_API_KEY が設定されていません'));
    }
    // priceClassification=02: 宅地（土地と建物）- 住宅地の取引事例
    const reqPath = `/ex-api/external/XIT001?priceClassification=02&year=${year}&quarter=${quarter}&city=${cityCode}`;
    const options = {
      hostname: 'www.reinfolib.mlit.go.jp',
      path: reqPath,
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': MLIT_API_KEY },
      timeout: 20000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data).data || []); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// 住宅地・商業地の中央値単価（円/㎡）を直近2四半期から計算
async function getPrefPrices(cityCode, quarterPairs) {
  const residentialPrices = [];
  const commercialPrices  = [];

  for (const { year, q } of quarterPairs) {
    try {
      const records = await fetchReinfolib(cityCode, year, q);
      for (const r of records) {
        if (!r.Area || !r.TradePrice) continue;
        const unitPrice = Math.round(Number(r.TradePrice) / Number(r.Area));
        if (unitPrice < 10000 || unitPrice > 20000000) continue;
        const type = r.Type || '';
        if (type.includes('宅地') || type.includes('住宅') || type.includes('戸建')) {
          residentialPrices.push(unitPrice);
        } else if (type.includes('商業') || type.includes('店舗') || type.includes('事務所')) {
          commercialPrices.push(unitPrice);
        }
      }
    } catch (e) {
      console.warn(`  [WARN] city=${cityCode} ${year}Q${q}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return {
    residential: median(residentialPrices),
    commercial:  median(commercialPrices),
  };
}

async function main() {
  if (!MLIT_API_KEY) {
    console.error('❌ MLIT_API_KEY が設定されていません');
    process.exit(1);
  }

  // 既存JSONをフォールバック用に読み込む
  let existing = { by_prefecture: {} };
  try { existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8')); } catch (_) {}

  // 直近2四半期（公開ラグ6ヶ月を考慮して6ヶ月前基準）
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  let year = d.getFullYear(), q = Math.ceil((d.getMonth() + 1) / 3);
  const quarterPairs = [];
  for (let i = 0; i < 2; i++) {
    quarterPairs.unshift({ year, q });
    if (q === 1) { year--; q = 4; } else { q--; }
  }
  const periodLabel = quarterPairs.map(p => `${p.year}Q${p.q}`).join('〜');
  console.log(`取得期間: ${periodLabel}`);
  console.log('不動産情報ライブラリ API から都道府県別単価を取得中...\n');

  const byPref = { ...existing.by_prefecture };
  let updated = 0;

  for (const [prefName, { residential: cityCode }] of Object.entries(PREF_CITY_MAP)) {
    process.stdout.write(`  ${prefName} ... `);
    const prices = await getPrefPrices(cityCode, quarterPairs);

    if (prices.residential || prices.commercial) {
      byPref[prefName] = {
        residential: prices.residential ?? existing.by_prefecture?.[prefName]?.residential ?? null,
        commercial:  prices.commercial  ?? existing.by_prefecture?.[prefName]?.commercial  ?? null,
      };
      updated++;
      console.log(`住宅地 ${prices.residential?.toLocaleString() ?? '—'} 円/㎡ / 商業地 ${prices.commercial?.toLocaleString() ?? '—'} 円/㎡`);
    } else {
      console.log(`データなし → 前回値を維持`);
    }
  }

  const output = {
    updated: new Date().toISOString(),
    source:  `不動産情報ライブラリ API（reinfolib）取引事例ベース（${periodLabel}）`,
    note:    '住宅地・商業地の取引中央値（円/㎡）。都道府県代表都市の直近2四半期取引データから算出。GitHub Actionsで月次自動更新。',
    by_prefecture: byPref,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n完了: ${updated}/${Object.keys(PREF_CITY_MAP).length} 都道府県を更新`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
