import type { Catalogue,Shop } from './schema.ts';

type Source=Catalogue['sources'][number];
export const recommendationVersion='reference-v1';
export const recommendationDimensions=[
  {id:'reputation',label:'口碑相对表现',weight:45},
  {id:'ranking',label:'榜单相对表现',weight:35},
  {id:'returnEvidence',label:'回访证据覆盖',weight:20},
] as const;
type DimensionId=typeof recommendationDimensions[number]['id'];
export type RecommendationDimension={id:DimensionId;label:string;weight:number;value:number;observed:boolean;explanation:string;sampleSize:number|null;sourceIds:string[]};
export type Recommendation={score:number;coverage:number;rank:number;tied:boolean;dimensions:RecommendationDimension[];missing:string[];sourceIds:string[];version:string};
type Observation={shopId:string;key:string;value:number;asOf:string;year:number|null;label:string;sourceIds:string[];count?:number|null};

// A midpoint rank describes this observed sample, not a percentage of satisfied diners.
export function midpointPercentile(value:number,sample:readonly number[]):number {
  if(!sample.length) return 50;
  return 100*(sample.filter(v=>v<value).length+sample.filter(v=>v===value).length/2)/sample.length;
}
function latestUnambiguous(records:Observation[]):Observation|null {
  const latestDate=records.map(r=>r.asOf).sort().at(-1);
  const latest=records.filter(r=>r.asOf===latestDate);
  if(!latest.length || new Set(latest.map(r=>`${r.value}|${r.count??''}`)).size!==1) return null;
  return {...latest[0],sourceIds:[...new Set(latest.flatMap(r=>r.sourceIds))]};
}
function makeCohorts(observations:Observation[]) {
  const grouped=new Map<string,Map<string,Observation[]>>();
  for(const record of observations){
    if(!grouped.has(record.key)) grouped.set(record.key,new Map());
    const group=grouped.get(record.key)!;
    group.set(record.shopId,[...(group.get(record.shopId)??[]),record]);
  }
  return new Map([...grouped].map(([key,group])=>[key,[...group.values()].flatMap(records=>{const r=latestUnambiguous(records);return r?[r]:[];})]));
}
function baseline(id:DimensionId,explanation:string):RecommendationDimension {
  return {...recommendationDimensions.find(d=>d.id===id)!,value:50,observed:false,explanation,sampleSize:null,sourceIds:[]};
}
function sourceChannel(ids:readonly string[],sources:Map<string,Source>):string|null {
  const channels=new Set(ids.flatMap(id=>{
    const source=sources.get(id);
    if(!source || source.kind!=='poi')return [];
    if(source.ratingChannel)return [source.ratingChannel];
    if(source.capture)return ['amap-app-displayed-rating'];
    // An arbitrary POI description cannot establish the rating field's channel.
    return [];
  }));
  return channels.size===1 ? [...channels][0]:null;
}
export function buildRecommendations(shops:readonly Shop[],sources:readonly Source[],asOf:string):Map<string,Recommendation> {
  const sourceMap=new Map(sources.map(s=>[s.id,s]));
  const ratings:Observation[]=[],rankingValues:Observation[]=[];
  for(const shop of shops){
    const current=shop.ratings.filter(r=>r.asOf<=asOf);
    const latestDate=current.map(r=>r.asOf).sort().at(-1);
    for(const r of current.filter(r=>r.asOf===latestDate)){
      const channel=sourceChannel(r.sourceIds,sourceMap);
      if(channel)ratings.push({shopId:shop.id,key:JSON.stringify([channel,r.max,r.asOf]),value:r.value,count:r.count,asOf:r.asOf,year:null,label:channel,sourceIds:r.sourceIds});
    }
    for(const r of shop.rankings.filter(r=>r.asOf<=asOf)){
      const metric=r.annualHeat??r.annualCompositeScore;
      if(!metric)continue;
      rankingValues.push({shopId:shop.id,key:JSON.stringify([r.name,r.edition,r.scope,metric.label,r.asOf]),value:metric.value,asOf:r.asOf,year:metric.year,label:`${r.name} · ${r.scope} · ${metric.label}`,sourceIds:r.sourceIds});
    }
  }
  const ratingCohorts=makeCohorts(ratings),rankingCohorts=makeCohorts(rankingValues);
  const results=new Map<string,Recommendation>();
  for(const shop of shops){
    let reputation=baseline('reputation','缺少同口径评分、评价数或不少于10家的可比样本，暂按中性值50计入。');
    const ratingGroups=[...ratingCohorts.values()].filter(g=>g.some(r=>r.shopId===shop.id));
    // Multiple same-date channels are not silently pooled or cherry-picked.
    if(ratingGroups.length===1){
      const group=ratingGroups[0],r=group.find(r=>r.shopId===shop.id)!;
      if(group.length>=10 && r.count!=null && r.count>=0){
        const percentile=midpointPercentile(r.value,group.map(r=>r.value));
        const reliability=r.count/(r.count+100);
        const value=50+(percentile-50)*reliability;
        reputation={...reputation,value,observed:true,sampleSize:group.length,sourceIds:r.sourceIds,explanation:`同一高德采集通道、同一量表标记及观察日的${group.length}家本站样本中，原始评分${r.value}的并列中位秩为${percentile.toFixed(1)}；以评价数${r.count}/(${r.count}+100)向中性50收缩，得到${value.toFixed(1)}。这是样本相对位置，不假定满分5，也不是满意率。`};
      }
    }
    let ranking=baseline('ranking','尚无不少于10家、同榜名/届次/范围/字段/观察日的可比组，暂按中性值50计入；上榜事实仍保留。');
    const choices=[...rankingCohorts.values()].filter(g=>g.length>=10 && g.some(r=>r.shopId===shop.id)).map(group=>({group,record:group.find(r=>r.shopId===shop.id)!}));
    choices.sort((a,b)=>(b.record.year??0)-(a.record.year??0) || b.record.asOf.localeCompare(a.record.asOf) || b.group.length-a.group.length || a.record.key.localeCompare(b.record.key));
    if(choices[0]){
      const {group,record}=choices[0];const value=midpointPercentile(record.value,group.map(r=>r.value));
      ranking={...ranking,value,observed:true,sampleSize:group.length,sourceIds:record.sourceIds,explanation:`同榜名、届次、范围、原始字段与观察日的${group.length}家本站样本中，并列中位秩为${value.toFixed(1)}。不同原始指标分别计算相对位置，再选最近明确届次、样本较大的有效组；不把原始热度与综合分直接相加。${group.length<30?'当前为小样本，新增资料可能明显改变位置。':''}`};
    }
    let returnEvidence=baseline('returnEvidence','未取得可用的回头客人数披露，暂按中性值50计入；不表示没有回头客，也不表示回访表现较差。');
    if(shop.repeatVisits && shop.repeatVisits.asOf<=asOf && shop.repeatVisits.count>0){
      returnEvidence={...returnEvidence,value:100,observed:true,sourceIds:shop.repeatVisits.sourceIds,explanation:'已有高德明确披露的重复到店人数，证据覆盖记100。只奖励这项资料可核查，不按人数多少加分，不等于回头率或质量100分。'};
    }
    const dimensions=[reputation,ranking,returnEvidence];
    const score=Math.round(dimensions.reduce((sum,d)=>sum+d.value*d.weight/100,0)*10)/10;
    const coverage=dimensions.filter(d=>d.observed).reduce((sum,d)=>sum+d.weight,0);
    results.set(shop.id,{score,coverage,rank:0,tied:false,dimensions,missing:dimensions.filter(d=>!d.observed).map(d=>d.label),sourceIds:[...new Set(dimensions.flatMap(d=>d.sourceIds))],version:`${recommendationVersion}:${asOf}:${shops.length}`});
  }
  const ordered=[...shops].sort((a,b)=>compareRecommendations(a,b,results));
  const scoreCounts=new Map<number,number>();
  for(const item of results.values())scoreCounts.set(item.score,(scoreCounts.get(item.score)??0)+1);
  let rank=0,previous:number|null=null;
  ordered.forEach((shop,index)=>{const result=results.get(shop.id)!;if(result.score!==previous)rank=index+1;result.rank=rank;result.tied=scoreCounts.get(result.score)!>1;previous=result.score;});
  return results;
}
export function compareRecommendations(a:Shop,b:Shop,results:Map<string,Recommendation>):number {
  const x=results.get(a.id)!,y=results.get(b.id)!;
  return y.score-x.score || y.coverage-x.coverage || a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id);
}
