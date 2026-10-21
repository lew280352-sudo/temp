import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { companies } from './dist/catalog.js';
import { feeds, verifiedFeeds, createNewsService } from './feeds.mjs';
import {marketFeeds} from './market-news.mjs';
import { createQuoteService } from './quotes.mjs';
import {createForecastService} from './forecast.mjs';
import { createAiRouter, createAiService } from './ai.mjs';
import {createResearchService,validateResearchSymbol,validateResearchMonths} from './research.mjs';
import {newTotpSecret,verifyTotp,encryptSecret,decryptSecret} from './security.mjs';
import {createPushService} from './push.mjs';
import {createEmailVerification} from './email-verification.mjs';
import {createLoginOtp} from './login-otp.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const deriveKey = promisify(scrypt);
const SESSION_AGE = 12 * 60 * 60 * 1000;
const symbols = new Set(companies.map(c=>c.symbol));
export function initialState(includeMarket=false) {
  return {watchlist:[],alerts:{daily:true,news:true,trend:true,time:'08:00',scope:'watchlist'},sources:[...feeds,...(includeMarket?marketFeeds:[])].map(f=>({id:f.id,name:f.name,url:f.url,type:f.type||'company',symbol:f.symbol,enabled:true}))};
}
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
function fail(status,message){throw new HttpError(status,message);}
export function normalizeSourceUrl(value){
  if(typeof value!=='string'||value.length>2048)fail(400,'URL ยาวเกินไปหรือรูปแบบไม่ถูกต้อง');
  let url;try{url=new URL(value.trim());}catch{fail(400,'กรุณากรอก URL เต็ม เช่น https://example.com/news');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.hostname.includes('.')||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.hostname.includes(':'))fail(400,'ใช้ URL เว็บไซต์สาธารณะแบบ http หรือ https โดยไม่มีรหัสผ่านในลิงก์');
  url.hash='';return url.href;
}
function validateState(input){
  if(!input||!Array.isArray(input.watchlist)||input.watchlist.length>symbols.size)fail(400,'รายการบริษัทที่ติดตามไม่ถูกต้อง');
  const seen=new Set(),watchlist=input.watchlist.map(value=>{
    const symbol=typeof value==='string'?value.trim().toUpperCase():'';
    if(!symbols.has(symbol)||seen.has(symbol))fail(400,'รายการบริษัทที่ติดตามไม่ถูกต้อง');
    seen.add(symbol);return symbol;
  });
  const a=input.alerts;
  if(!a||!['daily','news','trend'].every(k=>typeof a[k]==='boolean')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)||!['watchlist','all'].includes(a.scope))fail(400,'การตั้งค่าแจ้งเตือนไม่ถูกต้อง');
  if(!Array.isArray(input.sources)||input.sources.length>100)fail(400,'บันทึกแหล่งข้อมูลได้สูงสุด 100 เว็บไซต์');
  const urls=new Set(),ids=new Set();
  const sources=input.sources.map(s=>{
    if(!s||typeof s.id!=='string'||!s.id||s.id.length>80||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!['company','partner','finance'].includes(s.type)||!(s.symbol===''||symbols.has(s.symbol))||typeof s.enabled!=='boolean')fail(400,'ข้อมูลเว็บไซต์ไม่ถูกต้อง');
    const url=normalizeSourceUrl(s.url);if(urls.has(url))fail(400,'มี URL นี้ในรายการแล้ว');urls.add(url);ids.add(s.id);
    const approved=verifiedFeeds.find(feed=>feed.url===url);
    return {id:s.id,name:approved?.name||s.name.trim(),url,type:approved?'finance':s.type,symbol:approved?'':s.symbol,enabled:s.enabled};
  });
  return {watchlist,alerts:{daily:a.daily,news:a.news,trend:a.trend,time:a.time,scope:a.scope},sources};
}
async function body(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))fail(415,'ต้องส่งข้อมูล JSON');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>65536)fail(413,'ข้อมูลใหญ่เกินไป');chunks.push(chunk);}
  try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'ข้อมูล JSON ต้องเป็น object');return data;}catch{fail(400,'ข้อมูล JSON ไม่ถูกต้อง');}
}
async function passwordHash(password,salt){return deriveKey(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
const tokenHash=token=>createHash('sha256').update(token).digest('hex');
function tokenFrom(req){return (req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('stocklens_session='))?.slice(18)||'';}

export function createApp({databasePath=path.join(root,'.data','stocklens.sqlite'),secureCookies=false,publicOrigin=null,refreshNews=false,newsFetcher=fetch,quoteApiKey='',quoteFetcher=fetch,researchFetcher=fetch,historyApiKey='',historyFetcher=fetch,aiEnabled=false,aiProvider='ollama',aiBaseUrl='http://127.0.0.1:11434',aiApiKey='',aiModel,aiFallbackModel='qwen3:8b',aiFetcher=fetch,mfaKeyHex='',pushPublicKey='',pushPrivateKey='',pushSubject='',pushSender,emailOrigin='',smtpHost='',smtpPort=587,smtpUser='',smtpPass='',smtpFrom='',emailSender,emailLoginEnabled=false}={}){
  if(mfaKeyHex&&!/^[a-f0-9]{64}$/i.test(mfaKeyHex))throw new Error('MFA_ENCRYPTION_KEY must be 64 hex characters');
  const mfaKey=mfaKeyHex?Buffer.from(mfaKeyHex,'hex'):null;
  if(publicOrigin){
    let url;try{url=new URL(publicOrigin);}catch{throw new Error('APP_ORIGIN must be an http(s) origin');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('APP_ORIGIN must contain only scheme, hostname and optional port');
    publicOrigin=url.origin;secureCookies=url.protocol==='https:';
  }
  if(databasePath!==':memory:')mkdirSync(path.dirname(databasePath),{recursive:true});
  const db=new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS user_state(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);`);
  if(!db.prepare('PRAGMA table_info(user_state)').all().some(column=>column.name==='revision'))db.exec('ALTER TABLE user_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS user_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT,pending_secret TEXT,pending_until INTEGER,last_step INTEGER NOT NULL DEFAULT -1)');
  db.exec('CREATE TABLE IF NOT EXISTS market_feed_migrations(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE)');
  // Privacy migration: retain only followed company symbols from the former portfolio.
  for(const row of db.prepare('SELECT user_id,data FROM user_state').all()){
    let data;try{data=JSON.parse(row.data);}catch{continue;}
    if(Array.isArray(data.watchlist))continue;
    const watchlist=[...new Set((Array.isArray(data.holdings)?data.holdings:[]).map(item=>item?.symbol).filter(symbol=>symbols.has(symbol)))];
    const alerts={...initialState().alerts,...data.alerts,scope:data.alerts?.scope==='all'?'all':'watchlist'};
    const migrated={watchlist,alerts,sources:Array.isArray(data.sources)?data.sources:initialState().sources};
    db.prepare('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(migrated),row.user_id);
  }
  if(quoteApiKey){
    for(const row of db.prepare('SELECT user_id,data FROM user_state WHERE user_id NOT IN (SELECT user_id FROM market_feed_migrations)').all()){
      let state;try{state=JSON.parse(row.data);}catch{continue;}
      if(!Array.isArray(state.sources))continue;
      const known=new Set(state.sources.map(source=>source.url));
      for(const feed of marketFeeds)if(!known.has(feed.url)&&state.sources.length<100)state.sources.push({id:feed.id,name:feed.name,url:feed.url,type:'finance',symbol:feed.symbol,enabled:true});
      db.prepare('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(state),row.user_id);
      db.prepare('INSERT INTO market_feed_migrations VALUES(?)').run(row.user_id);
    }
  }
  const selectedFeeds=()=>{
    const urls=new Set();
    for(const row of db.prepare('SELECT data FROM user_state').all()){
      try{for(const source of JSON.parse(row.data).sources||[])if(source.enabled)urls.add(source.url);}catch{}
    }
    return verifiedFeeds.filter(feed=>urls.has(feed.url));
  };
  const news=createNewsService(db,{fetcher:newsFetcher,marketApiKey:quoteApiKey,marketFetcher:newsFetcher,selectedFeeds});
  const quotes=createQuoteService(db,{apiKey:quoteApiKey,fetcher:quoteFetcher});
  const research=createResearchService({apiKey:quoteApiKey,fetcher:researchFetcher});
  const forecast=createForecastService(db,{apiKey:historyApiKey,fetcher:historyFetcher});
  const push=createPushService(db,{publicKey:pushPublicKey,privateKey:pushPrivateKey,subject:pushSubject,...(pushSender?{sender:pushSender}:{})});
  const email=createEmailVerification(db,{origin:emailOrigin||publicOrigin||'',smtpHost,smtpPort,smtpUser,smtpPass,smtpFrom,...(emailSender?{sender:emailSender}:{})});
  const loginOtp=createLoginOtp(db,{enabled:emailLoginEnabled,smtpHost,smtpPort,smtpUser,smtpPass,smtpFrom,...(emailSender?{sender:emailSender}:{})});
  const ai=aiProvider==='hybrid'?createAiRouter(
    createAiService(db,{enabled:aiEnabled,provider:'groq',apiKey:aiApiKey,model:aiModel,fetcher:aiFetcher}),
    createAiService(db,{enabled:aiEnabled,provider:'ollama',baseUrl:aiBaseUrl,model:aiFallbackModel,fetcher:aiFetcher})
  ):createAiService(db,{enabled:aiEnabled,provider:aiProvider,baseUrl:aiBaseUrl,apiKey:aiApiKey,model:aiModel,fetcher:aiFetcher});
  let newsTimer;
  const newRecoveryCode=()=>randomBytes(24).toString('hex');
  const attempts=new Map();
  const researchAttempts=new Map();
  function limitResearch(user){
    const now=Date.now(),entry=researchAttempts.get(user.id)||{count:0,until:now+15*60*1000};
    if(now>=entry.until){entry.count=0;entry.until=now+15*60*1000;}
    entry.count++;researchAttempts.set(user.id,entry);
    if(researchAttempts.size>1000)for(const [id,item] of researchAttempts)if(now>=item.until)researchAttempts.delete(id);
    if(entry.count>8)fail(429,'ค้นข่าวบ่อยเกินไป กรุณารอ 15 นาที');
  }
  const cookie=(token,age)=>`stocklens_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies?'; Secure':''}`;
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
  const userData=user=>{const row=user?db.prepare('SELECT data,revision FROM user_state WHERE user_id=?').get(user.id):null;return {user,state:row?JSON.parse(row.data):null,revision:row?.revision??null};};
  function currentUser(req){
    const token=tokenFrom(req);if(!/^[a-f0-9]{64}$/.test(token))return null;
    return db.prepare('SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(token),Date.now())||null;
  }
  function limit(req,email){
    const now=Date.now(),ip=req.socket.remoteAddress||'unknown';
    for(const [key,item] of attempts)if(now>=item.until)attempts.delete(key);
    // Shared networks need headroom; repeated attempts at one account remain limited.
    for(const [key,maximum] of [[`ip:${ip}`,200],[`account:${ip}:${email.slice(0,254)}`,10]]){
      const entry=attempts.get(key)||{count:0,until:now+15*60*1000};entry.count++;attempts.set(key,entry);
      if(entry.count>maximum)fail(429,'ลองสมัครหรือเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที');
    }
  }
  async function checkPassword(user,password){
    if(typeof password!=='string'||password.length>128)fail(401,'รหัสผ่านไม่ถูกต้อง');
    const row=db.prepare('SELECT salt,password_hash FROM users WHERE id=?').get(user.id);
    if(!row)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const hash=await passwordHash(password,row.salt);
    if(!timingSafeEqual(hash,Buffer.from(row.password_hash,'hex'))||db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)?.password_hash!==row.password_hash)fail(401,'รหัสผ่านไม่ถูกต้อง');
  }
  function checkMfa(userId,code,{consume=false}={}){
    const row=db.prepare('SELECT secret,last_step FROM user_mfa WHERE user_id=?').get(userId);
    if(!row?.secret)return true;
    if(!mfaKey)fail(503,'เซิร์ฟเวอร์ไม่มีคีย์ MFA กรุณาติดต่อผู้ดูแล');
    const step=verifyTotp(decryptSecret(row.secret,mfaKey),code,{lastStep:row.last_step});
    if(step===null)fail(401,'รหัส MFA ไม่ถูกต้องหรือถูกใช้แล้ว');
    if(consume&&!db.prepare('UPDATE user_mfa SET last_step=? WHERE user_id=? AND last_step<?').run(step,userId,step).changes)fail(401,'รหัส MFA ถูกใช้แล้ว');
    return true;
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try{
      const allowed=publicOrigin?[new URL(publicOrigin).host]:[`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`];
      if(!allowed.includes(req.headers.host))fail(403,'Host ไม่ได้รับอนุญาต');
      const origin=publicOrigin||`http://${req.headers.host}`;
      if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)fail(403,'คำขอไม่ได้มาจากเว็บไซต์นี้');
      const pathname=new URL(req.url,origin).pathname;
      if(pathname==='/api/health'&&req.method==='GET'){db.prepare('SELECT 1').get();return send(res,200,{ok:true,version:'0.9.2'});}
      if(pathname==='/api/ai/status'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const result=await ai.status();
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res,200,result);
      }
      if(pathname==='/api/quotes'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const watchlist=userData(user).state.watchlist;
        const result=await quotes.get(watchlist);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const currentSymbols=new Set(userData(user).state.watchlist);
        return send(res,200,{...result,items:result.items.filter(item=>currentSymbols.has(item.symbol))});
      }
      if(pathname==='/api/forecast'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const symbol=new URL(req.url,origin).searchParams.get('symbol')?.trim().toUpperCase()||'';
        if(!symbols.has(symbol))fail(400,'ไม่รองรับหุ้นนี้');
        const result=await forecast.get(symbol);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res,200,result);
      }
      if(pathname==='/api/news'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const preferences=userData(user).state;
        await news.refreshFor(preferences.sources.filter(source=>source.enabled).map(source=>source.url),preferences.watchlist);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const snapshot=news.snapshot(),sources=userData(user).state.sources;
        const enabled=new Set(snapshot.sources.filter(feed=>sources.some(source=>source.enabled&&source.url.replace(/\/$/,'')===feed.url.replace(/\/$/,''))).map(feed=>feed.id));
        return send(res,200,{...snapshot,items:snapshot.items.filter(item=>enabled.has(item.feedId)),sources:snapshot.sources.filter(feed=>sources.some(source=>source.url.replace(/\/$/,'')===feed.url.replace(/\/$/,''))).map(feed=>({...feed,enabled:enabled.has(feed.id)}))});
      }
      if(pathname==='/api/research/companies'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const query=new URL(req.url,origin).searchParams.get('q')||'';
        if(query.trim().length<2||query.length>80)fail(400,'กรอกชื่อบริษัทหรือ ticker 2 ถึง 80 ตัวอักษร');
        limitResearch(user);
        const items=await research.companies(query);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res,200,{items});
      }
      if(pathname==='/api/research'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);
        let symbol,months;
        try{symbol=validateResearchSymbol(input.symbol);months=validateResearchMonths(input.months);}catch(error){fail(400,error.message);}
        const name=typeof input.name==='string'?input.name.trim().slice(0,120):'';
        if(!name||name.length<2)fail(400,'กรุณาเลือกบริษัทจากผลค้นหา');
        limitResearch(user);
        const result=await research.news(symbol,name,months);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        let summary=null,aiError='';
        if(result.articles.length){
          try{summary=await ai.summarize(symbol,result.articles);}catch(error){aiError=error.code==='not_configured'?'ยังไม่ได้ตั้งค่า Groq API key':error.code==='disabled'?'AI ยังไม่เปิดใช้งาน':'AI สรุปไม่ได้ในขณะนี้ กรุณาลองใหม่';}
        }
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res,200,{...result,summary,aiError});
      }
      if(pathname==='/api/ai/summary'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req),symbol=typeof input.symbol==='string'?input.symbol.trim().toUpperCase():'';
        if(!symbols.has(symbol))fail(400,'ไม่รองรับหุ้นนี้');
        const snapshot=news.snapshot(),sources=userData(user).state.sources;
        const enabled=new Set(snapshot.sources.filter(feed=>sources.some(source=>source.enabled&&source.url.replace(/\/$/,'')===feed.url.replace(/\/$/,''))).map(feed=>feed.id));
        let result;try{result=await ai.summarize(symbol,snapshot.items.filter(item=>enabled.has(item.feedId)));}
        catch(error){
          if(error.code==='disabled')fail(503,'AI ยังไม่เปิดใช้');
          if(error.code==='not_configured')fail(503,'ยังไม่ได้ตั้งค่า Groq API key');
          if(error.code==='no_news')fail(422,'ยังไม่มีหัวข้อข่าวสำหรับหุ้นนี้ กรุณาเปิดแหล่งข่าวที่เกี่ยวข้อง');
          if(error.code==='providers_unavailable')fail(503,'Groq และ Ollama ยังไม่พร้อม ตรวจโควตา อินเทอร์เน็ต และ Ollama');
          fail(503,aiProvider==='groq'?'ติดต่อ Groq AI ไม่สำเร็จ ตรวจ API key โควตา และอินเทอร์เน็ต':'ติดต่อ AI ในเครื่องไม่สำเร็จ ตรวจว่าเปิด Ollama และติดตั้งโมเดลแล้ว');
        }
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res,200,result);
      }
      if(pathname==='/api/session'&&req.method==='GET'){
        return send(res,200,userData(currentUser(req)));
      }
      if(pathname==='/api/register'&&req.method==='POST'){
        const input=await body(req);
        const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
        limit(req,email);
        const name=typeof input.name==='string'?input.name.trim():'';
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>80||typeof input.password!=='string'||input.password.length<10||input.password.length>128)fail(400,'กรอกชื่อ อีเมล และรหัสผ่าน 10–128 ตัวอักษรให้ถูกต้อง');
        const salt=randomBytes(16).toString('hex'),hash=(await passwordHash(input.password,salt)).toString('hex'),id=randomUUID();
        if(db.prepare('SELECT id FROM users WHERE email=?').get(email))fail(409,'อีเมลนี้ถูกใช้แล้ว กรุณาเข้าสู่ระบบ');
        const recoveryCode=newRecoveryCode();
        db.exec('BEGIN');try{
          db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,email,name,salt,hash,Date.now());
          db.prepare('INSERT INTO user_state(user_id,data) VALUES(?,?)').run(id,JSON.stringify(initialState(!!quoteApiKey)));
          if(quoteApiKey)db.prepare('INSERT INTO market_feed_migrations VALUES(?)').run(id);
          db.prepare('INSERT INTO recovery_codes VALUES(?,?)').run(id,tokenHash(recoveryCode));db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        return send(res,201,{message:'สร้างบัญชีแล้ว กรุณาเข้าสู่ระบบ',recoveryCode});
      }
      if(pathname==='/api/recover'&&req.method==='POST'){
        const input=await body(req),email=typeof input.email==='string'?input.email.trim().toLowerCase():'';limit(req,email);
        if(typeof input.password!=='string'||input.password.length<10||input.password.length>128)fail(400,'รหัสผ่านใหม่ต้องยาว 10–128 ตัวอักษร');
        const user=db.prepare('SELECT u.id,r.code_hash FROM users u JOIN recovery_codes r ON r.user_id=u.id WHERE u.email=?').get(email);
        const supplied=typeof input.code==='string'?input.code.trim().toLowerCase():'';
        if(!user||!timingSafeEqual(Buffer.from(tokenHash(supplied),'hex'),Buffer.from(user.code_hash,'hex')))fail(401,'อีเมลหรือรหัสกู้คืนไม่ถูกต้อง');
        const salt=randomBytes(16).toString('hex'),hash=(await passwordHash(input.password,salt)).toString('hex'),recoveryCode=newRecoveryCode();
        db.exec('BEGIN');try{
          const changed=db.prepare('UPDATE recovery_codes SET code_hash=? WHERE user_id=? AND code_hash=?').run(tokenHash(recoveryCode),user.id,user.code_hash);
          if(!changed.changes)fail(401,'รหัสกู้คืนนี้ถูกใช้แล้ว');
          db.prepare('UPDATE users SET salt=?,password_hash=? WHERE id=?').run(salt,hash,user.id);
          db.prepare('DELETE FROM user_mfa WHERE user_id=?').run(user.id);
          db.prepare('DELETE FROM login_otp WHERE user_id=?').run(user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        res.setHeader('Set-Cookie',cookie('',0));return send(res,200,{ok:true,recoveryCode});
      }
      if(pathname==='/api/recovery-code'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);limit(req,user.email);
        if(typeof input.password!=='string'||input.password.length>128)fail(401,'รหัสผ่านไม่ถูกต้อง');
        const row=db.prepare('SELECT salt,password_hash FROM users WHERE id=?').get(user.id);
        const hash=await passwordHash(input.password,row.salt);
        if(!timingSafeEqual(hash,Buffer.from(row.password_hash,'hex'))||currentUser(req)?.id!==user.id)fail(401,'รหัสผ่านไม่ถูกต้องหรือเซสชันหมดอายุ');
        const recoveryCode=newRecoveryCode();db.prepare('INSERT INTO recovery_codes VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash').run(user.id,tokenHash(recoveryCode));
        return send(res,200,{recoveryCode});
      }
      if(pathname==='/api/security'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const row=db.prepare('SELECT secret FROM user_mfa WHERE user_id=?').get(user.id);
        return send(res,200,{mfaEnabled:!!row?.secret,mfaAvailable:!!mfaKey,emailLoginEnabled:loginOtp.enabled,...email.status(user.id)});
      }
      if(pathname==='/api/email/send-verification'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        await body(req);limit(req,user.email);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        try{return send(res,200,await email.request(user));}
        catch(error){fail(error.message==='Email verification is not configured'?503:error.message==='Wait before requesting another email'?429:503,'ยังส่งอีเมลไม่ได้ ตรวจการตั้งค่า SMTP หรือรอสักครู่');}
      }
      if(pathname==='/api/email/verify'&&req.method==='POST'){
        const input=await body(req);limit(req,'email-verification');
        if(!email.verify(input.token))fail(400,'ลิงก์ไม่ถูกต้อง หมดอายุ หรือใช้แล้ว');
        return send(res,200,{ok:true});
      }
      if(pathname==='/api/push/status'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        return send(res,200,push.status(user.id));
      }
      if(pathname==='/api/push/subscribe'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);
        if(!currentUser(req)||currentUser(req).id!==user.id)fail(401,'เซสชันหมดอายุ');
        try{return send(res,200,push.subscribe(user.id,input));}
        catch(error){fail(error.message==='Push is not configured'?503:400,'ข้อมูล Push ไม่ถูกต้องหรือยังไม่ได้ตั้งค่า');}
      }
      if(pathname==='/api/push/unsubscribe'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);
        push.unsubscribe(user.id,input.endpoint);
        return send(res,200,{ok:true});
      }
      if(pathname==='/api/push/test'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        await body(req);limit(req,user.email);
        if(!currentUser(req)||currentUser(req).id!==user.id)fail(401,'เซสชันหมดอายุ');
        if(!push.configured)fail(503,'Push ยังไม่พร้อม');
        const result=await push.test(user.id);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res,200,result);
      }
      if(pathname==='/api/mfa/setup'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        if(!mfaKey)fail(503,'ผู้ดูแลยังไม่ได้ตั้งค่า MFA_ENCRYPTION_KEY');
        const input=await body(req);limit(req,user.email);await checkPassword(user,input.password);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        if(db.prepare('SELECT secret FROM user_mfa WHERE user_id=?').get(user.id)?.secret)fail(409,'เปิด MFA อยู่แล้ว');
        const secret=newTotpSecret(),encrypted=encryptSecret(secret,mfaKey);
        db.prepare('INSERT INTO user_mfa(user_id,pending_secret,pending_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_until=excluded.pending_until').run(user.id,encrypted,Date.now()+10*60*1000);
        const url=`otpauth://totp/${encodeURIComponent('StockLens:'+user.email)}?secret=${secret}&issuer=StockLens&algorithm=SHA1&digits=6&period=30`;
        return send(res,200,{secret,url,expiresMinutes:10});
      }
      if(pathname==='/api/mfa/enable'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);limit(req,user.email);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const row=db.prepare('SELECT secret,pending_secret,pending_until FROM user_mfa WHERE user_id=?').get(user.id);
        if(!row?.pending_secret||row.secret||Date.now()>row.pending_until)fail(400,'เริ่มตั้งค่า MFA ใหม่');
        if(!mfaKey)fail(503,'เซิร์ฟเวอร์ไม่มีคีย์ MFA');
        const step=verifyTotp(decryptSecret(row.pending_secret,mfaKey),input.code);
        if(step===null)fail(401,'รหัส MFA ไม่ถูกต้อง');
        db.exec('BEGIN');try{
          db.prepare('UPDATE user_mfa SET secret=pending_secret,pending_secret=NULL,pending_until=NULL,last_step=? WHERE user_id=?').run(step,user.id);
          db.prepare('DELETE FROM login_otp WHERE user_id=?').run(user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,tokenHash(tokenFrom(req)));
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        return send(res,200,{ok:true});
      }
      if(pathname==='/api/mfa/disable'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);limit(req,user.email);await checkPassword(user,input.password);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        if(!db.prepare('SELECT secret FROM user_mfa WHERE user_id=?').get(user.id)?.secret)fail(409,'ยังไม่ได้เปิด MFA');
        checkMfa(user.id,input.code,{consume:true});
        db.exec('BEGIN');try{
          db.prepare('DELETE FROM user_mfa WHERE user_id=?').run(user.id);
          db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(user.id,tokenHash(tokenFrom(req)));
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        return send(res,200,{ok:true});
      }
      if(pathname==='/api/login'&&req.method==='POST'){
        const input=await body(req),email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
        limit(req,email);
        if(typeof input.password!=='string'||input.password.length>128)fail(401,'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const hash=await passwordHash(input.password,user?.salt||'0'.repeat(32));
        if(!user||!timingSafeEqual(hash,Buffer.from(user.password_hash,'hex'))||db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)?.password_hash!==user.password_hash)fail(401,'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        if(db.prepare('SELECT secret FROM user_mfa WHERE user_id=?').get(user.id)?.secret){
          if(!input.totp)return send(res,202,{factor:'authenticator'});
          checkMfa(user.id,input.totp,{consume:true});
        }else if(loginOtp.enabled){
          try{return send(res,202,await loginOtp.request(user));}
          catch(error){fail(error.message==='Wait before requesting another login code'?429:503,'ส่งรหัสเข้าสู่อีเมลไม่ได้ กรุณาตรวจการตั้งค่า SMTP หรือรอ 1 นาที');}
        }
        db.prepare('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?').run(Date.now(),tokenHash(tokenFrom(req)));
        const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),user.id,Date.now()+SESSION_AGE);
        res.setHeader('Set-Cookie',cookie(token,SESSION_AGE/1000));
        return send(res,200,userData({id:user.id,name:user.name,email:user.email}));
      }
      if(pathname==='/api/login/verify'&&req.method==='POST'){
        const input=await body(req);limit(req,'email-login');
        const userId=loginOtp.verify(input.challengeId,input.code);
        if(!userId)fail(401,'รหัสอีเมลไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว');
        const user=db.prepare('SELECT id,name,email FROM users WHERE id=?').get(userId);
        if(!user)fail(401,'บัญชีนี้ไม่พร้อมใช้งาน');
        if(db.prepare('SELECT secret FROM user_mfa WHERE user_id=?').get(user.id)?.secret)fail(401,'บัญชีนี้ต้องใช้รหัส Authenticator');
        db.prepare('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?').run(Date.now(),tokenHash(tokenFrom(req)));
        const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),user.id,Date.now()+SESSION_AGE);
        res.setHeader('Set-Cookie',cookie(token,SESSION_AGE/1000));
        return send(res,200,userData(user));
      }
      if(pathname==='/api/logout'&&req.method==='POST'){
        await body(req);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(tokenFrom(req)));res.setHeader('Set-Cookie',cookie('',0));return send(res,200,{ok:true});
      }
      if(pathname==='/api/account/delete'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);limit(req,user.email);await checkPassword(user,input.password);
        if(currentUser(req)?.id!==user.id)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        if(input.confirm!==user.email)fail(400,'กรอกอีเมลให้ตรงกับบัญชีเพื่อยืนยันการลบ');
        checkMfa(user.id,input.totp,{consume:true});
        db.prepare('DELETE FROM users WHERE id=?').run(user.id);
        res.setHeader('Set-Cookie',cookie('',0));
        return send(res,200,{ok:true});
      }
      if(pathname==='/api/state'&&req.method==='PUT'){
        if(!currentUser(req))fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const input=await body(req);
        const user=currentUser(req);if(!user)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        if(input.userId!==user.id)fail(409,'บัญชีเปลี่ยนไป กรุณาเข้าสู่ระบบใหม่ก่อนบันทึก');
        if(!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'เวอร์ชันข้อมูลไม่ถูกต้อง');
        const state=validateState(input.state);
        const previous=userData(user).state;
        if(quoteApiKey)for(const symbol of state.watchlist){
          if(previous.watchlist.includes(symbol))continue;
          const feed=marketFeeds.find(item=>item.symbol===symbol);
          if(feed&&state.sources.length<100&&!state.sources.some(source=>source.url===feed.url))state.sources.push({id:randomUUID(),name:feed.name,url:feed.url,type:'finance',symbol,enabled:true});
        }
        const result=db.prepare('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=? AND revision=?').run(JSON.stringify(state),user.id,input.revision);
        if(!result.changes)fail(409,'ข้อมูลเปลี่ยนจากแท็บอื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง');
        return send(res,200,{ok:true,state,revision:input.revision+1});
      }
      if(pathname==='/api/export'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบก่อนส่งออกข้อมูล');
        res.setHeader('Content-Disposition','attachment; filename="stocklens-data.json"');
        return send(res,200,{format:'stocklens-export-v1',exportedAt:new Date().toISOString(),...userData(user)});
      }
      if(pathname.startsWith('/api/'))fail(404,'ไม่พบ API นี้');
      if(companies.some(company=>company.icon===pathname)&&['GET','HEAD'].includes(req.method)){
        const type=pathname.endsWith('.png')?'image/png':pathname.endsWith('.webp')?'image/webp':pathname.endsWith('.gif')?'image/gif':pathname.endsWith('.bmp')?'image/bmp':'image/x-icon';
        const data=readFileSync(path.join(root,'dist',pathname.slice(1)));
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=86400'});
        return res.end(req.method==='HEAD'?undefined:data);
      }
      const assets={'/quotes-ui.js':['quotes-ui.js','text/javascript'],'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/verify-email.html':['verify-email.html','text/html'],'/verify-email.js':['verify-email.js','text/javascript'],'/app.js':['app.js','text/javascript'],'/research-ui.js':['research-ui.js','text/javascript'],'/auth.js':['auth.js','text/javascript'],'/security-ui.js':['security-ui.js','text/javascript'],'/push-ui.js':['push-ui.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/theme.css':['theme.css','text/css'],'/logo.css':['logo.css','text/css'],'/features.css':['features.css','text/css'],'/catalog.js':['catalog.js','text/javascript'],'/company-icons.js':['company-icons.js','text/javascript'],'/pwa.js':['pwa.js','text/javascript'],'/sw.js':['sw.js','text/javascript'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],'/offline.html':['offline.html','text/html'],'/icon.svg':['icon.svg','image/svg+xml'],'/icon-192.png':['icon-192.png','image/png'],'/icon-512.png':['icon-512.png','image/png'],'/apple-touch-icon.png':['apple-touch-icon.png','image/png']};
      const asset=assets[pathname];if(!asset||!['GET','HEAD'].includes(req.method))fail(404,'ไม่พบหน้าเว็บ');
      const data=readFileSync(path.join(root,'dist',asset[0]));res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){send(res,error.status||500,{error:error.status?error.message:'ระบบขัดข้อง กรุณาลองใหม่'});if(!error.status)console.error(error.message);}
  });
  server.requestTimeout=130000;server.headersTimeout=10000;
  if(refreshNews){server.once('listening',()=>{const cycle=()=>news.refresh().then(()=>push.deliver(news.snapshot())).catch(()=>{});cycle();newsTimer=setInterval(cycle,15*60*1000);newsTimer.unref();});}
  server.on('close',()=>{clearInterval(newsTimer);news.close();quotes.close();forecast.close();ai.close();email.close();loginOtp.close();db.close();});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.APP_ORIGIN)throw new Error('Set APP_ORIGIN before listening beyond localhost');
  const groqApiKey=process.env.GROQ_API_KEY?.trim()||'',configuredProvider=(process.env.AI_PROVIDER||'auto').trim().toLowerCase(),aiProvider=configuredProvider==='auto'?(groqApiKey?'hybrid':'ollama'):configuredProvider;
  const server=createApp({databasePath:process.env.DATABASE_PATH?path.resolve(process.env.DATABASE_PATH):undefined,publicOrigin:process.env.APP_ORIGIN||null,refreshNews:process.env.NEWS_ENABLED!=='false',quoteApiKey:process.env.FINNHUB_API_KEY?.trim()||'',historyApiKey:process.env.ALPHAVANTAGE_API_KEY?.trim()||'',aiEnabled:process.env.AI_ENABLED!=='false',aiProvider,aiBaseUrl:process.env.OLLAMA_URL||'http://127.0.0.1:11434',aiApiKey:groqApiKey,aiModel:['groq','hybrid'].includes(aiProvider)?(process.env.GROQ_MODEL||'qwen/qwen3.8-27b'):(process.env.OLLAMA_MODEL||'qwen3:8b'),aiFallbackModel:process.env.OLLAMA_MODEL||'qwen3:8b',mfaKeyHex:process.env.MFA_ENCRYPTION_KEY?.trim()||'',pushPublicKey:process.env.VAPID_PUBLIC_KEY?.trim()||'',pushPrivateKey:process.env.VAPID_PRIVATE_KEY?.trim()||'',pushSubject:process.env.VAPID_SUBJECT?.trim()||'',emailOrigin:process.env.APP_ORIGIN||`http://127.0.0.1:${port}`,smtpHost:process.env.SMTP_HOST?.trim()||'',smtpPort:Number(process.env.SMTP_PORT||587),smtpUser:process.env.SMTP_USER?.trim()||'',smtpPass:process.env.SMTP_PASS?.trim()||'',smtpFrom:process.env.SMTP_FROM?.trim()||'',emailLoginEnabled:process.env.EMAIL_LOGIN_OTP_ENABLED==='true'});
  server.listen(port,host,()=>console.log(`StockLens: http://${host}:${server.address().port}`));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`พอร์ต ${port} ถูกใช้อยู่แล้ว ตั้งค่า PORT เป็นหมายเลขอื่น`:error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeIdleConnections();});
}
