import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {shops} from '../src/lib/catalogue.ts';
import {createCatalogIndex} from '../src/lib/catalog-index.ts';
import {searchCatalog} from '../src/lib/catalog-search.ts';
import {selectShops,type Filters} from '../src/lib/filtering.ts';
const empty:Filters={q:'',district:'',category:'',price:'',age:'',rating:'',repeat:'',sort:'recommended'};
test('精简搜索数据与原目录筛选排序一致，覆盖缺项、边界及组合',()=>{
  const index=createCatalogIndex(shops);
  const cases:Partial<Filters>[]=[...['recommended','default','price'].map(sort=>({sort})),
    ...[...new Set(shops.map(s=>s.district))].map(district=>({district})),
    ...['0-30','30-60','60-100','100-99999'].map(price=>({price})),
    {repeat:'verified'},{q:shops.at(-1)!.name},{q:shops[0].address.text},{q:'不存在的店名-zzzz'},
    {district:'南山',price:'60-100',sort:'price'},{repeat:'verified',sort:'recommended'}];
  for(const c of cases) {const f={...empty,...c};assert.deepEqual(searchCatalog(index,f).map(s=>s.id),selectShops(shops,f).map(s=>s.id),JSON.stringify(c));}
  assert.ok(Buffer.byteLength(JSON.stringify(index)) < Buffer.byteLength(JSON.stringify(shops))*0.3,'索引不携带完整证据和校验结构');
});

test('客户端目录 DTO 只包含当前界面搜索、筛选、排序与渲染所需字段',()=>{
  const index=createCatalogIndex(shops);
  const expected=['address','category','coordinates','district','eligible','id','name','order','price','repeat','search','slug'];
  for(const entry of index) assert.deepEqual(Object.keys(entry).sort(),expected,entry.id);
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

test('存储失败后显示固定警告，并可从页面任一导出按钮备份内存收藏',async()=>{
  type Listener=(event?:{target?:unknown})=>void;
  class FakeButton {
    dataset:Record<string,string>={}; disabled=true; hidden=false;
    private attrs=new Map<string,string>(); private listeners=new Map<string,Listener[]>();
    addEventListener(type:string,listener:Listener) {this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}
    click() {for(const listener of this.listeners.get('click')??[]) listener({target:this});}
    closest(selector:string) {return selector==='[data-favorite]' && this.dataset.favorite ? this:null;}
    getAttribute(name:string) {return this.attrs.get(name)??null;}
    setAttribute(name:string,value:string) {this.attrs.set(name,value);}
    replaceChildren() {}
  }
  const exportButtons=[new FakeButton(),new FakeButton()];
  const favoriteButton=new FakeButton();favoriteButton.dataset.favorite='shop-1';favoriteButton.setAttribute('aria-label','收藏测试店');
  const warning={hidden:true,textContent:'浏览器存储不可用，收藏只能留在本次页面。离开前请导出备份。'};
  const documentListeners=new Map<string,Listener>();
  const windowListeners=new Map<string,Listener>();
  const fakeStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  let downloaded:Blob|undefined;
  const fakeDocument={
    getElementById:(id:string)=>id==='favorite-known-ids' ? {textContent:'["shop-1"]'}:null,
    querySelectorAll:(selector:string)=>selector==='[data-export-favorites]' ? exportButtons
      :selector==='[data-storage-warning]' ? [warning]
      :selector==='[data-favorite]' ? [favoriteButton]
      :selector==='[data-export-favorites],[data-import-favorites]' ? exportButtons:[],
    querySelector:()=>null,
    addEventListener:(type:string,listener:Listener)=>documentListeners.set(type,listener),
    createElement:(tag:string)=>tag==='a' ? {href:'',download:'',click(){}}:{textContent:'',setAttribute(){}},
    createTextNode:(text:string)=>({text}),
  };
  const localStorageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const originals={document:globalThis.document,window:globalThis.window,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout,createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  try {
    Object.assign(globalThis,{document:fakeDocument,window:{addEventListener(type:string,listener:Listener){windowListeners.set(type,listener);},dispatchEvent(){},location:{href:'https://example.test/'}}});
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:fakeStorage});
    globalThis.setTimeout=((callback:()=>void)=>{callback();return 0;}) as typeof setTimeout;
    globalThis.clearTimeout=(()=>{}) as typeof clearTimeout;
    URL.createObjectURL=((blob:Blob)=>{downloaded=blob;return 'blob:test';}) as typeof URL.createObjectURL;
    URL.revokeObjectURL=(()=>{}) as typeof URL.revokeObjectURL;
    const source=readFileSync(new URL('../src/scripts/global.ts',import.meta.url),'utf8')
      .replace("import { FAVORITES_KEY,parseFavorites } from '../lib/favorites';",`const FAVORITES_KEY='favorites';const parseFavorites=(value,known)=>({ids:Array.isArray(value?.ids)?value.ids.filter(id=>known.has(id)):[],duplicates:0,removed:0});`);
    const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
    assert.equal(warning.hidden,false,'初始化读取失败应显示固定警告');
    documentListeners.get('click')?.({target:favoriteButton});
    assert.equal(warning.hidden,false);
    assert.match(warning.textContent,/本次页面.*导出/);
    exportButtons[1].click();
    assert.ok(downloaded,'第二个导出按钮应生成备份');
    assert.deepEqual(JSON.parse(await downloaded.text()).ids,['shop-1']);
    windowListeners.get('storage')?.({key:'favorites',storageArea:fakeStorage,newValue:'{'} as never);
    assert.equal(warning.hidden,true,'可访问的 storage 事件应清除存储不可用状态');
  } finally {
    Object.assign(globalThis,{document:originals.document,window:originals.window,setTimeout:originals.setTimeout,clearTimeout:originals.clearTimeout});
    if(localStorageDescriptor) Object.defineProperty(globalThis,'localStorage',localStorageDescriptor);
    else delete (globalThis as {localStorage?:Storage}).localStorage;
    URL.createObjectURL=originals.createObjectURL;URL.revokeObjectURL=originals.revokeObjectURL;
  }
});
