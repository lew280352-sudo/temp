import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {createEmailVerification} from '../email-verification.mjs';

test('email verification sends a one-hour single-use link without exposing it in account data',async t=>{
  const sent=[];
  const server=createApp({databasePath:':memory:',emailOrigin:'https://stocklens.example',smtpHost:'smtp.example',smtpUser:'sender',smtpPass:'fixture',smtpFrom:'noreply@example.com',emailSender:async message=>sent.push(message)});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,{method='GET',body,cookie}={}){
    const response=await fetch(base+route,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const account={name:'Mail User',email:'mail@example.com',password:'correct-test-password'};
  assert.equal((await call('/api/register',{method:'POST',body:account})).status,201);
  const login=await call('/api/login',{method:'POST',body:account});assert.equal(login.status,200);
  assert.equal((await call('/api/security',{cookie:login.cookie})).data.emailVerified,false);
  assert.equal((await call('/api/email/send-verification',{method:'POST',cookie:login.cookie,body:{}})).status,200);
  assert.equal(sent.length,1);assert.equal(sent[0].to,account.email);
  const token=new URL(sent[0].text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
  assert.match(token,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify((await call('/api/export',{cookie:login.cookie})).data).includes(token));
  assert.equal((await call('/api/email/send-verification',{method:'POST',cookie:login.cookie,body:{}})).status,429,'resend is rate limited');
  assert.equal((await call('/api/email/verify',{method:'POST',body:{token}})).status,200);
  assert.equal((await call('/api/email/verify',{method:'POST',body:{token}})).status,400,'link cannot be reused');
  assert.equal((await call('/api/security',{cookie:login.cookie})).data.emailVerified,true);
});

test('email verification link expires and failed delivery does not leave a usable token',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY)');db.prepare('INSERT INTO users VALUES(?)').run('u1');
  let now=Date.parse('2026-10-21T12:00:00Z'),message;
  const service=createEmailVerification(db,{origin:'https://stocklens.example',smtpHost:'smtp.example',smtpUser:'sender',smtpPass:'fixture',smtpFrom:'noreply@example.com',now:()=>now,sender:async mail=>{message=mail;}});
  try{
    await service.request({id:'u1',email:'user@example.com'});
    const token=new URL(message.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
    now+=3600001;assert.equal(service.verify(token),false);
    const failed=createEmailVerification(db,{origin:'https://stocklens.example',smtpHost:'smtp.example',smtpUser:'sender',smtpPass:'fixture',smtpFrom:'noreply@example.com',now:()=>now,sender:async mail=>{message=mail;throw new Error('offline');}});
    await assert.rejects(failed.request({id:'u1',email:'user@example.com'}),/offline/);
    const failedToken=new URL(message.text.match(/https:\/\/\S+/)[0]).searchParams.get('token');
    assert.equal(failed.verify(failedToken),false);
    failed.close();
  }finally{service.close();db.close();}
});
