import assert from 'node:assert/strict';
import test from 'node:test';
import {buildAmapRatings,compareAmapRatings,getAmapRating,getRankingYears,amapRatingCountLabel} from '../src/lib/amap-rating.ts';
import {catalogue,ratingById} from '../src/lib/catalogue.ts';
import type {Shop} from '../src/lib/schema.ts';
import {fixtureShop} from './fixtures.ts';

const rating=(value:number,max:number|null,count:number|null,asOf:string,sourceIds:string[])=>({
  platform:'高德地图' as const,value,max,count,asOf,sourceIds,
});
const shop=(id:string,name=id,district:Shop['district']='福田')=>{
  const item=fixtureShop();
  item.id=item.slug=id;item.name=name;item.district=district;
  return item;
};

test('正式目录逐店使用资料日期前最新的高德原始餐厅分数，保留历史记录',()=>{
  assert.ok(catalogue.shops.length>=117);
  assert.equal(ratingById.size,catalogue.shops.length);
  const rebuilt=buildAmapRatings(catalogue.shops,catalogue.updatedAt);
  for(const item of catalogue.shops){
    const newest=[...item.ratings].filter(r=>r.asOf<=catalogue.updatedAt).sort((a,b)=>b.asOf.localeCompare(a.asOf))[0]??null;
    const selected=ratingById.get(item.id);
    assert.deepEqual(rebuilt.get(item.id),selected,item.id);
    if(!newest){assert.equal(selected,null,item.id);continue;}
    assert.ok(selected,item.id);
    assert.equal(selected.value,newest.value,item.id);
    assert.equal(selected.max,newest.max,item.id);
    assert.equal(selected.asOf,newest.asOf,item.id);
    const latest=item.ratings.filter(r=>r.asOf===newest.asOf);
    const counts=new Set(latest.map(r=>r.count));
    assert.equal(selected.count,counts.size===1 ? newest.count:null,item.id);
    assert.deepEqual(new Set(selected.sourceIds),new Set(latest.flatMap(r=>r.sourceIds)),item.id);
  }
});

test('只取asOf以前最新日期；未来记录忽略，最新日冲突返回null且不回退',()=>{
  const item=shop('dated');
  item.ratings=[
    rating(4.2,5,10,'2026-08-01',['old']),
    rating(4.8,null,20,'2026-10-01',['latest-a']),
    rating(5,null,30,'2026-11-01',['future']),
  ];
  assert.deepEqual(getAmapRating(item,'2026-10-02'),item.ratings[1]);
  item.ratings.push(rating(4.7,null,20,'2026-10-01',['latest-b']));
  assert.equal(getAmapRating(item,'2026-10-02'),null);
  item.ratings.at(-1)!.value=4.8;item.ratings.at(-1)!.max=5;
  assert.equal(getAmapRating(item,'2026-10-02'),null,'同日max冲突不能挑选或回退');
  assert.deepEqual(getAmapRating(item,'2026-09-01'),item.ratings[0]);
});

test('同日同value/max合并来源；count冲突置null，未知max及零评论原样保留',()=>{
  const item=shop('merged');
  item.repeatVisits=null;
  item.ratings=[
    rating(4.8,null,0,'2026-10-02',['a','shared']),
    rating(4.8,null,25,'2026-10-02',['shared','b']),
    rating(4.1,5,100,'2026-09-01',['old']),
  ];
  const conflicted=getAmapRating(item)!;
  assert.equal(amapRatingCountLabel(item,conflicted),'评价数口径不一致');
  assert.deepEqual({...conflicted,sourceIds:[]},rating(4.8,null,null,'2026-10-02',[]));
  assert.deepEqual(new Set(conflicted.sourceIds),new Set(['a','shared','b']));
  item.ratings[1].count=0;
  const merged=getAmapRating(item)!;
  assert.equal(amapRatingCountLabel(item,merged),'0 条评价');
  assert.deepEqual({...merged,sourceIds:[]},rating(4.8,null,0,'2026-10-02',[]));
  assert.deepEqual(new Set(merged.sourceIds),new Set(['a','shared','b']));
});

test('餐厅分数排序只看原始value；缺失最后，同分按地区店名ID稳定排列',()=>{
  const high=shop('high','高分店','南山');high.ratings=[rating(4.9,null,1,'2026-10-02',['r'])];
  const tieB=shop('tie-b','同分店','福田');tieB.ratings=[rating(4.8,5,9999,'2026-10-02',['r'])];
  const tieA=shop('tie-a','同分店','福田');tieA.ratings=[rating(4.8,null,null,'2026-10-02',['r'])];
  const missing=shop('missing','缺失店','罗湖');missing.ratings=[];
  const items=[missing,tieB,high,tieA],ratings=buildAmapRatings(items,'2026-10-02');
  assert.deepEqual([...items].sort((a,b)=>compareAmapRatings(a,b,ratings)).map(item=>item.id),['high','tie-a','tie-b','missing']);
  tieA.ratings[0].count=1000000;tieA.repeatVisits={count:999999,windowDays:180,approximate:false,asOf:'2026-10-02',sourceIds:['repeat'],definition:'不参与排序'};tieA.metrics={repeat:{value:0,sourceIds:['repeat'],method:'不参与',period:'测试'},stability:null,value:null};
  const changed=buildAmapRatings(items,'2026-10-02');
  assert.deepEqual([...items].sort((a,b)=>compareAmapRatings(a,b,changed)).map(item=>item.id),['high','tie-a','tie-b','missing']);
});

test('上榜年份只接受edition精确2025或2026，并去重升序',()=>{
  const item=shop('years');
  const base=item.rankings[0];
  item.rankings=[
    {...base,edition:'2026'},
    {...base,edition:'2025',scope:'另一范围'},
    {...base,edition:'2026',scope:'重复记录'},
    {...base,edition:'2026年页面观察',scope:'观察年不能冒充届次',annualCompositeScore:null},
    {...base,edition:'页面未标注届次（2026访问）',scope:'访问年不能冒充届次',annualCompositeScore:null},
    {...base,edition:'2024',scope:'其他年份',annualHeat:{value:100,year:2026,label:'全年热度值'},annualCompositeScore:null},
  ];
  assert.deepEqual(getRankingYears(item),['2025','2026']);
  item.rankings=item.rankings.filter(entry=>entry.edition!=='2025');
  assert.deepEqual(getRankingYears(item),['2026']);
  item.rankings=item.rankings.filter(entry=>entry.edition!=='2026');
  assert.deepEqual(getRankingYears(item),[]);
});
