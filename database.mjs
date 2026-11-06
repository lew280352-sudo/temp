import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createClient} from '@libsql/client';

// Both drivers expose promises. A single queue prevents an unrelated local
// statement from accidentally participating in a transaction across an await.
export async function openDatabase({databasePath=':memory:',databaseUrl='',authToken='',remoteClientFactory=createClient}={}){
  let native,client;
  if(databaseUrl){
    let url;try{url=new URL(databaseUrl);}catch{throw new Error('Invalid remote database URL');}
    if(url.username||url.password||!['libsql:','https:','http:'].includes(url.protocol)||(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Remote database URL must use TLS');
    if(!authToken.trim())throw new Error('Remote database requires an auth token');
    client=remoteClientFactory({url:databaseUrl,authToken});
    try{await client.execute({sql:'SELECT 1',args:[]});}catch{client.close();throw new Error('Remote database unavailable');}
  }else{
    if(databasePath!==':memory:')mkdirSync(path.dirname(path.resolve(databasePath)),{recursive:true});
    native=new DatabaseSync(databasePath);
    native.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  }
  let queue=Promise.resolve(),closing=false;
  function enqueue(work){
    if(closing)return Promise.reject(new Error('Database is closed'));
    const result=queue.then(work);queue=result.catch(()=>{});return result;
  }
  function operations(executor){
    return {
      async get(sql,args=[]){if(native)return {...(native.prepare(sql).get(...args)||{})};return (await executor.execute({sql,args})).rows[0];},
      async all(sql,args=[]){if(native)return native.prepare(sql).all(...args).map(row=>({...row}));return (await executor.execute({sql,args})).rows.map(row=>({...row}));},
      async run(sql,args=[]){if(native)return native.prepare(sql).run(...args);const r=await executor.execute({sql,args});return {changes:r.rowsAffected,lastInsertRowid:r.lastInsertRowid};},
      async exec(statements){for(const sql of statements){if(native)native.exec(sql);else await executor.execute({sql,args:[]});}}
    };
  }
  const raw=operations(client),db={};
  // Missing rows must stay undefined (not an empty object) for auth checks.
  if(native)raw.get=async(sql,args=[])=>{const row=native.prepare(sql).get(...args);return row?{...row}:undefined;};
  for(const key of ['get','all','run','exec'])db[key]=(...args)=>enqueue(()=>raw[key](...args));
  db.transaction=fn=>enqueue(async()=>{
    let tx,active=true;
    if(native)native.exec('BEGIN IMMEDIATE');else tx=await client.transaction('write');
    const scoped=operations(tx),handle={};
    if(native)scoped.get=raw.get;
    for(const key of ['get','all','run','exec'])handle[key]=(...args)=>{
      if(!active)return Promise.reject(new Error('Transaction is closed'));
      return scoped[key](...args);
    };
    try{
      const value=await fn(handle);
      if(native)native.exec('COMMIT');else await tx.commit();
      return value;
    }catch(error){
      try{if(native)native.exec('ROLLBACK');else await tx.rollback();}catch{}
      throw error;
    }finally{active=false;tx?.close();}
  });
  db.close=async()=>{if(closing)return queue;closing=true;await queue;native?.close();client?.close();};
  return db;
}
