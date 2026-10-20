import {companies} from './dist/catalog.js';

const symbols=new Set(companies.map(company=>company.symbol));
const MAX_BYTES=512*1024;
const DAY=86400000;

export function parseDailyPrices(payload,symbol){
  const series=payload?.['Time Series (Daily)'];
  if(!series||typeof series!=='object'||Array.isArray(series))throw new Error('provider');
  const prices=Object.entries(series).filter(([date,row])=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&Number.isFinite(Number(row?.['4. close']))&&Number(row['4. close'])>0)
    .map(([date,row])=>({date,close:Number(row['4. close'])})).sort((a,b)=>a.date.localeCompare(b.date));
  if(prices.length<20)throw new Error('provider');
  return {symbol,provider:'Alpha Vantage',adjustment:'raw',prices:prices.slice(-100)};
}

// Fixed 20-session momentum rule. Evaluation only uses past closes at each step.
// Five-session test windows do not overlap, avoiding inflated sample counts.
export function evaluateTrend(prices){
  const rows=prices.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&Number.isFinite(row.close)&&row.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.length<100)return {status:'insufficient',required:100,available:rows.length};
  for(let i=1;i<rows.length;i++)if(Math.abs(rows[i].close/rows[i-1].close-1)>0.35)return {status:'corporate_action',available:rows.length};
  const tests=[];
  for(let i=20;i+5<rows.length;i+=5){
    const predicted=rows[i].close>=rows[i-20].close?'up':'down';
    const actual=rows[i+5].close>=rows[i].close?'up':'down';
    tests.push({predicted,actual});
  }
  const correct=tests.filter(test=>test.predicted===test.actual).length;
  const baseline=tests.filter(test=>test.actual==='up').length;
  const accuracy=tests.length?correct/tests.length:0,baselineAccuracy=tests.length?baseline/tests.length:0;
  const passed=tests.length>=15&&accuracy>=0.6&&accuracy>baselineAccuracy;
  const latest=rows.at(-1),previous=rows.at(-21);
  return {status:passed?'validated':'unvalidated',direction:passed?(latest.close>=previous.close?'up':'down'):null,
    horizonSessions:5,lookbackSessions:20,asOf:latest.date,latestClose:latest.close,
    backtest:{samples:tests.length,correct,accuracy,baselineAccuracy,method:'walk-forward, non-overlapping 5-session windows'},
    caveat:'ข้อมูลราคาปิดยังไม่ปรับปันผลและ split; โมเดลแนวโน้มระยะสั้น ไม่รับประกันผล'};
}

export function createForecastService(db,{apiKey='',fetcher=fetch,now=Date.now}={}){
  db.exec('CREATE TABLE IF NOT EXISTS daily_history(symbol TEXT PRIMARY KEY,data TEXT,attempted_at INTEGER NOT NULL,error TEXT)');
  const pending=new Map();let closed=false;
  async function refresh(symbol){
    if(!apiKey||closed)return;
    if(pending.has(symbol))return pending.get(symbol);
    const previous=db.prepare('SELECT attempted_at FROM daily_history WHERE symbol=?').get(symbol);
    if(previous&&now()-previous.attempted_at<24*60*60*1000)return;
    db.prepare('INSERT INTO daily_history VALUES(?,NULL,?,NULL) ON CONFLICT(symbol) DO UPDATE SET attempted_at=excluded.attempted_at').run(symbol,now());
    const job=(async()=>{
      try{
        const url=new URL('https://www.alphavantage.co/query');
        url.searchParams.set('function','TIME_SERIES_DAILY');url.searchParams.set('symbol',symbol);url.searchParams.set('outputsize','compact');url.searchParams.set('apikey',apiKey);
        const response=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error(response.status===429?'quota':'provider');
        if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('provider');}
        const reader=response.body.getReader(),chunks=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('provider');chunks.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
        const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(payload.Note||payload.Information)throw new Error('quota');
        const history=parseDailyPrices(payload,symbol);
        if(!closed)db.prepare('UPDATE daily_history SET data=?,error=NULL WHERE symbol=?').run(JSON.stringify(history),symbol);
      }catch(error){
        if(!closed)db.prepare('UPDATE daily_history SET error=? WHERE symbol=?').run(error.message==='quota'?'ผู้ให้บริการจำกัดโควตาหรือสิทธิ์':'ดึงราคาย้อนหลังไม่สำเร็จ',symbol);
      }
    })().finally(()=>pending.delete(symbol));
    pending.set(symbol,job);return job;
  }
  async function get(symbol){
    if(!symbols.has(symbol))throw new Error('unsupported');
    await refresh(symbol);
    const row=db.prepare('SELECT * FROM daily_history WHERE symbol=?').get(symbol),history=row?.data?JSON.parse(row.data):null;
    if(!history)return {symbol,configured:!!apiKey,provider:'Alpha Vantage',status:'no_history',error:row?.error??null};
    const result=evaluateTrend(history.prices);
    if(result.asOf&&now()-Date.parse(result.asOf)>7*DAY)return {symbol,configured:!!apiKey,provider:'Alpha Vantage',status:'stale',asOf:result.asOf,error:row?.error??null};
    return {symbol,configured:!!apiKey,provider:'Alpha Vantage',...result,error:row?.error??null};
  }
  return {get,close(){closed=true;}};
}
