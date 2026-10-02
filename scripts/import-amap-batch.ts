import { readFile,rename,unlink,writeFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { shopSchema,sourceSchema,validateCatalogue } from '../src/lib/schema.ts';

type Batch = {
  sources?: unknown[];
  shops?: unknown[];
  pending?: unknown[];
  updatedAt?: string;
  note?: string;
};

function usage(): never {
  throw new Error('用法：node scripts/import-amap-batch.ts <batch.json> [--catalogue src/data/catalogue.json] [--as-of YYYY-MM-DD] [--write]\n默认仅校验和预览；只有 --write 才写入本地 catalogue。');
}

let batchPath='';
let cataloguePath='src/data/catalogue.json';
let asOf:string|undefined;
let shouldWrite=false;
for(let i=2;i<process.argv.length;i++) {
  const arg=process.argv[i];
  if(arg==='--write') shouldWrite=true;
  else if(arg==='--catalogue') { cataloguePath=process.argv[++i] || usage(); }
  else if(arg==='--as-of') { asOf=process.argv[++i] || usage(); }
  else if(arg==='--help' || arg==='-h') usage();
  else if(arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
  else if(!batchPath) batchPath=arg;
  else throw new Error(`多余参数：${arg}`);
}
if(!batchPath) usage();

const target=resolve(cataloguePath);
const input=resolve(batchPath);
if(target===input) throw new Error('批次文件不能与 catalogue 使用同一路径');

function parseJson(raw:string,path:string):unknown {
  try { return JSON.parse(raw); }
  catch { throw new Error(`JSON 无法解析：${path}`); }
}
function canonical(value:unknown):string {
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function recordId(value:unknown,label:string,index:number,conflicts:string[]) {
  const id=value && typeof value==='object' ? (value as {id?:unknown}).id:undefined;
  if(typeof id!=='string' || !id) { conflicts.push(`${label}[${index}] 缺少有效 id`);return null; }
  return id;
}

const originalRaw=await readFile(target,'utf8');
const current=validateCatalogue(parseJson(originalRaw,target),{asOf});
const rawBatch=parseJson(await readFile(input,'utf8'),input);
if(!rawBatch || typeof rawBatch!=='object' || Array.isArray(rawBatch)) throw new Error('批次根节点必须是对象');
const batch=rawBatch as Batch;
const allowed=new Set(['sources','shops','pending','updatedAt','note']);
const unknownKeys=Object.keys(batch).filter(key=>!allowed.has(key));
if(unknownKeys.length) throw new Error(`批次包含未知字段：${unknownKeys.join('、')}`);
for(const key of ['sources','shops','pending'] as const) if(batch[key]!==undefined && !Array.isArray(batch[key])) throw new Error(`批次 ${key} 必须是数组`);
if(!(['sources','shops','pending'] as const).some(key=>(batch[key]?.length??0)>0) && batch.note===undefined && batch.updatedAt===undefined) throw new Error('批次没有可导入内容');
if(batch.note!==undefined && (typeof batch.note!=='string' || !batch.note.trim())) throw new Error('批次 note 必须是非空字符串');
if(batch.updatedAt!==undefined && (typeof batch.updatedAt!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(batch.updatedAt))) throw new Error('批次 updatedAt 必须是 YYYY-MM-DD');
const batchSources=(batch.sources??[]).map((item,index)=>{
  try { return sourceSchema.parse(item); }
  catch(error) { throw new Error(`sources[${index}] 校验失败：${error instanceof Error ? error.message:String(error)}`); }
});
const batchShops=(batch.shops??[]).map((item,index)=>{
  try { return shopSchema.parse(item); }
  catch(error) { throw new Error(`shops[${index}] 校验失败：${error instanceof Error ? error.message:String(error)}`); }
});

const conflicts:string[]=[];
for(const [index,shop] of batchShops.entries()) if(shop.testOnly) conflicts.push(`shops[${index}] 带有 testOnly，禁止导入测试样例`);

const sources=[...current.sources] as unknown[];
const sourceById=new Map(current.sources.map(item=>[item.id,item as unknown]));
let addedSources=0,reusedSources=0;
for(const [index,item] of batchSources.entries()) {
  const id=recordId(item,'sources',index,conflicts);if(!id) continue;
  const existing=sourceById.get(id);
  if(existing) {
    if(canonical(existing)===canonical(item)) reusedSources++;
    else conflicts.push(`来源 id 冲突：${id}`);
  } else { sourceById.set(id,item);sources.push(item);addedSources++; }
}

const shops=[...current.shops] as unknown[];
const shopById=new Map(current.shops.map(item=>[item.id,item as unknown]));
const slugToId=new Map(current.shops.map(item=>[item.slug,item.id]));
const existingPendingById=new Map(current.pending.map(item=>[item.id,item as unknown]));
const upgradedIds=new Set<string>();
let addedShops=0,reusedShops=0;
for(const [index,item] of batchShops.entries()) {
  const id=recordId(item,'shops',index,conflicts);if(!id) continue;
  const slug=item && typeof item==='object' ? (item as {slug?:unknown}).slug:undefined;
  if(typeof slug!=='string' || !slug) { conflicts.push(`shops[${index}] 缺少有效 slug`);continue; }
  const existing=shopById.get(id);
  if(existing) {
    if(canonical(existing)===canonical(item)) reusedShops++;
    else conflicts.push(`正式门店 id 冲突：${id}`);
    continue;
  }
  const slugOwner=slugToId.get(slug);
  if(slugOwner && slugOwner!==id) { conflicts.push(`正式门店 slug 冲突：${slug} 已属于 ${slugOwner}，批次门店为 ${id}`);continue; }
  shopById.set(id,item);slugToId.set(slug,id);shops.push(item);addedShops++;
  if(existingPendingById.has(id)) upgradedIds.add(id);
}

const batchShopIds=new Set(batchShops.map(item=>item.id));
const pending=current.pending.filter(item=>!upgradedIds.has(item.id)) as unknown[];
const pendingById=new Map(pending.map(item=>[(item as {id:string}).id,item]));
let addedPending=0,reusedPending=0;
for(const [index,item] of (batch.pending??[]).entries()) {
  const id=recordId(item,'pending',index,conflicts);if(!id) continue;
  if(batchShopIds.has(id)) { conflicts.push(`批次同时把 ${id} 放入 shops 与 pending`);continue; }
  if(shopById.has(id)) { conflicts.push(`待核验 id 与正式门店冲突：${id}`);continue; }
  const existing=pendingById.get(id);
  if(existing) {
    if(canonical(existing)===canonical(item)) reusedPending++;
    else conflicts.push(`待核验 id 冲突：${id}`);
  } else { pendingById.set(id,item);pending.push(item);addedPending++; }
}

if(conflicts.length) throw new Error(`批次存在 ${conflicts.length} 个冲突，未写入：\n- ${conflicts.join('\n- ')}`);

const dates=[current.updatedAt,batch.updatedAt,...sources.map(item=>(item as {accessedAt?:unknown}).accessedAt),...shops.map(item=>(item as {checkedAt?:unknown}).checkedAt),...pending.map(item=>(item as {observedAt?:unknown}).observedAt)].filter((value):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
const mergedInput={...current,updatedAt:[...dates].sort().at(-1)!,note:batch.note??current.note,sources,shops,pending};
const merged=validateCatalogue(mergedInput,{asOf});
if(merged.shops.some(shop=>shop.testOnly)) throw new Error('禁止将测试样例写入正式 catalogue');

const changed=canonical(current)!==canonical(merged);
const summary=[
  `来源 +${addedSources} / 复用 ${reusedSources}`,
  `正式门店 +${addedShops} / 复用 ${reusedShops}`,
  `pending +${addedPending} / 复用 ${reusedPending} / 升级 ${upgradedIds.size}`,
];
console.log(`批次校验通过：${summary.join('；')}。`);
console.log(`合并后：${merged.shops.length} 家正式门店，${merged.pending.length} 家待核验，${merged.sources.length} 条来源。`);
if(!changed) console.log('幂等结果：批次内容已存在，没有文件变化。');
if((addedShops || addedPending || upgradedIds.size) && batch.note===undefined) console.log('提示：批次改变了门店数量但未提供 note；现有说明原样保留，请确认仍准确。');

if(!shouldWrite) {
  console.log(`DRY RUN：未写入 ${target}。确认预览后添加 --write。`);
} else if(!changed) {
  console.log(`无需写入：${target} 已是目标内容。`);
} else {
  const temp=resolve(dirname(target),`.${process.pid}-${Date.now()}.catalogue.tmp`);
  await writeFile(temp,`${JSON.stringify(merged,null,2)}\n`,{flag:'wx'});
  try {
    if(await readFile(target,'utf8')!==originalRaw) throw new Error('catalogue 在导入期间已被其他任务修改；为避免覆盖，已取消写入，请重新运行');
    await rename(temp,target);
  } catch(error) {
    await unlink(temp).catch(()=>{});
    throw error;
  }
  validateCatalogue(parseJson(await readFile(target,'utf8'),target),{asOf});
  console.log(`已写入并回读校验：${target}`);
}
