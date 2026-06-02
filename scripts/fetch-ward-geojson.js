#!/usr/bin/env node
/**
 * Overpass API から千葉市各区の町丁目境界ポリゴンを取得し
 * data/{ward}-geojson.json として保存するスクリプト
 *
 * 実行: node scripts/fetch-ward-geojson.js
 * 依存: Node.js 標準モジュールのみ（npm install 不要）
 * 処理対象: 中央区・花見川区・若葉区・緑区・美浜区
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// 各区の設定
const WARDS = [
  {
    name: '中央区', key: 'chuo',
    center: [35.607, 140.106],
    // 町名の正規化マップ（同じエリアを束ねる）
    normalize: {
      '千葉中央': '千葉中央', '富士見': '富士見', '蘇我': '蘇我',
      '院内': '院内', '生浜': '生浜', '本町': '本町',
      '椿森': '椿森', '都町': '都町', '南町': '南町', '大森': '大森',
    },
  },
  {
    name: '花見川区', key: 'hanami',
    center: [35.672, 140.065],
    normalize: {
      '幕張本郷': '幕張本郷', '花見川': '花見川', '八千代台': '八千代台',
      'こてはし台': 'こてはし台', '天戸': '天戸', '横戸': '横戸',
      '長作': '長作', '武石': '武石', '犢橋': '犢橋', '真砂': '真砂',
    },
  },
  {
    name: '若葉区', key: 'wakaba',
    center: [35.629, 140.131],
    normalize: {
      '千城台': '千城台', '都賀': '都賀', '桜木': '桜木',
      'みつわ台': 'みつわ台', '大宮台': '大宮台', '泉': '泉',
      '野呂': '野呂', '若松': '若松', '更科': '更科',
    },
  },
  {
    name: '緑区', key: 'midori',
    center: [35.560, 140.142],
    normalize: {
      'おゆみ野': 'おゆみ野', '鎌取': '鎌取', '土気': '土気',
      'あすみが丘': 'あすみが丘', '誉田': '誉田', '椎名': '椎名',
      '辺田': '辺田', '平山': '平山', '高田': '高田',
    },
  },
  {
    name: '美浜区', key: 'mihama',
    center: [35.641, 140.066],
    normalize: {
      '幕張': '幕張', '幕張本郷': '幕張本郷', '検見川浜': '検見川浜',
      '浜田': '浜田', '稲毛海岸': '稲毛海岸', '高洲': '高洲',
      '磯辺': '磯辺', '真砂': '真砂', '打瀬': '打瀬', '美浜': '美浜',
    },
  },
];

// Overpass クエリ（区名で絞り込み）
// ※ 区名（例: 中央区）だけだと全国の同名区と衝突して解決に失敗するため、
//   親自治体「千葉市」(admin_level 6) の配下にスコープしてから区を特定する。
function buildQuery(wardName) {
  return `[out:json][timeout:90];
area["name"="千葉市"]["admin_level"="6"]->.city;
(
  relation["boundary"="administrative"]["admin_level"="7"]["name"="${wardName}"](area.city);
)->.wardrel;
.wardrel map_to_area->.ward;
(
  relation["boundary"="administrative"]["admin_level"="8"](area.ward);
  way["boundary"="administrative"]["admin_level"="8"](area.ward);
);
out geom;`;
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const payload = 'data=' + encodeURIComponent(body);
    const options = {
      hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload), 'User-Agent': 'TERRA-REALTY-map/1.0 (terra.realty.iam@gmail.com)' },
      timeout: 95000,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function wayToRing(geometry) {
  if (!geometry || geometry.length < 3) return null;
  const coords = geometry.map(pt => [pt.lon, pt.lat]);
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
  return coords.length >= 4 ? coords : null;
}

function relationToRing(members) {
  const outerWays = members.filter(m => m.type === 'way' && m.role === 'outer' && m.geometry);
  if (!outerWays.length) return null;
  const segments = outerWays.map(w => w.geometry.map(pt => [pt.lon, pt.lat]));
  const ring = [...segments[0]];
  const remaining = segments.slice(1);
  while (remaining.length > 0) {
    const tail = ring[ring.length - 1];
    let connected = false;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      if (Math.abs(tail[0] - seg[0][0]) < 1e-7 && Math.abs(tail[1] - seg[0][1]) < 1e-7) {
        ring.push(...seg.slice(1)); remaining.splice(i, 1); connected = true; break;
      }
      if (Math.abs(tail[0] - seg[seg.length - 1][0]) < 1e-7 && Math.abs(tail[1] - seg[seg.length - 1][1]) < 1e-7) {
        ring.push(...[...seg].reverse().slice(1)); remaining.splice(i, 1); connected = true; break;
      }
    }
    if (!connected) break;
  }
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return ring.length >= 4 ? ring : null;
}

function extractTownName(el) {
  const tags = el.tags || {};
  const raw = tags['name'] || tags['name:ja'] || '';
  // 「千葉市花見川区幕張本郷一丁目」→「幕張本郷」
  const m = raw.match(/区(.+?)(?:[一二三四五六七八九十百千\d]+丁目|$)/);
  if (m) return m[1];
  return raw.replace(/^千葉市.+?区/, '').replace(/[一二三四五六七八九十百千\d]+丁目$/, '').trim();
}

function normalizeName(raw, normalizeMap) {
  for (const [key, val] of Object.entries(normalizeMap)) {
    if (raw.includes(key)) return val;
  }
  return null;
}

function computeCentroid(coords) {
  let sumLng = 0, sumLat = 0, n = 0;
  (Array.isArray(coords[0][0]) ? coords[0] : coords).forEach(pt => {
    sumLng += pt[0]; sumLat += pt[1]; n++;
  });
  return { lng: sumLng / n, lat: sumLat / n };
}

async function fetchWardGeojson(wardConfig) {
  const { name, key, normalize: normalizeMap } = wardConfig;
  console.log(`\n[${name}] Overpass API リクエスト中...`);
  const data = await post(OVERPASS_URL, buildQuery(name));
  const elements = data.elements || [];
  console.log(`[${name}] ${elements.length} 件取得`);

  const featureMap = {};

  for (const el of elements) {
    let ring = null;
    if (el.type === 'relation' && el.members) {
      ring = relationToRing(el.members);
    } else if (el.type === 'way' && el.geometry) {
      ring = wayToRing(el.geometry);
    }
    if (!ring) continue;

    const rawName = extractTownName(el);
    const normalized = normalizeName(rawName, normalizeMap);
    if (!normalized) { console.log(`  スキップ: "${rawName}"`); continue; }

    if (!featureMap[normalized]) {
      const centroid = computeCentroid(ring);
      featureMap[normalized] = {
        type: 'Feature',
        properties: {
          name: normalized,
          original_name: rawName,
          centroid_lat: Math.round(centroid.lat * 1e6) / 1e6,
          centroid_lng: Math.round(centroid.lng * 1e6) / 1e6,
        },
        geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
      };
    } else {
      // 同じ正規化名の複数ポリゴンをマージ
      featureMap[normalized].geometry.coordinates.push([ring]);
    }
  }

  const features = Object.values(featureMap);
  console.log(`[${name}] ${features.length} エリアに正規化`);

  const geojson = {
    type: 'FeatureCollection',
    generated: new Date().toISOString(),
    source: `Overpass API / OpenStreetMap ${name}`,
    features,
  };

  const outPath = path.join(__dirname, '..', 'data', `${key}-geojson.json`);
  fs.writeFileSync(outPath, JSON.stringify(geojson, null, 2), 'utf8');
  console.log(`[${name}] → ${outPath} (${features.length} features, ${fs.statSync(outPath).size} bytes)`);
  return features.length;
}

async function main() {
  console.log('千葉市 各区 GeoJSON 取得スクリプト');
  const target = process.argv[2]; // 省略時は全区

  const targets = target
    ? WARDS.filter(w => w.key === target || w.name === target)
    : WARDS;

  if (targets.length === 0) {
    console.error('対象区が見つかりません。key例: chuo hanami wakaba midori mihama');
    process.exit(1);
  }

  for (const ward of targets) {
    try {
      const count = await fetchWardGeojson(ward);
      if (count === 0) console.warn(`  ⚠️ ${ward.name}: 取得できたエリアが0件。Overpassの区名を確認してください`);
      // Overpass API へのリクエスト間隔（過負荷防止）
      if (targets.indexOf(ward) < targets.length - 1) {
        console.log('  5秒待機...');
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (e) {
      console.error(`[${ward.name}] エラー:`, e.message);
    }
  }
  console.log('\n完了');
}

main();
