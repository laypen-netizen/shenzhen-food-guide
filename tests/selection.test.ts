import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogue} from '../src/lib/catalogue.ts';
import {compareSelection,editorialSelections,selectionFor,validateSelections} from '../src/lib/selection.ts';
import type {Shop} from '../src/lib/schema.ts';

const clone=<T>(value:T):T=>structuredClone(value);
const shop=(id:string)=>clone(catalogue.shops.find(item=>item.id===id)!);

test('三家编辑精选只形成前置分组，组内仍按地区和店名排序',()=>{
  const selected=['ouji-baoli','chaoxiangyuan-longhua','laosanyang-nanshan'].map(shop).sort(compareSelection);
  assert.deepEqual(selected.map(item=>item.id),['chaoxiangyuan-longhua','laosanyang-nanshan','ouji-baoli']);
  const unselected=shop('fanlou-huaqiangbei');
  assert.ok(compareSelection(selected[0],unselected)<0);
  assert.equal(editorialSelections.length,3);
});

test('资料日期或原始指标改变后，旧编辑理由自动失效',()=>{
  const changedDate=shop('chaoxiangyuan-longhua');
  changedDate.checkedAt='2026-10-03';
  assert.equal(selectionFor(changedDate),null);
  const changedMetric=shop('laosanyang-nanshan');
  changedMetric.repeatVisits!.count=9487;
  assert.equal(selectionFor(changedMetric),null);
});

test('未入选只表示没有当前编辑快照，不产生低分或负面排序',()=>{
  const unselected=shop('fanlou-huaqiangbei');
  assert.equal(selectionFor(unselected),null);
  const another=shop('bainianguolin-baoan');
  assert.equal(Math.sign(compareSelection(unselected,another)),Math.sign(unselected.district.localeCompare(another.district,'zh-CN') || unselected.name.localeCompare(another.name,'zh-CN')));
});

test('编辑精选引用必须存在并被对应门店事实使用',()=>{
  assert.doesNotThrow(()=>validateSelections(catalogue.shops,catalogue.sources));
  const missing=catalogue.sources.filter(source=>source.id!=='repeat-ouji-baoli');
  assert.throws(()=>validateSelections(catalogue.shops,missing),/编辑精选来源不存在：ouji-baoli/);
  const shops=clone(catalogue.shops) as Shop[];
  const selected=shops.find(item=>item.id==='chaoxiangyuan-longhua')!;
  const strip=(value:unknown):void=>{
    if(Array.isArray(value)) { for(const item of value) strip(item);return; }
    if(!value || typeof value!=='object') return;
    const object=value as Record<string,unknown>;
    if(Array.isArray(object.sourceIds)) object.sourceIds=object.sourceIds.filter(id=>id!=='poi-chaoxiangyuan-longhua');
    for(const item of Object.values(object)) strip(item);
  };
  strip(selected);
  assert.throws(()=>validateSelections(shops,catalogue.sources),/编辑精选来源未被门店事实引用：chaoxiangyuan-longhua/);
});

test('默认顺序保留编辑优选前组，其余按2025原榜年度分降序',()=>{
  const selected=shop('chaoxiangyuan-longhua');
  const high=shop('fanlou-huaqiangbei');
  const low=shop('bainianguolin-baoan');
  const missing=shop('xinfashao-fenghuang');
  high.rankings[0]={...high.rankings[0],name:'高德扫街榜 · 2025测试榜',edition:'2025',annualCompositeScore:{value:4.81,year:2025,label:'全年综合分'}};
  low.rankings[0]={...low.rankings[0],name:'高德扫街榜 · 2025测试榜',edition:'2025',annualCompositeScore:{value:4.64,year:2025,label:'全年综合分'}};
  assert.deepEqual([missing,low,selected,high].sort(compareSelection).map(item=>item.id),[selected.id,high.id,low.id,missing.id]);
  low.rankings[0].annualCompositeScore!.value=4.81;
  low.name='同分甲';high.name='同分乙';
  assert.deepEqual([high,low].sort(compareSelection).map(item=>item.id),[low.id,high.id]);
});
