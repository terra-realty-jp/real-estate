#!/usr/bin/env python3
"""
国土数値情報 A50（立地適正化計画）GeoJSONから稲毛区エリアを抽出するスクリプト。
A50のzipにはGeoJSONが同梱されているのでGML変換不要。

使用: python3 scripts/filter-ritchi.py <input.geojson> <output.geojson>
"""
import json
import sys

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/a50_src.geojson'
DEST = sys.argv[2] if len(sys.argv) > 2 else 'data/ritchi-inage.geojson'

NORTH, SOUTH = 35.710, 35.570
EAST,  WEST  = 140.185, 140.030

ZONE_COLORS = {
    '居住誘導区域':     '#6fa8dc',
    '都市機能誘導区域': '#f6b26b',
    '特定用途誘導地区': '#ff9900',
}

def centroid_in_box(coords):
    try:
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
        lng = sum(p[0] for p in flat) / len(flat)
        lat = sum(p[1] for p in flat) / len(flat)
        return SOUTH <= lat <= NORTH and WEST <= lng <= EAST
    except Exception:
        return False

with open(SRC, encoding='utf-8') as f:
    data = json.load(f)

features = [feat for feat in data.get('features', [])
            if centroid_in_box(feat.get('geometry', {}).get('coordinates', []))]

result = {
    'type': 'FeatureCollection',
    'features': features,
    'zone_colors': ZONE_COLORS,
}

with open(DEST, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, separators=(',', ':'))

print(f'稲毛区フィーチャー数: {len(features)}')
if features:
    props = features[0].get('properties', {})
    print('サンプルproperties:', list(props.keys())[:8])
    print('サンプル値:', {k: v for k, v in list(props.items())[:4]})
