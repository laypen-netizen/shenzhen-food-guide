import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildRecommendations,
  compareRecommendations,
  minimumComparisonSize,
  type Recommendation,
} from '../src/lib/recommendation.ts';
import { validateCatalogue, type Catalogue, type Shop } from '../src/lib/schema.ts';
import { fixtureShop } from './fixtures.ts';

type Source = Catalogue['sources'][number];

const ratingApp: Source = {
  id: 'rating-app', title: '高德 App 门店评分', url: 'https://www.amap.com/place/B012345678',
  kind: 'poi', publishedAt: null, accessedAt: '2026-10-02', statement: '隔离测试评分来源。',
  ratingChannel: 'amap-app-displayed-rating',
};
const ratingPc: Source = {
  id: 'rating-pc', title: '高德网页 POI 评分', url: 'https://www.amap.com/place/B087654321',
  kind: 'poi', publishedAt: null, accessedAt: '2026-10-02', statement: '隔离测试评分来源。',
  ratingChannel: 'amap-pc-poi-rating',
};
const ratingUnmarked: Source = {
  id: 'rating-unmarked', title: '未标通道的 POI', url: 'https://www.amap.com/place/B011111111',
  kind: 'poi', publishedAt: null, accessedAt: '2026-10-02', statement: '自由文本提到 rating 和 review_total，但没有结构化通道。',
};
const repeatApp: Source = {
  id: 'repeat-app', title: '高德 App 回头客人数', url: 'https://www.amap.com/?repeat=test',
  kind: 'repeat', publishedAt: null, accessedAt: '2026-10-02', statement: '隔离测试回访来源。',
  repeatChannel: 'amap-app-repeat-visitors',
};
const repeatUnmarked: Source = {
  id: 'repeat-unmarked', title: '未标通道的回访记录', url: 'https://www.amap.com/?repeat=unmarked',
  kind: 'repeat', publishedAt: null, accessedAt: '2026-10-02', statement: '有自由文本但没有结构化通道。',
};
const sources = [ratingApp, ratingPc, ratingUnmarked, repeatApp, repeatUnmarked];

function shop(index: number, name = `测试门店${index}`): Shop {
  const value = structuredClone(fixtureShop());
  value.id = `recommendation-${index}`;
  value.slug = value.id;
  value.name = name;
  value.district = '南山';
  value.address.text = `测试路${index}号`;
  value.ratings = [];
  value.repeatVisits = null;
  return value;
}

function addEvidence(item: Shop, options: {
  rating?: number; ratingCount?: number | null; ratingMax?: number | null;
  ratingDate?: string; ratingSource?: string;
  repeat?: number; repeatDate?: string; repeatSource?: string; windowDays?: number;
  approximate?: boolean; rawDisplay?: string;
} = {}) {
  const {
    rating = 4.7, ratingCount = 100, ratingMax = null,
    ratingDate = '2026-10-02', ratingSource = ratingApp.id,
    repeat = 1000, repeatDate = ratingDate, repeatSource = repeatApp.id, windowDays = 180,
    approximate = false, rawDisplay,
  } = options;
  item.ratings.push({
    platform: '高德地图', value: rating, max: ratingMax, count: ratingCount,
    asOf: ratingDate, sourceIds: [ratingSource],
  });
  item.repeatVisits = {
    count: repeat, windowDays, approximate, ...(rawDisplay ? { rawDisplay } : {}),
    asOf: repeatDate, sourceIds: [repeatSource], definition: '隔离测试中的同窗口回头客展示值。',
  };
}

function resultFor(results: Map<string, Recommendation>, item: Shop) {
  return results.get(item.id)!;
}

test('不足10家不评分；达到阈值才参评，缺资料保持null而不补中性分', () => {
  assert.equal(minimumComparisonSize, 10);
  const nine = Array.from({ length: 9 }, (_, index) => shop(index));
  nine.forEach((item, index) => addEvidence(item, { rating: 4.6 + index / 100, repeat: 1000 + index }));
  const below = buildRecommendations(nine, sources, '2026-10-02');
  assert.ok(nine.every(item => {
    const result = resultFor(below, item);
    return !result.eligible && result.score === null && result.rank === null && result.sampleSize === 9;
  }));

  const tenth = shop(9);
  addEvidence(tenth, { rating: 4.69, repeat: 1009 });
  const missing = shop(10, '资料缺失门店');
  const enough = buildRecommendations([...nine, tenth, missing], sources, '2026-10-02');
  assert.ok([...nine, tenth].every(item => resultFor(enough, item).eligible && resultFor(enough, item).sampleSize === 10));
  assert.deepEqual(
    {
      eligible: resultFor(enough, missing).eligible,
      score: resultFor(enough, missing).score,
      rank: resultFor(enough, missing).rank,
      sampleSize: resultFor(enough, missing).sampleSize,
      missing: resultFor(enough, missing).missing,
    },
    { eligible: false, score: null, rank: null, sampleSize: 0, missing: ['回访人数', '平台原始口碑'] },
  );
});

test('不同评分渠道不混分，只选最大联合组；同规模时选较新日期再按key稳定选择', () => {
  const app = Array.from({ length: 10 }, (_, index) => shop(index));
  const pc = Array.from({ length: 11 }, (_, index) => shop(index + 20));
  app.forEach((item, index) => addEvidence(item, { ratingSource: ratingApp.id, repeat: 1000 + index }));
  pc.forEach((item, index) => addEvidence(item, { ratingSource: ratingPc.id, repeat: 2000 + index }));
  const larger = buildRecommendations([...app, ...pc], sources, '2026-10-02');
  assert.ok(pc.every(item => resultFor(larger, item).eligible && resultFor(larger, item).sampleSize === 11));
  assert.ok(app.every(item => !resultFor(larger, item).eligible && resultFor(larger, item).sampleSize === 10));

  const older = Array.from({ length: 10 }, (_, index) => shop(index + 40));
  const newer = Array.from({ length: 10 }, (_, index) => shop(index + 60));
  older.forEach((item, index) => addEvidence(item, {
    ratingSource: ratingApp.id, ratingDate: '2026-09-01', repeatDate: '2026-09-01', repeat: 3000 + index,
  }));
  newer.forEach((item, index) => addEvidence(item, {
    ratingSource: ratingPc.id, ratingDate: '2026-10-02', repeatDate: '2026-10-02', repeat: 4000 + index,
  }));
  const recent = buildRecommendations([...older, ...newer], sources, '2026-10-02');
  assert.ok(newer.every(item => resultFor(recent, item).eligible));
  assert.ok(older.every(item => !resultFor(recent, item).eligible));

  const sameDateApp = Array.from({ length: 10 }, (_, index) => shop(index + 80));
  const sameDatePc = Array.from({ length: 10 }, (_, index) => shop(index + 100));
  sameDateApp.forEach((item, index) => addEvidence(item, { ratingSource: ratingApp.id, repeat: 5000 + index }));
  sameDatePc.forEach((item, index) => addEvidence(item, { ratingSource: ratingPc.id, repeat: 6000 + index }));
  const stable = buildRecommendations([...sameDatePc, ...sameDateApp], sources, '2026-10-02');
  assert.ok(sameDateApp.every(item => resultFor(stable, item).eligible));
  assert.ok(sameDatePc.every(item => !resultFor(stable, item).eligible));
});

test('未标通道、日期不一致、过期资料和非正评价数均不能参评', () => {
  const valid = Array.from({ length: 10 }, (_, index) => shop(index));
  valid.forEach((item, index) => addEvidence(item, { repeat: 1000 + index }));
  const invalid = [
    shop(20, '评分通道未标'), shop(21, '回访通道未标'), shop(22, '观察日不一致'),
    shop(23, '资料过期'), shop(24, '评价数缺失'), shop(25, '评价数为零'),
  ];
  addEvidence(invalid[0], { ratingSource: ratingUnmarked.id });
  addEvidence(invalid[1], { repeatSource: repeatUnmarked.id });
  addEvidence(invalid[2], { repeatDate: '2026-10-01' });
  addEvidence(invalid[3], { ratingDate: '2026-03-01', repeatDate: '2026-03-01' });
  addEvidence(invalid[4], { ratingCount: null });
  addEvidence(invalid[5], { ratingCount: 0 });
  const results = buildRecommendations([...valid, ...invalid], sources, '2026-10-02');
  assert.ok(valid.every(item => resultFor(results, item).eligible));
  assert.ok(invalid.every(item => {
    const result = resultFor(results, item);
    return !result.eligible && result.score === null && result.rank === null;
  }));
});

test('重复评分记录不扩样本；同日value、count、max或channel冲突时不挑任一记录', () => {
  const base = () => {
    const items = Array.from({ length: 10 }, (_, index) => shop(index));
    items.forEach((item, index) => addEvidence(item, { rating: 4.6 + index / 100, repeat: 1000 + index }));
    return items;
  };
  const duplicate = base();
  duplicate[0].ratings.push(structuredClone(duplicate[0].ratings[0]));
  const deduped = buildRecommendations(duplicate, sources, '2026-10-02');
  assert.ok(duplicate.every(item => resultFor(deduped, item).eligible && resultFor(deduped, item).sampleSize === 10));

  const conflicts: Array<(item: Shop) => void> = [
    item => { item.ratings.push({ ...structuredClone(item.ratings[0]), value: 4.9 }); },
    item => { item.ratings.push({ ...structuredClone(item.ratings[0]), count: 999 }); },
    item => { item.ratings.push({ ...structuredClone(item.ratings[0]), max: 5 }); },
    item => { item.ratings.push({ ...structuredClone(item.ratings[0]), sourceIds: [ratingPc.id] }); },
  ];
  for(const conflict of conflicts) {
    const items = base();
    conflict(items[0]);
    const results = buildRecommendations(items, sources, '2026-10-02');
    assert.ok(items.every(item => !resultFor(results, item).eligible));
    assert.equal(resultFor(results, items[0]).sampleSize, 0);
    assert.ok(items.slice(1).every(item => resultFor(results, item).sampleSize === 9));
  }
});

test('Pareto只计算双项同时领先；完全相同计半，交叉关系不强判', () => {
  const target = shop(0, '目标门店');
  addEvidence(target, { repeat: 50, rating: 4.7 });
  const peers = [
    [40, 4.6], [40, 4.6], [40, 4.6],
    [50, 4.7], [50, 4.7],
    [60, 4.6], [40, 4.8],
    [60, 4.8], [60, 4.8],
  ] as const;
  const items = [target, ...peers.map(([repeat, rating], index) => {
    const item = shop(index + 1);
    addEvidence(item, { repeat, rating });
    return item;
  })];
  const results = buildRecommendations(items, sources, '2026-10-02');
  const result = resultFor(results, target);
  assert.deepEqual(
    {
      sampleSize: result.sampleSize,
      lead: result.leadCount,
      ties: result.tieCount,
      incomparable: result.incomparableCount,
      dominated: result.dominatedCount,
      score: result.score,
      behaviorCeiling: result.behaviorCeiling,
    },
    { sampleSize: 10, lead: 3, ties: 2, incomparable: 2, dominated: 2, score: 44, behaviorCeiling: 67 },
  );
  assert.equal(result.leadCount + result.tieCount + result.incomparableCount + result.dominatedCount, 9);
});

test('评价数量只验证记录有效性，任意正数增加不改变score、rank或Pareto计数', () => {
  const items = Array.from({ length: 10 }, (_, index) => shop(index));
  items.forEach((item, index) => addEvidence(item, {
    repeat: 1000 + index * 100, rating: 4.5 + index / 100, ratingCount: index + 1,
  }));
  const before = buildRecommendations(items, sources, '2026-10-02');
  items.forEach((item, index) => { item.ratings[0].count = (index + 1) * 100_000; });
  const after = buildRecommendations(items, sources, '2026-10-02');
  for(const item of items) {
    const a = resultFor(before, item), b = resultFor(after, item);
    assert.deepEqual(
      [b.score, b.rank, b.leadCount, b.tieCount, b.incomparableCount, b.dominatedCount, b.behaviorCeiling],
      [a.score, a.rank, a.leadCount, a.tieCount, a.incomparableCount, a.dominatedCount, a.behaviorCeiling],
    );
  }
});

test('只提高评分不能突破由回访顺序决定的behaviorCeiling', () => {
  const items = Array.from({ length: 10 }, (_, index) => shop(index));
  items.forEach((item, index) => addEvidence(item, {
    repeat: index + 1, rating: index === 4 ? 4.5 : 4.8,
  }));
  const before = buildRecommendations(items, sources, '2026-10-02');
  const target = items[4];
  const ceiling = resultFor(before, target).behaviorCeiling;
  target.ratings[0].value = 5;
  const after = buildRecommendations(items, sources, '2026-10-02');
  assert.equal(ceiling, 44);
  assert.equal(resultFor(after, target).behaviorCeiling, ceiling);
  assert.equal(resultFor(after, target).score, ceiling);
  assert.ok(resultFor(after, target).score! <= resultFor(after, target).behaviorCeiling!);
});

test('整数同分固定并列；未参评门店排在后面并按地区店名稳定排序', () => {
  const tiedA = shop(0, '并列甲');
  const tiedB = shop(1, '并列乙');
  addEvidence(tiedA, { repeat: 100, rating: 4.5 });
  addEvidence(tiedB, { repeat: 100, rating: 4.5 });
  const higher = Array.from({ length: 8 }, (_, index) => shop(index + 2));
  higher.forEach((item, index) => addEvidence(item, { repeat: 200 + index, rating: 4.6 + index / 100 }));
  const unrankedA = shop(20, '未参评乙');
  const unrankedB = shop(21, '未参评甲');
  const items = [unrankedA, tiedB, ...higher, unrankedB, tiedA];
  const results = buildRecommendations(items, sources, '2026-10-02');
  assert.equal(resultFor(results, tiedA).score, resultFor(results, tiedB).score);
  assert.equal(resultFor(results, tiedA).rank, resultFor(results, tiedB).rank);
  assert.equal(resultFor(results, tiedA).tied, true);
  assert.equal(resultFor(results, tiedB).tied, true);
  const ordered = [...items].sort((a, b) => compareRecommendations(a, b, results));
  assert.ok(ordered.slice(0, 10).every(item => resultFor(results, item).eligible));
  assert.deepEqual(
    ordered.slice(10).map(item => item.name),
    [unrankedA.name, unrankedB.name].sort((a, b) => a.localeCompare(b, 'zh-CN')),
  );
});

test('近似回访原文保留并列，不把6.1万展示成精确人数', () => {
  const items = Array.from({ length: 10 }, (_, index) => shop(index));
  items.forEach((item, index) => addEvidence(item, {
    repeat: index < 2 ? 61_000 : 70_000 + index,
    rating: index < 2 ? 4.8 : 4.7 + index / 100,
    ...(index < 2 ? { approximate: true, rawDisplay: '6.1万' } : {}),
  }));
  const results = buildRecommendations(items, sources, '2026-10-02');
  const first = resultFor(results, items[0]), second = resultFor(results, items[1]);
  assert.equal(first.dimensions.find(dimension => dimension.id === 'repeat')!.display, '近180天 约6.1万人');
  assert.equal(first.score, second.score);
  assert.equal(first.rank, second.rank);
  assert.equal(first.tied, true);
});

test('当前正式数据只有同口径App联合组18家参评，其余门店不生成分数或名次', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/data/catalogue.json', import.meta.url), 'utf8'));
  const catalogue = validateCatalogue(raw, { asOf: '2026-10-02' });
  const results = buildRecommendations(catalogue.shops, catalogue.sources, catalogue.updatedAt);
  const eligible = catalogue.shops.filter(item => resultFor(results, item).eligible);
  const unranked = catalogue.shops.filter(item => !resultFor(results, item).eligible);
  assert.equal(eligible.length, 18);
  assert.ok(eligible.every(item => resultFor(results, item).score !== null && resultFor(results, item).rank !== null));
  assert.ok(unranked.every(item => resultFor(results, item).score === null && resultFor(results, item).rank === null));
  const pcRepeat = catalogue.shops.find(item => item.id === 'amap-b0ffk22w52')!;
  assert.equal(resultFor(results, pcRepeat).eligible, false);
  assert.equal(resultFor(results, pcRepeat).sampleSize, 1);
});
