import type { Recommendation } from './recommendation.ts';
import type { Shop } from './schema.ts';
import type { CatalogEntry } from './catalog-search.ts';
import { normalizeSearchText } from './search-text.ts';

// Build-time only. Keep source records and validation code off the browser path.
export function createCatalogIndex(shops: Shop[], recommendations?:Map<string,Recommendation>): CatalogEntry[] {
  return shops.map((shop, order) => {
    return {
      id:shop.id, slug:shop.slug, name:shop.name, district:shop.district, category:shop.category,
      search:normalizeSearchText([shop.name,...shop.aliases,shop.district,shop.category,shop.address.text,shop.summary.text,shop.cuisine,...shop.dishes.map(d=>d.text)].join(' ')),
      address:{text:shop.address.text},
      coordinates:shop.coordinates ? {lon:shop.coordinates.lon,lat:shop.coordinates.lat}:null,
      price:shop.price?.cny ?? null,
      eligible:recommendations?.get(shop.id)?.eligible??false, repeat:!!shop.repeatVisits, order,
    };
  });
}
