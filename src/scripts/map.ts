import type { Shop } from '../lib/schema';
import { gcjToWgs,navigationUrl } from '../lib/geo';
import 'leaflet/dist/leaflet.css';

export async function createMap(element:HTMLElement,status:HTMLElement,base:string) {
  const L=await import('leaflet');
  const map=L.map(element,{scrollWheelZoom:false}).setView([22.60,114.06],11);
  const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
  const markers=L.layerGroup().addTo(map);
  let failed=false;
  tiles.on('tileerror',()=>{failed=true;status.textContent='底图暂时无法加载；门店列表、地址与高德导航仍可使用。'});
  function update(shops:Shop[]) {
    markers.clearLayers();const mapped=shops.filter(s=>s.coordinates);
    const points:[number,number][]=[];
    for(const shop of mapped) {
      const coords=shop.coordinates!,[lon,lat]=gcjToWgs(coords.lon,coords.lat);points.push([lat,lon]);
      const content=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('a'),nav=document.createElement('a');
      name.textContent=shop.name;detail.textContent='查看门店';detail.href=`${base}shops/${shop.slug}/`;
      nav.textContent='高德导航 ↗';nav.href=navigationUrl(shop);nav.target='_blank';nav.rel='noopener noreferrer';
      content.className='map-popup';content.append(name,detail,nav);
      L.marker([lat,lon],{title:shop.name,alt:shop.name,icon:L.divIcon({className:'food-marker',html:'<span aria-hidden="true">食</span>',iconSize:[34,40],iconAnchor:[17,40]})}).bindPopup(content).addTo(markers);
    }
    if(points.length) map.fitBounds(L.latLngBounds(points).pad(0.2),{maxZoom:15});
    if(!failed) status.textContent=mapped.length ? `地图显示 ${mapped.length} 家门店；${shops.length-mapped.length} 家暂无可靠坐标，可用高德地址搜索。`:'当前没有经过核验的门店坐标。底图用于区域参考，未放置推测的门店标记。';
  }
  return {update,resize:()=>setTimeout(()=>map.invalidateSize(),0)};
}
