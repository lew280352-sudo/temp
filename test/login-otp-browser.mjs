import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

const sent=[];
const server=createApp({databasePath:':memory:',emailLoginEnabled:true,smtpHost:'smtp.example',smtpUser:'sender',smtpPass:'fixture',smtpFrom:'sender@example.com',emailSender:async message=>sent.push(message)});
server.listen(0,'127.0.0.1');await once(server,'listening');
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
  const page=await browser.newPage(),base=`http://127.0.0.1:${server.address().port}`,errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
  await page.locator('#register-form [name=name]').fill('Email Tester');
  await page.locator('#register-form [name=email]').fill('email-ui@example.com');
  await page.locator('#register-form [name=password]').fill('correct-test-password');
  await page.locator('#register-form [name=confirm]').fill('correct-test-password');
  await page.locator('#register-form [type=submit]').click();await page.waitForSelector('#login-form');
  assert.equal(await page.locator('#login-form [name=totp]').count(),0,'code field is hidden before password');
  await page.locator('#login-form [name=password]').fill('correct-test-password');
  await page.locator('#login-form [type=submit]').click();await page.waitForSelector('#login-challenge-form');
  assert.match(await page.locator('#login-challenge-form').innerText(),/อีเมล/);
  const code=sent[0].text.match(/\b\d{6}\b/)[0];
  await page.locator('#login-challenge-form [name=code]').fill(code==='000000'?'111111':'000000');
  await page.locator('#login-challenge-form [type=submit]').click();await page.waitForFunction(()=>!!document.querySelector('#auth-error')?.textContent);
  await page.locator('#login-challenge-form [name=code]').fill(code);
  await page.locator('#login-challenge-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  assert.deepEqual(errors,[]);console.log('PASS: password then emailed code, including retry and successful login');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
