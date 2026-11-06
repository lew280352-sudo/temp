import http from 'node:http';
import { openDatabase } from './database.mjs';
import { initializeSchema } from './schema.mjs';
import {createAuthLimiter} from './rate-limit.mjs';
import {runtimeConfig} from './config.mjs';
import { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { companies } from './dist/catalog.js';
import { feeds, verifiedFeeds, createNewsService } from './feeds.mjs';
import { marketFeeds } from './market-news.mjs';
import { createQuoteService } from './quotes.mjs';
import { createForecastService } from './forecast.mjs';
import { createAiRouter, createAiService } from './ai.mjs';
import { createResearchService, validateResearchSymbol, validateResearchMonths } from './research.mjs';
import { newTotpSecret, verifyTotp, encryptSecret, decryptSecret } from './security.mjs';
import { createPushService } from './push.mjs';
import { createEmailVerification } from './email-verification.mjs';
import { createLoginOtp } from './login-otp.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const deriveKey = promisify(scrypt);
const SESSION_AGE = 12 * 60 * 60 * 1000;
const symbols = new Set(companies.map((c) => c.symbol));
export function initialState(includeMarket = false) {
  return { watchlist: [], alerts: { daily: true, news: true, trend: true, time: '08:00', scope: 'watchlist' }, sources: [...feeds, ...(includeMarket ? marketFeeds : [])].map((f) => ({ id: f.id, name: f.name, url: f.url, type: f.type || 'company', symbol: f.symbol, enabled: true })) };
}
class HttpError extends Error {constructor(status, message) {super(message);this.status = status;}}
function fail(status, message) {throw new HttpError(status, message);}
export function normalizeSourceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) fail(400, 'URL ยาวเกินไปหรือรูปแบบไม่ถูกต้อง');
  let url;try {url = new URL(value.trim());} catch {fail(400, 'กรุณากรอก URL เต็ม เช่น https://example.com/news');}
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.includes(':')) fail(400, 'ใช้ URL เว็บไซต์สาธารณะแบบ http หรือ https โดยไม่มีรหัสผ่านในลิงก์');
  url.hash = '';return url.href;
}
function validateState(input) {
  if (!input || !Array.isArray(input.watchlist) || input.watchlist.length > symbols.size) fail(400, 'รายการบริษัทที่ติดตามไม่ถูกต้อง');
  const seen = new Set(),watchlist = input.watchlist.map((value) => {
      const symbol = typeof value === 'string' ? value.trim().toUpperCase() : '';
      if (!symbols.has(symbol) || seen.has(symbol)) fail(400, 'รายการบริษัทที่ติดตามไม่ถูกต้อง');
      seen.add(symbol);return symbol;
    });
  const a = input.alerts;
  if (!a || !['daily', 'news', 'trend'].every((k) => typeof a[k] === 'boolean') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time) || !['watchlist', 'all'].includes(a.scope)) fail(400, 'การตั้งค่าแจ้งเตือนไม่ถูกต้อง');
  if (!Array.isArray(input.sources) || input.sources.length > 100) fail(400, 'บันทึกแหล่งข้อมูลได้สูงสุด 100 เว็บไซต์');
  const urls = new Set(),ids = new Set();
  const sources = input.sources.map((s) => {
    if (!s || typeof s.id !== 'string' || !s.id || s.id.length > 80 || ids.has(s.id) || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 100 || !['company', 'partner', 'finance'].includes(s.type) || !(s.symbol === '' || symbols.has(s.symbol)) || typeof s.enabled !== 'boolean') fail(400, 'ข้อมูลเว็บไซต์ไม่ถูกต้อง');
    const url = normalizeSourceUrl(s.url);if (urls.has(url)) fail(400, 'มี URL นี้ในรายการแล้ว');urls.add(url);ids.add(s.id);
    const approved = verifiedFeeds.find((feed) => feed.url === url);
    return { id: s.id, name: approved?.name || s.name.trim(), url, type: approved ? 'finance' : s.type, symbol: approved ? '' : s.symbol, enabled: s.enabled };
  });
  return { watchlist, alerts: { daily: a.daily, news: a.news, trend: a.trend, time: a.time, scope: a.scope }, sources };
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail(415, 'ต้องส่งข้อมูล JSON');
  const chunks = [];let size = 0;
  for await (const chunk of req) {size += chunk.length;if (size > 65536) fail(413, 'ข้อมูลใหญ่เกินไป');chunks.push(chunk);}
  try {const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'ข้อมูล JSON ต้องเป็น object');return data;} catch {fail(400, 'ข้อมูล JSON ไม่ถูกต้อง');}
}
async function passwordHash(password, salt) {return deriveKey(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });}
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
function tokenFrom(req) {return (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('stocklens_session='))?.slice(18) || '';}

export async function createApp({ databasePath = path.join(root, '.data', 'stocklens.sqlite'), databaseUrl = '', authToken = '', trustedProxyHops = 0, hostingProfile = '', secureCookies = false, publicOrigin = null, refreshNews = false, newsFetcher = fetch, quoteApiKey = '', quoteFetcher = fetch, researchFetcher = fetch, historyApiKey = '', historyFetcher = fetch, aiEnabled = false, aiProvider = 'ollama', aiBaseUrl = 'http://127.0.0.1:11434', aiApiKey = '', aiModel, aiFallbackModel = 'qwen3:8b', aiFetcher = fetch, mfaKeyHex = '', pushPublicKey = '', pushPrivateKey = '', pushSubject = '', pushSender, emailOrigin = '', smtpHost = '', smtpPort = 587, smtpUser = '', smtpPass = '', smtpFrom = '', emailSender, emailLoginEnabled = false } = {}) {
  if (mfaKeyHex && !/^[a-f0-9]{64}$/i.test(mfaKeyHex)) throw new Error('MFA_ENCRYPTION_KEY must be 64 hex characters');
  const backgroundSleeps=hostingProfile==='render-free';
  if(backgroundSleeps){smtpHost='';emailSender=undefined;emailLoginEnabled=false;}
  const mfaKey = mfaKeyHex ? Buffer.from(mfaKeyHex, 'hex') : null;
  if (publicOrigin) {
    let url;try {url = new URL(publicOrigin);} catch {throw new Error('APP_ORIGIN must be an http(s) origin');}
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('APP_ORIGIN must contain only scheme, hostname and optional port');
    publicOrigin = url.origin;secureCookies = url.protocol === 'https:';
  }
  const db = await openDatabase({ databasePath, databaseUrl, authToken });
  try {
  await initializeSchema(db);
  if (quoteApiKey) {
    await db.transaction(async tx=>{
    for (const row of await tx.all('SELECT user_id,data FROM user_state WHERE user_id NOT IN (SELECT user_id FROM market_feed_migrations)', [])) {
      let state;try {state = JSON.parse(row.data);} catch {continue;}
      if (!Array.isArray(state.sources)) continue;
      const known = new Set(state.sources.map((source) => source.url));
      for (const feed of marketFeeds) if (!known.has(feed.url) && state.sources.length < 100) state.sources.push({ id: feed.id, name: feed.name, url: feed.url, type: 'finance', symbol: feed.symbol, enabled: true });
      await tx.run('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=?', [JSON.stringify(state), row.user_id]);
      await tx.run('INSERT INTO market_feed_migrations VALUES(?)', [row.user_id]);
    }
    });
  }
  const selectedFeeds = async () => {
    const urls = new Set();
    for (const row of await db.all('SELECT data FROM user_state', [])) {
      try {for (const source of JSON.parse(row.data).sources || []) if (source.enabled) urls.add(source.url);} catch {}
    }
    return verifiedFeeds.filter((feed) => urls.has(feed.url));
  };
  const news = await createNewsService(db, { fetcher: newsFetcher, marketApiKey: quoteApiKey, marketFetcher: newsFetcher, selectedFeeds });
  const quotes = await createQuoteService(db, { apiKey: quoteApiKey, fetcher: quoteFetcher });
  const research = createResearchService({ apiKey: quoteApiKey, fetcher: researchFetcher });
  const forecast = await createForecastService(db, { apiKey: historyApiKey, fetcher: historyFetcher });
  const push = await createPushService(db, { publicKey: pushPublicKey, privateKey: pushPrivateKey, subject: pushSubject, ...(pushSender ? { sender: pushSender } : {}) });
  const email = await createEmailVerification(db, { origin: emailOrigin || publicOrigin || '', smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, ...(emailSender ? { sender: emailSender } : {}) });
  const loginOtp = await createLoginOtp(db, { enabled: emailLoginEnabled, smtpHost, smtpPort, smtpUser, smtpPass, smtpFrom, ...(emailSender ? { sender: emailSender } : {}) });
  const ai = aiProvider === 'hybrid' ? createAiRouter(await
  createAiService(db, { enabled: aiEnabled, provider: 'groq', apiKey: aiApiKey, model: aiModel, fetcher: aiFetcher }), await
  createAiService(db, { enabled: aiEnabled, provider: 'ollama', baseUrl: aiBaseUrl, model: aiFallbackModel, fetcher: aiFetcher })
  ) : await createAiService(db, { enabled: aiEnabled, provider: aiProvider, baseUrl: aiBaseUrl, apiKey: aiApiKey, model: aiModel, fetcher: aiFetcher });
  let newsTimer;
  const newRecoveryCode = () => randomBytes(24).toString('hex');
  const authLimiter=await createAuthLimiter(db,{trustedProxyHops});
  const researchAttempts = new Map();
  const aiQuestionAttempts = new Map();
  function limitResearch(user) {
    const now = Date.now(),entry = researchAttempts.get(user.id) || { count: 0, until: now + 15 * 60 * 1000 };
    if (now >= entry.until) {entry.count = 0;entry.until = now + 15 * 60 * 1000;}
    entry.count++;researchAttempts.set(user.id, entry);
    if (researchAttempts.size > 1000) for (const [id, item] of researchAttempts) if (now >= item.until) researchAttempts.delete(id);
    if (entry.count > 8) fail(429, 'ค้นข่าวบ่อยเกินไป กรุณารอ 15 นาที');
  }
  function limitAiQuestion(user) {
    const now = Date.now(),entry = aiQuestionAttempts.get(user.id) || { count: 0, until: now + 15 * 60 * 1000 };
    if (now >= entry.until) {entry.count = 0;entry.until = now + 15 * 60 * 1000;}
    entry.count++;aiQuestionAttempts.set(user.id, entry);
    if (aiQuestionAttempts.size > 1000) for (const [id, item] of aiQuestionAttempts) if (now >= item.until) aiQuestionAttempts.delete(id);
    if (entry.count > 10) fail(429, 'ถาม AI บ่อยเกินไป กรุณารอ 15 นาที');
  }
  const publicHost = publicOrigin ? new URL(publicOrigin).host : null;
  const cookie = (token, age, req) => `stocklens_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookies && req.headers.host === publicHost ? '; Secure' : ''}`;
  const send = (res, status, data) => {res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });res.end(JSON.stringify(data));};
  const userData = async (user) => {
    const row=user?await db.get('SELECT data,revision FROM user_state WHERE user_id=?',[user.id]):null;
    const setup=user?await db.get('SELECT status,completed_at FROM user_onboarding WHERE user_id=?',[user.id]):null;
    return {user,state:row?JSON.parse(row.data):null,revision:row?.revision??null,onboarding:user?{needed:setup?.status==='pending',status:setup?.status||'legacy',completedAt:setup?.completed_at??null}:null};
  };
  async function currentUser(req) {
    const token = tokenFrom(req);if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const user=await db.get('SELECT u.id,u.email,u.name,d.last_seen_at FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN session_devices d ON d.token_hash=s.token_hash WHERE s.token_hash=? AND s.expires_at>?',[tokenHash(token),Date.now()]);
    if(!user)return null;
    if(!user.last_seen_at||user.last_seen_at<Date.now()-60000)await db.run('UPDATE session_devices SET last_seen_at=? WHERE token_hash=? AND (last_seen_at IS NULL OR last_seen_at<?)',[Date.now(),tokenHash(token),Date.now()-60000]);
    return {id:user.id,email:user.email,name:user.name};
  }
  async function limit(req,email){await authLimiter.consume({peerAddress:req.socket.remoteAddress||'unknown',forwardedFor:req.headers['x-forwarded-for'],email});}
  async function checkPassword(user, password) {
    if (typeof password !== 'string' || password.length > 128) fail(401, 'รหัสผ่านไม่ถูกต้อง');
    const row = await db.get('SELECT salt,password_hash FROM users WHERE id=?', [user.id]);
    if (!row) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const hash = await passwordHash(password, row.salt);
    if (!timingSafeEqual(hash, Buffer.from(row.password_hash, 'hex')) || (await db.get('SELECT password_hash FROM users WHERE id=?', [user.id]))?.password_hash !== row.password_hash) fail(401, 'รหัสผ่านไม่ถูกต้อง');
    return row.password_hash;
  }
  async function checkMfa(userId, code, { consume = false, connection=db } = {}) {
    const row = await connection.get('SELECT secret,last_step FROM user_mfa WHERE user_id=?', [userId]);
    if (!row?.secret) return true;
    if (!mfaKey) fail(503, 'เซิร์ฟเวอร์ไม่มีคีย์ MFA กรุณาติดต่อผู้ดูแล');
    const step = verifyTotp(decryptSecret(row.secret, mfaKey), code, { lastStep: row.last_step });
    if (step === null) fail(401, 'รหัส MFA ไม่ถูกต้องหรือถูกใช้แล้ว');
    if (consume && !(await connection.run('UPDATE user_mfa SET last_step=? WHERE user_id=? AND last_step<? AND secret=?', [step, userId, step,row.secret])).changes) fail(401, 'รหัส MFA ถูกใช้แล้ว');
    return true;
  }
  async function requireSession(tx,req,userId,credentialHash){
    const user=await tx.get('SELECT u.id,u.password_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',[tokenHash(tokenFrom(req)),Date.now()]);
    if(!user||user.id!==userId||(credentialHash&&user.password_hash!==credentialHash))fail(401,'รหัสผ่านหรือเซสชันเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่');
  }
  async function newSession(tx,req,userId){
    await tx.run('DELETE FROM sessions WHERE expires_at<=? OR token_hash=?',[Date.now(),tokenHash(tokenFrom(req))]);
    const token=randomBytes(32).toString('hex');
    await tx.run('INSERT INTO sessions VALUES(?,?,?)',[tokenHash(token),userId,Date.now()+SESSION_AGE]);
    const ua=String(req.headers['user-agent']||'').slice(0,512);
    const browser=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\/|CriOS\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'เบราว์เซอร์';
    const os=/iPhone|iPad/.test(ua)?'iPhone/iPad':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Macintosh|Mac OS/.test(ua)?'Mac':/Linux/.test(ua)?'Linux':'ไม่ระบุระบบ';
    await tx.run('INSERT INTO session_devices VALUES(?,?,?,?,?)',[tokenHash(token),randomUUID(),browser+' · '+os,Date.now(),Date.now()]);
    return token;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');res.setHeader('X-Content-Type-Options', 'nosniff');res.setHeader('Referrer-Policy', 'no-referrer');res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const localHosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
      const allowed = publicOrigin ? [publicHost, ...localHosts] : localHosts;
      if (!allowed.includes(req.headers.host)) fail(403, 'Host ไม่ได้รับอนุญาต');
      const origin = req.headers.host === publicHost ? publicOrigin : `http://${req.headers.host}`;
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) fail(403, 'คำขอไม่ได้มาจากเว็บไซต์นี้');
      const pathname = new URL(req.url, origin).pathname;
      if (pathname === '/api/health' && req.method === 'GET') {await db.get('SELECT 1', []);return send(res, 200, { ok: true, version: '0.9.2' });}
      if (pathname === '/api/ai/status' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const result = await ai.status();
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, result);
      }
      if (pathname === '/api/quotes' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const watchlist = (await userData(user)).state.watchlist;
        const result = await quotes.get(watchlist);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const currentSymbols = new Set((await userData(user)).state.watchlist);
        return send(res, 200, { ...result, items: result.items.filter((item) => currentSymbols.has(item.symbol)) });
      }
      if (pathname === '/api/forecast' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const symbol = new URL(req.url, origin).searchParams.get('symbol')?.trim().toUpperCase() || '';
        if (!symbols.has(symbol)) fail(400, 'ไม่รองรับหุ้นนี้');
        const result = await forecast.get(symbol);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, result);
      }
      if (pathname === '/api/news' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const preferences = (await userData(user)).state;
        await news.refreshFor(preferences.sources.filter((source) => source.enabled).map((source) => source.url), preferences.watchlist);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const snapshot = await news.snapshot(),sources = (await userData(user)).state.sources;
        const enabled = new Set(snapshot.sources.filter((feed) => sources.some((source) => source.enabled && source.url.replace(/\/$/, '') === feed.url.replace(/\/$/, ''))).map((feed) => feed.id));
        return send(res, 200, { ...snapshot, items: snapshot.items.filter((item) => enabled.has(item.feedId)), sources: snapshot.sources.filter((feed) => sources.some((source) => source.url.replace(/\/$/, '') === feed.url.replace(/\/$/, ''))).map((feed) => ({ ...feed, enabled: enabled.has(feed.id) })) });
      }
      if (pathname === '/api/research/companies' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const query = new URL(req.url, origin).searchParams.get('q') || '';
        if (query.trim().length < 2 || query.length > 80) fail(400, 'กรอกชื่อบริษัทหรือ ticker 2 ถึง 80 ตัวอักษร');
        limitResearch(user);
        const items = await research.companies(query);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, { items });
      }
      if (pathname === '/api/research' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const input = await body(req);
        let symbol, months;
        try {symbol = validateResearchSymbol(input.symbol);months = validateResearchMonths(input.months);} catch (error) {fail(400, error.message);}
        const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
        if (!name || name.length < 2) fail(400, 'กรุณาเลือกบริษัทจากผลค้นหา');
        limitResearch(user);
        const result = await research.news(symbol, name, months);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        let summary = null,aiError = '';
        if (result.articles.length) {
          try {summary = await ai.summarize(symbol, result.articles);} catch (error) {aiError = error.code === 'not_configured' ? 'ยังไม่ได้ตั้งค่า Groq API key' : error.code === 'disabled' ? 'AI ยังไม่เปิดใช้งาน' : 'AI สรุปไม่ได้ในขณะนี้ กรุณาลองใหม่';}
        }
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, { ...result, summary, aiError });
      }
      if (pathname === '/api/ai/summary' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const input = await body(req),symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
        if (!symbols.has(symbol)) fail(400, 'ไม่รองรับหุ้นนี้');
        const snapshot = await news.snapshot(),sources = (await userData(user)).state.sources;
        const enabled = new Set(snapshot.sources.filter((feed) => sources.some((source) => source.enabled && source.url.replace(/\/$/, '') === feed.url.replace(/\/$/, ''))).map((feed) => feed.id));
        let result;try {result = await ai.summarize(symbol, snapshot.items.filter((item) => enabled.has(item.feedId)));}
        catch (error) {
          if (error.code === 'disabled') fail(503, 'AI ยังไม่เปิดใช้');
          if (error.code === 'not_configured') fail(503, 'ยังไม่ได้ตั้งค่า Groq API key');
          if (error.code === 'no_news') fail(422, 'ยังไม่มีหัวข้อข่าวสำหรับหุ้นนี้ กรุณาเปิดแหล่งข่าวที่เกี่ยวข้อง');
          if (error.code === 'providers_unavailable') fail(503, 'Groq และ Ollama ยังไม่พร้อม ตรวจโควตา อินเทอร์เน็ต และ Ollama');
          fail(503, aiProvider === 'groq' ? 'ติดต่อ Groq AI ไม่สำเร็จ ตรวจ API key โควตา และอินเทอร์เน็ต' : 'ติดต่อ AI ในเครื่องไม่สำเร็จ ตรวจว่าเปิด Ollama และติดตั้งโมเดลแล้ว');
        }
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, result);
      }
      if (pathname === '/api/ai/ask' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const input = await body(req),symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
        const question = typeof input.question === 'string' ? input.question.trim() : '';
        if (!symbols.has(symbol)) fail(400, 'ไม่รองรับหุ้นนี้');
        if (question.length < 5 || question.length > 300) fail(400, 'กรุณาถามคำถาม 5–300 ตัวอักษร');
        if (!Array.isArray(input.articleIds) || input.articleIds.length < 1 || input.articleIds.length > 10 || input.articleIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > 128) || new Set(input.articleIds).size !== input.articleIds.length) fail(400, 'รายการข่าวไม่ถูกต้อง กรุณาสรุปข่าวใหม่');
        const snapshot = await news.snapshot(),sources = (await userData(user)).state.sources;
        const enabled = new Set(snapshot.sources.filter((feed) => sources.some((source) => source.enabled && source.url.replace(/\/$/, '') === feed.url.replace(/\/$/, ''))).map((feed) => feed.id));
        const articleMap = new Map(snapshot.items.filter((item) => item.symbol === symbol && enabled.has(item.feedId)).map((item) => [item.id, item]));
        const articles = input.articleIds.map((id) => articleMap.get(id));
        if (articles.some((item) => !item)) fail(409, 'ข่าวชุดนี้เปลี่ยนไป กรุณาสรุปข่าวใหม่');
        limitAiQuestion(user);
        let result;try {result = await ai.ask(symbol, question, articles);}
        catch (error) {
          if (error.code === 'disabled') fail(503, 'AI ยังไม่เปิดใช้');
          if (error.code === 'not_configured') fail(503, 'ยังไม่ได้ตั้งค่า Groq API key');
          if (error.code === 'providers_unavailable') fail(503, 'Groq และ Ollama ยังไม่พร้อม ตรวจโควตา อินเทอร์เน็ต และ Ollama');
          fail(503, 'ติดต่อ AI ไม่สำเร็จ กรุณาลองใหม่');
        }
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, result);
      }
      if (pathname === '/api/session' && req.method === 'GET') {
        return send(res, 200, await userData(await currentUser(req)));
      }
      if(pathname==='/api/sessions'&&req.method==='GET'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const rows=await db.all('SELECT d.id,d.name,d.created_at,d.last_seen_at,s.expires_at,s.token_hash FROM sessions s JOIN session_devices d ON d.token_hash=s.token_hash WHERE s.user_id=? AND s.expires_at>? ORDER BY (s.token_hash=?) DESC,d.last_seen_at DESC',[user.id,Date.now(),tokenHash(tokenFrom(req))]);
        if((await currentUser(req))?.id!==user.id)fail(401,'เซสชันหมดอายุ');
        return send(res,200,{sessions:rows.map(row=>({id:row.id,name:row.name,createdAt:row.created_at,lastSeenAt:row.last_seen_at,expiresAt:row.expires_at,current:row.token_hash===tokenHash(tokenFrom(req))}))});
      }
      if(['/api/sessions/revoke','/api/sessions/revoke-others'].includes(pathname)&&req.method==='POST'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');const input=await body(req),others=pathname.endsWith('revoke-others');
        if(!others&&(typeof input.id!=='string'||input.id.length>64))fail(400,'เลือกอุปกรณ์ที่ต้องการออกจากระบบ');
        const result=await db.transaction(async tx=>{
          await requireSession(tx,req,user.id);
          if(others){const removed=await tx.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',[user.id,tokenHash(tokenFrom(req))]);return {revoked:Number(removed.changes),currentRevoked:false};}
          const target=await tx.get('SELECT s.token_hash FROM sessions s JOIN session_devices d ON d.token_hash=s.token_hash WHERE d.id=? AND s.user_id=? AND s.expires_at>?',[input.id,user.id,Date.now()]);
          if(!target)fail(404,'ไม่พบอุปกรณ์ที่ยังเข้าสู่ระบบ');
          await tx.run('DELETE FROM sessions WHERE token_hash=? AND user_id=?',[target.token_hash,user.id]);
          return {revoked:1,currentRevoked:target.token_hash===tokenHash(tokenFrom(req))};
        });
        if(result.currentRevoked)res.setHeader('Set-Cookie',cookie('',0,req));
        return send(res,200,{ok:true,...result});
      }
      if(pathname==='/api/onboarding'&&req.method==='POST'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');const input=await body(req);
        if(input.userId!==user.id)fail(409,'บัญชีเปลี่ยนไป กรุณาเข้าสู่ระบบใหม่');
        if(!['skip','complete'].includes(input.action))fail(400,'เลือกบันทึกหรือข้ามการตั้งค่า');
        const next=input.action==='complete'?validateState(input.state):null;
        if(next&&(!Number.isSafeInteger(input.revision)||input.revision<0))fail(400,'เวอร์ชันข้อมูลไม่ถูกต้อง');
        await db.transaction(async tx=>{
          await requireSession(tx,req,user.id);
          if(next){
            const previous=await tx.get('SELECT data FROM user_state WHERE user_id=?',[user.id]);
            if(quoteApiKey)for(const symbol of next.watchlist){
              if(JSON.parse(previous.data).watchlist.includes(symbol))continue;const feed=marketFeeds.find(f=>f.symbol===symbol);
              if(feed&&next.sources.length<100&&!next.sources.some(s=>s.url===feed.url))next.sources.push({id:randomUUID(),name:feed.name,url:feed.url,symbol:feed.symbol,type:'finance',enabled:true});
            }
            const changed=await tx.run('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=? AND revision=?',[JSON.stringify(next),user.id,input.revision]);
            if(!changed.changes)fail(409,'ข้อมูลเปลี่ยนจากแท็บอื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก');
          }
          await tx.run('INSERT INTO user_onboarding VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at',[user.id,next?'completed':'skipped',Date.now()]);
        });
        return send(res,200,await userData(user));
      }
      if (pathname === '/api/register' && req.method === 'POST') {
        const input = await body(req);
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        await limit(req, email);
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 80 || typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128) fail(400, 'กรอกชื่อ อีเมล และรหัสผ่าน 10–128 ตัวอักษรให้ถูกต้อง');
        const salt = randomBytes(16).toString('hex'),hash = (await passwordHash(input.password, salt)).toString('hex'),id = randomUUID();
        if (await db.get('SELECT id FROM users WHERE email=?', [email])) fail(409, 'อีเมลนี้ถูกใช้แล้ว กรุณาเข้าสู่ระบบ');
        const recoveryCode = newRecoveryCode();await db.transaction(async (tx) => {

          if(await tx.get('SELECT id FROM users WHERE email=?',[email]))fail(409,'อีเมลนี้ถูกใช้แล้ว กรุณาเข้าสู่ระบบ');
          await tx.run('INSERT INTO users VALUES(?,?,?,?,?,?)', [id, email, name, salt, hash, Date.now()]);
          await tx.run('INSERT INTO user_state(user_id,data) VALUES(?,?)', [id, JSON.stringify(initialState(!!quoteApiKey))]);
          await tx.run('INSERT INTO user_onboarding VALUES(?,?,NULL)',[id,'pending']);
          if (quoteApiKey) await tx.run('INSERT INTO market_feed_migrations VALUES(?)', [id]);
          await tx.run('INSERT INTO recovery_codes VALUES(?,?)', [id, tokenHash(recoveryCode)]);});

        return send(res, 201, { message: 'สร้างบัญชีแล้ว กรุณาเข้าสู่ระบบ', recoveryCode });
      }
      if (pathname === '/api/recover' && req.method === 'POST') {
        const input = await body(req),email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';await limit(req, email);
        if (typeof input.password !== 'string' || input.password.length < 10 || input.password.length > 128) fail(400, 'รหัสผ่านใหม่ต้องยาว 10–128 ตัวอักษร');
        const user = await db.get('SELECT u.id,r.code_hash FROM users u JOIN recovery_codes r ON r.user_id=u.id WHERE u.email=?', [email]);
        const supplied = typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
        if (!user || !timingSafeEqual(Buffer.from(tokenHash(supplied), 'hex'), Buffer.from(user.code_hash, 'hex'))) fail(401, 'อีเมลหรือรหัสกู้คืนไม่ถูกต้อง');
        const salt = randomBytes(16).toString('hex'),hash = (await passwordHash(input.password, salt)).toString('hex'),recoveryCode = newRecoveryCode();await db.transaction(async (tx) => {

          const changed = await tx.run('UPDATE recovery_codes SET code_hash=? WHERE user_id=? AND code_hash=?', [tokenHash(recoveryCode), user.id, user.code_hash]);
          if (!changed.changes) fail(401, 'รหัสกู้คืนนี้ถูกใช้แล้ว');
          await tx.run('UPDATE users SET salt=?,password_hash=? WHERE id=?', [salt, hash, user.id]);
          await tx.run('DELETE FROM user_mfa WHERE user_id=?', [user.id]);
          await tx.run('DELETE FROM login_otp WHERE user_id=?', [user.id]);
          await tx.run('DELETE FROM sessions WHERE user_id=?', [user.id]);});

        res.setHeader('Set-Cookie', cookie('', 0, req));return send(res, 200, { ok: true, recoveryCode });
      }
      if(pathname==='/api/recovery-code'&&req.method==='POST'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);await limit(req,user.email);const credentialHash=await checkPassword(user,input.password);
        const recoveryCode=newRecoveryCode();
        await db.transaction(async tx=>{await requireSession(tx,req,user.id,credentialHash);await tx.run('INSERT INTO recovery_codes VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash',[user.id,tokenHash(recoveryCode)]);});
        return send(res,200,{recoveryCode});
      }
      if (pathname === '/api/security' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const row = await db.get('SELECT secret FROM user_mfa WHERE user_id=?', [user.id]);
        return send(res, 200, { hosting:{backgroundSleeps}, mfaEnabled: !!row?.secret, mfaAvailable: !!mfaKey, emailLoginEnabled: loginOtp.enabled, ...(await email.status(user.id)) });
      }
      if (pathname === '/api/email/send-verification' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        await body(req);await limit(req, user.email);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        try {return send(res, 200, await email.request(user));}
        catch (error) {fail(error.message === 'Email verification is not configured' ? 503 : error.message === 'Wait before requesting another email' ? 429 : 503, 'ยังส่งอีเมลไม่ได้ ตรวจการตั้งค่า SMTP หรือรอสักครู่');}
      }
      if (pathname === '/api/email/verify' && req.method === 'POST') {
        const input = await body(req);await limit(req);
        if (!(await email.verify(input.token))) fail(400, 'ลิงก์ไม่ถูกต้อง หมดอายุ หรือใช้แล้ว');
        return send(res, 200, { ok: true });
      }
      if (pathname === '/api/push/status' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        return send(res, 200, {backgroundSleeps,...await push.status(user.id)});
      }
      if (pathname === '/api/push/subscribe' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const input = await body(req);
        if (!(await currentUser(req)) || (await currentUser(req)).id !== user.id) fail(401, 'เซสชันหมดอายุ');
        try {
          const result=await db.transaction(async tx=>{
            await requireSession(tx,req,user.id);
            const status=await push.subscribe(user.id,input,{connection:tx});
            const subscription=await tx.get('SELECT id FROM push_subscriptions WHERE user_id=? AND endpoint=?',[user.id,input.endpoint]);
            await tx.run('INSERT INTO session_push VALUES(?,?) ON CONFLICT(subscription_id) DO UPDATE SET session_hash=excluded.session_hash',[subscription.id,tokenHash(tokenFrom(req))]);
            return status;
          });return send(res,200,result);
        }
        catch (error) {if(error.status===401)throw error;fail(error.message === 'Push is not configured' ? 503 : 400, 'ข้อมูล Push ไม่ถูกต้องหรือยังไม่ได้ตั้งค่า');}
      }
      if (pathname === '/api/push/unsubscribe' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const input = await body(req);
        await push.unsubscribe(user.id, input.endpoint);
        return send(res, 200, { ok: true });
      }
      if (pathname === '/api/push/test' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        await body(req);await limit(req, user.email);
        if (!(await currentUser(req)) || (await currentUser(req)).id !== user.id) fail(401, 'เซสชันหมดอายุ');
        if (!push.configured) fail(503, 'Push ยังไม่พร้อม');
        const result = await push.test(user.id);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        return send(res, 200, result);
      }
      if(pathname==='/api/mfa/setup'&&req.method==='POST'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        if(!mfaKey)fail(503,'ผู้ดูแลยังไม่ได้ตั้งค่า MFA_ENCRYPTION_KEY');
        const input=await body(req);await limit(req,user.email);const credentialHash=await checkPassword(user,input.password);
        const secret=newTotpSecret(),encrypted=encryptSecret(secret,mfaKey);
        await db.transaction(async tx=>{
          await requireSession(tx,req,user.id,credentialHash);
          if((await tx.get('SELECT secret FROM user_mfa WHERE user_id=?',[user.id]))?.secret)fail(409,'เปิด MFA อยู่แล้ว');
          await tx.run('INSERT INTO user_mfa(user_id,pending_secret,pending_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending_secret=excluded.pending_secret,pending_until=excluded.pending_until',[user.id,encrypted,Date.now()+10*60*1000]);
        });
        const url=`otpauth://totp/${encodeURIComponent('StockLens:'+user.email)}?secret=${secret}&issuer=StockLens&algorithm=SHA1&digits=6&period=30`;
        return send(res,200,{secret,url,expiresMinutes:10});
      }
      if (pathname === '/api/mfa/enable' && req.method === 'POST') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบ');
        const input = await body(req);await limit(req, user.email);
        if ((await currentUser(req))?.id !== user.id) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const row = await db.get('SELECT secret,pending_secret,pending_until FROM user_mfa WHERE user_id=?', [user.id]);
        if (!row?.pending_secret || row.secret || Date.now() > row.pending_until) fail(400, 'เริ่มตั้งค่า MFA ใหม่');
        if (!mfaKey) fail(503, 'เซิร์ฟเวอร์ไม่มีคีย์ MFA');
        const step = verifyTotp(decryptSecret(row.pending_secret, mfaKey), input.code);
        if (step === null) fail(401, 'รหัส MFA ไม่ถูกต้อง');await db.transaction(async (tx) => {

          await requireSession(tx,req,user.id);
          const changed=await tx.run('UPDATE user_mfa SET secret=pending_secret,pending_secret=NULL,pending_until=NULL,last_step=? WHERE user_id=? AND secret IS NULL AND pending_secret=? AND pending_until>=?', [step,user.id,row.pending_secret,Date.now()]);
          if(!changed.changes)fail(409,'การตั้งค่า MFA นี้ถูกใช้แล้ว กรุณาตรวจสถานะล่าสุด');
          await tx.run('DELETE FROM login_otp WHERE user_id=?', [user.id]);
          await tx.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', [user.id, tokenHash(tokenFrom(req))]);});


        return send(res, 200, { ok: true });
      }
      if(pathname==='/api/mfa/disable'&&req.method==='POST'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);await limit(req,user.email);const credentialHash=await checkPassword(user,input.password);
        await db.transaction(async tx=>{
          await requireSession(tx,req,user.id,credentialHash);
          if(!(await tx.get('SELECT secret FROM user_mfa WHERE user_id=?',[user.id]))?.secret)fail(409,'ยังไม่ได้เปิด MFA');
          await checkMfa(user.id,input.code,{consume:true,connection:tx});
          await tx.run('DELETE FROM user_mfa WHERE user_id=?',[user.id]);
          await tx.run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',[user.id,tokenHash(tokenFrom(req))]);
        });
        return send(res,200,{ok:true});
      }
      if (pathname === '/api/login' && req.method === 'POST') {
        const input = await body(req),email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        await limit(req, email);
        if (typeof input.password !== 'string' || input.password.length > 128) fail(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        const user = await db.get('SELECT * FROM users WHERE email=?', [email]);
        const hash = await passwordHash(input.password, user?.salt || '0'.repeat(32));
        if (!user || !timingSafeEqual(hash, Buffer.from(user.password_hash, 'hex')) || (await db.get('SELECT password_hash FROM users WHERE id=?', [user.id]))?.password_hash !== user.password_hash) fail(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
        const mfaSecret=(await db.get('SELECT secret FROM user_mfa WHERE user_id=?',[user.id]))?.secret||null;
        if(mfaSecret){
          if (!input.totp) return send(res, 202, { factor: 'authenticator' });
        } else if (loginOtp.enabled) {
          try {return send(res, 202, await loginOtp.request(user,async tx=>{
            const fresh=await tx.get('SELECT password_hash FROM users WHERE id=?',[user.id]);
            const factor=(await tx.get('SELECT secret FROM user_mfa WHERE user_id=?',[user.id]))?.secret||null;
            if(!fresh||fresh.password_hash!==user.password_hash||factor!==mfaSecret)fail(401,'ข้อมูลยืนยันตัวตนเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่');
          }));}
          catch (error) {if(error.status===401)throw error;fail(error.message === 'Wait before requesting another login code' ? 429 : 503, 'ส่งรหัสเข้าสู่อีเมลไม่ได้ กรุณาตรวจการตั้งค่า SMTP หรือรอ 1 นาที');}
        }
        const token=await db.transaction(async tx=>{
          const fresh=await tx.get('SELECT password_hash FROM users WHERE id=?',[user.id]);
          const factor=(await tx.get('SELECT secret FROM user_mfa WHERE user_id=?',[user.id]))?.secret||null;
          if(!fresh||fresh.password_hash!==user.password_hash||factor!==mfaSecret)fail(401,'ข้อมูลยืนยันตัวตนเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่');
          if(mfaSecret)await checkMfa(user.id,input.totp,{consume:true,connection:tx});
          return newSession(tx,req,user.id);
        });
        res.setHeader('Set-Cookie', cookie(token, SESSION_AGE / 1000, req));
        return send(res, 200, await userData({ id: user.id, name: user.name, email: user.email }));
      }
      if (pathname === '/api/login/verify' && req.method === 'POST') {
        const input = await body(req);await limit(req);
        const verified=await loginOtp.verify(input.challengeId,input.code,async(userId,tx)=>{
          const user=await tx.get('SELECT id,name,email FROM users WHERE id=?',[userId]);
          if(!user)fail(401,'บัญชีนี้ไม่พร้อมใช้งาน');
          if((await tx.get('SELECT secret FROM user_mfa WHERE user_id=?',[user.id]))?.secret)fail(401,'บัญชีนี้ต้องใช้รหัส Authenticator');
          return {user,token:await newSession(tx,req,user.id)};
        });
        if(!verified)fail(401,'รหัสอีเมลไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว');
        const {user,token}=verified;
        res.setHeader('Set-Cookie', cookie(token, SESSION_AGE / 1000, req));
        return send(res, 200, await userData(user));
      }
      if (pathname === '/api/logout' && req.method === 'POST') {
        await body(req);await db.run('DELETE FROM sessions WHERE token_hash=?', [tokenHash(tokenFrom(req))]);res.setHeader('Set-Cookie', cookie('', 0, req));return send(res, 200, { ok: true });
      }
      if(pathname==='/api/account/delete'&&req.method==='POST'){
        const user=await currentUser(req);if(!user)fail(401,'กรุณาเข้าสู่ระบบ');
        const input=await body(req);await limit(req,user.email);const credentialHash=await checkPassword(user,input.password);
        if(input.confirm!==user.email)fail(400,'กรอกอีเมลให้ตรงกับบัญชีเพื่อยืนยันการลบ');
        await db.transaction(async tx=>{
          await requireSession(tx,req,user.id,credentialHash);
          await checkMfa(user.id,input.totp,{consume:true,connection:tx});
          await tx.run('DELETE FROM users WHERE id=?',[user.id]);
        });
        res.setHeader('Set-Cookie',cookie('',0,req));return send(res,200,{ok:true});
      }
      if (pathname === '/api/state' && req.method === 'PUT') {
        if (!(await currentUser(req))) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        const input = await body(req);
        const user = await currentUser(req);if (!user) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        if (input.userId !== user.id) fail(409, 'บัญชีเปลี่ยนไป กรุณาเข้าสู่ระบบใหม่ก่อนบันทึก');
        if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400, 'เวอร์ชันข้อมูลไม่ถูกต้อง');
        const state = validateState(input.state);
        const previous = (await userData(user)).state;
        if (quoteApiKey) for (const symbol of state.watchlist) {
          if (previous.watchlist.includes(symbol)) continue;
          const feed = marketFeeds.find((item) => item.symbol === symbol);
          if (feed && state.sources.length < 100 && !state.sources.some((source) => source.url === feed.url)) state.sources.push({ id: randomUUID(), name: feed.name, url: feed.url, type: 'finance', symbol, enabled: true });
        }
        const result = await db.run('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=? AND revision=?', [JSON.stringify(state), user.id, input.revision]);
        if (!result.changes) fail(409, 'ข้อมูลเปลี่ยนจากแท็บอื่นแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนแก้ไขอีกครั้ง');
        return send(res, 200, { ok: true, state, revision: input.revision + 1 });
      }
      if (pathname === '/api/export' && req.method === 'GET') {
        const user = await currentUser(req);if (!user) fail(401, 'กรุณาเข้าสู่ระบบก่อนส่งออกข้อมูล');
        res.setHeader('Content-Disposition', 'attachment; filename="stocklens-data.json"');
        return send(res, 200, { format: 'stocklens-export-v1', exportedAt: new Date().toISOString(), ...(await userData(user)) });
      }
      if (pathname.startsWith('/api/')) fail(404, 'ไม่พบ API นี้');
      if (companies.some((company) => company.icon === pathname) && ['GET', 'HEAD'].includes(req.method)) {
        const type = pathname.endsWith('.svg') ? 'image/svg+xml' : pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.webp') ? 'image/webp' : pathname.endsWith('.gif') ? 'image/gif' : pathname.endsWith('.bmp') ? 'image/bmp' : 'image/x-icon';
        const data = readFileSync(path.join(root, 'dist', pathname.slice(1)));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
        return res.end(req.method === 'HEAD' ? undefined : data);
      }
      const assets = { '/account-ui.js': ['account-ui.js', 'text/javascript; charset=utf-8'], '/icons.js': ['icons.js','text/javascript'], '/vendor/external-link.svg': ['vendor/external-link.svg','image/svg+xml'], '/quotes-ui.js': ['quotes-ui.js', 'text/javascript'], '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/verify-email.html': ['verify-email.html', 'text/html'], '/verify-email.js': ['verify-email.js', 'text/javascript'], '/app.js': ['app.js', 'text/javascript'], '/research-ui.js': ['research-ui.js', 'text/javascript'], '/auth.js': ['auth.js', 'text/javascript'], '/security-ui.js': ['security-ui.js', 'text/javascript'], '/push-ui.js': ['push-ui.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/theme.css': ['theme.css', 'text/css'], '/logo.css': ['logo.css', 'text/css'], '/features.css': ['features.css', 'text/css'], '/ui-polish.css': ['ui-polish.css', 'text/css'], '/catalog.js': ['catalog.js', 'text/javascript'], '/company-icons.js': ['company-icons.js', 'text/javascript'], '/pwa.js': ['pwa.js', 'text/javascript'], '/sw.js': ['sw.js', 'text/javascript'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/offline.html': ['offline.html', 'text/html'], '/icon.svg': ['icon.svg', 'image/svg+xml'], '/icon-192.png': ['icon-192.png', 'image/png'], '/icon-512.png': ['icon-512.png', 'image/png'], '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'] };
      const asset = assets[pathname];if (!asset || !['GET', 'HEAD'].includes(req.method)) fail(404, 'ไม่พบหน้าเว็บ');
      const data = readFileSync(path.join(root, 'dist', asset[0]));res.writeHead(200, { 'Content-Type': asset[1] + '; charset=utf-8' });res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {send(res, error.status || 500, { error: error.status ? error.message : 'ระบบขัดข้อง กรุณาลองใหม่' });if (!error.status) console.error('StockLens request failed');}
  });
  server.requestTimeout = 130000;server.headersTimeout = 10000;
  let newsCycle=Promise.resolve(),stopping=false,cleanupPromise;
  if(refreshNews)server.once('listening',()=>{
    const cycle=()=>{if(stopping)return;newsCycle=news.refresh().then(async()=>{if(!stopping)await push.deliver(await news.snapshot());}).catch(()=>{});return newsCycle;};
    cycle();newsTimer=setInterval(cycle,15*60*1000);newsTimer.unref();
  });
  function cleanup(){
    if(!cleanupPromise){stopping=true;clearInterval(newsTimer);news.close();quotes.close();forecast.close();ai.close();email.close();loginOtp.close();cleanupPromise=newsCycle.then(()=>db.close());}
    return cleanupPromise;
  }
  server.on('close',()=>{cleanup().catch(()=>{});});
  server.shutdown=async()=>{if(server.listening)await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections();});await cleanup();};
  return server;
  }catch(error){await db.close();throw error;}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {port,host,...deployment}=runtimeConfig();
  const groqApiKey = process.env.GROQ_API_KEY?.trim() || '',configuredProvider = (process.env.AI_PROVIDER || 'auto').trim().toLowerCase(),aiProvider = configuredProvider === 'auto' ? groqApiKey ? 'hybrid' : 'ollama' : configuredProvider;
  const server = await createApp({ ...deployment, databasePath: process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : undefined, refreshNews: process.env.NEWS_ENABLED !== 'false', quoteApiKey: process.env.FINNHUB_API_KEY?.trim() || '', historyApiKey: process.env.ALPHAVANTAGE_API_KEY?.trim() || '', aiEnabled: process.env.AI_ENABLED !== 'false', aiProvider, aiBaseUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434', aiApiKey: groqApiKey, aiModel: ['groq', 'hybrid'].includes(aiProvider) ? process.env.GROQ_MODEL || 'qwen/qwen3.8-27b' : process.env.OLLAMA_MODEL || 'qwen3:8b', aiFallbackModel: process.env.OLLAMA_MODEL || 'qwen3:8b', mfaKeyHex: process.env.MFA_ENCRYPTION_KEY?.trim() || '', pushPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() || '', pushPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() || '', pushSubject: process.env.VAPID_SUBJECT?.trim() || '', emailOrigin: deployment.publicOrigin || `http://127.0.0.1:${port}`, smtpHost: process.env.SMTP_HOST?.trim() || '', smtpPort: Number(process.env.SMTP_PORT || 587), smtpUser: process.env.SMTP_USER?.trim() || '', smtpPass: process.env.SMTP_PASS?.trim() || '', smtpFrom: process.env.SMTP_FROM?.trim() || '', emailLoginEnabled: process.env.EMAIL_LOGIN_OTP_ENABLED === 'true' });
  server.listen(port, host, () => console.log(`StockLens: http://${host}:${server.address().port}`));
  server.on('error', (error) => {console.error(error.code === 'EADDRINUSE' ? `พอร์ต ${port} ถูกใช้อยู่แล้ว ตั้งค่า PORT เป็นหมายเลขอื่น` : error.message);process.exitCode = 1;});
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {server.shutdown().catch(()=>{process.exitCode=1;});});
}
