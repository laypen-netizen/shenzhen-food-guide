import { createHash } from 'node:crypto';
import { repeatVisitsDisplay, type Catalogue, type Shop } from './schema.ts';

type Source = Catalogue['sources'][number];
export const recommendationVersion = 'joint-evidence-v2';
export const minimumComparisonSize = 10;
export type RecommendationDimension = {
  id:'repeat'|'reputation'; label:string; value:number|null; display:string;
  observed:boolean; explanation:string; sourceIds:string[];
};
export type Recommendation = {
  score:number|null; rank:number|null; tied:boolean; eligible:boolean;
  sampleSize:number; leadCount:number; tieCount:number; incomparableCount:number; dominatedCount:number;
  behaviorCeiling:number|null; reason:string; dimensions:RecommendationDimension[];
  missing:string[]; sourceIds:string[]; version:string; groupKey:string|null;
};
type Observation = {
  shopId:string; rating:number; repeat:number; key:string; date:string;
};
const near = (a:number,b:number) => Math.abs(a-b)<1e-9;
const unique = (ids:string[]) => [...new Set(ids)];
const current = (date:string,asOf:string) => {
  const days=(Date.parse(asOf)-Date.parse(date))/86400000;
  return days>=0 && days<=180;
};

// A channel is evidence metadata, never inferred from a title or free-form text.
function channel(ids:string[],sources:Map<string,Source>,kind:'rating'|'repeat'):string|null {
  const records=ids.map(id=>sources.get(id));
  if(records.some(source=>!source))return null;
  const channels=records.flatMap(source=>{
    if(kind==='rating' && source && ['poi','rating'].includes(source.kind) && source.ratingChannel)return [source.ratingChannel];
    if(kind==='repeat' && source?.kind==='repeat' && source.repeatChannel)return [source.repeatChannel];
    return [];
  });
  return new Set(channels).size===1 ? channels[0]:null;
}

export function buildRecommendations(shops:readonly Shop[],sources:readonly Source[],asOf:string):Map<string,Recommendation> {
  const sourceMap=new Map(sources.map(source=>[source.id,source]));
  const results=new Map<string,Recommendation>();
  const groups=new Map<string,Observation[]>();
  // Hash the actual input snapshot. Changes on the same date must be traceable.
  const snapshot=createHash('sha256').update(JSON.stringify({asOf,shops:[...shops].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>({id:s.id,ratings:s.ratings,repeat:s.repeatVisits})),sources:[...sources].sort((a,b)=>a.id.localeCompare(b.id)).map(s=>({id:s.id,kind:s.kind,ratingChannel:s.ratingChannel,repeatChannel:s.repeatChannel}))})).digest('hex').slice(0,12);
  for(const shop of shops){
    if(results.has(shop.id))throw new Error(`重复参评门店：${shop.id}`);
    const dated=shop.ratings.filter(r=>r.asOf<=asOf);
    const latestDate=dated.map(r=>r.asOf).sort().at(-1);
    const latest=dated.filter(r=>r.asOf===latestDate);
    const keys=latest.map(r=>JSON.stringify([r.value,r.max,r.count,channel(r.sourceIds,sourceMap,'rating')]));
    const rawRating=latest.length && new Set(keys).size===1 ? latest[0]:null;
    const ratingChannel=rawRating ? channel(unique(latest.flatMap(r=>r.sourceIds)),sourceMap,'rating'):null;
    const rating=rawRating && ratingChannel && current(rawRating.asOf,asOf) && rawRating.count!==null && rawRating.count>0 ? rawRating:null;
    const rawRepeat=shop.repeatVisits;
    const repeatChannel=rawRepeat ? channel(rawRepeat.sourceIds,sourceMap,'repeat'):null;
    const repeat=rawRepeat && repeatChannel && current(rawRepeat.asOf,asOf) ? rawRepeat:null;
    const dimensions:RecommendationDimension[]=[
      {id:'repeat',label:'回访人数',value:repeat?.count??null,display:repeat ? `近${repeat.windowDays}天 ${repeatVisitsDisplay(repeat)}人`:'待补同口径资料',observed:!!repeat,sourceIds:repeat?.sourceIds??[],explanation:repeat ? '使用高德同一观察日、同一统计窗口的展示值比较顺序。近似人数保留原文；它不是回头率，平台去重与行为识别细则未披露。':'尚未取得有效、近期且渠道明确的回头客人数。未披露不等于没有回头客。'},
      {id:'reputation',label:'平台原始口碑',value:rating?.value??null,display:rating ? `${rating.value}${rating.max ? `/${rating.max}`:'（量表待核验）'}`:'待补同口径资料',observed:!!rating,sourceIds:rating ? unique(latest.flatMap(r=>r.sourceIds)):[],explanation:rating ? `高德展示评分${rating.value}，${rating.count}条评价。只比较同一采集通道、量表标记和日期的原始值，不换算好评率。评价数量不加分；它不能证明评价真实。`:'缺少有效评价数、明确采集渠道或近期唯一评分；同日冲突值不挑高分，也不回退旧记录。'},
    ];
    const missing=dimensions.filter(d=>!d.observed).map(d=>d.label);
    let reason=missing.length ? `待补${missing.join('与')}依据`:'同口径可比样本不足';
    let key:string|null=null;
    if(rating && repeat){
      if(rating.asOf!==repeat.asOf) reason='评分与回访观察日期不同';
      else {
        key=JSON.stringify([ratingChannel,rating.max,rating.asOf,repeatChannel,repeat.windowDays,repeat.asOf]);
        groups.set(key,[...(groups.get(key)??[]),{shopId:shop.id,rating:rating.value,repeat:repeat.count,key,date:rating.asOf}]);
      }
    }
    results.set(shop.id,{score:null,rank:null,tied:false,eligible:false,sampleSize:0,leadCount:0,tieCount:0,incomparableCount:0,dominatedCount:0,behaviorCeiling:null,reason,dimensions,missing,sourceIds:unique(dimensions.flatMap(d=>d.sourceIds)),version:`${recommendationVersion}:${asOf}:${snapshot}`,groupKey:key});
  }
  // Different channels or time windows are not calibrated to a common scale.
  // Use one declared cohort, never merge their percentiles into a total ranking.
  const candidates=[...groups.entries()].filter(([,g])=>g.length>=minimumComparisonSize)
    .sort(([ak,a],[bk,b])=>b.length-a.length || b[0].date.localeCompare(a[0].date) || ak.localeCompare(bk));
  const selected=candidates[0];
  for(const [key,group] of groups){
    for(const record of group){
      const result=results.get(record.shopId)!;
      result.sampleSize=group.length;
      if(!selected || selected[0]!==key){
        result.reason=group.length<minimumComparisonSize ? `同口径仅${group.length}家，暂未参评`:'与本次参评组口径不同，暂未参评';
        continue;
      }
      let lead=0,equal=0,crossed=0,dominated=0,ceiling=0;
      for(const peer of group){
        if(peer.shopId===record.shopId)continue;
        const ratingOrder=near(record.rating,peer.rating) ? 0:Math.sign(record.rating-peer.rating);
        const repeatOrder=Math.sign(record.repeat-peer.repeat);
        if(repeatOrder>=0)ceiling++;
        if(ratingOrder===0 && repeatOrder===0)equal++;
        else if(ratingOrder>=0 && repeatOrder>=0)lead++;
        else if(ratingOrder<=0 && repeatOrder<=0)dominated++;
        else crossed++;
      }
      Object.assign(result,{eligible:true,score:Math.round(100*(lead+equal*0.5)/(group.length-1)),leadCount:lead,tieCount:equal,incomparableCount:crossed,dominatedCount:dominated,behaviorCeiling:Math.round(100*ceiling/(group.length-1)),reason:`在${group.length}家同口径门店中比较；不是全深圳排名`});
    }
  }
  const ranked=[...shops].filter(s=>results.get(s.id)!.eligible).sort((a,b)=>compareRecommendations(a,b,results));
  const scoreCounts=new Map<number,number>();
  for(const s of ranked){const score=results.get(s.id)!.score!;scoreCounts.set(score,(scoreCounts.get(score)??0)+1);}
  let rank=0,previous:number|null=null;
  ranked.forEach((shop,index)=>{const r=results.get(shop.id)!;if(r.score!==previous)rank=index+1;r.rank=rank;r.tied=scoreCounts.get(r.score!)!>1;previous=r.score;});
  return results;
}
export function compareRecommendations(a:Shop,b:Shop,results:Map<string,Recommendation>):number {
  const x=results.get(a.id)!,y=results.get(b.id)!;
  return Number(y.eligible)-Number(x.eligible) || (x.eligible && y.eligible ? y.score!-x.score!:0)
    || a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id);
}
