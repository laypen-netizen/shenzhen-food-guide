import type { Shop } from './schema.ts';
import { ageAt,annualCompositeRanking,annualHeatValue } from './schema.ts';
import { getAmapRating } from './amap-rating.ts';
import { createSearchTokens,matchesSearchTokens,normalizeSearchText } from './search-text.ts';
export type Filters = { q:string; district:string; category:string; price:string; age:string; rating:string; repeat?:string; edition?:string; sort:string };
export function selectShops(shops:Shop[], f:Filters) {
  const tokens=createSearchTokens(f.q);
  const order=new Map(shops.map((shop,index)=>[shop.id,index]));
  const result = shops.filter(s => {
    const searchText=normalizeSearchText([s.name,...s.aliases,s.district,s.category,s.address.text,s.summary.text,s.cuisine,...s.dishes.map(d=>d.text)].join(' '));
    if (!matchesSearchTokens(searchText,tokens)) return false;
    if (f.district && s.district !== f.district || f.category && s.category !== f.category) return false;
    if (f.edition && !s.rankings.some(r=>(r.edition==='2026' ? '2026':r.edition==='2025' ? '2025':'undated')===f.edition)) return false;
    if (f.repeat==='verified' && !s.repeatVisits) return false;
    if (f.price) { const [min,max]=f.price.split('-').map(Number); if (!s.price || !(s.price.cny>=min && s.price.cny<max)) return false; }
    if (f.age) {
      const age=ageAt(s,s.checkedAt);
      if (f.age==='unknown') { if(age!==null) return false; }
      else { const [min,max]=f.age.split('-').map(Number); if(age===null || !(age>=min && age<max)) return false; }
    }
    if (f.rating) {const latest=getAmapRating(s);if(!latest || latest.value<Number(f.rating)) return false;}
    return true;
  });
  const defaultOrder = (a:Shop,b:Shop) => a.district.localeCompare(b.district,'zh-CN') || a.name.localeCompare(b.name,'zh-CN') || a.id.localeCompare(b.id);
  const rating = (s:Shop) => getAmapRating(s)?.value;
  const annual2025 = (s:Shop) => annualCompositeRanking(s,2025)?.annualCompositeScore?.value;
  const nullable = (a:number|undefined|null,b:number|undefined|null,descending:boolean) => a==null ? b==null ? 0:1 : b==null ? -1:(descending ? b-a:a-b);
  return result.sort((a,b) => {
    let n=0;
    if(f.sort==='recommended') n=order.get(a.id)!-order.get(b.id)!;
    if(f.sort==='annual-2025') n=nullable(annual2025(a),annual2025(b),true)
      || (annual2025(a)!==undefined && annual2025(b)!==undefined ? a.name.localeCompare(b.name,'zh-CN'):0);
    if(f.sort==='heat-2026') n=nullable(annualHeatValue(a,2026),annualHeatValue(b,2026),true);
    if(f.sort==='rating') n=nullable(rating(a),rating(b),true);
    if(f.sort==='price') n=nullable(a.price?.cny,b.price?.cny,false);
    if(f.sort==='age') n=nullable(ageAt(a,a.checkedAt),ageAt(b,b.checkedAt),true);
    return n || defaultOrder(a,b);
  });
}
