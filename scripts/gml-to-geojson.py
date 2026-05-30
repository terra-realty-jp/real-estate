#!/usr/bin/env python3
"""
国土数値情報 A29（用途地域）GML v2.1 を GeoJSON に変換するスクリプト。
ogr2ogr 不要。Python 標準ライブラリのみ使用。

使用: python3 scripts/gml-to-geojson.py <input.xml> <output.geojson>

A29 v2.1 の主要属性:
  aac  = 行政区域コード（市区町村コード）
  cda  = 用途地域コード (1〜12)
  kda  = 区域区分コード
  bar  = 建蔽率
  cbr  = 容積率
  lgn  = 地方公共団体名
  pfn  = 都道府県名
"""
import json
import sys
try:
    import defusedxml.ElementTree as ET
except ImportError:
    import xml.etree.ElementTree as ET  # noqa: trusted government source only

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/yoto_inage.xml'
DEST = sys.argv[2] if len(sys.argv) > 2 else 'data/yoto-inage.geojson'

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
    """element以下の全posList要素から座標を収集"""
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

# 全要素を走査してDesignatedArea(用途地域フィーチャー)を抽出
features = []
all_local_tags = set()

for elem in root.iter():
    local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
    all_local_tags.add(local)

    if local != 'DesignatedArea':
        continue

    # 座標を収集（Surface/PolygonPatch/Ring/Curve/posList など深いネスト対応）
    pos_lists = collect_pos_lists(elem)
    if not pos_lists:
        continue

    geometry = build_geometry(pos_lists)
    if not geometry:
        continue

    # 属性値を収集
    props = {}
    for child in elem:
        child_local = child.tag.split('}')[-1] if '}' in child.tag else child.tag
        if child.text and child.text.strip() and child_local not in ('geometry',):
            props[child_local] = child.text.strip()

    # 用途地域名を追加
    cda = props.get('cda', '')
    if cda in YOTO_NAME:
        props['用途地域名'] = YOTO_NAME[cda]

    features.append({'type': 'Feature', 'geometry': geometry, 'properties': props})

if not features:
    local_list = sorted(all_local_tags)
    print(f'フィーチャーなし。発見タグ: {local_list}')
    # デバッグ: 最初のDesignatedAreaの構造を表示
    for elem in root.iter():
        local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
        if local == 'DesignatedArea':
            print('[DEBUG] DesignatedArea直下の子要素:')
            for c in elem:
                cl = c.tag.split('}')[-1] if '}' in c.tag else c.tag
                attribs = dict(c.attrib)
                print(f'  <{cl}> text={repr(c.text[:50] if c.text else None)} attribs={attribs}')
            print('[DEBUG] DesignatedArea以下の全子孫タグ:')
            sub_tags = set()
            for d in elem.iter():
                dl = d.tag.split('}')[-1] if '}' in d.tag else d.tag
                sub_tags.add(dl)
            print(f'  {sorted(sub_tags)}')
            break
else:
    print(f'フィーチャー数: {len(features)}')
    print('サンプルproperties:', list(features[0]['properties'].keys()))

result = {'type': 'FeatureCollection', 'features': features}

with open(DEST, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
