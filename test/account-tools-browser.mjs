import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {createApp} from '../server.mjs';
import {navigateUI} from './navigation.mjs';
const artifacts=process.env.ACCOUNT_ARTIFACT_DIR||'test-artifacts/account-tools';mkdirSync(artifacts,{recursive:true});
const server=await createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
try{
 for(const width of [390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
  const account={name:'Account tools test',email:`tools-${width}@example.com`,password:'account-tools-browser-password'};
  await context.request.post(base+'/api/register',{headers:{Origin:base},data:account});await page.goto(base+'/#login');await page.locator('#login-form [name=email]').fill(account.email);await page.locator('#login-form [name=password]').fill(account.password);await page.locator('#login-form [type=submit]').click();await page.waitForSelector('#onboarding-form');
  await page.locator('#onboarding-form [value=AAPL]').check();await page.locator('#onboarding-form [value=NVDA]').check();
  if(width>=768){const submit=await page.locator('#onboarding-form [type=submit]').boundingBox(),dock=await page.locator('.app-dock').boundingBox();assert.ok(submit.y+submit.height<dock.y,'initial desktop/tablet save action is clear of the dock');}
  await page.screenshot({path:`${artifacts}/welcome-${width}.png`,fullPage:true,animations:'disabled'});
  let failOnce=true;await page.route('**/api/onboarding',async r=>{if(failOnce){failOnce=false;await r.fulfill({status:503,json:{error:'การบันทึกขัดข้องชั่วคราว กรุณาลองอีกครั้ง'}});}else await r.continue();});
  await page.locator('#onboarding-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#onboarding-error')?.textContent);assert.equal(await page.locator('#onboarding-form [value=AAPL]').isChecked(),true);
  const errorBounds=await page.locator('#onboarding-error').boundingBox(),dockBounds=await page.locator('.app-dock').boundingBox();assert.ok(errorBounds.y+errorBounds.height<dockBounds.y,'focused setup error is clear of the floating dock');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${artifacts}/welcome-error-${width}.png`,fullPage:true,animations:'disabled'});
  await page.locator('#onboarding-form [type=submit]').click();await page.waitForFunction(()=>location.hash==='#news');
  const saved=await (await context.request.get(base+'/api/session')).json();assert.deepEqual(saved.state.watchlist,['AAPL','NVDA']);assert.equal(saved.onboarding.needed,false);
  await page.reload();await page.waitForSelector('body:not(.signed-out)');assert.equal(await page.locator('#onboarding-form').count(),0);
  await navigateUI(page,'welcome');await page.locator('#onboarding-form [value=NVDA]').uncheck();
  await navigateUI(page,'following');await page.locator('[data-action=add]').click();await page.locator('#following-form [name=symbol]').selectOption('MSFT');await page.locator('#following-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
  await navigateUI(page,'welcome');await page.locator('#onboarding-form [type=submit]').click();await page.waitForSelector('[data-reload-setup]');
  assert.deepEqual((await (await context.request.get(base+'/api/session')).json()).state.watchlist,['AAPL','NVDA','MSFT'],'an old setup draft cannot overwrite a newer in-app edit');
  await page.locator('[data-reload-setup]').click();await page.waitForSelector('#onboarding-form [value=MSFT]:checked');
  const other=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1'});await other.request.post(base+'/api/login',{headers:{Origin:base},data:account});
  await navigateUI(page,'devices');await page.waitForSelector('[data-device-row]');assert.equal(await page.locator('[data-device-row]').count(),2);assert.equal(await page.locator('[data-device-row]').first().getAttribute('data-current-device'),'');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${artifacts}/devices-${width}.png`,fullPage:true,animations:'disabled'});
  await page.locator('[data-device-row]:not([data-current-device]) [data-device-revoke]').click();await page.locator('[data-confirm-device-revoke]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-device-row]').length===1);
  assert.equal((await (await other.request.get(base+'/api/session')).json()).user,null);assert.equal((await (await context.request.get(base+'/api/session')).json()).user.email,account.email);await other.close();
  await page.locator('[data-current-device] [data-device-revoke]').click();await page.locator('[data-confirm-device-revoke]').click();await page.waitForSelector('#login-form');assert.equal(await page.locator('#main').innerText(),'');
  assert.deepEqual(errors,[]);await context.close();
 }
 const context=await browser.newContext(),page=await context.newPage(),account={name:'Delayed devices',email:'delayed-devices@example.com',password:'delayed-device-test-password'};
 await context.request.post(base+'/api/register',{headers:{Origin:base},data:account});const login=await (await context.request.post(base+'/api/login',{headers:{Origin:base},data:account})).json();
 await context.request.post(base+'/api/onboarding',{headers:{Origin:base},data:{action:'skip',userId:login.user.id}});
 let release,requested;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>requested=resolve);
 await page.route('**/api/sessions',async route=>{requested();await gate;await route.fulfill({json:{sessions:[{id:'late',name:'Private old device',createdAt:Date.now(),expiresAt:Date.now()+10000,current:false}]}});});
 await page.goto(base+'/#devices');await ready;await page.locator('.topbar [data-logout]').click();await page.waitForSelector('#login-form');release();await page.unrouteAll({behavior:'wait'});
 assert.equal(await page.locator('#main').innerText(),'');assert.equal(await page.getByText('Private old device').count(),0);await context.close();
 console.log('PASS: first-use selection, failed/stale drafts, completion/reload, device ownership/revocation/self-logout, delayed-response privacy and mobile layouts.');
}finally{await browser.close();await server.shutdown();}
