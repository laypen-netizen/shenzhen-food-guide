import { mkdir,writeFile } from 'node:fs/promises';
import { normalizePoi } from '../src/lib/amap.ts';

const keyword=process.argv[process.argv.indexOf('--keyword')+1];
if(!process.argv.includes('--keyword') || !keyword || keyword.startsWith('--') || keyword.length>80) throw new Error('用法：node scripts/fetch-amap-poi.ts --keyword "已确认上榜的门店名称"');
const key=process.env.AMAP_WEB_SERVICE_KEY;
if(!key) throw new Error('缺少 AMAP_WEB_SERVICE_KEY。请在本地环境配置已有授权的 Web 服务 Key，不要粘贴到聊天或写入 PUBLIC_ 变量。');
const url=new URL('https://restapi.amap.com/v5/place/text');
url.search=new URLSearchParams({key,keywords:keyword,region:'440300',city_limit:'true',show_fields:'business,photos',page_size:'25',page_num:'1'}).toString();
let response:Response;
try { response=await fetch(url,{signal:AbortSignal.timeout(20000)}); }
catch { throw new Error('高德请求未完成；没有写入候选数据，请检查网络与账号授权。'); }
if(!response.ok) throw new Error(`高德 HTTP 状态 ${response.status}；未写入候选数据。`);
const data=await response.json() as {status:string;infocode:string;pois?:Record<string,unknown>[]};
if(data.status!=='1' || data.infocode!=='10000') throw new Error(`高德返回业务错误 ${String(data.infocode).replace(/[^\d]/g,'').slice(0,8)}；未写入候选数据。`);
const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const output={keyword,collectedAt:asOf,request:{region:'440300',city_limit:true,page_size:25,page_num:1},completeDataset:false,pois:(data.pois||[]).map(p=>normalizePoi(p,asOf))};
await mkdir('research/poi-candidates',{recursive:true});
const path=`research/poi-candidates/${Date.now()}.json`;
await writeFile(path,JSON.stringify(output,null,2));
console.log(`取得 ${output.pois.length} 条普通 POI 候选，写入 ${path}。未证明上榜，未写入正式目录，未下载照片。`);
