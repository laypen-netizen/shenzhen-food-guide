import type { Filters } from './filtering.ts';
import { createSearchTokens,matchesSearchTokens } from './search-text.ts';
export type CatalogEntry = {
  id:string; slug:string; name:string; district:string; category:string; search:string;
  address:{text:string}; coordinates:{lon:number;lat:number}|null;
  price:number|null; repeat:boolean; eligible:boolean; order:number;
};
const nullable=(a:number|null|undefined,b:number|null|undefined,descending=true)=>a==null ? b==null ? 0:1:b==null ? -1:descending ? b-a:a-b;
export function searchCatalog(shops:CatalogEntry[],f:Filters) {
  const tokens=createSearchTokens(f.q);
  return shops.filter(s=>{
    if(!matchesSearchTokens(s.search,tokens)) return false;
    if((f.district && s.district!==f.district)||(f.category && s.category!==f.category)) return false;
    if(f.repeat==='verified' && !s.repeat) return false;
    if(f.price) {const [min,max]=f.price.split('-').map(Number);if(s.price===null || s.price<min || s.price>=max) return false;}
    return true;
  }).sort((a,b)=>{
    let n=0;
    if(f.sort==='recommended') n=a.order-b.order;
    if(f.sort==='price') n=nullable(a.price,b.price,false);
    return n || a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN');
  });
}
