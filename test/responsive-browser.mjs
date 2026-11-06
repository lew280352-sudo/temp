import {navigateUI} from './navigation.mjs';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

const artifacts=process.env.UI_ARTIFACT_DIR||'.superpowers/sdd/2026-11-01-stocklens-ui/after';mkdirSync(artifacts,{recursive:true});
const server=await createApp({databasePath:':memory:',hostingProfile:'render-free'});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
const headline='ข่าวทดสอบ: บริษัทประกาศรายละเอียดการดำเนินงานและแผนผลิตภัณฑ์สำหรับผู้ใช้ภาษาไทย '+ 'รายละเอียดเพิ่มเติมที่ต้องอ่านจากต้นฉบับ '.repeat(6);
const news={items:[{id:'fixture-long',symbol:'AAPL',source:'แหล่งข่าวทดสอบที่มีชื่อยาว',sourceType:'company',title:headline,url:'https://www.apple.com/newsroom/',publishedAt:new Date().toISOString()}],sources:[{name:'Apple Newsroom',enabled:true,status:'ok',succeededAt:new Date().toISOString()}]};
try{
 for(const width of [390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/news',r=>r.fulfill({json:news}));
  await page.goto(base);await page.waitForSelector('#register-form');assert.equal(await page.getByRole('heading',{level:1}).count(),1,'auth has one visible page heading');await page.screenshot({path:`${artifacts}/auth-${width}.png`,fullPage:true});
  const email=`responsive-${width}@example.com`,password='responsive-test-password';
  assert.equal((await page.request.post(base+'/api/register',{headers:{Origin:base},data:{name:'บัญชีทดสอบหน้าจอ',email,password}})).status(),201);
  await page.locator('[data-auth-mode=login]').first().click();await page.locator('[name=email]').fill(email);await page.locator('[name=password]').fill(password);await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  assert.equal(await page.locator('.nav:visible').evaluateAll(nodes=>nodes.every(el=>parseFloat(getComputedStyle(el).fontSize)>=12)),true,'visible navigation remains readable');
  async function go(destination){
   await navigateUI(page,destination);
   await page.waitForFunction(route=>location.hash==='#'+route,destination);
   await page.waitForFunction(()=>document.activeElement===document.querySelector('#main h1'));
  }
  for(const destination of ['overview','news','following','insights','search','alerts','sources']){
   await go(destination);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} ${destination}: horizontal overflow`);
   assert.ok(await page.locator(`[data-page=${destination}][aria-current=page]`).count(),`${destination} current`);
   await page.screenshot({path:`${artifacts}/${destination}-${width}.png`,fullPage:true});
  }
  if(width<=1100){await page.locator('[data-mobile-more]').focus();await page.keyboard.press('Enter');await page.waitForSelector('#mobile-menu[open]');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-mobile-more'));}
  await go('overview');await page.waitForSelector('.news-title');assert.match(await page.locator('.news-title').first().innerText(),/ข่าวทดสอบ/);
  assert.equal(await page.locator('.news-card .company-logo.has-icon').first().evaluate(el=>getComputedStyle(el).fontSize),'0px','brand fallback hides behind its available logo');
  assert.equal(await page.locator('#quotes-panel .table-wrap').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'price columns fit narrow screen');
  assert.equal(await page.locator('.left-column .news-list, .left-column .news-card').count()>0,true,'news leads overview');
  await page.locator('[data-action=add]').first().click();await page.locator('#following-form [name=symbol]').selectOption('MSFT');
  await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'บันทึกไม่สำเร็จ กรุณาลองใหม่'}}));
  await page.locator('#following-form [type=submit]').click();await page.waitForSelector('#following-form .form-error:not(:empty)');
  assert.equal(await page.locator('#following-form [name=symbol]').inputValue(),'MSFT');assert.equal(await page.locator('#modal').evaluate(el=>el.open),true);
  await page.unroute('**/api/state');await page.locator('#following-form [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
  assert.deepEqual((await (await page.request.get(base+'/api/session')).json()).state.watchlist,['MSFT']);
  await go('following');await page.route('**/api/quotes',r=>r.fulfill({json:{configured:true,items:[{symbol:'MSFT',stale:true,quote:{price:125.25,quoteAt:'2026-10-01T10:00:00Z',fetchedAt:'2026-10-02T10:00:00Z'}}]}}));await page.locator('[data-refresh-quotes]').click();await page.waitForFunction(()=>document.querySelector('#quotes-panel').textContent.includes('$125.25'));assert.match(await page.locator('#quotes-panel').innerText(),/ข้อมูลเก่า/);assert.match(await page.locator('#quotes-panel').innerText(),/เวลาราคา/);
  await go('news');await page.unroute('**/api/news');let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/news',async r=>{await gate;await r.fulfill({json:news});});await page.locator('[data-refresh-news]').click();assert.equal(await page.locator('[data-refresh-news]').isDisabled(),true);release();await page.waitForFunction(()=>!newsLoading);await page.unroute('**/api/news');await page.route('**/api/news',r=>r.fulfill({status:503,json:{error:'ข่าวไม่พร้อม กรุณาลองใหม่'}}));await page.locator('[data-refresh-news]').click();await page.waitForSelector('#main .form-error');assert.match(await page.locator('.news-title').first().innerText(),/ข่าวทดสอบ/);await page.unroute('**/api/news');await page.route('**/api/news',r=>r.fulfill({json:{items:[],sources:[]}}));await page.locator('[data-refresh-news]').click();await page.waitForFunction(()=>!newsLoading);assert.equal(await page.locator('.news-card').count(),0);assert.match(await page.locator('.empty').innerText(),/ยังไม่มีข่าว/);
  await go('insights');assert.equal(await page.locator('[data-ai-summary]').isDisabled(),true);
  await go('alerts');await page.waitForSelector('#security-card [data-security-delete]');await page.waitForSelector('#push-card [data-push-enable]');
  assert.equal(await page.locator('#push-card [data-push-enable]').isDisabled(),true);assert.equal(await page.locator('[data-email-verification]').isDisabled(),true);assert.match(await page.locator('#security-card').innerText(),/อีเมลไม่พร้อมใช้บนโฮสต์นี้/);assert.match(await page.locator('#push-card').innerText(),/พักแอปหลังไม่มีการใช้งาน 15 นาที/);
  await page.locator('#alert-form [name=time]').fill('10:45');await page.evaluate(()=>loadNews());assert.equal(await page.locator('#alert-form [name=time]').inputValue(),'10:45');await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'บันทึกไม่สำเร็จ กรุณาลองใหม่'}}));await page.locator('#alert-form [type=submit]').click();await page.waitForFunction(()=>!isSaving);assert.equal(await page.locator('#alert-form [name=time]').inputValue(),'10:45');await page.unroute('**/api/state');
  await page.request.post(base+'/api/logout',{headers:{Origin:base},data:{}});await page.locator('#alert-form [type=submit]').click();await page.waitForSelector('#login-form');assert.equal(await page.locator('#main').innerHTML(),'');assert.equal(await page.locator('#modal-body').innerHTML(),'');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS: 390/768/1440 routes, keyboard More/focus/current state, Thai overflow, failed-save drafts, unconfigured services and expired-session privacy.');
}finally{await browser.close();await server.shutdown();}
