import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createApp} from '../server.mjs';

const count=20,label=process.argv.includes('--baseline')?'baseline':'verified';
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const directory=path.join(os.tmpdir(),`stocklens-users20-${label}-${stamp}-${process.pid}`);mkdirSync(directory,{recursive:true});
const server=createApp({databasePath:path.join(directory,'synthetic-users.sqlite')});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`,requests=[],pendingMetrics=[],started=performance.now();
const scenarios=['เลือกบริษัทที่ติดตาม','เลือกมากกว่าหนึ่งบริษัท','ค้นหาภาษาไทย','ตั้งค่าการแจ้งเตือน','ป้องกันข้อมูลจากแท็บเก่า'];
const users=Array.from({length:count},(_,i)=>({number:i+1,email:`user${i+1}@stocklens.example`,name:`ผู้ทดสอบ ${String(i+1).padStart(2,'0')}`,password:`Synthetic-only-pass-${i+1}!`,device:i<10?'desktop':'mobile',scenario:scenarios[i%5],stage:'setup',checks:[],status:'pending',context:null,page:null,errors:[]}));
let browser;
async function step(user,name,fn){user.stage=name;await fn();user.checks.push(name);}
async function phase(name,fn){
  const results=await Promise.allSettled(users.filter(u=>u.status!=='failed').map(async user=>{try{await step(user,name,()=>fn(user));}catch(error){user.status='failed';user.failure=String(error.message).split('\n').slice(0,3).join(' ');}}));
  for(const result of results)if(result.status==='rejected')throw result.reason;
  console.log(`${name}: ${users.filter(u=>u.status!=='failed').length}/${count} users remain successful`);
}
async function navigate(user,page){const selector=user.device==='mobile'&&(page==='sources'||page==='alerts')?`.topbar [data-page=${page}]`:`.sidebar [data-page=${page}]`;await user.page.locator(selector).click();}
async function api(user,route,method='GET',payload){return user.page.evaluate(async({route,method,payload})=>{const response=await fetch(route,{method,headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined});return {status:response.status,data:await response.json()};},{route,method,payload});}
async function login(user){
  const page=user.page;await page.locator('#login-form [name=email]').fill(user.email);await page.locator('#login-form [name=password]').fill(user.password);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/login')&&r.request().method()==='POST');await page.locator('#login-form [type=submit]').click();const result=await response;
  assert.equal(result.status(),200,`Login returned HTTP ${result.status()}`);await page.waitForSelector('body:not(.signed-out)');
}
try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
  await phase('open-register',async user=>{
    user.context=await browser.newContext({viewport:user.device==='desktop'?{width:1440,height:1000}:{width:390,height:844}});
    // Local-only benchmark: skip third-party font downloads, use the app's font fallback.
    await user.context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort());
    user.page=await user.context.newPage();user.page.setDefaultTimeout(30000);user.page.on('pageerror',error=>user.errors.push(error.message));
    user.page.on('response',response=>{if(response.url().startsWith(base+'/api/'))pendingMetrics.push((async()=>{await response.finished().catch(()=>{});const timing=response.request().timing();requests.push({user:user.number,path:new URL(response.url()).pathname,status:response.status(),ms:Math.max(0,timing.responseEnd)});})());});
    await user.page.goto(base);await user.page.waitForSelector('#register-form');
    assert.equal(await user.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  });
  await phase('register',async user=>{
    const page=user.page;await page.locator('[name=name]').fill(user.name);await page.locator('[name=email]').fill(user.email);await page.locator('[name=password]').fill(user.password);await page.locator('[name=confirm]').fill(user.password);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/register'));await page.locator('#register-form [type=submit]').click();assert.equal((await response).status(),201);await page.waitForSelector('#login-form');
  });
  await phase('login',login);
  await phase('personal-workflow',async user=>{
    const page=user.page;
    await step(user,'add-following',async()=>{await page.locator('[data-action=add]').first().click();await page.locator('#following-form [name=symbol]').selectOption('AAPL');await page.locator('#following-form [type=submit]').click();await page.waitForSelector('#modal:not([open])',{state:'attached'});});
    if(user.number%5===2)await step(user,'second-following',async()=>{await page.locator('[data-action=add]').first().click();await page.locator('#following-form [name=symbol]').selectOption('MSFT');await page.locator('#following-form [type=submit]').click();await page.waitForSelector('#modal:not([open])',{state:'attached'});const result=await api(user,'/api/session');assert.deepEqual(result.data.state.watchlist,['AAPL','MSFT']);});
    await step(user,'search-thai',async()=>{await navigate(user,'search');await page.locator('#company-query').fill('แอปเปิล');assert.equal(await page.locator('.company-card').count(),1);assert.match(await page.locator('.company-card').innerText(),/AAPL/);await page.locator('#company-query').fill('no-company-exists');assert.equal(await page.locator('.company-card').count(),0);});
    await step(user,'add-source',async()=>{await navigate(user,'sources');await page.locator('#source-form [name=name]').fill(`ข่าวเฉพาะผู้ใช้ ${user.number}`);await page.locator('#source-form [name=url]').fill(`https://example.com/user-${user.number}`);await page.locator('#source-form [name=type]').selectOption('partner');await page.locator('#source-form [type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.source-entry').length===5);});
    await step(user,'duplicate-source',async()=>{await page.locator('#source-form [name=name]').fill('Duplicate');await page.locator('#source-form [name=url]').fill(`https://example.com/user-${user.number}`);await page.locator('#source-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#source-error').textContent.includes('มี URL'));assert.equal(await page.locator('.source-entry').count(),5);});
    await step(user,'invalid-source',async()=>{await page.locator('#source-form [name=url]').fill('http://127.0.0.1/private');const response=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='PUT');await page.locator('#source-form [type=submit]').click();assert.equal((await response).status(),400);await page.waitForFunction(()=>!document.querySelector('#source-form [type=submit]').disabled);assert.equal((await api(user,'/api/session')).data.state.sources.length,5);});
    await step(user,'alerts',async()=>{await navigate(user,'alerts');await page.locator('#alert-form [name=time]').fill(`08:${String(user.number).padStart(2,'0')}`);const response=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='PUT');await page.locator('#alert-form [type=submit]').click();assert.equal((await response).status(),200);await page.waitForFunction(()=>!isSaving);});
    if(user.number%5===0)await step(user,'stale-tab',async()=>{const old=(await api(user,'/api/session')).data;const next=structuredClone(old.state);next.watchlist.push('NVDA');assert.equal((await api(user,'/api/state','PUT',{userId:old.user.id,revision:old.revision,state:next})).status,200);await navigate(user,'alerts');await page.locator('#alert-form [name=time]').fill('07:00');const response=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='PUT');await page.locator('#alert-form [type=submit]').click();assert.equal((await response).status(),409);await page.waitForFunction(()=>!isSaving);assert.deepEqual((await api(user,'/api/session')).data.state.watchlist,['AAPL','NVDA']);});
    await step(user,'reload-and-isolation',async()=>{await page.reload();await page.waitForSelector('body:not(.signed-out)');const result=await api(user,'/api/session');assert.equal(result.data.user.email,user.email);assert.ok(result.data.state.watchlist.includes('AAPL'));assert.ok(!JSON.stringify(result.data.state).includes('qty'));assert.equal(result.data.state.alerts.time,`08:${String(user.number).padStart(2,'0')}`);assert.equal(result.data.state.sources.length,5);assert.equal(result.data.state.sources.at(-1).url,`https://example.com/user-${user.number}`);user.userId=result.data.user.id;});
  });
  await phase('cross-account-protection',async user=>{
    const other=users.find(candidate=>candidate.userId&&candidate.number!==user.number);assert.ok(other);
    const current=(await api(user,'/api/session')).data;
    assert.equal((await api(user,'/api/state','PUT',{userId:other.userId,revision:current.revision,state:current.state})).status,409);
    const exported=await api(user,'/api/export');assert.equal(exported.status,200);assert.equal(exported.data.user.email,user.email);assert.ok(exported.data.state.watchlist.includes('AAPL'));assert.doesNotMatch(JSON.stringify(exported.data),/password_hash|token_hash|qty|cost/);
  });
  await phase('logout-login-persistence',async user=>{
    const page=user.page;await page.locator(user.device==='mobile'?'.topbar [data-logout]':'.sidebar [data-logout]').click();await page.waitForSelector('#login-form');assert.equal(await page.locator('#main').innerHTML(),'');assert.equal((await api(user,'/api/export')).status,401);
    await login(user);const current=(await api(user,'/api/session')).data;assert.ok(current.state.watchlist.includes('AAPL'));assert.equal(current.state.sources.at(-1).url,`https://example.com/user-${user.number}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(user.errors,[]);user.status='passed';
  });
  for(const user of users.filter(u=>u.page&&u.number<=2))await user.page.screenshot({path:path.join(directory,`user-${user.number}.png`),fullPage:true}).catch(()=>{});
}finally{
  await Promise.allSettled(pendingMetrics);await browser?.close();await new Promise(resolve=>server.close(resolve));
  const elapsedMs=Math.round(performance.now()-started),successfulTimes=requests.filter(r=>r.status<400&&r.ms>=0).map(r=>r.ms).sort((a,b)=>a-b);
  const percentile=p=>successfulTimes.length?Math.round(successfulTimes[Math.min(successfulTimes.length-1,Math.ceil(successfulTimes.length*p)-1)]):null;
  const statuses={};for(const request of requests)statuses[request.status]=(statuses[request.status]||0)+1;
  const report={label,users:count,passed:users.filter(u=>u.status==='passed').length,failed:users.filter(u=>u.status!=='passed').length,elapsedMs,environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0]?.model,browser:'installed Chromium/Edge headless',database:'isolated on-disk SQLite',network:'localhost; all 20 contexts share one IP; third-party fonts blocked'},api:{count:requests.length,statuses,successfulResponseMs:{p50:percentile(.5),p95:percentile(.95),max:percentile(1)}},results:users.map(({number,device,scenario,stage,status,checks,failure,errors})=>({number,device,scenario,stage,status,checks,failure,errors}))};
  writeFileSync(path.join(directory,'results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:path.join(directory,'results.json'),passed:report.passed,failed:report.failed,elapsedMs,api:report.api},null,2));
  if(report.failed)process.exitCode=1;
}
