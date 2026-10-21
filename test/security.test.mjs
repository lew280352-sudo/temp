import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {createApp} from '../server.mjs';
import {newTotpSecret,totpCode,verifyTotp,encryptSecret,decryptSecret} from '../security.mjs';

test('TOTP uses six-digit time codes and encrypted seeds',()=>{
  const secret=newTotpSecret(),key=randomBytes(32),step=12345678,code=totpCode(secret,step);
  assert.match(secret,/^[A-Z2-7]{32}$/);assert.match(code,/^[0-9]{6}$/);
  assert.equal(verifyTotp(secret,code,{now:step*30000}),step);
  assert.equal(verifyTotp(secret,code,{now:step*30000,lastStep:step}),null,'same step cannot be reused');
  const encrypted=encryptSecret(secret,key);assert.ok(!encrypted.includes(secret));assert.equal(decryptSecret(encrypted,key),secret);
  assert.throws(()=>decryptSecret(encrypted,randomBytes(32)));
});

test('MFA requires the second factor, prevents replay, and account deletion removes sessions',async t=>{
  const server=createApp({databasePath:':memory:',mfaKeyHex:randomBytes(32).toString('hex')});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,{method='GET',body,cookie}={}){
    const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const account={name:'Test Investor',email:'mfa@example.com',password:'correct-test-password'};
  const created=await call('/api/register',{method:'POST',body:account});assert.equal(created.status,201);
  const login=await call('/api/login',{method:'POST',body:account});assert.equal(login.status,200);
  const cookie=login.cookie;
  const setup=await call('/api/mfa/setup',{method:'POST',cookie,body:{password:account.password}});
  assert.equal(setup.status,200);assert.match(setup.data.url,/^otpauth:\/\/totp\//);
  const step=Math.floor(Date.now()/30000),code=totpCode(setup.data.secret,step);
  assert.equal((await call('/api/mfa/enable',{method:'POST',cookie,body:{code}})).status,200);
  assert.equal((await call('/api/security',{cookie})).data.mfaEnabled,true);
  assert.equal((await call('/api/login',{method:'POST',body:account})).status,401,'password alone cannot log in');
  assert.equal((await call('/api/login',{method:'POST',body:{...account,totp:code}})).status,401,'setup code cannot be replayed');
  const next=totpCode(setup.data.secret,step+1);
  const loginWithMfa=await call('/api/login',{method:'POST',body:{...account,totp:next}});assert.equal(loginWithMfa.status,200);
  assert.equal((await call('/api/login',{method:'POST',body:{...account,totp:next}})).status,401,'login code cannot be replayed');
  assert.equal((await call('/api/account/delete',{method:'POST',cookie:loginWithMfa.cookie,body:{confirm:account.email,password:'bad'}})).status,401);
  assert.equal((await call('/api/recover',{method:'POST',body:{email:account.email,code:created.data.recoveryCode,password:'new-test-password'}})).status,200,'recovery code can reset MFA');
  assert.equal((await call('/api/session',{cookie:loginWithMfa.cookie})).data.user,null);
});

test('deleting an account requires reauthentication and revokes all sessions',async t=>{
  const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,{method='GET',body,cookie}={}){
    const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const account={name:'Delete User',email:'delete@example.com',password:'correct-test-password'};
  assert.equal((await call('/api/register',{method:'POST',body:account})).status,201);
  const first=await call('/api/login',{method:'POST',body:account}),second=await call('/api/login',{method:'POST',body:account});
  assert.equal((await call('/api/account/delete',{method:'POST',cookie:first.cookie,body:{confirm:account.email,password:'wrong'}})).status,401);
  assert.equal((await call('/api/account/delete',{method:'POST',cookie:first.cookie,body:{confirm:'wrong@example.com',password:account.password}})).status,400);
  assert.equal((await call('/api/account/delete',{method:'POST',cookie:first.cookie,body:{confirm:account.email,password:account.password}})).status,200);
  assert.equal((await call('/api/session',{cookie:first.cookie})).data.user,null);
  assert.equal((await call('/api/session',{cookie:second.cookie})).data.user,null);
  assert.equal((await call('/api/login',{method:'POST',body:account})).status,401);
});
