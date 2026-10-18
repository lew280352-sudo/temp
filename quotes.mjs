import {companies} from './dist/catalog.js';
const allowed=new Set(companies.map(c=>c.symbol));
export function createQuoteService(db,{apiKey='',fetcher=fetch,now=Date.now}={}){
  db.exec('CREATE TABLE IF NOT EXISTS stock_quotes(symbol TEXT PRIMARY KEY,data TEXT,attempted_at INTEGER NOT NULL,error TEXT)');
  const pending=new Map();let closed=false;
  async function refresh(symbol){
    if(!apiKey||closed)return;
    if(pending.has(symbol))return pending.get(symbol);
    const previous=db.prepare('SELECT * FROM stock_quotes WHERE symbol=?').get(symbol);
    if(previous&&now()-previous.attempted_at<60000)return;
    // Persist attempts too: failures, repeated clicks and restarts must not bypass the cooldown.
    db.prepare('INSERT INTO stock_quotes VALUES(?,NULL,?,NULL) ON CONFLICT(symbol) DO UPDATE SET attempted_at=excluded.attempted_at').run(symbol,now());
    const job=(async()=>{
      try{
        const response=await fetcher('https://api.finnhub.io/api/v1/quote?symbol='+encodeURIComponent(symbol),{headers:{'X-Finnhub-Token':apiKey},redirect:'error',signal:AbortSignal.timeout(8000)});
        if(!response.ok)throw new Error(response.status===429?'quota':response.status===401||response.status===403?'key':'provider');
        const reader=response.body.getReader(),parts=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new Error('invalid');parts.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
        const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
        if(typeof value.c!=='number'||!Number.isFinite(value.c)||value.c<=0||!Number.isSafeInteger(value.t)||value.t<=0||value.t*1000>now()+300000)throw new Error('invalid');
        const quote={symbol,currency:'USD',price:value.c,quoteAt:new Date(value.t*1000).toISOString(),fetchedAt:new Date(now()).toISOString(),provider:'Finnhub'};
        if(!closed)db.prepare('UPDATE stock_quotes SET data=?,error=NULL WHERE symbol=?').run(JSON.stringify(quote),symbol);
      }catch(error){
        const message={quota:'ผู้ให้บริการจำกัดโควตา กรุณารอก่อนลองใหม่',key:'API key ไม่ถูกต้องหรือไม่มีสิทธิ์ข้อมูลนี้',invalid:'ผู้ให้บริการยังไม่มีราคาที่ตรวจสอบได้',provider:'ผู้ให้บริการไม่พร้อม'}[error.message]||'เชื่อมต่อแหล่งราคาไม่ได้';
        if(!closed)db.prepare('UPDATE stock_quotes SET error=? WHERE symbol=?').run(message,symbol);
      }
    })().finally(()=>pending.delete(symbol));
    pending.set(symbol,job);return job;
  }
  async function get(symbols){
    const selected=[...new Set(symbols)].filter(s=>allowed.has(s));
    await Promise.all(selected.map(refresh));
    if(closed)return {configured:!!apiKey,items:[]};
    return {configured:!!apiKey,provider:'Finnhub',minimumRefreshSeconds:60,items:selected.map(symbol=>{
      const row=db.prepare('SELECT * FROM stock_quotes WHERE symbol=?').get(symbol),quote=row?.data?JSON.parse(row.data):null;
      return {symbol,quote,error:row?.error??null,stale:!apiKey||!quote||!!row?.error||now()-Date.parse(quote.fetchedAt)>60000,olderPrice:!!quote&&now()-Date.parse(quote.quoteAt)>15*60*1000,retryAt:row?new Date(row.attempted_at+60000).toISOString():null};
    })};
  }
  return {get,close(){closed=true;}};
}
