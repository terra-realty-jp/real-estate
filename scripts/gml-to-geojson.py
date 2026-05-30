#!/usr/bin/env python3
"""
国土数値情報 A29（用途地域）GML v2.1 を GeoJSON に変換するスクリプト。
ogr2ogr 不要。Python 標準ライブラリのみ使用。

使用: python3 scripts/gml-to-geojson.py <input.xml> <output.geojson>

A29-19 実フィールド（デバッグで確認済み）:
  aac  = 行政区域コード（市区町村コード）
  dac  = 用途地域コード (1〜12) ← 実データではこのフィールド
  kda  = 用途地域名（テキスト）
  bar  = 建蔽率
  cbr  = 容積率
  lgn  = 地方公共団体名
  pfn  = 都道府県名
  geometry property = xlink:href で Surface要素を外部参照
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
# gml:id が使うnamespace候補（GML 3.1/3.2 両対応）
GML_ID_KEYS = [
    '{http://www.opengis.net/gml/3.2}id',
    '{http://www.opengis.net/gml}id',
    'gml:id',
]

# 用途地域コード → 名称マッピング
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

def collect_pos_lists(element):
    """element以下の全posList要素から座標を収集（深いネスト対応）"""
    result = []
    for pos_el in element.iter():
        local = pos_el.tag.split('}')[-1] if '}' in pos_el.tag else pos_el.tag
        if local == 'posList' and pos_el.text:
            nums = [float(x) for x in pos_el.text.split()]
            ring = []
            for i in range(0, len(nums) - 1, 2):
                lat, lng = nums[i], nums[i + 1]
                ring.append([lng, lat])
            if ring:
                result.append(ring)
    return result

def build_geometry(pos_lists):
    """収集した座標リングからGeoJSONジオメトリを生成"""
    if not pos_lists:
        return None
    if len(pos_lists) == 1:
        return {'type': 'Polygon', 'coordinates': pos_lists}
    return {'type': 'MultiPolygon', 'coordinates': [[r] for r in pos_lists]}

print(f'読み込み: {SRC}')
tree = ET.parse(SRC)
root = tree.getroot()

# gml:id → element のマップを構築（xlink:href 参照を解決するため）
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

    # xlink:href で参照されたジオメトリ要素を解決
    geom_elem = None
    for child in elem:
        href = child.attrib.get(XLINK_HREF, '')
        if href.startswith('#'):
            ref_id = href[1:]
            geom_elem = id_map.get(ref_id)
            if geom_elem is not None:
                break

    if geom_elem is not None:
        pos_lists = collect_pos_lists(geom_elem)
    else:
        # フォールバック: elem直下にgeometryが含まれる場合
        pos_lists = collect_pos_lists(elem)

    if not pos_lists:
        continue

    geometry = build_geometry(pos_lists)
    if not geometry:
        continue

    # 属性値を収集
    props = {}
    for child in elem:
        cl = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if child.text and child.text.strip():
            props[cl] = child.text.strip()

    # 用途地域コードと名称を正規化
    # dac = 用途地域コード(1-12), kda = 用途地域名テキスト
    zone_code = props.get('dac', '')
    zone_name = props.get('kda', '')
    if zone_code in YOTO_NAME:
        props['用途地域名'] = YOTO_NAME[zone_code]
    elif zone_name:
        props['用途地域名'] = zone_name
    # map.html _getYotoCode() が参照するフィールドとして cda にも格納
    if zone_code:
        props['cda'] = zone_code

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
