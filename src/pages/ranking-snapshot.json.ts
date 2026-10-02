import type { APIRoute } from 'astro';
import {createHash} from 'node:crypto';
import {catalogue,shops,ratingById} from '../lib/catalogue';
import {getRankingYears} from '../lib/amap-rating';

// Keep the existing URL usable, now with source ratings rather than site scores.
export const GET:APIRoute=()=>{
  const records=shops.map(shop=>{
    const rating=ratingById.get(shop.id)??null;
    const sources=catalogue.sources.filter(source=>rating?.sourceIds.includes(source.id));
    return {id:shop.id,name:shop.name,rating,rankingYears:getRankingYears(shop),
      sources:sources.map(source=>({id:source.id,url:source.url,channel:source.ratingChannel??null}))};
  });
  const hash=createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0,12);
  return new Response(JSON.stringify({
    model:'amap-displayed-rating-v1',
    snapshot:`amap-displayed-rating-v1:${catalogue.updatedAt}:${hash}`,
    observedAt:catalogue.updatedAt,
    interpretation:'高德餐厅评分原始记录。按展示数值降序浏览，同分按地区、店名排列；不代表高德官方总榜。',
    rule:{order:'displayed rating descending, then district, name, id',derivedScore:false,
      missingValue:null,reviewCountAddsPoints:false,repeatVisitsAffectOrder:false,
      scaleNormalization:false,yearTags:'Explicit ranking edition only; observation dates do not establish edition'},
    included:shops.length,
    rated:records.filter(record=>record.rating!==null).length,
    shops:records,
  },null,2),{headers:{'Content-Type':'application/json; charset=utf-8'}});
};
