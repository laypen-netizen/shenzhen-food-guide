import type { APIRoute } from 'astro';
import { catalogue, shops, recommendationById } from '../lib/catalogue';
import { recommendationVersion, minimumComparisonSize } from '../lib/recommendation';

// Static, build-time evidence. The browser never recalculates the ranking.
export const GET:APIRoute=()=>new Response(JSON.stringify({
  model:recommendationVersion,
  snapshot:[...recommendationById.values()][0]?.version??null,
  observedAt:catalogue.updatedAt,
  methodUpdatedAt:'2026-10-03',
  interpretation:'同口径双证据部分序下的相对位置区间与非支配层。区间不是统计置信区间、满意率、质量分、真实客流、全深圳排名或反刷认证。',
  rule:{
    scoreLower:'100 * (2 * leadCount + tieCount) / (2 * (sampleSize - 1))',
    scoreUpper:'100 * (2 * (leadCount + incomparableCount) + tieCount) / (2 * (sampleSize - 1))',
    rankBest:'dominatedCount + 1',rankWorst:'sampleSize - leadCount - tieCount',
    order:'Pareto layers ascending; district, name, id within each layer for browsing only',
    ties:'Identical observations stay in tied blocks; percentiles use average occupied rank (midrank).',
    bounds:'Extrema over linear extensions of the strict dominance order with identical observations kept in tied blocks; not statistical confidence intervals.',
    displayRounding:'Outward to integers; never used for sorting or grouping',
    comparisonGroup:'Largest group; newest observation date then stable group key on equal sizes',
    minimumComparisonSize,minimumIsEditorialPolicy:true,weights:null,
    reviewCountAddsPoints:false,approximateRepeatEligible:false,missingValue:null,
  },
  included:shops.length,
  eligible:shops.filter(s=>recommendationById.get(s.id)?.eligible).length,
  shops:shops.map(shop=>{
    const result=recommendationById.get(shop.id)!;
    return {id:shop.id,name:shop.name,...result};
  }),
},null,2),{headers:{'Content-Type':'application/json; charset=utf-8'}});
