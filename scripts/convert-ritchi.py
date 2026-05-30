#!/usr/bin/env python3
"""
国土数値情報 A50（立地適正化計画区域）GML を GeoJSON に変換するスクリプト。
ogr2ogr 不要。Python 標準ライブラリのみ使用。

使用: python3 scripts/convert-ritchi.py <input.xml> <output.geojson> [bbox_filter]
  bbox_filter: "north,south,east,west" 形式でバウンディングボックスフィルタを指定（省略可）

主要区域種別（A50の zone_type / A50_003 相当）:
  居住誘導区域
  都市機能誘導区域
  特定用途誘導地区
  市街化区域（参考）
"""
import json
import sys
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET  # noqa: trusted government source only

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ritchi.xml'
DEST = sys.argv[2] if len(sys.argv) > 2 else 'data/ritchi-inage.geojson'
BBOX_ARG = sys.argv[3] if len(sys.argv) > 3 else None

# 稲毛区バウンディングボックス（デフォルト）
if BBOX_ARG:
    north, south, east, west = [float(v) for v in BBOX_ARG.split(',')]
else:
    north, south, east, west = 35.710, 35.570, 140.185, 140.030

XLINK_HREF = '{http://www.w3.org/1999/xlink}href'
GML_ID_KEYS = [
    '{http://www.opengis.net/gml/3.2}id',
    '{http://www.opengis.net/gml}id',
    'gml:id',
]

# 区域種別カラーマッピング（map.html 側でも参照）
ZONE_COLOR = {
    '居住誘導区域':     '#6fa8dc',
    '都市機能誘導区域': '#f6b26b',
    '特定用途誘導地区': '#ff9900',
    '市街化区域':       '#cccccc',
}

def collect_pos_lists(element, id_map, visited=None):
    """xlink:href多段解決付きposList座標収集"""
    if visited is None:
        visited = set()
    result = []
    for el in element.iter():
        href = el.attrib.get(XLINK_HREF, '')
        if href.startswith('#'):
            ref_id = href[1:]
            if ref_id not in visited:
                visited.add(ref_id)
                ref_elem = id_map.get(ref_id)
                if ref_elem is not None:
                    result.extend(collect_pos_lists(ref_elem, id_map, visited))
        else:
            local = el.tag.split('}')[-1] if '}' in el.tag else el.tag
            if local == 'posList' and el.text:
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

def centroid_in_bbox(geometry):
    """ジオメトリの重心がバウンディングボックス内か判定"""
    try:
        coords = geometry.get('coordinates', [])
        flat = []
        def flatten(c):
            if isinstance(c[0], list):
                for x in c:
                    flatten(x)
            else:
                flat.append(c)
        flatten(coords)
        if not flat:
            return False
        lng_c = sum(p[0] for p in flat) / len(flat)
        lat_c = sum(p[1] for p in flat) / len(flat)
        return south <= lat_c <= north and west <= lng_c <= east
    except Exception:
        return False

print(f'読み込み: {SRC}')
tree = ET.parse(SRC)
root = tree.getroot()

# gml:id マップ構築
id_map = {}
for el in root.iter():
    for key in GML_ID_KEYS:
        gid = el.attrib.get(key)
        if gid:
            id_map[gid] = el
            break

print(f'gml:id マップ: {len(id_map)} 件')

# 全タグを収集してフィーチャー要素名を特定
all_local_tags = set()
for el in root.iter():
    local = el.tag.split('}')[-1] if '}' in el.tag else el.tag
    all_local_tags.add(local)

# A50 フィーチャー要素名の候補
FEATURE_NAMES = {
    'RitiSeizokaKuiki', 'UrbanFunctionInducementArea', 'ResidentialInducementArea',
    'LocationNormalizationPlanArea', 'LandUseClassification',
    'DistrictDevelopmentPlan', 'RitiSeizokaKuikiPolygon',
}

# 実際のフィーチャー要素名を検出
feature_name = None
for name in FEATURE_NAMES:
    if name in all_local_tags:
        feature_name = name
        break

if feature_name is None:
    # 未知のフィーチャー名の場合、全タグを出力してデバッグ支援
    print(f'既知フィーチャー名なし。全タグ: {sorted(all_local_tags)}')
    # 最初のルート直下の要素名を表示
    for child in root:
        cl = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if cl not in ('boundedBy', 'EnvelopeWithTimePeriod'):
            print(f'ルート直下候補要素: {cl}')
            # この要素の最初の子要素を確認
            for cc in child:
                ccl = cc.tag.split('}')[-1] if '}' in cc.tag else cc.tag
                print(f'  その子: {ccl}')
            break
    feature_name = None

features = []
feat_count = 0
skip_count = 0

if feature_name:
    for elem in root.iter():
        local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        if local != feature_name:
            continue
        feat_count += 1

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
            pos_lists = collect_pos_lists(elem, id_map)

        if not pos_lists:
            skip_count += 1
            continue

        geometry = build_geometry(pos_lists)
        if not geometry or not centroid_in_bbox(geometry):
            skip_count += 1
            continue

        props = {}
        for child in elem:
            cl = child.tag.split('}')[-1] if '}' in child.tag else child.tag
            if child.text and child.text.strip():
                props[cl] = child.text.strip()

        features.append({'type': 'Feature', 'geometry': geometry, 'properties': props})

print(f'フィーチャー総数: {feat_count}, 稲毛区内: {len(features)}, スキップ: {skip_count}')
if features:
    sample = features[0]['properties']
    print('サンプルproperties:', list(sample.keys()))
    print('サンプル値:', {k: v for k, v in list(sample.items())[:5]})

result = {
    'type': 'FeatureCollection',
    'features': features,
    'zone_colors': ZONE_COLOR,
}

with open(DEST, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))

print(f'出力: {DEST}')
