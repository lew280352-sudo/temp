import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../database.mjs';
import {createAuthLimiter,clientAddress} from '../rate-limit.mjs';

test('authentication limit persists across restart and cannot be bypassed by switching addresses',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'stocklens-limits-')),file=path.join(dir,'limits.sqlite');
  let db=await openDatabase({databasePath:file});
  try{
    let limiter=await createAuthLimiter(db);
    for(let i=0;i<10;i++)await limiter.consume({peerAddress:'127.0.0.1',email:'one@example.com',now:1000});
    await db.close();db=await openDatabase({databasePath:file});limiter=await createAuthLimiter(db);
    await assert.rejects(limiter.consume({peerAddress:'192.0.2.1',email:'one@example.com',now:1001}),e=>e.status===429);
    await limiter.consume({peerAddress:'127.0.0.1',email:'another@example.com',now:1001});
    await limiter.consume({peerAddress:'127.0.0.1',email:'one@example.com',now:901001});
    assert.doesNotMatch(JSON.stringify(await db.all('SELECT * FROM auth_limits')),/one@example/);
  }finally{await db.close();rmSync(dir,{recursive:true});}
});

test('forwarded headers are ignored unless trusted hops are explicit and rightmost addresses are validated',()=>{
  assert.equal(clientAddress('127.0.0.1','spoofed, 192.0.2.10',0),'127.0.0.1');
  assert.equal(clientAddress('127.0.0.1','198.51.100.99, 192.0.2.10',1),'192.0.2.10');
  assert.equal(clientAddress('127.0.0.1','198.51.100.99, not-an-ip',1),'127.0.0.1');
  assert.equal(clientAddress('127.0.0.1','2001:db8::1',1),'2001:db8::1');
});


test('token verification without an account key does not impose a shared ten-attempt account limit',async()=>{
  const db=await openDatabase({databasePath:':memory:'});
  try{
    const limiter=await createAuthLimiter(db);
    for(let i=0;i<20;i++)await limiter.consume({peerAddress:'192.0.2.1',now:1000});
  }finally{await db.close();}
});
