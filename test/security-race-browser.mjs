import {navigateUI} from './navigation.mjs';
import {chromium} from 'playwright';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
const server=await createApp({databasePath:':memory:',mfaKeyHex:randomBytes(32).toString('hex')});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch();
try{
 const leaks=[];
 for(const [index,kind,switchAccount] of [[0,'mfa',false],[1,'mfa',true],[2,'recovery',true]]){
  const page=await browser.newPage({viewport:{width:1440,height:950}});await page.goto(base);await page.waitForSelector('#register-form');const email=`race-${index}-${kind}@example.com`,password='race-browser-password';await page.request.post(base+'/api/register',{headers:{Origin:base},data:{name:'Race test',email,password}});
  await page.locator('[data-auth-mode=login]').first().click();await page.locator('[name=email]').fill(email);await page.locator('[name=password]').fill(password);await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');await navigateUI(page,'alerts');await page.waitForSelector('[data-security-setup]:enabled');
  let release,entered,secret;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),route=kind==='mfa'?'/api/mfa/setup':'/api/recovery-code';
  await page.route('**'+route,async r=>{const response=await r.fetch();const data=await response.json();secret=data.secret||data.recoveryCode;entered();await gate;await r.fulfill({response});});
  await page.locator(kind==='mfa'?'[data-security-setup]':'[data-new-recovery]').click();const form=page.locator(kind==='mfa'?'#mfa-setup-form':'#new-recovery-form');await form.locator('[name=password]').fill(password);await form.locator('[type=submit]').click();await ready;
  await page.keyboard.press('Escape');await page.locator('.topbar [data-logout]').click();await page.waitForSelector('#login-form');
  if(switchAccount){const other=`other-${index}@example.com`;await page.request.post(base+'/api/register',{headers:{Origin:base},data:{name:'Other account',email:other,password}});await page.locator('#login-form [name=email]').fill(other);await page.locator('#login-form [name=password]').fill(password);await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');}
  release();await page.waitForTimeout(100);
  if(await page.locator('#modal').evaluate(el=>el.open)||(await page.locator('body').innerText()).includes(secret))leaks.push(kind+(switchAccount?' switched account':' signed out'));await page.close();
 }
 assert.deepEqual(leaks,[],'stale security results must stay private');
 console.log('PASS: delayed MFA and recovery secrets stay cleared after dismissal and logout.');
}finally{await browser.close();await server.shutdown();}
