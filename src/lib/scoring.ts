import type { Shop } from './schema.ts';

export const dimensions = [
  { id:'satisfaction', label:'食客满意度', weight:30, description:'保留高德原始量表，按原始评分 / 满分 × 100换算；评分不是亲测结论。' },
  { id:'repeat', label:'重复到店', weight:30, description:'仅接受高德明确的回头客行为指标。名次、导航热度、评论中的“常来”不能代替回头率。' },
  { id:'stability', label:'口碑稳定性', weight:25, description:'至少三次同一门店、同一量表的高德评分快照，跨度至少六个月。公开采样时间与波动计算方法。' },
  { id:'value', label:'性价比', weight:15, description:'需要高德明确的性价比指标与口径。仅有人均价格时不计算，低价本身不是品质证明。' },
] as const;
export function compositeScore(shop: Shop) {
  const latest = [...shop.ratings].sort((a,b) => b.asOf.localeCompare(a.asOf))[0];
  const values: Record<string,number|null> = {
    satisfaction: latest?.max != null ? latest.value / latest.max * 100 : null,
    repeat: shop.metrics.repeat?.value ?? null,
    stability: shop.metrics.stability?.value ?? null,
    value: shop.metrics.value?.value ?? null,
  };
  const available = dimensions.filter(d => values[d.id] !== null);
  const coverage = available.reduce((sum,d) => sum + d.weight,0);
  const lower = available.reduce((sum,d) => sum + (values[d.id] ?? 0) * d.weight / 100,0);
  const enough = available.length >= 3 && coverage >= 70;
  return { values, coverage, enough, complete:coverage === 100, lower:Math.round(lower), upper:Math.round(lower + 100 - coverage), score: coverage === 100 ? Math.round(lower) : null };
}
