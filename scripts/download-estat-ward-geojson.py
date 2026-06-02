#!/usr/bin/env python3
"""
e-Stat 統計GIS 令和2年国勢調査 小地域境界データから
千葉市の各区（稲毛区を除く5区）の GeoJSON を生成する。

  data/{key}-geojson.json として保存

【重要】町名の正規化は scripts/fetch-ward-properties.js の WARDS[*].normalize と
完全に同じロジック（rawName に key が含まれれば val に変換・辞書の登録順で先勝ち）
で行う。これにより GeoJSON の feature 名が ward_properties に保存される町名と一致し、
map.html 上でポリゴンと取引価格を結合できる。

依存: pyshp (pip install pyshp)  ※ネット直DLは標準ライブラリのみ
実行:
  python3 scripts/download-estat-ward-geojson.py            # 全5区
  python3 scripts/download-estat-ward-geojson.py wakaba     # 単区
  python3 scripts/download-estat-ward-geojson.py --local wakaba /tmp/x.zip
"""

import json, os, re, sys, time, zipfile, tempfile, io, urllib.request
from collections import defaultdict, OrderedDict

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')
DLSURVEY = 'A002005212020'  # 令和2年国勢調査 小地域（町丁・字等別）

# fetch-ward-properties.js の WARDS と同じ正規化マップ（登録順を保持）
WARDS = OrderedDict([
    ('chuo', {
        'code': '12101', 'name': '中央区',
        'normalize': OrderedDict([
            ('千葉中央', '千葉中央'), ('富士見', '富士見'), ('蘇我', '蘇我'),
            ('川崎町', '蘇我'), ('中央', '千葉中央'), ('院内', '院内'),
            ('生浜', '生浜'), ('本町', '本町'), ('市場', '本町'),
            ('椿森', '椿森'), ('都町', '都町'), ('南町', '南町'),
            ('大森', '大森'), ('新町', '本町'), ('問屋町', '本町'),
        ]),
    }),
    ('hanami', {
        'code': '12102', 'name': '花見川区',
        'normalize': OrderedDict([
            ('幕張本郷', '幕張本郷'), ('幕張町', '幕張本郷'), ('花見川', '花見川'),
            ('八千代台', '八千代台'), ('こてはし台', 'こてはし台'),
            ('天戸', '天戸'), ('横戸', '横戸'), ('長作', '長作'),
            ('武石', '武石'), ('犢橋', '犢橋'), ('検見川', '検見川'),
            ('真砂', '真砂'),
        ]),
    }),
    ('wakaba', {
        'code': '12104', 'name': '若葉区',
        'normalize': OrderedDict([
            ('千城台', '千城台'), ('都賀', '都賀'), ('桜木', '桜木'),
            ('みつわ台', 'みつわ台'), ('大宮台', '大宮台'), ('泉町', '泉'),
            ('泉', '泉'), ('野呂', '野呂'), ('若松', '若松'),
            ('更科', '更科'), ('多部田', '若松'), ('川井', '若松'),
        ]),
    }),
    ('midori', {
        'code': '12105', 'name': '緑区',
        'normalize': OrderedDict([
            ('おゆみ野', 'おゆみ野'), ('鎌取', '鎌取'), ('土気', '土気'),
            ('あすみが丘', 'あすみが丘'), ('誉田', '誉田'), ('椎名', '椎名'),
            ('辺田', '辺田'), ('平山', '平山'), ('高田', '高田'),
            ('越智', '越智'), ('小食土', '土気'), ('大金沢', '土気'),
        ]),
    }),
    ('mihama', {
        'code': '12106', 'name': '美浜区',
        'normalize': OrderedDict([
            ('幕張', '幕張'), ('幕張本郷', '幕張本郷'), ('検見川浜', '検見川浜'),
            ('浜田', '浜田'), ('稲毛海岸', '稲毛海岸'), ('高洲', '高洲'),
            ('磯辺', '磯辺'), ('真砂', '真砂'), ('打瀬', '打瀬'),
            ('美浜', '美浜'), ('新港', '新港'), ('港', '新港'),
        ]),
    }),
])


def normalize_name(s_name, normalize_map):
    """fetch-ward-properties.js の normalizeTown と同じ：含む・登録順先勝ち"""
    for key, val in normalize_map.items():
        if key in s_name:
            return val
    return None


def download_zip(code):
    url = ('https://www.e-stat.go.jp/gis/statmap-search/data'
           f'?dlserveyId={DLSURVEY}&code={code}&coordSys=1&format=shape&downloadType=5')
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (TERRA-REALTY map builder)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    if body[:2] != b'PK':
        raise RuntimeError(f'ZIP以外の応答（{len(body)}B, 先頭={body[:20]!r}）')
    return body


def shapefile_features(zip_bytes, normalize_map):
    import shapefile
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as f:
        f.write(zip_bytes); zpath = f.name
    try:
        with zipfile.ZipFile(zpath) as zf:
            names = zf.namelist()
            shp = next((n for n in names if n.lower().endswith('.shp')), None)
            if not shp:
                raise RuntimeError(f'.shp なし: {names}')
            base = shp[:-4]
            dbf = next((n for n in names if n.lower() == (base + '.dbf').lower()), None)
            shx = next((n for n in names if n.lower() == (base + '.shx').lower()), None)
            sf = shapefile.Reader(
                shp=io.BytesIO(zf.read(shp)),
                dbf=io.BytesIO(zf.read(dbf)) if dbf else None,
                shx=io.BytesIO(zf.read(shx)) if shx else None,
                encoding='cp932')
            fields = [f[0] for f in sf.fields[1:]]
            feats = []
            for sr in sf.shapeRecords():
                rec = dict(zip(fields, sr.record))
                s_name = str(rec.get('S_NAME') or rec.get('NAME') or '').strip()
                if not s_name:
                    continue
                name = normalize_name(s_name, normalize_map)
                if not name:
                    continue
                shape = sr.shape
                if shape.shapeType == 0:
                    continue
                parts = list(shape.parts) + [len(shape.points)]
                rings = []
                for i in range(len(parts) - 1):
                    pts = shape.points[parts[i]:parts[i + 1]]
                    coords = [[round(p[0], 6), round(p[1], 6)] for p in pts]
                    if len(coords) < 4:
                        continue
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])
                    rings.append(coords)
                if not rings:
                    continue
                outer = rings[0]
                clat = (min(c[1] for c in outer) + max(c[1] for c in outer)) / 2
                clng = (min(c[0] for c in outer) + max(c[0] for c in outer)) / 2
                feats.append({
                    'type': 'Feature',
                    'properties': {
                        'name': name, 'original_name': s_name,
                        'centroid_lat': round(clat, 6), 'centroid_lng': round(clng, 6),
                    },
                    'geometry': {'type': 'Polygon', 'coordinates': rings},
                })
            return feats
    finally:
        os.unlink(zpath)


def merge_features(features):
    """同一正規化名の複数丁目を MultiPolygon に統合"""
    by_name = defaultdict(list)
    for f in features:
        by_name[f['properties']['name']].append(f)
    out = []
    for name, feats in by_name.items():
        if len(feats) == 1:
            out.append(feats[0]); continue
        avg_lat = sum(f['properties']['centroid_lat'] for f in feats) / len(feats)
        avg_lng = sum(f['properties']['centroid_lng'] for f in feats) / len(feats)
        out.append({
            'type': 'Feature',
            'properties': {
                'name': name,
                'original_name': feats[0]['properties']['original_name'],
                'centroid_lat': round(avg_lat, 6), 'centroid_lng': round(avg_lng, 6),
            },
            'geometry': {'type': 'MultiPolygon',
                         'coordinates': [f['geometry']['coordinates'] for f in feats]},
        })
    return out


def build_ward(key, zip_bytes=None):
    cfg = WARDS[key]
    print(f"\n=== {cfg['name']} ({cfg['code']}) → {key}-geojson.json ===")
    if zip_bytes is None:
        print('  e-Stat からダウンロード中...')
        zip_bytes = download_zip(cfg['code'])
        print(f'  取得: {len(zip_bytes)}B')
    feats = shapefile_features(zip_bytes, cfg['normalize'])
    print(f'  該当丁目: {len(feats)}件')
    merged = merge_features(feats)
    result = {
        'type': 'FeatureCollection',
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': f"e-Stat統計GIS 令和2年国勢調査小地域 千葉市{cfg['name']} (shapefile変換)",
        'features': merged,
    }
    out_path = os.path.join(DATA_DIR, f'{key}-geojson.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    found = sorted({f['properties']['name'] for f in merged})
    print(f'  ✓ {len(merged)}エリア → {out_path}')
    print(f'  エリア: {found}')
    return len(merged)


def main():
    args = sys.argv[1:]
    if args and args[0] == '--local':
        key, zpath = args[1], args[2]
        with open(zpath, 'rb') as f:
            build_ward(key, f.read())
        return
    targets = [a for a in args if a in WARDS] or list(WARDS.keys())
    for i, key in enumerate(targets):
        try:
            build_ward(key)
        except Exception as e:
            print(f'  ✗ {key} 失敗: {e}')
        if i < len(targets) - 1:
            time.sleep(2)
    print('\n完了')


if __name__ == '__main__':
    main()
