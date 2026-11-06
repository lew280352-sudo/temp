import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';

test('free-host profile truthfully disables SMTP even when stale mail configuration is present',async()=>{
 const server=await createApp({databasePath:':memory:',hostingProfile:'render-free',emailOrigin:'https://example.com',smtpHost:'smtp.example.com',smtpFrom:'test@example.com',smtpUser:'test',smtpPass:'test-only',emailLoginEnabled:true,emailSender:async()=>{throw new Error('SMTP must stay disabled on this host');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,cookie='')=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
 try{
  const account={name:'Free-host test',email:'free-host@example.com',password:'free-host-test-password'};assert.equal((await post('/api/register',account)).status,201);
  const login=await post('/api/login',account);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const security=await(await fetch(base+'/api/security',{headers:{Cookie:cookie}})).json();assert.equal(security.emailAvailable,false);assert.equal(security.emailLoginEnabled,false);assert.equal(security.hosting.backgroundSleeps,true);
  const push=await(await fetch(base+'/api/push/status',{headers:{Cookie:cookie}})).json();assert.equal(push.backgroundSleeps,true);
 }finally{await server.shutdown();}
});
