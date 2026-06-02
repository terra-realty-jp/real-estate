#!/usr/bin/env python3
"""
用途地域GeoJSON（国土数値情報A29）から指定エリアを抽出するスクリプト。
使用: python3 scripts/filter-yoto.py <src> <dest> [bbox]
  bbox: "north,south,east,west"（省略時は稲毛区）
例:   python3 scripts/filter-yoto.py /tmp/yoto_all.geojson data/yoto-wakaba.geojson 35.667,35.551,140.273,140.117

※ 千葉市A29(aac=12100)は区別が無いため、区の抽出は bbox（centroid内包）で行う。
"""
import json
import sys

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/yoto_all.geojson'
DEST = sys.argv[2] if len(sys.argv) > 2 else 'data/yoto-inage.geojson'
BBOX_ARG = sys.argv[3] if len(sys.argv) > 3 else None

# バウンディングボックス（デフォルト=稲毛区）
if BBOX_ARG:
    NORTH, SOUTH, EAST, WEST = [float(v) for v in BBOX_ARG.split(',')]
else:
    NORTH, SOUTH = 35.710, 35.570
    EAST,  WEST  = 140.185, 140.030

def centroid_in_box(coords_list):
    try:
        flat = []
        def flatten(c):
            if isinstance(c[0], list):
                for x in c:
                    flatten(x)
            else:
                flat.append(c)
        flatten(coords_list)
        if not flat:
            return False
        lng = sum(c[0] for c in flat) / len(flat)
        lat = sum(c[1] for c in flat) / len(flat)
        return SOUTH <= lat <= NORTH and WEST <= lng <= EAST
    except Exception:
        return False

def municipality_matches(props):
    for v in props.values():
        s = str(v)
        if '12103' in s or s in ('12100', '121030'):
            return True
    return False

with open(SRC, encoding='utf-8') as f:
    data = json.load(f)

features = []
for feat in data.get('features', []):
    props = feat.get('properties') or {}
    geom  = feat.get('geometry') or {}
    coords = geom.get('coordinates', [])
    # 入力が既に千葉市(12100)のファイルの場合、aac='12100'が全件マッチしてしまうため
    # バウンディングボックスを優先判定基準とし、稲毛区専用ファイル(12103)の場合のみ
    # municipality_matchesを使う
    aac = str(props.get('aac', ''))
    if aac == '12103' or municipality_matches(props) and aac != '12100':
        features.append(feat)
    elif centroid_in_box(coords):
        features.append(feat)

result = {'type': 'FeatureCollection', 'features': features}

with open(DEST, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))

print(f'稲毛区フィーチャー数: {len(features)}')
if features:
    print('サンプルproperties:', list(features[0].get('properties', {}).keys())[:10])
