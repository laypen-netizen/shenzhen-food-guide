import type { APIRoute } from 'astro';
import { catalogue, shops, recommendationById } from '../lib/catalogue';
import { recommendationVersion, minimumComparisonSize } from '../lib/recommendation';

// Static, build-time evidence. The browser never recalculates the ranking.
export const GET:APIRoute=()=>new Response(JSON.stringify({
  model:recommendationVersion,
  snapshot:[...recommendationById.values()][0]?.version??null,
  observedAt:catalogue.updatedAt,
  interpretation:'同口径组内双项共同领先的比例。不是满意率、真实客流、全深圳排名或反刷认证。',
  rule:{formula:'round(100 * (leadCount + 0.5 * tieCount) / (sampleSize - 1))',minimumComparisonSize,weights:null,reviewCountAddsPoints:false,missingValue:null},
  included:shops.length,
  eligible:shops.filter(s=>recommendationById.get(s.id)?.eligible).length,
  shops:shops.map(shop=>{
    const result=recommendationById.get(shop.id)!;
    return {id:shop.id,name:shop.name,...result};
  }),
},null,2),{headers:{'Content-Type':'application/json; charset=utf-8'}});
