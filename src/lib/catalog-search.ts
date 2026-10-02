import type { Filters } from './filtering.ts';
export type CatalogEntry = {
  id:string; slug:string; name:string; district:string; category:string; search:string;
  address:{text:string}; coordinates:{lon:number;lat:number}|null;
  price:number|null; age:number|null; rating:number|null; repeat:boolean; composite:number|null;
  order:number; annual:Record<string,number|null>; editions:string[]; heat2026:number|null;
};
const nullable=(a:number|null|undefined,b:number|null|undefined,descending=true)=>a==null ? b==null ? 0:1:b==null ? -1:descending ? b-a:a-b;
export function searchCatalog(shops:CatalogEntry[],f:Filters) {
  const query=f.q.trim().toLocaleLowerCase();
  return shops.filter(s=>{
    if(query && !s.search.includes(query)) return false;
    if((f.district && s.district!==f.district)||(f.category && s.category!==f.category)) return false;
    if(f.edition && !s.editions.includes(f.edition)) return false;
    if(f.repeat==='verified' && !s.repeat) return false;
    if(f.price) {const [min,max]=f.price.split('-').map(Number);if(s.price===null || s.price<min || s.price>=max) return false;}
    if(f.age==='unknown') {if(s.age!==null) return false;}
    else if(f.age) {const [min,max]=f.age.split('-').map(Number);if(s.age===null || s.age<min || s.age>=max) return false;}
    if(f.rating && (s.rating===null || s.rating<Number(f.rating))) return false;
    return true;
  }).sort((a,b)=>{
    let n=0;
    if(f.sort==='recommended') n=a.order-b.order;
    if(/^annual-\d{4}$/.test(f.sort)) {const year=f.sort.slice(7);n=nullable(a.annual[year],b.annual[year]) || (a.annual[year]!=null&&b.annual[year]!=null ? a.name.localeCompare(b.name,'zh-CN'):0);}
    if(f.sort==='heat-2026') n=nullable(a.heat2026,b.heat2026);
    if(f.sort==='rating') n=nullable(a.rating,b.rating);
    if(f.sort==='price') n=nullable(a.price,b.price,false);
    if(f.sort==='age') n=nullable(a.age,b.age);
    if(f.sort==='composite') n=nullable(a.composite,b.composite);
    return n || a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN');
  });
}
