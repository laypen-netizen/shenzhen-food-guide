import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { districts, shopSchema, sourceSchema, validateCatalogue } from '../src/lib/schema.ts';

type RankingEvidence = {
  sourceId: string;
  sourceUrl: string;
  group: string;
  scope: string;
  position: number;
  metricLabel: string | null;
  annualCompositeScore: number | null;
  highConsumptionAudience: number | null;
  tags: string[];
  recommendation: string | null;
};
type Candidate = {
  poiId: string;
  name: string;
  names?: string[];
  officialPlaceUrl: string;
  existingShopId: string | null;
  inclusion?: string;
  rankingEvidence?: RankingEvidence[];
  appearances?: RankingEvidence[];
};
type Pool = { generatedAt: string; candidates: Candidate[] };
type RawPoi = {
  capturedAt: string;
  sourceUrl: string;
  response: {
    code: number;
    message?: string;
    data: null | {
      base: Record<string, unknown>;
      score?: Record<string, unknown> | null;
      tags?: Record<string, unknown> | null;
      geo?: Record<string, unknown> | null;
      photo?: unknown;
    };
  };
};

let poolPath = 'research/amap-ranking-2025-candidates.json';
let rawDir = 'research/raw/amap-poi-2026';
let cataloguePath = 'src/data/catalogue.json';
let outputPath: string | null = null;
let targetTotal: number | null = null;
let asOf: string | undefined;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--pool') poolPath = process.argv[++i] || fail('--pool 缺少路径');
  else if (arg === '--raw-dir') rawDir = process.argv[++i] || fail('--raw-dir 缺少路径');
  else if (arg === '--catalogue') cataloguePath = process.argv[++i] || fail('--catalogue 缺少路径');
  else if (arg === '--output') outputPath = process.argv[++i] || fail('--output 缺少路径');
  else if (arg === '--target-total') targetTotal = Number(process.argv[++i] || fail('--target-total 缺少数量'));
  else if (arg === '--as-of') asOf = process.argv[++i] || fail('--as-of 缺少日期');
  else if (arg === '--help' || arg === '-h') {
    console.log('用法：node scripts/generate-amap-ranking-batch.ts [--pool FILE] [--raw-dir DIR] [--catalogue FILE] [--target-total N] [--as-of YYYY-MM-DD] [--output FILE]');
    console.log('默认只离线校验和预览；只有指定 --output 才写入批次文件，绝不修改生产 catalogue。');
    process.exit(0);
  } else fail(`未知参数：${arg}`);
}
if (targetTotal !== null && (!Number.isInteger(targetTotal) || targetTotal < 1)) fail('--target-total 必须是正整数');

function fail(message: string): never { throw new Error(message); }
function parseJson<T>(raw: string, path: string): T {
  try { return JSON.parse(raw) as T; }
  catch { return fail(`JSON 无法解析：${path}`); }
}
function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) return fail(`${label} 缺失`);
  return value.trim();
}
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function optionalInteger(value: unknown): number | null {
  const parsed = optionalNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
function normalizeName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s·•.()（）【】\[\]_-]+/g, '');
}
function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function districtFrom(value: string): typeof districts[number] {
  const normalized = value === '大鹏区' ? '大鹏新区' : value.replace(/区$/, '');
  if (!(districts as readonly string[]).includes(normalized)) return fail(`不支持的行政区：${value}`);
  return normalized as typeof districts[number];
}
function addressWithDistrict(districtName: string, address: string): string {
  return address.startsWith(districtName) ? address : `${districtName}${address}`;
}
function currentNameSet(catalogue: ReturnType<typeof validateCatalogue>): Set<string> {
  return new Set(catalogue.shops.flatMap(shop => [shop.name, ...shop.aliases]).map(normalizeName));
}

const absolutePool = resolve(poolPath);
const absoluteRawDir = resolve(rawDir);
const absoluteCatalogue = resolve(cataloguePath);
const pool = parseJson<Pool>(await readFile(absolutePool, 'utf8'), absolutePool);
if (!Array.isArray(pool.candidates)) fail('候选池缺少 candidates 数组');
const catalogue = validateCatalogue(parseJson(await readFile(absoluteCatalogue, 'utf8'), absoluteCatalogue), { asOf });
const observationDate = asOf ?? pool.generatedAt;
if (!/^\d{4}-\d{2}-\d{2}$/.test(observationDate)) fail('观察日期必须是 YYYY-MM-DD');
const wanted = targetTotal === null ? Infinity : Math.max(0, targetTotal - catalogue.shops.length);
const names = currentNameSet(catalogue);
const existingIds = new Set(catalogue.shops.map(shop => shop.id));
const existingSlugs = new Set(catalogue.shops.map(shop => shop.slug));
const currentSourceById = new Map(catalogue.sources.map(source => [source.id, source]));

const rawByPoi = new Map<string, { path: string; value: RawPoi }>();
for (const filename of await readdir(absoluteRawDir)) {
  if (!filename.endsWith('.json')) continue;
  const path = resolve(absoluteRawDir, filename);
  const value = parseJson<RawPoi>(await readFile(path, 'utf8'), path);
  rawByPoi.set(filename.slice(0, -5), { path, value });
}

const generatedSources = new Map<string, ReturnType<typeof sourceSchema.parse>>();
const generatedShops: ReturnType<typeof shopSchema.parse>[] = [];
const skipped: string[] = [];
const hardExcluded = new Map([
  ['B0FFJOB60M', '2026-10-02落在10-02至10-03全天关闭的有效特殊时段'],
]);

function bestAnnualScore(candidate: Candidate): number | null {
  const values=(candidate.rankingEvidence ?? candidate.appearances ?? []).map(item=>item.annualCompositeScore).filter((value):value is number=>typeof value==='number' && Number.isFinite(value));
  return values.length && new Set(values).size===1 ? values[0] : null;
}
const orderedCandidates=[...pool.candidates].sort((a,b)=>{
  const aCity=(a.rankingEvidence ?? a.appearances ?? []).some(item=>item.scope==='深圳市 · 全城');
  const bCity=(b.rankingEvidence ?? b.appearances ?? []).some(item=>item.scope==='深圳市 · 全城');
  if(aCity!==bCity) return aCity ? -1:1;
  const aScore=bestAnnualScore(a),bScore=bestAnnualScore(b);
  if((aScore===null)!==(bScore===null)) return aScore===null ? 1:-1;
  if(aScore!==null && bScore!==null && aScore!==bScore) return bScore-aScore;
  const byName=a.name.localeCompare(b.name,'zh-CN');
  return byName || a.poiId.localeCompare(b.poiId);
});

function addSource(source: ReturnType<typeof sourceSchema.parse>) {
  const existing = generatedSources.get(source.id) ?? currentSourceById.get(source.id);
  if (existing && canonical(existing) !== canonical(source)) fail(`来源 id 内容冲突：${source.id}`);
  if (!generatedSources.has(source.id)) generatedSources.set(source.id, source);
}

for (const candidate of orderedCandidates) {
  if (generatedShops.length >= wanted) break;
  const evidence = candidate.rankingEvidence ?? candidate.appearances ?? [];
  if (!candidate.poiId || !evidence.length) { skipped.push(`${candidate.poiId || candidate.name}: 缺榜单依据`); continue; }
  if (hardExcluded.has(candidate.poiId)) { skipped.push(`${candidate.poiId}: ${hardExcluded.get(candidate.poiId)}`); continue; }
  if (candidate.existingShopId || names.has(normalizeName(candidate.name))) { skipped.push(`${candidate.poiId}: 已有正式门店`); continue; }
  const rawItem = rawByPoi.get(candidate.poiId);
  if (!rawItem) { skipped.push(`${candidate.poiId}: 尚无离线POI详情`); continue; }
  const raw = rawItem.value;
  if (raw.response?.code !== 1 || !raw.response.data) { skipped.push(`${candidate.poiId}: POI响应失败 ${raw.response?.message ?? raw.response?.code ?? 'unknown'}`); continue; }
  const base = raw.response.data.base ?? {};
  let poiId: string, name: string, address: string, adcode: string, districtName: string, hours: string, classify: string, lon: number, lat: number;
  try {
    poiId = requiredText(base.poiid, `${candidate.poiId}.base.poiid`);
    if (poiId !== candidate.poiId) fail(`${candidate.poiId}: 响应POI ID为 ${poiId}`);
    name = requiredText(base.name, `${candidate.poiId}.base.name`);
    address = requiredText(base.address, `${candidate.poiId}.base.address`);
    adcode = requiredText(base.adcode, `${candidate.poiId}.base.adcode`);
    districtName = requiredText(base.districtname, `${candidate.poiId}.base.districtname`);
    hours = requiredText(base.opentime, `${candidate.poiId}.base.opentime`);
    classify = requiredText(base.classify, `${candidate.poiId}.base.classify`);
    lon = Number(requiredText(base.x, `${candidate.poiId}.base.x`));
    lat = Number(requiredText(base.y, `${candidate.poiId}.base.y`));
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) fail(`${candidate.poiId}: 坐标不是有效数字`);
    if (!adcode.startsWith('4403')) fail(`${candidate.poiId}: 非深圳adcode ${adcode}`);
  } catch (error) { skipped.push(error instanceof Error ? error.message : String(error)); continue; }
  if (/装修中|暂停营业|已关闭|歇业/.test(name)) { skipped.push(`${candidate.poiId}: 当前名称标记为非正常营业状态：${name}`); continue; }
  if (names.has(normalizeName(name))) { skipped.push(`${candidate.poiId}: POI当前名称已存在正式目录`); continue; }

  const slug = `amap-${candidate.poiId.toLowerCase()}`;
  if (existingIds.has(slug) || existingSlugs.has(slug)) { skipped.push(`${candidate.poiId}: 生成ID或slug冲突 ${slug}`); continue; }
  const poiSourceId = `poi-amap-${candidate.poiId.toLowerCase()}-${observationDate}`;
  const score = raw.response.data.score ?? {};
  const rating = optionalNumber(score.rating);
  const reviewTotal = optionalInteger(score.review_total);
  const averageCost = optionalNumber(score.averagecost);
  const capturedDate = /^\d{4}-\d{2}-\d{2}/.test(raw.capturedAt) ? raw.capturedAt.slice(0, 10) : observationDate;
  const apiFields = [
    `当前店名“${name}”`, `${districtName}地址`, `常规营业时间“${hours}”`, `分类“${classify}”`, 'GCJ-02坐标',
    rating === null ? null : `详情接口评分${rating}（满分量表未披露）`,
    reviewTotal === null ? null : `详情接口review_total=${reviewTotal}`,
    averageCost === null ? null : `参考人均${averageCost}元`,
  ].filter(Boolean).join('、');
  addSource(sourceSchema.parse({
    id: poiSourceId,
    title: `高德公开POI详情离线响应：${name}`,
    url: raw.sourceUrl || candidate.officialPlaceUrl,
    kind: 'poi', publishedAt: null, accessedAt: capturedDate, ratingChannel:'amap-pc-poi-rating',
    statement: `${apiFields}。响应离线保存在 ${rawItem.path.replace(`${resolve('.')}/`, '')}；building_status语义未确认，未据此判断营业状态；图片未取得转载许可。`,
  }));

  for (const item of evidence) {
    const metricStatement = typeof item.highConsumptionAudience === 'number'
      ? '页面位置、中高消费人群人数、标签和推荐文案按各门店排名记录保留；中高消费人群人数是高德原始人群指标，不是用户评分、回头客人数或本站综合分。'
      : '页面位置、全年综合分、标签和推荐文案按各门店排名记录保留；全年综合分是榜单年度指标，不是用户评分或本站综合分。';
    addSource(sourceSchema.parse({
      id: item.sourceId,
      title: `高德扫街榜公开网页：${item.group} · ${item.scope}`,
      url: item.sourceUrl,
      kind: 'ranking', publishedAt: null, accessedAt: pool.generatedAt,
      statement: `高德官方公开榜单“${item.group}”，范围“${item.scope}”。${metricStatement}${item.group.includes('2025') ? '':' 页面未注明榜单届次；2026为访问年份，不作为榜单年份。'}`,
    }));
  }

  const rankingSourceIds = unique(evidence.map(item => item.sourceId));
  const aliases = unique([candidate.name,...(candidate.names ?? [])].filter(alias => normalizeName(alias) !== normalizeName(name)));
  const rankingSummary = evidence.map(item => `${item.group}（${item.scope}）第${item.position}项${item.metricLabel ? `，页面原始“${item.metricLabel}”` : ''}`).join('；');
  const hasAnnualCompositeScore = evidence.some(item => typeof item.annualCompositeScore === 'number');
  const hasHighConsumptionAudience = evidence.some(item => typeof item.highConsumptionAudience === 'number');
  const metricCaveat = hasAnnualCompositeScore && hasHighConsumptionAudience
    ? '全年综合分和中高消费人群人数仅按高德榜单原始字段展示；前者不是用户评分，后者不是回头客人数，二者都不作为本站综合分。'
    : hasHighConsumptionAudience
      ? '中高消费人群人数仅按高德榜单原始字段展示，不是用户评分、回头客人数或本站综合分。'
      : '全年综合分仅按高德榜单原始字段展示，不作为用户评分或本站综合分。';
  const recommendation = evidence.find(item => item.recommendation)?.recommendation;
  const platformTags = unique(evidence.flatMap(item => item.tags ?? [])).slice(0, 6);
  const detailTags = Array.isArray(raw.response.data.tags?.tag_show_info) ? (raw.response.data.tags!.tag_show_info as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 6) : [];
  const secondReason = recommendation
    ? `高德榜单推荐文案：${recommendation}；这是平台线索，本站未亲测。`
    : `高德页面标签包括${[...platformTags, ...detailTags].slice(0, 6).map(item => `“${item}”`).join('、')}；这是平台线索，本站未亲测。`;
  const district = districtFrom(districtName);
  const sourceIds = unique([...rankingSourceIds, poiSourceId]);
  const shop = shopSchema.parse({
    id: slug, slug, name, aliases, district, street: '',
    address: { text: addressWithDistrict(districtName, address), sourceIds: [poiSourceId] },
    category: classify, cuisine: classify,
    summary: { text: `${addressWithDistrict(districtName, address)}的${classify}门店，收录于高德官方榜单。`, sourceIds },
    dishes: [],
    reasons: [
      { text: `${rankingSummary}。${metricCaveat}`, sourceIds: rankingSourceIds },
      { text: secondReason, sourceIds: recommendation || platformTags.length ? rankingSourceIds : [poiSourceId] },
    ],
    cautions: [
      { text: `高德公开POI详情仍返回该门店和营业时段，含节假日例外时按原文保留，但未核验采集当刻是否正在营业；评分使用详情接口rating，评价数使用同一响应的review_total，不与App页面其他评论数字混用。${aliases.length ? `高德榜单以“${candidate.name}”收录同一POI；当前详情名称不同，旧名作为别名保留，这不证明经营主体或历史连续不变。` : ''}`, sourceIds },
    ],
    scenes: [], history: null,
    operating: { status: 'reported-open', asOf: capturedDate, sourceIds: [poiSourceId], note: `高德公开POI详情仍返回具体门店及常规营业时间“${hours}”；未核验采集当刻是否处于营业时段，building_status语义未用于判断。` },
    price: averageCost && averageCost > 0 ? { cny: averageCost, asOf: capturedDate, sourceIds: [poiSourceId] } : null,
    hours: { text: hours, sourceIds: [poiSourceId] },
    coordinates: { lon, lat, system: 'GCJ-02', sourceIds: [poiSourceId] },
    ratings: rating !== null && rating >= 0 ? [{ platform: '高德地图', value: rating, max: null, count: reviewTotal, asOf: capturedDate, sourceIds: [poiSourceId] }] : [],
    rankings: evidence.map(item => ({
      name: `高德扫街榜 · ${item.group}`, edition: item.group.includes('2025') ? '2025' : `页面未标注届次（${pool.generatedAt}访问）`, rank: item.position, scope: item.scope, asOf: pool.generatedAt, sourceIds: [item.sourceId],
      annualCompositeScore: typeof item.annualCompositeScore==='number' ? {value:item.annualCompositeScore,year:item.group.includes('2025') ? 2025:null,label:'全年综合分',rawDisplay:item.metricLabel?.replace(/^全年综合分/,'') || String(item.annualCompositeScore)}:null,
    })),
    metrics: { repeat: null, stability: null, value: null }, repeatVisits: null, photos: [], checkedAt: capturedDate,
  });
  if(candidate.poiId==='B0FFK22W52') {
    const view='高德地图 → 深圳市 → 高德扫街榜 → 美食 → 回头客 → 附近 → 全部美食';
    const listEvidence='research/evidence/top100-auto-20261002T104944Z-36436-p01-list.png';
    const appRankingId='app-niuxiang-repeat-all';
    const repeatId='repeat-niuxiang-180days';
    for(const [id,kind,title,statement] of [
      [appRankingId,'ranking','高德App回头客全部美食榜：牛巷番薯粥','列表在“深圳市、附近、全部美食”筛选下显示TOP 5；附近范围和半径未公布，不称深圳全市第5名。详情页店名和福田区牛巷坊54栋地址对应网页同一POI。'],
      [repeatId,'repeat','高德近180天回头客人数：牛巷番薯粥','列表原文“近180天4.9万回头客”。4.9万是平台近似展示，不是精确49000人，不换算为回头率；同卡8.5万本地人推荐是另一指标。'],
    ] as const) addSource(sourceSchema.parse({id,title,url:candidate.officialPlaceUrl,kind,publishedAt:null,accessedAt:'2026-10-02',statement,capture:{method:'official-app',view,localEvidence:[listEvidence,'research/evidence/top100-niuxiang-detail.png']}}));
    shop.rankings.push({name:'高德扫街榜 · 回头客全部美食榜',edition:'2026年页面观察',rank:5,scope:'深圳市 · 附近 · 全部美食（范围及半径未公开）',asOf:'2026-10-02',sourceIds:[appRankingId]});
    shop.repeatVisits={count:49000,windowDays:180,rawDisplay:'4.9万',approximate:true,asOf:'2026-10-02',sourceIds:[repeatId],definition:'高德原文“近180天4.9万回头客”，是近似人数，不是回头率，不直接换算为综合分。'};
    shop.reasons.push({text:'高德App回头客榜在附近、全部美食筛选下显示TOP 5，并显示近180天约4.9万回头客；附近范围及半径未公布。',sourceIds:[appRankingId,repeatId]});
  }
  generatedShops.push(shop);
  names.add(normalizeName(name));
  names.add(normalizeName(candidate.name));
}

const batch = {
  sources: [...generatedSources.values()], shops: generatedShops, pending: [], updatedAt: observationDate,
  note: `深圳美食指南为本站高德上榜门店选集，非高德官方全市总排名。首批保留已有${catalogue.shops.length}家；新增先取2025官方全城榜候选，再从区榜候选按原全年综合分补充，同分按店名和POI稳定选择，不设总数上限或地区配额，按具体分店去重。年度分、用户评分、回头客人数分别展示，缺指标不推算本站综合分。`,
};
validateCatalogue({ version: 1, policy: 'amap-only', ...batch }, { asOf: observationDate });
console.log(`离线生成校验通过：当前正式 ${catalogue.shops.length} 家，目标 ${targetTotal ?? '不限'} 家；本次可生成 ${generatedShops.length} 家、${generatedSources.size} 条来源。`);
console.log(`跳过 ${skipped.length} 条：${skipped.slice(0, 12).join('；')}${skipped.length > 12 ? '；…' : ''}`);
if (Number.isFinite(wanted) && generatedShops.length < wanted) console.log(`仍缺 ${wanted - generatedShops.length} 家完整POI详情；未用失败、装修中、缺字段或重复门店补数。`);
if (!outputPath) console.log('DRY RUN：未写文件；指定 --output research/<name>.json 后生成可供 import-amap-batch.ts 预演的批次。');
else {
  const output = resolve(outputPath);
  await writeFile(output, `${JSON.stringify(batch, null, 2)}\n`, { flag: 'wx' });
  console.log(`已写入独立批次：${output}`);
}
