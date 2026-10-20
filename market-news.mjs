import {createHash} from 'node:crypto';
import {companies} from './dist/catalog.js';

// Finnhub supplies the feed; each article still links to and names its publisher.
export const marketFeeds=companies.map(company=>({
  id:`market-${company.symbol.toLowerCase().replace('.','-')}`,
  name:`ข่าวการเงิน · ${company.symbol}`,
  symbol:company.symbol,
  type:'finance',
  url:`https://finnhub.io/?symbol=${encodeURIComponent(company.symbol)}`
}));
const allowedPublishers=new Set(['yahoo','benzinga','seekingalpha','cnbc','reuters','bloomberg','marketwatch','ap','associated press','financial times','the wall street journal','barrons','barron\'s','morningstar']);
const MAX_BYTES=1024*1024;

export function parseMarketNews(value,feed,now=Date.now()){
  if(!Array.isArray(value))throw new Error('Invalid company news');
  const unique=new Map();
  for(const item of value.slice(0,300)){
    const publisher=String(item?.source??'').trim();
    if(!allowedPublishers.has(publisher.toLowerCase()))continue;
    let url;try{url=new URL(item.url);}catch{continue;}
    if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname==='localhost')continue;
    url.hash='';
    const title=String(item.headline??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,300);
    const timestamp=Number(item.datetime)*1000;
    if(!title||!Number.isFinite(timestamp)||timestamp<now-8*86400000||timestamp>now+300000)continue;
    if(!unique.has(url.href))unique.set(url.href,{
      id:createHash('sha256').update(url.href).digest('hex').slice(0,24),feedId:feed.id,symbol:feed.symbol,
      source:publisher,sourceType:'finance',via:'Finnhub',title,url:url.href,publishedAt:new Date(timestamp).toISOString()
    });
  }
  const counts=new Map(),selected=[];
  for(const item of [...unique.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt))){
    const count=counts.get(item.source)||0;
    if(count>=8)continue;
    selected.push(item);counts.set(item.source,count+1);
    if(selected.length===25)break;
  }
  return selected;
}

export async function fetchMarketNews(feed,apiKey,fetcher=fetch,now=Date.now()){
  if(!apiKey)throw new Error('Missing Finnhub key');
  const from=new Date(now-7*86400000).toISOString().slice(0,10),to=new Date(now).toISOString().slice(0,10);
  const url=`https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(feed.symbol)}&from=${from}&to=${to}`;
  const response=await fetcher(url,{headers:{'X-Finnhub-Token':apiKey},redirect:'error',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('News too large');}
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('News too large');parts.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
  return parseMarketNews(JSON.parse(Buffer.concat(parts).toString('utf8')),feed,now);
}
