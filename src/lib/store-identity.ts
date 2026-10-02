// Stable POI identity is shared across renamed records and annual rankings.
export function amapPoiId(url:string):string|null {
  try {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:' || !(parsed.hostname==='amap.com'||parsed.hostname.endsWith('.amap.com'))) return null;
    const id=parsed.searchParams.get('id') || parsed.searchParams.get('poiid') || parsed.pathname.match(/^\/place\/([A-Z0-9]+)\/?$/i)?.[1];
    return id && /^B[A-Z0-9]{5,}$/i.test(id) ? id.toUpperCase():null;
  } catch {return null;}
}
export function normalizedStoreText(text:string) {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[\s·•.()（）【】\[\]_-]+/g,'');
}
