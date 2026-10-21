import {chromium} from 'playwright';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';

const result={title:'ภาพรวม NVIDIA',summary:'พบข่าวผลิตภัณฑ์ใหม่',facts:['มีหัวข้อข่าวเปิดตัวสินค้า'],positiveFactors:[],risks:[],unknowns:['ยังไม่ทราบยอดขาย'],confidence:'low'};
const researchFetcher=async url=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/search'))return Response.json({result:[{symbol:'NVDA',description:'NVIDIA Corp',type:'Common Stock'}]});
  return Response.json([{headline:'Nvidia announces new chip',summary:'Nvidia chip launch',source:'Reuters',url:'https://publisher.example/nvidia-chip',datetime:Math.floor(Date.now()/1000)-3600}]);
};
const aiFetcher=async url=>url.endsWith('/api/tags')?Response.json({models:[{name:'qwen3:8b'}]}):Response.json({message:{content:JSON.stringify(result)}});
const newsFetcher=async url=>String(url).includes('finnhub.io')?Response.json([]):new Response('<rss><channel></channel></rss>');
const server=createApp({databasePath:':memory:',quoteApiKey:'fixture',researchFetcher,newsFetcher,aiEnabled:true,aiFetcher});
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({executablePath:process.env.BROWSER_PATH||(process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':undefined),headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('[name=name]').fill('Research User');await page.locator('[name=email]').fill('research-ui@example.com');await page.locator('[name=password]').fill('strong-test-password');await page.locator('[name=confirm]').fill('strong-test-password');await page.locator('#register-form [type=submit]').click();
  await page.waitForSelector('#login-form');await page.locator('[name=password]').fill('strong-test-password');await page.locator('#login-form [type=submit]').click();await page.waitForSelector('body:not(.signed-out)');
  await page.locator('.sidebar [data-page=search]').click();
  await page.locator('#company-query').fill('NVIDIA');await page.locator('[data-research-find]').click();
  await page.waitForSelector('[data-research-index]');await page.locator('[data-research-index]').click();
  await page.locator('[data-research-months="3"]').click();assert.equal(await page.locator('[data-research-months="3"]').getAttribute('aria-pressed'),'true');
  await page.locator('[data-research-run]').click();await page.getByText('พบข่าวผลิตภัณฑ์ใหม่').waitFor();
  assert.equal(await page.locator('.research-results .ai-sources a').count(),1);
  assert.equal(await page.locator('.research-results .ai-sources a').getAttribute('href'),'https://publisher.example/nvidia-chip');
  await page.locator('#company-query').fill('Apple');assert.equal(await page.locator('.research-results').count(),0);
  await page.locator('.sidebar [data-logout]').click();await page.waitForSelector('#login-form');assert.equal(await page.locator('#main').innerHTML(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: company search, month choice, AI summary, source link, query reset and logout');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
