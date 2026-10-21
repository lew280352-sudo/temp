import {chromium} from 'playwright';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {createApp} from '../server.mjs';
import {totpCode} from '../security.mjs';

const vapid=webpush.generateVAPIDKeys();
const now=new Date(),friday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
friday.setUTCDate(friday.getUTCDate()-(friday.getUTCDay()+2)%7-7);
const series=Object.fromEntries(Array.from({length:130},(_,i)=>{
  const date=new Date(friday);date.setUTCDate(date.getUTCDate()-(129-i)*7);
  return [date.toISOString().slice(0,10),{'5. adjusted close':String(100+i)}];
}));
const server=createApp({databasePath:':memory:',mfaKeyHex:randomBytes(32).toString('hex'),pushPublicKey:vapid.publicKey,pushPrivateKey:vapid.privateKey,pushSubject:'https://github.com/lew280352-sudo/temp',pushSender:async()=>{},historyApiKey:'fixture',historyFetcher:async()=>Response.json({'Weekly Adjusted Time Series':series})});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:950}}),base=`http://127.0.0.1:${server.address().port}`,errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
  await page.locator('#register-form [name=name]').fill('Security User');await page.locator('#register-form [name=email]').fill('security-ui@example.com');
  await page.locator('#register-form [name=password]').fill('correct-test-password');await page.locator('#register-form [name=confirm]').fill('correct-test-password');
  await page.locator('#register-form [type=submit]').click();await page.waitForSelector('#login-form');
  await page.locator('#login-form [name=password]').fill('correct-test-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  await page.locator('.sidebar [data-page=insights]').click();await page.waitForSelector('.weekly-chart');
  assert.match(await page.locator('.weekly-chart').innerText(),/รายสัปดาห์/);
  await page.locator('.sidebar [data-page=alerts]').click();await page.waitForSelector('#security-card [data-security-setup]');
  assert.equal(await page.locator('#security-card [data-security-setup]').isEnabled(),true);
  await page.locator('#security-card [data-security-setup]').click();await page.locator('#mfa-setup-form [name=password]').fill('correct-test-password');await page.locator('#mfa-setup-form [type=submit]').click();
  await page.waitForSelector('#mfa-enable-form');const secret=(await page.locator('.mfa-secret').innerText()).trim();
  await page.locator('#mfa-enable-form [name=code]').fill(totpCode(secret,Math.floor(Date.now()/30000)));
  await page.locator('#mfa-enable-form [type=submit]').click();await page.waitForSelector('#security-card [data-security-disable]');
  await page.locator('.sidebar [data-logout]').click();await page.waitForSelector('#login-form');
  await page.locator('#login-form [name=email]').fill('security-ui@example.com');await page.locator('#login-form [name=password]').fill('correct-test-password');
  await page.locator('#login-form [type=submit]').click();await page.waitForSelector('#login-challenge-form');
  assert.match(await page.locator('#login-challenge-form').innerText(),/Authenticator/);
  assert.deepEqual(errors,[]);console.log('PASS: weekly chart, MFA setup, and second-factor login requirement in browser');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
