import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server.mjs';
import {createLoginOtp} from '../login-otp.mjs';

const mailConfig={smtpHost:'smtp.example',smtpUser:'sender@example.com',smtpPass:'fixture',smtpFrom:'sender@example.com'};

test('email login requires a delivered single-use code after a correct password',async t=>{
  const sent=[];
  const server=createApp({databasePath:':memory:',emailLoginEnabled:true,...mailConfig,emailSender:async message=>sent.push(message)});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(route,{body,cookie}={}){
    const response=await fetch(base+route,{method:'POST',headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'},body:JSON.stringify(body||{})});
    return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  const account={name:'Email User',email:'mail@example.com',password:'correct-test-password'};
  assert.equal((await call('/api/register',{body:account})).status,201);
  assert.equal((await call('/api/login',{body:{email:account.email,password:'wrong-password'}})).status,401);
  assert.equal(sent.length,0);
  const first=await call('/api/login',{body:account});
  assert.equal(first.status,202);assert.equal(first.data.factor,'email');assert.equal(first.cookie,null);
  assert.equal(sent.length,1);assert.equal(sent[0].to,account.email);
  const code=sent[0].text.match(/\b\d{6}\b/)[0];
  assert.equal((await call('/api/login',{body:account})).status,429,'email cannot be spammed');
  assert.equal((await call('/api/login/verify',{body:{challengeId:first.data.challengeId,code:'000000'}})).status,401);
  const valid=await call('/api/login/verify',{body:{challengeId:first.data.challengeId,code}});
  assert.equal(valid.status,200);assert.equal(valid.data.user.email,account.email);assert.match(valid.cookie,/HttpOnly/);
  assert.equal((await call('/api/login/verify',{body:{challengeId:first.data.challengeId,code}})).status,401,'code is single-use');
});

test('email login code expires, stops after five guesses, and failed delivery leaves no challenge',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY)');db.prepare('INSERT INTO users VALUES(?)').run('u1');
  let now=Date.now(),sent;
  const service=createLoginOtp(db,{enabled:true,...mailConfig,now:()=>now,sender:async message=>{sent=message;}});
  try{
    const user={id:'u1',email:'user@example.com'};
    const first=await service.request(user),code=sent.text.match(/\b\d{6}\b/)[0];
    const wrong=code==='000000'?'111111':'000000';
    for(let i=0;i<5;i++)assert.equal(service.verify(first.challengeId,wrong),null);
    assert.equal(service.verify(first.challengeId,code),null,'five guesses close the challenge');
    now+=60001;
    const second=await service.request(user),secondCode=sent.text.match(/\b\d{6}\b/)[0];
    now+=10*60*1000+1;
    assert.equal(service.verify(second.challengeId,secondCode),null,'expired code is rejected');
    const failed=createLoginOtp(db,{enabled:true,...mailConfig,now:()=>now,sender:async()=>{throw new Error('offline');}});
    await assert.rejects(failed.request(user),/offline/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM login_otp').get().count,0,'failed challenge is removed');
    failed.close();
  }finally{service.close();db.close();}
});
