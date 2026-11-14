/* 이미지로 GPX 만들기: route map image overlay → align → pick line colour → A/B(+via) → trace → optional road snap → editor.
   The image never leaves the browser. Only sampled waypoints are sent to the own /routing/route when road snap is chosen. */
(()=>{'use strict';
const $=id=>document.getElementById(id),T=window.GildamTraceModel,M=window.GildamGpxModel,B=window.__courseBridge;
if(!T||!B||!$('traceTools'))return;
const MAX_SIDE=1600,MODE_NAME={walk:'걷기',hike:'등산',bike:'자전거'};
const router=M.createRouter();
let st=null; // {name,img,canvas,url,T,pairs,pendingPair,mode,color,tol,maskInfo,A,B,vias,result,snapped,opacity,...}
let handles=[],marks=[],seq=0,ctl=null,busy=false;
const map=()=>B.map();
const fc=f=>({type:'FeatureCollection',features:f});
const merc=ll=>{const m=maplibregl.MercatorCoordinate.fromLngLat(ll);return[m.x,m.y];};
const lngLat=([x,y])=>{const l=new maplibregl.MercatorCoordinate(x,y).toLngLat();return[l.lng,l.lat];};
const px2ll=(u,v)=>lngLat(T.apply(st.T,u,v));
const ll2px=ll=>T.invert(st.T,...merc(ll));
function status(text,error=false){const n=$('traceStatus');n.textContent=text;n.classList.toggle('err',error);}
function corners(){const{width:w,height:h}=st.img;return[[0,0],[w,0],[w,h],[0,h]].map(([u,v])=>px2ll(u,v));}
function ensureLayers(){const m=map();if(!m?.getSource('course'))throw Error('지도를 준비하는 중입니다. 잠시 후 다시 시도하세요.');
 const before=m.getLayer('tracks-casing')?'tracks-casing':undefined;
 if(!m.getSource('trace-img')){m.addSource('trace-img',{type:'image',url:st.url,coordinates:corners()});m.addLayer({id:'trace-img',type:'raster',source:'trace-img',paint:{'raster-opacity':st.opacity,'raster-fade-duration':0}},before);st.shownUrl=st.url;}
 for(const [id,color,width]of [['trace-line','#7b3fe4',4],['trace-snap','#ef8e15',5]])if(!m.getSource(id)){m.addSource(id,{type:'geojson',data:fc([])});m.addLayer({id,type:'line',source:id,layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':color,'line-width':width,'line-opacity':.95}});}
 if(!m.getSource('trace-warn')){m.addSource('trace-warn',{type:'geojson',data:fc([])});m.addLayer({id:'trace-warn',type:'line',source:'trace-warn',paint:{'line-color':'#d0021b','line-width':8,'line-opacity':.55}});}
 return m;}
function removeLayers(){const m=map();if(!m)return;for(const id of ['trace-img','trace-mask','trace-line','trace-snap','trace-warn']){if(m.getLayer(id))m.removeLayer(id);if(m.getSource(id))m.removeSource(id);}}
function setOverlay(){const m=ensureLayers();m.getSource('trace-img').setCoordinates(corners());if(m.getSource('trace-mask'))m.getSource('trace-mask').setCoordinates(corners());applyImageStyle();placeHandles();placeMarks();}
function lineData(C){return fc(C&&C.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:C}}]:[]);}
/* ---------- 1. load ---------- */
async function loadFile(file){if(!file)return;if(!/^image\//.test(file.type||'image/png'))return status('이미지 파일(PNG·JPG·WEBP)을 선택하세요.',true);if(file.size>25*1024*1024)return status('25MB 이하 이미지만 사용할 수 있습니다.',true);
 try{const bmp=await createImageBitmap(file);const k=Math.min(1,MAX_SIDE/Math.max(bmp.width,bmp.height)),w=Math.max(1,Math.round(bmp.width*k)),h=Math.max(1,Math.round(bmp.height*k));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const g=canvas.getContext('2d',{willReadFrequently:true});g.drawImage(bmp,0,0,w,h);bmp.close?.();
  close(true);st={name:(file.name||'이미지 경로').replace(/\.[^.]+$/,''),img:g.getImageData(0,0,w,h),canvas,url:canvas.toDataURL('image/png'),pairs:[],vias:[],opacity:.6,tol:60,gapCost:25,mode:'idle',scaled:k<1};
  // Place inside the map area not covered by the side panel (desktop) or bottom sheet (mobile).
  const m=map(),c=m.getContainer(),cw=c.clientWidth,ch=c.clientHeight,cr=c.getBoundingClientRect(),pr=$('panel').getBoundingClientRect();let x0=0,x1=cw,y0=0,y1=ch;
  if(pr.width&&pr.width<cw*.6){x0=Math.min(cw*.5,pr.right-cr.left);const lr=$('layers')?.getBoundingClientRect();if(lr?.width&&lr.left-cr.left>x0+200)x1=lr.left-cr.left-10;}else if(pr.height)y1=Math.max(ch*.3,pr.top-cr.top);
  const pad=.08,tl=merc(m.unproject([x0+(x1-x0)*pad,y0+(y1-y0)*pad])),br=merc(m.unproject([x1-(x1-x0)*pad,y1-(y1-y0)*pad])),s=Math.min((br[0]-tl[0])/w,(br[1]-tl[1])/h),cx=(tl[0]+br[0])/2,cy=(tl[1]+br[1])/2;
  st.T={a:s,b:0,tx:cx-s*w/2,ty:cy-s*h/2};st.baseS=s;st.emphasize=true;ensureLayers();setOverlay();
  status(`${file.name||'이미지'} · ${w}×${h}px${k<1?' (처리용으로 축소)':''}. 이제 위치를 맞추세요: [기준점 추가]로 이미지와 지도의 같은 지점을 2곳 이상 짝지으면 정확히 겹칩니다.`);render();}
 catch(e){status('이미지를 읽지 못했습니다: '+e.message,true);}}
/* ---------- 2. align: drag handles + control-point pairs ---------- */
function handleEl(cls,title){const el=document.createElement('div');el.className='trace-handle '+cls;el.title=title;return el;}
function placeHandles(){handles.forEach(h=>h.remove());handles=[];if(!st||st.locked||!B.inCourse())return;const m=map(),{width:w,height:h}=st.img;
 const mid=new maplibregl.Marker({element:handleEl('move','끌어서 이미지 이동'),draggable:true}).setLngLat(px2ll(w/2,h/2)).addTo(m);
 mid.on('drag',()=>{const p=merc(mid.getLngLat()),q=T.apply(st.T,w/2,h/2);st.T={...st.T,tx:st.T.tx+p[0]-q[0],ty:st.T.ty+p[1]-q[1]};redrawOverlay();});mid.on('dragend',dropFit);
 const rot=new maplibregl.Marker({element:handleEl('scale','끌어서 크기·회전 조절'),draggable:true}).setLngLat(px2ll(w,h)).addTo(m);
 rot.on('drag',()=>{const p=merc(rot.getLngLat()),c=T.apply(st.T,w/2,h/2),du=w/2,dv=h/2,px=p[0]-c[0],py=p[1]-c[1],d2=du*du+dv*dv,a=(px*du+py*dv)/d2,b=(py*du-px*dv)/d2;st.T={a,b,tx:c[0]-a*w/2+b*h/2,ty:c[1]-b*w/2-a*h/2};redrawOverlay(false);});rot.on('dragend',dropFit);
 handles=[mid,rot];}
function dropFit(){if(st.pairs.length){st.pairs=[];st.fitError=null;status('손으로 위치를 바꿔 기준점 맞춤을 초기화했습니다. 패널의 크기·회전·위치로 다시 맞춘 뒤 기준점을 찍으세요.');}setOverlay();render();}
let raf=0;function redrawOverlay(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;const m=map();m.getSource('trace-img')?.setCoordinates(corners());m.getSource('trace-mask')?.setCoordinates(corners());});}

function contrastUrl(){if(st.contrastUrl)return st.contrastUrl;const src=st.canvas,c=document.createElement('canvas');c.width=src.width;c.height=src.height;const g=c.getContext('2d');g.filter='contrast(1.5) saturate(1.65) brightness(1.06)';g.drawImage(src,0,0);g.filter='none';return st.contrastUrl=c.toDataURL('image/png');}
function applyImageStyle(){const m=map();if(!m?.getSource('trace-img')||!st)return;
 const pairing=st.mode==='pairImg'||st.mode==='pairMap',boost=pairing&&st.emphasize!==false,url=boost?contrastUrl():st.url;
 if(st.shownUrl!==url){try{m.getSource('trace-img').updateImage({url,coordinates:corners()});}catch{m.getSource('trace-img').setCoordinates(corners());}st.shownUrl=url;}
 if(m.getLayer('trace-img')){m.setPaintProperty('trace-img','raster-opacity',st.opacity);m.setPaintProperty('trace-img','raster-contrast',0);m.setPaintProperty('trace-img','raster-saturation',0);}
}
function syncOpacityUi(){const v=Math.round((st?.opacity??0.6)*100);if($('traceOpacity')){$('traceOpacity').value=String(v);$('traceOpacity').setAttribute('aria-valuenow',String(v));}if($('traceOpacityVal'))$('traceOpacityVal').textContent=v+'%';}

function canAdjust(){return !!(st&&!st.locked&&B.inCourse()&&!$('traceAlign').hidden);}
function imageCenter(){return px2ll(st.img.width/2,st.img.height/2);}
function scalePct(){const s=Math.hypot(st.T.a,st.T.b),base=st.baseS||s;return base>0?Math.round(100*s/base):100;}
function setScalePct(pct,commit=true){if(!canAdjust())return;const base=st.baseS||Math.hypot(st.T.a,st.T.b),cur=Math.hypot(st.T.a,st.T.b),next=base*Math.max(.05,Math.min(20,Number(pct)/100));if(!(cur>0)||!(next>0))return;st.T=T.scaleAround(st.T,st.img.width,st.img.height,next/cur);if(commit)dropFit();else{redrawOverlay();syncScaleUi();}}
function rotateBy(deg){if(!canAdjust())return;st.T=T.rotateAround(st.T,st.img.width,st.img.height,deg);dropFit();}
function nudgeByPixels(dx,dy){if(!canAdjust()||!(dx||dy))return;const m=map();if(!m?.project)return;const c=imageCenter(),p=m.project(c),q=m.unproject([p.x+dx,p.y+dy]),from=merc(c),to=merc(q);st.T=T.translate(st.T,to[0]-from[0],to[1]-from[1]);dropFit();}
function syncScaleUi(){if(!st||!$('traceScale'))return;const pct=Math.max(20,Math.min(400,scalePct()));$('traceScale').value=String(pct);$('traceScaleVal').textContent=scalePct()+'%';}
function startPair(){if(!st)return;st.mode='pairImg';st.pending=null;if(st.emphasize==null)st.emphasize=true;setOverlay();status('① 이미지에서 알아보기 쉬운 지점을 누르세요. (이미지 점 → 지도 점, 최소 2곳). 구분이 어려우면 [대비 강조]를 켜 두세요.');render();}
function pairClick(ll){if(st.mode==='pairImg'){const[u,v]=ll2px(ll);if(u<0||v<0||u>st.img.width||v>st.img.height)return status('이미지 안의 지점을 누르세요.',true);st.pending={u,v};st.mode='pairMap';setOverlay();status(`② 바탕 지도에서 방금 고른 지점과 같은 위치를 누르세요. (이미지 ${st.pairs.length+1}곳째 → 지도, 최소 2곳). 지도가 안 보이면 투명도를 낮추거나 [대비 강조]를 끄세요.`);render();return;}
 const[x,y]=merc(ll);st.pairs.push({...st.pending,x,y});st.pending=null;st.mode='idle';
 try{st.T=T.fitSimilarity(st.pairs,st.T);}catch(e){st.pairs.pop();status(e.message,true);setOverlay();render();return;}
 const mpu=1/maplibregl.MercatorCoordinate.fromLngLat(ll).meterInMercatorCoordinateUnits(),res=T.residuals(st.T,st.pairs).map(r=>r*mpu);
 st.fitError=st.pairs.length?{avg:res.reduce((a,b)=>a+b,0)/res.length,max:Math.max(...res)}:null;
 setOverlay();status(st.pairs.length<2?'기준점 1곳: 위치만 옮겼습니다. 멀리 떨어진 지점을 하나 더 짝지으면 크기·회전까지 맞춥니다.':`기준점 ${st.pairs.length}곳으로 맞췄습니다 · 평균 오차 ${Math.round(st.fitError.avg)}m, 최대 ${Math.round(st.fitError.max)}m${st.fitError.max>100?' — 오차가 크면 기준점을 지우고 다시 찍어 보세요.':''}`);render();}
/* ---------- 3. colour ---------- */
function startPick(){if(!st)return;st.mode='color';status('추출할 선(파란 선, 노란 선 등)을 누르세요.');render();}
function colorClick(ll){const[u,v]=ll2px(ll);try{st.color=T.pickColor(st.img,u,v,4);}catch(e){return status(e.message,true);}st.mode='idle';rebuildMask();if(!st.A)st.mode='A';render();}
function rebuildMask(){if(!st.color)return;st.maskInfo=T.buildMask(st.img,st.color,st.tol);st.result=st.snapped=null;drawMask();updateLines();const pct=st.maskInfo.count/(st.img.width*st.img.height)*100;
 status(`선 색 rgb(${st.color.join(',')}) · 인식 픽셀 ${st.maskInfo.count.toLocaleString()}개 (${pct.toFixed(1)}%)${pct>15?' — 너무 많이 잡힙니다. 허용 범위를 줄이세요.':pct<.05?' — 거의 잡히지 않습니다. 허용 범위를 늘리세요.':''}${st.A?'':' · 다음: 출발점(A)을 선 위에 누르세요.'}`);}
function drawMask(){const m=map();if(!st?.maskInfo){if(m.getLayer('trace-mask')){m.removeLayer('trace-mask');m.removeSource('trace-mask');}return;}
 const{width:w,height:h,mask}=st.maskInfo,c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d'),d=g.createImageData(w,h);for(let i=0;i<mask.length;i++)if(mask[i]){d.data[i*4]=255;d.data[i*4+1]=0;d.data[i*4+2]=200;d.data[i*4+3]=200;}g.putImageData(d,0,0);const url=c.toDataURL('image/png');
 if(m.getSource('trace-mask')){m.getSource('trace-mask').updateImage({url,coordinates:corners()});}else{m.addSource('trace-mask',{type:'image',url,coordinates:corners()});m.addLayer({id:'trace-mask',type:'raster',source:'trace-mask',paint:{'raster-opacity':.8,'raster-fade-duration':0}},'trace-line');}
 m.setLayoutProperty('trace-mask','visibility',$('traceShowMask').checked?'visible':'none');}
/* ---------- 4. A / B / via ---------- */
function pointClick(ll){const[u,v]=ll2px(ll),p=T.snapToMask(st.maskInfo,u,v,15);if(!p)return status('고른 색의 선 가까이를 누르세요. (안 잡히면 허용 범위를 늘리세요)',true);
 if(st.mode==='A'){st.A=p;st.mode=st.B?'idle':'B';status(st.B?'출발점을 바꿨습니다.':'다음: 도착점(B)을 선 위에 누르세요.');}
 else if(st.mode==='B'){st.B=p;st.mode='idle';status('출발·도착을 정했습니다. [선 따라 추출]을 누르세요. 엉뚱한 길로 가면 경유점을 가는 순서대로 추가하세요.');}
 else{st.vias.push(p);status(`경유점 ${st.vias.length}개 · 가는 순서대로 추가하세요. 추가 후 [선 따라 추출]을 다시 누르세요.`);}
 st.result=st.snapped=null;updateLines();placeMarks();render();}
function placeMarks(){marks.forEach(x=>x.remove());marks=[];if(!st||!B.inCourse())return;const m=map(),add=(p,label,cls)=>{const el=document.createElement('div');el.className='trace-mark '+cls;el.textContent=label;marks.push(new maplibregl.Marker({element:el}).setLngLat(px2ll(p[0]+.5,p[1]+.5)).addTo(m));};
 if(st.A)add(st.A,'A','a');if(st.B)add(st.B,'B','b');st.vias.forEach((p,i)=>add(p,String(i+1),'via'));
 st.pairs.forEach((p,i)=>{const el=document.createElement('div');el.className='trace-pair';el.title=`기준점 ${i+1}`;el.textContent='+';marks.push(new maplibregl.Marker({element:el}).setLngLat(lngLat([p.x,p.y])).addTo(m));});}
/* ---------- 5. extract ---------- */
async function extract(){if(!st?.maskInfo||!st.A||!st.B)return status('선 색, 출발점(A), 도착점(B)을 먼저 정하세요.',true);busy=true;render();status('선을 따라가는 중…');await new Promise(r=>setTimeout(r,30));
 try{const stops=[st.A,...st.vias,st.B];let path=[],bridged=[];for(let i=1;i<stops.length;i++){const r=T.tracePath(st.maskInfo,stops[i-1],stops[i],{gapCost:st.gapCost});path=path.concat(i>1?r.path.slice(1):r.path);bridged=bridged.concat(i>1?r.bridged.slice(1):r.bridged);}
  const simple=T.simplify(path,.8),coords=simple.map(([u,v])=>px2ll(u+.5,v+.5)),runs=T.bridgedRuns(bridged),mpp=T.length(coords)/Math.max(1,path.length);
  st.result={coords,pixels:path.length,bridgeMaxM:runs.max*mpp,bridgeTotalM:runs.total*mpp,length:T.length(coords)};st.snapped=null;updateLines();
  status(`추출 완료 · ${B.fmtKm(st.result.length)} · 점 ${coords.length}개 · 1픽셀 ≈ ${Math.round(mpp)}m${runs.max?` · 선이 끊긴 곳 최대 ${Math.round(st.result.bridgeMaxM)}m를 건너뜀`:''}. 보라색 선을 확인하고, 필요하면 [길 따라 보정] 후 편집기로 여세요.`);
  if(runs.max*mpp>500)status($('traceStatus').textContent+' 건너뛴 구간이 깁니다. 그 부근에 경유점을 추가해 보세요.',true);}
 catch(e){status('추출 실패: '+e.message+' 경유점을 추가하거나 허용 범위를 조절하세요.',true);}finally{busy=false;render();}}
function updateLines(){const m=map();if(!m?.getSource('trace-line'))return;m.getSource('trace-line').setData(lineData(st?.result?.coords));m.getSource('trace-snap').setData(fc((st?.snapped?.parts||[]).filter(p=>p.length>1).map(p=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:p}}))));m.getSource('trace-warn').setData(fc((st?.snapped?.warn||[]).map(c=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:c}}))));}
/* ---------- optional road snap ---------- */
async function roadSnap(){if(!st?.result)return;const mode=$('traceMode').value,spacing=Number($('traceSpacing').value)||1500,way=T.sampleAlong(st.result.coords,spacing);
 if(way.length-1>80)return status(`경유점이 ${way.length}개로 너무 많습니다. 간격을 늘리세요.`,true);
 if(!st.snapConsent&&!confirm(`추출한 선 위의 경유점 ${way.length}개 좌표와 활동 유형(${MODE_NAME[mode]})만 길담 자체 경로 서버로 보내 실제 길에 맞춥니다. 이미지는 전송하지 않습니다. 계속할까요?`))return;st.snapConsent=true;
 ctl?.abort();ctl=new AbortController();const mine=++seq;busy=true;render();const parts=[[]],warn=[];let worst=0;
 try{for(let i=1;i<way.length;i++){status(`길 따라 보정 중… ${i}/${way.length-1} 구간 (${MODE_NAME[mode]})`);const leg=await router.leg(way[i-1],way[i],mode,ctl.signal);if(mine!==seq)return;
   const cur=parts[parts.length-1];if(cur.length){const gap=T.meters(cur[cur.length-1],leg[0]);if(gap>3)parts.push(leg.slice());else cur.push(...leg.slice(1));}else cur.push(...leg);
   const dev=T.deviation(leg,st.result.coords);worst=Math.max(worst,dev);if(dev>150)warn.push(leg);}
  st.snapped={parts,mode,warn,length:parts.reduce((n,p)=>n+T.length(p),0)};updateLines();
  status(`길 따라 보정 완료 (${MODE_NAME[mode]}) · ${B.fmtKm(st.snapped.length)}${parts.length>1?` · 연결이 맞지 않은 곳 ${parts.length-1}곳은 직선으로 잇지 않고 구간을 나눴습니다`:''}${warn.length?` · 이미지 선과 150m 넘게 다른 길로 간 구간 ${warn.length}곳(빨간 표시)을 확인하세요. 해당 부근에 경유점을 추가하거나 간격을 줄여 보세요.`:` · 이미지 선과의 최대 차이 약 ${Math.round(worst)}m`}`,!!warn.length);}
 catch(e){if(e.name==='AbortError'||mine!==seq)return;status('길 따라 보정 실패: '+e.message+' 추출한 선은 그대로 사용할 수 있습니다.',true);}
 finally{if(mine===seq){busy=false;render();}}}
/* ---------- output ---------- */
const outParts=()=>st.snapped?st.snapped.parts:[st.result.coords];
async function openEditor(){if(!st?.result)return;const name=($('traceName').value.trim()||st.name);const ok=await window.__gpxEditor?.importText(T.toGpx(name,outParts()),name+'.gpx');if(ok){st.locked=true;st.mode='idle';st.result=st.snapped=null;st.A=st.B=null;st.vias=[];updateLines();const m=map();if(m.getLayer('trace-mask'))m.setLayoutProperty('trace-mask','visibility','none');$('traceShowMask').checked=false;placeHandles();placeMarks();status('GPX 편집기로 열었습니다. 이미지는 겹쳐 둔 채로 점을 다듬을 수 있습니다. 다 쓰면 [이미지 닫기]를 누르세요.');render();}}
function download(){if(!st?.result)return;const name=($('traceName').value.trim()||st.name);B.download(name,T.toGpx(name,outParts()));}
function close(silent=false){ctl?.abort();++seq;handles.forEach(h=>h.remove());marks.forEach(x=>x.remove());handles=[];marks=[];removeLayers();st=null;busy=false;if(!silent){status('이미지를 닫았습니다.');render();}}
/* ---------- UI ---------- */
function mapClick(e){if(!st||!B.inCourse()||busy)return false;const ll=[e.lngLat.lng,e.lngLat.lat];
 if(st.mode==='pairImg'||st.mode==='pairMap'){pairClick(ll);return true;}if(st.mode==='color'){colorClick(ll);return true;}if((st.mode==='A'||st.mode==='B'||st.mode==='via')&&st.maskInfo){pointClick(ll);return true;}return false;}
function render(){const has=!!st,el=$('traceTools');el.classList.toggle('has-image',has);
 for(const id of ['traceAlign','traceColorRow','tracePoints','traceRun','traceOut'])$(id).hidden=!has||(st.locked&&id!=='traceAlign');
 if(!has)return;syncOpacityUi();syncScaleUi();$('traceTol').value=st.tol;$('traceTolVal').textContent=st.tol;$('traceGapVal').textContent=st.gapCost;$('traceGap').value=st.gapCost;
 $('traceSwatch').style.background=st.color?`rgb(${st.color.join(',')})`:'transparent';$('traceSwatch').title=st.color?`rgb(${st.color.join(',')})`:'아직 고르지 않음';
 const on=(id,m)=>{$(id).classList.toggle('pri',st.mode===m);$(id).setAttribute('aria-pressed',String(st.mode===m));};on('tracePair','pairImg');if(st.mode==='pairMap')$('tracePair').classList.add('pri');on('tracePick','color');on('traceSetA','A');on('traceSetB','B');on('traceAddVia','via');
 for(const id of ['traceSetA','traceSetB','traceAddVia','traceClearVia'])$(id).disabled=!st.maskInfo||busy;$('traceClearVia').disabled=!st.vias.length||busy;
 $('traceExtract').disabled=!(st.maskInfo&&st.A&&st.B)||busy;$('traceSnap').disabled=!st.result||busy;$('traceOpen').disabled=$('traceDownload').disabled=!st.result||busy;
 $('tracePairInfo').textContent=st.pairs.length?`기준점 ${st.pairs.length}곳 / 최소 2곳`:'기준점 없음 · 최소 2곳';$('traceLock').textContent=st.locked?'위치 다시 조정':'위치 고정';
 const pairing=st.mode==='pairImg'||st.mode==='pairMap';el.classList.toggle('pairing',pairing);
 $('traceEmphasize').setAttribute('aria-pressed',String(!!st.emphasize));$('traceEmphasize').classList.toggle('pri',!!st.emphasize);
 const n=st.pairs.length,guide=$('tracePairGuide');
 if(st.mode==='pairImg')guide.innerHTML=`다음: <b>이미지</b>에서 ${n+1}번째 지점을 누르세요. 순서: 이미지 점 → 지도 점 (현재 ${n}곳 / 최소 2곳).`;
 else if(st.mode==='pairMap')guide.innerHTML=`다음: <b>바탕 지도</b>에서 방금 고른 지점과 같은 위치를 누르세요. (이미지 ${n+1}곳째 → 지도, 최소 2곳)`;
 else if(n<2)guide.innerHTML=`순서: <b>이미지 점 → 지도 점</b>. 같은 지점을 최소 2곳 짝지으면 크기·회전까지 자동으로 맞춥니다. 현재 ${n}곳.`;
 else guide.innerHTML=`기준점 ${n}곳. 오차가 크면 지우고 멀리 떨어진 지점을 다시 짝지으세요. 지도를 확대해도 위의 크기·회전·위치 버튼은 그대로 쓸 수 있습니다.`;
 const err=$('traceFitError');
 if(n===1){err.hidden=false;err.classList.remove('warn');err.textContent='맞춤 상태: 위치만 반영됨 · 크기·회전을 맞추려면 지점 1곳이 더 필요합니다.';}
 else if(n>=2&&st.fitError){err.hidden=false;err.classList.toggle('warn',st.fitError.max>80);err.textContent=`맞춤 오차 평균 ${Math.round(st.fitError.avg)}m · 최대 ${Math.round(st.fitError.max)}m${st.fitError.max>80?' — 오차가 큽니다. 기준점을 다시 찍어 주세요.':''}`;}
 else{err.hidden=true;err.textContent='';err.classList.remove('warn');}
 for(const id of ['traceScaleDown','traceScaleUp','traceScale','traceRotL5','traceRotL1','traceRotR1','traceRotR5','traceNudgeUp','traceNudgeLeft','traceNudgeRight','traceNudgeDown'])$(id).disabled=st.locked||busy;

 if(!$('traceMode').dataset.touched)$('traceMode').value=B.mode();
 map()?.getCanvas&&(map().getCanvas().style.cursor=['pairImg','pairMap','color','A','B','via'].includes(st.mode)?'crosshair':'');}
function setMode(m){if(!st)return;st.mode=st.mode===m?'idle':m;if(st.mode==='idle'&&(m==='pairImg'||m==='pairMap')){st.pending=null;setOverlay();}
 if(st.mode==='A')status('출발점(A)을 선 위에 누르세요.');else if(st.mode==='B')status('도착점(B)을 선 위에 누르세요.');else if(st.mode==='via')status('경유점을 가는 순서대로 선 위에 누르세요.');render();}
$('traceFile').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)loadFile(f);};
$('traceOpacity').oninput=e=>{if(!st)return;st.opacity=Number(e.target.value)/100;syncOpacityUi();applyImageStyle();};
$('tracePair').onclick=()=>st&&(st.mode==='pairImg'||st.mode==='pairMap'?(st.mode='idle',st.pending=null,setOverlay(),render()):startPair());
$('tracePairReset').onclick=()=>{if(!st)return;st.pairs=[];st.fitError=null;st.pending=null;if(st.mode==='pairImg'||st.mode==='pairMap')st.mode='idle';placeMarks();applyImageStyle();status('기준점을 지웠습니다. 현재 위치는 유지합니다.');render();};
$('traceLock').onclick=()=>{if(!st)return;st.locked=!st.locked;placeHandles();render();};
$('tracePick').onclick=()=>st&&(st.mode==='color'?setMode('color'):startPick());
$('traceTol').oninput=e=>{if(!st)return;st.tol=Number(e.target.value);$('traceTolVal').textContent=st.tol;clearTimeout(st.tolT);st.tolT=setTimeout(()=>{rebuildMask();render();},150);};
$('traceGap').oninput=e=>{if(!st)return;st.gapCost=Number(e.target.value);$('traceGapVal').textContent=st.gapCost;};
$('traceShowMask').onchange=()=>{if(map()?.getLayer('trace-mask'))map().setLayoutProperty('trace-mask','visibility',$('traceShowMask').checked?'visible':'none');};
$('traceSetA').onclick=()=>setMode('A');$('traceSetB').onclick=()=>setMode('B');$('traceAddVia').onclick=()=>setMode('via');
$('traceClearVia').onclick=()=>{if(!st)return;st.vias=[];st.result=st.snapped=null;updateLines();placeMarks();render();};
$('traceExtract').onclick=extract;$('traceSnap').onclick=roadSnap;$('traceOpen').onclick=openEditor;$('traceDownload').onclick=download;$('traceClose').onclick=()=>close();
$('traceMode').onchange=e=>{e.target.dataset.touched='1';};

$('traceEmphasize').onclick=()=>{if(!st)return;st.emphasize=!st.emphasize;applyImageStyle();render();};
$('traceScale').oninput=e=>setScalePct(e.target.value,false);
$('traceScale').onchange=e=>setScalePct(e.target.value,true);
$('traceScaleDown').onclick=()=>setScalePct(scalePct()/1.08,true);
$('traceScaleUp').onclick=()=>setScalePct(scalePct()*1.08,true);
$('traceRotL5').onclick=()=>rotateBy(-5);$('traceRotL1').onclick=()=>rotateBy(-1);
$('traceRotR1').onclick=()=>rotateBy(1);$('traceRotR5').onclick=()=>rotateBy(5);
$('traceNudgeUp').onclick=()=>nudgeByPixels(0,-8);$('traceNudgeDown').onclick=()=>nudgeByPixels(0,8);
$('traceNudgeLeft').onclick=()=>nudgeByPixels(-8,0);$('traceNudgeRight').onclick=()=>nudgeByPixels(8,0);
document.addEventListener('keydown',e=>{
 if(!canAdjust()||busy)return;
 if(e.target?.closest?.('input,textarea,select,[contenteditable=true]'))return;
 const step=e.shiftKey?32:8;
 if(e.key==='ArrowUp')nudgeByPixels(0,-step);
 else if(e.key==='ArrowDown')nudgeByPixels(0,step);
 else if(e.key==='ArrowLeft')nudgeByPixels(-step,0);
 else if(e.key==='ArrowRight')nudgeByPixels(step,0);
 else return;
 e.preventDefault();
});
window.__trace={mapClick,setVisible:v=>{if(!st)return;[...handles,...marks].forEach(x=>x.getElement().style.display=v?'':'none');const m=map();for(const id of ['trace-img','trace-mask','trace-line','trace-snap','trace-warn'])if(m?.getLayer(id)&&!(id==='trace-mask'&&!$('traceShowMask').checked))m.setLayoutProperty(id,'visibility',v?'visible':'none');if(v){placeHandles();placeMarks();}},get active(){return !!st;}};
window.__traceTest={loadFile,get state(){return st;},setTransform:t=>{st.T=t;setOverlay();},pairClick,colorClick,pointClick,setMode,extract,roadSnap,openEditor,router,setScalePct,rotateBy,nudgeByPixels,applyImageStyle,scalePct};
render();
})();
