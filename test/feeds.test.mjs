import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {feeds,parseFeed,fetchFeed,createNewsService} from '../feeds.mjs';

const rss=feed=>`<rss><channel><item><title><![CDATA[<b>Company</b> &amp; earnings]]></title><link>${feed.url}news/example</link><pubDate>Sun, 18 Oct 2026 08:00:00 GMT</pubDate></item><item><title>Duplicate</title><link>${feed.url}news/example</link></item><item><title>Bad link</title><link>javascript:alert(1)</link></item><item><title>External</title><link>https://evil.example/</link></item></channel></rss>`;
test('RSS/Atom parsing strips markup, rejects unsafe XML/URLs and deduplicates articles',()=>{
  const items=parseFeed(rss(feeds[0]),feeds[0]);assert.equal(items.length,1);assert.equal(items[0].symbol,'AAPL');assert.match(items[0].url,/^https:\/\/www.apple.com\//);
  const atom='<feed><entry><title>&lt;script&gt;hello&lt;/script&gt;</title><link rel="alternate" href="https://www.apple.com/newsroom/test"/><updated>2026-10-18T08:00:00Z</updated></entry></feed>';
  const entry=parseFeed(atom,feeds[0])[0];assert.equal(entry.publishedAt,'2026-10-18T08:00:00.000Z');
  for(const xml of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>','<rss>','x'.repeat(2097153),'<html/>'])assert.throws(()=>parseFeed(xml,feeds[0]));
});
test('bounded network requests disallow redirects and reject oversized responses',async()=>{
  await fetchFeed(feeds[0],async(url,options)=>{assert.equal(url,feeds[0].feedUrl);assert.equal(options.redirect,'error');assert.ok(options.signal);return new Response(rss(feeds[0]));});
  await assert.rejects(fetchFeed(feeds[0],async()=>new Response('x'.repeat(2097153))),/too large/);
  await assert.rejects(fetchFeed(feeds[0],async()=>new Response('',{status:429})),/HTTP 429/);
});
test('refresh coalesces requests, persists successful feeds and marks failures stale without losing news',async()=>{
  const db=new DatabaseSync(':memory:');let calls=0,fail=false;
  const service=createNewsService(db,{fetcher:async url=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));if(fail)throw new Error('offline');return new Response(rss(feeds.find(f=>f.feedUrl===url)));}});
  try{
    await Promise.all([service.refresh(),service.refresh()]);assert.equal(calls,3);assert.equal(service.snapshot().items.length,3);assert.ok(service.snapshot().sources.every(s=>s.status==='ok'));
    fail=true;await service.refresh();assert.equal(service.snapshot().items.length,3);assert.ok(service.snapshot().items.every(i=>i.stale));assert.ok(service.snapshot().sources.every(s=>s.status==='error'));
    const restarted=createNewsService(db);assert.equal(restarted.snapshot().items.length,3);restarted.close();
  }finally{service.close();db.close();}
});
