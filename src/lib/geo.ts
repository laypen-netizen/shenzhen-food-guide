import type { Shop } from './schema.ts';

// WGS-84/GCJ-02 坐标转换只用于展示与导航，不推断门店坐标。
const pi = Math.PI, a = 6378245, ee = 0.006693421622965943;
function delta(lon:number,lat:number) {
  const x = lon-105,y = lat-35;
  let dLat = -100+2*x+3*y+0.2*y*y+0.1*x*y+0.2*Math.sqrt(Math.abs(x));
  let dLon = 300+x+2*y+0.1*x*x+0.1*x*y+0.1*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLat += (20*Math.sin(y*pi)+40*Math.sin(y/3*pi))*2/3;
  dLat += (160*Math.sin(y/12*pi)+320*Math.sin(y*pi/30))*2/3;
  dLon += (20*Math.sin(6*x*pi)+20*Math.sin(2*x*pi))*2/3;
  dLon += (20*Math.sin(x*pi)+40*Math.sin(x/3*pi))*2/3;
  dLon += (150*Math.sin(x/12*pi)+300*Math.sin(x/30*pi))*2/3;
  const rad = lat/180*pi, magic = 1-ee*Math.sin(rad)**2, root = Math.sqrt(magic);
  return [dLon*180/(a/root*Math.cos(rad)*pi),dLat*180/(a*(1-ee)/(magic*root)*pi)] as [number,number];
}
export function wgsToGcj(lon:number,lat:number): [number,number] {
  if (lon<72.004 || lon>137.8347 || lat<0.8293 || lat>55.8271) return [lon,lat];
  const d = delta(lon,lat); return [lon+d[0],lat+d[1]];
}
export function gcjToWgs(lon:number,lat:number): [number,number] {
  let guess:[number,number] = [lon,lat];
  for(let i=0;i<5;i++) { const calculated = wgsToGcj(...guess); guess = [guess[0]+lon-calculated[0],guess[1]+lat-calculated[1]]; }
  return guess;
}
export function straightDistance(lon1:number,lat1:number,lon2:number,lat2:number) {
  const rad = pi/180;
  const h = Math.sin((lat2-lat1)*rad/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon1)*rad/2)**2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function navigationUrl(shop: Shop) {
  if (shop.coordinates) {
    const {lon,lat} = shop.coordinates;
    const params = new URLSearchParams({ to:`${lon},${lat},${shop.name}`, mode:'walk', coordinate:'gaode', src:'shenzhen-food-guide',callnative:'1' });
    return `https://uri.amap.com/navigation?${params}`;
  }
  const params = new URLSearchParams({ keyword:`${shop.name} ${shop.address.text}`, city:'深圳',view:'list',src:'shenzhen-food-guide',callnative:'1' });
  return `https://uri.amap.com/search?${params}`;
}
