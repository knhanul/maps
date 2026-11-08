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
root.GildamGpxModel={decode,parse,edit,exportGpx,restore};
})(typeof window!=='undefined'?window:globalThis);
