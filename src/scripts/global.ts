import { FAVORITES_KEY,parseFavorites } from '../lib/favorites';

const knownIds = new Set<string>(JSON.parse(document.getElementById('favorite-known-ids')?.textContent || '[]'));
let ids:string[] = [];
let storageAvailable = true;
try { const saved=localStorage.getItem(FAVORITES_KEY); if(saved) ids=parseFavorites(JSON.parse(saved),knownIds).ids; }
catch { storageAvailable=false; }
let toastTimer:ReturnType<typeof setTimeout>;
export function notify(text:string) {
  const toast=document.getElementById('toast'); if(!toast) return;
  toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},5500);
}
export function getFavoriteIds() { return [...ids]; }
function refreshStorageWarning() {
  document.querySelectorAll<HTMLElement>('[data-storage-warning]').forEach(el=>{el.hidden=storageAvailable;});
}
function refresh() {
  document.querySelectorAll<HTMLElement>('[data-favorite-count]').forEach(el=>{el.textContent=String(ids.length);});
  document.querySelectorAll<HTMLButtonElement>('[data-favorite]').forEach(button=>{
    const saved=ids.includes(button.dataset.favorite || '');
    if(!button.dataset.shopName) button.dataset.shopName=(button.getAttribute('aria-label') || '').replace(/^收藏/,'');
    button.disabled=false;button.setAttribute('aria-pressed',String(saved));
    button.setAttribute('aria-label',`${saved ? '取消收藏':'收藏'}${button.dataset.shopName}`);
    const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');icon.textContent=saved ? '♥':'♡';
    button.replaceChildren(icon,document.createTextNode(saved ? ' 已收藏':' 收藏'));
  });
  refreshStorageWarning();
  window.dispatchEvent(new CustomEvent('favorites-change'));
}
function save(next:string[]) {
  ids=next;
  try { localStorage.setItem(FAVORITES_KEY,JSON.stringify({version:1,ids}));storageAvailable=true; }
  catch { storageAvailable=false; }
  refresh();
  if(!storageAvailable) notify('浏览器存储不可用：收藏仅在本次页面有效，请导出备份。');
}
document.addEventListener('click',event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-favorite]');
  if(button?.dataset.favorite && knownIds.has(button.dataset.favorite)) {
    const id=button.dataset.favorite,had=ids.includes(id);save(had ? ids.filter(v=>v!==id):[...ids,id]);
    if(storageAvailable) notify(had ? '已取消收藏':'已收藏，保存在当前浏览器');
  }
  const copy=(event.target as Element).closest<HTMLElement>('[data-copy]');
  if(copy) {
    const value=copy.dataset.copy==='url' ? location.href:copy.dataset.copy || '';
    navigator.clipboard?.writeText(value).then(()=>notify('已复制')).catch(()=>notify(`自动复制不可用，请手动复制：${value}`));
    if(!navigator.clipboard) notify(`请手动复制：${value}`);
  }
});
window.addEventListener('storage',event=>{
  if(event.key !== FAVORITES_KEY && event.key !== null) return;
  try { if(event.storageArea !== localStorage) return;storageAvailable=true;refreshStorageWarning(); }
  catch { storageAvailable=false;refreshStorageWarning();return; }
  try { ids=event.newValue ? parseFavorites(JSON.parse(event.newValue),knownIds).ids:[];refresh(); }
  catch { notify('另一个窗口的收藏数据格式异常，当前收藏未替换。'); }
});
document.querySelectorAll<HTMLButtonElement>('[data-export-favorites]').forEach(button=>button.addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),ids},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='shenzhen-food-favorites.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notify('收藏备份已生成，请保管下载的 JSON 文件。');
}));
const upload=document.querySelector<HTMLInputElement>('[data-import-favorites]');
upload?.addEventListener('change',async()=>{
  const file=upload.files?.[0];if(!file) return;
  try {
    if(file.size>1024*1024) throw new Error('文件超过1MB，请使用本站导出的收藏 JSON');
    const result=parseFavorites(JSON.parse(await file.text()),knownIds);
    const count=result.ids.filter(id=>!ids.includes(id)).length;
    save([...new Set([...ids,...result.ids])]);
    const text=`新增 ${count} 家，忽略 ${result.duplicates} 个重复项、${result.removed} 个未收录或已移除门店。${storageAvailable ? '已保存到当前浏览器。':'存储不可用，请导出备份。'}`;
    const status=document.querySelector('[data-import-result]');if(status) status.textContent=text;notify(text);
  } catch(e) {
    const text=e instanceof Error ? e.message:'导入失败，原有收藏未修改';
    const status=document.querySelector('[data-import-result]');if(status) status.textContent=text;notify(text);
  }
  finally { upload.value=''; }
});
document.querySelectorAll<HTMLButtonElement|HTMLInputElement>('[data-export-favorites],[data-import-favorites]').forEach(el=>{el.disabled=false;});
refresh();
if(!storageAvailable) notify('浏览器存储不可用，收藏无法持久保存；你仍可浏览和导航。');
