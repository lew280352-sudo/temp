import {readdir,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const excluded=new Set(['node_modules','.git','.cache','.npm','.codex','.superpowers','AppData','Windows','Program Files','Program Files (x86)','$Recycle.Bin','test-artifacts']);
export async function findLegacyData(roots,{maxDepth=10}={}){
 const found=[],visited=new Set();let scanned=0;
 async function walk(directory,depth){
  let absolute,entries;try{absolute=await realpath(directory);if(visited.has(absolute))return;visited.add(absolute);entries=await readdir(absolute,{withFileTypes:true});}catch{return;}
  scanned++;
  for(const entry of entries){
   if(entry.isSymbolicLink())continue;
   const file=path.join(absolute,entry.name);
   if(entry.isDirectory()&&depth<maxDepth&&!excluded.has(entry.name)){await walk(file,depth+1);continue;}
   if(!entry.isFile()||!(/\.(sqlite|sqlite3|db)$/i.test(entry.name))||!(/stocklens/i.test(entry.name)||['.data','backups'].includes(path.basename(absolute))))continue;
   let db;
   try{
    db=new DatabaseSync(file,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;');
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    if(!tables.has('users')||!tables.has('user_state'))continue;
    const counts={};for(const table of ['users','user_state','user_mfa','push_subscriptions'])if(tables.has(table))counts[table]=db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
    found.push({path:file,counts});
   }catch{found.push({path:file,issue:'Cannot read this candidate; no changes made.'});}
   finally{db?.close();}
  }
 }
 for(const root of roots)await walk(root,0);
 return {scannedDirectories:scanned,candidates:found};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const roots=process.argv.slice(2);if(!roots.length)roots.push(homedir(),process.cwd());
 console.log(JSON.stringify({...(await findLegacyData(roots)),note:'Read-only search. Confirm the original app, stop its writes, then use a verified backup. Do not share passwords or secret keys.'},null,2));
}
