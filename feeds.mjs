import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import {marketFeeds,fetchMarketNews} from './market-news.mjs';

export const feeds = [
  {id:'apple',name:'Apple Newsroom',symbol:'AAPL',url:'https://www.apple.com/newsroom/',feedUrl:'https://www.apple.com/newsroom/rss-feed.rss'},
  {id:'microsoft',name:'Microsoft News',symbol:'MSFT',url:'https://news.microsoft.com/',feedUrl:'https://news.microsoft.com/source/feed/'},
  {id:'nvidia',name:'NVIDIA Newsroom',symbol:'NVDA',url:'https://nvidianews.nvidia.com/',feedUrl:'https://nvidianews.nvidia.com/releases.xml'},
  {id:'netflix',name:'Netflix Investor News',symbol:'NFLX',url:'https://ir.netflix.net/',feedUrl:'https://ir.netflix.net/rss/PressRelease.aspx'}
];
// User-selectable feeds use exact, reviewed URLs; arbitrary saved websites stay bookmarks.
export const verifiedFeeds=[
  {id:'fed-press',name:'Federal Reserve · ข่าวประชาสัมพันธ์',symbol:'',type:'macro',url:'https://www.federalreserve.gov/feeds/press_all.xml',feedUrl:'https://www.federalreserve.gov/feeds/press_all.xml'},
  {id:'fed-monetary',name:'Federal Reserve · นโยบายการเงิน',symbol:'',type:'macro',url:'https://www.federalreserve.gov/feeds/press_monetary.xml',feedUrl:'https://www.federalreserve.gov/feeds/press_monetary.xml'}
];
const LIMIT=2*1024*1024;
const list=value=>value==null?[]:Array.isArray(value)?value:[value];
const scalar=value=>typeof value==='object'?value?.['#text']||'':String(value??'');
function plain(value){
  return scalar(value).replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]).replace(/\s+/g,' ').trim();
}
export function parseFeed(xml,feed){
  if(Buffer.byteLength(xml)>LIMIT||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsafe or oversized XML');
  if(XMLValidator.validate(xml)!==true)throw new Error('Invalid XML');
  const document=new XMLParser({ignoreAttributes:false,processEntities:false,parseTagValue:false}).parse(xml);
  if(!document.rss?.channel&&!document.feed)throw new Error('Not an RSS or Atom feed');
  const entries=list(document.rss?.channel?.item??document.feed?.entry);
  const unique=new Map();
  for(const item of entries.slice(0,100)){
    const link=list(item.link).find(v=>typeof v==='string'||!v['@_rel']||v['@_rel']==='alternate');
    let url;try{url=new URL(typeof link==='string'?link:link?.['@_href']);}catch{continue;}
    // Article destinations must stay on the publisher's host; no arbitrary redirects are fetched.
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname!==new URL(feed.url).hostname)continue;
    url.hash='';
    const title=plain(item.title).slice(0,300);if(!title)continue;
    const date=Date.parse(scalar(item.pubDate??item.published??item.updated));
    if(!unique.has(url.href))unique.set(url.href,{id:createHash('sha256').update(url.href).digest('hex').slice(0,24),feedId:feed.id,symbol:feed.symbol,source:feed.name,sourceType:feed.type==='macro'?'macro':'company',title,url:url.href,publishedAt:Number.isFinite(date)?new Date(date).toISOString():null});
  }
  return [...unique.values()].slice(0,40);
}
export async function fetchFeed(feed,fetcher=fetch){
  const response=await fetcher(feed.feedUrl,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent':'StockLens/0.3 (+https://github.com/lew280352-sudo/temp)'}});
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  if(Number(response.headers.get('content-length'))>LIMIT){await response.body?.cancel();throw new Error('Feed too large');}
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT)throw new Error('Feed too large');chunks.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
  return parseFeed(Buffer.concat(chunks).toString('utf8'),feed);
}
export function createNewsService(db,{fetcher=fetch,marketApiKey='',marketFetcher=fetch,now=Date.now,selectedFeeds=()=>[]}={}){
  db.exec('CREATE TABLE IF NOT EXISTS news_feeds(id TEXT PRIMARY KEY, data TEXT NOT NULL, checked_at TEXT, succeeded_at TEXT, error TEXT)');
  const baseFeeds=marketApiKey?[...feeds,...marketFeeds]:feeds;
  const pending=new Map();let closed=false;
  const selected=()=>selectedFeeds().filter(feed=>verifiedFeeds.some(approved=>approved.id===feed.id&&approved.feedUrl===feed.feedUrl));
  async function refreshFeed(feed){
    if(closed)return;
    if(pending.has(feed.id))return pending.get(feed.id);
    const task=(async()=>{
      const previous=db.prepare('SELECT checked_at,error FROM news_feeds WHERE id=?').get(feed.id);
      const cooldown=previous?.error?15*60*1000:feed.type==='finance'?4*60*60*1000:feed.type==='macro'?15*60*1000:0;
      if(cooldown&&previous?.checked_at&&now()-Date.parse(previous.checked_at)<cooldown)return;
      const checked=new Date(now()).toISOString();
      try{
        const items=feed.type==='finance'?await fetchMarketNews(feed,marketApiKey,marketFetcher,now()):await fetchFeed(feed,fetcher);if(closed)return;
        db.prepare('INSERT INTO news_feeds VALUES(?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at,succeeded_at=excluded.succeeded_at,error=NULL').run(feed.id,JSON.stringify(items),checked,checked);
      }catch(error){if(closed)return;db.prepare("INSERT INTO news_feeds VALUES(?,'[]',?,NULL,?) ON CONFLICT(id) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error").run(feed.id,checked,/^HTTP \d{3}$/.test(error.message)?error.message:'ดึงข้อมูลไม่สำเร็จ');}
    })().finally(()=>pending.delete(feed.id));
    pending.set(feed.id,task);return task;
  }
  async function refresh(){await Promise.all([...baseFeeds,...selected()].map(refreshFeed));}
  async function refreshSelected(){await Promise.all(selected().map(refreshFeed));}
  function snapshot(){
    const activeFeeds=[...baseFeeds,...selected()];
    const items=[],statuses=activeFeeds.map(feed=>{
      const row=db.prepare('SELECT * FROM news_feeds WHERE id=?').get(feed.id);
      const stale=!row?.succeeded_at||now()-Date.parse(row.succeeded_at)>(feed.type==='finance'?6:1)*60*60*1000;
      if(row)items.push(...JSON.parse(row.data).map(item=>({...item,stale:stale||!!row.error})));
      return {...feed,checkedAt:row?.checked_at??null,succeededAt:row?.succeeded_at??null,status:row?.error?'error':stale?'pending':'ok',error:row?.error??null};
    });
    items.sort((a,b)=>(b.publishedAt||'').localeCompare(a.publishedAt||''));
    return {items,sources:statuses,refreshMinutes:15};
  }
  return {refresh,refreshSelected,snapshot,close(){closed=true;}};
}
