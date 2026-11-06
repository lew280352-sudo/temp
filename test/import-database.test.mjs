import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openDatabase} from '../database.mjs';
import {initializeSchema} from '../schema.mjs';
import {encryptSecret} from '../security.mjs';
import {importToDatabase} from '../scripts/import-database.mjs';

test('account import preserves hashes and preferences, drops sessions and refuses an occupied destination',async()=>{
  const fixtureId=randomUUID();
  const dir=mkdtempSync(path.join(tmpdir(),'stocklens-import-')),sourcePath=path.join(dir,'source.sqlite'),source=new DatabaseSync(sourcePath);
  source.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,salt TEXT,password_hash TEXT,created_at INTEGER); CREATE TABLE user_state(user_id TEXT PRIMARY KEY,data TEXT,revision INTEGER); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER)');
  source.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(fixtureId,'one@example.com','ไทย','a'.repeat(32),'b'.repeat(128),100);
  source.prepare('INSERT INTO user_state VALUES(?,?,?)').run(fixtureId,JSON.stringify({holdings:[{symbol:'AAPL',qty:5,cost:100}],sources:[],alerts:{daily:true,news:true,trend:true,time:'08:00',scope:'portfolio'}}),3);
  source.exec('CREATE TABLE user_mfa(user_id TEXT PRIMARY KEY,secret TEXT,pending_secret TEXT,pending_until INTEGER,last_step INTEGER)');
  source.prepare('INSERT INTO user_mfa VALUES(?,?,?,?,?)').run(fixtureId,encryptSecret('JBSWY3DPEHPK3PXP',Buffer.from('c'.repeat(64),'hex')),'pending-old',9999999999999,5);
  source.prepare('INSERT INTO sessions VALUES(?,?,?)').run('old-session',fixtureId,9999999999999);source.close();
  const remote=process.env.TEST_IMPORT_DATABASE_URL||'';
  if(remote)assert.ok(['127.0.0.1','localhost'].includes(new URL(remote).hostname));
  const target=await openDatabase({databasePath:':memory:',databaseUrl:remote,authToken:remote?'local-import-test':''});await initializeSchema(target);
  try{
    await assert.rejects(importToDatabase(sourcePath,target),/original MFA/);
    assert.equal((await target.get('SELECT COUNT(*) AS n FROM users')).n,0);
    await assert.rejects(importToDatabase(sourcePath,target,{mfaKeyHex:'d'.repeat(64)}),/does not decrypt/);
    const result=await importToDatabase(sourcePath,target,{mfaKeyHex:'c'.repeat(64)});
    const mfa=await target.get('SELECT * FROM user_mfa');assert.ok(mfa.secret);assert.equal(mfa.pending_secret,null);assert.equal(mfa.last_step,5);
    assert.equal(result.users,1);assert.equal((await target.get('SELECT password_hash FROM users')).password_hash,'b'.repeat(128));
    const state=await target.get('SELECT data,revision FROM user_state');assert.deepEqual(JSON.parse(state.data).watchlist,['AAPL']);assert.doesNotMatch(state.data,/qty|cost|holdings/);assert.equal(state.revision,3);
    assert.equal((await target.get('SELECT COUNT(*) AS n FROM sessions')).n,0);
    await assert.rejects(importToDatabase(sourcePath,target,{mfaKeyHex:'c'.repeat(64)}),/empty|occupied/i);
    assert.equal((await target.get('SELECT COUNT(*) AS n FROM users')).n,1);
  }finally{await target.run('DELETE FROM users WHERE id=?',[fixtureId]);await target.close();rmSync(dir,{recursive:true});}
});

test('an import error rolls back every account written by that import',async()=>{
  const fixtureId=randomUUID();
  const dir=mkdtempSync(path.join(tmpdir(),'stocklens-import-fail-')),sourcePath=path.join(dir,'bad.sqlite'),source=new DatabaseSync(sourcePath);
  source.exec('CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,salt TEXT,password_hash TEXT,created_at INTEGER); CREATE TABLE user_state(user_id TEXT PRIMARY KEY,data TEXT,revision INTEGER)');
  source.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(fixtureId,'bad@example.com','Bad','a'.repeat(32),'b'.repeat(128),100);
  source.prepare('INSERT INTO user_state VALUES(?,?,?)').run(fixtureId,'not-json',0);source.close();
  const remote=process.env.TEST_IMPORT_DATABASE_URL||'';
  if(remote)assert.ok(['127.0.0.1','localhost'].includes(new URL(remote).hostname));
  const target=await openDatabase({databasePath:':memory:',databaseUrl:remote,authToken:remote?'local-import-test':''});await initializeSchema(target);
  try{
    await assert.rejects(importToDatabase(sourcePath,target));
    assert.equal((await target.get('SELECT COUNT(*) AS n FROM users')).n,0);
  }finally{await target.run('DELETE FROM users WHERE id=?',[fixtureId]);await target.close();rmSync(dir,{recursive:true});}
});
