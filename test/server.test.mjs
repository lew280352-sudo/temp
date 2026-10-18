import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp,initialState,normalizeSourceUrl} from '../server.mjs';

test('registration, sessions, isolated portfolios, source validation and logout',async t=>{
  const server=createApp({databasePath:':memory:'});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const sessions=new Map();
  async function call(route,{method='GET',body,cookie,origin=base,revision,expectedUserId}={}){
    const payload=route==='/api/state'?{state:body,revision:revision??sessions.get(cookie)?.revision??0,userId:expectedUserId??sessions.get(cookie)?.id}:body;
    const response=await fetch(base+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(payload):undefined});
    const result={status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
    if(result.data.user)sessions.set(result.cookie?.split(';')[0]||cookie,{id:result.data.user.id,revision:result.data.revision});
    if(result.data.ok&&route==='/api/state')sessions.get(cookie).revision=result.data.revision;
    return result;
  }
  const alice={name:'Alice',email:'Alice@example.com',password:'correct-test-password'};
  assert.equal((await call('/api/session')).data.user,null);
  assert.equal((await call('/api/state',{method:'PUT',body:initialState()})).status,401);
  assert.equal((await call('/api/register',{method:'POST',body:alice,origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/register',{method:'POST',body:{...alice,password:'short'}})).status,400);
  assert.equal((await call('/api/register',{method:'POST',body:alice})).status,201);
  assert.equal((await call('/api/register',{method:'POST',body:{...alice,email:'alice@example.com'}})).status,409);
  assert.equal((await call('/api/login',{method:'POST',body:{...alice,password:'wrong'}})).status,401);
  const login=await call('/api/login',{method:'POST',body:alice});assert.equal(login.status,200);
  assert.match(login.cookie,/HttpOnly/);assert.match(login.cookie,/SameSite=Strict/);
  assert.equal(login.data.user.email,'alice@example.com');assert.equal(login.data.state.holdings.length,0);
  const cookie=login.cookie.split(';')[0];
  assert.equal((await call('/api/session',{cookie})).data.user.name,'Alice');
  const state=login.data.state;state.holdings=[{symbol:'PTT',qty:300,cost:32}];
  state.sources.push({id:'example',name:'My source',url:'https://example.com/news#top',type:'partner',symbol:'PTT',enabled:true});
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state})).status,200);
  const saved=(await call('/api/session',{cookie})).data.state;assert.equal(saved.holdings[0].qty,300);assert.equal(saved.sources.at(-1).url,'https://example.com/news');
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state,revision:0})).status,409,'stale tab cannot overwrite current data');
  for(const url of ['javascript:alert(1)','http://127.0.0.1/private','https://user:secret@example.com']){const bad=structuredClone(state);bad.sources.at(-1).url=url;assert.equal((await call('/api/state',{method:'PUT',cookie,body:bad})).status,400);}
  const duplicate=structuredClone(state);duplicate.sources.push({...duplicate.sources[0],id:'duplicate'});assert.equal((await call('/api/state',{method:'PUT',cookie,body:duplicate})).status,400);
  const invalid=structuredClone(state);invalid.holdings[0].qty=-1;assert.equal((await call('/api/state',{method:'PUT',cookie,body:invalid})).status,400);
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state,origin:'https://evil.example'})).status,403);
  const bob={name:'Bob',email:'bob@example.com',password:'different-test-password'};await call('/api/register',{method:'POST',body:bob});
  const bobLogin=await call('/api/login',{method:'POST',body:bob});assert.equal(bobLogin.data.state.holdings.length,0);assert.equal(bobLogin.data.state.sources.length,3);
  const bobCookie=bobLogin.cookie.split(';')[0];
  assert.equal((await call('/api/state',{method:'PUT',cookie:bobCookie,body:state,expectedUserId:login.data.user.id})).status,409,'account switch cannot write Alice data to Bob');
  assert.equal((await call('/api/session',{cookie:bobCookie})).data.state.holdings.length,0);
  const exported=await call('/api/export',{cookie});assert.equal(exported.status,200);assert.equal(exported.data.state.holdings[0].qty,300);assert.doesNotMatch(JSON.stringify(exported.data),/password_hash|token_hash|salt/);
  const logout=await call('/api/logout',{method:'POST',cookie,body:{}});assert.equal(logout.status,200);assert.match(logout.cookie,/Max-Age=0/);
  assert.equal((await call('/api/session',{cookie})).data.user,null);
  assert.equal((await call('/api/state',{method:'PUT',cookie,body:state})).status,401);
  assert.equal((await call('/api/export',{cookie})).status,401);
  const relogin=await call('/api/login',{method:'POST',body:alice});assert.equal(relogin.data.state.holdings[0].qty,300);
  assert.equal((await fetch(base+'/.data/stocklens.sqlite')).status,404);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
  for(const file of ['/','/app.js','/auth.js','/theme.css'])assert.equal((await fetch(base+file)).status,200);
});
test('URL normalization preserves public source links',()=>{
  assert.equal(normalizeSourceUrl('https://example.com/news#section'),'https://example.com/news');
  for(const url of ['file:///etc/passwd','data:text/html,x','https://127.1','http://192.168.1.2','http://localhost:4173','ftp://example.com'])assert.throws(()=>normalizeSourceUrl(url));
});
