import { createHash } from 'node:crypto';
import { repeatVisitsDisplay, type Catalogue, type Shop } from './schema.ts';

type Source = Catalogue['sources'][number];
export const recommendationVersion = 'partial-order-v4';
// A presentation policy carried over from v3, not a statistical significance test.
export const minimumComparisonSize = 10;
export type RecommendationDimension = {
  id:'repeat'|'reputation'; label:string; value:number|null; display:string;
  observed:boolean; explanation:string; sourceIds:string[];
};
export type Recommendation = {
  scoreRange:{lower:number;upper:number}|null;
  scoreBasis:{lowerNumerator:number;upperNumerator:number;denominator:number}|null;
  rankRange:{best:number;worst:number}|null;
  tier:number|null; eligible:boolean;
  sampleSize:number; leadCount:number; tieCount:number; incomparableCount:number; dominatedCount:number;
  reason:string; dimensions:RecommendationDimension[];
  missing:string[]; sourceIds:string[]; version:string; groupKey:string|null;
};
type Observation = {
  shopId:string; rating:number; repeat:number; key:string; date:string;
};
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
      {id:'repeat',label:'回访人数',value:repeat?.count??null,display:repeat ? `近${repeat.windowDays}天 ${repeatVisitsDisplay(repeat)}人`:'待补同口径资料',observed:!!repeat,sourceIds:repeat?.sourceIds??[],explanation:repeat ? repeat.approximate ? '高德只提供近似人数，原文保留供参考；未取得精确展示或取整区间，暂不参与计分，也不据此判断与其他门店人数相等。':'使用高德同一观察日、同一统计窗口的非近似展示值比较顺序；它不是真实客流或回头率，平台去重与行为识别细则未披露。':'尚未取得有效、近期且渠道明确的回头客人数。未披露不等于没有回头客。'},
      {id:'reputation',label:'高德展示评分',value:rating?.value??null,display:rating ? `${rating.value}${rating.max ? `/${rating.max}`:'（量表待核验）'}`:'待补同口径资料',observed:!!rating,sourceIds:rating ? unique(latest.flatMap(r=>r.sourceIds)):[],explanation:rating ? `高德展示评分${rating.value}，${rating.count}条评价。只比较同一采集通道、量表标记和日期的原始值，不换算好评率。评价数量不加分；它不能证明评价真实。`:'缺少有效评价数、明确采集渠道或近期唯一评分；同日冲突值不挑高分，也不回退旧记录。'},
    ];
    const missing=dimensions.filter(d=>!d.observed).map(d=>d.label);
    let reason=missing.length ? `待补${missing.join('与')}依据`:'同口径可比样本不足';
    let key:string|null=null;
    if(rating && repeat){
      if(repeat.approximate) reason='回访人数为近似展示，暂不参与精确比较';
      else if(rating.asOf!==repeat.asOf) reason='评分与回访观察日期不同';
      else {
        key=JSON.stringify([ratingChannel,rating.max,rating.asOf,repeatChannel,repeat.windowDays,repeat.asOf]);
        groups.set(key,[...(groups.get(key)??[]),{shopId:shop.id,rating:rating.value,repeat:repeat.count,key,date:rating.asOf}]);
      }
    }
    results.set(shop.id,{scoreRange:null,scoreBasis:null,rankRange:null,tier:null,eligible:false,sampleSize:0,leadCount:0,tieCount:0,incomparableCount:0,dominatedCount:0,reason,dimensions,missing,sourceIds:unique(dimensions.flatMap(d=>d.sourceIds)),version:`${recommendationVersion}:${asOf}:${snapshot}`,groupKey:key});
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
      let lead=0,equal=0,crossed=0,dominated=0;
      for(const peer of group){
        if(peer.shopId===record.shopId)continue;
        // Compare the recorded numeric display values exactly. An epsilon-based
        // equality is not transitive and can invalidate a partial order.
        const ratingOrder=Math.sign(record.rating-peer.rating);
        const repeatOrder=Math.sign(record.repeat-peer.repeat);
        if(ratingOrder===0 && repeatOrder===0)equal++;
        else if(ratingOrder>=0 && repeatOrder>=0)lead++;
        else if(ratingOrder<=0 && repeatOrder<=0)dominated++;
        else crossed++;
      }
      // Bounds over all total orders that preserve strict Pareto dominance,
      // keeping identical observations in a tied block with average rank.
      // Crossed peers may precede or follow this shop; never assign a midpoint.
      const scoreBasis={lowerNumerator:2*lead+equal,upperNumerator:2*(lead+crossed)+equal,denominator:2*(group.length-1)};
      Object.assign(result,{eligible:true,scoreBasis,
        scoreRange:{lower:100*scoreBasis.lowerNumerator/scoreBasis.denominator,upper:100*scoreBasis.upperNumerator/scoreBasis.denominator},
        rankRange:{best:dominated+1,worst:group.length-lead-equal},
        leadCount:lead,tieCount:equal,incomparableCount:crossed,dominatedCount:dominated,
        reason:`在${group.length}家同口径门店中比较；保留交叉关系造成的位置范围，不代表全深圳排名`});
    }
  }
  if(selected){
    const dominates=(a:Observation,b:Observation)=>a.rating>=b.rating && a.repeat>=b.repeat && (a.rating>b.rating || a.repeat>b.repeat);
    let remaining=[...selected[1]],tier=1;
    while(remaining.length){
      const front=remaining.filter(record=>!remaining.some(peer=>dominates(peer,record)));
      if(!front.length)throw new Error('双证据关系无法形成部分序');
      const ids=new Set(front.map(record=>record.shopId));
      for(const id of ids)results.get(id)!.tier=tier;
      remaining=remaining.filter(record=>!ids.has(record.shopId));
      tier++;
    }
  }
  return results;
}
export function compareRecommendations(a:Shop,b:Shop,results:Map<string,Recommendation>):number {
  const x=results.get(a.id)!,y=results.get(b.id)!;
  return Number(y.eligible)-Number(x.eligible) || (x.eligible && y.eligible ? x.tier!-y.tier!:0)
    || a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id);
}

export function formatScoreRange(result:Recommendation|undefined):string {
  if(!result?.scoreBasis)return '暂未参评';
  const {lowerNumerator:lower,upperNumerator:upper,denominator}=result.scoreBasis;
  // Round outward using rational inputs. Display rounding never affects order.
  const lo=Math.floor(100*lower/denominator),hi=Math.ceil(100*upper/denominator);
  return lo===hi ? String(lo):`${lo}–${hi}`;
}
export function formatRankRange(result:Recommendation|undefined):string {
  if(!result?.rankRange)return '暂未参评';
  const {best,worst}=result.rankRange;
  return `第${best===worst ? best:`${best}–${worst}`}名 / ${result.sampleSize}家`;
}
