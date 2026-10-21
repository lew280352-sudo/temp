import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {feeds} from '../feeds.mjs';
const server=createApp({databasePath:':memory:',quoteApiKey:'fixture-only',quoteFetcher:async url=>Response.json(url.endsWith('MSFT')?{c:0,t:0}:{c:200,t:Math.floor(Date.now()/1000)}),aiEnabled:true,aiFetcher:async(url)=>url.endsWith('/api/tags')?Response.json({models:[{name:'qwen3:8b'}]}):Response.json({message:{content:JSON.stringify({title:'สรุป Microsoft',summary:'หัวข้อกล่าวถึงประกาศทดสอบจากบริษัท',facts:['มีประกาศจากบริษัท'],positiveFactors:[],risks:['ข้อมูลมีเฉพาะหัวข้อ'],unknowns:['ไม่มีผลกระทบทางการเงิน'],confidence:'low'})}}),refreshNews:true,newsFetcher:async url=>{
  const feed=feeds.find(f=>f.feedUrl===url);
  return new Response(`<rss><channel><item><title><![CDATA[${feed.symbol} &lt;img src=x onerror=alert(1)&gt; test announcement]]></title><link>${feed.url}test-announcement</link><pubDate>Sun, 18 Oct 2026 08:00:00 GMT</pubDate></item></channel></rss>`);
}});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('#register-form');
  const manifest=await (await page.request.get(base+'/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
  for(const image of manifest.icons){const r=await page.request.get(base+image.src);assert.equal(r.status(),200);assert.match(r.headers()['content-type'],/image\/png/);}
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('[name=name]').fill('PWA Test');await page.locator('[name=email]').fill('pwa@example.com');await page.locator('[name=password]').fill('pwa-original-password');await page.locator('[name=confirm]').fill('pwa-original-password');await page.locator('#register-form [type=submit]').click();await page.waitForSelector('#login-form');
  const code=await page.locator('[aria-label="รหัสกู้คืน"]').inputValue();assert.equal(code.length,48);
  await page.locator('#login-form [name=password]').fill('pwa-original-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('.news-card');
  assert.equal(await page.locator('.news-card').count(),feeds.length);assert.equal(await page.locator('.news-card img').count(),0);
  await page.locator('[data-action=add]').first().click();await page.locator('#following-form [name=symbol]').selectOption('AAPL');await page.locator('#following-form [type=submit]').click();await page.waitForSelector('#modal:not([open])',{state:'attached'});
  await page.waitForFunction(()=>document.querySelector('#quotes-panel')?.textContent.includes('$200.00'));assert.match(await page.locator('#quotes-panel').innerText(),/ไม่เก็บจำนวนหุ้นและต้นทุน/);
  await page.locator('[data-refresh-quotes]').click();await page.waitForFunction(()=>!quoteBusy);assert.equal((await page.evaluate(()=>fetch('/api/quotes').then(r=>r.json()))).items[0].quote.price,200);
  await page.locator('[data-filter=watchlist]').click();assert.equal(await page.locator('.news-card').count(),1);assert.match(await page.locator('.news-card').innerText(),/AAPL/);
  await page.locator('.topbar [data-page=sources]').click();const off=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='PUT');await page.locator('[data-source-toggle=apple]').uncheck();assert.equal((await off).status(),200);await page.waitForFunction(()=>!isSaving);
  const filtered=await page.evaluate(()=>fetch('/api/news').then(r=>r.json()));assert.equal(filtered.items.length,feeds.length-1);assert.ok(!filtered.items.some(n=>n.symbol==='AAPL'));
  await page.locator('[data-source-remove=microsoft]').click();await page.locator('[data-source-confirm=microsoft]').click();await page.waitForSelector('[data-add-feed=microsoft]');
  await page.locator('[data-add-feed=microsoft]').click();await page.waitForFunction(()=>!document.querySelector('[data-add-feed=microsoft]'));
  const restored=await page.evaluate(()=>fetch('/api/news').then(r=>r.json()));assert.ok(restored.items.some(n=>n.symbol==='MSFT'));
  await page.locator('.sidebar [data-page=insights]').click();await page.locator('#ai-symbol').selectOption('MSFT');await page.locator('[data-ai-summary]').click();await page.waitForFunction(()=>document.querySelector('.ai-trend')?.textContent.includes('สรุป Microsoft'));assert.match(await page.locator('.ai-card').innerText(),/ข้อมูลมีเฉพาะหัวข้อ/);assert.equal(await page.locator('.ai-sources a').count(),1);
  await page.locator('.topbar [data-logout]').click();await page.waitForSelector('#login-form');
  await page.locator('[data-recover]').click();await page.locator('#recover-form [name=email]').fill('pwa@example.com');await page.locator('#recover-form [name=code]').fill(code);await page.locator('#recover-form [name=password]').fill('pwa-new-password');await page.locator('#recover-form [name=confirm]').fill('pwa-new-password');await page.locator('#recover-form [type=submit]').click();await page.waitForSelector('#login-form');assert.notEqual(await page.locator('[aria-label="รหัสกู้คืน"]').inputValue(),code);
  await page.locator('#login-form [name=password]').fill('pwa-new-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  await page.locator('.sidebar [data-page=following]').click();assert.match(await page.locator('.company-grid').first().innerText(),/AAPL/);assert.doesNotMatch(await page.locator('#main').innerText(),/0\.125001|ต้นทุนเฉลี่ย/);
  await page.evaluate(async()=>{const s=await fetch('/api/session').then(r=>r.json());s.state.watchlist.push('MSFT');const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:s.user.id,revision:s.revision,state:s.state})});if(!r.ok)throw new Error('prepare second followed company');});
  await page.reload();await page.waitForFunction(()=>!quoteBusy&&quoteData.items.length===2);assert.match(await page.locator('#quotes-panel').innerText(),/ยังไม่มีราคา/);assert.match(await page.locator('#quotes-panel').innerText(),/ตรวจสอบได้/);
  const cached=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(req=>new URL(req.url).pathname)))).flat();});
  assert.deepEqual(cached.sort(),['/icon-192.png','/icon-512.png','/offline.html']);
  await context.setOffline(true);await page.reload();assert.match(await page.locator('h1').innerText(),/ยังเชื่อมต่อ/);assert.doesNotMatch(await page.locator('body').innerText(),/pwa@example|AAPL|MSFT/);
  await context.setOffline(false);await page.locator('a').click();await page.waitForSelector('body:not(.signed-out)');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:'test-artifacts/pwa-mobile.png',fullPage:true});
  console.log('PASS: manifest/icons, service worker, real feed adapter fixtures, XSS escaping, source/watchlist filtering, privacy migration model, recovery and offline privacy.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
