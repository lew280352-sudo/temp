import { test } from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';

test('configured remote storage without a token cannot start with a local empty database', async () => {
  await assert.rejects(async () => {
    const server = await createApp({ databasePath: ':memory:', databaseUrl: 'libsql://missing-token.example.turso.io' });
    if (server.shutdown) await server.shutdown();else server.close();
  }, /token/i);
});

test('an actual HTTP authentication failure refuses startup without creating local account storage',async()=>{
 const {createServer}=await import('node:http');const {once}=await import('node:events');
 const rejecting=createServer((req,res)=>{res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"Unauthorized"}');});rejecting.listen(0,'127.0.0.1');await once(rejecting,'listening');
 const dir=mkdtempSync(path.join(tmpdir(),'stocklens-auth-fail-')),local=path.join(dir,'must-not-create.sqlite');
 try{await assert.rejects(createApp({databasePath:local,databaseUrl:`http://127.0.0.1:${rejecting.address().port}`,authToken:'deliberately-invalid-test-token'}),/Remote database unavailable/);assert.equal(existsSync(local),false);}
 finally{await new Promise(resolve=>rejecting.close(resolve));rmSync(dir,{recursive:true});}
});
