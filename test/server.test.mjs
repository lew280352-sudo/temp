import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp,initialState,normalizeSourceUrl} from '../server.mjs';
import {feeds,verifiedFeeds} from '../feeds.mjs';

test('AI follow-up questions require a signed-in user and the same enabled headlines',async t=>{
  const feed=feeds.find(item=>item.symbol==='AAPL');
  assert.ok(feed);
  const server=createApp({databasePath:':memory:',aiEnabled:true,aiFetcher:async(url,options)=>url.endsWith('/api/tags')?Response.json({models:[{name:'qwen3:8b'}]}):Response.json({message:{content:JSON.stringify(JSON.parse(options.body).format?.properties?.sourceIds?{answer:'ประกาศผลิตภัณฑ์ใหม่',supported:true,sourceIds:[JSON.parse(JSON.parse(options.body).messages[1].content).articles[0].id]}:{title:'สรุป Apple',summary:'มีประกาศผลิตภัณฑ์ใหม่',facts:[],positiveFactors:[],risks:[],unknowns:[],confidence:'low'})}}),newsFetcher:async()=>new Response('<rss><channel><item><title>Apple introduces a new product</title><link>https://www.apple.com/newsroom/example</link><pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>')});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,{method='GET',data,cookie}={}){const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const account={name:'AI Tester',email:'ai-qa@example.com',password:'test-password-123'};
  await call('/api/register',{method:'POST',data:account});const login=await call('/api/login',{method:'POST',data:account}),cookie=login.cookie;
  assert.equal((await call('/api/ai/ask',{method:'POST',data:{symbol:'AAPL',question:'ข่าวนี้เกี่ยวกับอะไร?',articleIds:['one']}})).status,401);
  assert.equal((await call('/api/ai/ask',{method:'POST',cookie,data:{symbol:'AAPL',question:'สั้น',articleIds:['one']}})).status,400);
  await call('/api/news',{cookie});
  const summary=await call('/api/ai/summary',{method:'POST',cookie,data:{symbol:'AAPL'}});
  assert.equal(summary.status,200);assert.equal(summary.data.articles.length,1);
  const articleId=summary.data.articles[0].id;
  const answer=await call('/api/ai/ask',{method:'POST',cookie,data:{symbol:'AAPL',question:'ข่าวนี้เกี่ยวกับอะไร?',articleIds:[articleId]}});
  assert.equal(answer.status,200);assert.equal(answer.data.sources[0].id,articleId);
  assert.equal((await call('/api/ai/ask',{method:'POST',cookie,data:{symbol:'AAPL',question:'ข่าวนี้เกี่ยวกับอะไร?',articleIds:['fake-id']}})).status,409);
  const changed=structuredClone(login.data.state);changed.sources=changed.sources.map(source=>source.url===feed.url?{...source,enabled:false}:source);
  const saved=await call('/api/state',{method:'PUT',cookie,data:{userId:login.data.user.id,revision:login.data.revision,state:changed}});assert.equal(saved.status,200);
  assert.equal((await call('/api/ai/ask',{method:'POST',cookie,data:{symbol:'AAPL',question:'ข่าวนี้เกี่ยวกับอะไร?',articleIds:[articleId]}})).status,409);
});

test('registration, sessions, isolated news preferences, source validation and logout',async t=>{
  const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const sessions=new Map();
  async function call(route,{method='GET',body,cookie,origin=base,revision,expectedUserId}={}){
    const payload=route==='/api/state'?{state:body,revision:revision??sessions.get(cookie)?.revision??0,userId:expectedUserId??sessions.get(cookie)?.id}:body;
    const response=await fetch(base+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(payload):undefined});
    const result={status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
    if(result.data.user)sessions.set(result.cookie?.split(';')[0]||cookie,{id:result.data.user.id,revision:result.data.revision});
    if(result.data.ok&&route==='/api/state')sessions.get(cookie).revision=result.data.revision;
    return result;
  }
  const alice={name:'Alice',email:'Alice@example.com',password:'correct-test-password'};
  assert.equal((await call('/api/session')).data.user,null);
  assert.equal((await call('/api/state',{method:'PUT',body:initialState()})).status,401);
  assert.equal((await call('/api/register',{method:'POST',body:alice,origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/register',{method:'POST',body:{...alice,password:'short'}})).status,400);
  assert.equal((await call('/api/register',{method:'POST',body:alice})).status,201);
  assert.equal((await call('/api/register',{method:'POST',body:{...alice,email:'alice@example.com'}})).status,409);
  assert.equal((await call('/api/login',{method:'POST',body:{...alice,password:'wrong'}})).status,401);
  const login=await call('/api/login',{method:'POST',body:alice});assert.equal(login.status,200);
  assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/SameSite=Strict/);
  assert.equal(login.data.user.email,'alice@example.com');assert.equal(login.data.state.watchlist.length,0);
  const cookie=login.cookie.split(';')[0];
  assert.equal((await call('/api/session',{cookie})).data.user.name,'Alice');
  const state=login.data.state;state.watchlist=['AAPL'];
  state.sources.push({id:'example',name:'My source',url:'https://example.com/news#top',type:'partner',symbol:'AAPL',enabled:true});
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state})).status,200);
  const saved=(await call('/api/session',{cookie})).data.state;assert.deepEqual(saved.watchlist,['AAPL']);assert.equal(saved.sources.at(-1).url,'https://example.com/news');
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state,revision:0})).status,409,'stale tab cannot overwrite current data');
  for(const url of ['javascript:alert(1)','http://127.0.0.1/private','https://user:secret@example.com']){const bad=structuredClone(state);bad.sources.at(-1).url=url;assert.equal((await call('/api/state',{method:'PUT',cookie,body:bad})).status,400);}
  const duplicate=structuredClone(state);duplicate.sources.push({...duplicate.sources[0],id:'duplicate'});assert.equal((await call('/api/state',{method:'PUT',cookie,body:duplicate})).status,400);
  const invalid=structuredClone(state);invalid.watchlist.push('AAPL');assert.equal((await call('/api/state',{method:'PUT',cookie,body:invalid})).status,400);
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state,origin:'https://evil.example'})).status,403);
  const bob={name:'Bob',email:'bob@example.com',password:'different-test-password'};await call('/api/register',{method:'POST',body:bob});
  const bobLogin=await call('/api/login',{method:'POST',body:bob});assert.equal(bobLogin.data.state.watchlist.length,0);assert.equal(bobLogin.data.state.sources.length,initialState().sources.length);
  const bobCookie=bobLogin.cookie.split(';')[0];
  assert.equal((await call('/api/state',{method:'PUT',cookie:bobCookie,body:state,expectedUserId:login.data.user.id})).status,409,'account switch cannot write Alice data to Bob');
  assert.equal((await call('/api/session',{cookie:bobCookie})).data.state.watchlist.length,0);
  const exported=await call('/api/export',{cookie});assert.equal(exported.status,200);assert.deepEqual(exported.data.state.watchlist,['AAPL']);assert.doesNotMatch(JSON.stringify(exported.data),/password_hash|token_hash|salt|qty|cost/);
  const logout=await call('/api/logout',{method:'POST',cookie,body:{}});assert.equal(logout.status,200);assert.match(logout.cookie,/Max-Age=0/);
  assert.equal((await call('/api/session',{cookie})).data.user,null);
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state})).status,401);
  assert.equal((await call('/api/export',{cookie})).status,401);
  const relogin=await call('/api/login',{method:'POST',body:alice});assert.deepEqual(relogin.data.state.watchlist,['AAPL']);
  assert.equal((await fetch(base+'/.data/stocklens.sqlite')).status,404);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
  for(const file of ['/','/app.js','/auth.js','/theme.css'])assert.equal((await fetch(base+file)).status,200);
});
test('URL normalization preserves public source links',()=>{
  assert.equal(normalizeSourceUrl('https://example.com/news#section'),'https://example.com/news');
  for(const url of ['file:///etc/passwd','data:text/html,x','https://127.1','http://192.168.1.2','http://localhost:4173','ftp://example.com'])assert.throws(()=>normalizeSourceUrl(url));
});

test('reviewed RSS URLs produce account-isolated news while other URLs remain bookmarks',async t=>{
  const feed=verifiedFeeds[0],xml='<rss><channel><item><title>Federal Reserve announcement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/example.htm</link><pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>';
  let calls=0;
  const server=createApp({databasePath:':memory:',newsFetcher:async url=>{if(url===feed.feedUrl){calls++;return new Response(xml);}assert.ok(url.startsWith('https://'));return new Response('<rss><channel></channel></rss>');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(route,{method='GET',body,cookie}={}){
    const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const alice={name:'Alice',email:'alice-feed@example.com',password:'correct-test-password'};
  const bob={name:'Bob',email:'bob-feed@example.com',password:'correct-test-password'};
  await request('/api/register',{method:'POST',body:alice});await request('/api/register',{method:'POST',body:bob});
  const a=await request('/api/login',{method:'POST',body:alice}),b=await request('/api/login',{method:'POST',body:bob});
  a.data.state.sources.push({id:'fed-choice',name:'My label',url:feed.url,type:'partner',symbol:'AAPL',enabled:true});
  const saveA=await request('/api/state',{method:'PUT',cookie:a.cookie,body:{userId:a.data.user.id,revision:a.data.revision,state:a.data.state}});
  assert.equal(saveA.status,200);assert.equal(saveA.data.state.sources.at(-1).name,feed.name);assert.equal(saveA.data.state.sources.at(-1).symbol,'');
  const aliceNews=await request('/api/news',{cookie:a.cookie});assert.equal(aliceNews.status,200);assert.equal(aliceNews.data.items.length,1);assert.equal(aliceNews.data.items[0].sourceType,'macro');assert.equal(calls,1);
  const bobNews=await request('/api/news',{cookie:b.cookie});assert.equal(bobNews.status,200);assert.equal(bobNews.data.items.length,0);assert.ok(!bobNews.data.sources.some(source=>source.id===feed.id));
  b.data.state.sources.push({id:'bookmark',name:'Unknown site',url:'https://example.com/rss.xml',type:'finance',symbol:'',enabled:true});
  assert.equal((await request('/api/state',{method:'PUT',cookie:b.cookie,body:{userId:b.data.user.id,revision:b.data.revision,state:b.data.state}})).status,200);
  await request('/api/news',{cookie:b.cookie});assert.equal(calls,1,'arbitrary URL is never fetched');
  saveA.data.state.sources.at(-1).enabled=false;
  assert.equal((await request('/api/state',{method:'PUT',cookie:a.cookie,body:{userId:a.data.user.id,revision:saveA.data.revision,state:saveA.data.state}})).status,200);
  assert.equal((await request('/api/news',{cookie:a.cookie})).data.items.length,0);
});

test('following a newly supported stock restores its Finnhub news source',async t=>{
  const server=createApp({databasePath:':memory:',quoteApiKey:'fixture'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,account={name:'Investor',email:'new-stock@example.com',password:'correct-test-password'};
  async function call(route,method='GET',body,cookie){const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  assert.equal((await call('/api/register','POST',account)).status,201);
  const login=await call('/api/login','POST',account),state=login.data.state;
  assert.equal(state.sources.length,40);
  assert.equal(state.sources.filter(source=>source.url==='https://finnhub.io/?symbol=AVGO').length,1);
  state.sources=state.sources.filter(source=>source.url!=='https://finnhub.io/?symbol=AVGO');state.watchlist.push('AVGO');
  const saved=await call('/api/state','PUT',{userId:login.data.user.id,revision:login.data.revision,state},login.cookie);
  assert.equal(saved.status,200);assert.deepEqual(saved.data.state.watchlist,['AVGO']);
  assert.equal(saved.data.state.sources.filter(source=>source.url==='https://finnhub.io/?symbol=AVGO'&&source.enabled).length,1);
});
