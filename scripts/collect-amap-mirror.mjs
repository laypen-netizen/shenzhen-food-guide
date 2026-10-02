#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const macBin=process.env.MAC_BIN || join(homedir(),'.codex/skills/huashu-mac-use/scripts/mac');
const ocrBin=process.env.AMAP_OCR_BIN || join(projectRoot,'.verification/vision-ocr');
const clickBin=process.env.AMAP_CLICK_BIN || join(projectRoot,'.verification/post-to-pid-click');
const scrollBin=process.env.AMAP_SCROLL_BIN || join(projectRoot,'.verification/continuous-scroll');
const postCaptureSettleMs=2500;

function usage(message='') {
  if(message) console.error(message);
  console.log(`Usage: node scripts/collect-amap-mirror.mjs [--execute] [--pages N] [--pid N]
  [--out-dir research/evidence] [--progress research/top100-auto-progress.json]

Default: one read-only screenshot/OCR preflight. No click or scroll is sent.
--execute enables guarded background clicks and guarded global-HID scrolling.
--pages defaults to 1 and is limited to 1..5 per run.`);
  process.exit(message ? 1:0);
}

const options={execute:false,pages:1,pid:null,outDir:'research/evidence',progress:'research/top100-auto-progress.json'};
const argv=process.argv.slice(2);
for(let i=0;i<argv.length;i++) {
  const arg=argv[i];
  if(arg==='--execute') options.execute=true;
  else if(arg==='--pages') options.pages=Number(argv[++i]);
  else if(arg==='--pid') options.pid=Number(argv[++i]);
  else if(arg==='--out-dir') options.outDir=argv[++i] || usage('缺少 --out-dir 参数');
  else if(arg==='--progress') options.progress=argv[++i] || usage('缺少 --progress 参数');
  else if(arg==='--help' || arg==='-h') usage();
  else usage(`未知参数：${arg}`);
}
if(!Number.isInteger(options.pages) || options.pages<1 || options.pages>5) usage('--pages 必须是 1..5');
if(options.pid!==null && (!Number.isInteger(options.pid) || options.pid<=0)) usage('--pid 必须是正整数');
options.outDir=resolve(projectRoot,options.outDir);
options.progress=resolve(projectRoot,options.progress);

function command(file,args,{allowFailure=false}={}) {
  const result=spawnSync(file,args,{cwd:projectRoot,encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.error) throw result.error;
  if(result.status!==0 && !allowFailure) throw new Error(`${file} ${args.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`);
  return {status:result.status,stdout:result.stdout.trim(),stderr:result.stderr.trim()};
}

function windowList() {
  const lines=command(macBin,['windows','--all']).stdout.split('\n');
  return lines.map(line=>{
    const match=line.match(/^id=(\d+) pid=(\d+) owner=iPhone镜像 on=([01]) origin=\((-?\d+),(-?\d+)\) (\d+)x(\d+) title=(.*)$/);
    if(!match) return null;
    return {line,id:Number(match[1]),pid:Number(match[2]),onscreen:match[3]==='1',x:Number(match[4]),y:Number(match[5]),width:Number(match[6]),height:Number(match[7]),title:match[8]};
  }).filter(Boolean);
}

function discoverWindow(expectedPid=null) {
  const candidates=windowList().filter(w=>w.onscreen && w.width>200 && w.height>500 && w.title==='iPhone镜像' && (expectedPid===null || w.pid===expectedPid));
  if(candidates.length!==1) throw new Error(`refused: expected one onscreen iPhone镜像 window, found ${candidates.length}`);
  return candidates[0];
}

function frontmostGuard(window,localX,localY) {
  const key=command(macBin,['key',String(window.pid),'125','--dry'],{allowFailure:true});
  const keyText=`${key.stdout}\n${key.stderr}`;
  if(key.status!==0 || !keyText.includes('frontmost=pass')) throw new Error(`refused: mirror PID is not frontmost\n${keyText}`);
  const hit=command(macBin,['clickin',String(window.id),String(localX),String(localY),'--dry'],{allowFailure:true});
  const hitText=`${hit.stdout}\n${hit.stderr}`;
  if(hit.status!==0 || !hitText.includes('跨Space=pass') || !hitText.includes('遮挡=pass') || !hitText.includes('在场=pass')) {
    throw new Error(`refused: Space, occlusion, or user-presence guard failed\n${hitText}`);
  }
}

function screenshot(window,path) {
  mkdirSync(dirname(path),{recursive:true});
  command(macBin,['shot',String(window.id),path]);
}

function readOCR(imagePath,ocrPath) {
  const output=command(ocrBin,[imagePath]).stdout;
  const line=output.split('\n').find(Boolean);
  if(!line) throw new Error(`OCR returned no JSON for ${imagePath}`);
  const document=JSON.parse(line);
  writeFileSync(ocrPath,`${JSON.stringify(document,null,2)}\n`);
  return document;
}

function texts(document) { return document.lines.map(line=>line.text.trim()).filter(Boolean); }
function joinedText(document) { return texts(document).join('\n'); }
function normalized(value) { return value.replace(/[\s·•（）()\-—_]/g,'').toLowerCase(); }

function blockedReason(document) {
  const text=joinedText(document);
  const blockers=[
    ['iPhone使用中','iPhone镜像已断开'],
    ['验证码','遇到验证码'],
    ['登录','遇到登录页'],
    ['分享给朋友','遇到分享面板'],
    ['复制链接','遇到分享面板'],
    ['微信好友','遇到分享面板'],
  ];
  for(const [needle,reason] of blockers) if(text.includes(needle)) return reason;
  return null;
}

function isListPage(document) {
  const text=joinedText(document);
  return (text.includes('高德扫街榜') || (text.includes('高德扫') && text.includes('榜')))
    && text.includes('回头客') && text.includes('附近') && text.includes('全部美食');
}

function plausibleShopName(text) {
  if(text.length<2 || text.length>45 || !/[\u3400-\u9fffA-Za-z]/.test(text)) return false;
  if(/^\s*\d/.test(text)) return false;
  return !/(近180天|回头客|本地人推荐|全年热度|累计导航|公里|人均|评价|TOP\s*\d|全部美食|高德扫|排序|附近|营业|BEST100|¥|￥|\d\.\d分)/i.test(text);
}

function extractCandidates(document) {
  const result=[];
  for(let index=0;index<document.lines.length;index++) {
    const repeat=document.lines[index];
    if(!/近\s*180\s*天.*回头客/.test(repeat.text)) continue;
    const repeatCenterY=(repeat.y+repeat.height/2)*document.pixelHeight;
    if(!(repeatCenterY>420 && repeatCenterY<1250)) continue;
    const preceding=document.lines.slice(0,index).map(line=>({line,centerY:(line.y+line.height/2)*document.pixelHeight,centerX:(line.x+line.width/2)*document.pixelWidth}))
      .filter(item=>item.centerY<repeatCenterY
        && repeatCenterY-item.centerY<150
        && (item.line.x<0.5 || item.centerX<document.pixelWidth/2)
        && plausibleShopName(item.line.text))
      .sort((a,b)=>b.centerY-a.centerY);
    if(!preceding.length) continue;
    const nameLine=preceding[0];
    const name=nameLine.line.text.trim();
    result.push({name,normalizedName:normalized(name),repeatText:repeat.text.trim(),namePixel:{x:nameLine.centerX,y:nameLine.centerY},repeatPixelY:repeatCenterY});
  }
  const seen=new Set();
  return result.filter(candidate=>candidate.name && !seen.has(candidate.normalizedName) && seen.add(candidate.normalizedName));
}

function detailAccepted(document,name) {
  if(isListPage(document)) return false;
  const text=joinedText(document);
  const target=normalized(name);
  const hasName=texts(document).some(line=>normalized(line).includes(target) || target.includes(normalized(line)) && normalized(line).length>=4);
  const hasRating=/\d(?:\.\d)?\s*(?:分|评价)/.test(text) || text.includes('评价');
  const hasOperating=/营业中|休息中|即将营业|暂停营业|\d{1,2}:\d{2}\s*[-–—至]\s*\d{1,2}:\d{2}/.test(text);
  const hasAddress=texts(document).some(line=>{
    const candidate=normalized(line);
    return candidate.length>=6 && !candidate.includes(target) && !target.includes(candidate) && /(?:区|街道|路|街|巷|号|栋|层)/.test(line);
  });
  const hasOperatingOrAddress=hasOperating || hasAddress;
  return hasName && hasRating && hasOperatingOrAddress;
}

function shopNameSet(document) { return new Set(extractCandidates(document).map(candidate=>candidate.normalizedName)); }
function setsDiffer(left,right) {
  if(left.size!==right.size) return true;
  for(const item of left) if(!right.has(item)) return true;
  return false;
}

function pixelToLocal(document,window,point) {
  return {x:point.x/document.pixelWidth*window.width,y:point.y/document.pixelHeight*window.height};
}

function guardedBackgroundClick(window,document,point) {
  // iPhone Mirroring may briefly show a screenshot sharing affordance after
  // macOS captures the window. Let that transient UI disappear before input.
  sleep(postCaptureSettleMs);
  const latest=discoverWindow(window.pid);
  if(latest.id!==window.id) throw new Error('refused: mirror window ID changed before click');
  const local=pixelToLocal(document,latest,point);
  frontmostGuard(latest,Math.round(local.x),Math.round(local.y));
  const global={x:latest.x+local.x,y:latest.y+local.y};
  command(clickBin,['--window-id',String(latest.id),'--pid',String(latest.pid),'--x',String(global.x),'--y',String(global.y),'--execute']);
}

function guardedScroll(window) {
  // Avoid scrolling while the screenshot-triggered sharing affordance is up.
  sleep(postCaptureSettleMs);
  const latest=discoverWindow(window.pid);
  if(latest.id!==window.id) throw new Error('refused: mirror window ID changed before scroll');
  const local={x:latest.width*0.5,y:latest.height*0.65};
  frontmostGuard(latest,Math.round(local.x),Math.round(local.y));
  command(scrollBin,['--window-id',String(latest.id),'--pid',String(latest.pid),'--x',String(latest.x+local.x),'--y',String(latest.y+local.y),'--distance','-430','--steps','8','--mode','wheel','--execute']);
}

function sleep(milliseconds) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,milliseconds); }

let previousState=null;
if(existsSync(options.progress)) {
  try { previousState=JSON.parse(readFileSync(options.progress,'utf8')); }
  catch { throw new Error(`无法读取已有进度 JSON：${options.progress}`); }
}
const runId=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+`-${process.pid}`;
const priorAccepted=Array.isArray(previousState?.accepted) ? previousState.accepted:[];
const priorSeenNames=[...new Set(priorAccepted.map(item=>typeof item?.name==='string' ? normalized(item.name):'').filter(Boolean))];
const state={
  version:1,
  runId,
  mode:options.execute ? 'execute':'preview',
  requestedPages:options.pages,
  startedAt:new Date().toISOString(),
  updatedAt:new Date().toISOString(),
  status:'starting',
  window:null,
  currentPage:0,
  previousRun:previousState ? {runId:previousState.runId??null,status:previousState.status??null,updatedAt:previousState.updatedAt??null}:null,
  seenNames:priorSeenNames,
  accepted:priorAccepted,
  rejected:Array.isArray(previousState?.rejected) ? previousState.rejected:[],
  steps:[],
  stopReason:null,
};

function saveState(step,data={}) {
  state.updatedAt=new Date().toISOString();
  state.steps.push({at:state.updatedAt,step,...data});
  mkdirSync(dirname(options.progress),{recursive:true});
  const temporary=`${options.progress}.${process.pid}.tmp`;
  writeFileSync(temporary,`${JSON.stringify(state,null,2)}\n`,{flag:'w'});
  renameSync(temporary,options.progress);
}

function stop(reason,status='stopped') {
  state.status=status;
  state.stopReason=reason;
  saveState('stop',{reason});
  console.error(`${status}: ${reason}`);
  process.exit(status==='complete' ? 0:2);
}

try {
  for(const required of [macBin,ocrBin,clickBin,scrollBin]) readFileSync(required);
  const initial=discoverWindow(options.pid);
  options.pid=initial.pid;
  state.window=initial;
  saveState('window-discovered',{window:initial});
  const seenNames=new Set(state.seenNames);
  const acceptedBeforeRun=state.accepted.length;
  let previousNames=null;
  let pageNumber=1;
  while(pageNumber<=options.pages) {
    state.currentPage=pageNumber;
    const prefix=`top100-auto-${runId}-p${String(pageNumber).padStart(2,'0')}`;
    const listImage=join(options.outDir,`${prefix}-list.png`);
    const listOCR=join(options.outDir,`${prefix}-list.ocr.json`);
    const window=discoverWindow(options.pid);
    screenshot(window,listImage);
    const document=readOCR(listImage,listOCR);
    saveState('list-captured',{page:pageNumber,image:listImage,ocr:listOCR});
    const blocked=blockedReason(document);
    if(blocked) stop(blocked);
    if(!isListPage(document)) stop('OCR未确认“回头客 → 附近 → 全部美食”列表，拒绝继续');
    // A mirrored list viewport is expected to expose at most two complete cards.
    // Ignore any extra partial OCR matches near the viewport edges.
    const candidates=extractCandidates(document).slice(0,2);
    if(!candidates.length) stop('当前列表可点击区域未识别到带“近180天…回头客”的完整门店');
    const currentNames=new Set(candidates.map(candidate=>candidate.normalizedName));
    if(previousNames && !setsDiffer(previousNames,currentNames)) stop('翻页后识别到的门店名称未变化');
    previousNames=currentNames;
    saveState('list-confirmed',{page:pageNumber,candidates:candidates.map(({name,repeatText,namePixel,repeatPixelY})=>({name,repeatText,namePixel,repeatPixelY}))});

    if(!options.execute) {
      state.status='preview-complete';
      saveState('preview-complete',{message:'未发送点击或滚动；添加 --execute 后才会继续'});
      console.log(JSON.stringify({mode:'preview',page:pageNumber,candidates,progress:options.progress},null,2));
      process.exit(0);
    }

    for(let candidateIndex=0;candidateIndex<candidates.length;candidateIndex++) {
      const candidate=candidates[candidateIndex];
      if(seenNames.has(candidate.normalizedName)) {
        saveState('candidate-skipped',{page:pageNumber,name:candidate.name,reason:'已见完整店名'});
        continue;
      }
      saveState('candidate-click-planned',{page:pageNumber,name:candidate.name,point:candidate.namePixel});
      guardedBackgroundClick(window,document,candidate.namePixel);
      saveState('candidate-click-sent',{page:pageNumber,name:candidate.name});
      sleep(1000);
      const detailWindow=discoverWindow(options.pid);
      // Evidence basenames are deliberately ASCII-only and never include OCR text.
      const stem=`${prefix}-c${String(candidateIndex+1).padStart(2,'0')}`;
      const detailImage=join(options.outDir,`${stem}-detail.png`);
      const detailOCR=join(options.outDir,`${stem}-detail.ocr.json`);
      screenshot(detailWindow,detailImage);
      const detailDocument=readOCR(detailImage,detailOCR);
      saveState('detail-captured',{page:pageNumber,name:candidate.name,image:detailImage,ocr:detailOCR});
      const detailBlocked=blockedReason(detailDocument);
      if(detailBlocked) stop(detailBlocked);
      if(!detailAccepted(detailDocument,candidate.name)) {
        state.rejected.push({page:pageNumber,name:candidate.name,reason:'详情OCR缺少店名或评价/营业/地址线索',listImage,detailImage});
        saveState('detail-rejected',{page:pageNumber,name:candidate.name});
        stop(`门店“${candidate.name}”详情页未通过OCR确认`);
      }
      state.accepted.push({page:pageNumber,name:candidate.name,repeatText:candidate.repeatText,listImage,listOCR,detailImage,detailOCR});
      seenNames.add(candidate.normalizedName);
      state.seenNames=[...seenNames];
      saveState('detail-accepted',{page:pageNumber,name:candidate.name});

      const returnPoint={x:70,y:182};
      guardedBackgroundClick(detailWindow,detailDocument,returnPoint);
      saveState('return-click-sent',{page:pageNumber,name:candidate.name,point:returnPoint});
      sleep(1000);
      const returnWindow=discoverWindow(options.pid);
      const returnImage=join(options.outDir,`${stem}-return.png`);
      const returnOCR=join(options.outDir,`${stem}-return.ocr.json`);
      screenshot(returnWindow,returnImage);
      const returnDocument=readOCR(returnImage,returnOCR);
      saveState('return-captured',{page:pageNumber,name:candidate.name,image:returnImage,ocr:returnOCR});
      const returnBlocked=blockedReason(returnDocument);
      if(returnBlocked) stop(returnBlocked);
      if(!isListPage(returnDocument)) stop(`返回后未重新确认列表：${candidate.name}`);
    }

    if(pageNumber===options.pages) break;
    let moved=false;
    for(let attempt=1;attempt<=2 && !moved;attempt++) {
      const beforeNames=previousNames;
      saveState('scroll-planned',{page:pageNumber,attempt,distance:-430,steps:8});
      guardedScroll(discoverWindow(options.pid));
      sleep(1000);
      const checkWindow=discoverWindow(options.pid);
      const checkImage=join(options.outDir,`${prefix}-scroll-${attempt}-after.png`);
      const checkOCR=join(options.outDir,`${prefix}-scroll-${attempt}-after.ocr.json`);
      screenshot(checkWindow,checkImage);
      const checkDocument=readOCR(checkImage,checkOCR);
      saveState('scroll-checked',{page:pageNumber,attempt,image:checkImage,ocr:checkOCR});
      const checkBlocked=blockedReason(checkDocument);
      if(checkBlocked) stop(checkBlocked);
      if(!isListPage(checkDocument)) stop('翻页后离开了目标列表');
      const afterNames=shopNameSet(checkDocument);
      moved=afterNames.size>0 && setsDiffer(beforeNames,afterNames);
      if(moved) previousNames=null;
    }
    if(!moved) stop('连续两次翻页后门店名称均未变化');
    pageNumber++;
  }
  state.status='complete';
  const acceptedThisRun=state.accepted.length-acceptedBeforeRun;
  saveState('complete',{pages:options.pages,acceptedThisRun,totalAccepted:state.accepted.length});
  console.log(`complete: pages=${options.pages}, acceptedThisRun=${acceptedThisRun}, totalAccepted=${state.accepted.length}, progress=${options.progress}`);
} catch(error) {
  state.status='error';
  state.stopReason=error instanceof Error ? error.message:String(error);
  try { saveState('error',{message:state.stopReason}); } catch {}
  console.error(state.stopReason);
  process.exit(2);
}
