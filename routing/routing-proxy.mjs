import http from 'node:http';
const engine = process.env.ENGINE || 'http://127.0.0.1:17777';
const profiles = {walk:'gildam-walk',hike:'gildam-hike',bike:'gildam-bike'};
const cache = new Map(), rates = new Map(); let busy = false;
const dist=(a,b)=>{const r=Math.PI/180,dlat=(b[1]-a[1])*r,dlon=(b[0]-a[0])*r;return 12742000*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dlon/2)**2));};
const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=124.5&&p[0]<=132&&p[1]>=33&&p[1]<=38.7;
export const server=http.createServer(async(req,res)=>{
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
 if(req.method==='GET'&&req.url==='/healthz') return send(200,{ok:true});
 if(req.method!=='POST'||req.url!=='/routing/route') return send(404,{error:'Not found'});
 if(req.headers.origin && req.headers.origin!=='https://maps.nuni.co.kr')return send(403,{error:'허용되지 않은 요청입니다.'});
 const ip=req.headers['x-real-ip']||req.socket.remoteAddress,now=Date.now();
 for(const [k,v]of rates)if(now-v.t>60000)rates.delete(k);
 const rate=rates.get(ip)||{t:now,n:0}; if(++rate.n>90)return send(429,{error:'요청이 많습니다. 잠시 후 다시 시도하세요.'}); if(rates.size<10000)rates.set(ip,rate);
 let raw='';try{for await(const chunk of req){raw+=chunk;if(raw.length>2048){send(413,{error:'요청이 너무 큽니다.'});return;}}}catch{return;}
 let input;try{input=JSON.parse(raw);}catch{return send(400,{error:'잘못된 요청입니다.'});}
 const {from,to,mode}=input;
 if(!profiles[mode]||!valid(from)||!valid(to))return send(400,{error:'국내 지도 범위와 이동 방식을 확인하세요.'});
 const direct=dist(from,to);if(direct>30000)return send(400,{error:'지점 간격은 30km 이내로 나누어 주세요.'});if(direct<2)return send(400,{error:'서로 다른 지점을 선택하세요.'});
 const key=JSON.stringify([mode,from,to]);if(cache.has(key))return send(200,cache.get(key));
 if(busy)return send(503,{error:'다른 경로를 계산 중입니다. 잠시 후 다시 시도하세요.'});
 busy=true;
 try{
 const u=new URL('/brouter',engine);u.search=new URLSearchParams({lonlats:from.join(',')+'|'+to.join(','),profile:profiles[mode],alternativeidx:'0',format:'geojson'});
 const response=await fetch(u,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('no-route');
 const data=await response.json(), feature=data.features?.find(f=>f.geometry?.type==='LineString'),pts=feature?.geometry.coordinates;
 if(!Array.isArray(pts)||pts.length<2||pts.length>100000||!pts.every(p=>valid(p.slice(0,2))))throw Error('no-route');
 if(dist(from,pts[0])>250||dist(to,pts.at(-1))>250)throw Error('snap-far');
 const result={coordinates:pts.map(p=>p.slice(0,3)),distance:Number(feature.properties['track-length']),profile:mode,attribution:'© OpenStreetMap contributors · BRouter (MIT)',snapped:true};
 if(!Number.isFinite(result.distance)||result.distance>100000)throw Error('no-route');
 if(pts.length<=10000){cache.set(key,result);while(cache.size>64||[...cache.values()].reduce((n,v)=>n+v.coordinates.length,0)>100000)cache.delete(cache.keys().next().value);}send(200,result);
 }catch(e){const timeout=e.name==='TimeoutError',unavailable=e.name==='TypeError';send(timeout?504:unavailable?503:422,{error:timeout?'경로 계산 시간이 초과됐습니다. 지점을 더 가깝게 찍어 주세요.':unavailable?'경로 계산 서비스에 연결하지 못했습니다. 잠시 후 다시 시도하세요.':'연결 가능한 길을 찾지 못했습니다. 지점을 길 가까이 옮기거나 직선 모드를 선택하세요.'});}finally{busy=false;}
});
server.requestTimeout=20000;server.headersTimeout=10000;
if(process.env.NODE_ENV!=='test')server.listen(Number(process.env.PORT||17778),'0.0.0.0');
