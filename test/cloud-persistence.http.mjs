import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';
import {randomBytes} from 'node:crypto';
import {totpCode} from '../security.mjs';
import {openDatabase} from '../database.mjs';
import {createServer} from 'node:http';

for(const emailLoginEnabled of [false,true])test('a delayed credential snapshot cannot issue '+(emailLoginEnabled?'an email challenge':'a session')+' after recovery changed the password',async()=>{
  const sent=[],mailConfig=emailLoginEnabled?{emailLoginEnabled:true,smtpHost:'smtp.test',smtpUser:'test',smtpPass:'fixture',smtpFrom:'test@example.com',emailSender:async message=>sent.push(message)}:{};
  const upstream=process.env.TEST_DATABASE_URL||'http://127.0.0.1:18080';
  assert.ok(['127.0.0.1','localhost'].includes(new URL(upstream).hostname));
  let armed=false,release,entered;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const proxy=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
      const response=await fetch(upstream+req.url,{method:req.method,headers:{'Content-Type':'application/json',...(req.headers.authorization?{Authorization:req.headers.authorization}:{})},body:['GET','HEAD'].includes(req.method)?undefined:body});
      const output=Buffer.from(await response.arrayBuffer());
      if(armed&&/SELECT secret FROM user_mfa/i.test(body.toString())){armed=false;entered();await gate;}
      res.writeHead(response.status,{'Content-Type':'application/json'});res.end(output);
    }catch{res.writeHead(502);res.end();}
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  const server=await createApp({databasePath:':memory:',databaseUrl:`http://127.0.0.1:${proxy.address().port}`,authToken:'local-test-only',...mailConfig});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  const recoveryServer=await createApp({databasePath:':memory:',databaseUrl:upstream,authToken:'local-test-only'});
  recoveryServer.listen(0,'127.0.0.1');await once(recoveryServer,'listening');const recoveryBase=`http://127.0.0.1:${recoveryServer.address().port}`;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const account={name:'Credential race',email:`${randomUUID()}@example.com`,password:'old-credential-test-password'};
    const created=await (await post('/api/register',account)).json();armed=true;
    const pending=post('/api/login',account);await ready;
    assert.equal((await fetch(recoveryBase+'/api/recover',{method:'POST',headers:{Origin:recoveryBase,'Content-Type':'application/json'},body:JSON.stringify({email:account.email,code:created.recoveryCode,password:'new-credential-test-password'})})).status,200);
    release();const rejected=await pending;assert.equal(rejected.status,401);assert.equal(rejected.headers.get('set-cookie'),null);
    const fresh=await post('/api/login',{...account,password:'new-credential-test-password'});assert.equal(fresh.status,emailLoginEnabled?202:200);
    if(emailLoginEnabled){const challenge=await fresh.json(),code=sent.at(-1).text.match(/\b\d{6}\b/)[0];assert.equal((await post('/api/login/verify',{challengeId:challenge.challengeId,code})).status,200);}
  }finally{release();await server.shutdown();await recoveryServer.shutdown();await new Promise(resolve=>proxy.close(resolve));}
});

test('concurrent remote MFA activation never clears an activated secret',async()=>{
  const databaseUrl=process.env.TEST_DATABASE_URL||'http://127.0.0.1:18080';
  assert.ok(['localhost','127.0.0.1'].includes(new URL(databaseUrl).hostname));
  const server=await createApp({databasePath:':memory:',databaseUrl,authToken:'local-test-only',mfaKeyHex:randomBytes(32).toString('hex')});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  async function post(route,body,cookie){return fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});}
  try{
    const account={name:'Concurrent MFA',email:`${randomUUID()}@example.com`,password:'mfa-race-test-password'};
    await post('/api/register',account);const login=await post('/api/login',account),cookie=login.headers.get('set-cookie').split(';')[0];
    const setup=await (await post('/api/mfa/setup',{password:account.password},cookie)).json();
    const code=totpCode(setup.secret,Math.floor(Date.now()/30000));
    const result=await Promise.all([post('/api/mfa/enable',{code},cookie),post('/api/mfa/enable',{code},cookie)]);
    assert.equal(result.filter(r=>r.status===200).length,1);
    assert.equal((await (await fetch(base+'/api/security',{headers:{Cookie:cookie}})).json()).mfaEnabled,true);
  }finally{await server.shutdown();}
});

test('cloud account, session and watchlist survive application replacement', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL || 'http://127.0.0.1:18080';
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname));
  const config = { databasePath: ':memory:', databaseUrl, authToken: 'local-test-only',pushPublicKey:'test-public',pushPrivateKey:'test-private',pushSubject:'mailto:cloud-test@example.com',pushSender:async()=>{} };
  let server, base;
  async function start() {server = await createApp(config);server.listen(0, '127.0.0.1');await once(server, 'listening');base = `http://127.0.0.1:${server.address().port}`;}
  async function stop() {if (!server) return;await server.shutdown();server = null;}
  const credentials = { name: 'Cloud persistence', email: `${randomUUID()}@example.com`, password: 'persist-remotely-test-password' };
  const post = (route, data, cookie) => fetch(base + route, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data) });
  let cookie;
  try {
    await start();assert.equal((await post('/api/register', credentials)).status, 201);
    const login = await post('/api/login', credentials);assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];const account = await login.json();account.state.watchlist = ['AAPL'];
    const save = () => fetch(base + '/api/state', { method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ userId: account.user.id, revision: account.revision, state: account.state }) });
    const simultaneous = await Promise.all([save(), save()]);
    assert.deepEqual(simultaneous.map((r) => r.status).sort(), [200, 409]);
    const setup=await post('/api/onboarding',{action:'complete',userId:account.user.id,revision:1,state:account.state},cookie);assert.equal(setup.status,200);
    const other=await post('/api/login',credentials),otherCookie=other.headers.get('set-cookie').split(';')[0];
    const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/cloud-session-'+randomUUID(),keys:{p256dh:Buffer.alloc(65,7).toString('base64url'),auth:Buffer.alloc(16,3).toString('base64url')}};
    assert.equal((await post('/api/push/subscribe',subscription,otherCookie)).status,200);
    await stop();await start();
    const session = await (await fetch(base + '/api/session', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(session.state?.watchlist, ['AAPL']);assert.equal(session.revision, 2);assert.equal(session.onboarding.status,'completed');
    const devices=await (await fetch(base+'/api/sessions',{headers:{Cookie:cookie}})).json();assert.equal(devices.sessions.length,2);
    assert.equal((await post('/api/sessions/revoke-others',{},cookie)).status,200);
    assert.equal((await (await fetch(base+'/api/session',{headers:{Cookie:otherCookie}})).json()).user,null);
    assert.equal((await (await fetch(base+'/api/push/status',{headers:{Cookie:cookie}})).json()).subscriptions,0);
  } finally {
    if (server && cookie) await post('/api/account/delete', { ...credentials, confirm: credentials.email }, cookie);
    await stop();
  }
});

test('overlapping cloud startups apply market feed migration once without losing preferences',async()=>{
 const databaseUrl=process.env.TEST_DATABASE_URL||'http://127.0.0.1:18080';assert.ok(['127.0.0.1','localhost'].includes(new URL(databaseUrl).hostname));
 const original=await createApp({databaseUrl,authToken:'local-test-only'});original.listen(0,'127.0.0.1');await once(original,'listening');const base=`http://127.0.0.1:${original.address().port}`;
 const email=`${randomUUID()}@example.com`,password='bootstrap-test-password';
 await fetch(base+'/api/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'Bootstrap race',email,password})});await original.shutdown();
 const started=await Promise.allSettled([createApp({databaseUrl,authToken:'local-test-only',quoteApiKey:'fixture'}),createApp({databaseUrl,authToken:'local-test-only',quoteApiKey:'fixture'})]);
 try{assert.equal(started.filter(r=>r.status==='fulfilled').length,2,'both replacing instances start successfully');const db=await openDatabase({databaseUrl,authToken:'local-test-only'});try{const row=await db.get('SELECT s.data,s.revision FROM user_state s JOIN users u ON u.id=s.user_id WHERE u.email=?',[email]);assert.equal(row.revision,1);const state=JSON.parse(row.data);assert.deepEqual(state.watchlist,[]);assert.equal(new Set(state.sources.map(s=>s.url)).size,state.sources.length);}finally{await db.close();}}
 finally{for(const result of started)if(result.status==='fulfilled')await result.value.shutdown();}
});
