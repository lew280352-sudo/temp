import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';

test('recovery codes rotate, are one-time, revoke sessions and retain news preferences',async t=>{
  const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(route,payload,cookie,method=payload?'POST':'GET'){
    const r=await fetch(base+route,{method,headers:{Origin:base,...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:payload?JSON.stringify(payload):undefined});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  const account={name:'Recovery User',email:'recovery@example.com',password:'initial-password'};
  const register=await request('/api/register',account);assert.equal(register.status,201);assert.match(register.data.recoveryCode,/^[a-f0-9]{48}$/);
  const login=await request('/api/login',account),cookie=login.cookie;
  const next=login.data.state;next.watchlist=['AAPL'];
  assert.equal((await request('/api/state',{state:next,userId:login.data.user.id,revision:0},cookie,'PUT')).status,200);
  assert.equal((await request('/api/news')).status,401);assert.equal((await request('/api/news',null,cookie)).status,200);
  assert.equal((await request('/api/recover',{email:account.email,code:'wrong',password:'new-password'})).status,401);
  const recovered=await request('/api/recover',{email:account.email,code:register.data.recoveryCode,password:'new-password'});assert.equal(recovered.status,200);assert.notEqual(recovered.data.recoveryCode,register.data.recoveryCode);
  assert.equal((await request('/api/session',null,cookie)).data.user,null);
  assert.equal((await request('/api/recover',{email:account.email,code:register.data.recoveryCode,password:'new-password-2'})).status,401);
  assert.equal((await request('/api/login',account)).status,401);
  const newLogin=await request('/api/login',{...account,password:'new-password'});assert.equal(newLogin.status,200);assert.deepEqual(newLogin.data.state.watchlist,['AAPL']);
  const rotated=await request('/api/recovery-code',{password:'new-password'},newLogin.cookie);assert.equal(rotated.status,200);
  assert.equal((await request('/api/recover',{email:account.email,code:recovered.data.recoveryCode,password:'new-password-2'})).status,401);
  const exported=await request('/api/export',null,newLogin.cookie);assert.doesNotMatch(JSON.stringify(exported.data),/recoveryCode|code_hash/);assert.ok(!JSON.stringify(exported.data).includes(rotated.data.recoveryCode));
});
