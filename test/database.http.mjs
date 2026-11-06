import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../database.mjs';

test('real libSQL HTTP driver commits, rolls back and persists after reconnect',async()=>{
  const databaseUrl=process.env.TEST_DATABASE_URL||'http://127.0.0.1:18080';
  assert.ok(['127.0.0.1','localhost'].includes(new URL(databaseUrl).hostname),'integration test requires a local isolated server');
  const config={databaseUrl,authToken:'local-test-only'};
  const table='test_'+randomUUID().replaceAll('-','');
  let db=await openDatabase(config);
  try{
    await db.exec([`CREATE TABLE ${table}(id TEXT PRIMARY KEY,value TEXT)`]);
    const result=await db.transaction(tx=>tx.run(`INSERT INTO ${table} VALUES(?,?)`,['saved','ไทย']));
    assert.equal(result.changes,1);
    await assert.rejects(db.transaction(async tx=>{await tx.run(`INSERT INTO ${table} VALUES(?,?)`,['rollback','no']);throw new Error('cancel');}),/cancel/);
    await db.close();db=await openDatabase(config);
    assert.deepEqual(await db.all(`SELECT id,value FROM ${table}`),[{id:'saved',value:'ไทย'}]);
  }finally{await db.exec([`DROP TABLE ${table}`]);await db.close();}
});
