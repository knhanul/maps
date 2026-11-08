(() => {
'use strict';
const KEY='gildam.places.v1', KINDS=['attraction','museum','park','garden','peak','viewpoint','beach','zoo','castle','monument','memorial','building','townhall','university','library','theatre','stadium','place_of_worship'];
const TYPES={attraction:'관광지',museum:'박물관',park:'공원',garden:'정원',peak:'산봉우리',viewpoint:'전망 지점',beach:'해변',zoo:'동물원',castle:'성·유적',monument:'기념물',memorial:'기념 장소',building:'건물',townhall:'청사',university:'대학교',library:'도서관',theatre:'공연장',stadium:'경기장',place_of_worship:'종교 시설'};
let enabled=true;try{enabled=JSON.parse(localStorage.getItem(KEY))??true;}catch{}
let map,baseFilter,appliedFilter,lastSignature,features=[],popup,installed=false,refreshing=false;
const name=p=>String(p['name:ko']||p.name||p['pgf:name']||'');
const normal=s=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const distance=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360)*111320,(a[1]-b[1])*111320);
function dedup(items,existing=[]){const out=[];for(const f of items){const c=f.geometry?.coordinates,p=f.properties||{};if(!c||!name(p))continue;if([...existing,...out].some(g=>(p.canonicalId&&p.canonicalId===g.properties?.canonicalId)||(normal(name(p))===normal(name(g.properties||{}))&&distance(c,g.geometry.coordinates)<150)))continue;out.push(f);}return out;}
function visibleTourism(){if(!map?.getSource('tourism-places')||refreshing)return;refreshing=true;try{const b=map.getBounds();const nearby=[];for(const f of map.querySourceFeatures('protomaps',{sourceLayer:'pois'}).slice(0,5000)){if(f.geometry?.type==='Point')nearby.push(f);}
const list=features.filter(f=>b.contains(f.geometry.coordinates)).slice(0,600);const data={type:'FeatureCollection',features:dedup(list,nearby).slice(0,200)};const signature=JSON.stringify(data);if(signature!==lastSignature){lastSignature=signature;map.getSource('tourism-places').setData(data);}
}finally{refreshing=false;}}
function apply(fresh=false){map=window.__map;if(!map)return;
const base=map.getStyle().layers.find(l=>l.id==='pois');if(base&&(fresh||baseFilter===undefined)&&JSON.stringify(base.filter)!==JSON.stringify(appliedFilter))baseFilter=base.filter;
if(base){appliedFilter=enabled?['all',baseFilter||true,['!', ['in',['get','kind'],['literal',KINDS]]]]:baseFilter||null;map.setFilter('pois',appliedFilter);}
let dark=false;try{dark=JSON.parse(localStorage.getItem('gildam.style.v1')||'"light"')==='dark';}catch{}
if(!map.getLayer('gildam-major-places'))map.addLayer({id:'gildam-major-places',type:'symbol',source:'protomaps','source-layer':'pois',minzoom:12,filter:['all',['any',['has','name'],['has','name:ko'],['has','pgf:name']],['in',['get','kind'],['literal',KINDS]],['>=',['zoom'],['match',['get','kind'],['peak','beach'],12,['park','garden','attraction','viewpoint','castle','monument','memorial'],13,['museum','zoo','theatre'],14,15]]],layout:{'text-field':['coalesce',['get','name:ko'],['get','name'],['get','pgf:name']],'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],12,11,18,15],'text-max-width':9,'text-offset':[0.9,0],'text-anchor':'left','text-padding':8,'text-allow-overlap':false,'icon-image':['match',['get','kind'],'museum','museum',['park','garden'],'park','peak','peak','beach','beach','zoo','zoo','university','university','library','library','theatre','theatre','stadium','stadium',['building','townhall'],'building','attraction'],'icon-allow-overlap':false,'symbol-sort-key':['coalesce',['get','min_zoom'],16]},paint:{'text-color':dark?'#f3ddb0':'#614315','text-halo-color':dark?'#202b33':'#fffdf6','text-halo-width':1.5}},map.getLayer('tracks-casing')?'tracks-casing':undefined);
map.setLayoutProperty('gildam-major-places','visibility',enabled?'visible':'none');
if(!map.getSource('tourism-places')){lastSignature=undefined;map.addSource('tourism-places',{type:'geojson',data:{type:'FeatureCollection',features:[]}});}
if(!map.getLayer('gildam-tourism-places'))map.addLayer({id:'gildam-tourism-places',type:'symbol',source:'tourism-places',minzoom:12,layout:{'icon-image':'attraction','text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':12,'text-offset':[0.9,0],'text-anchor':'left','text-padding':8,'text-allow-overlap':false,'icon-allow-overlap':false},paint:{'text-color':dark?'#f3ddb0':'#614315','text-halo-color':dark?'#202b33':'#fffdf6','text-halo-width':1.5}});
map.setLayoutProperty('gildam-tourism-places','visibility',enabled?'visible':'none');
map.setPaintProperty('gildam-major-places','text-color',dark?'#f3ddb0':'#614315');map.setPaintProperty('gildam-major-places','text-halo-color',dark?'#202b33':'#fffdf6');
map.setPaintProperty('gildam-tourism-places','text-color',dark?'#f3ddb0':'#614315');map.setPaintProperty('gildam-tourism-places','text-halo-color',dark?'#202b33':'#fffdf6');
const toggle=document.getElementById('lyPlaces');if(toggle)toggle.checked=!!enabled;visibleTourism();}
window.__applyPlaces=apply;
window.__openPlace=e=>{if(!enabled||!map)return false;const layers=['gildam-major-places','gildam-tourism-places'].filter(x=>map.getLayer(x));const f=map.queryRenderedFeatures(e.point,{layers})[0];if(!f)return false;
const p=f.properties||{},tour=f.layer.id==='gildam-tourism-places',box=document.createElement('div');box.style.cssText='max-width:270px;max-height:320px;overflow:auto;color:#202b25;line-height:1.6';
for(const [tag,text]of [['h3',name(p)],['p',tour?(p.description||'원자료에 상세 설명이 제공되지 않았습니다.'):`${TYPES[p.kind]||p.kind} · 지도에 등록된 장소입니다. 원자료에 상세 설명은 포함되어 있지 않습니다.`],['small',tour?`출처: 한국관광공사 TourAPI · 수정일 ${p.modified||'미제공'}`:`출처: OpenStreetMap 기여자 · 지도 ${window.__gildamManifest?.version||''} · 원자료 갱신일 미제공`]]){const node=document.createElement(tag);node.textContent=text;box.appendChild(node);}
const a=document.createElement('a');a.textContent='원자료 출처';a.href=tour?'https://www.data.go.kr/data/15101578/openapi.do':'https://www.openstreetmap.org/copyright';a.target='_blank';a.rel='noopener noreferrer';box.appendChild(document.createElement('br'));box.appendChild(a);popup?.remove();popup=new maplibregl.Popup({maxWidth:'300px'}).setLngLat(f.geometry.type==='Point'?f.geometry.coordinates:e.lngLat).setDOMContent(box).addTo(map);return true;};
async function start(){if(installed||!window.__gildamReady)return;installed=true;map=window.__map;apply(true);
document.getElementById('lyPlaces').onchange=e=>{enabled=e.target.checked;try{localStorage.setItem(KEY,JSON.stringify(enabled));}catch{}if(!enabled)popup?.remove();apply();};
map.on('idle',visibleTourism);
try{const status=await(await fetch('/places/status.json',{cache:'no-cache'})).json();document.getElementById('tourismStatus').textContent=status.enabled?'관광공사 보강 데이터 '+status.count+'곳'+(status.complete===false?' (일부 수록)':'')+' · '+new Date(status.updated).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST':'관광공사 보강: 전용 인증키 등록 전 · 현재 OSM 장소를 표시합니다.';if(status.enabled){const data=await(await fetch('/places/tourism.geojson',{cache:'no-cache'})).json();features=(data.features||[]).slice(0,20000);visibleTourism();}}catch{document.getElementById('tourismStatus').textContent='관광공사 보강 상태를 확인하지 못했습니다. OSM 장소는 계속 표시합니다.';}}
window.__placesTest={dedup,normal,apply,getEnabled:()=>enabled};
const timer=setInterval(()=>{if(window.__gildamReady){clearInterval(timer);start();}},100);start();
})();
