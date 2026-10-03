import { z } from 'zod';
import { amapPoiId, normalizedStoreText } from './store-identity.ts';

export const districts = ['福田','罗湖','南山','盐田','宝安','龙岗','龙华','坪山','光明','大鹏新区'] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10) === value;
}, '日期不存在');
const httpsUrl = z.url().refine(value => new URL(value).protocol === 'https:', '必须使用 HTTPS');
export const isAmapUrl = (value: string) => {
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'amap.com' || u.hostname.endsWith('.amap.com') || u.hostname === 'a.a-map.link'); }
  catch { return false; }
};
const refs = z.array(z.string().min(1)).min(1);
const fact = z.object({ text: z.string().min(1), sourceIds: refs }).strict();
export const sourceSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), url: httpsUrl.refine(isAmapUrl, '只接受高德官方来源'),
  kind: z.enum(['ranking','poi','history','rating','repeat','value']),
  publishedAt: date.nullable(), accessedAt: date,
  statement: z.string().min(1),
  ratingChannel: z.enum(['amap-app-displayed-rating','amap-pc-poi-rating']).optional(),
  repeatChannel: z.literal('amap-app-repeat-visitors').optional(),
  capture: z.object({
    method: z.enum(['official-app','user-screenshot']),
    view: z.string().min(1),
    localEvidence: z.array(z.string().regex(/^research\/evidence\/[a-zA-Z0-9._-]+\.(png|jpe?g)$/)),
  }).strict().optional(),
}).strict();
const metric = z.object({
  value: z.number().min(0).max(100), sourceIds: refs,
  method: z.string().min(1), period: z.string().min(1),
}).strict();
const annualCompositeScore = z.object({
  value: z.number().min(0).max(100),
  year: z.number().int().min(2000).max(2100).nullable(),
  label: z.literal('全年综合分'),
  rawDisplay: z.string().trim().min(1).optional(),
}).strict();
const photoPath = z.string().regex(/^\/photos\/[a-zA-Z0-9._/-]+\.(webp|png|jpe?g)$/).refine(p => !p.includes('..'));
const photoCaptureRef = z.string().regex(/^research\/evidence\/[a-zA-Z0-9._/-]+\.(png|jpe?g)$/).refine(p => !p.includes('..'));
export const storefrontPhotoSchema = z.object({
  kind: z.literal('storefront'), path: photoPath,
  view: z.enum(['storefront','sign-detail']).optional(),
  width: z.number().int().positive(), height: z.number().int().positive(),
  thumbnail: z.object({path:photoPath,width:z.number().int().positive(),height:z.number().int().positive()}).strict(),
  alt: z.string().min(1), sourceLabel: z.string().min(1), sourceUrl: httpsUrl,
  imageUrl: httpsUrl.nullable(), captureRef: photoCaptureRef.optional(),
  author: z.string().min(1).nullable(), permission: z.string().min(1).nullable(), permissionVerified: z.boolean(),
  collectedAt: date, photographedAt: date.nullable(), reviewNote: z.string().min(1),
}).strict().superRefine((photo,ctx)=>{
  if(photo.permissionVerified && !photo.permission) ctx.addIssue({code:'custom',path:['permission'],message:'已核验使用许可必须有具体依据'});
  if(!photo.imageUrl && !photo.captureRef) ctx.addIssue({code:'custom',path:['captureRef'],message:'没有原图地址时必须保留本地截图证据'});
  if(!photo.imageUrl && !isAmapUrl(photo.sourceUrl)) ctx.addIssue({code:'custom',path:['sourceUrl'],message:'截图裁图必须链接到高德官方来源'});
});
export const shopSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1), aliases: z.array(z.string()), district: z.enum(districts),
  street: z.string(), address: fact, category: z.string().min(1), cuisine: z.string(),
  summary: fact, dishes: z.array(fact), reasons: z.array(fact).min(2).max(4),
  cautions: z.array(fact), scenes: z.array(z.string()),
  history: z.object({
    scope: z.literal('specific-store'), latestOpeningDate: date,
    precision: z.enum(['day','year','conservative-bound']),
    continuation: z.enum(['verified','uncertain']), description: z.string().min(1),
    sourceIds: refs, brandDescription: z.string().nullable(),
  }).strict().nullable().default(null),
  operating: z.object({ status: z.enum(['reported-open','unknown','closed']), asOf: date, sourceIds: refs, note: z.string().min(1) }).strict(),
  price: z.object({ cny: z.number().positive(), asOf: date, sourceIds: refs }).strict().nullable(),
  hours: fact.nullable(),
  coordinates: z.object({ lon: z.number().min(113.7).max(114.7), lat: z.number().min(22.3).max(22.95), system: z.literal('GCJ-02'), sourceIds: refs }).strict().nullable(),
  ratings: z.array(z.object({
    platform: z.literal('高德地图'), value: z.number().min(0), max: z.number().positive().nullable(),
    count: z.number().int().nonnegative().nullable(), asOf: date, sourceIds: refs,
  }).strict().refine(r => r.max === null || r.value <= r.max, '评分超出量表')),
  rankings: z.array(z.object({
    name: z.string().min(1).refine(s => s.includes('扫街榜') || s.includes('回头客榜'), '必须注明扫街榜/回头客榜'),
    edition: z.string().min(1), rank: z.number().int().positive().nullable(),
    scope: z.string().min(1), asOf: date, sourceIds: refs,
    annualCompositeScore: annualCompositeScore.nullable().optional(),
    annualHeat: z.object({value:z.number().nonnegative(),year:z.number().int().min(2000).max(2100),label:z.literal('全年热度值'),rawDisplay:z.string().trim().min(1).optional()}).strict().optional(),
  }).strict().superRefine((ranking,ctx) => {
    if(ranking.annualCompositeScore?.year != null && !`${ranking.name} ${ranking.edition}`.includes(String(ranking.annualCompositeScore.year))) {
      ctx.addIssue({code:'custom',path:['annualCompositeScore','year'],message:'年度综合分年份必须出现在榜单名称或届次中'});
    }
    if(ranking.annualHeat && ranking.edition!==String(ranking.annualHeat.year)) ctx.addIssue({code:'custom',path:['annualHeat','year'],message:'全年热度值年份必须与明确榜单届次对应，观察日期不能代替届次'});
  })).min(1),
  metrics: z.object({ repeat: metric.nullable(), stability: metric.nullable(), value: metric.nullable() }).strict(),
  repeatVisits: z.object({
    count: z.number().int().nonnegative(), windowDays: z.number().int().positive(),
    rawDisplay: z.string().trim().min(1).optional(),
    approximate: z.boolean().optional().default(false),
    asOf: date, sourceIds: refs, definition: z.string().min(1),
  }).strict().superRefine((value,ctx) => {
    if (value.approximate && !value.rawDisplay) ctx.addIssue({code:'custom',path:['rawDisplay'],message:'近似回头客人数必须保留页面显示原文'});
  }).nullable().default(null),
  photos: z.array(storefrontPhotoSchema),
  checkedAt: date, testOnly: z.boolean().optional(),
}).strict();
export const catalogueSchema = z.object({
  version: z.literal(1), updatedAt: date, policy: z.literal('amap-only'), note: z.string(),
  sources: z.array(sourceSchema), shops: z.array(shopSchema),
  pending: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1), district: z.enum(districts).nullable(),
    missing: z.array(z.string().min(1)).min(1), sourceIds: refs,
    facts: z.array(fact).optional(), observedAt: date.optional(),
  }).strict()),
}).strict();
export type Shop = z.infer<typeof shopSchema>;
export type Catalogue = z.infer<typeof catalogueSchema>;

export function repeatVisitsDisplay(value: NonNullable<Shop['repeatVisits']>) {
  if (!value.rawDisplay) return value.count.toLocaleString('zh-CN');
  if (!value.approximate || /^[约≈~]/.test(value.rawDisplay)) return value.rawDisplay;
  return `约${value.rawDisplay}`;
}

export function annualCompositeRanking(shop: Shop, year:number|null=2025) {
  const candidates=[...shop.rankings]
    .filter(ranking=>ranking.annualCompositeScore?.year===year)
    .sort((a,b)=>b.asOf.localeCompare(a.asOf) || a.scope.localeCompare(b.scope,'zh-CN'));
  const latestAsOf=candidates[0]?.asOf;
  if(!latestAsOf) return null;
  const latest=candidates.filter(ranking=>ranking.asOf===latestAsOf);
  if(new Set(latest.map(ranking=>ranking.annualCompositeScore!.value)).size!==1) return null;
  return latest[0] ?? null;
}

export function annualHeatValue(shop:Shop,year:number):number|null {
  const list=shop.rankings.filter(r=>r.annualHeat?.year===year).sort((a,b)=>b.asOf.localeCompare(a.asOf));
  const latest=list.filter(r=>r.asOf===list[0]?.asOf);
  return latest.length && new Set(latest.map(r=>r.annualHeat!.value)).size===1 ? latest[0].annualHeat!.value:null;
}

// Never infer an edition from the access date or another linked ranking.
export function latestAnnualCompositeRanking(shop: Shop) {
  const years=[...new Set(shop.rankings.flatMap(r=>r.annualCompositeScore?.year != null ? [r.annualCompositeScore.year]:[]))].sort((a,b)=>b-a);
  for(const year of years) {const ranking=annualCompositeRanking(shop,year);if(ranking) return ranking;}
  return annualCompositeRanking(shop,null);
}

export function ageAt(shop: Shop, asOf: string) {
  if (!shop.history || shop.history.continuation !== 'verified') return null;
  const opening = shop.history.latestOpeningDate;
  if (opening > asOf) return null;
  return Number(asOf.slice(0,4)) - Number(opening.slice(0,4)) - (asOf.slice(5) < opening.slice(5) ? 1 : 0);
}
export function validateCatalogue(input: unknown, options: { asOf?: string; allowTestData?: boolean } = {}): Catalogue {
  const data = catalogueSchema.parse(input);
  const asOf = options.asOf ?? new Intl.DateTimeFormat('en-CA',{ timeZone:'Asia/Shanghai', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  const errors: string[] = [];
  const sourceMap = new Map(data.sources.map(s => [s.id,s]));
  if (sourceMap.size !== data.sources.length) errors.push('来源 id 重复');
  for (const key of ['id','slug'] as const) if (new Set(data.shops.map(s => s[key])).size !== data.shops.length) errors.push(`门店 ${key} 重复`);
  if (new Set(data.pending.map(s => s.id)).size !== data.pending.length) errors.push('待核验 id 重复');
  if (data.pending.some(p => data.shops.some(s => s.id === p.id))) errors.push('正式与待核验门店不能重叠');
  function checkRefs(value: unknown, prefix: string) {
    if (!value || typeof value !== 'object') return;
    if ('sourceIds' in value) for (const id of (value as {sourceIds:string[]}).sourceIds) if (!sourceMap.has(id)) errors.push(`${prefix} 引用了不存在的来源 ${id}`);
    for (const [key,item] of Object.entries(value)) {
      if (['asOf','checkedAt','accessedAt','publishedAt','collectedAt','photographedAt'].includes(key) && typeof item === 'string' && item > asOf) errors.push(`${prefix}.${key} 不能在未来`);
      checkRefs(item, `${prefix}.${key}`);
    }
  }
  checkRefs(data,'catalogue');
  if (data.updatedAt > asOf) errors.push('内容更新日期不能在未来');
  const poiOwners=new Map<string,string>();
  const addressOwners=new Map<string,string>();
  for (const s of data.shops) {
    const identity=`${normalizedStoreText(s.name)}|${normalizedStoreText(s.address.text)}`;
    const sameAddress=addressOwners.get(identity);
    if(sameAddress) errors.push(`重复分店：${s.id} 与 ${sameAddress} 名称及地址相同`);
    addressOwners.set(identity,s.id);
    const poiIds=new Set(s.address.sourceIds.flatMap(id=>{const source=sourceMap.get(id);const poiId=source?.kind==='poi' ? amapPoiId(source.url):null;return poiId ? [poiId]:[];}));
    for(const poiId of poiIds) {
      const owner=poiOwners.get(poiId);
      if(owner && owner!==s.id) errors.push(`重复高德 POI：${poiId} 同时属于 ${owner} 与 ${s.id}`);
      poiOwners.set(poiId,s.id);
    }
    if (s.testOnly && !options.allowTestData) errors.push(`${s.id} 测试样例不能发布`);
    if (s.history) {
      if (s.history.latestOpeningDate > s.checkedAt) errors.push(`${s.id} 开业日期不能晚于核验日`);
      if (s.history.precision === 'year' && !s.history.latestOpeningDate.endsWith('-12-31')) errors.push(`${s.id} 仅年份必须按年末保守判定`);
      if (!s.history.sourceIds.some(id => sourceMap.get(id)?.kind === 'history')) errors.push(`${s.id} 已填写的店龄缺具体门店历史依据`);
    }
    if (s.operating.status !== 'reported-open') errors.push(`${s.id} 缺营业依据`);
    for (const [field, ids] of [['address',s.address.sourceIds],['operating',s.operating.sourceIds]] as const) {
      if (!ids.some(id=>sourceMap.get(id)?.kind==='poi')) errors.push(`${s.id} ${field} 缺具体门店详情依据`);
    }
    const days = (Date.parse(s.checkedAt) - Date.parse(s.operating.asOf)) / 86400000;
    if (days < 0 || days > 180) errors.push(`${s.id} 营业依据须在核验前180天内，超期移入待核验`);
    for (const ranking of s.rankings) if (!ranking.sourceIds.some(id => sourceMap.get(id)?.kind === 'ranking')) errors.push(`${s.id} 普通 POI 不能代替上榜依据`);
    for (const r of s.ratings) if (!r.sourceIds.some(id => ['rating','poi'].includes(sourceMap.get(id)?.kind ?? ''))) errors.push(`${s.id} 缺评分依据`);
    if (s.repeatVisits && !s.repeatVisits.sourceIds.some(id => sourceMap.get(id)?.kind === 'repeat')) errors.push(`${s.id} 回头客人数缺高德回头客依据`);
    for (const [key,metric] of Object.entries(s.metrics)) if (metric && !metric.sourceIds.some(id => sourceMap.get(id)?.kind === ({repeat:'repeat',stability:'rating',value:'value'} as Record<string,string>)[key])) errors.push(`${s.id} ${key} 缺对应指标证据`);
    if (s.metrics.stability) {
      const snapshots=[...s.ratings].sort((a,b)=>a.asOf.localeCompare(b.asOf));
      const days=snapshots.length ? (Date.parse(snapshots.at(-1)!.asOf)-Date.parse(snapshots[0].asOf))/86400000:0;
      if(snapshots.some(r=>r.max===null) || new Set(snapshots.map(r=>r.asOf)).size<3 || new Set(snapshots.map(r=>r.max)).size!==1 || days<180) errors.push(`${s.id} 稳定性至少需要三个同量表快照、跨度180天`);
      else {
        const normalized=snapshots.map(r=>r.value/r.max!*100);
        const expected=100-Math.max(...normalized)+Math.min(...normalized);
        if(Math.abs(s.metrics.stability.value-expected)>0.01) errors.push(`${s.id} 稳定性须按公开的评分极差公式计算`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return data;
}
