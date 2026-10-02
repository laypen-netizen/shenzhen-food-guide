export function normalizePoi(poi:Record<string,unknown>, asOf:string) {
  const business=poi.business && !Array.isArray(poi.business) && typeof poi.business==='object' ? poi.business as Record<string,unknown>:{};
  const text=(v:unknown) => typeof v==='string' && v.trim() ? v.trim():null;
  const number=(v:unknown) => { const s=text(v);return s!==null && Number.isFinite(Number(s)) ? Number(s):null; };
  const rawCoords=text(poi.location)?.split(',').map(Number);
  const coords=rawCoords?.length===2 && rawCoords.every(Number.isFinite) ? {lon:rawCoords[0],lat:rawCoords[1],system:'GCJ-02'}:null;
  const photos=Array.isArray(poi.photos) ? poi.photos as Record<string,unknown>[]:[];
  return {
    poiId:text(poi.id), name:text(poi.name), address:text(poi.address), district:text(poi.adname),
    city:text(poi.cityname), category:text(poi.type), coordinates:coords,
    rawRating:number(business.rating), ratingScale:null, ratingCount:null,
    costCny:number(business.cost), hours:text(business.opentime_week), todayHours:text(business.opentime_today), tags:text(business.tag),
    photoReferences:photos.map(p=>({title:text(p.title),url:text(p.url),permissionVerified:false})),
    collectedAt:asOf, source:'高德 POI 2.0',
    rankingEvidence:null, repeatMetric:null, historyEvidence:null,
    warning:'普通 POI 不等于扫街榜；量表、图片使用权、上榜和门店历史须另行核验。',
  };
}
