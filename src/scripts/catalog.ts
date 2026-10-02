import type { CatalogEntry } from '../lib/catalog-search';
import type { Filters } from '../lib/filtering';
import { searchCatalog } from '../lib/catalog-search';
import { getFavoriteIds } from './global';

const root=document.querySelector<HTMLElement>('[data-catalog]');
if(root) {
  const payload=JSON.parse(document.getElementById('catalogue-data')?.textContent || '{}') as {shops:CatalogEntry[];base:string;pendingCount:number};
  const all=payload.shops || [], favoritesOnly=root.dataset.favoritesOnly==='true';
  const form=root.querySelector<HTMLFormElement>('form')!;
  const grid=root.querySelector<HTMLElement>('[data-shop-grid]')!;
  const empty=root.querySelector<HTMLElement>('[data-empty]')!;
  const favoriteEmpty=root.querySelector<HTMLElement>('[data-favorite-empty]');
  const unrankedDivider=root.querySelector<HTMLElement>('[data-unranked-divider]');
  const cards=new Map([...grid.querySelectorAll<HTMLElement>('[data-shop-card]')].map(el=>[el.dataset.shopId,el]));
  const keys=['q','district','category','price','repeat','sort'] as const;
  let visible:CatalogEntry[]=[],mapController:Awaited<ReturnType<typeof import('./map').createMap>>|null=null;
  let mapLoading=false;
  const pageSize=12;
  let limit=pageSize;
  let lastOrder='';
  const more=root.querySelector<HTMLElement>('[data-load-more-region]')!;
  const moreButton=root.querySelector<HTMLButtonElement>('[data-load-more]')!;
  function renderCards() {
    const shown=new Set(visible.slice(0,limit).map(s=>s.id));
    for(const [id,card] of cards) card.hidden=!shown.has(id || '');
    const order=visible.map(s=>s.id).join(',');
    const changed=order!==lastOrder;
    if(changed) {for(const s of visible) {const card=cards.get(s.id);if(card) grid.append(card);}lastOrder=order;}
    if(unrankedDivider) {
      const first=visible.slice(0,limit).find(s=>!s.eligible);
      const isRecommended=(form.elements.namedItem('sort') as HTMLSelectElement).value==='recommended';
      unrankedDivider.hidden=!first || !isRecommended;
      if(first && isRecommended) grid.insertBefore(unrankedDivider,cards.get(first.id)!);
    }
    more.hidden=visible.length===0;
    more.querySelector('[data-page-count]')!.textContent=`已显示 ${Math.min(limit,visible.length)} / ${visible.length} 家`;
    moreButton.hidden=limit>=visible.length;
    moreButton.textContent=`再看 ${Math.min(pageSize,Math.max(0,visible.length-limit))} 家`;
    return changed;
  }
  moreButton.addEventListener('click',()=>{
    const next=cards.get(visible[limit]?.id);
    limit+=pageSize;renderCards();
    next?.querySelector<HTMLAnchorElement>('h3 a')?.focus();
  });
  const read = ():Filters => ({age:'',rating:'',...Object.fromEntries(keys.map(key=>[key,(form.elements.namedItem(key) as HTMLInputElement|HTMLSelectElement).value]))}) as Filters;
  function restore() {
    const params=new URLSearchParams(location.search);
    for(const key of keys) {
      const field=form.elements.namedItem(key) as HTMLInputElement|HTMLSelectElement;
      const value=params.get(key) || (key==='sort' ? 'recommended':'');
      field.value=key==='q' ? value.slice(0,160):value;
      if(field instanceof HTMLSelectElement && field.selectedIndex<0) field.selectedIndex=0;
    }
  }
  function update(writeUrl=true,resetPage=true) {
    const focusedCard=document.activeElement?.closest<HTMLElement>('[data-shop-card]');
    const focusedIndex=focusedCard ? visible.findIndex(shop=>shop.id===focusedCard.dataset.shopId):-1;
    const f=read(),saved=new Set(getFavoriteIds());
    if(resetPage) limit=pageSize;
    visible=searchCatalog(favoritesOnly ? all.filter(s=>saved.has(s.id)):all,f);
    const listChanged=renderCards();
    const active=keys.filter(k=>k!=='q' && k!=='sort' && f[k]).length;
    root!.querySelector('[data-filter-summary]')!.textContent=`${active ? `${active} 项筛选`:'全深圳'} · ${(form.elements.namedItem('sort') as HTMLSelectElement).selectedOptions[0]?.textContent || ''}`;
    grid.hidden=visible.length===0;
    root!.querySelector('[data-result-count]')!.textContent=`${visible.length} 家${favoritesOnly ? '收藏':'已收录'}`;
    if(favoriteEmpty) favoriteEmpty.hidden=!favoritesOnly || saved.size>0;
    empty.hidden=visible.length>0 || (favoritesOnly && saved.size===0);
    const noData=all.length===0;
    empty.querySelector('[data-empty-title]')!.textContent=noData ? payload.pendingCount ? '门店资料核验中':'榜单资料接入中':'没有符合条件的门店';
    empty.querySelector('[data-empty-description]')!.textContent=noData ? payload.pendingCount ? `已读取 ${payload.pendingCount} 家真实高德候选，正在核验门店资料。可先查看候选的原始记录。`:'正式收录需要高德扫街榜依据、可核验门店信息与近期营业线索。当前没有满足核验条件的正式记录。':'可以清除或减少筛选条件。未知价格、评分不会被归入确定的分组。';
    if(favoritesOnly && focusedCard?.hidden) {
      const fallback=visible[Math.min(Math.max(focusedIndex,0),visible.length-1)];
      const target=fallback ? cards.get(fallback.id)?.querySelector<HTMLAnchorElement>('h3 a'):null;
      if(target) target.focus();
      else {
        const heading=root!.querySelector<HTMLElement>('.section-heading h2');
        if(heading) {heading.tabIndex=-1;heading.focus();}
      }
    }
    root!.querySelector('[data-sort-note]')!.textContent=f.sort==='recommended'
      ? `当前结果：${visible.filter(s=>s.eligible).length} 家参评 · ${visible.filter(s=>!s.eligible).length} 家未参评；未参评门店另列，不代表低分`
      : '参评组名次保持不变；当前仅改变阅读顺序';
    if(listChanged) mapController?.update(visible);
    if(writeUrl) {
      const url=new URL(location.href);
      for(const legacy of ['edition','age','rating'])url.searchParams.delete(legacy);
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
  window.addEventListener('favorites-change',()=>{
    const active=document.activeElement instanceof HTMLElement ? document.activeElement:null;
    const activeCard=active?.closest<HTMLElement>('[data-shop-card]');
    const previousIndex=activeCard ? visible.findIndex(s=>s.id===activeCard.dataset.shopId):-1;
    update(false,false);
    if(activeCard?.hidden) {
      const replacement=visible[Math.min(Math.max(previousIndex,0),Math.min(limit,visible.length)-1)];
      const target=replacement ? cards.get(replacement.id)?.querySelector<HTMLButtonElement>('[data-favorite]'):root!.querySelector<HTMLElement>('.section-heading h2');
      if(target) {if(!replacement) target.tabIndex=-1;target.focus();}
    } else if(activeCard && active && document.activeElement!==active) active.focus({preventScroll:true});
  });
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
