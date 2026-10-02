import assert from 'node:assert/strict';
import test from 'node:test';
import {buildRecommendations,compareRecommendations,formatScoreRange} from '../src/lib/recommendation.ts';
import type {Catalogue,Shop} from '../src/lib/schema.ts';
import {fixtureShop} from './fixtures.ts';

type Source=Catalogue['sources'][number];
type Point={id:string;name:string;rating:number;repeat:number};

const ratingSource:Source={
  id:'order-rating',title:'高德 App 展示评分',url:'https://www.amap.com/place/B012345678',kind:'poi',
  publishedAt:null,accessedAt:'2026-10-02',statement:'部分序隔离测试评分来源。',
  ratingChannel:'amap-app-displayed-rating',
};
const repeatSource:Source={
  id:'order-repeat',title:'高德 App 回头客人数',url:'https://www.amap.com/?order-test=repeat',kind:'repeat',
  publishedAt:null,accessedAt:'2026-10-02',statement:'部分序隔离测试回访来源。',
  repeatChannel:'amap-app-repeat-visitors',
};
const sources=[ratingSource,repeatSource];

function makeShop(point:Point):Shop{
  const item=structuredClone(fixtureShop());
  item.id=item.slug=point.id;item.name=point.name;item.address.text=`${point.name}测试地址`;
  item.ratings=[{platform:'高德地图',value:point.rating,max:null,count:100,asOf:'2026-10-02',sourceIds:[ratingSource.id]}];
  item.repeatVisits={count:point.repeat,windowDays:180,approximate:false,asOf:'2026-10-02',sourceIds:[repeatSource.id],definition:'隔离测试中的同窗口回头客展示值。'};
  return item;
}
const build=(points:Point[])=>{
  const shops=points.map(makeShop);
  return {shops,results:buildRecommendations(shops,sources,'2026-10-02')};
};
const result=(built:ReturnType<typeof build>,id:string)=>built.results.get(id)!;
const close=(actual:number,expected:number,message?:string)=>assert.ok(Math.abs(actual-expected)<1e-9,message??`${actual} != ${expected}`);
const dominates=(a:Point,b:Point)=>a.rating>=b.rating&&a.repeat>=b.repeat&&(a.rating>b.rating||a.repeat>b.repeat);

function linearExtensionRanks(points:Point[],targetId:string){
  const target=points.findIndex(point=>point.id===targetId);
  const predecessors=points.map((point,index)=>points.reduce((mask,peer,peerIndex)=>mask|(peerIndex!==index&&dominates(peer,point)?1<<peerIndex:0),0));
  const full=(1<<points.length)-1,ranks=new Set<number>();
  const visit=(mask:number,targetRank:number|null)=>{
    if(mask===full){assert.notEqual(targetRank,null);ranks.add(targetRank!);return;}
    const position=mask.toString(2).replaceAll('0','').length+1;
    for(let index=0;index<points.length;index++){
      const bit=1<<index;
      if(mask&bit)continue;
      if((predecessors[index]&mask)!==predecessors[index])continue;
      visit(mask|bit,index===target?position:targetRank);
    }
  };
  visit(0,null);
  return [...ranks].sort((a,b)=>a-b);
}

function tiedBlockExtensionExtremes(points:Point[],targetId:string){
  const grouped=new Map<string,Point[]>();
  for(const point of points){
    const key=JSON.stringify([point.rating,point.repeat]);
    grouped.set(key,[...(grouped.get(key)??[]),point]);
  }
  const blocks=[...grouped.values()];
  const target=blocks.findIndex(block=>block.some(point=>point.id===targetId));
  assert.notEqual(target,-1);
  const predecessors=blocks.map((block,index)=>blocks.reduce((mask,peer,peerIndex)=>
    mask|(peerIndex!==index&&dominates(peer[0],block[0])?1<<peerIndex:0),0));
  const full=(1<<blocks.length)-1,ranks=new Set<number>(),percentiles=new Set<number>();
  const visit=(mask:number,targetRank:number|null,targetPercentile:number|null)=>{
    if(mask===full){
      assert.notEqual(targetRank,null);assert.notEqual(targetPercentile,null);
      ranks.add(targetRank!);percentiles.add(targetPercentile!);return;
    }
    const occupied=blocks.reduce((count,block,index)=>count+((mask&(1<<index))?block.length:0),0);
    for(let index=0;index<blocks.length;index++){
      const bit=1<<index;
      if(mask&bit)continue;
      if((predecessors[index]&mask)!==predecessors[index])continue;
      if(index===target){
        const rank=occupied+1,midrank=rank+(blocks[index].length-1)/2;
        visit(mask|bit,rank,100*(points.length-midrank)/(points.length-1));
      }else visit(mask|bit,targetRank,targetPercentile);
    }
  };
  visit(0,null,null);
  return {ranks:[...ranks],percentiles:[...percentiles]};
}

test('L/D/C/E 完整分割同组关系，并生成精确分子分母和区间边界',()=>{
  const points:Point[]=[
    {id:'target',name:'目标门店',rating:4.7,repeat:50},
    ...[1,2,3].map(index=>({id:`below-${index}`,name:`被领先${index}`,rating:4.6,repeat:40})),
    ...[1,2].map(index=>({id:`equal-${index}`,name:`同值${index}`,rating:4.7,repeat:50})),
    {id:'cross-repeat',name:'回访较高评分较低',rating:4.6,repeat:60},
    {id:'cross-rating',name:'评分较高回访较低',rating:4.8,repeat:40},
    {id:'above-1',name:'双项领先1',rating:4.8,repeat:60},
    {id:'above-2',name:'双项领先2',rating:4.8,repeat:60},
  ];
  const built=build(points),target=result(built,'target');
  assert.deepEqual(
    {L:target.leadCount,D:target.dominatedCount,C:target.incomparableCount,E:target.tieCount,total:target.leadCount+target.dominatedCount+target.incomparableCount+target.tieCount},
    {L:3,D:2,C:2,E:2,total:9},
  );
  assert.deepEqual(target.scoreBasis,{lowerNumerator:8,upperNumerator:12,denominator:18});
  assert.deepEqual(target.rankRange,{best:3,worst:5});
  assert.equal(target.tier,2);
  close(target.scoreRange!.lower,100*8/18);
  close(target.scoreRange!.upper,100*12/18);
  for(const legacy of ['score','rank','tied','behaviorCeiling'])assert.equal(legacy in target,false,`不应保留旧单值字段 ${legacy}`);
});

test('分数与名次区间等于所有保持严格支配关系的线性扩展极值',()=>{
  const points:Point[]=[
    {id:'above',name:'双项领先',rating:6,repeat:600},
    {id:'target',name:'目标门店',rating:5,repeat:500},
    {id:'below',name:'双项落后',rating:4,repeat:400},
    {id:'cross-rating',name:'评分高回访低',rating:6,repeat:400},
    {id:'cross-repeat',name:'评分低回访高',rating:4,repeat:600},
    ...Array.from({length:5},(_,index)=>({id:`anchor-${index}`,name:`底部锚点${index}`,rating:3.5-index/10,repeat:300-index*10})),
  ];
  const built=build(points),target=result(built,'target');
  const ranks=linearExtensionRanks(points,'target');
  assert.deepEqual([Math.min(...ranks),Math.max(...ranks)],[target.rankRange!.best,target.rankRange!.worst]);
  close(target.scoreRange!.lower,100*(points.length-target.rankRange!.worst)/(points.length-1));
  close(target.scoreRange!.upper,100*(points.length-target.rankRange!.best)/(points.length-1));
  assert.deepEqual(target.scoreBasis,{lowerNumerator:12,upperNumerator:16,denominator:18});
});

test('完全同值门店折叠为同一 tie 块，半分只进入 midrank 分子',()=>{
  const points:Point[]=[
    {id:'above',name:'双项领先',rating:6,repeat:600},
    {id:'equal-a',name:'同值甲',rating:5,repeat:500},
    {id:'equal-b',name:'同值乙',rating:5,repeat:500},
    {id:'equal-c',name:'同值丙',rating:5,repeat:500},
    ...Array.from({length:6},(_,index)=>({id:`below-${index}`,name:`底部${index}`,rating:4-index/10,repeat:400-index*10})),
  ];
  const built=build(points);
  for(const id of ['equal-a','equal-b','equal-c']){
    const item=result(built,id);
    assert.deepEqual({L:item.leadCount,D:item.dominatedCount,C:item.incomparableCount,E:item.tieCount},{L:6,D:1,C:0,E:2});
    assert.deepEqual(item.scoreBasis,{lowerNumerator:14,upperNumerator:14,denominator:18});
    assert.deepEqual(item.rankRange,{best:2,worst:2});
    assert.equal(item.tier,2);
    close(item.scoreRange!.lower,100*14/18);close(item.scoreRange!.upper,100*14/18);
  }
});

test('Pareto 非支配层不强排交叉门店，层内只按名称稳定展示',()=>{
  const points:Point[]=[
    {id:'top-rating',name:'乙顶层',rating:6,repeat:400},
    {id:'top-repeat',name:'甲顶层',rating:4,repeat:600},
    {id:'second-a',name:'次层甲',rating:5,repeat:300},
    {id:'second-b',name:'次层乙',rating:5.5,repeat:250},
    {id:'second-c',name:'次层丙',rating:3,repeat:500},
    ...Array.from({length:5},(_,index)=>({id:`bottom-${index}`,name:`底层${index}`,rating:2.9-index/10,repeat:240-index*10})),
  ];
  const built=build(points);
  assert.equal(result(built,'top-rating').tier,1);assert.equal(result(built,'top-repeat').tier,1);
  for(const id of ['second-a','second-b','second-c'])assert.equal(result(built,id).tier,2);
  assert.notDeepEqual(result(built,'top-rating').scoreBasis,result(built,'top-repeat').scoreBasis,'同层门店可以有不同区间依据');
  const ordered=[...built.shops].sort((a,b)=>compareRecommendations(a,b,built.results));
  assert.deepEqual(ordered.filter(shop=>result(built,shop.id).tier===1).map(shop=>shop.name),['甲顶层','乙顶层']);
});

test('单店任一维改善且另一维不降时，不会让其部分序结果变差',()=>{
  const points:Point[]=[
    {id:'above',name:'双项领先',rating:6,repeat:600},
    {id:'target',name:'目标门店',rating:5,repeat:500},
    {id:'below',name:'双项落后',rating:4,repeat:400},
    {id:'cross-rating',name:'评分高回访低',rating:6,repeat:400},
    {id:'cross-repeat',name:'评分低回访高',rating:4,repeat:600},
    ...Array.from({length:5},(_,index)=>({id:`anchor-${index}`,name:`锚点${index}`,rating:3.5-index/10,repeat:300-index*10})),
  ];
  const before=result(build(points),'target');
  const improved=points.map(point=>point.id==='target'?{...point,rating:6.1}:point);
  const after=result(build(improved),'target');
  assert.ok(after.tier!<=before.tier!);
  assert.ok(after.leadCount>=before.leadCount);
  assert.ok(after.dominatedCount<=before.dominatedCount);
  assert.ok(after.scoreRange!.lower>=before.scoreRange!.lower);
  assert.ok(after.scoreRange!.upper>=before.scoreRange!.upper);
  assert.ok(after.rankRange!.best<=before.rankRange!.best);
  assert.ok(after.rankRange!.worst<=before.rankRange!.worst);
});

test('输入排列不影响关系计数、区间、层级和最终稳定顺序',()=>{
  const points:Point[]=Array.from({length:10},(_,index)=>({
    id:`permutation-${index}`,name:`排列门店${String(9-index).padStart(2,'0')}`,
    rating:index%2===0?4.8-index/100:4.5+index/100,repeat:1000+(index%3)*200-index*10,
  }));
  const forward=build(points),reverse=build([...points].reverse());
  const fields=['leadCount','dominatedCount','incomparableCount','tieCount','scoreBasis','scoreRange','rankRange','tier','eligible'] as const;
  for(const point of points){
    const a=result(forward,point.id),b=result(reverse,point.id);
    assert.deepEqual(Object.fromEntries(fields.map(field=>[field,a[field]])),Object.fromEntries(fields.map(field=>[field,b[field]])),point.id);
  }
  const order=(built:ReturnType<typeof build>)=>[...built.shops].sort((a,b)=>compareRecommendations(a,b,built.results)).map(shop=>shop.id);
  assert.deepEqual(order(forward),order(reverse));
});

test('显示百分比的取整结果不参与同层排序',()=>{
  const points:Point[]=[
    {id:'higher-basis',name:'乙店',rating:6,repeat:400},
    {id:'lower-basis',name:'甲店',rating:4,repeat:600},
    {id:'a-only-1',name:'甲侧样本1',rating:5.5,repeat:300},
    {id:'a-only-2',name:'甲侧样本2',rating:5,repeat:350},
    {id:'b-only',name:'乙侧样本',rating:3.5,repeat:500},
    ...Array.from({length:5},(_,index)=>({id:`round-bottom-${index}`,name:`底部样本${index}`,rating:3-index/10,repeat:250-index*10})),
  ];
  const built=build(points),a=result(built,'higher-basis'),b=result(built,'lower-basis');
  assert.equal(a.tier,1);assert.equal(b.tier,1);
  assert.ok(a.scoreBasis!.lowerNumerator>b.scoreBasis!.lowerNumerator,'两个同层结果故意具有不同精确分子');
  const ordered=[...built.shops].sort((x,y)=>compareRecommendations(x,y,built.results));
  assert.deepEqual(ordered.filter(shop=>result(built,shop.id).tier===1).map(shop=>shop.name),['甲店','乙店']);
});

test('全同值10店只表示无法区分：区间为50、竞争名次第1且同属第1层',()=>{
  const points:Point[]=Array.from({length:10},(_,index)=>({
    id:`all-equal-${index}`,name:`全同值${index}`,rating:4.7,repeat:500,
  }));
  const built=build(points);
  for(const point of points){
    const item=result(built,point.id);
    assert.deepEqual(item.scoreBasis,{lowerNumerator:9,upperNumerator:9,denominator:18});
    assert.deepEqual(item.scoreRange,{lower:50,upper:50});
    assert.deepEqual(item.rankRange,{best:1,worst:1});
    assert.equal(item.tier,1);
    assert.deepEqual({L:item.leadCount,D:item.dominatedCount,C:item.incomparableCount,E:item.tieCount},{L:0,D:0,C:0,E:9});
  }
});

test('10店两两完全交叉时全部保留0–100、竞争名次1–10且同属第1层',()=>{
  const points:Point[]=Array.from({length:10},(_,index)=>({
    id:`all-cross-${index}`,name:`完全交叉${index}`,rating:4+index/10,repeat:1000-index*10,
  }));
  const built=build(points);
  for(const point of points){
    const item=result(built,point.id);
    assert.deepEqual(item.scoreBasis,{lowerNumerator:0,upperNumerator:18,denominator:18});
    assert.deepEqual(item.scoreRange,{lower:0,upper:100});
    assert.deepEqual(item.rankRange,{best:1,worst:10});
    assert.equal(item.tier,1);
    assert.deepEqual({L:item.leadCount,D:item.dominatedCount,C:item.incomparableCount,E:item.tieCount},{L:0,D:0,C:9,E:0});
  }
});

test('同值块与交叉块并存时，竞争名次和midrank区间等于全部tie-block线性扩展极值',()=>{
  const points:Point[]=[
    {id:'top',name:'顶点',rating:7,repeat:700},
    {id:'above',name:'双项领先',rating:6,repeat:600},
    {id:'target-a',name:'目标同值甲',rating:5,repeat:500},
    {id:'target-b',name:'目标同值乙',rating:5,repeat:500},
    {id:'cross-a',name:'交叉同值甲',rating:6,repeat:400},
    {id:'cross-b',name:'交叉同值乙',rating:6,repeat:400},
    {id:'cross-repeat',name:'回访交叉',rating:4,repeat:600},
    {id:'below-a',name:'底部同值甲',rating:4,repeat:400},
    {id:'below-b',name:'底部同值乙',rating:4,repeat:400},
    {id:'bottom',name:'最低点',rating:3,repeat:300},
  ];
  const built=build(points),target=result(built,'target-a');
  const extensions=tiedBlockExtensionExtremes(points,'target-a');
  assert.deepEqual({L:target.leadCount,D:target.dominatedCount,C:target.incomparableCount,E:target.tieCount},{L:3,D:2,C:3,E:1});
  assert.deepEqual(target.scoreBasis,{lowerNumerator:7,upperNumerator:13,denominator:18});
  assert.deepEqual(
    {best:Math.min(...extensions.ranks),worst:Math.max(...extensions.ranks)},
    target.rankRange,
  );
  close(Math.min(...extensions.percentiles),target.scoreRange!.lower);
  close(Math.max(...extensions.percentiles),target.scoreRange!.upper);
  assert.deepEqual(result(built,'target-b').scoreBasis,target.scoreBasis);
  assert.deepEqual(result(built,'target-b').rankRange,target.rankRange);
});

test('参考分按精确分子分母向外取整；相同显示区间不覆盖Pareto层级',()=>{
  const points:Point[]=[
    {id:'tier-two',name:'甲店',rating:5,repeat:500},
    {id:'tier-one',name:'乙店',rating:6,repeat:600},
    ...Array.from({length:8},(_,index)=>({id:`format-anchor-${index}`,name:`锚点${index}`,rating:4-index/10,repeat:400-index*10})),
  ];
  const built=build(points),tierOne=result(built,'tier-one'),tierTwo=result(built,'tier-two');
  assert.equal(formatScoreRange({...tierOne,scoreRange:{lower:92,upper:99},scoreBasis:{lowerNumerator:11,upperNumerator:12,denominator:12}}),'91–100');
  const displayedSame=new Map(built.results);
  displayedSame.set('tier-one',{...tierOne,scoreBasis:{lowerNumerator:331,upperNumerator:331,denominator:1000},scoreRange:{lower:33.1,upper:33.1}});
  displayedSame.set('tier-two',{...tierTwo,scoreBasis:{lowerNumerator:339,upperNumerator:339,denominator:1000},scoreRange:{lower:33.9,upper:33.9}});
  assert.equal(formatScoreRange(displayedSame.get('tier-one')),'33–34');
  assert.equal(formatScoreRange(displayedSame.get('tier-two')),'33–34');
  const ordered=[...built.shops].sort((a,b)=>compareRecommendations(a,b,displayedSame));
  assert.deepEqual(ordered.slice(0,2).map(shop=>shop.id),['tier-one','tier-two']);
  assert.deepEqual(ordered.slice(0,2).map(shop=>displayedSame.get(shop.id)!.tier),[1,2]);
});
