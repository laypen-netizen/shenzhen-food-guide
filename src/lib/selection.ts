import {annualCompositeRanking,type Catalogue,type Shop} from './schema.ts';

type Source = Catalogue['sources'][number];

type ExpectedEvidence = {
  checkedAt:string;
  rating:{ value:number; count:number|null; asOf:string; sourceId:string };
  repeat:{ count:number; rawDisplay:string|null; approximate:boolean; windowDays:number; asOf:string; sourceId:string };
  ranking:{ name:string; rank:number|null; scope:string; asOf:string; sourceId:string };
};

export type EditorialSelection = {
  shopId:string;
  reason:string;
  sourceIds:readonly string[];
  selectedAt:string;
  expected:ExpectedEvidence;
};

// 这是可追溯的编辑精选快照，不是跨品类排名或质量总分。
export const editorialSelections:readonly EditorialSelection[] = [
  {
    shopId:'chaoxiangyuan-longhua',
    reason:'高德原始评分4.8（765条评价）；页面原文“近180天2.4万回头客”；原榜范围为“深圳市 · 龙华区 · 大排档”，榜内第1名。',
    sourceIds:['poi-chaoxiangyuan-longhua','repeat-chaoxiangyuan-longhua','app-chaoxiangyuan-longhua'],
    selectedAt:'2026-10-02',
    expected:{
      checkedAt:'2026-10-02',
      rating:{value:4.8,count:765,asOf:'2026-10-02',sourceId:'poi-chaoxiangyuan-longhua'},
      repeat:{count:24000,rawDisplay:'2.4万',approximate:true,windowDays:180,asOf:'2026-10-02',sourceId:'repeat-chaoxiangyuan-longhua'},
      ranking:{name:'高德扫街榜 · 回头客大排档榜',rank:1,scope:'深圳市 · 龙华区 · 大排档',asOf:'2026-10-02',sourceId:'app-chaoxiangyuan-longhua'},
    },
  },
  {
    shopId:'laosanyang-nanshan',
    reason:'高德原始评分4.7（201条评价）；页面显示近180天9486回头客；原榜范围为“深圳市 · 南山区 · 江西菜”，榜内第1名。',
    sourceIds:['poi-laosanyang-nanshan','repeat-laosanyang-nanshan','app-laosanyang-nanshan'],
    selectedAt:'2026-10-02',
    expected:{
      checkedAt:'2026-10-02',
      rating:{value:4.7,count:201,asOf:'2026-10-02',sourceId:'poi-laosanyang-nanshan'},
      repeat:{count:9486,rawDisplay:null,approximate:false,windowDays:180,asOf:'2026-10-02',sourceId:'repeat-laosanyang-nanshan'},
      ranking:{name:'高德扫街榜 · 回头客江西菜榜',rank:1,scope:'深圳市 · 南山区 · 江西菜',asOf:'2026-10-02',sourceId:'app-laosanyang-nanshan'},
    },
  },
  {
    shopId:'ouji-baoli',
    reason:'高德原始评分4.8（300条评价）；页面显示近180天4582回头客；原榜范围为“深圳市 · 南山区 · 江西菜”，榜内第2名。',
    sourceIds:['poi-ouji-baoli','repeat-ouji-baoli','app-ouji-baoli'],
    selectedAt:'2026-10-02',
    expected:{
      checkedAt:'2026-10-02',
      rating:{value:4.8,count:300,asOf:'2026-10-02',sourceId:'poi-ouji-baoli'},
      repeat:{count:4582,rawDisplay:null,approximate:false,windowDays:180,asOf:'2026-10-02',sourceId:'repeat-ouji-baoli'},
      ranking:{name:'高德扫街榜 · 回头客江西菜榜',rank:2,scope:'深圳市 · 南山区 · 江西菜',asOf:'2026-10-02',sourceId:'app-ouji-baoli'},
    },
  },
];

function includesSource(sourceIds:readonly string[],sourceId:string) {
  return sourceIds.includes(sourceId);
}

function matches(selection:EditorialSelection,shop:Shop) {
  const expected=selection.expected;
  if(shop.checkedAt!==expected.checkedAt) return false;
  const rating=[...shop.ratings].sort((a,b)=>b.asOf.localeCompare(a.asOf))[0];
  if(!rating || rating.value!==expected.rating.value || rating.count!==expected.rating.count || rating.asOf!==expected.rating.asOf || !includesSource(rating.sourceIds,expected.rating.sourceId)) return false;
  const repeat=shop.repeatVisits;
  if(!repeat || repeat.count!==expected.repeat.count || (repeat.rawDisplay??null)!==expected.repeat.rawDisplay || repeat.approximate!==expected.repeat.approximate || repeat.windowDays!==expected.repeat.windowDays || repeat.asOf!==expected.repeat.asOf || !includesSource(repeat.sourceIds,expected.repeat.sourceId)) return false;
  return shop.rankings.some(r=>r.name===expected.ranking.name && r.rank===expected.ranking.rank && r.scope===expected.ranking.scope && r.asOf===expected.ranking.asOf && includesSource(r.sourceIds,expected.ranking.sourceId));
}

export function selectionFor(shop:Shop):EditorialSelection|null {
  const selection=editorialSelections.find(item=>item.shopId===shop.id);
  return selection && matches(selection,shop) ? selection:null;
}

export function compareSelection(a:Shop,b:Shop) {
  const aSelected=selectionFor(a)!==null;
  const bSelected=selectionFor(b)!==null;
  if(aSelected!==bSelected) return aSelected ? -1:1;
  if(aSelected && bSelected) return a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN');
  const aAnnual=annualCompositeRanking(a,2025)?.annualCompositeScore?.value;
  const bAnnual=annualCompositeRanking(b,2025)?.annualCompositeScore?.value;
  if(aAnnual!==undefined || bAnnual!==undefined) {
    if(aAnnual===undefined) return 1;
    if(bAnnual===undefined) return -1;
    if(aAnnual!==bAnnual) return bAnnual-aAnnual;
    return a.name.localeCompare(b.name,'zh-CN') || a.district.localeCompare(b.district,'zh-CN');
  }
  return a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN');
}

function collectShopSourceIds(value:unknown,ids:Set<string>) {
  if(Array.isArray(value)) { for(const item of value) collectShopSourceIds(item,ids);return; }
  if(!value || typeof value!=='object') return;
  const object=value as Record<string,unknown>;
  if(Array.isArray(object.sourceIds)) for(const id of object.sourceIds) if(typeof id==='string') ids.add(id);
  for(const item of Object.values(object)) collectShopSourceIds(item,ids);
}

export function validateSelections(shops:readonly Shop[],sources:readonly Source[]):void {
  const errors:string[]=[];
  const seen=new Set<string>();
  const shopMap=new Map(shops.map(shop=>[shop.id,shop]));
  const sourceMap=new Map(sources.map(source=>[source.id,source]));
  for(const selection of editorialSelections) {
    if(seen.has(selection.shopId)) errors.push(`编辑精选门店 id 重复：${selection.shopId}`);
    seen.add(selection.shopId);
    const shop=shopMap.get(selection.shopId);
    if(!shop) { errors.push(`编辑精选门店不存在：${selection.shopId}`);continue; }
    if(!matches(selection,shop)) errors.push(`编辑精选记录已过期：${selection.shopId}`);
    const usedByShop=new Set<string>();
    collectShopSourceIds(shop,usedByShop);
    const selectionSources=new Set<string>();
    for(const sourceId of selection.sourceIds) {
      if(selectionSources.has(sourceId)) errors.push(`编辑精选来源重复：${selection.shopId} / ${sourceId}`);
      selectionSources.add(sourceId);
      if(!sourceMap.has(sourceId)) errors.push(`编辑精选来源不存在：${selection.shopId} / ${sourceId}`);
      else if(!usedByShop.has(sourceId)) errors.push(`编辑精选来源未被门店事实引用：${selection.shopId} / ${sourceId}`);
    }
    for(const sourceId of [selection.expected.rating.sourceId,selection.expected.repeat.sourceId,selection.expected.ranking.sourceId]) {
      if(!selectionSources.has(sourceId)) errors.push(`编辑精选缺少指标来源：${selection.shopId} / ${sourceId}`);
    }
  }
  if(errors.length) throw new Error(errors.join('\n'));
}
