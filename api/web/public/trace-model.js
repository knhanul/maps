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
function scaleAround(T,w,h,k){if(!(k>0)||!isFinite(k))throw Error('크기 배율을 확인하세요.');const a=T.a*k,b=T.b*k,c=apply(T,w/2,h/2);return{a,b,tx:c[0]-a*w/2+b*h/2,ty:c[1]-b*w/2-a*h/2};}
function rotateAround(T,w,h,deg){const r=deg*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r),a=T.a*cos-T.b*sin,b=T.a*sin+T.b*cos,c=apply(T,w/2,h/2);return{a,b,tx:c[0]-a*w/2+b*h/2,ty:c[1]-b*w/2-a*h/2};}
function translate(T,dx,dy){return{...T,tx:T.tx+dx,ty:T.ty+dy};}
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

/* Automatic image-to-map alignment (browser only). Pixel similarity transform is
   searched with Sobel edges + phase correlation over a coarse scale/angle grid, then
   scored with normalized cross-correlation. Thresholds:
   ALIGN_MIN_NCC (0.28): accept if edge NCC is at least this after the best transform.
   ALIGN_MIN_PEAK (5): phase-correlation peak / mean must exceed this (sharp peak).
   ALIGN_MIN_OVERLAP (0.22): fraction of dest edge pixels that land inside the source.
   ALIGN_MAX_RESIDUAL (6): mean residual in downscaled dest pixels after inlier refinement.
   Scale 0.55–1.85 is in long-side-normalized space (≈1 when the image covers a similar extent to the current map view).
   ALIGN_LONG_SIDE (256): final working resolution after a coarse 128px search; keeps the UI responsive with yieldEvery. */
const ALIGN_LONG_SIDE=256,ALIGN_MIN_NCC=.28,ALIGN_MIN_PEAK=5,ALIGN_MIN_OVERLAP=.22,ALIGN_MAX_RESIDUAL=6;
const ALIGN_ANGLE_MIN=-36,ALIGN_ANGLE_MAX=36,ALIGN_ANGLE_STEP=4;
const ALIGN_SCALE_MIN=.55,ALIGN_SCALE_MAX=1.85,ALIGN_SCALE_STEPS=8;
function nextPow2(n){let p=1;while(p<n)p<<=1;return p;}
function lumaOf(img){const n=img.width*img.height,g=new Float32Array(n),d=img.data;for(let i=0,j=0;i<n;i++,j+=4){const a=(d[j+3]??255)/255;g[i]=((.2126*d[j]+.7152*d[j+1]+.0722*d[j+2])/255)*a;}return g;}
function sampleGray(g,w,h,x,y){if(x<0||y<0||x>w-1||y>h-1)return 0;const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;return g[y0*w+x0]*(1-fx)*(1-fy)+g[y0*w+x1]*fx*(1-fy)+g[y1*w+x0]*(1-fx)*fy+g[y1*w+x1]*fx*fy;}
function resizeRgba(img,nw,nh){const out=new Uint8ClampedArray(nw*nh*4),g=lumaOf(img),sw=img.width,sh=img.height,src=img.data;
 for(let y=0;y<nh;y++)for(let x=0;x<nw;x++){const u=(x+.5)*sw/nw-.5,v=(y+.5)*sh/nh-.5,x0=Math.max(0,Math.min(sw-1,u)),y0=Math.max(0,Math.min(sh-1,v));
  const ix=Math.floor(x0),iy=Math.floor(y0),ix1=Math.min(sw-1,ix+1),iy1=Math.min(sh-1,iy+1),fx=x0-ix,fy=y0-iy,o=(y*nw+x)*4;
  for(let c=0;c<4;c++){const a=src[(iy*sw+ix)*4+c],b=src[(iy*sw+ix1)*4+c],d=src[(iy1*sw+ix)*4+c],e=src[(iy1*sw+ix1)*4+c];out[o+c]=a*(1-fx)*(1-fy)+b*fx*(1-fy)+d*(1-fx)*fy+e*fx*fy;}}
 return{width:nw,height:nh,data:out};}
function fitLongSide(img,side){const m=Math.max(img.width,img.height);if(!(m>0))return{image:img,scaleX:1,scaleY:1};if(m<=side)return{image:img,scaleX:1,scaleY:1};
 const k=side/m,nw=Math.max(1,Math.round(img.width*k)),nh=Math.max(1,Math.round(img.height*k));return{image:resizeRgba(img,nw,nh),scaleX:nw/img.width,scaleY:nh/img.height};}
function sobelMag(gray,w,h){const m=new Float32Array(w*h);let max=0;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,gx=-gray[i-w-1]-2*gray[i-1]-gray[i+w-1]+gray[i-w+1]+2*gray[i+1]+gray[i+w+1],gy=-gray[i-w-1]-2*gray[i-w]-gray[i-w+1]+gray[i+w-1]+2*gray[i+w]+gray[i+w+1],v=Math.hypot(gx,gy);m[i]=v;if(v>max)max=v;}
 if(max>0)for(let i=0;i<m.length;i++)m[i]/=max;return m;}
function edgeEnergy(m){let s=0;for(let i=0;i<m.length;i++)s+=m[i];return s/m.length;}
function fft1(re,im,n,inv){let j=0;for(let i=0;i<n;i++){if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}let k=n>>1;while(k>=1&&j>=k){j-=k;k>>=1;}j+=k;}
 for(let size=2;size<=n;size<<=1){const half=size>>1,ang=(inv?2:-2)*Math.PI/size,wr0=Math.cos(ang),wi0=Math.sin(ang);
  for(let i=0;i<n;i+=size){let cr=1,ci=0;for(let k=0;k<half;k++){const a=i+k,b=a+half,tr=cr*re[b]-ci*im[b],ti=cr*im[b]+ci*re[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const nr=cr*wr0-ci*wi0;ci=cr*wi0+ci*wr0;cr=nr;}}}
 if(inv)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}}
function fft2(re,im,w,h,inv){const rr=new Float64Array(w),ri=new Float64Array(w);for(let y=0;y<h;y++){const o=y*w;rr.set(re.subarray(o,o+w));ri.set(im.subarray(o,o+w));fft1(rr,ri,w,inv);re.set(rr,o);im.set(ri,o);}
 const cr=new Float64Array(h),ci=new Float64Array(h);for(let x=0;x<w;x++){for(let y=0;y<h;y++){cr[y]=re[y*w+x];ci[y]=im[y*w+x];}fft1(cr,ci,h,inv);for(let y=0;y<h;y++){re[y*w+x]=cr[y];im[y*w+x]=ci[y];}}}
function hann2(w,h){const a=new Float32Array(w*h);for(let y=0;y<h;y++){const wy=.5-.5*Math.cos(2*Math.PI*y/Math.max(1,h-1));for(let x=0;x<w;x++)a[y*w+x]=wy*(.5-.5*Math.cos(2*Math.PI*x/Math.max(1,w-1)));}return a;}
function prepareDestFft(dest,w,h,window){const re=new Float64Array(w*h),im=new Float64Array(w*h);for(let i=0;i<w*h;i++)re[i]=dest[i]*(window?window[i]:1);fft2(re,im,w,h,false);return{re,im};}
function phaseCorrShift(destFft,src,w,h,window,buf){const n=w*h;if(!buf||buf.n!==n){buf={n,re1:new Float64Array(n),im1:new Float64Array(n),re2:new Float64Array(n),im2:new Float64Array(n)};}
 const{re1,im1,re2,im2}=buf;for(let i=0;i<n;i++){re2[i]=src[i]*(window?window[i]:1);im2[i]=0;}
 fft2(re2,im2,w,h,false);
 for(let i=0;i<n;i++){const pr=destFft.re[i]*re2[i]+destFft.im[i]*im2[i],pi=destFft.im[i]*re2[i]-destFft.re[i]*im2[i],mag=Math.hypot(pr,pi)||1e-12;re1[i]=pr/mag;im1[i]=pi/mag;}
 fft2(re1,im1,w,h,true);let best=-Infinity,bx=0,by=0,sum=0,sum2=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=re1[y*w+x];sum+=v;sum2+=v*v;if(v>best){best=v;bx=x;by=y;}}
 if(bx>w/2)bx-=w;if(by>h/2)by-=h;const mean=sum/n,std=Math.sqrt(Math.max(0,sum2/n-mean*mean));
 return{dx:bx,dy:by,peak:best,ratio:std>1e-9?(best-mean)/std:0,buf};}
function warp(src,sw,sh,dw,dh,T){const out=new Float32Array(dw*dh);for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){const[u,v]=invert(T,x,y);out[y*dw+x]=sampleGray(src,sw,sh,u,v);}return out;}
function nccAndResidual(src,sw,sh,dst,dw,dh,T){let sumS=0,sumD=0,sumS2=0,sumD2=0,sumSD=0,n=0,res=0,inside=0,total=0;const step=2;
 for(let y=1;y<dh-1;y+=step)for(let x=1;x<dw-1;x+=step){const d=dst[y*dw+x];if(d<.08)continue;total++;const[u,v]=invert(T,x,y);if(u<1||v<1||u>sw-2||v>sh-2)continue;const s=sampleGray(src,sw,sh,u,v);sumS+=s;sumD+=d;sumS2+=s*s;sumD2+=d*d;sumSD+=s*d;n++;inside++;res+=Math.abs(s-d);}
 const overlap=total?inside/total:0,den=Math.sqrt(Math.max(0,n*sumS2-sumS*sumS)*Math.max(0,n*sumD2-sumD*sumD)),ncc=(n>=80&&den>1e-9)?(n*sumSD-sumS*sumD)/den:0;
 return{ncc,overlap,residual:n?res/n:1,samples:n};}
function centerT(s,ang,sw,sh,dw,dh){const r=ang*Math.PI/180,a=s*Math.cos(r),b=s*Math.sin(r);return{a,b,tx:dw/2-a*(sw/2)+b*(sh/2),ty:dh/2-b*(sw/2)-a*(sh/2)};}
function scales(){const out=[];for(let i=0;i<ALIGN_SCALE_STEPS;i++){const t=i/(ALIGN_SCALE_STEPS-1);out.push(ALIGN_SCALE_MIN*Math.pow(ALIGN_SCALE_MAX/ALIGN_SCALE_MIN,t));}return out;}
function angles(){const out=[];for(let a=ALIGN_ANGLE_MIN;a<=ALIGN_ANGLE_MAX+1e-9;a+=ALIGN_ANGLE_STEP)out.push(a);return out;}
function fail(reason,extra){return{ok:false,confidence:0,transform:null,ncc:0,peak:0,overlap:0,residual:null,reason,...extra};}
async function searchGrid(srcE,sw,sh,dstE,dw,dh,jobs,opts,pcBuf){
 const pad=nextPow2(Math.max(dw,dh,sw,sh)),D=new Float32Array(pad*pad);for(let y=0;y<dh;y++)D.set(dstE.subarray(y*dw,y*dw+dw),y*pad);
 const win=hann2(pad,pad),destFft=prepareDestFft(D,pad,pad,win);let best=null;
 for(let i=0;i<jobs.length;i++){const{ang,s}=jobs[i],T0=centerT(s,ang,sw,sh,dw,dh),warped=warp(srcE,sw,sh,pad,pad,T0),pc=phaseCorrShift(destFft,warped,pad,pad,win,pcBuf);pcBuf=pc.buf;
  const T={a:T0.a,b:T0.b,tx:T0.tx+pc.dx,ty:T0.ty+pc.dy},score=nccAndResidual(srcE,sw,sh,dstE,dw,dh,T),rank=score.ncc+Math.min(.15,pc.ratio/80);
  if(!best||rank>best.rank)best={T,score,peak:pc.ratio,rank,ang,s};
  if(opts.yieldEvery&&(i%opts.yieldEvery===opts.yieldEvery-1))await(opts.yieldFn||(()=>new Promise(r=>setTimeout(r,0))))();}
 return best;
}
async function alignImages(srcImg,dstImg,opts={}){
 if(!srcImg?.width||!dstImg?.width)return fail('empty');
 const srcFit=fitLongSide(srcImg,ALIGN_LONG_SIDE),dstFit=fitLongSide(dstImg,ALIGN_LONG_SIDE);
 const src=srcFit.image,dst=dstFit.image,sw=src.width,sh=src.height,dw=dst.width,dh=dst.height;
 const srcE=sobelMag(lumaOf(src),sw,sh),dstE=sobelMag(lumaOf(dst),dw,dh);
 if(edgeEnergy(srcE)<.01||edgeEnergy(dstE)<.01)return fail('weak_edges');
 // Coarse search at long side 128, then refine at ALIGN_LONG_SIDE around the winner.
 const srcLo=fitLongSide(src,128),dstLo=fitLongSide(dst,128),sl=srcLo.image,dl=dstLo.image;
 const srcLE=sobelMag(lumaOf(sl),sl.width,sl.height),dstLE=sobelMag(lumaOf(dl),dl.width,dl.height);
 const coarseJobs=[];for(const ang of angles())for(const s of scales())coarseJobs.push({ang,s});
 const coarse=await searchGrid(srcLE,sl.width,sl.height,dstLE,dl.width,dl.height,coarseJobs,opts,null);
 if(!coarse)return fail('no_candidate');
 const ba=coarse.ang,bs=coarse.s,fineJobs=[];
 for(const ang of [ba-3,ba-2,ba-1,ba,ba+1,ba+2,ba+3])for(const s of [bs*.88,bs*.92,bs*.96,bs,bs*1.04,bs*1.08,bs*1.12])fineJobs.push({ang,s});
 const mid=await searchGrid(srcE,sw,sh,dstE,dw,dh,fineJobs,opts,null);
 if(!mid)return fail('no_candidate');
 const tightJobs=[];for(const ang of [mid.ang-1,mid.ang-.5,mid.ang,mid.ang+.5,mid.ang+1])for(const s of [mid.s*.97,mid.s*.985,mid.s,mid.s*1.015,mid.s*1.03])tightJobs.push({ang,s});
 const refined=await searchGrid(srcE,sw,sh,dstE,dw,dh,tightJobs,opts,null)||mid;
 const{T,score,peak}=refined;
 if(!(score.ncc>=ALIGN_MIN_NCC)||!(peak>=ALIGN_MIN_PEAK)||!(score.overlap>=ALIGN_MIN_OVERLAP)||score.residual>ALIGN_MAX_RESIDUAL)
  return fail('low_confidence',{ncc:score.ncc,peak,overlap:score.overlap,residual:score.residual});
 // Map downscaled-src pixels → downscaled-dst pixels; callers convert with scaleX/scaleY.
 return{ok:true,confidence:Math.max(0,Math.min(1,score.ncc)),transform:T,ncc:score.ncc,peak,overlap:score.overlap,residual:score.residual,reason:'ok',srcScaleX:srcFit.scaleX,srcScaleY:srcFit.scaleY,dstScaleX:dstFit.scaleX,dstScaleY:dstFit.scaleY,srcSize:{w:sw,h:sh},dstSize:{w:dw,h:dh}};
}

/* Line-color suggestion, map-road snap, per-pair residuals, and A/B endpoints (browser only).
   SUGGEST_MIN_SAT (0.22) / SUGGEST_MIN_CHROMA (25): ignore paper, grey print and pale washes.
   SUGGEST_MIN_CONTRAST (18): keep edge-like pixels so fills score lower than drawn lines.
   SUGGEST_MAX_FRAC (0.15): drop clusters that cover too much of the image (background).
   SUGGEST_MIN_PIXELS (40): skip speckles.
   SNAP_MAP_RADIUS_PX (16): screen-pixel radius for snapping a control point to a road.
   SNAP_MAP_MAX_METERS (60): also reject snaps that are geographically far (low zoom). */
const SUGGEST_MIN_SAT=.22,SUGGEST_MIN_CHROMA=25,SUGGEST_MIN_CONTRAST=18,SUGGEST_MAX_FRAC=.15,SUGGEST_MIN_PIXELS=40;
const SNAP_MAP_RADIUS_PX=16,SNAP_MAP_MAX_METERS=60;
function suggestLineColor(img,opts={}){
 if(!img?.width||!img.height)return null;
 const{width:w,height:h,data}=img,stride=opts.stride||Math.max(1,Math.floor(Math.max(w,h)/400));
 const minSat=opts.minSat??SUGGEST_MIN_SAT,minChroma=opts.minChroma??SUGGEST_MIN_CHROMA,minContrast=opts.minContrast??SUGGEST_MIN_CONTRAST;
 const maxFrac=opts.maxFrac??SUGGEST_MAX_FRAC,minPixels=opts.minPixels??SUGGEST_MIN_PIXELS;
 const buckets=new Map();let sampled=0;
 for(let y=1;y<h-1;y+=stride)for(let x=1;x<w-1;x+=stride){
  const i=(y*w+x)*4;if(data[i+3]<128)continue;
  const R=data[i],G=data[i+1],Bl=data[i+2],mx=Math.max(R,G,Bl),mn=Math.min(R,G,Bl),sat=mx?(mx-mn)/mx:0,chroma=mx-mn;
  if(sat<minSat||chroma<minChroma)continue;
  let contrast=0,nc=0;for(const[dx,dy] of [[-stride,0],[stride,0],[0,-stride],[0,stride]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=(ny*w+nx)*4;contrast+=Math.hypot(R-data[j],G-data[j+1],Bl-data[j+2]);nc++;}
  contrast=nc?contrast/nc:0;if(contrast<minContrast)continue;
  const key=((R>>3)<<10)|((G>>3)<<5)|(Bl>>3);let bu=buckets.get(key);if(!bu){bu={sr:0,sg:0,sb:0,n:0,sc:0};buckets.set(key,bu);}
  const wgt=sat*chroma*contrast;bu.sr+=R*wgt;bu.sg+=G*wgt;bu.sb+=Bl*wgt;bu.n++;bu.sc+=wgt;sampled++;
 }
 if(!buckets.size)return null;
 const sampledAll=Math.ceil(w/stride)*Math.ceil(h/stride);
 let best=null,bestScore=-1;
 for(const[key,bu]of buckets){
  if(bu.n<Math.max(3,Math.ceil(minPixels/(stride*stride))))continue;
  if(bu.n/sampledAll>maxFrac)continue;
  let n=bu.n,sr=bu.sr,sg=bu.sg,sb=bu.sb,sc=bu.sc;
  const kR=key>>10,kG=(key>>5)&31,kB=key&31;
  for(const[k2,b2]of buckets){if(k2===key)continue;const r2=k2>>10,g2=(k2>>5)&31,b2c=k2&31;if(Math.max(Math.abs(kR-r2),Math.abs(kG-g2),Math.abs(kB-b2c))>1)continue;n+=b2.n;sr+=b2.sr;sg+=b2.sg;sb+=b2.sb;sc+=b2.sc;}
  const score=sc*Math.log(1+n);
  if(score>bestScore){bestScore=score;best={color:[Math.round(sr/sc),Math.round(sg/sc),Math.round(sb/sc)],count:n,score,sat:null};}
 }
 return best;
}
function pointOnSeg(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy;if(!(l2>0))return{x:ax,y:ay,t:0,d:Math.hypot(px-ax,py-ay)};const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2));return{x:ax+t*dx,y:ay+t*dy,t,d:Math.hypot(px-(ax+t*dx),py-(ay+t*dy))};}
function segIntersect(a,b,c,d){const r=b[0]-a[0],s=b[1]-a[1],p=d[0]-c[0],q=d[1]-c[1],den=r*q-s*p;if(Math.abs(den)<1e-12)return null;const t=((c[0]-a[0])*q-(c[1]-a[1])*p)/den,u=((c[0]-a[0])*s-(c[1]-a[1])*r)/den;if(t<0||t>1||u<0||u>1)return null;return{x:a[0]+t*r,y:a[1]+t*s};}
function snapToPolylines(px,py,polylines,opts={}){
 const radius=opts.radius??SNAP_MAP_RADIUS_PX;if(!(radius>0)||!Array.isArray(polylines))return{ok:false};
 const qk=(x,y)=>Math.round(x)+','+Math.round(y),deg=new Map(),segs=[];
 const bump=(x,y,id)=>{const k=qk(x,y);let s=deg.get(k);if(!s){s={n:0,ids:new Set(),x,y};deg.set(k,s);}s.n++;s.ids.add(id);};
 let bestEdge=null,bestVtx=null,bestX=null;
 for(let pi=0;pi<polylines.length;pi++){const line=polylines[pi];if(!line||line.length<2)continue;
  for(let i=0;i<line.length;i++){const[x,y]=line[i],d=Math.hypot(px-x,py-y);if(d<=radius&&(!bestVtx||d<bestVtx.d))bestVtx={ok:true,x,y,dist:d,kind:'vertex',d};
   if(i){const a=line[i-1],b=line[i];bump(a[0],a[1],pi);bump(x,y,pi);const hit=pointOnSeg(px,py,a[0],a[1],x,y);if(hit.d<=radius&&(!bestEdge||hit.d<bestEdge.d))bestEdge={ok:true,x:hit.x,y:hit.y,dist:hit.d,kind:'edge',d:hit.d};
    if(Math.max(Math.abs(px-(a[0]+b[0])/2)-Math.abs(b[0]-a[0])/2,0)**2+Math.max(Math.abs(py-(a[1]+b[1])/2)-Math.abs(b[1]-a[1])/2,0)**2<=radius*radius)segs.push({a,b,id:pi});}}
 }
 for(const s of deg.values()){if(s.n<3&&s.ids.size<2)continue;const d=Math.hypot(px-s.x,py-s.y);if(d<=radius&&(!bestX||d<bestX.d))bestX={ok:true,x:s.x,y:s.y,dist:d,kind:'intersection',d};}
 for(let i=0;i<segs.length;i++)for(let j=i+1;j<segs.length;j++){if(segs[i].id===segs[j].id)continue;const cr=segIntersect(segs[i].a,segs[i].b,segs[j].a,segs[j].b);if(!cr)continue;const d=Math.hypot(px-cr.x,py-cr.y);if(d<=radius&&(!bestX||d<bestX.d))bestX={ok:true,x:cr.x,y:cr.y,dist:d,kind:'intersection',d};}
 // T-junction: a vertex of one line lying on another line.
 for(const s of segs)for(const[k,v]of deg){if(v.ids.size===1&&[...v.ids][0]===s.id)continue;const hit=pointOnSeg(v.x,v.y,s.a[0],s.a[1],s.b[0],s.b[1]);if(hit.d>1.25)continue;const d=Math.hypot(px-hit.x,py-hit.y);if(d<=radius&&(!bestX||d<bestX.d))bestX={ok:true,x:hit.x,y:hit.y,dist:d,kind:'intersection',d};}
 if(bestX)return{ok:true,x:bestX.x,y:bestX.y,dist:bestX.dist,kind:'intersection'};
 if(bestVtx&&(!bestEdge||bestVtx.d<=bestEdge.d+2.5))return{ok:true,x:bestVtx.x,y:bestVtx.y,dist:bestVtx.dist,kind:'vertex'};
 if(bestEdge)return{ok:true,x:bestEdge.x,y:bestEdge.y,dist:bestEdge.dist,kind:'edge'};
 return{ok:false};
}
function pairResidualMeters(T,pairs,metersPerUnit){
 const raw=residuals(T,pairs||[]),meters=raw.map(r=>r*(metersPerUnit||0));
 let worst=-1,max=0,sum=0;for(let i=0;i<meters.length;i++){sum+=meters[i];if(worst<0||meters[i]>max){max=meters[i];worst=i;}}
 return{raw,meters,worst:meters.length?worst:-1,max:meters.length?max:0,avg:meters.length?sum/meters.length:0,count:meters.length};
}
function worstResidualIndex(meters){let w=-1,m=-1;for(let i=0;i<(meters||[]).length;i++)if(w<0||meters[i]>m){m=meters[i];w=i;}return w;}
function suggestAB(M){
 if(!M?.mask||!M.count||!M.width)return null;
 const{mask,width:w,height:h}=M,lab=new Int32Array(w*h),qx=new Int32Array(w*h),qy=new Int32Array(w*h);
 let bestId=0,bestN=0,nComp=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(!mask[i]||lab[i])continue;const id=++nComp;let n=0,hs=0,qe=0;qx[0]=x;qy[0]=y;qe=1;lab[i]=id;
  while(hs<qe){const cx=qx[hs],cy=qy[hs++];n++;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(!mask[j]||lab[j])continue;lab[j]=id;qx[qe]=nx;qy[qe]=ny;qe++;}}
  if(n>bestN){bestN=n;bestId=id;}}
 if(bestN<8)return null;
 function farthest(sx,sy){const dist=new Int32Array(w*h);for(let i=0;i<dist.length;i++)dist[i]=-1;let hs=0,qe=0,fx=sx,fy=sy,best=0;qx[0]=sx;qy[0]=sy;dist[sy*w+sx]=0;qe=1;
  while(hs<qe){const cx=qx[hs],cy=qy[hs++],d=dist[cy*w+cx];if(d>=best){best=d;fx=cx;fy=cy;}for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const j=ny*w+nx;if(lab[j]!==bestId||dist[j]>=0)continue;dist[j]=d+1;qx[qe]=nx;qy[qe]=ny;qe++;}}
  return{pixel:[fx,fy],dist:best};}
 let sx=-1,sy=-1;for(let i=0;i<lab.length;i++)if(lab[i]===bestId){sx=i%w;sy=i/w|0;break;}
 const a=farthest(sx,sy),b=farthest(a.pixel[0],a.pixel[1]);
 return{A:a.pixel,B:b.pixel,size:bestN,span:b.dist};
}
root.GildamTraceModel={apply,invert,scaleAround,rotateAround,translate,fitSimilarity,residuals,pickColor,buildMask,snapToMask,tracePath,bridgedRuns,simplify,meters,length,sampleAlong,deviation,toGpx,fitLongSide,resizeRgba,alignImages,suggestLineColor,snapToPolylines,pairResidualMeters,worstResidualIndex,suggestAB,SNAP_MAP_RADIUS_PX,SNAP_MAP_MAX_METERS};
})(typeof window!=='undefined'?window:globalThis);
