import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shops} from '../src/lib/catalogue.ts';
import {createCatalogIndex} from '../src/lib/catalog-index.ts';
import {searchCatalog} from '../src/lib/catalog-search.ts';
import {selectShops,type Filters} from '../src/lib/filtering.ts';
const empty:Filters={q:'',district:'',category:'',price:'',age:'',rating:'',repeat:'',sort:'recommended'};
test('精简搜索数据与原目录筛选排序一致，覆盖缺项、边界及组合',()=>{
  const index=createCatalogIndex(shops);
  const cases:Partial<Filters>[]=[...['recommended','default','annual-2025','rating','composite','age','price','heat-2026'].map(sort=>({sort})),
    ...[...new Set(shops.map(s=>s.district))].map(district=>({district})),
    ...['0-30','30-60','60-100','100-99999'].map(price=>({price})),
    ...['unknown','0-10','10-20','20-30','30-999'].map(age=>({age})),
    {repeat:'verified'},{edition:'2026'},{edition:'2025'},{edition:'undated'},{rating:'4.5'},{q:shops.at(-1)!.name},{q:shops[0].address.text},{q:'不存在的店名-zzzz'},
    {district:'南山',price:'60-100',sort:'rating'},{repeat:'verified',sort:'annual-2025'}];
  for(const c of cases) {const f={...empty,...c};assert.deepEqual(searchCatalog(index,f).map(s=>s.id),selectShops(shops,f).map(s=>s.id),JSON.stringify(c));}
  assert.ok(Buffer.byteLength(JSON.stringify(index)) < Buffer.byteLength(JSON.stringify(shops))*0.3,'索引不携带完整证据和校验结构');
});

test('搜索将空格分隔的关键词按 AND 匹配',()=>{
  const index=createCatalogIndex(shops);
  const nanshanSeafood=[
    'amap-b0ffj986qk',
    'amap-b0g0gyhxrw',
    'amap-b0gkvr5h4l',
    'amap-b0h0bu0c0q',
  ];
  const nanshanHotpot=[
    'amap-b0k2ycm5ct',
    'wenheji-nanshan',
    'amap-b0gkvr5h4l',
    'amap-b0h0bu0c0q',
  ];
  assert.deepEqual(searchCatalog(index,{...empty,q:'南山 海鲜'}).map(s=>s.id),nanshanSeafood);
  assert.deepEqual(selectShops(shops,{...empty,q:'南山 海鲜'}).map(s=>s.id),nanshanSeafood);
  assert.deepEqual(searchCatalog(index,{...empty,q:'火锅 南山'}).map(s=>s.id),nanshanHotpot);
  assert.deepEqual(selectShops(shops,{...empty,q:'火锅 南山'}).map(s=>s.id),nanshanHotpot);
});

test('搜索统一 NFKC、大小写和连续空白，但不臆测拆词',()=>{
  const index=createCatalogIndex(shops);
  const nanshanSeafood=['amap-b0ffj986qk','amap-b0g0gyhxrw','amap-b0gkvr5h4l','amap-b0h0bu0c0q'];
  for(const q of ['南山　　海鲜','  南山   海鲜  ']) {
    assert.deepEqual(searchCatalog(index,{...empty,q}).map(s=>s.id),nanshanSeafood);
    assert.deepEqual(selectShops(shops,{...empty,q}).map(s=>s.id),nanshanSeafood);
  }
  for(const q of ['AVANT','ＡＶＡＮＴ']) {
    assert.deepEqual(searchCatalog(index,{...empty,q}).map(s=>s.id),['amap-b0g2lzl1si']);
    assert.deepEqual(selectShops(shops,{...empty,q}).map(s=>s.id),['amap-b0g2lzl1si']);
  }
  for(const q of ['RAIL IN','rail in','ＲＡＩＬ ＩＮ']) {
    assert.deepEqual(searchCatalog(index,{...empty,q}).map(s=>s.id),['amap-b0ja15pdav']);
    assert.deepEqual(selectShops(shops,{...empty,q}).map(s=>s.id),['amap-b0ja15pdav']);
  }
  assert.deepEqual(searchCatalog(index,{...empty,q:'南山海鲜'}).map(s=>s.id),[]);
  assert.deepEqual(selectShops(shops,{...empty,q:'南山海鲜'}).map(s=>s.id),[]);
});

test('搜索文本显式包含地区和品类字段',()=>{
  const isolated={...shops[0],district:'南山' as const,category:'海鲜实验类'};
  const query={...empty,q:'南山 海鲜实验类'};
  assert.deepEqual(searchCatalog(createCatalogIndex([isolated]),query).map(s=>s.id),[isolated.id]);
  assert.deepEqual(selectShops([isolated],query).map(s=>s.id),[isolated.id]);
});
