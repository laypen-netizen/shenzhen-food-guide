import type { Shop } from './schema.ts';

export type AmapRating = Shop['ratings'][number];

// Preserve the source's displayed value and scale. No derived restaurant score.
export function getAmapRating(shop:Shop,asOf=shop.checkedAt):AmapRating|null {
  const dated=shop.ratings.filter(rating=>rating.asOf<=asOf);
  const latestDate=dated.map(rating=>rating.asOf).sort().at(-1);
  const latest=dated.filter(rating=>rating.asOf===latestDate);
  if(!latest.length)return null;
  if(new Set(latest.map(rating=>JSON.stringify([rating.value,rating.max]))).size!==1)return null;
  const counts=new Set(latest.map(rating=>rating.count));
  return {...latest[0],count:counts.size===1 ? latest[0].count:null,
    sourceIds:[...new Set(latest.flatMap(rating=>rating.sourceIds))].sort()};
}

export function buildAmapRatings(shops:readonly Shop[],asOf:string):Map<string,AmapRating|null> {
  const ratings=new Map<string,AmapRating|null>();
  for(const shop of shops){
    if(ratings.has(shop.id))throw new Error(`重复门店：${shop.id}`);
    ratings.set(shop.id,getAmapRating(shop,asOf));
  }
  return ratings;
}

export function compareAmapRatings(a:Shop,b:Shop,ratings:Map<string,AmapRating|null>):number {
  const x=ratings.get(a.id)?.value??null,y=ratings.get(b.id)?.value??null;
  const scoreOrder=x===null ? y===null ? 0:1 : y===null ? -1:y-x;
  return scoreOrder || a.district.localeCompare(b.district,'zh-CN')
    || a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id);
}

export function getRankingYears(shop:Shop):Array<'2025'|'2026'> {
  const years=shop.rankings.map(ranking=>ranking.edition).filter((year):year is '2025'|'2026'=>year==='2025'||year==='2026');
  return [...new Set(years)].sort();
}

export function amapRatingCountLabel(shop:Shop,rating:AmapRating):string {
  if(rating.count!==null)return `${rating.count.toLocaleString('zh-CN')} 条评价`;
  const counts=new Set(shop.ratings.filter(r=>r.asOf===rating.asOf).map(r=>r.count));
  return counts.size>1 ? '评价数口径不一致':'评价数未公布';
}
