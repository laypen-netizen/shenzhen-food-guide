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
