import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRecommendations,
  compareRecommendations,
  midpointPercentile,
  type Recommendation,
} from '../src/lib/recommendation.ts';
import type { Catalogue, Shop } from '../src/lib/schema.ts';
import { fixtureShop } from './fixtures.ts';

type Source = Catalogue['sources'][number];

const appPoiSource: Source = {
  id: 'app-poi',
  title: '高德 App 门店详情',
  url: 'https://www.amap.com/place/B012345678',
  kind: 'poi',
  publishedAt: null,
  accessedAt: '2026-10-02',
  statement: '高德 App 门店页显示原始评分和评价数。',
  capture: { method: 'official-app', view: '高德地图 App 门店详情', localEvidence: [] },
};

const pcPoiSource: Source = {
  id: 'pc-poi',
  title: '高德公开 POI 响应',
  url: 'https://www.amap.com/place/B087654321',
  kind: 'poi',
  publishedAt: null,
  accessedAt: '2026-10-02',
  statement: '同一网页 POI 详情接口返回 rating 与 review_total。',
  ratingChannel: 'amap-pc-poi-rating',
};

const genericPoiSource: Source = {
  id: 'generic-poi',
  title: '高德POI详情：测试门店',
  url: 'https://www.amap.com/place/B011111111',
  kind: 'poi',
  publishedAt: null,
  accessedAt: '2026-10-02',
  statement: '这里只在自由文本中提到 review_total，没有结构化评分通道标记。',
};

function shop(index: number, name = `测试门店${index}`): Shop {
  const value = structuredClone(fixtureShop());
  value.id = `recommendation-${index}`;
  value.slug = value.id;
  value.name = name;
  value.address.text = `测试路${index}号`;
  value.ratings = [];
  value.rankings = [];
  value.repeatVisits = null;
  return value;
}

function reputation(result: Recommendation) {
  return result.dimensions.find(dimension => dimension.id === 'reputation')!;
}

function ranking(result: Recommendation) {
  return result.dimensions.find(dimension => dimension.id === 'ranking')!;
}

function returnEvidence(result: Recommendation) {
  return result.dimensions.find(dimension => dimension.id === 'returnEvidence')!;
}

function addRating(item: Shop, sourceId: string, value: number, count: number | null = 100) {
  item.ratings.push({
    platform: '高德地图', value, max: null, count, asOf: '2026-10-02', sourceIds: [sourceId],
  });
}

function addRanking(
  item: Shop,
  { year, value, scope = '深圳市 · 测试范围', sourceId = `ranking-${year}` }:
  { year: number; value: number; scope?: string; sourceId?: string },
) {
  item.rankings.push({
    name: `高德扫街榜 · ${year}测试榜`, edition: String(year), rank: null, scope,
    asOf: '2026-10-02', sourceIds: [sourceId],
    annualHeat: { value, year, label: '全年热度值', rawDisplay: String(value) },
  });
}

test('并列中位秩按低于项加一半同值项计算，空样本回到中性值', () => {
  const sample = [1, 2, 2, 4];
  assert.equal(midpointPercentile(1, sample), 12.5);
  assert.equal(midpointPercentile(2, sample), 50);
  assert.equal(midpointPercentile(4, sample), 87.5);
  assert.equal(midpointPercentile(99, []), 50);
});

test('可比样本9家不评分，达到10家才观察；评价数缺失的门店仍按缺项50处理', () => {
  const nine = Array.from({ length: 9 }, (_, index) => shop(index));
  nine.forEach((item, index) => addRating(item, appPoiSource.id, 4.5 + (index % 5) / 10));
  const below = buildRecommendations(nine, [appPoiSource], '2026-10-02');
  assert.ok(nine.every(item => reputation(below.get(item.id)!).observed === false));

  const ten = Array.from({ length: 10 }, (_, index) => shop(index));
  ten.forEach((item, index) => addRating(item, appPoiSource.id, 4.5 + (index % 5) / 10));
  const enough = buildRecommendations(ten, [appPoiSource], '2026-10-02');
  assert.ok(ten.every(item => reputation(enough.get(item.id)!).observed));
  assert.ok(ten.every(item => reputation(enough.get(item.id)!).sampleSize === 10));

  ten[0].ratings[0].count = null;
  const missingCount = buildRecommendations(ten, [appPoiSource], '2026-10-02');
  assert.deepEqual(
    {
      value: reputation(missingCount.get(ten[0].id)!).value,
      observed: reputation(missingCount.get(ten[0].id)!).observed,
      coverage: missingCount.get(ten[0].id)!.coverage,
    },
    { value: 50, observed: false, coverage: 0 },
  );
});

test('同一原始评分字段按已确认采集渠道分组，普通POI说明不能冒充review_total通道', () => {
  const app = Array.from({ length: 10 }, (_, index) => shop(index));
  const pc = Array.from({ length: 10 }, (_, index) => shop(index + 10));
  const generic = Array.from({ length: 10 }, (_, index) => shop(index + 20));
  app.forEach((item, index) => addRating(item, appPoiSource.id, 4.5 + index / 100));
  pc.forEach((item, index) => addRating(item, pcPoiSource.id, 4.5 + index / 100));
  generic.forEach((item, index) => addRating(item, genericPoiSource.id, 4.5 + index / 100));
  const result = buildRecommendations([...app, ...pc, ...generic], [appPoiSource, pcPoiSource, genericPoiSource], '2026-10-02');
  assert.ok(app.every(item => reputation(result.get(item.id)!).sampleSize === 10));
  assert.ok(pc.every(item => reputation(result.get(item.id)!).sampleSize === 10));
  assert.ok(generic.every(item => reputation(result.get(item.id)!).observed === false));

  addRating(app[0], pcPoiSource.id, 4.9);
  const mixed = buildRecommendations([...app, ...pc], [appPoiSource, pcPoiSource], '2026-10-02');
  assert.equal(reputation(mixed.get(app[0].id)!).observed, false);
});

test('榜单字段相同但scope不同仍分别计算样本', () => {
  const first = Array.from({ length: 10 }, (_, index) => shop(index));
  const second = Array.from({ length: 10 }, (_, index) => shop(index + 10));
  first.forEach((item, index) => addRanking(item, { year: 2026, value: 90 + index / 10, scope: '深圳市 · 范围甲' }));
  second.forEach((item, index) => addRanking(item, { year: 2026, value: 80 + index / 10, scope: '深圳市 · 范围乙' }));
  const result = buildRecommendations([...first, ...second], [], '2026-10-02');
  assert.ok([...first, ...second].every(item => ranking(result.get(item.id)!).sampleSize === 10));
  assert.equal(ranking(result.get(first[0].id)!).value, 5);
  assert.equal(ranking(result.get(second[0].id)!).value, 5);
});

test('同店同组重复记录只计一家，同日值冲突则整店退出该组', () => {
  const shops = Array.from({ length: 10 }, (_, index) => shop(index));
  shops.forEach((item, index) => addRanking(item, { year: 2026, value: 90 + index / 10 }));
  shops[0].rankings.push(structuredClone(shops[0].rankings[0]));
  const duplicate = buildRecommendations(shops, [], '2026-10-02');
  assert.ok(shops.every(item => ranking(duplicate.get(item.id)!).sampleSize === 10));

  shops[0].rankings.push({
    ...structuredClone(shops[0].rankings[0]),
    annualHeat: { value: 99, year: 2026, label: '全年热度值', rawDisplay: '99' },
  });
  const conflict = buildRecommendations(shops, [], '2026-10-02');
  assert.ok(shops.every(item => ranking(conflict.get(item.id)!).observed === false));
});

test('榜单维度优先最新明确届次，不挑选旧届次中的更高分位', () => {
  const shops = Array.from({ length: 10 }, (_, index) => shop(index));
  shops.forEach((item, index) => {
    addRanking(item, { year: 2025, value: index === 0 ? 100 : index - 1, scope: '深圳市 · 2025范围' });
    addRanking(item, { year: 2026, value: index, scope: '深圳市 · 2026范围' });
  });
  const result = buildRecommendations(shops, [], '2026-10-02');
  const selected = ranking(result.get(shops[0].id)!);
  assert.equal(selected.value, 5);
  assert.deepEqual(selected.sourceIds, ['ranking-2026']);
});

test('缺项只按中性50计入并降低coverage，回访证据只增加覆盖与固定证据分', () => {
  const missing = shop(1, '缺项门店');
  const disclosed = shop(2, '有回访证据门店');
  disclosed.repeatVisits = {
    count: 1, windowDays: 180, rawDisplay: '1', approximate: false,
    asOf: '2026-10-02', sourceIds: ['repeat'], definition: '仅测试是否存在正数披露。',
  };
  const result = buildRecommendations([missing, disclosed], [], '2026-10-02');
  assert.deepEqual(
    { score: result.get(missing.id)!.score, coverage: result.get(missing.id)!.coverage, missing: result.get(missing.id)!.missing },
    { score: 50, coverage: 0, missing: ['口碑相对表现', '榜单相对表现', '回访证据覆盖'] },
  );
  assert.deepEqual(
    { score: result.get(disclosed.id)!.score, coverage: result.get(disclosed.id)!.coverage, value: returnEvidence(result.get(disclosed.id)!).value },
    { score: 60, coverage: 20, value: 100 },
  );
});

test('总分相同的门店固定并列，展示顺序仍有确定性', () => {
  const higher = shop(1, '有证据');
  higher.repeatVisits = {
    count: 1, windowDays: 180, approximate: false,
    asOf: '2026-10-02', sourceIds: ['repeat'], definition: '测试记录。',
  };
  const first = shop(2, '乙店');
  const second = shop(3, '甲店');
  const shops = [first, higher, second];
  const result = buildRecommendations(shops, [], '2026-10-02');
  assert.deepEqual(
    { higher: result.get(higher.id)!.rank, first: result.get(first.id)!.rank, second: result.get(second.id)!.rank },
    { higher: 1, first: 2, second: 2 },
  );
  assert.equal(result.get(first.id)!.tied, true);
  assert.equal(result.get(second.id)!.tied, true);
  const ordered = [...shops].sort((a, b) => compareRecommendations(a, b, result));
  assert.equal(ordered[0].id, higher.id);
  assert.deepEqual(
    ordered.slice(1).map(item => item.name),
    [first.name, second.name].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  );
});
