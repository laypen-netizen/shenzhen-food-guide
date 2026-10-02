import {test} from 'node:test';
import assert from 'node:assert/strict';
import {annualHeatValue,isAmapUrl,validateCatalogue} from '../src/lib/schema.ts';
import {createCatalogIndex} from '../src/lib/catalog-index.ts';
import {searchCatalog} from '../src/lib/catalog-search.ts';
import {selectShops,type Filters} from '../src/lib/filtering.ts';
import {fixtureCatalogue,fixtureShop} from './fixtures.ts';

const filters:Filters={q:'',district:'',category:'',price:'',age:'',rating:'',repeat:'',edition:'',sort:'recommended'};

test('高德短链只接受精确 a.a-map.link 域名',()=>{
  assert.equal(isAmapUrl('https://a.a-map.link/famfHI1n584'),true);
  for(const url of [
    'http://a.a-map.link/famfHI1n584',
    'https://a.a-map.link.attacker.example/famfHI1n584',
    'https://a-map.link/famfHI1n584',
    'https://evil-a.a-map.link.example/famfHI1n584',
  ]) assert.equal(isAmapUrl(url),false,url);
});

test('全年热度年份必须对应明确届次，页面观察不能冒充2026榜',()=>{
  const catalogue=fixtureCatalogue();
  catalogue.shops[0].rankings.push({
    name:'高德扫街榜 · 2026状元榜·必吃美食',edition:'2026年页面观察',rank:null,
    scope:'模拟观察范围',asOf:'2026-10-02',sourceIds:['ranking'],
    annualHeat:{value:97.2,year:2026,label:'全年热度值',rawDisplay:'97.2'},
  });
  assert.throws(()=>validateCatalogue(catalogue,{allowTestData:true,asOf:'2026-10-02'}),/全年热度值.*届次|明确.*届次/);
});

test('全年热度取最新观察，同日冲突不隐式选择任一值',()=>{
  const shop=fixtureShop();
  const heat=(value:number,asOf:string)=>({
    name:'高德扫街榜 · 2026状元榜·必吃美食',edition:'2026',rank:null,
    scope:'模拟范围',asOf,sourceIds:['ranking'],
    annualHeat:{value,year:2026 as const,label:'全年热度值' as const,rawDisplay:String(value)},
  });
  shop.rankings.push(heat(95.8,'2026-09-01'),heat(97.2,'2026-10-02'));
  assert.equal(annualHeatValue(shop,2026),97.2);
  shop.rankings.push(heat(97.1,'2026-10-02'));
  assert.equal(annualHeatValue(shop,2026),null);
});

test('edition 精确区分2026与页面观察，多年度同分店在DTO中仍只有一条',()=>{
  const explicit=fixtureShop();
  explicit.rankings.push({
    name:'高德扫街榜 · 2026状元榜·必吃美食',edition:'2026',rank:null,
    scope:'模拟明确榜单',asOf:'2026-10-02',sourceIds:['ranking'],
    annualHeat:{value:97.2,year:2026,label:'全年热度值',rawDisplay:'97.2'},
  });
  const observed=fixtureShop();
  observed.id=observed.slug='fictional-observed';
  observed.name='虚构观察门店';
  observed.rankings=[{
    name:'高德扫街榜 · 2026状元榜·必吃美食',edition:'2026年页面观察',rank:null,
    scope:'模拟观察页面',asOf:'2026-10-02',sourceIds:['ranking'],
  }];
  const shops=[explicit,observed];
  const index=createCatalogIndex(shops);
  for(const edition of ['2026','2025','undated']) {
    const current={...filters,edition};
    assert.deepEqual(searchCatalog(index,current).map(s=>s.id),selectShops(shops,current).map(s=>s.id));
  }
  assert.deepEqual(selectShops(shops,{...filters,edition:'2026'}).map(s=>s.id),[explicit.id]);
  assert.deepEqual(selectShops(shops,{...filters,edition:'undated'}).map(s=>s.id),[observed.id]);
  assert.equal(index.filter(entry=>entry.id===explicit.id).length,1);
  assert.ok(index.find(entry=>entry.id===explicit.id)?.editions.includes('2025'));
  assert.ok(index.find(entry=>entry.id===explicit.id)?.editions.includes('2026'));
});
