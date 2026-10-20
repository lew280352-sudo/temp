import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {marketFeeds,parseMarketNews,fetchMarketNews} from '../market-news.mjs';
import {parseWeeklyPrices,evaluateTrend,createForecastService} from '../forecast.mjs';

test('Finnhub market news credits approved publishers and rejects unsafe or stale articles',async()=>{
  const feed=marketFeeds.find(item=>item.symbol==='AMZN'),now=Date.parse('2026-10-20T12:00:00Z');
  const valid={source:'Yahoo',headline:'Amazon earnings',url:'https://finance.yahoo.com/news/amazon',datetime:now/1000};
  const data=[valid,{...valid,source:'Unknown blog',url:'https://example.com/news'},{...valid,url:'http://localhost/news'},{...valid,datetime:(now-10*86400000)/1000,url:'https://example.com/old'}];
  const parsed=parseMarketNews(data,feed,now);assert.equal(parsed.length,1);assert.equal(parsed[0].sourceType,'finance');assert.equal(parsed[0].source,'Yahoo');
  const fetched=await fetchMarketNews(feed,'fixture',async(url,options)=>{assert.match(url,/symbol=AMZN/);assert.equal(options.headers['X-Finnhub-Token'],'fixture');assert.equal(options.redirect,'error');return Response.json(data);},now);
  assert.deepEqual(fetched,parsed);
});

test('weekly walk-forward trend abstains when it cannot beat the baseline and omits unfinished week',()=>{
  const rising=Array.from({length:130},(_,i)=>({date:new Date(Date.UTC(2023,0,6+7*i)).toISOString().slice(0,10),close:100+i}));
  const now=Date.parse('2025-07-02T12:00:00Z');
  assert.equal(evaluateTrend(rising.slice(0,103),{now}).status,'insufficient');
  const result=evaluateTrend(rising,{now});assert.equal(result.status,'unvalidated');assert.equal(result.direction,null);assert.equal(result.observedTrend,'up');assert.equal(result.backtest.baselineAccuracy,1);
  assert.equal(result.backtest.samples,125);
  const incomplete=[...rising,{date:'2025-07-01',close:999}];
  assert.deepEqual(evaluateTrend(incomplete,{now}),result);
});

test('weekly trend shows a signal only when a fixed rule beats the baseline',()=>{
  let close=100;
  const rows=Array.from({length:160},(_,i)=>{
    close+=i%16<8?2:-2;
    return {date:new Date(Date.UTC(2022,0,7+7*i)).toISOString().slice(0,10),close};
  });
  const result=evaluateTrend(rows,{now:Date.parse('2025-02-10T12:00:00Z')});
  assert.equal(result.status,'validated');assert.equal(result.direction,result.observedTrend);
  assert.ok(result.backtest.samples>=100);
  assert.ok(result.backtest.accuracy>=0.6);
  assert.ok(result.backtest.accuracy>result.backtest.baselineAccuracy);
});

test('historical provider is optional and cached across requests and restarts',async()=>{
  const db=new DatabaseSync(':memory:');let calls=0;
  const series=Object.fromEntries(Array.from({length:130},(_,i)=>[new Date(Date.UTC(2023,0,6+7*i)).toISOString().slice(0,10),{'5. adjusted close':String(100+i)}]));
  assert.equal(parseWeeklyPrices({'Weekly Adjusted Time Series':series},'AAPL').prices.length,130);
  const service=createForecastService(db,{apiKey:'fixture',now:()=>Date.parse('2025-07-02T12:00:00Z'),fetcher:async(url,options)=>{calls++;assert.match(url,/function=TIME_SERIES_WEEKLY_ADJUSTED/);assert.match(url,/symbol=AAPL/);assert.equal(options.redirect,'error');return Response.json({'Weekly Adjusted Time Series':series});}});
  try{const first=await service.get('AAPL');assert.equal(first.provider,'Alpha Vantage');assert.equal(first.status,'unvalidated');await service.get('AAPL');assert.equal(calls,1);const restart=createForecastService(db,{apiKey:'fixture',now:()=>Date.parse('2025-07-02T12:00:00Z'),fetcher:async()=>{throw new Error('unexpected fetch');}});assert.equal((await restart.get('AAPL')).status,'unvalidated');restart.close();}
  finally{service.close();db.close();}
});
