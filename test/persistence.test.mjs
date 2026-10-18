import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync,backup} from 'node:sqlite';
import {createApp} from '../server.mjs';

test('database survives restart, backups retain data, passwords are hashed and expired sessions are rejected',async()=>{
  const parent=realpathSync(os.tmpdir()),directory=mkdtempSync(path.join(parent,'stocklens-test-')),file=path.join(directory,'test.sqlite');
  let server;
  try{
    async function start(){server=createApp({databasePath:file});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
    let base=await start();
    const credentials={name:'Persistent',email:'persist@example.com',password:'password-for-restart-test'};
    const post=(route,data)=>fetch(base+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await post('/api/register',credentials)).status,201);
    const login=await post('/api/login',credentials),cookie=login.headers.get('set-cookie').split(';')[0];
    const account=await login.json();account.state.holdings=[{symbol:'PTT',qty:42,cost:31}];
    assert.equal((await fetch(base+'/api/state',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({userId:account.user.id,revision:0,state:account.state})})).status,200);
    await new Promise(resolve=>server.close(resolve));server=null;base=await start();
    const session=await (await fetch(base+'/api/session',{headers:{Cookie:cookie}})).json();assert.equal(session.state.holdings[0].qty,42);assert.equal(session.revision,1);
    const db=new DatabaseSync(file);
    try{
      const row=db.prepare('SELECT * FROM users').get();assert.notEqual(row.password_hash,credentials.password);assert.match(row.password_hash,/^[a-f0-9]{128}$/);assert.match(row.salt,/^[a-f0-9]{32}$/);
      const destination=path.join(directory,'backup.sqlite');await backup(db,destination);
      const copy=new DatabaseSync(destination,{readOnly:true});try{assert.equal(JSON.parse(copy.prepare('SELECT data FROM user_state').get().data).holdings[0].qty,42);}finally{copy.close();}
      db.prepare('UPDATE sessions SET expires_at=0').run();
    }finally{db.close();}
    assert.equal((await (await fetch(base+'/api/session',{headers:{Cookie:cookie}})).json()).user,null);
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));
    const resolved=realpathSync(directory);assert.ok(resolved.startsWith(parent+path.sep)&&path.basename(resolved).startsWith('stocklens-test-'));
    rmSync(resolved,{recursive:true});
  }
});
test('invalid deployment origins fail early',()=>{
  for(const publicOrigin of ['not-a-url','https://user:secret@example.com','https://example.com/path','file:///example'])assert.throws(()=>createApp({databasePath:':memory:',publicOrigin}));
});
