#!/usr/bin/env node
/**
 * Overpass API から稲毛区の町丁目行政境界ポリゴンを取得し
 * data/inage-geojson.json として保存するスクリプト
 *
 * 実行: node scripts/fetch-inage-geojson.js
 * 依存: Node.js 標準モジュールのみ
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_PATH  = path.join(__dirname, '..', 'data', 'inage-geojson.json');
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// 稲毛区（admin_level=7）内の町丁目境界（admin_level=8）を取得
// admin_level=8: 千葉市など政令指定都市内の大字・町丁目レベル
const QUERY = `[out:json][timeout:60];
area["name"="稲毛区"]["admin_level"="7"]->.ward;
(
  relation["boundary"="administrative"]["admin_level"="8"](area.ward);
  way["boundary"="administrative"]["admin_level"="8"](area.ward);
);
out geom;`;

function post(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const payload = 'data=' + encodeURIComponent(body);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'inage-map-geojson/1.0'
      },
      timeout: 65000
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// Way geometry → 閉じたリング [[lng, lat], ...]
function wayToRing(geometry) {
  if (!geometry || geometry.length < 3) return null;
  const coords = geometry.map(pt => [pt.lon, pt.lat]);
  const first = coords[0], last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  return coords.length >= 4 ? coords : null;
}

// Relation の outer ways を順番につなぎ合わせて1つのリングにする
function relationToRing(members) {
  const outerWays = members.filter(m => m.type === 'way' && m.role === 'outer' && m.geometry);
  if (!outerWays.length) return null;

  const segments = outerWays.map(w => w.geometry.map(pt => [pt.lon, pt.lat]));

  // 貪欲法でセグメントをつなぐ
  const ring = [...segments[0]];
  const remaining = segments.slice(1);

  while (remaining.length > 0) {
    const tail = ring[ring.length - 1];
    let connected = false;
    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      const head = seg[0], rHead = seg[seg.length - 1];
      const EPS = 0.00002;
      if (Math.abs(tail[0] - head[0]) < EPS && Math.abs(tail[1] - head[1]) < EPS) {
        ring.push(...seg.slice(1));
        remaining.splice(i, 1);
        connected = true;
        break;
      }
      if (Math.abs(tail[0] - rHead[0]) < EPS && Math.abs(tail[1] - rHead[1]) < EPS) {
        ring.push(...seg.slice(0, -1).reverse());
        remaining.splice(i, 1);
        connected = true;
        break;
      }
    }
    if (!connected) break; // つながらないセグメントは無視
  }

  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring.length >= 4 ? ring : null;
}

// バウンディングボックスの中心を重心として使用
function centroid(ring) {
  const lats = ring.map(c => c[1]);
  const lngs = ring.map(c => c[0]);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2
  };
}

// OSMにデータがない場合のフォールバック用 TOWN_DATA（map.htmlの値と同期すること）
const TOWN_CENTERS = [
  { name: '穴川',     lat: 35.6382, lng: 140.1092, r: 0.009 },
  { name: '小仲台',   lat: 35.6455, lng: 140.1025, r: 0.008 },
  { name: '天台',     lat: 35.6315, lng: 140.1118, r: 0.008 },
  { name: '長沼町',   lat: 35.6388, lng: 140.1005, r: 0.009 },
  { name: '作草部',   lat: 35.6268, lng: 140.1143, r: 0.007 },
  { name: '稲毛本町', lat: 35.6352, lng: 140.0928, r: 0.008 },
  { name: '宮野木町', lat: 35.6488, lng: 140.0715, r: 0.011 },
  { name: '緑町',     lat: 35.6418, lng: 140.1012, r: 0.007 },
  { name: '轟町',     lat: 35.6338, lng: 140.1135, r: 0.007 },
  { name: '萩台町',   lat: 35.6478, lng: 140.0862, r: 0.008 },
  { name: '千草台',   lat: 35.6438, lng: 140.1108, r: 0.007 },
  { name: '柏台',     lat: 35.6440, lng: 140.1065, r: 0.007 },
];

// 正12角形ポリゴン（緯度経度のアスペクト比を補正）
function approximatePolygon(lat, lng, r) {
  const N = 12;
  const LAT_LNG_RATIO = Math.cos(lat * Math.PI / 180);
  const coords = [];
  for (let i = 0; i < N; i++) {
    const angle = (i * 360 / N - 90) * Math.PI / 180;
    coords.push([
      parseFloat((lng + r * LAT_LNG_RATIO * Math.cos(angle)).toFixed(6)),
      parseFloat((lat + r * Math.sin(angle)).toFixed(6))
    ]);
  }
  coords.push(coords[0]); // 閉じる
  return coords;
}

function generateApproximateFeatures() {
  console.log('\n▶ 近似ポリゴンを生成します（OSMデータが登録されるまでの暫定措置）\n');
  return TOWN_CENTERS.map(t => {
    const ring = approximatePolygon(t.lat, t.lng, t.r);
    console.log(`  近似: ${t.name}  r=${t.r}°`);
    return {
      type: 'Feature',
      properties: {
        name:         t.name,
        centroid_lat: t.lat,
        centroid_lng: t.lng,
        approximate:  true
      },
      geometry: { type: 'Polygon', coordinates: [ring] }
    };
  });
}

async function main() {
  console.log('=== 稲毛区 町丁目境界 GeoJSON 生成 ===\n');
  console.log('Overpass API にクエリ送信中...');

  let features = [];

  try {
    const osmData = await post(OVERPASS_URL, QUERY);
    const elements = osmData.elements || [];
    console.log(`レスポンス: ${elements.length} 件`);

    for (const el of elements) {
      const name = (el.tags && (el.tags.name || el.tags['name:ja'])) || '';
      if (!name) continue;

      let ring = null;
      if (el.type === 'way' && el.geometry)       ring = wayToRing(el.geometry);
      else if (el.type === 'relation' && el.members) ring = relationToRing(el.members);
      if (!ring) { console.warn(`  スキップ（ジオメトリ不正）: ${name}`); continue; }

      const center = centroid(ring);
      console.log(`  追加: ${name}  重心=(${center.lat.toFixed(4)}, ${center.lng.toFixed(4)})`);
      features.push({
        type: 'Feature',
        properties: { name, osm_id: el.id, osm_type: el.type, centroid_lat: center.lat, centroid_lng: center.lng },
        geometry: { type: 'Polygon', coordinates: [ring] }
      });
    }
  } catch (e) {
    console.warn(`Overpass API エラー: ${e.message}`);
  }

  if (features.length === 0) {
    console.log('\n⚠  OSMに稲毛区の町丁目境界データなし。近似ポリゴンで代替します。');
    console.log('   正確なデータが必要な場合: e-Stat 統計GIS（https://www.e-stat.go.jp/gis）');
    console.log('   から千葉市稲毛区の「小地域」GeoJSONをダウンロードして差し替えてください。\n');
    features = generateApproximateFeatures();
  }

  const geojson = {
    type: 'FeatureCollection',
    generated: new Date().toISOString(),
    source: features[0]?.properties?.approximate
      ? '近似ポリゴン（中心座標から自動生成）※正式データはe-Stat統計GISから取得可能'
      : 'OpenStreetMap contributors, via Overpass API',
    features
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson), 'utf8');
  console.log(`\n完了: ${features.length} 町丁目 → ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error('エラー:', e.message);
  process.exit(1);
});
