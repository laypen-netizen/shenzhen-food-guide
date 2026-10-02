import type { Recommendation } from './recommendation.ts';
import type { Shop } from './schema.ts';
import { ageAt, annualCompositeRanking, annualHeatValue } from './schema.ts';
import { compositeScore } from './scoring.ts';
import type { CatalogEntry } from './catalog-search.ts';
import { normalizeSearchText } from './search-text.ts';

// Build-time only. Keep source records and validation code off the browser path.
export function createCatalogIndex(shops: Shop[], recommendations?:Map<string,Recommendation>): CatalogEntry[] {
  return shops.map((shop, order) => {
    const latest = [...shop.ratings].sort((a,b)=>b.asOf.localeCompare(a.asOf))[0];
    const years = [...new Set(shop.rankings.flatMap(r=>r.annualCompositeScore?.year != null ? [r.annualCompositeScore.year]:[]))];
    return {
      id:shop.id, slug:shop.slug, name:shop.name, district:shop.district, category:shop.category,
      search:normalizeSearchText([shop.name,...shop.aliases,shop.district,shop.category,shop.address.text,shop.summary.text,shop.cuisine,...shop.dishes.map(d=>d.text)].join(' ')),
      address:{text:shop.address.text},
      coordinates:shop.coordinates ? {lon:shop.coordinates.lon,lat:shop.coordinates.lat}:null,
      price:shop.price?.cny ?? null, age:ageAt(shop,shop.checkedAt), rating:latest?.max===5 ? latest.value:null,
      eligible:recommendations?.get(shop.id)?.eligible??false, repeat:!!shop.repeatVisits, composite:compositeScore(shop).score, order,
      editions:[...new Set(shop.rankings.map(r=>r.edition==='2026' ? '2026':r.edition==='2025' ? '2025':'undated'))],
      heat2026:annualHeatValue(shop,2026),
      annual:Object.fromEntries(years.map(year=>[year,annualCompositeRanking(shop,year)?.annualCompositeScore?.value ?? null])),
    };
  });
}
