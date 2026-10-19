import {chromium} from 'playwright';
import {once} from 'node:events';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('#register-form');
  mkdirSync('test-artifacts',{recursive:true});await page.screenshot({path:'test-artifacts/register-desktop.png',fullPage:true});
  await page.locator('[name=name]').fill('ทดสอบ ผู้ลงทุน');await page.locator('[name=email]').fill('ui@example.com');await page.locator('[name=password]').fill('strong-test-password');await page.locator('[name=confirm]').fill('not-the-same');
  await page.locator('#register-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#auth-error').textContent.includes('ไม่ตรงกัน'));
  await page.locator('[name=confirm]').fill('strong-test-password');await page.locator('#register-form [type=submit]').click();await page.waitForSelector('#login-form');
  await page.locator('[name=password]').fill('wrong-password');await page.locator('#login-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#auth-error').textContent.includes('ไม่ถูกต้อง'));
  await page.locator('[name=password]').fill('strong-test-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  await page.locator('[data-action=add]').first().click();await page.locator('[name=qty]').fill('100');await page.locator('[name=cost]').fill('30');await page.locator('#holding-form [type=submit]').click();await page.waitForSelector('#modal:not([open])',{state:'attached'});
  await page.screenshot({path:'test-artifacts/dashboard-desktop.png',fullPage:true});
  await page.locator('.sidebar [data-page=sources]').click();await page.waitForSelector('#source-form');
  assert.equal(await page.locator('.source-entry').count(),3);
  await page.locator('#source-form [name=name]').fill('Example News');await page.locator('#source-form [name=url]').fill('https://example.com/news');await page.locator('#source-form [type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('.source-entry').length===4);
  await page.reload();await page.waitForSelector('body:not(.signed-out)');await page.locator('.sidebar [data-page=sources]').click();assert.equal(await page.locator('.source-entry').count(),4);
  await page.locator('#source-form [name=name]').fill('Duplicate');await page.locator('#source-form [name=url]').fill('https://example.com/news');await page.locator('#source-form [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#source-error').textContent.includes('มี URL'));
  await page.screenshot({path:'test-artifacts/sources-desktop.png',fullPage:true});
  await page.locator('.source-entry').last().locator('.remove').click();await page.locator('[data-source-confirm]').click();await page.waitForFunction(()=>document.querySelectorAll('.source-entry').length===3);
  await page.locator('.sidebar [data-page=search]').click();await page.locator('#company-query').fill('แอปเปิล');assert.equal(await page.locator('.company-card').count(),1);
  await page.locator('.sidebar [data-page=portfolio]').click();assert.match(await page.locator('tbody').first().innerText(),/100/);
  await page.locator('.sidebar [data-page=insights]').click();await page.locator('#ai-symbol').selectOption('NVDA');assert.match(await page.locator('.ai-trend').innerText(),/ยังเริ่ม AI ไม่ได้/);
  // A stale view must reload rather than silently overwrite a newer save.
  const snapshot=await page.evaluate(()=>fetch('/api/session').then(r=>r.json()));
  await page.evaluate(async snapshot=>{const next=structuredClone(snapshot.state);next.holdings[0].qty=222;const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:snapshot.user.id,revision:snapshot.revision,state:next})});if(!r.ok)throw new Error('failed to prepare concurrent save');},snapshot);
  await page.locator('.sidebar [data-page=portfolio]').click();await page.locator('[data-edit=AAPL]').click();await page.locator('[name=qty]').fill('333');await page.locator('#holding-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('222'));
  assert.equal((await page.evaluate(()=>fetch('/api/session').then(r=>r.json()))).state.holdings[0].qty,222);
  // Expired/logout session must clear private content on the next attempted save.
  await page.evaluate(()=>fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
  await page.locator('[data-edit=AAPL]').click();await page.locator('[name=qty]').fill('444');await page.locator('#holding-form [type=submit]').click();await page.waitForSelector('#login-form');
  assert.equal(await page.locator('#main').innerHTML(),'');
  await page.locator('[name=email]').fill('ui@example.com');await page.locator('[name=password]').fill('strong-test-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  await page.locator('.sidebar [data-logout]').click();await page.waitForSelector('#login-form');
  assert.equal(await page.locator('#main').innerHTML(),'');await page.reload();await page.waitForSelector('#login-form');
  await page.setViewportSize({width:390,height:844});await page.locator('[data-auth-mode=register]').first().click();await page.screenshot({path:'test-artifacts/register-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-auth-mode=login]').first().click();await page.locator('[name=email]').fill('ui@example.com');await page.locator('[name=password]').fill('strong-test-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  await page.screenshot({path:'test-artifacts/dashboard-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.topbar [data-page=sources]').click();await page.waitForSelector('#source-form');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('.topbar [data-logout]').click();await page.waitForSelector('#login-form');
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile registration, password mismatch, wrong-password rejection, login, portfolio, URL add/duplicate/delete/persistence, Thai search, AI, logout and overflow checks.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
