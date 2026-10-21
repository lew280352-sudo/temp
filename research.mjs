import {createHash} from 'node:crypto';

const symbolPattern=/^[A-Z][A-Z0-9.-]{0,9}$/;
const monthsAllowed=new Set([1,3,6]);
const suffixes=/\b(corp(?:oration)?|inc(?:orporated)?|ltd|limited|plc|co(?:mpany)?|class|holdings?|group|technologies|technology)\b/gi;
const safeText=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';

export function validateResearchSymbol(value){
  const symbol=safeText(value,32).toUpperCase();
  if(!symbolPattern.test(symbol))throw new Error('กรุณาเลือกบริษัทจากผลค้นหา');
  return symbol;
}
export function validateResearchMonths(value){
  if(!Number.isInteger(value)||!monthsAllowed.has(value))throw new Error('เลือกช่วงข่าวย้อนหลัง 1, 3 หรือ 6 เดือน');
  return value;
}
function monthBefore(date){
  const result=new Date(date);
  const day=result.getUTCDate();
  result.setUTCDate(1);result.setUTCMonth(result.getUTCMonth()-1);
  result.setUTCDate(Math.min(day,new Date(Date.UTC(result.getUTCFullYear(),result.getUTCMonth()+1,0)).getUTCDate()));
  return result;
}
export function researchWindows(months,now=new Date()){
  validateResearchMonths(months);
  const result=[];let end=new Date(now);
  for(let i=0;i<months;i++){
    const start=monthBefore(end);
    result.push({from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)});
    end=start;
  }
  return result;
}
function relevant(item,name,symbol){
  const nameParts=name.replace(suffixes,' ').replace(/[^\p{L}\p{N} ]/gu,' ').trim().split(/\s+/).filter(part=>part.length>=4);
  const terms=[...new Set([...nameParts.slice(0,2),symbol])];
  const text=`${safeText(item.headline,300)} ${safeText(item.summary,500)}`.toLowerCase();
  return terms.some(term=>new RegExp(`(^|[^a-z0-9])${term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}($|[^a-z0-9])`,'iu').test(text));
}
export function createResearchService({apiKey='',fetcher=fetch,now=()=>new Date()}={}){
  const key=String(apiKey).trim();
  const cache=new Map();
  async function request(path,params){
    if(!key){const error=new Error('ต้องตั้งค่า FINNHUB_API_KEY ก่อนค้นข่าวย้อนหลัง');error.code='not_configured';throw error;}
    const url=new URL(`https://finnhub.io/api/v1/${path}`);
    url.search=new URLSearchParams(params);
    let response;
    try{response=await fetcher(url.href,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json','X-Finnhub-Token':key},redirect:'error'});}
    catch{throw new Error('ติดต่อ Finnhub ไม่สำเร็จ กรุณาลองใหม่');}
    if(!response.ok){const error=new Error(response.status===429?'Finnhub จำกัดจำนวนคำขอ กรุณารอสักครู่':`Finnhub ตอบกลับ HTTP ${response.status}`);if(response.status===429)error.code='rate_limit';throw error;}
    const raw=await response.text();
    if(Buffer.byteLength(raw)>3*1024*1024)throw new Error('ผลข่าวจาก Finnhub ใหญ่เกินไป');
    try{return JSON.parse(raw);}catch{throw new Error('Finnhub ส่งข้อมูลที่อ่านไม่ได้');}
  }
  async function companies(query){
    const q=safeText(query,80);
    if(q.length<2||q.length>80)throw new Error('กรอกชื่อบริษัทหรือ ticker อย่างน้อย 2 ตัวอักษร');
    const data=await request('search',{q});
    if(!Array.isArray(data.result))throw new Error('Finnhub ส่งผลค้นหาที่ไม่ถูกต้อง');
    return data.result.filter(item=>item.type==='Common Stock'&&symbolPattern.test(item.symbol||'')).slice(0,12).map(item=>({symbol:item.symbol,name:safeText(item.description,120)}));
  }
  async function news(symbol,name,months){
    symbol=validateResearchSymbol(symbol);months=validateResearchMonths(months);
    if(!key){const error=new Error('ต้องตั้งค่า FINNHUB_API_KEY ก่อนค้นข่าวย้อนหลัง');error.code='not_configured';throw error;}
    name=safeText(name,120);
    const anchor=now(),keyHash=createHash('sha256').update(JSON.stringify([symbol,name,months,anchor.toISOString().slice(0,10)])).digest('hex');
    const cached=cache.get(keyHash);
    if(cached&&Date.now()-cached.time<15*60*1000)return {...cached.value,cached:true};
    const windows=researchWindows(months,anchor),all=[];let failedMonths=0,truncatedMonths=0,rateLimited=false;
    for(let index=0;index<windows.length;index++){
      const window=windows[index];
      try{
        const data=await request('company-news',{symbol,...window});
        if(!Array.isArray(data))throw new Error('Finnhub ส่งข่าวรูปแบบที่ไม่ถูกต้อง');
        if(data.length>=250)truncatedMonths++;
        all.push(...data.slice(0,250));
      }catch(error){failedMonths++;if(error.code==='rate_limit'){rateLimited=true;failedMonths+=windows.length-index-1;break;}}
    }
    if(failedMonths===months)throw new Error(rateLimited?'Finnhub จำกัดจำนวนคำขอ กรุณารอสักครู่':'ดึงข่าวย้อนหลังจาก Finnhub ไม่สำเร็จ');
    const start=new Date(windows.at(-1).from+'T00:00:00Z').getTime(),end=anchor.getTime()+5*60*1000;
    const seen=new Set(),articles=[];
    for(const item of all){
      if(!item||!relevant(item,name,symbol))continue;
      const stamp=Number(item.datetime)*1000,headline=safeText(item.headline,300),source=safeText(item.source,100);
      let url;try{url=new URL(item.url);}catch{continue;}
      if(url.protocol!=='https:'||url.username||url.password||!url.hostname.includes('.')||!Number.isFinite(stamp)||stamp<start||stamp>end||!headline||!source||seen.has(url.href))continue;
      seen.add(url.href);
      articles.push({id:createHash('sha256').update(url.href).digest('hex').slice(0,24),symbol,source,title:headline,url:url.href,publishedAt:new Date(stamp).toISOString(),stale:false});
    }
    articles.sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt));
    // Spread the sample across the requested period. A simple latest-first slice
    // would make a six-month search summarize only the newest few days.
    const groups=windows.map((window,index)=>articles.filter(article=>{
      const day=article.publishedAt.slice(0,10);
      return day>=window.from&&(index===0?day<=window.to:day<window.to);
    }));
    const candidates=groups.map(group=>{
      const count=Math.min(group.length,Math.max(4,Math.ceil(20/months)));
      return Array.from({length:count},(_,index)=>group[Math.floor(index*group.length/count)]);
    });
    const picked=[],perSource=new Map();
    for(let index=0;picked.length<20&&candidates.some(group=>group.length);index++){
      const group=candidates[index%months];
      if(!group.length)continue;
      const article=group.shift(),count=perSource.get(article.source)||0;
      if(count>=6)continue;
      picked.push(article);perSource.set(article.source,count+1);
    }
    const value={symbol,name,months,from:windows.at(-1).from,to:anchor.toISOString().slice(0,10),articles:picked,matchedCount:articles.length,failedMonths,truncatedMonths};
    if(cache.size>100)cache.clear();cache.set(keyHash,{time:Date.now(),value});
    return {...value,cached:false};
  }
  return {companies,news};
}
