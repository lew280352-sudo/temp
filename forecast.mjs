import {companies} from './dist/catalog.js';

const symbols=new Set(companies.map(company=>company.symbol));
const MAX_BYTES=1024*1024;
const DAY=86400000;

export function parseWeeklyPrices(payload,symbol){
  const series=payload?.['Weekly Adjusted Time Series'];
  if(!series||typeof series!=='object'||Array.isArray(series))throw new Error('provider');
  const prices=Object.entries(series).filter(([date,row])=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&Number.isFinite(Number(row?.['5. adjusted close']))&&Number(row['5. adjusted close'])>0)
    .map(([date,row])=>({date,close:Number(row['5. adjusted close'])})).sort((a,b)=>a.date.localeCompare(b.date));
  if(prices.length<104)throw new Error('provider');
  return {symbol,provider:'Alpha Vantage',adjustment:'split and dividend adjusted',interval:'weekly',prices};
}

// Alpha Vantage includes a candle for the current, unfinished week.
function completedWeekCutoff(now){
  const date=new Date(now),day=date.getUTCDay();
  date.setUTCHours(0,0,0,0);
  if(day!==0&&day!==6)date.setUTCDate(date.getUTCDate()-(day+6)%7);
  return date.toISOString().slice(0,10);
}

// Fixed four-week momentum rule against the next completed weekly close.
// Evaluate only the recent five years, without tuning the rule on the test set.
export function evaluateTrend(prices,{now=Date.now()}={}){
  const cutoff=completedWeekCutoff(now);
  const rows=prices.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&row.date<cutoff&&Number.isFinite(row.close)&&row.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  if(rows.length<104)return {status:'insufficient',required:104,available:rows.length,interval:'weekly'};
  const latest=rows.at(-1),previous=rows.at(-5);
  const observedTrend=latest.close>=previous.close?'up':'down';
  const start=new Date(latest.date+'T00:00:00Z');start.setUTCFullYear(start.getUTCFullYear()-5);
  const startDate=start.toISOString().slice(0,10);
  const tests=[];
  for(let i=4;i+1<rows.length;i++){
    if(rows[i].date<startDate)continue;
    const predicted=rows[i].close>=rows[i-4].close?'up':'down';
    const actual=rows[i+1].close>=rows[i].close?'up':'down';
    tests.push({predicted,actual});
  }
  const correct=tests.filter(test=>test.predicted===test.actual).length;
  const baseline=tests.filter(test=>test.actual==='up').length;
  const accuracy=tests.length?correct/tests.length:0,baselineAccuracy=tests.length?baseline/tests.length:0;
  const passed=tests.length>=100&&accuracy>=0.6&&accuracy>baselineAccuracy;
  return {status:passed?'validated':'unvalidated',direction:passed?observedTrend:null,observedTrend,
    horizonWeeks:1,lookbackWeeks:4,interval:'weekly',adjustment:'split and dividend adjusted',historyWeeks:rows.length,
    asOf:latest.date,latestClose:latest.close,
    backtest:{samples:tests.length,correct,accuracy,baselineAccuracy,method:'walk-forward, next completed week, recent five years',startDate},
    caveat:'แนวโน้มที่เกิดขึ้นแล้วไม่ใช่การคาดการณ์ ผลทดสอบย้อนหลังไม่รับประกันผลในอนาคต'};
}

export function createForecastService(db,{apiKey='',fetcher=fetch,now=Date.now}={}){
  db.exec('CREATE TABLE IF NOT EXISTS weekly_history(symbol TEXT PRIMARY KEY,data TEXT,attempted_at INTEGER NOT NULL,error TEXT)');
  const pending=new Map();let closed=false;
  async function refresh(symbol){
    if(!apiKey||closed)return;
    if(pending.has(symbol))return pending.get(symbol);
    const previous=db.prepare('SELECT attempted_at FROM weekly_history WHERE symbol=?').get(symbol);
    if(previous&&now()-previous.attempted_at<24*60*60*1000)return;
    db.prepare('INSERT INTO weekly_history VALUES(?,NULL,?,NULL) ON CONFLICT(symbol) DO UPDATE SET attempted_at=excluded.attempted_at').run(symbol,now());
    const job=(async()=>{
      try{
        const url=new URL('https://www.alphavantage.co/query');
        url.searchParams.set('function','TIME_SERIES_WEEKLY_ADJUSTED');url.searchParams.set('symbol',symbol);url.searchParams.set('apikey',apiKey);
        const response=await fetcher(url.href,{redirect:'error',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error(response.status===429?'quota':'provider');
        if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw new Error('provider');}
        const reader=response.body.getReader(),chunks=[];let size=0;
        try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('provider');chunks.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
        const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(payload.Note||payload.Information)throw new Error('quota');
        const history=parseWeeklyPrices(payload,symbol);
        if(!closed)db.prepare('UPDATE weekly_history SET data=?,error=NULL WHERE symbol=?').run(JSON.stringify(history),symbol);
      }catch(error){
        if(!closed)db.prepare('UPDATE weekly_history SET error=? WHERE symbol=?').run(error.message==='quota'?'ผู้ให้บริการจำกัดโควตาหรือสิทธิ์':'ดึงราคาย้อนหลังไม่สำเร็จ',symbol);
      }
    })().finally(()=>pending.delete(symbol));
    pending.set(symbol,job);return job;
  }
  async function get(symbol){
    if(!symbols.has(symbol))throw new Error('unsupported');
    await refresh(symbol);
    const row=db.prepare('SELECT * FROM weekly_history WHERE symbol=?').get(symbol),history=row?.data?JSON.parse(row.data):null;
    if(!history)return {symbol,configured:!!apiKey,provider:'Alpha Vantage',status:'no_history',error:row?.error??null};
    const chart=history.prices.filter(point=>/^\d{4}-\d{2}-\d{2}$/.test(point.date)&&point.date<completedWeekCutoff(now())&&Number.isFinite(point.close)&&point.close>0).slice(-104);
    const result=evaluateTrend(history.prices,{now:now()});
    if(result.asOf&&now()-Date.parse(result.asOf)>14*DAY)return {symbol,configured:!!apiKey,provider:'Alpha Vantage',status:'stale',asOf:result.asOf,history:chart,error:row?.error??null};
    return {symbol,configured:!!apiKey,provider:'Alpha Vantage',...result,history:chart,error:row?.error??null};
  }
  return {get,close(){closed=true;}};
}
