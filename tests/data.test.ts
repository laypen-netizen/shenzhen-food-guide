import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCatalogue,ageAt,isAmapUrl} from '../src/lib/schema.ts';
import {fixtureCatalogue} from './fixtures.ts';
const opts={allowTestData:true,asOf:'2026-10-02'};
test('生产目录只接受高德来源且不包含测试样例',()=>{const c=validateCatalogue(JSON.parse(readFileSync('src/data/catalogue.json','utf8')));assert.equal(c.policy,'amap-only');assert.ok(c.shops.every(s=>!s.testOnly));});
test('隔离样例在正式构建被拒绝',()=>assert.throws(()=>validateCatalogue(fixtureCatalogue(),{asOf:'2026-10-02'}),/测试样例不能发布/));
test('新店与未知店龄都可收录',()=>{const c=fixtureCatalogue();c.shops[0].history!.latestOpeningDate='2025-12-31';assert.doesNotThrow(()=>validateCatalogue(c,opts));c.shops[0].history=null;assert.doesNotThrow(()=>validateCatalogue(c,opts));assert.equal(ageAt(c.shops[0],opts.asOf),null);});
test('可选历史仍校验日期及来源一致性',()=>{const c=fixtureCatalogue();c.shops[0].history!.latestOpeningDate='2016-01-01';assert.throws(()=>validateCatalogue(c,opts),/年末保守/);c.shops[0].history!.latestOpeningDate='2027-12-31';assert.throws(()=>validateCatalogue(c,opts),/开业日期/);c.shops[0].history!.latestOpeningDate='2025-12-31';c.shops[0].history!.sourceIds=['poi'];assert.throws(()=>validateCatalogue(c,opts),/历史依据/);});
test('经营延续未明时可收录但不展示确定店龄',()=>{const c=fixtureCatalogue();c.shops[0].history!.continuation='uncertain';assert.doesNotThrow(()=>validateCatalogue(c,opts));assert.equal(ageAt(c.shops[0],opts.asOf),null);});
test('其他平台、伪装域名与不安全链接不能进入来源',()=>{assert.equal(isAmapUrl('https://amap.com.attacker.example/x'),false);assert.equal(isAmapUrl('https://surl.amap.com/example'),true);const c=fixtureCatalogue();c.sources[0].url='https://www.dianping.com/shop/example';assert.throws(()=>validateCatalogue(c,opts));});
test('普通POI不是上榜依据，重复到店必须有相应证据',()=>{const c=fixtureCatalogue();c.sources.find(s=>s.id==='ranking')!.kind='poi';assert.throws(()=>validateCatalogue(c,opts),/普通 POI/);c.sources.find(s=>s.id==='ranking')!.kind='ranking';c.sources.find(s=>s.id==='repeat')!.kind='poi';assert.throws(()=>validateCatalogue(c,opts),/repeat 缺对应指标证据/);});
test('重复标识、缺来源、评分越界和未来日期被拒绝',()=>{for(const change of [(c:ReturnType<typeof fixtureCatalogue>)=>{c.shops[1].id=c.shops[0].id;},(c:ReturnType<typeof fixtureCatalogue>)=>{c.shops[0].address.sourceIds=['missing'];},(c:ReturnType<typeof fixtureCatalogue>)=>{c.shops[0].ratings[0].value=6;},(c:ReturnType<typeof fixtureCatalogue>)=>{c.shops[0].checkedAt='2027-01-01';}]){const c=fixtureCatalogue();change(c);assert.throws(()=>validateCatalogue(c,opts));}});
test('近似回头客人数必须保留页面原文，旧记录默认按精确值处理',()=>{const c=fixtureCatalogue();c.shops[0].repeatVisits={count:11000,rawDisplay:'1.1万',approximate:true,windowDays:180,asOf:'2026-10-02',sourceIds:['repeat'],definition:'测试'};assert.equal(validateCatalogue(c,opts).shops[0].repeatVisits?.approximate,true);delete c.shops[0].repeatVisits.rawDisplay;assert.throws(()=>validateCatalogue(c,opts),/必须保留页面显示原文/);const legacy=fixtureCatalogue();legacy.shops[0].repeatVisits={count:8540,approximate:false,windowDays:180,asOf:'2026-10-02',sourceIds:['repeat'],definition:'测试'};delete (legacy.shops[0].repeatVisits as {approximate?:boolean}).approximate;assert.equal(validateCatalogue(legacy,opts).shops[0].repeatVisits?.approximate,false);});
test('陈旧或关闭的营业记录移入待核验',()=>{const c=fixtureCatalogue();c.shops[0].operating.asOf='2025-01-01';assert.throws(()=>validateCatalogue(c,opts),/180天/);c.shops[0].operating.asOf='2026-09-01';c.shops[0].operating.status='closed';assert.throws(()=>validateCatalogue(c,opts),/缺营业依据/);});
test('原始分数量表未知时仍可保存但不能生成稳定性',()=>{const c=fixtureCatalogue();c.shops[0].ratings.forEach(r=>r.max=null);assert.throws(()=>validateCatalogue(c,opts),/同量表/);c.shops[0].metrics.stability=null;assert.doesNotThrow(()=>validateCatalogue(c,opts));});
test('稳定性不能凭单次分数填造，错误极差被拒绝',()=>{const c=fixtureCatalogue();c.shops[0].ratings=c.shops[0].ratings.slice(-1);assert.throws(()=>validateCatalogue(c,opts),/三个同量表快照/);const d=fixtureCatalogue();d.shops[0].metrics.stability!.value=99;assert.throws(()=>validateCatalogue(d,opts),/极差公式/);});
test('榜单全年综合分保留年份和固定原始标签',()=>{const c=fixtureCatalogue();c.shops[0].rankings[0]={...c.shops[0].rankings[0],name:'高德扫街榜 · 2025测试榜',edition:'2025',annualCompositeScore:{value:4.64,year:2025,label:'全年综合分',rawDisplay:'4.64'}};assert.equal(validateCatalogue(c,opts).shops[0].rankings[0].annualCompositeScore?.value,4.64);c.shops[0].rankings[0].annualCompositeScore!.year=2024;assert.throws(()=>validateCatalogue(c,opts),/年份必须出现在榜单名称或届次/);});
test('同一高德POI改名或换年度也不能重复收录',()=>{
  const c=fixtureCatalogue();c.sources.find(s=>s.id==='poi')!.url='https://www.amap.com/place/B012345678';
  assert.throws(()=>validateCatalogue(c,opts),/重复高德 POI/);
});
test('同名同址规范化后去重，不合并不同地址分店',()=>{
  const c=fixtureCatalogue();c.shops[1].district=c.shops[0].district;c.shops[1].name=' 虚构测试门店A ';
  assert.throws(()=>validateCatalogue(c,opts),/重复分店/);
  c.shops[1].address.text='另一家分店地址';assert.doesNotThrow(()=>validateCatalogue(c,opts));
});

test('同名同址即使行政区误填不同也不能重复收录',()=>{
  const c=fixtureCatalogue();
  c.shops[1].name=c.shops[0].name;
  c.shops[1].address.text=c.shops[0].address.text;
  c.shops[1].district=c.shops[0].district==='南山' ? '福田':'南山';
  assert.throws(()=>validateCatalogue(c,opts),/重复分店/);
});
test('未注明年度的全年综合分可保留，但不冒充2025榜',()=>{
  const c=fixtureCatalogue();c.shops[0].rankings[0]={...c.shops[0].rankings[0],name:'高德扫街榜 · 烟火小店',edition:'页面未标注届次',annualCompositeScore:{value:4.7,year:null,label:'全年综合分'}};
  assert.doesNotThrow(()=>validateCatalogue(c,opts));
});
