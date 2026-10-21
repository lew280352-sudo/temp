import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {companies} from '../dist/catalog.js';
import {companyIcons} from '../dist/company-icons.js';
import {marketFeeds} from '../market-news.mjs';
import {createApp} from '../server.mjs';

test('expanded US directory serves verified local company icons and market mappings',async t=>{
  assert.equal(companies.length,36);
  assert.equal(new Set(companies.map(company=>company.symbol)).size,36);
  assert.equal(marketFeeds.length,36);
  assert.equal(Object.keys(companyIcons).length,33);
  assert.equal(companies.find(company=>company.symbol==='AVGO')?.icon,companyIcons.AVGO);
  assert.equal(companies.find(company=>company.symbol==='BRK.B')?.icon,null);
  assert.equal(companies.find(company=>company.symbol==='GOOGL')?.icon,null);
  const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const symbol of ['AAPL','AVGO','META']){
    const response=await fetch(base+companyIcons[symbol]);
    assert.equal(response.status,200,symbol);
    assert.match(response.headers.get('content-type'),/^image\//);
    assert.ok((await response.arrayBuffer()).byteLength>100);
  }
  assert.equal((await fetch(base+'/company-icons/unknown.ico')).status,404);
});
