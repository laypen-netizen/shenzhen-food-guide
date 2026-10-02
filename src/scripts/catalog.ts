import type { Shop } from '../lib/schema';
import type { Filters } from '../lib/filtering';
import { selectShops } from '../lib/filtering';
import { getFavoriteIds } from './global';

const root=document.querySelector<HTMLElement>('[data-catalog]');
if(root) {
  const payload=JSON.parse(document.getElementById('catalogue-data')?.textContent || '{}') as {shops:Shop[];base:string;pendingCount:number};
  const all=payload.shops || [], favoritesOnly=root.dataset.favoritesOnly==='true';
  const form=root.querySelector<HTMLFormElement>('form')!;
  const grid=root.querySelector<HTMLElement>('[data-shop-grid]')!;
  const empty=root.querySelector<HTMLElement>('[data-empty]')!;
  const favoriteEmpty=root.querySelector<HTMLElement>('[data-favorite-empty]');
  const cards=new Map([...grid.querySelectorAll<HTMLElement>('[data-shop-card]')].map(el=>[el.dataset.shopId,el]));
  const keys=['q','district','category','price','age','rating','repeat','sort'] as const;
  let visible:Shop[]=[],mapController:Awaited<ReturnType<typeof import('./map').createMap>>|null=null;
  let mapLoading=false;
  const read = ():Filters => Object.fromEntries(keys.map(key=>[key,(form.elements.namedItem(key) as HTMLInputElement|HTMLSelectElement).value])) as Filters;
  function restore() {
    const params=new URLSearchParams(location.search);
    for(const key of keys) {
      const field=form.elements.namedItem(key) as HTMLInputElement|HTMLSelectElement;
      const value=params.get(key) || (key==='sort' ? 'recommended':'');
      field.value=key==='q' ? value.slice(0,160):value;
      if(field instanceof HTMLSelectElement && field.selectedIndex<0) field.selectedIndex=0;
    }
  }
  function update(writeUrl=true) {
    const f=read(),saved=new Set(getFavoriteIds());
    visible=selectShops(favoritesOnly ? all.filter(s=>saved.has(s.id)):all,f);
    const shown=new Set(visible.map(s=>s.id));
    for(const [id,card] of cards) card.hidden=!shown.has(id || '');
    for(const s of visible) { const card=cards.get(s.id);if(card) grid.append(card); }
    grid.hidden=visible.length===0;
    root!.querySelector('[data-result-count]')!.textContent=`${visible.length} 家${favoritesOnly ? '收藏':'已收录'}`;
    if(favoriteEmpty) favoriteEmpty.hidden=!favoritesOnly || saved.size>0;
    empty.hidden=visible.length>0 || (favoritesOnly && saved.size===0);
    const noData=all.length===0;
    empty.querySelector('[data-empty-title]')!.textContent=noData ? payload.pendingCount ? '门店资料核验中':'榜单资料接入中':'没有符合条件的门店';
    empty.querySelector('[data-empty-description]')!.textContent=noData ? payload.pendingCount ? `已读取 ${payload.pendingCount} 家真实高德候选，正在核验门店资料。可先查看候选的原始记录。`:'正式收录需要高德扫街榜依据、可核验门店信息与近期营业线索。当前没有满足核验条件的正式记录。':'可以清除或减少筛选条件。未知价格、评分不会被归入确定的分组。';
    root!.querySelector('[data-sort-note]')!.textContent=f.sort==='recommended'
      ? '三家编辑优选在前；其后同一2025选集中按高德原榜全年综合分展示，缺分不等于低分'
      :f.sort==='annual-2025'
        ? '只按高德2025原榜“全年综合分”排序；它不是用户评分或本站四维综合分，缺分记录排后'
        :f.sort==='composite' ? '仅完整四项综合分参与排序，缺项记录排在后面'
          :f.sort==='rating' ? '按高德5分制原始评分排序；未知或其他量表排后':'排序不代表美味排名';
    mapController?.update(visible);
    if(writeUrl) {
      const url=new URL(location.href);
      for(const key of keys) { const value=f[key];if(value && !(key==='sort' && value==='recommended')) url.searchParams.set(key,value);else url.searchParams.delete(key); }
      history.replaceState(null,'',url);
    }
  }
  form.addEventListener('submit',event=>{event.preventDefault();update();});
  form.addEventListener('input',()=>update());
  // Search already updates on input. Reordering on its blur/change event can
  // detach a favorite button between pointerdown and click, dropping the click.
  form.addEventListener('change',event=>{if(event.target instanceof HTMLSelectElement) update();});
  form.addEventListener('reset',()=>setTimeout(()=>update(),0));
  window.addEventListener('popstate',()=>{restore();update(false);});
  window.addEventListener('favorites-change',()=>update(false));
  root.querySelectorAll<HTMLElement>('[data-js-control]').forEach(el=>{el.hidden=false;});
  form.querySelector<HTMLElement>('.js-submit')!.hidden=true;
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.addEventListener('click',async()=>{
    const isMap=button.dataset.view==='map';
    root!.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>{const active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    root!.querySelector<HTMLElement>('[data-map-section]')!.hidden=!isMap;
    if(isMap && !mapController && !mapLoading) {
      mapLoading=true;
      try { const {createMap}=await import('./map');mapController=await createMap(root!.querySelector<HTMLElement>('[data-map]')!,root!.querySelector<HTMLElement>('[data-map-status]')!,payload.base);mapController.update(visible); }
      catch { root!.querySelector('[data-map-status]')!.textContent='地图加载失败，可继续使用列表、复制地址与高德导航。'; }
      finally { mapLoading=false; }
    }
    mapController?.resize();
  }));
  restore();update(false);
}
