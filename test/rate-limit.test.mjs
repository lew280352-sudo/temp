import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';

async function setup(t){
  const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  return (endpoint,payload)=>fetch(origin+endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});
}
test('twenty users on one IP can register and login without disabling rate limits',async t=>{
  const post=await setup(t);
  const users=Array.from({length:20},(_,i)=>({name:`User ${i}`,email:`user${i}@example.com`,password:`correct-password-${i}`}));
  const registered=await Promise.all(users.map(u=>post('/api/register',u)));for(const r of registered)assert.equal(r.status,201);
  const loggedIn=await Promise.all(users.map(u=>post('/api/login',u)));for(const r of loggedIn)assert.equal(r.status,200);
});
test('one account remains limited while a different account on the IP can login',async t=>{
  const post=await setup(t),u={name:'Target',email:'target@example.com',password:'correct-password'};
  assert.equal((await post('/api/register',u)).status,201);
  for(let i=0;i<9;i++)assert.equal((await post('/api/login',{email:' TARGET@example.com ',password:'wrong-password'})).status,401);
  assert.equal((await post('/api/login',u)).status,429);
  const other={...u,email:'other@example.com'};assert.equal((await post('/api/register',other)).status,201);assert.equal((await post('/api/login',other)).status,200);
});
test('IP limit still caps attempts spread over many account names',async t=>{
  const post=await setup(t);
  // Invalid payloads exercise counters without spending time hashing 200 passwords.
  for(let i=0;i<200;i++)assert.equal((await post('/api/register',{email:`address${i}@example.com`})).status,400);
  assert.equal((await post('/api/register',{email:'another@example.com'})).status,429);
});
