/* Imported GPX editing: all XML and point records stay in this browser. */
(()=>{'use strict';
const $=id=>document.getElementById(id),M=window.GildamGpxModel,B=window.__courseBridge;
let active=false,source=null,segments=[],history=[],selected=0,start=0,end=1,action='start',dirty=false,preview=null,failed=false,pending=false,seq=0,controller=null,markers=[],message='',lastMode=B.mode(),originalRendered=null,segmentsRendered=null,previewRendered=null,profilePoints=null,distanceSegments=null,distanceCache=0;
let loadSeq=0;
function importStatus(text,error=false){const node=$('editorImportStatus');if(node){node.textContent=text;node.style.color=error?'#b42318':'';}}
const map=()=>B.map(),points=()=>segments[selected]?.points||[],count=()=>segments.reduce((n,s)=>n+s.points.length,0);
const state=()=>({segments,selected,start,end});
function cancel(messageText='미리보기를 취소했습니다. 원본 편집 상태로 돌아갑니다.'){++seq;controller?.abort();pending=false;preview=null;failed=false;message=messageText;}
function snap(){history.push(state());if(history.length>50)history.shift();future=[];}
function ensureLayers(){const m=map();if(!m?.getSource('course'))return false;for(const id of ['gpx-original','gpx-preview']){if(!m.getSource(id)){originalRendered=null;previewRendered=null;m.addSource(id,{type:'geojson',data:{type:'FeatureCollection',features:[]}});}if(!m.getLayer(id))m.addLayer({id,type:'line',source:id,paint:{'line-color':id==='gpx-original'?'#667b8a':'#ef8e15','line-width':id==='gpx-original'?3:5,'line-opacity':id==='gpx-original'?.5:.95,'line-dasharray':[2,1]}},m.getLayer('course-casing')?'course-casing':undefined);}return true;}
const lines=list=>({type:'FeatureCollection',features:list.filter(s=>s.points.length>1).map(s=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:s.points.map(p=>p.c.slice(0,2))}}))});
function totalDistance(){if(distanceSegments===segments)return distanceCache;distanceSegments=segments;distanceCache=segments.reduce((n,s)=>n+B.stats(s.points.map(p=>[...p.c,null])).dist,0);return distanceCache;}
function renderStats(){if(!active)return;$('cStats').innerHTML=`<div><small>구간별 합산 거리</small><b>${B.fmtKm(totalDistance())}</b></div><div><small>수정본 점 / 구간</small><b>${count()} / ${segments.length}</b></div><div><small>원본 점 수</small><b>${source.refs.length}</b></div>`;}
function renderMode(){
 const fresh=$('editNew'),file=$('editImport');fresh.classList.toggle('pri',!active);fresh.setAttribute('aria-pressed',String(!active));if(file){file.classList.toggle('pri',active);file.setAttribute('aria-pressed',String(active));}
 const current=$('editorMode');if(current)current.textContent=active?(direct?'현재 GPX 수정 중 · ':'현재 GPX 코스 보기 · ')+(source?.filename||'GPX'):'현재 새 코스 편집 · 지도에 점을 찍어 시작하세요.';
}
function render(){if(!active)return;renderMode();if(lastMode!==B.mode()){lastMode=B.mode();if(preview||pending||failed)cancel('이동 방식을 바꿨습니다. 선택 부분의 경로를 다시 계산하세요.');if(snapBusy())queueMicrotask(retrySnap);}
 $('gpxTools').hidden=false;for(const id of ['cEditRow','editHint','cRouteHint','courseTitle','editorImportStatus'])if($(id))$(id).hidden=hasDirectUi;$('cDelete').textContent='선택 점 삭제';$('connection').hidden=true;$('cRetry').hidden=true;$('cLoop').disabled=true;$('cDrawHint').hidden=true;
 $('cSave').disabled=$('cExport').disabled=pending||!!preview||failed||snapBusy()||count()<2;$('gpxApply').disabled=!preview||pending;$('gpxRoute').disabled=pending||snapBusy();
 $('gpxSegment').replaceChildren();segments.forEach((s,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${i+1}번 구간 · 원본 ${s.slot+1}번 · ${s.points.length}점`;$('gpxSegment').appendChild(o);});$('gpxSegment').value=selected;
 const n=points().length;start=Math.min(Math.max(0,start),Math.max(n-1,0));end=Math.min(Math.max(start,end),Math.max(n-1,0));$('gpxStart').value=start+1;$('gpxEnd').value=end+1;$('gpxStart').max=$('gpxEnd').max=n;
 $('gpxStatus').textContent=`${dirty?'수정 중':'원본 유지'} · ${message||'지도에서 점을 선택해 편집하세요.'}`;
 renderStats();if(!ensureLayers())return;const m=map();if(segmentsRendered!==segments){m.getSource('course').setData(lines(segments));segmentsRendered=segments;}if(originalRendered!==source){m.getSource('gpx-original').setData(lines(source.segments));originalRendered=source;}if(previewRendered!==preview){m.getSource('gpx-preview').setData(preview?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:preview.coordinates}}]}:{type:'FeatureCollection',features:[]});previewRendered=preview;}
 markers.forEach(x=>x.remove());markers=[];if(!hasDirectUi)for(const [label,index]of [['A',start],['B',end]]){const p=points()[index];if(!p)continue;const el=document.createElement('div');el.className='cpt'+(label==='A'?' first':'');el.textContent=label;el.title=label==='A'?'선택 시작 · 끌어서 점 이동':'선택 끝';const marker=new maplibregl.Marker({element:el,draggable:label==='A'&&!pending&&!preview}).setLngLat(p.c.slice(0,2)).addTo(m);el.addEventListener('click',e=>e.stopPropagation());marker.on('dragend',()=>{const p=marker.getLngLat();mutate('move',[p.lng,p.lat]);});marker.getElement().style.display=B.inCourse()?"":"none";markers.push(marker);}
 directUi();snapUi();updateHandles();
 if(profilePoints!==points()){profilePoints=points();B.profile();}}
function setSelection(){cancel('선택 범위를 변경했습니다.');start=Number($('gpxStart').value)-1;end=Number($('gpxEnd').value)-1;const n=points().length;if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>=n){start=0;end=Math.max(0,Math.min(1,n-1));message='시작 ≤ 끝, 현재 구간의 점 번호를 입력하세요.';}render();}
function mutate(kind,coordinates){if(!active)return;if(pending||preview){B.toast('먼저 미리보기를 적용하거나 취소하세요.');return;}try{const next=M.edit(segments,selected,start,end,kind,coordinates);if(snapBusy()){snapAbort();sj=null;}snap();direct=hasDirectUi;cancel('선택한 점/부분만 수정했습니다. 변경 점의 원래 시각·고도는 제거합니다.');segments=next;selected=Math.max(0,Math.min(selected,segments.length-1));rangeReady=false;if(kind==='removeRange'){start=0;end=0;}if(kind==='insert')start++;end=Math.max(start,Math.min(end,points().length-1));dirty=true;if(sj?.state==='applied')sj=null;if(snapOn&&(kind==='move'||kind==='insert'))startSnap(start);else render();}catch(e){B.toast(e.message);}}
// Road-following correction (opt-in per GPX): move/insert → plan L/P/R → sequential legs → validate → preview → apply.
// The move itself is one history step; applying the preview replaces it without a new step, so one undo restores both.
const router=M.createRouter(),MODE_NAME={walk:'걷기',hike:'등산',bike:'자전거'};
let snapOn=false,snapConsent=false,snapWindow=M.REROUTE.windowM,sj=null,snapSeq=0;
const snapBusy=()=>!!sj&&sj.state!=='applied';
function snapAbort(){++snapSeq;sj?.ctl?.abort();}
function startSnap(p){sj={state:'computing',moved:segments,selected,p,plan:null};retrySnap();}
function retrySnap(){const job=sj;if(!job||job.state==='applied')return;if(segments!==job.moved){snapAbort();sj=null;render();return;}
 try{job.plan=M.planReroute(job.moved[job.selected].points,job.p,{windowM:snapWindow});}catch(e){snapAbort();job.plan=null;job.state='error';job.error=e.message;render();return;}runSnap(job);}
async function runSnap(job){snapAbort();const mine=snapSeq;job.ctl=new AbortController();job.state='computing';job.mode=B.mode();job.result=null;job.error='';render();
 try{const r=await M.computeReroute(router,job.plan,job.mode,job.ctl.signal);if(mine!==snapSeq||sj!==job)return;job.result={...r,...M.applyReroute(job.moved,job.selected,job.plan,r.coordinates,r.pIndex)};job.state='preview';}
 catch(e){if(mine!==snapSeq||sj!==job||e.name==='AbortError')return;job.state='error';job.error=e.message;}
 render();}
function applySnap(){const job=sj;if(job?.state!=='preview')return;if(segments!==job.moved){snapAbort();sj=null;message='편집 상태가 바뀌어 보정 미리보기를 버렸습니다.';render();return;}
 const r=job.result;segments=r.segments;selected=r.selected;start=end=Math.min(r.start,points().length-1);dirty=true;sj={state:'applied',result:r,mode:job.mode};
 message='길 따라 보정을 적용했습니다. 바뀐 범위 밖의 원본 점은 그대로입니다.';render();}
function cancelSnap(){if(!snapBusy())return;snapAbort();sj=null;message='길 보정을 취소했습니다. 점 이동은 유지합니다(되돌리기로 이동까지 취소).';render();}
function toggleSnap(){if(!snapOn&&!snapConsent){if(!confirm('길 따라 보정을 켤까요?\n\n점을 옮기거나 추가할 때마다 그 점과 앞뒤 기준점 좌표(최대 3개)와 활동 유형만 길담 자체 경로 서버로 보냅니다. GPX 파일과 나머지 점은 전송하지 않습니다.\n\n결과는 미리보기로 확인한 뒤 적용할 때만 바뀝니다.'))return;snapConsent=true;}
 snapOn=!snapOn;if(!snapOn&&snapBusy()){snapAbort();sj=null;message='길 따라 보정을 껐습니다. 진행 중인 보정 미리보기는 취소했습니다.';}render();}
const fc=features=>({type:'FeatureCollection',features}),lineF=c=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:c}});
function snapLayers(){const m=map();if(!m?.getSource('course'))return null;
 for(const [id,type,paint]of [['gpx-snap-replaced','line',{'line-color':'#8d99a3','line-width':10,'line-opacity':.45}],['gpx-snap-route','line',{'line-color':'#ef8e15','line-width':5,'line-opacity':.95}],['gpx-snap-points','circle',{'circle-radius':['match',['get','role'],'moved',8,6],'circle-color':['match',['get','role'],'moved','#d94030','#ffffff'],'circle-stroke-color':['match',['get','role'],'moved','#ffffff','#078eaa'],'circle-stroke-width':3}]]){if(!m.getSource(id))m.addSource(id,{type:'geojson',data:fc([])});if(!m.getLayer(id))m.addLayer({id,type,source:id,paint});}
 return m;}
let snapRendered;
function snapDraw(){const m=snapLayers();if(!m||snapRendered===sj?.state+':'+snapSeq+':'+(sj?.result?1:0))return;snapRendered=sj?.state+':'+snapSeq+':'+(sj?.result?1:0);
 const job=snapBusy()&&sj.plan?sj:null,plan=job?.plan,P=plan?job.moved[job.selected].points:[];
 const replaced=plan?P.slice(Math.max(0,plan.keepL),Math.min(P.length,plan.keepR+1)).map(p=>p.c.slice(0,2)):[];
 m.getSource('gpx-snap-replaced').setData(fc(replaced.length>1?[lineF(replaced)]:[]));
 m.getSource('gpx-snap-route').setData(fc(job?.state==='preview'?[lineF(job.result.coordinates)]:[]));
 const pts=[];if(plan){for(const i of [plan.left,plan.right])if(i!==null)pts.push({role:'anchor',c:P[i].c});pts.push({role:'moved',c:job.state==='preview'?job.result.coordinates[job.result.pIndex]:plan.pCoord});}
 m.getSource('gpx-snap-points').setData(fc(pts.map(x=>({type:'Feature',properties:{role:x.role},geometry:{type:'Point',coordinates:x.c.slice(0,2)}}))));}
function snapUi(){snapDraw();if(!$('gpxSnapBox'))return;const st=sj?.state||'idle',mode=B.mode(),job=sj;
 const t=$('gpxSnapToggle');t.setAttribute('aria-checked',String(snapOn));t.classList.toggle('on',snapOn);$('gpxSnapState').textContent=snapOn?'ON':'OFF';
 $('mode').hidden=direct;document.querySelectorAll('#gpxSnapMode button').forEach(b=>{const on=b.dataset.v===mode;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on));});
 $('gpxSnapWindow').value=String(snapWindow);$('gpxSnapBox').dataset.state=st;
 let summary,detail='';const w='앞뒤 약 '+snapWindow+'m';
 if(st==='computing'){summary=`선택점 ${w} 재탐색 · ${MODE_NAME[job.mode]||''} · 계산 중…`;detail=`기준점 ${job.plan?.legs.length+1||''}개 좌표만 전송합니다. 빨간 선은 점 이동만 반영된 상태이며 길 보정은 아직 적용 전입니다.`;}
 else if(st==='preview'){const r=job.result;summary=`미리보기: 교체될 기존 경로(회색) / 새 길 경로(주황) · ${B.fmtKm(r.length)} (미적용)`;
  detail=`${MODE_NAME[job.mode]} 기준. 기존 점 ${job.plan.replaced}개(원본 ${r.removedOriginal}개)를 새 경로 점 ${r.added}개로 바꿉니다. 나머지 원본 점·구간은 그대로입니다.`;
  if(!r.joined.left||!r.joined.right)detail+=` 기준점과 길 사이가 ${M.REROUTE.anchorJoinM}m 넘게 떨어진 쪽은 직선으로 잇지 않고 별도 구간으로 나눕니다.`;
  if(r.length>job.plan.replacedM*3+200)detail+=' 원래 경로보다 크게 우회합니다. 보정 범위를 줄이거나 점을 길 위로 옮겨 보세요.';
  detail+=' OSM에 없는 길·통제 구간은 반영되지 않을 수 있습니다.';}
 else if(st==='error'){summary='보정 실패: '+job.error;detail='점 이동은 그대로이고 원본은 바뀌지 않았습니다. 다시 계산, 취소(이동 유지), 되돌리기(이동 취소) 중에서 선택하세요.';}
 else if(st==='applied'){summary='새 경로를 적용했습니다.';detail='되돌리기 한 번으로 점 이동과 길 보정을 함께 취소합니다. 새 경로 점에는 시각·고도가 없습니다.';}
 else summary=snapOn?`점을 옮기거나 추가하면 ${w}를 ${MODE_NAME[mode]} 기준 길로 다시 찾습니다.`:'길 따라 보정 꺼짐 · 점 이동은 직선 그대로 반영합니다.';
 $('gpxSnapStatus').textContent=summary;$('gpxSnapStatus').classList.toggle('err',st==='error');$('gpxSnapDetail').textContent=detail;
 $('gpxSnapApply').disabled=st!=='preview';$('gpxSnapCancel').disabled=!snapBusy();$('gpxSnapRetry').disabled=!(st==='error'||st==='preview');
 $('gpxSnapActions').hidden=!snapBusy();}
// Point editing: click = select, drag = move, click on line = insert, Shift+click = range. Viewport-only handles (≤240).
const hasDirectUi=!!$('gpxDock');let direct=hasDirectUi,tool='edit',rangeReady=false,rangeNext='start',rangeArm=false,rangeAnchor=null,handleMarkers=[],dragState=null,handlesMap=null,future=[],hoverEdge=null,ghost=null,lastPointer='mouse',menu=null;
const touchLike=()=>lastPointer==='touch'||lastPointer==='pen';
function clearHandles(){handleMarkers.forEach(m=>m.remove());handleMarkers=[];}
const busy=()=>pending||!!preview;
function fmtCoord(c){return c[1].toFixed(6)+', '+c[0].toFixed(6);}
function pointTime(p){const node=p.ref!==undefined&&source?.refs[p.ref];const t=node&&Array.from(node.getElementsByTagName('*')).find(x=>x.localName==='time');const d=t&&new Date(t.textContent.trim());return d&&!isNaN(d)?d.toLocaleString('ko-KR',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'–';}
function along(P,a,b){let d=0;for(let i=a+1;i<=b;i++)d+=M.meters(P[i-1].c,P[i].c);return d;}
function directUi(){if(!hasDirectUi)return;const P=points(),n=P.length,range=rangeReady&&end>start;
 $('gpxDock').hidden=false;$('gpxUndo').disabled=!history.length&&!busy()&&!snapBusy();$('gpxRedo').disabled=!future.length;
 $('gpxPointLabel').textContent=n?(range?`${start+1}~${end+1}`:`${start+1} / ${n}`):'–';$('gpxPointLabel').title=`${selected+1}구간 · 선택 점으로 이동 (F)`;
 $('gpxPointPrev').disabled=selected===0&&start===0;$('gpxPointNext').disabled=selected===segments.length-1&&start>=n-1;
 $('gpxAddPoint').disabled=busy()||!n||range;$('gpxDeletePoint').disabled=busy()||!n;$('gpxRangeArm').classList.toggle('pri',rangeArm);$('gpxRangeArm').setAttribute('aria-pressed',String(rangeArm));
 $('gpxPreviewBar').hidden=!(preview||pending||failed);
 const card=$('gpxPointCard'),p=P[start];if(!p){card.innerHTML='';return;}const dis=busy()?' disabled':'';
 if(range){const len=along(P,start,end);card.innerHTML=`<div class="pc-head"><b>${segments.length>1?selected+1+'구간 · ':''}${start+1}~${end+1}번 점</b><span class="badge">${end-start+1}점 · ${B.fmtKm(len)}</span></div>
  <div class="pc-acts"><button data-a="removeRange"${dis}>범위 삭제<small>앞뒤 분리</small></button><button data-a="clearInterior"${dis||(end-start<2?' disabled':'')}>중간 점 지우기<small>직선으로 연결</small></button><button data-a="route"${dis}>길 따라 다시 그리기<small>미리보기 후 적용</small></button><button data-a="trim"${dis}>이 범위만 남기기<small>같은 구간 안</small></button><button data-a="clear">선택 해제<small>Esc</small></button></div>`;return;}
 const prev=start>0?M.meters(P[start-1].c,p.c):null,next=start<n-1?M.meters(p.c,P[start+1].c):null,orig=p.ref!==undefined;
 card.innerHTML=`<div class="pc-head"><b>${segments.length>1?selected+1+'구간 · ':''}${start+1}번 점</b><span class="badge ${orig?'orig':'edit'}">${orig?'원본 점':'수정한 점'}</span>${start===0?'<span class="badge">구간 시작</span>':start===n-1?'<span class="badge">구간 끝</span>':''}</div>
  <dl class="pc-grid"><div><dt>위치</dt><dd>${fmtCoord(p.c)}</dd></div><div><dt>고도</dt><dd>${p.c[2]!=null?Math.round(p.c[2])+' m':'–'}</dd></div><div><dt>시각</dt><dd>${pointTime(p)}</dd></div>
  <div><dt>시작부터</dt><dd>${B.fmtKm(along(P,0,start))}</dd></div><div><dt>앞 점까지</dt><dd>${prev==null?'–':B.fmtKm(prev)}</dd></div><div><dt>뒤 점까지</dt><dd>${next==null?'–':B.fmtKm(next)}</dd></div></dl>
  <div class="pc-acts"><button data-a="before"${dis}>앞에 점 추가</button><button data-a="after"${dis}>뒤에 점 추가</button><button data-a="split"${dis||(start===0||start===n-1?' disabled':'')}>여기서 구간 나누기</button><button data-a="zoom">확대 (F)</button></div>`;}
function selectVertex(si,pi,doRender=true){selected=si;start=pi;end=pi;rangeReady=false;rangeAnchor=pi;action='select';if(doRender)render();}
function setRange(si,a,b){selected=si;rangeAnchor=a;start=Math.min(a,b);end=Math.max(a,b);rangeReady=end>start;rangeArm=false;message=rangeReady?'범위를 선택했습니다. 범위 작업을 고르거나 Delete로 삭제하세요.':'';render();}
function chooseVertex(si,pi,{shift=false}={}){if(!direct)return;closeMenu();
 if(shift||rangeArm){if(si!==selected){rangeArm=false;B.toast('범위는 같은 구간 안에서만 선택할 수 있습니다.');return selectVertex(si,pi);}return setRange(si,rangeAnchor??start,pi);}
 message='';selectVertex(si,pi);}
function ensureDirectLayers(){const m=map();for(const id of ['gpx-selected-range','gpx-drag-preview']){if(!m.getSource(id))m.addSource(id,{type:'geojson',data:{type:'FeatureCollection',features:[]}});if(!m.getLayer(id))m.addLayer({id,type:'line',source:id,paint:{'line-color':id==='gpx-selected-range'?'#078eaa':'#ef8e15','line-width':id==='gpx-selected-range'?9:4,'line-opacity':id==='gpx-selected-range'?.5:.9,...(id==='gpx-drag-preview'?{'line-dasharray':[1.5,1]}:{})}});}}
function viewBox(m){const b=m.getBounds?.();return b?[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]:null;}
const inBox=(bb,c)=>!bb||(c[0]>=bb[0]&&c[0]<=bb[2]&&c[1]>=bb[1]&&c[1]<=bb[3]);
function updateHandles(){if(!active||!hasDirectUi||!map()?.getSource('course')||dragState)return;const m=map();clearHandles();ensureDirectLayers();
 if(handlesMap!==m){handlesMap=m;m.on?.('moveend',()=>{if(active&&direct&&!dragState)updateHandles();});bindPointer(m);}
 const rangeLine=rangeReady&&end>start?points().slice(start,end+1):[];m.getSource('gpx-selected-range').setData(lines(rangeLine.length>1?[{points:rangeLine}]:[]));
 const zoom=m.getZoom?.()??18;if(zoom<14){$('gpxHandleCount').textContent='경로를 누르면 그 위치로 확대되어 각 점을 편집할 수 있습니다.';return;}
 const grid=new Set(),snapshot=segments,candidates=[],bb=viewBox(m),forced=new Set([selected+':'+start,selected+':'+end]);
 function append(si,pi,force=false){const p=segments[si]?.points[pi];if(!p||!inBox(bb,p.c))return;const q=m.project(p.c.slice(0,2)),key=Math.floor(q.x/14)+':'+Math.floor(q.y/14);if(!force&&(grid.has(key)||candidates.length>=239))return;grid.add(key);candidates.push({si,pi});}
 for(const k of forced){const [si,pi]=k.split(':').map(Number);append(si,pi,true);}
 segments.forEach((s,si)=>s.points.forEach((p,pi)=>{if(!forced.has(si+':'+pi))append(si,pi);}));
 for(const {si,pi}of candidates){const P=segments[si].points,p=P[pi],sel=si===selected&&(pi===start||(rangeReady&&pi===end)),el=document.createElement('div');
  el.className='gpx-vertex'+(sel?' selected':'')+(pi===0?' seg-start':pi===P.length-1?' seg-end':'')+(p.ref===undefined?' edited':'');
  el.title=`${si+1}구간 ${pi+1}번 점 · 클릭 선택 · 끌어 이동 · Shift+클릭 범위 · 우클릭 메뉴`;el.setAttribute('role','button');el.setAttribute('aria-label',`${si+1}구간 ${pi+1}번 점`);
  const marker=new maplibregl.Marker({element:el,draggable:!busy()}).setLngLat(p.c.slice(0,2)).addTo(m);
  el.addEventListener('pointerdown',e=>{lastPointer=e.pointerType||'mouse';});
  el.addEventListener('click',e=>{e.stopPropagation();if(snapshot===segments)chooseVertex(si,pi,{shift:e.shiftKey});});
  el.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();if(snapshot!==segments)return;if(!(rangeReady&&si===selected&&pi>=start&&pi<=end))selectVertex(si,pi);openMenu(e,si,pi);});
  marker.on('dragstart',()=>{if(snapshot!==segments)return;closeMenu();hideGhost();if(snapBusy()){snapAbort();sj=null;snapDraw();}selectVertex(si,pi,false);dragState={si,pi,snapshot};B.invalidate();directUi();});
  marker.on('drag',()=>{if(!dragState||snapshot!==segments)return;const c=marker.getLngLat(),local=P.slice(Math.max(0,pi-1),pi).map(p=>p.c);local.push([c.lng,c.lat]);if(pi+1<P.length)local.push(P[pi+1].c);m.getSource('gpx-drag-preview').setData(local.length>1?{type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:local.map(p=>p.slice(0,2))}}]}:{type:'FeatureCollection',features:[]});});
  marker.on('dragend',()=>{const d=dragState;dragState=null;m.getSource('gpx-drag-preview').setData({type:'FeatureCollection',features:[]});if(!d||d.snapshot!==segments){render();return;}const c=marker.getLngLat(),before=segments;selectVertex(si,pi,false);mutate('move',[c.lng,c.lat]);if(before===segments)render();});
  marker.getElement().style.display=B.inCourse()?'':'none';handleMarkers.push(marker);}
 // "+" on the edges next to a single selected point: one tap inserts, then drag the new point.
 if(!busy()&&!rangeReady){const P=points();for(const i of [start-1,start]){if(i<0||i>=P.length-1)continue;const a=P[i].c,b=P[i+1].c,c=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(!inBox(bb,c))continue;const A=m.project(a.slice(0,2)),Z=m.project(b.slice(0,2));if(Math.hypot(A.x-Z.x,A.y-Z.y)<30)continue;
  const el=document.createElement('div');el.className='gpx-midpoint';el.textContent='+';el.title='여기에 점 추가';el.addEventListener('click',e=>{e.stopPropagation();if(snapshot!==segments)return;selectVertex(selected,i,false);mutate('insert',c);});const marker=new maplibregl.Marker({element:el}).setLngLat(c).addTo(m);marker.getElement().style.display=B.inCourse()?'':'none';handleMarkers.push(marker);}}
 $('gpxHandleCount').textContent=`화면 안 점 ${candidates.length}개 표시${candidates.length>=239?' (겹친 점은 확대하거나 ◀ ▶로 선택)':''} · 수정본 ${count()}점`;
}
function closestVertex(point,limit=32){const m=map(),bb=viewBox(m);let best=null,d=limit;segments.forEach((s,si)=>s.points.forEach((p,pi)=>{if(!inBox(bb,p.c))return;const q=m.project(p.c.slice(0,2)),v=Math.hypot(q.x-point.x,q.y-point.y);if(v<d){d=v;best={si,pi};}}));return best;}
function closestEdge(point,limit=25){const m=map(),bb=viewBox(m);let best=null,d=limit;segments.forEach((s,si)=>{const P=s.points;for(let pi=0;pi<P.length-1;pi++){const ca=P[pi].c,cb=P[pi+1].c;if(bb&&((ca[0]<bb[0]&&cb[0]<bb[0])||(ca[0]>bb[2]&&cb[0]>bb[2])||(ca[1]<bb[1]&&cb[1]<bb[1])||(ca[1]>bb[3]&&cb[1]>bb[3])))continue;const a=m.project(ca.slice(0,2)),b=m.project(cb.slice(0,2)),dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1))),v=Math.hypot(point.x-a.x-t*dx,point.y-a.y-t*dy);if(v<d){d=v;best={si,pi,t,at:m.unproject([a.x+t*dx,a.y+t*dy])};}}});return best;}
function hideGhost(){hoverEdge=null;ghost?.remove();ghost=null;const c=map()?.getCanvas?.();if(c&&active&&B.inCourse())c.style.cursor='';}
let hoverQueued=false,hoverEvent=null;
function bindPointer(m){m.getCanvas?.()?.addEventListener('pointerdown',e=>{lastPointer=e.pointerType||'mouse';},{passive:true});
 m.on('mousemove',e=>{hoverEvent=e;if(hoverQueued)return;hoverQueued=true;requestAnimationFrame(()=>{hoverQueued=false;hover(hoverEvent);});});m.on('mouseout',hideGhost);}
function hover(e){const m=map();if(!active||!direct||!B.inCourse()||dragState||busy()||touchLike()||(m.getZoom?.()??18)<14||!e){hideGhost();return;}
 if(closestVertex(e.point,12)){hideGhost();m.getCanvas().style.cursor='pointer';return;}
 const edge=closestEdge(e.point,10);if(!edge){hideGhost();return;}hoverEdge=edge;m.getCanvas().style.cursor='copy';
 if(!ghost){const el=document.createElement('div');el.className='gpx-ghost';el.textContent='+';ghost=new maplibregl.Marker({element:el}).setLngLat(edge.at).addTo(m);}else ghost.setLngLat(edge.at);}
function mapClick(e){if(!hasDirectUi)return legacyMapClick(e);if(!active)return;closeMenu();if(!direct){window.__openPlace?.(e);return;}
 if(action==='move'||action==='insert'){if(busy())return B.toast('미리보기를 먼저 적용하거나 취소하세요.');mutate(action,[e.lngLat.lng,e.lngLat.lat]);action='select';return;}
 if(action==='start'||action==='end'){const hit=closestVertex(e.point);if(!hit||hit.si!==selected)return B.toast('같은 구간의 실제 점 가까이를 누르세요.');if(action==='start')start=hit.pi;else end=hit.pi;if(end<start)[start,end]=[end,start];rangeReady=end>start;action='select';render();return;}
 const zoom=map().getZoom?.()??18,hit=closestVertex(e.point,touchLike()?28:16);
 if(hit){chooseVertex(hit.si,hit.pi,{shift:e.originalEvent?.shiftKey});if(zoom<14)zoomPoint();return;}
 const edge=closestEdge(e.point,touchLike()?22:10);
 if(!edge){if(rangeReady)setRange(selected,start,start);return window.__openPlace?.(e);}
 const near=edge.t<.5?edge.pi:edge.pi+1;
 if(zoom<14){selectVertex(edge.si,near);zoomPoint();return;}
 if(touchLike())return chooseVertex(edge.si,near);
 if(busy())return B.toast('미리보기를 먼저 적용하거나 취소하세요.');
 hideGhost();selectVertex(edge.si,edge.pi,false);mutate('insert',[edge.at.lng,edge.at.lat]);}
function zoomPoint(){const p=points()[start];if(p)map()?.easeTo?.({center:p.c.slice(0,2),zoom:Math.max(map().getZoom?.()??16,17),duration:300});}
function revealPoint(i=start){const p=points()[i];if(p&&!map().getBounds?.().contains(p.c.slice(0,2)))map().easeTo?.({center:p.c.slice(0,2),duration:200});}
function navigatePoint(delta){closeMenu();let si=selected,pi=start+delta;while(si>=0&&si<segments.length){const n=segments[si].points.length;if(pi>=0&&pi<n){selectVertex(si,pi);revealPoint();return;}const was=si;si+=Math.sign(delta);if(si<0||si>=segments.length){selectVertex(was,delta>0?n-1:0);revealPoint();return;}pi=delta>0?0:segments[si].points.length-1;}}
function extendRange(delta){const n=points().length,a=rangeAnchor??start,moving=rangeReady?(start===a?end:start):start,b=Math.max(0,Math.min(n-1,moving+delta));setRange(selected,a,b);revealPoint(b);}
function midpoint(P,i){const a=P[i].c,b=P[i+1].c;return[(a[0]+b[0])/2,(a[1]+b[1])/2];}
function commit(next,s,e2,kind){if(snapBusy()){snapAbort();sj=null;}snap();cancel('선택한 점/부분만 수정했습니다.');segments=next;start=s;end=e2;rangeReady=false;dirty=true;if(sj?.state==='applied')sj=null;if(snapOn&&kind==='insert')startSnap(start);else render();}
function addPoint(where='after'){if(busy())return B.toast('미리보기를 먼저 적용하거나 취소하세요.');const P=points(),n=P.length;if(!n)return;
 if(where==='before'&&start>0){selectVertex(selected,start-1,false);return mutate('insert',midpoint(P,start));}
 if(where==='after'&&start<n-1)return mutate('insert',midpoint(P,start));
 // Extend past a segment end by half of the last spacing; the user then drags the new point.
 const p=P[start].c,q=n>1?P[where==='before'?1:n-2].c:[p[0]-0.0002,p[1]],c=[p[0]+(p[0]-q[0])*.5,p[1]+(p[1]-q[1])*.5];
 if(where==='after')return mutate('insert',c);
 try{const next=M.edit(segments,selected,0,0,'insert',c),pts=next[selected].points.slice();[pts[0],pts[1]]=[pts[1],pts[0]];commit(next.map((s,i)=>i===selected?{...s,points:pts}:s),0,0,'insert');}catch(e){B.toast(e.message);}}
function deleteSelection(){if(busy())return B.toast('미리보기를 먼저 적용하거나 취소하세요.');if(rangeReady&&end>start){mutate('removeRange');B.toast('범위를 삭제했습니다. 앞뒤는 직선으로 잇지 않고 별도 구간으로 둡니다. (되돌리기 가능)');return;}
 mutate('delete');}
function cardAction(a){closeMenu();if(a==='zoom')return zoomPoint();if(a==='clear')return setRange(selected,start,start);if(a==='before'||a==='after')return addPoint(a);
 if(a==='split'){const before=segments;mutate('split');if(segments!==before){selected=Math.min(selected+1,segments.length-1);start=end=0;render();B.toast('구간을 나눴습니다. 나눈 점은 양쪽 구간 끝에 그대로 남습니다.');}return;}
 if(a==='removeRange'||a==='delete')return deleteSelection();if(a==='clearInterior'){mutate('clearInterior');end=start+1;rangeReady=true;render();return;}if(a==='trim'){mutate('trim');start=0;end=Math.max(0,points().length-1);rangeReady=false;render();return;}if(a==='route')return route();}
function openMenu(e,si,pi){closeMenu();const m=map(),box=m.getContainer().getBoundingClientRect(),range=rangeReady&&end>start,P=segments[si].points;
 const items=range?[['removeRange','범위 삭제 (앞뒤 분리)'],['clearInterior','중간 점 지우기'],['route','길 따라 다시 그리기'],['trim','이 범위만 남기기'],['clear','선택 해제']]:[['delete','이 점 삭제'],['before','앞에 점 추가'],['after','뒤에 점 추가'],...(pi>0&&pi<P.length-1?[['split','여기서 구간 나누기']]:[]),['zoom','확대']];
 const el=document.createElement('div');el.className='gpx-menu';el.setAttribute('role','menu');el.innerHTML=items.map(([a,t])=>`<button role="menuitem" data-a="${a}"${busy()&&a!=='zoom'&&a!=='clear'?' disabled':''}>${t}</button>`).join('');
 el.style.left=Math.max(4,Math.min(e.clientX-box.left,box.width-200))+'px';el.style.top=Math.max(4,Math.min(e.clientY-box.top,box.height-items.length*36-12))+'px';
 el.addEventListener('click',ev=>{ev.stopPropagation();const a=ev.target.closest('button')?.dataset.a;closeMenu();if(a)cardAction(a);});m.getContainer().appendChild(el);menu={el,si,pi};el.querySelector('button')?.focus();}
function closeMenu(){menu?.el.remove();menu=null;}
function onKey(e){if(!active||!direct||!B.inCourse()||e.defaultPrevented||e.altKey)return;const t=e.target;if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
 const k=e.key,mod=e.ctrlKey||e.metaKey;let done=true;
 if(mod&&(k==='z'||k==='Z'))e.shiftKey?redo():undo();else if(mod&&(k==='y'||k==='Y'))redo();else if(mod)done=false;
 else if(k==='ArrowLeft'||k==='ArrowRight'){const d=k==='ArrowLeft'?-1:1;e.shiftKey?extendRange(d):navigatePoint(d);}
 else if(k==='PageUp'||k==='PageDown')navigatePoint(k==='PageUp'?-10:10);
 else if(k==='Home'||k==='End'){selectVertex(selected,k==='Home'?0:points().length-1);revealPoint();}
 else if(k==='Delete'||k==='Backspace')deleteSelection();
 else if(k==='Escape'){if(menu)closeMenu();else if(snapBusy())cancelSnap();else if(preview||failed){cancel();render();}else if(rangeReady||rangeArm){rangeArm=false;setRange(selected,start,start);}else done=false;}
 else if(k==='Enter'){if(sj?.state==='preview')applySnap();else if(preview)apply();else done=false;}
 else if(k==='f'||k==='F')zoomPoint();else if(k==='Insert'||k==='+')addPoint('after');
 else done=false;
 if(done)e.preventDefault();}
document.addEventListener('keydown',onKey);
document.addEventListener('pointerdown',e=>{if(menu&&!menu.el.contains(e.target))closeMenu();},true);
function toggleDirect(){direct=true;render();}
function deleteRange(){if(!rangeReady||end<=start)return B.toast('같은 구간에서 범위를 먼저 선택하세요. (Shift+클릭 또는 범위 버튼)');mutate('removeRange');}
async function viewText(text,filename){return importText(text,filename);}

function legacyMapClick(e){if(!active)return;if(action==='move'||action==='insert'){mutate(action,[e.lngLat.lng,e.lngLat.lat]);action='start';return;}const P=points();let best=-1,d=35;for(let i=0;i<P.length;i++){const q=map().project(P[i].c.slice(0,2)),v=Math.hypot(q.x-e.point.x,q.y-e.point.y);if(v<d){best=i;d=v;}}if(best<0){B.toast('경로를 확대해 실제 점 가까이를 누르세요. 번호로도 선택할 수 있습니다.');return;}cancel('지도에서 실제 경로 점을 선택했습니다.');if(action==='end'){end=best;if(end<start)[start,end]=[end,start];action='start';}else{start=best;end=Math.max(start,end);action='end';}render();}
async function route(){if(!active)return;if(dragState)return B.toast("점 이동을 먼저 마치세요.");if(snapBusy())return B.toast('길 보정 미리보기를 먼저 적용하거나 취소하세요.');if(pending||preview)return B.toast('현재 미리보기를 먼저 적용하거나 취소하세요.');if(end<=start)return B.toast('같은 구간에서 시작·끝을 두 점 이상 선택하세요.');
 if(!confirm('선택한 시작·끝 좌표 2개만 길담 서버에 보내 길을 찾을까요? GPX 파일과 중간 경로 점은 전송하지 않습니다. 결과는 적용 전에 미리 볼 수 있습니다.'))return;
 cancel('선택 부분 경로를 계산 중입니다…');const mine=seq;controller=new AbortController();pending=true;failed=false;const from=points()[start].c.slice(0,2),to=points()[end].c.slice(0,2),mode=B.mode();render();
 try{let res,data;for(let attempt=0;attempt<4;attempt++){if(mine!==seq)return;res=await fetch('/routing/route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from,to,mode}),signal:controller.signal});data=await res.json();if(res.status!==503||attempt===3)break;await new Promise(r=>setTimeout(r,600));}if(mine!==seq)return;if(!res.ok)throw Error(data.error||'경로 계산 실패');if(!Array.isArray(data.coordinates)||data.coordinates.length<2||data.coordinates.length>100000)throw Error('올바른 대체 경로를 받지 못했습니다.');M.edit(segments,selected,start,end,'route',data.coordinates);preview={coordinates:data.coordinates.map(c=>c.slice(0,2))};message='주황 미리보기를 확인한 뒤 적용하세요. 대체 경로는 별도 구간으로 보존하여 임의 연결선을 만들지 않습니다.';
 }catch(e){if(mine!==seq||e.name==='AbortError')return;failed=true;message='계산 실패: '+e.message+' · 원본 변경 없음. 미리보기 취소 후 편집을 계속하세요.';}finally{if(mine===seq){pending=false;render();}}}
function apply(){if(!preview||pending)return;try{const next=M.edit(segments,selected,start,end,'route',preview.coordinates);snap();cancel('대체 경로를 별도 구간으로 적용했습니다. 나머지 원본 점과 구간은 그대로 유지합니다.');segments=next;selected++;start=0;end=Math.max(0,points().length-1);dirty=true;render();}catch(e){failed=true;message=e.message;render();}}
function undo(){dragState=null;rangeReady=false;rangeNext='start';if(snapBusy()){snapAbort();sj=null;cancel();}else if(sj)sj=null;if(pending||preview||failed){cancel();render();return;}if(!history.length)return B.toast('되돌릴 편집이 없습니다.');future.push(state());const s=history.pop();segments=s.segments;selected=s.selected;start=s.start;end=s.end;rangeReady=false;dirty=true;message='이전 편집 상태로 되돌렸습니다. (다시 실행: Ctrl+Shift+Z)';render();}
function redo(){if(busy()||snapBusy())return B.toast('미리보기를 먼저 적용하거나 취소하세요.');if(!future.length)return B.toast('다시 실행할 편집이 없습니다.');history.push(state());const s=future.pop();sj=null;segments=s.segments;selected=s.selected;start=s.start;end=s.end;rangeReady=false;dirty=true;message='편집을 다시 실행했습니다.';render();}
function confirmChange(){return !(active||B.hasWork())||confirm('현재 편집 내용이 저장되지 않았을 수 있습니다. 다른 코스를 열까요? 취소 후 브라우저에 저장할 수 있습니다.');}
function activate(parsed,restored=false){originalRendered=segmentsRendered=previewRendered=profilePoints=snapRendered=null;snapAbort();sj=null;snapOn=false;snapConsent=false;B.invalidate();B.removeMarkers();cancel('원본 GPX는 이 브라우저에서만 읽었습니다.');source=parsed;segments=parsed.restoredSegments||parsed.segments;history=[];selected=0;while(selected<segments.length-1&&!segments[selected].points.length)selected++;start=0;end=Math.max(0,points().length-1);active=true;B.refreshTracks?.();direct=hasDirectUi;tool='edit';rangeReady=false;rangeArm=false;future=[];closeMenu();hideGhost();action='select';start=end=0;dirty=false;lastMode=B.mode();$('cName').value=parsed.name;B.selectTab();render();B.fit(segments.flatMap(s=>s.points.map(p=>p.c)));if(restored)message='브라우저에 저장한 수정본을 다시 열었습니다.';}
async function importText(text,filename,ticket=++loadSeq){
 try{if(ticket!==loadSeq)return;importStatus((filename||'GPX')+' · 경로를 확인하는 중…');const parsed=M.parse(text,filename);
 const until=Date.now()+15000;while(!B.map()?.getSource('course')){if(ticket!==loadSeq)return;if(Date.now()>until)throw Error('지도를 준비하지 못했습니다. 네트워크를 확인하고 새로고침 후 다시 선택해 주세요.');importStatus((filename||'GPX')+' · 파일 확인 완료, 지도 준비를 기다리는 중…');await new Promise(r=>setTimeout(r,100));}
 if(ticket!==loadSeq)return;if(!confirmChange()){importStatus('불러오기를 취소했습니다. 현재 코스는 유지합니다.');return;}activate(parsed);importStatus((filename||'GPX')+' · '+parsed.refs.length+'점 / '+parsed.segments.length+'구간 불러오기 완료. 아래 편집 도구를 사용하세요.');return true;
 }catch(e){if(ticket!==loadSeq)return;const msg='GPX를 열지 못했습니다: '+e.message;importStatus(msg,true);B.toast(msg);}}
async function importFile(f){const ticket=++loadSeq;importStatus((f.name||'GPX')+' · 파일을 읽는 중…');
 if(f.size>30*1024*1024){importStatus('30MB 이하 GPX만 편집할 수 있습니다. 기존 코스는 유지합니다.',true);return B.toast('30MB 이하 GPX만 편집할 수 있습니다.');}
 try{const text=typeof f.arrayBuffer==='function'&&typeof M.decode==='function'?M.decode(await f.arrayBuffer()):await f.text();if(ticket===loadSeq)await importText(text,f.name,ticket);}catch(e){if(ticket!==loadSeq)return;const msg='파일을 읽지 못했습니다: '+e.message+' · 기존 코스는 유지합니다.';importStatus(msg,true);B.toast(msg);}}

function leave(){if(active&&!confirmChange())return false;deactivate();return true;}
function deactivate(){cancel('');closeMenu();hideGhost();future=[];rangeArm=false;for(const id of ['gpxDock','cEditRow','editHint','cRouteHint','courseTitle','editorImportStatus'])if($(id))$(id).hidden=id==='gpxDock';snapAbort();sj=null;snapOn=false;snapRendered=null;if($('mode'))$('mode').hidden=false;active=false;B.refreshTracks?.();clearHandles();dragState=null;source=null;segments=[];history=[];renderMode();originalRendered=segmentsRendered=previewRendered=profilePoints=distanceSegments=null;distanceCache=0;markers.forEach(m=>m.remove());markers=[];$('gpxTools').hidden=true;$('cDelete').textContent='마지막 점 삭제';$('connection').hidden=false;$('cRetry').hidden=false;$('cLoop').disabled=false;$('cDrawHint').hidden=false;for(const id of ['gpx-original','gpx-preview','gpx-selected-range','gpx-drag-preview','gpx-snap-replaced','gpx-snap-route','gpx-snap-points'])map()?.getSource(id)?.setData({type:'FeatureCollection',features:[]});B.invalidate();}
function fresh(){if(!confirmChange())return;++loadSeq;importStatus("새 코스 편집을 시작합니다. GPX 원본 파일은 변경하지 않습니다.");deactivate();dirty=false;B.newCourse();B.selectTab();}
function restore(item){try{const s=M.restore(item.gpxEdit.text,item.gpxEdit.filename,item.gpxEdit.segments);if(!confirmChange())return;++loadSeq;activate(s,true);$('cName').value=item.name;$('gpxStripTime').checked=!!item.gpxEdit.stripTimes;render();}catch(e){B.toast('저장된 수정본을 열지 못했습니다: '+e.message);}}
function save(){if(pending||preview||failed||snapBusy())return B.toast('미리보기를 적용/취소하거나 실패 상태를 해제하세요.');const name=$('cName').value.trim()||source.name;const item={name,pts:segments.flatMap(s=>s.points.map(p=>p.c)),distance:totalDistance(),at:Date.now(),gpxEdit:{text:source.text,filename:source.filename,segments,stripTimes:$('gpxStripTime').checked}};if(B.save(item)){dirty=false;B.toast('수정본을 이 브라우저에 저장했습니다. 원본 파일은 변경하지 않았습니다.');}}
function output(){if(pending||preview||failed||snapBusy())return B.toast('미리보기를 적용/취소하거나 실패 상태를 해제하세요.');try{const xml=M.exportGpx(source,segments,{stripTimes:$('gpxStripTime').checked});const name=($('cName').value.trim()||source.name)+'_수정본';B.download(name,xml);dirty=false;B.toast('별도 수정본 GPX를 내려받았습니다.');}catch(e){B.toast(e.message);}}
function selectNear(c){if(!active||!points().length)return;let best=0,d=Infinity;points().forEach((p,i)=>{const v=M.meters(p.c,c);if(v<d){d=v;best=i;}});selectVertex(selected,best);revealPoint();}
window.__gpxEditor={selectNear,setVisible:v=>{[...markers,...handleMarkers].forEach(m=>m.getElement().style.display=v?"":"none");if(!v){hideGhost();closeMenu();}},get active(){return active;},importText,importFile,viewText,restore,leave,render,renderStats,mapClick,selectedGeometry:()=>points().map(p=>p.c)};
renderMode();if($('editImport'))$('editImport').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('editGpxInput').click();}};
$('editNew').onclick=fresh;$('editGpxInput').onchange=e=>{if(e.target.files[0])importFile(e.target.files[0]);e.target.value='';};
$('gpxSegment').onchange=e=>{cancel('다른 원본 구간을 선택했습니다.');if(snapBusy()){snapAbort();sj=null;}selected=Number(e.target.value);start=0;end=direct?0:Math.max(0,points().length-1);rangeReady=false;rangeNext='start';render();};$('gpxStart').onchange=$('gpxEnd').onchange=setSelection;
for(const [id,mode]of [['gpxPickStart','start'],['gpxPickEnd','end'],['gpxMove','move'],['gpxInsert','insert']])$(id).onclick=()=>{action=mode;message=mode==='move'?'선택 시작 점의 새 위치를 지도에서 누르세요.':mode==='insert'?'선택 시작 뒤에 추가할 위치를 지도에서 누르세요.':'선택할 실제 점 가까이를 지도에서 누르세요.';render();};
$('gpxDelete').onclick=()=>mutate('delete');$('gpxTrim').onclick=()=>{if(confirm('선택한 구간에서 시작~끝 바깥 점만 자를까요? 다른 구간과 원본 파일은 유지되며 되돌릴 수 있습니다.'))mutate('trim');};$('gpxRoute').onclick=route;$('gpxApply').onclick=apply;$('gpxCancel').onclick=()=>{cancel();render();};
for(const [id,handler]of [['cUndo',undo],['cDelete',()=>mutate('delete')],['cSave',save],['cExport',output],['cClear',()=>B.toast('새 코스 만들기로 전환하면 현재 GPX 편집을 닫을 수 있습니다.')]]){const fallback=$(id).onclick;$(id).onclick=e=>active?handler(e):fallback?.(e);}
if(hasDirectUi){$('gpxUndo').onclick=undo;$('gpxRedo').onclick=redo;$('gpxPointPrev').onclick=()=>navigatePoint(-1);$('gpxPointNext').onclick=()=>navigatePoint(1);$('gpxPointLabel').onclick=zoomPoint;
 $('gpxAddPoint').onclick=()=>addPoint('after');$('gpxDeletePoint').onclick=deleteSelection;$('gpxRangeArm').onclick=()=>{rangeArm=!rangeArm;if(rangeArm){rangeAnchor=start;message='범위의 다른 끝 점을 지도에서 누르세요. (PC: Shift+클릭)';}else message='';render();};
 $('gpxPointCard').addEventListener('click',e=>{const a=e.target.closest('button[data-a]')?.dataset.a;if(a)cardAction(a);});}
window.addEventListener('beforeunload',e=>{if(active&&(dirty||pending||preview||snapBusy())){e.preventDefault();e.returnValue='';}});
if($('gpxSnapBox')){$('gpxSnapToggle').onclick=toggleSnap;$('gpxSnapApply').onclick=applySnap;$('gpxSnapCancel').onclick=cancelSnap;$('gpxSnapRetry').onclick=retrySnap;
 $('gpxSnapWindow').onchange=e=>{snapWindow=Number(e.target.value)||M.REROUTE.windowM;if(snapBusy())retrySnap();else render();};
 document.querySelectorAll('#gpxSnapMode button').forEach(b=>b.onclick=()=>document.querySelector('#mode button[data-v="'+b.dataset.v+'"]')?.click());}
window.__gpxEditorTest={snap:{toggle:toggleSnap,apply:applySnap,cancel:cancelSnap,retry:retrySnap,router,state:()=>({on:snapOn,consent:snapConsent,window:snapWindow,state:sj?.state||'idle',error:sj?.error||'',plan:sj?.plan||null,result:sj?.result||null,mode:sj?.mode||null})},getState:()=>({active,segments,selected,start,end,preview,pending,failed,dirty,history:history.length,future:future.length,direct,tool,rangeReady,rangeArm,handles:handleMarkers.length}),mutate,undo,redo,addPoint,deleteSelection,cardAction,navigatePoint,extendRange,route,apply,cancel,output,save,chooseVertex,deleteRange,updateHandles};
})();
