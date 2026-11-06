import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createApp} from '../server.mjs';
import {openDatabase} from '../database.mjs';

async function fixture(t,options={}){
 const dir=mkdtempSync(path.join(tmpdir(),'stocklens-account-tools-')),databasePath=path.join(dir,'test.sqlite');let server,base;
 async function start(){server=await createApp({databasePath,...options});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;}
 async function stop(){await server?.shutdown();server=null;}
 await start();t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 async function call(route,{method='GET',data,cookie,ua='Mozilla/5.0 Chrome/130.0 Windows NT 10.0',origin=base}={}){
  const response=await fetch(base+route,{method,headers:{Origin:origin,'User-Agent':ua,...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 }
 async function account(email='tools@example.com'){
  const credentials={name:'Account tools tester',email,password:'account-tools-test-password'};
  assert.equal((await call('/api/register',{method:'POST',data:credentials})).status,201);
  const login=await call('/api/login',{method:'POST',data:credentials});assert.equal(login.status,200);return {...login,credentials};
 }
 return {call,account,databasePath,restart:async()=>{await stop();await start();}};
}

test('onboarding saves preferences and completion together, survives restart, and preserves conflicting drafts',async t=>{
 const f=await fixture(t),a=await f.account(),cookie=a.cookie;
 assert.equal(a.data.onboarding.needed,true);
 const state=structuredClone(a.data.state);state.watchlist=['AAPL','NVDA'];state.sources[0].enabled=false;
 assert.equal((await f.call('/api/onboarding',{method:'POST',data:{action:'complete',userId:a.data.user.id,revision:0,state}})).status,401);
 const wrong=await f.call('/api/onboarding',{method:'POST',cookie,data:{action:'complete',userId:'other-user',revision:0,state}});assert.equal(wrong.status,409);
 const conflict=await f.call('/api/onboarding',{method:'POST',cookie,data:{action:'complete',userId:a.data.user.id,revision:99,state}});assert.equal(conflict.status,409);
 assert.equal((await f.call('/api/session',{cookie})).data.onboarding.needed,true);
 const saved=await f.call('/api/onboarding',{method:'POST',cookie,data:{action:'complete',userId:a.data.user.id,revision:0,state}});assert.equal(saved.status,200);assert.equal(saved.data.onboarding.needed,false);assert.equal(saved.data.revision,1);
 await f.restart();const restored=await f.call('/api/session',{cookie});assert.deepEqual(restored.data.state.watchlist,['AAPL','NVDA']);assert.equal(restored.data.state.sources[0].enabled,false);assert.equal(restored.data.onboarding.status,'completed');
});

test('skipping onboarding does not rewrite preferences and legacy accounts are not forced into first use',async t=>{
 const f=await fixture(t),a=await f.account();
 const skipped=await f.call('/api/onboarding',{method:'POST',cookie:a.cookie,data:{action:'skip',userId:a.data.user.id}});assert.equal(skipped.status,200);assert.equal(skipped.data.onboarding.status,'skipped');assert.equal(skipped.data.revision,0);assert.deepEqual(skipped.data.state,a.data.state);
 const db=await openDatabase({databasePath:f.databasePath});await db.run('DELETE FROM user_onboarding WHERE user_id=?',[a.data.user.id]);await db.run('DELETE FROM session_devices');await db.run("DELETE FROM schema_migrations WHERE id='account-tools-v1'");await db.close();await f.restart();
 const legacy=await f.call('/api/session',{cookie:a.cookie});assert.equal(legacy.data.user.id,a.data.user.id);assert.equal(legacy.data.onboarding.needed,false);
 const devices=await f.call('/api/sessions',{cookie:a.cookie});assert.equal(devices.status,200);assert.equal(devices.data.sessions.length,1);assert.equal(devices.data.sessions[0].createdAt,null);
});

test('device sessions are private, account-scoped, revocable, and retained after restart',async t=>{
 const f=await fixture(t),a=await f.account(),other=await f.call('/api/login',{method:'POST',data:a.credentials,ua:'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1'}),b=await f.account('separate@example.com');
 assert.equal((await f.call('/api/sessions')).status,401);
 const list=await f.call('/api/sessions',{cookie:a.cookie});assert.equal(list.status,200);assert.equal(list.data.sessions.length,2);assert.equal(list.data.sessions.filter(s=>s.current).length,1);
 assert.match(list.data.sessions.find(s=>!s.current).name,/Safari.*iPhone/);
 const serialized=JSON.stringify(list.data);assert.doesNotMatch(serialized,/token_hash|password|salt|ipAddress|user_agent/);assert.ok(!serialized.includes(a.cookie.split('=')[1]));
 const target=list.data.sessions.find(s=>!s.current);
 assert.equal((await f.call('/api/sessions/revoke',{method:'POST',cookie:b.cookie,data:{id:target.id}})).status,404);
 assert.equal((await f.call('/api/sessions/revoke',{method:'POST',cookie:a.cookie,origin:'https://evil.example',data:{id:target.id}})).status,403);
 await f.restart();assert.equal((await f.call('/api/sessions',{cookie:a.cookie})).data.sessions.find(s=>!s.current).id,target.id);
 assert.equal((await f.call('/api/sessions/revoke',{method:'POST',cookie:a.cookie,data:{id:target.id}})).status,200);
 assert.equal((await f.call('/api/session',{cookie:other.cookie})).data.user,null);
 assert.equal((await f.call('/api/session',{cookie:a.cookie})).data.user.id,a.data.user.id);
 assert.equal((await f.call('/api/session',{cookie:b.cookie})).data.user.id,b.data.user.id);
 const self=(await f.call('/api/sessions',{cookie:a.cookie})).data.sessions.find(s=>s.current);
 const revoked=await f.call('/api/sessions/revoke',{method:'POST',cookie:a.cookie,data:{id:self.id}});assert.equal(revoked.data.currentRevoked,true);assert.match(revoked.cookie,/stocklens_session=$/);
 assert.equal((await f.call('/api/sessions',{cookie:a.cookie})).status,401);
});

test('sign out other devices removes their linked Push without disturbing this session or another account',async t=>{
 const sent=[],f=await fixture(t,{pushPublicKey:'test-public',pushPrivateKey:'test-private',pushSubject:'mailto:test@example.com',pushSender:async s=>sent.push(s.endpoint)}),a=await f.account(),other=await f.call('/api/login',{method:'POST',data:a.credentials}),b=await f.account('push-separate@example.com');
 const subscription=n=>({endpoint:'https://fcm.googleapis.com/fcm/send/account-tools-'+n,keys:{p256dh:Buffer.alloc(65,7).toString('base64url'),auth:Buffer.alloc(16,3).toString('base64url')}});
 for(const [cookie,n] of [[a.cookie,1],[other.cookie,2],[b.cookie,3]])assert.equal((await f.call('/api/push/subscribe',{method:'POST',cookie,data:subscription(n)})).status,200);
 assert.equal((await f.call('/api/sessions/revoke-others',{method:'POST',cookie:a.cookie,data:{}})).status,200);
 assert.equal((await f.call('/api/session',{cookie:other.cookie})).data.user,null);
 assert.equal((await f.call('/api/push/status',{cookie:a.cookie})).data.subscriptions,1);assert.equal((await f.call('/api/push/status',{cookie:b.cookie})).data.subscriptions,1);
 await f.call('/api/push/test',{method:'POST',cookie:a.cookie,data:{}});assert.deepEqual(sent,[subscription(1).endpoint]);
 const db=await openDatabase({databasePath:f.databasePath});await db.run('UPDATE sessions SET expires_at=0 WHERE user_id=?',[a.data.user.id]);await db.close();assert.equal((await f.call('/api/sessions',{cookie:a.cookie})).status,401);
});
