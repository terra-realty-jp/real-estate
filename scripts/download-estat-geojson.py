#!/usr/bin/env python3
"""
e-Stat 統計GIS から千葉市稲毛区の小地域境界データをダウンロードして
data/inage-geojson.json に変換・保存するスクリプト

依存: playwright (pip install playwright && playwright install chromium), pyshp
実行: python3 scripts/download-estat-geojson.py
"""

import json, os, re, sys, time, zipfile, tempfile, io
from playwright.sync_api import sync_playwright

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'inage-geojson.json')

TOWN_NAMES = {'穴川','小仲台','天台','長沼町','作草部','稲毛本町','宮野木町','緑町','轟町','萩台町','千草台','柏台'}

# 丁目除去後 or 生名 → 正規化町名
NORMALIZE = {
    '長沼':    '長沼町',
    '宮野木':   '宮野木町',
    '萩台':    '萩台町',
    '轟':      '轟町',
    '稲毛':    '稲毛本町',   # 稲毛一〜三丁目
    '稲毛町':   '稲毛本町',  # 稲毛町四・五丁目
    '穴川町':   '穴川',
    '天台町':   '天台',
    '作草部町':  '作草部',
    '小中台町':  '小仲台',   # 旧字・別表記
}

def normalize_name(s):
    s = s.strip()
    base = re.sub(r'[一二三四五六七八九十\d０-９]+丁目$', '', s)
    if base in TOWN_NAMES: return base
    m = NORMALIZE.get(base)
    if m and m in TOWN_NAMES: return m
    m2 = NORMALIZE.get(s)
    return m2 if m2 and m2 in TOWN_NAMES else None

def shapefile_to_geojson(shp_bytes, dbf_bytes, shx_bytes=None):
    """pyshpでShapefileバイトからGeoJSON featuresを生成"""
    import shapefile

    shp_io = io.BytesIO(shp_bytes)
    dbf_io = io.BytesIO(dbf_bytes)

    try:
        if shx_bytes:
            shx_io = io.BytesIO(shx_bytes)
            sf = shapefile.Reader(shp=shp_io, dbf=dbf_io, shx=shx_io, encoding='cp932')
        else:
            sf = shapefile.Reader(shp=shp_io, dbf=dbf_io, encoding='cp932')
    except Exception as e:
        print(f'  pyshp読み込みエラー: {e}')
        return None

    fields = [f[0] for f in sf.fields[1:]]  # DeletionFlag を除く
    print(f'  フィールド: {fields}')

    features = []
    seen = {}

    for sr in sf.shapeRecords():
        props = dict(zip(fields, sr.record))
        # 文字コード修正 (cp932 or utf-8)
        decoded = {}
        for k, v in props.items():
            if isinstance(v, bytes):
                try: v = v.decode('cp932').strip()
                except: v = v.decode('utf-8', errors='replace').strip()
            elif isinstance(v, str):
                v = v.strip()
            decoded[k] = v

        # S_NAME か NAME フィールドを町丁目名として使用
        s_name = decoded.get('S_NAME') or decoded.get('NAME') or decoded.get('name') or ''
        city = str(decoded.get('CITY', decoded.get('city', '')))

        # 稲毛区 CITY=12103 のみ対象（コードがなければ全件対象）
        if city and city not in ('12103', ''):
            continue

        name = normalize_name(s_name)
        if not name:
            continue

        # Shapefileのジオメトリ → GeoJSONポリゴン
        shape = sr.shape
        if shape.shapeType == 0:  # Null
            continue

        parts = list(shape.parts) + [len(shape.points)]
        rings = []
        for i in range(len(parts) - 1):
            ring_pts = shape.points[parts[i]:parts[i+1]]
            # Shapefile座標は (x=lng, y=lat)
            coords = [[round(p[0], 6), round(p[1], 6)] for p in ring_pts]
            if len(coords) < 4:
                continue
            # 閉じていなければ閉じる
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            rings.append(coords)

        if not rings:
            continue

        outer = rings[0]
        lats = [c[1] for c in outer]
        lngs = [c[0] for c in outer]
        clat = (min(lats) + max(lats)) / 2
        clng = (min(lngs) + max(lngs)) / 2

        seen.setdefault(name, []).append((clat, clng))
        print(f'  {s_name} → {name}  ({clat:.4f}, {clng:.4f})')

        features.append({
            'type': 'Feature',
            'properties': {
                'name': name,
                'original_name': s_name,
                'centroid_lat': round(clat, 6),
                'centroid_lng': round(clng, 6),
            },
            'geometry': {
                'type': 'Polygon',
                'coordinates': rings,
            }
        })

    return features

def extract_shapefiles(zip_bytes):
    """ZIPからShapefile群を読み出してfeaturesを返す"""
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as f:
        f.write(zip_bytes)
        zpath = f.name
    try:
        with zipfile.ZipFile(zpath) as zf:
            names = zf.namelist()
            print(f'  ZIP内ファイル: {names}')
            shp_files = [n for n in names if n.lower().endswith('.shp')]
            if not shp_files:
                print('  .shp ファイルが見つかりません')
                return None
            for shp_name in shp_files:
                base = shp_name[:-4]
                dbf_name = base + '.dbf'
                shx_name = base + '.shx'
                if dbf_name not in names and dbf_name.upper() not in names:
                    # 大文字小文字の違いを考慮
                    dbf_candidates = [n for n in names if n.lower() == dbf_name.lower()]
                    if not dbf_candidates:
                        print(f'  .dbf なし: {shp_name}')
                        continue
                    dbf_name = dbf_candidates[0]

                print(f'  処理: {shp_name}')
                shp_bytes = zf.read(shp_name)
                dbf_bytes = zf.read(dbf_name)
                shx_bytes = None
                shx_candidates = [n for n in names if n.lower() == (base + '.shx').lower()]
                if shx_candidates:
                    shx_bytes = zf.read(shx_candidates[0])

                features = shapefile_to_geojson(shp_bytes, dbf_bytes, shx_bytes)
                if features:
                    return features
    finally:
        os.unlink(zpath)
    return None

def main():
    print('=== e-Stat 統計GIS 小地域データ取得・変換 ===\n')
    print('対象: 千葉市稲毛区 / 令和2年国勢調査 小地域\n')

    # e-Statから直接ダウンロードを試みる（セッション不要なケースがある）
    SHAPE_URL = (
        'https://www.e-stat.go.jp/gis/statmap-search/data'
        '?dlserveyId=A002005212020&code=12103&coordSys=1&format=shape&downloadType=5'
    )

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()

        zip_bytes = None

        # --- 方法1: ページ経由でのダウンロード ---
        print('1. e-Stat トップページ→ダウンロード試行...')
        try:
            page.goto('https://www.e-stat.go.jp/gis/statmap-search?type=2', timeout=30000)
            page.wait_for_load_state('networkidle', timeout=15000)
            print('   トップページ読み込み完了')
        except Exception as e:
            print(f'   ページ読み込みエラー: {e}')

        # --- 方法2: search_detail APIでファイルリスト取得→ダウンロード ---
        print('\n2. search_detail API でファイルリストを取得...')
        detail_url = (
            'https://www.e-stat.go.jp/gis/statmap-search/search_detail'
            '?dlserveyId=A002005212020&code=12103&coordSys=1&download_type_disp_flg=1'
        )
        try:
            resp = page.request.get(detail_url, timeout=20000)
            if resp.ok:
                body = resp.body()
                print(f'   search_detail: {len(body)}B')
                # HTMLからダウンロードリンクを抽出
                html_text = body.decode('utf-8', errors='replace')
                # data?dlserveyId= のURLを探す
                dl_links = re.findall(
                    r'href=["\']([^"\']*dlserveyId[^"\']+)["\']', html_text
                )
                dl_links += re.findall(
                    r'((?:https?://[^"\']*)?/gis/statmap-search/data\?[^"\'<\s]+)', html_text
                )
                if dl_links:
                    print(f'   ダウンロードリンク候補: {dl_links[:3]}')
        except Exception as e:
            print(f'   search_detail エラー: {e}')

        # --- 方法3: 直接ダウンロードURL試行 ---
        print('\n3. 直接ダウンロードURL試行...')

        candidate_urls = [
            SHAPE_URL,
            'https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=12103&coordSys=1&format=shape&downloadType=5',
            # 全千葉県版
            'https://www.e-stat.go.jp/gis/statmap-search/data?dlserveyId=A002005212020&code=12&coordSys=1&format=shape&downloadType=5',
        ]

        for url in candidate_urls:
            print(f'   試行: {url[-80:]}')
            try:
                with page.expect_download(timeout=30000) as dl_info:
                    page.evaluate(f'window.open("{url}", "_self")')
                download = dl_info.value
                tmp_path = download.path()
                if tmp_path and os.path.exists(tmp_path):
                    with open(tmp_path, 'rb') as f:
                        zip_bytes = f.read()
                    print(f'   ダウンロード成功: {len(zip_bytes)}B')
                    break
            except Exception as e1:
                # expect_downloadが使えない場合はrequestで直接取得
                try:
                    resp = page.request.get(url, timeout=30000)
                    body = resp.body()
                    print(f'   request.get: {resp.status} {len(body)}B')
                    if resp.ok and len(body) > 1000 and body[:2] == b'PK':
                        zip_bytes = body
                        print(f'   ZIPデータ取得成功: {len(zip_bytes)}B')
                        break
                    elif resp.ok and len(body) > 100:
                        # HTMLかもしれない
                        snippet = body[:200].decode('utf-8', errors='replace')
                        print(f'   応答プレビュー: {snippet[:100]}')
                except Exception as e2:
                    print(f'   両方失敗: {e2}')

        browser.close()

    if not zip_bytes:
        print('\n⚠ ZIPダウンロード失敗。e-StatのZIPを手動で取得してください:')
        print(f'  URL: {SHAPE_URL}')
        print('  保存先: /tmp/inage_shape.zip')
        print('  その後: python3 scripts/download-estat-geojson.py --local /tmp/inage_shape.zip')
        sys.exit(1)

    # ZIPからShapefile→GeoJSON変換
    print('\n=== Shapefile → GeoJSON 変換 ===')
    features = extract_shapefiles(zip_bytes)

    if not features:
        print('\n⚠ 変換失敗')
        sys.exit(1)

    # 重複フィーチャーの統合（同じ町名で複数丁目ある場合はMultiPolygonにまとめる）
    from collections import defaultdict
    town_features = defaultdict(list)
    for feat in features:
        town_features[feat['properties']['name']].append(feat)

    final_features = []
    for town_name, feats in town_features.items():
        if len(feats) == 1:
            final_features.append(feats[0])
        else:
            # 複数フィーチャーを1つにまとめる（最大のポリゴンを代表として使用）
            # centroidは全フィーチャーの平均
            avg_lat = sum(f['properties']['centroid_lat'] for f in feats) / len(feats)
            avg_lng = sum(f['properties']['centroid_lng'] for f in feats) / len(feats)
            # 全ポリゴンのリングを集める → MultiPolygon
            all_rings = []
            for f in feats:
                coords = f['geometry']['coordinates']
                all_rings.append(coords)  # coords はポリゴンのリングリスト
            merged = {
                'type': 'Feature',
                'properties': {
                    'name': town_name,
                    'original_name': feats[0]['properties']['original_name'],
                    'centroid_lat': round(avg_lat, 6),
                    'centroid_lng': round(avg_lng, 6),
                },
                'geometry': {
                    'type': 'MultiPolygon',
                    'coordinates': all_rings,
                }
            }
            final_features.append(merged)
            print(f'  統合: {town_name} ({len(feats)}フィーチャー → MultiPolygon)')

    result = {
        'type': 'FeatureCollection',
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source': 'e-Stat統計GIS 令和2年国勢調査小地域 千葉市稲毛区 (shapefile変換)',
        'features': final_features,
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f'\n✓ 完了: {len(final_features)}町丁目 → {OUTPUT_PATH}')
    found = {f['properties']['name'] for f in final_features}
    missing = TOWN_NAMES - found
    if missing:
        print(f'  未取得の町: {missing}')

# --- ローカルZIPからの処理モード ---
if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == '--local':
        zip_path = sys.argv[2]
        print(f'=== ローカルZIPから変換: {zip_path} ===\n')
        import shapefile  # noqa: ensure imported
        with open(zip_path, 'rb') as f:
            zip_bytes = f.read()

        features = extract_shapefiles(zip_bytes)
        if not features:
            print('変換失敗')
            sys.exit(1)

        from collections import defaultdict
        town_features = defaultdict(list)
        for feat in features:
            town_features[feat['properties']['name']].append(feat)

        final_features = []
        for town_name, feats in town_features.items():
            if len(feats) == 1:
                final_features.append(feats[0])
            else:
                avg_lat = sum(f['properties']['centroid_lat'] for f in feats) / len(feats)
                avg_lng = sum(f['properties']['centroid_lng'] for f in feats) / len(feats)
                all_rings = [f['geometry']['coordinates'] for f in feats]
                final_features.append({
                    'type': 'Feature',
                    'properties': {
                        'name': town_name,
                        'original_name': feats[0]['properties']['original_name'],
                        'centroid_lat': round(avg_lat, 6),
                        'centroid_lng': round(avg_lng, 6),
                    },
                    'geometry': {'type': 'MultiPolygon', 'coordinates': all_rings}
                })
                print(f'  統合: {town_name} ({len(feats)}フィーチャー)')

        result = {
            'type': 'FeatureCollection',
            'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'source': 'e-Stat統計GIS 令和2年国勢調査小地域 千葉市稲毛区 (shapefile変換)',
            'features': final_features,
        }
        with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f'\n✓ 完了: {len(final_features)}町丁目 → {OUTPUT_PATH}')
        found = {f['properties']['name'] for f in final_features}
        missing = TOWN_NAMES - found
        if missing:
            print(f'  未取得の町: {missing}')
    else:
        main()
