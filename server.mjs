import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { companies } from './dist/catalog.js';
import { feeds, createNewsService } from './feeds.mjs';
import { createQuoteService } from './quotes.mjs';
import { createAiService } from './ai.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const deriveKey = promisify(scrypt);
const SESSION_AGE = 12 * 60 * 60 * 1000;
const symbols = new Set(companies.map(c=>c.symbol));
export function initialState() {
  return {watchlist:[],alerts:{daily:true,news:true,trend:true,time:'08:00',scope:'watchlist'},sources:feeds.map(f=>({id:f.id,name:f.name,url:f.url,type:'company',symbol:f.symbol,enabled:true}))};
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
  if(!Array.isArray(input.sources)||input.sources.length>50)fail(400,'บันทึกแหล่งข้อมูลได้สูงสุด 50 เว็บไซต์');
  const urls=new Set(),ids=new Set();
  const sources=input.sources.map(s=>{
    if(!s||typeof s.id!=='string'||!s.id||s.id.length>80||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!['company','partner','finance'].includes(s.type)||!(s.symbol===''||symbols.has(s.symbol))||typeof s.enabled!=='boolean')fail(400,'ข้อมูลเว็บไซต์ไม่ถูกต้อง');
    const url=normalizeSourceUrl(s.url);if(urls.has(url))fail(400,'มี URL นี้ในรายการแล้ว');urls.add(url);ids.add(s.id);
    return {id:s.id,name:s.name.trim(),url,type:s.type,symbol:s.symbol,enabled:s.enabled};
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

export function createApp({databasePath=path.join(root,'.data','stocklens.sqlite'),secureCookies=false,publicOrigin=null,refreshNews=false,newsFetcher=fetch,quoteApiKey='',quoteFetcher=fetch,aiEnabled=false,aiBaseUrl='http://127.0.0.1:11434',aiModel='qwen3:8b',aiFetcher=fetch}={}){
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
  // Privacy migration: retain only followed company symbols from the former portfolio.
  for(const row of db.prepare('SELECT user_id,data FROM user_state').all()){
    let data;try{data=JSON.parse(row.data);}catch{continue;}
    if(Array.isArray(data.watchlist))continue;
    const watchlist=[...new Set((Array.isArray(data.holdings)?data.holdings:[]).map(item=>item?.symbol).filter(symbol=>symbols.has(symbol)))];
    const alerts={...initialState().alerts,...data.alerts,scope:data.alerts?.scope==='all'?'all':'watchlist'};
    const migrated={watchlist,alerts,sources:Array.isArray(data.sources)?data.sources:initialState().sources};
    db.prepare('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(migrated),row.user_id);
  }
  const news=createNewsService(db,{fetcher:newsFetcher});
  const quotes=createQuoteService(db,{apiKey:quoteApiKey,fetcher:quoteFetcher});
  const ai=createAiService(db,{enabled:aiEnabled,baseUrl:aiBaseUrl,model:aiModel,fetcher:aiFetcher});
  let newsTimer;
  const newRecoveryCode=()=>randomBytes(24).toString('hex');
  const attempts=new Map();
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
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try{
      const allowed=publicOrigin?[new URL(publicOrigin).host]:[`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`];
      if(!allowed.includes(req.headers.host))fail(403,'Host ไม่ได้รับอนุญาต');
      const origin=publicOrigin||`http://${req.headers.host}`;
      if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)fail(403,'คำขอไม่ได้มาจากเว็บไซต์นี้');
      const pathname=new URL(req.url,origin).pathname;
      if(pathname==='/api/health'&&req.method==='GET'){db.prepare('SELECT 1').get();return send(res,200,{ok:true,version:'0.5.0'});}
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
      if(pathname==='/api/news'&&req.method==='GET'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const snapshot=news.snapshot(),sources=userData(user).state.sources;
        const enabled=new Set(snapshot.sources.filter(feed=>sources.some(source=>source.enabled&&source.url.replace(/\/$/,'')===feed.url.replace(/\/$/,''))).map(feed=>feed.id));
        return send(res,200,{...snapshot,items:snapshot.items.filter(item=>enabled.has(item.feedId)),sources:snapshot.sources.map(feed=>({...feed,enabled:enabled.has(feed.id)}))});
      }
      if(pathname==='/api/ai/summary'&&req.method==='POST'){
        const user=currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req),symbol=typeof input.symbol==='string'?input.symbol.trim().toUpperCase():'';
        if(!symbols.has(symbol))fail(400,'ไม่รองรับหุ้นนี้');
        const snapshot=news.snapshot(),sources=userData(user).state.sources;
        const enabled=new Set(snapshot.sources.filter(feed=>sources.some(source=>source.enabled&&source.url.replace(/\/$/,'')===feed.url.replace(/\/$/,''))).map(feed=>feed.id));
        let result;try{result=await ai.summarize(symbol,snapshot.items.filter(item=>enabled.has(item.feedId)));}
        catch(error){
          if(error.code==='disabled')fail(503,'AI ในเครื่องยังไม่เปิดใช้');
          if(error.code==='no_news')fail(422,'ยังไม่มีหัวข้อข่าวสำหรับหุ้นนี้ เลือก AAPL, MSFT หรือ NVDA และเปิดฟีดข่าวของบริษัท');
          fail(503,'ติดต่อ AI ในเครื่องไม่สำเร็จ ตรวจว่าเปิด Ollama และติดตั้งโมเดลแล้ว');
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
          db.prepare('INSERT INTO user_state(user_id,data) VALUES(?,?)').run(id,JSON.stringify(initialState()));
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
      if(pathname==='/api/login'&&req.method==='POST'){
        const input=await body(req),email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
        limit(req,email);
        if(typeof input.password!=='string'||input.password.length>128)fail(401,'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const hash=await passwordHash(input.password,user?.salt||'0'.repeat(32));
        if(!user||!timingSafeEqual(hash,Buffer.from(user.password_hash,'hex'))||db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id)?.password_hash!==user.password_hash)fail(401,'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        db.prepare('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?').run(Date.now(),tokenHash(tokenFrom(req)));
        const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tokenHash(token),user.id,Date.now()+SESSION_AGE);
        res.setHeader('Set-Cookie',cookie(token,SESSION_AGE/1000));
        return send(res,200,userData({id:user.id,name:user.name,email:user.email}));
      }
      if(pathname==='/api/logout'&&req.method==='POST'){
        await body(req);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(tokenFrom(req)));res.setHeader('Set-Cookie',cookie('',0));return send(res,200,{ok:true});
      }
      if(pathname==='/api/state'&&req.method==='PUT'){
        if(!currentUser(req))fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const input=await body(req);
        const user=currentUser(req);if(!user)fail(401,'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        if(input.userId!==user.id)fail(409,'บัญชีเปลี่ยนไป กรุณาเข้าสู่ระบบใหม่ก่อนบันทึก');
        if(!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'เวอร์ชันข้อมูลไม่ถูกต้อง');
        const state=validateState(input.state);
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
      const assets={'/quotes-ui.js':['quotes-ui.js','text/javascript'],'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/auth.js':['auth.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/theme.css':['theme.css','text/css'],'/catalog.js':['catalog.js','text/javascript'],'/pwa.js':['pwa.js','text/javascript'],'/sw.js':['sw.js','text/javascript'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'],'/offline.html':['offline.html','text/html'],'/icon.svg':['icon.svg','image/svg+xml'],'/icon-192.png':['icon-192.png','image/png'],'/icon-512.png':['icon-512.png','image/png'],'/apple-touch-icon.png':['apple-touch-icon.png','image/png']};
      const asset=assets[pathname];if(!asset||!['GET','HEAD'].includes(req.method))fail(404,'ไม่พบหน้าเว็บ');
      const data=readFileSync(path.join(root,'dist',asset[0]));res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:data);
    }catch(error){send(res,error.status||500,{error:error.status?error.message:'ระบบขัดข้อง กรุณาลองใหม่'});if(!error.status)console.error(error.message);}
  });
  server.requestTimeout=130000;server.headersTimeout=10000;
  if(refreshNews){server.once('listening',()=>{news.refresh().catch(()=>{});newsTimer=setInterval(()=>news.refresh().catch(()=>{}),15*60*1000);newsTimer.unref();});}
  server.on('close',()=>{clearInterval(newsTimer);news.close();quotes.close();ai.close();db.close();});
  return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be an integer from 1 to 65535');
  if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.APP_ORIGIN)throw new Error('Set APP_ORIGIN before listening beyond localhost');
  const server=createApp({databasePath:process.env.DATABASE_PATH?path.resolve(process.env.DATABASE_PATH):undefined,publicOrigin:process.env.APP_ORIGIN||null,refreshNews:process.env.NEWS_ENABLED!=='false',quoteApiKey:process.env.FINNHUB_API_KEY?.trim()||'',aiEnabled:process.env.AI_ENABLED!=='false',aiBaseUrl:process.env.OLLAMA_URL||'http://127.0.0.1:11434',aiModel:process.env.OLLAMA_MODEL||'qwen3:8b'});
  server.listen(port,host,()=>console.log(`StockLens: http://${host}:${server.address().port}`));
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`พอร์ต ${port} ถูกใช้อยู่แล้ว ตั้งค่า PORT เป็นหมายเลขอื่น`:error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeIdleConnections();});
}
