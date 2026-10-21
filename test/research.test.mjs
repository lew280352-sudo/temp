import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createResearchService,researchWindows,validateResearchMonths} from '../research.mjs';
import {createApp} from '../server.mjs';

const now=new Date('2026-10-21T12:00:00.000Z');
const row=(title,date,url)=>({headline:title,summary:title,source:'Reuters',url,datetime:Date.parse(date)/1000});

test('research searches company names, samples historical months, filters unrelated stories, and caches news',async()=>{
  const urls=[];
  const fetcher=async(url,options)=>{
    const parsed=new URL(url);urls.push(parsed);
    assert.equal(parsed.origin,'https://finnhub.io');
    assert.equal(parsed.searchParams.has('token'),false);
    assert.equal(options.headers['X-Finnhub-Token'],'fixture');
    if(parsed.pathname.endsWith('/search'))return Response.json({result:[{symbol:'NVDA',description:'NVIDIA Corp',type:'Common Stock'},{symbol:'NVDA.X',description:'Nvidia fund',type:'ETF'}]});
    const month=parsed.searchParams.get('to').slice(0,7);
    return Response.json([
      row(`Nvidia launch in ${month}`,`${month}-15T12:00:00Z`,`https://publisher.example/${month}/nvidia`),
      row(`Unrelated company report in ${month}`,`${month}-16T12:00:00Z`,`https://publisher.example/${month}/other`),
      row('Nvidia old story','2025-01-01T12:00:00Z',`https://publisher.example/${month}/old`),
      row('Nvidia unsafe link',`${month}-15T12:00:00Z`,'http://127.0.0.1/private')
    ]);
  };
  const service=createResearchService({apiKey:'fixture',fetcher,now:()=>now});
  assert.deepEqual(await service.companies('NVIDIA'),[{symbol:'NVDA',name:'NVIDIA Corp'}]);
  const result=await service.news('NVDA','NVIDIA Corp',3);
  assert.equal(result.months,3);assert.equal(result.from,'2026-07-21');assert.equal(result.to,'2026-10-21');
  assert.equal(urls.filter(url=>url.pathname.endsWith('/company-news')).length,3);
  assert.deepEqual(new Set(result.articles.map(article=>article.url.match(/2026-\d\d/)[0])),new Set(['2026-10','2026-09','2026-08']));
  assert.equal(result.matchedCount,3);
  assert.equal((await service.news('NVDA','NVIDIA Corp',3)).cached,true);
  assert.equal(urls.length,4);
  assert.throws(()=>validateResearchMonths(12),/1, 3 หรือ 6/);
  assert.deepEqual(researchWindows(1,now),[{from:'2026-09-21',to:'2026-10-21'}]);
});

test('research endpoints require login and give news links when AI is unavailable',async t=>{
  const calls=[];
  const fetcher=async url=>{
    const parsed=new URL(url);calls.push(parsed.pathname);
    if(parsed.pathname.endsWith('/search'))return Response.json({result:[{symbol:'NVDA',description:'NVIDIA Corp',type:'Common Stock'}]});
    return Response.json([row('Nvidia announces new chip','2026-10-20T12:00:00Z','https://publisher.example/nvidia-chip')]);
  };
  const server=createApp({databasePath:':memory:',quoteApiKey:'fixture',researchFetcher:fetcher,aiEnabled:false});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(route,method='GET',body,cookie)=>{
    const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  assert.equal((await call('/api/research/companies?q=NVIDIA')).status,401);
  assert.equal((await call('/api/research','POST',{symbol:'NVDA',name:'NVIDIA Corp',months:1})).status,401);
  const registration=await call('/api/register','POST',{name:'Research User',email:'research@example.com',password:'strong-test-password'});
  assert.equal(registration.status,201);
  const login=await call('/api/login','POST',{email:'research@example.com',password:'strong-test-password'}),cookie=login.cookie.split(';')[0];
  assert.equal((await call('/api/research/companies?q=NVIDIA','GET',null,cookie)).data.items[0].symbol,'NVDA');
  assert.equal((await call('/api/research','POST',{symbol:'NVDA',name:'NVIDIA Corp',months:12},cookie)).status,400);
  const result=await call('/api/research','POST',{symbol:'NVDA',name:'NVIDIA Corp',months:1},cookie);
  assert.equal(result.status,200);assert.equal(result.data.articles.length,1);
  assert.equal(result.data.summary,null);assert.match(result.data.aiError,/AI/);
  assert.equal(calls.filter(path=>path.endsWith('/company-news')).length,1);
  await call('/api/logout','POST',{},cookie);
  assert.equal((await call('/api/research/companies?q=NVIDIA','GET',null,cookie)).status,401);
});

test('Finnhub rate limit stops further monthly requests and reports incomplete coverage',async()=>{
  let requests=0;
  const service=createResearchService({apiKey:'fixture',now:()=>now,fetcher:async()=>{
    requests++;
    if(requests===1)return Response.json([row('Nvidia product news','2026-10-20T12:00:00Z','https://publisher.example/first')]);
    return new Response('limited',{status:429});
  }});
  const result=await service.news('NVDA','NVIDIA Corp',3);
  assert.equal(requests,2);assert.equal(result.failedMonths,2);assert.equal(result.articles.length,1);
});
