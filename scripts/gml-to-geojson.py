#!/usr/bin/env python3
"""
国土数値情報 A29（用途地域）GML v2.1 を GeoJSON に変換するスクリプト。
ogr2ogr 不要。Python 標準ライブラリのみ使用。

使用: python3 scripts/gml-to-geojson.py <input.xml> <output.geojson>

A29-19 GML 構造（デバッグ確認済み）:
  DesignatedArea.cda → xlink:href="#sf1" → Surface (gml:id=sf1)
    Surface/patches/PolygonPatch/exterior/Ring/curveMember → xlink:href="#cv1" → Curve
      Curve/segments/LineStringSegment/posList → 座標列
  属性: aac(行政区域コード), dac(用途地域コード1-12), kda(用途地域名), bar(建蔽率), cbr(容積率)
"""
import json
import sys
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET  # noqa: trusted government source only

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/yoto_inage.xml'
DEST = sys.argv[2] if len(sys.argv) > 2 else 'data/yoto-inage.geojson'

XLINK_HREF = '{http://www.w3.org/1999/xlink}href'
GML_ID_KEYS = [
    '{http://www.opengis.net/gml/3.2}id',
    '{http://www.opengis.net/gml}id',
    'gml:id',
]

YOTO_NAME = {
    '1': '第一種低層住居専用地域',
    '2': '第二種低層住居専用地域',
    '3': '第一種中高層住居専用地域',
    '4': '第二種中高層住居専用地域',
    '5': '第一種住居地域',
    '6': '第二種住居地域',
    '7': '準住居地域',
    '8': '近隣商業地域',
    '9': '商業地域',
    '10': '準工業地域',
    '11': '工業地域',
    '12': '工業専用地域',
}

def collect_pos_lists(element, id_map, visited=None):
    """element以下の全posList要素から座標を収集（xlink:href多段解決対応）"""
    if visited is None:
        visited = set()
    result = []
    for el in element.iter():
        local = el.tag.split('}')[-1] if '}' in el.tag else el.tag
        href = el.attrib.get(XLINK_HREF, '')
        if href.startswith('#'):
            ref_id = href[1:]
            if ref_id not in visited:
                visited.add(ref_id)
                ref_elem = id_map.get(ref_id)
                if ref_elem is not None:
                    result.extend(collect_pos_lists(ref_elem, id_map, visited))
        elif local == 'posList' and el.text:
            nums = [float(x) for x in el.text.split()]
            ring = []
            for i in range(0, len(nums) - 1, 2):
                lat, lng = nums[i], nums[i + 1]
                ring.append([lng, lat])
            if ring:
                result.append(ring)
    return result

def build_geometry(pos_lists):
    if not pos_lists:
        return None
    if len(pos_lists) == 1:
        return {'type': 'Polygon', 'coordinates': pos_lists}
    return {'type': 'MultiPolygon', 'coordinates': [[r] for r in pos_lists]}

print(f'読み込み: {SRC}')
tree = ET.parse(SRC)
root = tree.getroot()

# gml:id → element マップ構築
id_map = {}
for el in root.iter():
    for key in GML_ID_KEYS:
        gid = el.attrib.get(key)
        if gid:
            id_map[gid] = el
            break

print(f'gml:id マップ: {len(id_map)} 件')

features = []
da_count = 0

for elem in root.iter():
    local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
    if local != 'DesignatedArea':
        continue
    da_count += 1

    # DesignatedAreaのgeometryプロパティ（xlink:href）を起点に多段解決
    visited = set()
    pos_lists = []
    for child in elem:
        href = child.attrib.get(XLINK_HREF, '')
        if href.startswith('#'):
            ref_id = href[1:]
            if ref_id not in visited:
                visited.add(ref_id)
                geom_elem = id_map.get(ref_id)
                if geom_elem is not None:
                    pos_lists = collect_pos_lists(geom_elem, id_map, visited)
                    break

    if not pos_lists:
        # フォールバック: elem直下にgeometryが含まれる場合
        pos_lists = collect_pos_lists(elem, id_map)

    if not pos_lists:
        continue

    geometry = build_geometry(pos_lists)
    if not geometry:
        continue

    props = {}
    for child in elem:
        cl = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if child.text and child.text.strip():
            props[cl] = child.text.strip()

    # dac = 用途地域コード(1-12), kda = 用途地域名テキスト
    zone_code = props.get('dac', '')
    zone_name = props.get('kda', '')
    if zone_code in YOTO_NAME:
        props['用途地域名'] = YOTO_NAME[zone_code]
    elif zone_name:
        props['用途地域名'] = zone_name
    if zone_code:
        props['cda'] = zone_code  # map.html _getYotoCode() 互換

    features.append({'type': 'Feature', 'geometry': geometry, 'properties': props})

print(f'DesignatedArea 総数: {da_count}')
if not features:
    print('フィーチャーなし（全フィーチャーの座標が空）')
else:
    print(f'フィーチャー数: {len(features)}')
    print('サンプルproperties:', list(features[0]['properties'].keys()))
    print('サンプル用途地域名:', features[0]['properties'].get('用途地域名', '—'))

result = {'type': 'FeatureCollection', 'features': features}

with open(DEST, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
