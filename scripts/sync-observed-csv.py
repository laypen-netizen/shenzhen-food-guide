"""Refresh catalogue facts in the local CSV, retaining earlier observation columns."""
import csv
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
catalogue = json.loads((root / 'src/data/catalogue.json').read_text())
target = root / 'research/amap-observed-shops.csv'
with target.open(newline='') as source:
    reader = csv.DictReader(source)
    fields = list(reader.fieldnames)
    rows = list(reader)
for field in ['annual_composite_scores', 'ranking_editions', 'longitude_gcj02', 'latitude_gcj02']:
    if field not in fields:
        fields.append(field)
by_id = {row['id']: row for row in rows}
sources = {item['id']: item for item in catalogue['sources']}
for shop in catalogue['shops']:
    row = by_id.get(shop['id'])
    if row is None:
        row = {'id': shop['id']}
        rows.append(row)
        by_id[shop['id']] = row
    rating = sorted(shop['ratings'], key=lambda item: item['asOf'], reverse=True)
    rating = rating[0] if rating else {}
    repeat = shop.get('repeatVisits') or {}
    coordinates = shop.get('coordinates') or {}
    row.update({
        'name': shop['name'], 'district': shop['district'],
        'amap_score': rating.get('value'), 'score_max': rating.get('max'),
        'review_count': rating.get('count'),
        'average_price_cny': (shop.get('price') or {}).get('cny'),
        'observed_at': shop['checkedAt'], 'status': '正式收录', 'missing': '',
        'address': shop['address']['text'], 'hours': (shop.get('hours') or {}).get('text'),
        'source_url': sources[shop['address']['sourceIds'][0]]['url'],
        'repeat_count': repeat.get('count'), 'repeat_window_days': repeat.get('windowDays'),
        'repeat_as_of': repeat.get('asOf'), 'repeat_definition': repeat.get('definition'),
        'repeat_raw_display': repeat.get('rawDisplay'),
        'repeat_approximate': str(repeat.get('approximate', False)).lower() if repeat else '',
        'annual_composite_scores': '; '.join(
            f"{r['annualCompositeScore']['year']} {r['scope']} 全年综合分={r['annualCompositeScore']['value']}"
            for r in shop['rankings'] if r.get('annualCompositeScore')
        ),
        'ranking_editions': '; '.join(sorted({r['edition'] for r in shop['rankings']})),
        'longitude_gcj02': coordinates.get('lon'), 'latitude_gcj02': coordinates.get('lat'),
    })
temporary = target.with_suffix('.csv.tmp')
with temporary.open('w', newline='') as output:
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
temporary.replace(target)
with target.open(newline='') as source:
    readback = list(csv.DictReader(source))
assert len({row['id'] for row in readback}) == len(readback)
assert sum(row['status'] == '正式收录' for row in readback) == len(catalogue['shops'])
print(f"CSV回读通过：{len(catalogue['shops'])}家正式门店，保留{len(readback)}条观察记录")
