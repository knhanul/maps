/* Image → route tracing (pure, no DOM). Image pixels (u right, v down) ↔ Web Mercator (x right, y down, 0..1). */
(function(root){'use strict';
// Similarity transform (scale+rotation+translation, no reflection): x = a·u − b·v + tx, y = b·u + a·v + ty.
// Exact for screenshots of Web Mercator maps (any zoom/rotation/crop).
const apply=(T,u,v)=>[T.a*u-T.b*v+T.tx,T.b*u+T.a*v+T.ty];
function invert(T,x,y){const d=T.a*T.a+T.b*T.b;if(!(d>0))throw Error('위치 맞춤 정보가 잘못됐습니다.');const dx=x-T.tx,dy=y-T.ty;return[(T.a*dx+T.b*dy)/d,(-T.b*dx+T.a*dy)/d];}
// Least squares fit from ≥2 pairs {u,v,x,y}; 1 pair only translates the current transform.
function fitSimilarity(pairs,current){
 if(!Array.isArray(pairs)||!pairs.length)throw Error('기준점이 없습니다.');
 if(pairs.length===1){if(!current)throw Error('기준점이 2개 이상 필요합니다.');const p=pairs[0],q=apply(current,p.u,p.v);return{...current,tx:current.tx+p.x-q[0],ty:current.ty+p.y-q[1]};}
 const n=pairs.length,mu=pairs.reduce((s,p)=>s+p.u,0)/n,mv=pairs.reduce((s,p)=>s+p.v,0)/n,mx=pairs.reduce((s,p)=>s+p.x,0)/n,my=pairs.reduce((s,p)=>s+p.y,0)/n;
 let sa=0,sb=0,ss=0;for(const p of pairs){const u=p.u-mu,v=p.v-mv,x=p.x-mx,y=p.y-my;sa+=u*x+v*y;sb+=u*y-v*x;ss+=u*u+v*v;}
 if(ss<1e-9)throw Error('이미지 기준점이 서로 너무 가깝습니다. 멀리 떨어진 지점을 고르세요.');
 const a=sa/ss,b=sb/ss;if(!(Math.hypot(a,b)>0))throw Error('기준점 배치를 확인하세요.');
 return{a,b,tx:mx-a*mu+b*mv,ty:my-b*mu-a*mv};
}
function residuals(T,pairs){return pairs.map(p=>{const q=apply(T,p.u,p.v);return Math.hypot(q[0]-p.x,q[1]-p.y);});}
// Pick the most saturated pixel near (u,v): clicking exactly on a 3–5 px line is hard.
function pickColor(img,u,v,r=4){const{width:w,height:h,data}=img;let best=null,bs=-1;for(let y=Math.max(0,Math.round(v)-r);y<=Math.min(h-1,Math.round(v)+r);y++)for(let x=Math.max(0,Math.round(u)-r);x<=Math.min(w-1,Math.round(u)+r);x++){const i=(y*w+x)*4,R=data[i],G=data[i+1],Bl=data[i+2],mx=Math.max(R,G,Bl),mn=Math.min(R,G,Bl),s=mx?(mx-mn)/mx:0,score=s*(mx-mn);if(data[i+3]>128&&score>bs){bs=score;best=[R,G,Bl];}}if(!best)throw Error('이미지 안을 누르세요.');return best;}
function buildMask(img,color,tol=60){const{width:w,height:h,data}=img,m=new Uint8Array(w*h),t2=tol*tol;let n=0;for(let i=0,j=0;i<m.length;i++,j+=4){if(data[j+3]<128)continue;const dr=data[j]-color[0],dg=data[j+1]-color[1],db=data[j+2]-color[2];if(dr*dr*.8+dg*dg*1.1+db*db*1.1<=t2){m[i]=1;n++;}}return{mask:m,count:n,width:w,height:h};}
function snapToMask(M,u,v,r=15){const{mask,width:w,height:h}=M,cu=Math.round(u),cv=Math.round(v);let best=null,bd=r*r+1;for(let y=Math.max(0,cv-r);y<=Math.min(h-1,cv+r);y++)for(let x=Math.max(0,cu-r);x<=Math.min(w-1,cu+r);x++){if(!mask[y*w+x])continue;const d=(x-cu)**2+(y-cv)**2;if(d<bd){bd=d;best=[x,y];}}return best;}
// A* on the pixel grid. Line pixels cost 1 (edge pixels 1.5 to stay centred); off-line pixels cost gapCost so short gaps
// (arrow icons, labels drawn over the line) are bridged but long shortcuts are avoided. Returns [[u,v],...] and bridged flags.
function tracePath(M,from,to,{gapCost=25,maxNodes=12e6}={}){
 const{mask,width:w,height:h}=M,N=w*h;if(N>maxNodes)throw Error('이미지가 너무 큽니다.');
 const idx=(x,y)=>y*w+x,S=idx(from[0],from[1]),G=idx(to[0],to[1]);if(S===G)return{path:[from.slice()],bridged:[false]};
 const cost=new Float32Array(N);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=idx(x,y);if(!mask[i]){cost[i]=gapCost;continue;}const edge=x===0||y===0||x===w-1||y===h-1||!mask[i-1]||!mask[i+1]||!mask[i-w]||!mask[i+w];cost[i]=edge?1.5:1;}
 const g=new Float64Array(N).fill(Infinity),par=new Int32Array(N).fill(-1),closed=new Uint8Array(N),gx=to[0],gy=to[1];
 const H=(i)=>{const dx=Math.abs(i%w-gx),dy=Math.abs((i/w|0)-gy);return Math.max(dx,dy)+(Math.SQRT2-1)*Math.min(dx,dy);};
 let hi=new Int32Array(1024),hk=new Float64Array(1024),hn=0;
 const push=(i,k)=>{if(hn===hi.length){const a=new Int32Array(hn*2),b=new Float64Array(hn*2);a.set(hi);b.set(hk);hi=a;hk=b;}let c=hn++;while(c>0){const p=(c-1)>>1;if(hk[p]<=k)break;hi[c]=hi[p];hk[c]=hk[p];c=p;}hi[c]=i;hk[c]=k;};
 const pop=()=>{const top=hi[0],li=hi[--hn],lk=hk[hn];let c=0;for(;;){let l=2*c+1;if(l>=hn)break;if(l+1<hn&&hk[l+1]<hk[l])l++;if(hk[l]>=lk)break;hi[c]=hi[l];hk[c]=hk[l];c=l;}hi[c]=li;hk[c]=lk;return top;};
 g[S]=0;push(S,H(S));const D=[[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[-1,-1,Math.SQRT2]];
 while(hn){const i=pop();if(closed[i])continue;if(i===G)break;closed[i]=1;const x=i%w,y=i/w|0;
  for(const[dx,dy,dl]of D){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(closed[j])continue;const ng=g[i]+dl*(cost[i]+cost[j])/2;if(ng<g[j]){g[j]=ng;par[j]=i;push(j,ng+H(j));}}}
 if(par[G]<0)throw Error('두 지점을 잇는 선을 찾지 못했습니다.');
 const path=[],bridged=[];for(let i=G;i>=0;i=par[i]){path.push([i%w,i/w|0]);bridged.push(!mask[i]);if(i===S)break;}
 path.reverse();bridged.reverse();return{path,bridged};
}
// Longest consecutive off-line run (pixels) — reported so users can check gaps that were bridged.
function bridgedRuns(bridged){let run=0,max=0,total=0;for(const b of bridged){if(b){run++;total++;if(run>max)max=run;}else run=0;}return{max,total};}
// Douglas–Peucker on [[x,y],...].
function simplify(P,eps=0.8){if(P.length<3)return P.slice();const keep=new Uint8Array(P.length);keep[0]=keep[P.length-1]=1;const st=[[0,P.length-1]];
 while(st.length){const[a,b]=st.pop();const[ax,ay]=P[a],[bx,by]=P[b],dx=bx-ax,dy=by-ay,L=Math.hypot(dx,dy)||1;let md=-1,mi=-1;for(let i=a+1;i<b;i++){const d=Math.abs(dy*(P[i][0]-ax)-dx*(P[i][1]-ay))/L;if(d>md){md=d;mi=i;}}if(md>eps){keep[mi]=1;st.push([a,mi],[mi,b]);}}
 return P.filter((_,i)=>keep[i]);}
const R=6371008.8,rad=Math.PI/180;
function meters(a,b){const dla=(b[1]-a[1])*rad,dlo=(b[0]-a[0])*rad,h=Math.sin(dla/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dlo/2)**2;return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));}
function length(C){let d=0;for(let i=1;i<C.length;i++)d+=meters(C[i-1],C[i]);return d;}
// Existing trace vertices roughly every spacingM (never invented off-trace points; start and end always included).
function sampleAlong(C,spacingM=1500){if(C.length<2)return C.slice();const out=[C[0]];let acc=0;for(let i=1;i<C.length;i++){acc+=meters(C[i-1],C[i]);if(acc>=spacingM&&i<C.length-1){out.push(C[i]);acc=0;}}out.push(C[C.length-1]);return out;}
// Max distance (m) from routed points to the traced polyline: flags legs that took a different road than the image.
function deviation(routed,trace){const lat0=trace[0][1]*rad,kx=Math.cos(lat0)*R*rad,ky=R*rad;const T=trace.map(c=>[c[0]*kx,c[1]*ky]);let max=0;
 const step=Math.max(1,Math.floor(routed.length/400));for(let k=0;k<routed.length;k+=step){const p=[routed[k][0]*kx,routed[k][1]*ky];let best=Infinity;for(let i=1;i<T.length;i++){const a=T[i-1],b=T[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);if(d<best)best=d;}if(best>max)max=best;}return max;}
function toGpx(name,parts){const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="길담 maps.nuni.co.kr (이미지 추출)" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(name)}</name></metadata>\n<trk><name>${esc(name)}</name>\n${parts.filter(p=>p.length>1).map(p=>`<trkseg>\n${p.map(c=>`<trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}"></trkpt>`).join('\n')}\n</trkseg>`).join('\n')}\n</trk>\n</gpx>\n`;}
root.GildamTraceModel={apply,invert,fitSimilarity,residuals,pickColor,buildMask,snapToMask,tracePath,bridgedRuns,simplify,meters,length,sampleAlong,deviation,toGpx};
})(typeof window!=='undefined'?window:globalThis);
