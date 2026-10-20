import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {marketFeeds,parseMarketNews,fetchMarketNews} from '../market-news.mjs';
import {parseDailyPrices,evaluateTrend,createForecastService} from '../forecast.mjs';

test('Finnhub market news credits approved publishers and rejects unsafe or stale articles',async()=>{
  const feed=marketFeeds.find(item=>item.symbol==='AMZN'),now=Date.parse('2026-10-20T12:00:00Z');
  const valid={source:'Yahoo',headline:'Amazon earnings',url:'https://finance.yahoo.com/news/amazon',datetime:now/1000};
  const data=[valid,{...valid,source:'Unknown blog',url:'https://example.com/news'},{...valid,url:'http://localhost/news'},{...valid,datetime:(now-10*86400000)/1000,url:'https://example.com/old'}];
  const parsed=parseMarketNews(data,feed,now);assert.equal(parsed.length,1);assert.equal(parsed[0].sourceType,'finance');assert.equal(parsed[0].source,'Yahoo');
  const fetched=await fetchMarketNews(feed,'fixture',async(url,options)=>{assert.match(url,/symbol=AMZN/);assert.equal(options.headers['X-Finnhub-Token'],'fixture');assert.equal(options.redirect,'error');return Response.json(data);},now);
  assert.deepEqual(fetched,parsed);
});

test('walk-forward trend abstains without enough or better-than-baseline evidence',()=>{
  const rising=Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),close:100+i}));
  assert.equal(evaluateTrend(rising.slice(0,99)).status,'insufficient');
  const result=evaluateTrend(rising);assert.equal(result.status,'unvalidated');assert.equal(result.direction,null);assert.equal(result.backtest.samples,15);assert.equal(result.backtest.baselineAccuracy,1);
  const split=rising.map(row=>({...row}));split[40].close=split[39].close/2;assert.equal(evaluateTrend(split).status,'corporate_action');
});

test('historical provider is optional and cached across requests and restarts',async()=>{
  const db=new DatabaseSync(':memory:');let calls=0;
  const series=Object.fromEntries(Array.from({length:100},(_,i)=>[new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),{'4. close':String(100+i)}]));
  assert.equal(parseDailyPrices({'Time Series (Daily)':series},'AAPL').prices.length,100);
  const service=createForecastService(db,{apiKey:'fixture',now:()=>Date.parse('2026-04-12T12:00:00Z'),fetcher:async(url,options)=>{calls++;assert.match(url,/function=TIME_SERIES_DAILY/);assert.match(url,/symbol=AAPL/);assert.equal(options.redirect,'error');return Response.json({'Time Series (Daily)':series});}});
  try{const first=await service.get('AAPL');assert.equal(first.provider,'Alpha Vantage');assert.equal(first.status,'unvalidated');await service.get('AAPL');assert.equal(calls,1);const restart=createForecastService(db,{apiKey:'fixture',now:()=>Date.parse('2026-04-12T12:00:00Z'),fetcher:async()=>{throw new Error('unexpected fetch');}});assert.equal((await restart.get('AAPL')).status,'unvalidated');restart.close();}
  finally{service.close();db.close();}
});
