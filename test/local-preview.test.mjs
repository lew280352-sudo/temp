import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {createApp} from '../server.mjs';

test('local app remains usable beside a protected HTTPS preview',async t=>{
  const server=createApp({databasePath:':memory:',publicOrigin:'https://preview.example'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(route,{host,origin,body}={})=>new Promise((resolve,reject)=>{
    const req=http.request(base+route,{method:body?'POST':'GET',headers:{...(host?{Host:host}:{}),...(origin?{Origin:origin}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{
      res.resume();res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0]}));
    });
    req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  assert.equal((await fetch(base)).status,200);
  assert.equal((await request('/',{host:'preview.example'})).status,200);
  assert.equal((await request('/',{host:'other.example'})).status,403);
  const account={name:'Local Preview',email:'preview@example.com',password:'correct-test-password'};
  const register=await fetch(base+'/api/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(account)});
  assert.equal(register.status,201);
  const localLogin=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(account)});
  assert.equal(localLogin.status,200);
  assert.doesNotMatch(localLogin.headers.get('set-cookie'),/; Secure/);
  const previewLogin=await request('/api/login',{host:'preview.example',origin:'https://preview.example',body:account});
  assert.equal(previewLogin.status,200);
  assert.match(previewLogin.cookie,/; Secure/);
  const blocked=await request('/api/login',{host:'preview.example',origin:base,body:account});
  assert.equal(blocked.status,403);
});
