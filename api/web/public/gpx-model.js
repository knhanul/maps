/* Browser-only lossless GPX editing model: original XML is immutable. */
(function(root){'use strict';
const child=(n,tag)=>Array.from(n.childNodes||[]).filter(x=>x.nodeType===1&&x.localName===tag&&x.namespaceURI===n.namespaceURI);
function decode(buffer){
 const b=new Uint8Array(buffer);if(b.byteLength>30*1024*1024)throw Error('GPX는 30MB 이하만 편집할 수 있습니다.');
 let encoding='utf-8';
 if(b[0]===255&&b[1]===254)encoding='utf-16le';
 else if(b[0]===254&&b[1]===255)encoding='utf-16be';
 else if(b[0]===60&&b[1]===0)encoding='utf-16le';
 else if(b[0]===0&&b[1]===60)encoding='utf-16be';
 else {const header=Array.from(b.slice(0,256),n=>String.fromCharCode(n)).join('');const declared=header.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
 const aliases={'utf-8':'utf-8','utf8':'utf-8','us-ascii':'utf-8','ascii':'utf-8','euc-kr':'euc-kr','ks_c_5601-1987':'euc-kr','cp949':'euc-kr','windows-949':'euc-kr','windows-1252':'windows-1252','iso-8859-1':'windows-1252'};
 if(declared){if(!aliases[declared])throw Error('지원하지 않는 XML 인코딩입니다: '+declared+'. UTF-8 GPX로 저장해 주세요.');encoding=aliases[declared];}}
 try{return new TextDecoder(encoding,{fatal:true}).decode(b).replace(/^\uFEFF/,'');}catch{throw Error('GPX 문자 인코딩을 읽지 못했습니다. UTF-8 또는 UTF-16 GPX로 저장해 주세요.');}
}
function parse(text,filename='코스.gpx'){
 if(typeof text!=='string'||text.length>30*1024*1024)throw Error('GPX는 30MB 이하만 편집할 수 있습니다.');
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('외부 엔티티/DTD가 있는 GPX는 지원하지 않습니다.');
 const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length||doc.documentElement?.localName!=='gpx')throw Error('올바른 GPX 파일이 아닙니다.');
 const containers=Array.from(doc.getElementsByTagName('*')).filter(n=>n.namespaceURI===doc.documentElement.namespaceURI&&((n.localName==='trkseg'&&n.parentNode?.localName==='trk'&&n.parentNode.namespaceURI===doc.documentElement.namespaceURI)||(n.localName==='rte'&&n.parentNode===doc.documentElement)));
 if(containers.length>1000)throw Error("구간 1,000개 이하 GPX만 편집할 수 있습니다.");
 let refs=[],segments=[];containers.forEach((node,slot)=>{const tag=node.localName==='rte'?'rtept':'trkpt';const points=child(node,tag).map(p=>{const x=p.getAttribute('lon'),y=p.getAttribute('lat'),lon=Number(x),lat=Number(y);if(x===null||y===null||x.trim()===''||y.trim()===''||!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw Error('좌표가 잘못된 점이 있습니다. 원본을 그대로 보존하고 불러오기를 중단했습니다.');const e=child(p,'ele')[0];const ele=e&&e.textContent.trim()!==''?Number(e.textContent):NaN;const ref=refs.length;refs.push(p);return{c:[lon,lat,Number.isFinite(ele)?ele:null],ref};});segments.push({slot,points});});
 if(refs.length<2){const wpt=Array.from(doc.getElementsByTagName('*')).filter(n=>n.localName==='wpt').length;throw Error(wpt?'위치 표식(wpt)만 있거나 경로 점이 부족합니다. 트랙(trk/trkseg) 또는 경로(rte)가 있는 GPX를 선택해 주세요.':'편집할 경로 점이 두 개 이상 필요합니다. GPX 안에 trk/trkseg 또는 rte가 있는지 확인해 주세요.');}if(refs.length>200000)throw Error('20만 점 이하 GPX만 편집할 수 있습니다.');
 const name=Array.from(doc.getElementsByTagName('*')).find(n=>n.localName==='name')?.textContent?.trim()||filename.replace(/\.gpx$/i,'');
 return{doc,containers,refs,text,filename,name,segments};
}
const clonePoint=c=>{if(!Array.isArray(c)||!c.slice(0,2).every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90)throw Error("새 좌표 범위를 확인하세요.");return{c:[c[0],c[1],null]};};
function edit(segments,index,start,end,action,data){const seg=segments[index];if(!seg)throw Error('구간을 선택하세요.');if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>=seg.points.length)throw Error('점 번호 범위를 확인하세요.');let points=seg.points.slice();
 if(action==='move'){points[start]=clonePoint(data);}
 else if(action==='insert'){if(segments.reduce((n,s)=>n+s.points.length,0)>=250000)throw Error('수정본은 25만 점 이하만 지원합니다.');points.splice(start+1,0,clonePoint(data));}
 else if(action==='delete'){if(segments.reduce((n,s)=>n+s.points.length,0)<=2)throw Error('코스에는 두 점 이상 남겨 주세요.');points.splice(start,1);if(!points.length)return segments.filter((s,i)=>i!==index);}
 else if(action==='removeRange'){if(end<=start)throw Error('삭제할 두 경계점을 선택하세요.');const left=points.slice(0,start),right=points.slice(end+1),parts=[left,right].filter(p=>p.length).map(points=>({slot:seg.slot,points}));const result=[...segments.slice(0,index),...parts,...segments.slice(index+1)];if(result.reduce((n,s)=>n+s.points.length,0)<2)throw Error('코스에는 두 점 이상 남겨 주세요.');if(result.length>1000)throw Error('구간 수 제한을 초과합니다.');return result;}
 else if(action==='split'){if(start<=0||start>=points.length-1)throw Error('구간의 처음·끝이 아닌 점에서 나눌 수 있습니다.');if(segments.length>=1000)throw Error('구간 수 제한을 초과합니다.');
   // Shared point record: both parts keep the original point (same ref), no new coordinates are invented.
   return [...segments.slice(0,index),{slot:seg.slot,points:points.slice(0,start+1)},{slot:seg.slot,points:points.slice(start)},...segments.slice(index+1)];}
 else if(action==='clearInterior'){if(end-start<2)throw Error('사이에 지울 점이 없습니다.');points.splice(start+1,end-start-1);}
 else if(action==='trim'){if(end<=start)throw Error('자르기는 두 점 이상 선택하세요.');points=points.slice(start,end+1);}
 else if(action==='route'){
   if(end<=start||!Array.isArray(data)||data.length<2||data.some(c=>!Array.isArray(c)||c.length<2||!c.slice(0,2).every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90))throw Error('올바른 대체 경로가 아닙니다.');
   // Preserve selected boundary anchors. Keep snapped route separate, never invent bridges.
   if(segments.length>998||segments.reduce((n,s)=>n+s.points.length,0)-(end-start-1)+data.length>250000)throw Error('수정본 구간 또는 점 수 제한을 초과합니다.');
   const parts=[{slot:seg.slot,points:points.slice(0,start+1)},{slot:seg.slot,points:data.map(clonePoint)},{slot:seg.slot,points:points.slice(end)}];
   return [...segments.slice(0,index),...parts,...segments.slice(index+1)];
 }else throw Error('지원하지 않는 편집입니다.');
 return segments.map((s,i)=>i===index?{...s,points}:s);
}
// Soft move: point p goes to coord; neighbours within radiusM along the path follow by a cosine-weighted share of the
// same offset (1 at p → 0 at the radius). Never crosses a segment. Returns the changed index range and its new coordinates.
function softShift(points,p,coord,radiusM){
 if(!Array.isArray(points)||!Number.isInteger(p)||p<0||p>=points.length)throw Error('점 번호 범위를 확인하세요.');
 const target=clonePoint(coord).c,o=points[p].c,dx=target[0]-o[0],dy=target[1]-o[1],R=Math.min(5000,Math.max(0,Number(radiusM)||0));
 const left=[],right=[];
 if(R>0)for(const [dir,out]of [[-1,left],[1,right]]){let along=0;for(let i=p+dir;i>=0&&i<points.length;i+=dir){along+=meters(points[i-dir].c,points[i].c);if(along>=R)break;const w=.5*(1+Math.cos(Math.PI*along/R));if(w<.01)break;out.push([points[i].c[0]+dx*w,points[i].c[1]+dy*w]);}}
 return{lo:p-left.length,hi:p+right.length,coordinates:[...left.reverse(),[target[0],target[1]],...right]};
}
function softMove(segments,index,p,coord,radiusM){
 const seg=segments[index];if(!seg)throw Error('구간을 선택하세요.');
 const shift=softShift(seg.points,p,coord,radiusM),points=seg.points.slice();
 shift.coordinates.forEach((c,k)=>{points[shift.lo+k]=clonePoint(c);});
 return{segments:segments.map((s,i)=>i===index?{...s,points}:s),lo:shift.lo,hi:shift.hi,moved:shift.coordinates.length};
}
// Overlapping passes (out-and-back, repeated loops). `hits` are the on-screen points or edges near a click, in path order,
// each {si,pi,d} with d = pixel distance. A new pass starts when the segment changes or more than `gap` indices were skipped;
// every pass keeps its nearest hit.
function groupPasses(hits,gap=8){const out=[];let last=null;for(const h of hits){if(last&&h.si===last.si&&h.pi-last.pi<=gap){if(h.d<out[out.length-1].d)out[out.length-1]=h;}else out.push(h);last=h;}return out;}
// Among the passes about as close as the nearest one (within tol px), prefer the one that continues from the current
// selection: same segment first, then the smallest index distance. Returns {hit, passes (path order)} or null.
function pickPass(passes,selected,start,tol=6){if(!passes.length)return null;let min=Infinity;for(const h of passes)if(h.d<min)min=h.d;
 const near=passes.filter(h=>h.d<=min+tol),key=h=>[h.si===selected?0:1,Math.abs(h.si-selected),h.si===selected?Math.abs(h.pi-start):0,h.d];
 let hit=near[0],best=key(hit);for(const h of near.slice(1)){const k=key(h);for(let i=0;i<4;i++){if(k[i]===best[i])continue;if(k[i]<best[i]){hit=h;best=k;}break;}}
 return{hit,passes:near};}
function exportGpx(source,segments,{stripTimes=true}={}){
 const doc=source.doc.cloneNode(true);Array.from(doc.childNodes).filter(n=>n.nodeType===7).forEach(n=>doc.removeChild(n));const containers=Array.from(doc.getElementsByTagName('*')).filter(n=>n.namespaceURI===doc.documentElement.namespaceURI&&((n.localName==='trkseg'&&n.parentNode?.localName==='trk'&&n.parentNode.namespaceURI===doc.documentElement.namespaceURI)||(n.localName==='rte'&&n.parentNode===doc.documentElement)));
 containers.forEach((container,slot)=>{const tag=container.localName==='rte'?'rtept':'trkpt',parts=segments.filter(s=>s.slot===slot);const fragment=doc.createDocumentFragment();
 parts.forEach((s,i)=>{const out=i===0?container.cloneNode(true):container.cloneNode(false);const old=child(out,tag);const marker=doc.createComment('gildam-points');if(old.length)out.insertBefore(marker,old[0]);else out.appendChild(marker);old.forEach(n=>out.removeChild(n));
 for(const point of s.points){let node;if(point.ref!==undefined){const original=source.refs[point.ref];if(!original)throw Error('원본 점 참조가 잘못됐습니다.');node=doc.importNode(original,true);}else{node=doc.createElementNS(container.namespaceURI,tag);node.setAttribute('lon',String(point.c[0]));node.setAttribute('lat',String(point.c[1]));}
 if(stripTimes)Array.from(node.getElementsByTagName('*')).filter(x=>x.localName==='time').forEach(x=>x.parentNode.removeChild(x));out.insertBefore(node,marker);}
 out.removeChild(marker);fragment.appendChild(out);});container.parentNode.replaceChild(fragment,container);});
 if(stripTimes)Array.from(doc.getElementsByTagName('*')).filter(n=>n.localName==='time').forEach(n=>n.parentNode.removeChild(n));
 if(segments!==source.segments)Array.from(doc.getElementsByTagName('*')).filter(n=>n.localName==='bounds').forEach(n=>n.parentNode.removeChild(n));
 return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(doc);
}
function restore(text,filename,segments){const s=parse(text,filename);if(!Array.isArray(segments)||segments.length>1000)throw Error('저장된 구간 형식이 잘못됐습니다.');const originals=s.segments.flatMap(x=>x.points);let count=0;for(const seg of segments){if(!Number.isInteger(seg.slot)||seg.slot<0||seg.slot>=s.containers.length||!Array.isArray(seg.points))throw Error('저장된 구간을 확인하세요.');for(const p of seg.points){if(!Array.isArray(p.c)||p.c.length<2||!p.c.slice(0,2).every(Number.isFinite)||Math.abs(p.c[0])>180||Math.abs(p.c[1])>90||p.ref!==undefined&&(!Number.isInteger(p.ref)||!s.refs[p.ref]))throw Error('저장된 점을 확인하세요.');if(p.ref!==undefined){const original=originals[p.ref];if(p.c[0]!==original.c[0]||p.c[1]!==original.c[1])throw Error('원본 점 참조 좌표가 다릅니다.');}if(++count>250000)throw Error('저장된 점이 너무 많습니다.');}}
 return {...s,restoredSegments:segments};}
/* Partial road-following correction around one moved/inserted point. Pure functions + injectable router (no DOM). */
const REROUTE=Object.freeze({windowM:180,minWindowM:50,maxWindowM:1000,minAnchorM:15,minLegM:2,maxLegM:30000,maxRouteM:100000,maxRoutePoints:100000,serverSnapM:250,joinM:3,anchorJoinM:10,movedSnapM:50,modes:['walk','hike','bike']});
function meters(a,b){const r=Math.PI/180,dla=(b[1]-a[1])*r,dlo=(b[0]-a[0])*r,h=Math.sin(dla/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dlo/2)**2;return 12742017.6*Math.asin(Math.min(1,Math.sqrt(h)));}
function rerouteError(code,text){const e=Error(text);e.code=code;return e;}
const fmtM=m=>m>=1000?(m/1000).toFixed(1)+'km':Math.round(m)+'m';
// Anchors L/R: walk outward along the same segment until ~windowM along-path AND >= minAnchorM direct from P
// (skips duplicates/near points and out-and-back loops). Segment ends or bounds stop the walk; never crosses segments.
function planReroute(points,p,{windowM=REROUTE.windowM,bounds}={}){
 if(!Array.isArray(points)||!Number.isInteger(p)||p<0||p>=points.length)throw rerouteError('plan','보정할 점을 확인하세요.');
 windowM=Math.min(REROUTE.maxWindowM,Math.max(REROUTE.minWindowM,Number(windowM)||REROUTE.windowM));
 const lo=Math.max(0,bounds?.min??0),hi=Math.min(points.length-1,bounds?.max??points.length-1);
 if(p<lo||p>hi)throw rerouteError('plan','선택 범위 안의 점만 보정할 수 있습니다.');
 const P=points[p].c;
 const pick=dir=>{let along=0,best=null;for(let i=p+dir;dir<0?i>=lo:i<=hi;i+=dir){along+=meters(points[i-dir].c,points[i].c);const direct=meters(P,points[i].c);if(direct>=REROUTE.minAnchorM){best={i,along,direct};if(along>=windowM)return best;}if(along>REROUTE.maxWindowM*3)break;}return best;};
 const L=p>lo?pick(-1):null,Rt=p<hi?pick(1):null;
 if(!L&&!Rt)throw rerouteError('plan','앞뒤에 기준이 될 점이 없습니다. 보정 범위를 늘리거나 다른 점을 옮겨 주세요.');
 const legs=[];if(L)legs.push({from:points[L.i].c.slice(0,2),to:P.slice(0,2)});if(Rt)legs.push({from:P.slice(0,2),to:points[Rt.i].c.slice(0,2)});
 for(const l of legs)if(meters(l.from,l.to)>REROUTE.maxLegM)throw rerouteError('limit','기준점과 옮긴 점 사이가 30km를 넘습니다. 점을 더 가까이 옮기거나 보정 범위를 줄이세요.');
 const keepL=L?L.i:p-1,keepR=Rt?Rt.i:p+1;let replacedM=0;for(let i=Math.max(0,keepL);i<Math.min(points.length-1,keepR);i++)replacedM+=meters(points[i].c,points[i+1].c);
 return{p,pCoord:P.slice(0,2),left:L?L.i:null,right:Rt?Rt.i:null,leftAlong:L?.along??0,rightAlong:Rt?.along??0,keepL,keepR,replaced:Math.max(0,Math.min(points.length,keepR)-keepL-1),replacedM,legs,windowM};
}
// Validate one /routing/route response. Returns [[lon,lat],...] without consecutive duplicates or elevation.
function validateRoute(coords,leg){
 if(!Array.isArray(coords)||coords.length<2||coords.length>REROUTE.maxRoutePoints)throw rerouteError('invalid','올바른 경로를 받지 못했습니다.');
 const out=[];for(const c of coords){if(!Array.isArray(c)||c.length<2)throw rerouteError('invalid','경로 좌표 형식이 잘못됐습니다.');const lon=Number(c[0]),lat=Number(c[1]);if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw rerouteError('invalid','경로 좌표 범위가 잘못됐습니다.');const q=out[out.length-1];if(q&&q[0]===lon&&q[1]===lat)continue;out.push([lon,lat]);}
 if(out.length<2)throw rerouteError('invalid','경로 점이 부족합니다.');
 if(leg&&(meters(leg.from,out[0])>REROUTE.serverSnapM||meters(leg.to,out[out.length-1])>REROUTE.serverSnapM))throw rerouteError('invalid','경로 끝점이 요청 지점과 맞지 않습니다(좌표 순서 또는 길 연결 오류).');
 let len=0;for(let i=1;i<out.length;i++)len+=meters(out[i-1],out[i]);if(len>REROUTE.maxRouteM)throw rerouteError('limit','계산된 경로가 100km를 넘습니다.');
 return out;
}
// Join L→P and P→R legs. Snapped P of both legs must coincide (joinM) — never bridge two different roads.
function mergeLegs(results,plan){
 if(!Array.isArray(results)||results.length!==plan.legs.length)throw rerouteError('invalid','경로 계산 결과가 부족합니다.');
 const legs=results.map((r,i)=>validateRoute(r,plan.legs[i]));let coordinates=legs[0],pIndex=plan.left!==null?legs[0].length-1:0;
 if(legs.length===2){const a=legs[0][legs[0].length-1],b=legs[1][0],gap=meters(a,b);if(gap>REROUTE.joinM)throw rerouteError('split','이 점이 다른 도로에 연결되었습니다. 교차로 또는 해당 길 위로 옮겨 주세요. (앞뒤 경로 끝 차이 '+fmtM(gap)+')');coordinates=legs[0].concat(legs[1].slice(1));}
 const off=meters(coordinates[pIndex],plan.pCoord);if(off>REROUTE.movedSnapM)throw rerouteError('far','옮긴 점이 길에서 약 '+fmtM(off)+' 떨어져 있습니다. 해당 길 위로 옮겨 주세요.');
 let length=0;for(let i=1;i<coordinates.length;i++)length+=meters(coordinates[i-1],coordinates[i]);
 return{coordinates,pIndex,pOffsetM:off,length};
}
// Replace only points strictly between kept anchors with the route. Anchor joins within anchorJoinM stay one segment;
// otherwise the route becomes its own segment (same slot) instead of an invented straight link.
function applyReroute(segments,index,plan,coordinates,pIndex=0){
 const seg=segments[index];if(!seg||plan.p>=seg.points.length)throw rerouteError('stale','보정할 구간이 바뀌었습니다. 다시 계산하세요.');
 if(!Array.isArray(coordinates)||coordinates.length<2)throw rerouteError('invalid','올바른 대체 경로가 아닙니다.');
 const pts=seg.points,prefix=pts.slice(0,plan.keepL+1),suffix=plan.keepR<pts.length?pts.slice(plan.keepR):[],mid=coordinates.map(clonePoint);
 const gapL=prefix.length?meters(prefix[prefix.length-1].c,coordinates[0]):0,gapR=suffix.length?meters(suffix[0].c,coordinates[coordinates.length-1]):0;
 const joinL=gapL<=REROUTE.anchorJoinM,joinR=gapR<=REROUTE.anchorJoinM,parts=[];let cur=prefix.slice();
 if(!joinL){parts.push(cur);cur=[];}const midStart=cur.length;cur=cur.concat(mid);if(!joinR){parts.push(cur);cur=[];}cur=cur.concat(suffix);if(cur.length)parts.push(cur);
 const total=segments.reduce((n,s)=>n+s.points.length,0)-pts.length+parts.reduce((n,p)=>n+p.length,0);
 if(segments.length-1+parts.length>1000||total>250000)throw rerouteError('limit','수정본 구간 또는 점 수 제한을 초과합니다.');
 const removed=pts.slice(plan.keepL+1,plan.keepR);
 return{segments:[...segments.slice(0,index),...parts.map(points=>({slot:seg.slot,points})),...segments.slice(index+1)],selected:index+(joinL?0:1),start:midStart+pIndex,joined:{left:joinL,right:joinR},gaps:{left:gapL,right:gapR},removedOriginal:removed.filter(p=>p.ref!==undefined).length,added:mid.length};
}
function createRouter({fetch:fetchFn=(...a)=>globalThis.fetch(...a),endpoint='/routing/route',retries=3,retryDelay=600,timeout=25000,cacheSize=100,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const cache=new Map(),abortError=()=>{const e=Error('취소됨');e.name='AbortError';return e;};
 async function leg(from,to,mode,signal){
  if(!REROUTE.modes.includes(mode))throw rerouteError('mode','지원하지 않는 활동 유형입니다.');
  const body={from:[+(+from[0]).toFixed(7),+(+from[1]).toFixed(7)],to:[+(+to[0]).toFixed(7),+(+to[1]).toFixed(7)],mode},key=JSON.stringify(body);
  if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);return v;}
  for(let attempt=0;;attempt++){
   if(signal?.aborted)throw abortError();
   const ctl=new AbortController(),onAbort=()=>ctl.abort();signal?.addEventListener?.('abort',onAbort,{once:true});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;ctl.abort();},timeout);let res,data;
   try{res=await fetchFn(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctl.signal});data=await res.json().catch(()=>({}));}
   catch{if(signal?.aborted)throw abortError();throw timedOut?rerouteError('timeout','경로 계산 시간이 초과됐습니다. 보정 범위를 줄이거나 다시 계산하세요.'):rerouteError('network','경로 서버에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 계산하세요.');}
   finally{clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);}
   if(res.status===503&&attempt<retries){await sleep(retryDelay);continue;}
   if(signal?.aborted)throw abortError();
   if(!res.ok)throw rerouteError('http'+res.status,data?.error||'경로 계산 실패 ('+res.status+')');
   const v=validateRoute(data?.coordinates,body);cache.set(key,v);if(cache.size>cacheSize)cache.delete(cache.keys().next().value);return v;
  }
 }
 return{leg,cache};
}
// Legs are requested sequentially: the engine computes one route at a time.
async function computeReroute(router,plan,mode,signal){const results=[];for(const l of plan.legs)results.push(await router.leg(l.from,l.to,mode,signal));return mergeLegs(results,plan);}
root.GildamGpxModel={decode,parse,edit,softShift,softMove,groupPasses,pickPass,exportGpx,restore,REROUTE,meters,planReroute,validateRoute,mergeLegs,applyReroute,createRouter,computeReroute};
})(typeof window!=='undefined'?window:globalThis);
