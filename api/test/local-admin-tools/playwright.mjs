import { chromium } from 'playwright-core';
const D='/workspace/shots/gildam-admin-course/', G=D+'gpx/', O='http://localhost:18090';
const b=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const out={};
const wait=async(p,m)=>{await p.waitForFunction((m)=>window[m]&&window[m].map.loaded()&&window[m].map.areTilesLoaded(),m,{timeout:60000}).catch(()=>{}); await p.waitForTimeout(2000);};
for (const [tag,vp,mob] of [['desktop',{width:1280,height:800},false],['phone',{width:390,height:844},true]]){
  const c=await b.newContext({viewport:vp,deviceScaleFactor:mob?2:1,isMobile:mob,hasTouch:mob,acceptDownloads:true});
  await c.addCookies([{name:'__Host-gildam_admin',value:'localtest-sid',domain:'localhost',path:'/',secure:true}]);
  const p=await c.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>m.type()==='error'&&errs.push(m.text().slice(0,160)));
  // 1) 코스 만들기
  await p.goto(O+'/admin/course'); await p.waitForFunction(()=>window.__course,null,{timeout:30000}); console.error('url',p.url()); await wait(p,'__course');
  await p.evaluate(()=>__course.map.fitBounds([[128.455,38.112],[128.495,38.18]],{padding:40,duration:0})); await wait(p,'__course');
  const box=await (await p.$('#map')).boundingBox();
  const geo=[[128.4905,38.1745],[128.481,38.158],[128.474,38.142],[128.4656,38.1191],[128.46,38.13]];
  const px=await p.evaluate(g=>g.map(c=>{const q=__course.map.project(c);return [q.x,q.y]}),geo);
  console.error(tag,JSON.stringify(px),JSON.stringify(box));
  for(const [x,y] of px){ if(mob) await p.touchscreen.tap(box.x+x,box.y+y); else await p.mouse.click(box.x+x,box.y+y); await p.waitForTimeout(250);}
  out[tag+'_added']=await p.evaluate(()=>__course.pts.length);
  if(!mob){ // drag point 3, delete point 5, undo, redo
    const m=await p.$$('.pt'); const bb=await m[2].boundingBox();
    await p.mouse.move(bb.x+7,bb.y+7); await p.mouse.down(); await p.mouse.move(bb.x+60,bb.y+20,{steps:8}); await p.mouse.up(); await p.waitForTimeout(300);
    const m2=await p.$$('.pt'); await m2[4].click(); await p.waitForTimeout(300);
    out.afterDelete=await p.evaluate(()=>__course.pts.length);
    await p.click('#undo'); out.afterUndo=await p.evaluate(()=>__course.pts.length);
    await p.click('#redo'); out.afterRedo=await p.evaluate(()=>__course.pts.length);
  }
  await p.waitForTimeout(3000);
  out[tag+'_stats']=await p.$eval('#st',e=>e.innerText.replace(/\s+/g,' '));
  await p.fill('#nm','설악산 대청봉 코스');
  await p.screenshot({path:D+tag+'-1-course.png'});
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#exp')]); await dl.saveAs(D+tag+'-course.gpx');
  // 바탕지도 길담으로
  if(!mob){ await p.selectOption('.base select','gildam-gildam'); await p.waitForTimeout(1500); await wait(p,'__course'); out.overlayAfterBase=await p.evaluate(()=>!!__course.map.getLayer('course')&&!!__course.map.getLayer('hillshade')); await p.screenshot({path:D+'desktop-1b-course-gildam-base.png'}); await p.selectOption('.base select','ofm-liberty'); }
  // 2) 이어 붙이기·자르기
  await p.goto(O+'/admin/merge'); await p.waitForFunction(()=>window.__merge,null,{timeout:30000});
  await p.setInputFiles('#files',[G+'1-seorakdong-to-biseondae.gpx',G+'3-to-daecheong.gpx',G+'2-reversed-mid.gpx']); await p.waitForTimeout(2500);
  out[tag+'_gapsBefore']=await p.$$eval('.gap',e=>e.map(x=>x.textContent));
  // reorder: move item 3 up, reverse it
  { const it0=await p.$$('#list .item'); await (await it0[2].$('[data-a=up]')).click(); }
  await p.waitForTimeout(500); const it=await p.$$('#list .item'); await (await it[1].$('[data-a=rev]')).click(); await p.waitForTimeout(2000);
  out[tag+'_gapsAfter']=await p.$$eval('.gap',e=>e.map(x=>x.textContent));
  await wait(p,'__merge');
  // trim via API-like picks: start at 20%, end via chart click
  const n=await p.evaluate(()=>__merge.M.flat.length); await p.evaluate((n)=>__merge.setPick('start',Math.round(n*0.2)),n);
  await p.click('#pick [data-v=end]'); const cb=await (await p.$('#ch')).boundingBox(); await p.mouse.click(cb.x+cb.width*0.85,cb.y+cb.height/2);
  await p.waitForTimeout(800);
  out[tag+'_range']=await p.evaluate(()=>__merge.range); out[tag+'_mstats']=await p.$eval('#st',e=>e.innerText.replace(/\s+/g,' '));
  await p.screenshot({path:D+tag+'-2-merge-trim.png'});
  const [dl2]=await Promise.all([p.waitForEvent('download'),p.click('#exp')]); await dl2.saveAs(D+tag+'-merged-trimmed.gpx');
  await p.click('#mode [data-v=keep]'); await p.waitForTimeout(1500);
  const [dl3]=await Promise.all([p.waitForEvent('download'),p.click('#exp')]); await dl3.saveAs(D+tag+'-merged-keepsegs.gpx');
  out[tag+'_errs']=errs; await c.close();
}
console.log(JSON.stringify(out,null,1)); await b.close();
