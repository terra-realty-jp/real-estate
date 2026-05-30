#!/usr/bin/env python3
"""
国土数値情報 A29（用途地域）GML を GeoJSON に変換するスクリプト。
ogr2ogr 不要。Python 標準ライブラリのみ使用。

使用: python3 scripts/gml-to-geojson.py <input.xml> <output.geojson>
"""
import json
import sys
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET  # noqa: only reached in dev env

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/yoto_inage.xml'
DEST = sys.argv[2] if len(sys.argv) > 2 else 'data/yoto-inage.geojson'

# GML/KSJ 名前空間
NS = {
    'gml': 'http://www.opengis.net/gml/3.2',
    'ksj': 'http://nlftp.mlit.go.jp/ksj/schemas/ksj-app',
}

def parse_pos_list(pos_text):
    """GML posList（緯度 経度 緯度 経度...）を [[lng,lat],...] に変換"""
    nums = [float(x) for x in pos_text.split()]
    coords = []
    for i in range(0, len(nums) - 1, 2):
        lat, lng = nums[i], nums[i + 1]
        coords.append([lng, lat])
    return coords

def parse_polygon(poly_el):
    """gml:Polygon → GeoJSON Polygon 座標"""
    rings = []
    for ring_tag in ('gml:exterior', 'gml:interior'):
        ring_el = poly_el.find(f'{ring_tag}/gml:LinearRing/gml:posList', NS)
        if ring_el is not None and ring_el.text:
            rings.append(parse_pos_list(ring_el.text.strip()))
    return rings if rings else None

def parse_geometry(geom_el):
    """ksj:geometry 要素以下の GML ジオメトリを解析"""
    # Polygon
    poly = geom_el.find('.//gml:Polygon', NS)
    if poly is not None:
        rings = parse_polygon(poly)
        if rings:
            return {'type': 'Polygon', 'coordinates': rings}

    # MultiPolygon (MultiSurface/surfaceMember/Polygon)
    polys = geom_el.findall('.//gml:Polygon', NS)
    if len(polys) > 1:
        multi = []
        for p in polys:
            rings = parse_polygon(p)
            if rings:
                multi.append(rings)
        if multi:
            return {'type': 'MultiPolygon', 'coordinates': multi}

    return None

def get_text(el, tag):
    child = el.find(tag, NS)
    return child.text.strip() if child is not None and child.text else ''

print(f'読み込み: {SRC}')
tree = ET.parse(SRC)
root = tree.getroot()

# A29 の特徴要素を探す（名前空間ありで検索）
feature_tags = [
    '{http://nlftp.mlit.go.jp/ksj/schemas/ksj-app}YoutoChiiki',
]

features = []
found_tags = set()

# 全要素を走査して用途地域フィーチャーを探す
for elem in root.iter():
    found_tags.add(elem.tag)
    local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
    if local not in ('YoutoChiiki',):
        continue

    # ジオメトリを取得
    geom_el = elem.find('ksj:geometry', NS)
    if geom_el is None:
        geom_el = elem.find('{http://nlftp.mlit.go.jp/ksj/schemas/ksj-app}geometry')
    if geom_el is None:
        continue

    geometry = parse_geometry(geom_el)
    if not geometry:
        continue

    # 属性値を取得（用途地域コード）
    props = {}
    for child in elem:
        local_name = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if child.text and local_name != 'geometry':
            props[local_name] = child.text.strip()

    features.append({'type': 'Feature', 'geometry': geometry, 'properties': props})

if not features:
    # タグが違う可能性があるため発見したタグを表示
    local_tags = sorted({t.split('}')[-1] for t in found_tags if '}' in t})
    print(f'フィーチャーなし。発見したローカルタグ: {local_tags[:30]}')
    # フォールバック: すべてのnsを試す
    for elem in root.iter():
        local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        if 'Chiiki' in local or 'chiiki' in local or 'Zone' in local or 'zone' in local:
            print(f'  候補タグ: {elem.tag}')

result = {'type': 'FeatureCollection', 'features': features}

with open(DEST, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))

print(f'フィーチャー数: {len(features)}')
if features:
    print('サンプルproperties:', list(features[0]['properties'].keys()))
