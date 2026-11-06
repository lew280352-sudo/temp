import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openDatabase} from '../database.mjs';
import {initializeSchema} from '../schema.mjs';
import {companies} from '../dist/catalog.js';
import {decryptSecret} from '../security.mjs';

const tables=['users','user_state','recovery_codes','user_mfa','market_feed_migrations','push_subscriptions','email_verifications','user_onboarding'];
const quote=id=>'"'+id.replaceAll('"','""')+'"';
const symbols=new Set(companies.map(c=>c.symbol));

function preferences(raw){
  const state=JSON.parse(raw);
  const watchlist=[...new Set((Array.isArray(state.watchlist)?state.watchlist:(state.holdings||[]).map(h=>h.symbol)).filter(s=>symbols.has(s)))];
  return JSON.stringify({watchlist,alerts:{daily:true,news:true,trend:true,time:'08:00',...state.alerts,scope:state.alerts?.scope==='all'?'all':'watchlist'},sources:Array.isArray(state.sources)?state.sources:[]});
}

// The operator supplies a verified SQLite backup. Only a fresh destination is
// accepted; browser sessions and pending login challenges never cross cutover.
export async function importToDatabase(sourcePath,target,{mfaKeyHex='',pushConfigured=false}={}){
  const source=new DatabaseSync(path.resolve(sourcePath),{readOnly:true});
  try{
    source.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('Source backup is not intact');
    const present=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name));
    if(!present.has('users')||!present.has('user_state'))throw new Error('Source is not a StockLens account database');
    const snapshots=new Map(tables.filter(t=>present.has(t)).map(t=>[t,source.prepare('SELECT * FROM '+quote(t)).all()]));
    if(snapshots.get('users').length!==snapshots.get('user_state').length)throw new Error('Source account and preference counts do not match');
    for(const row of snapshots.get('user_mfa')||[]){
      if(row.secret){
        if(!/^[a-f0-9]{64}$/i.test(mfaKeyHex))throw new Error('The original MFA_ENCRYPTION_KEY is required');
        try{decryptSecret(row.secret,Buffer.from(mfaKeyHex,'hex'));}catch{throw new Error('The MFA key does not decrypt the original accounts');}
      }
      row.pending_secret=null;row.pending_until=null;
    }
    for(const row of snapshots.get('email_verifications')||[]){row.token_hash=null;row.expires_at=null;row.sent_at=null;}
    if(snapshots.get('push_subscriptions')?.length&&!pushConfigured)throw new Error('The original VAPID key pair is required to preserve Push devices');
    return await target.transaction(async tx=>{
      for(const table of tables){if((await tx.get('SELECT COUNT(*) AS n FROM '+quote(table))).n)throw new Error('Destination must be empty; existing accounts will not be overwritten');}
      const counts={};
      for(const table of tables){
        const rows=snapshots.get(table)||[];
        const allowed=(await tx.all('PRAGMA table_info('+quote(table)+')')).map(c=>c.name);
        for(const original of rows){
          const row={...original};
          if(table==='users'&&(!/^[a-f0-9]{128}$/i.test(row.password_hash)||!/^[a-f0-9]{32}$/i.test(row.salt)))throw new Error('Source password hash format is not supported');
          if(table==='user_state'){row.data=preferences(row.data);row.revision=Number.isSafeInteger(row.revision)?row.revision:0;}
          const columns=allowed.filter(c=>Object.hasOwn(row,c));
          await tx.run('INSERT INTO '+quote(table)+'('+columns.map(quote).join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',columns.map(c=>row[c]));
        }
        counts[table]=rows.length;
      }
      return counts;
    });
  }finally{source.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let target;
  try{
    const index=process.argv.indexOf('--source'),sourcePath=index>=0?process.argv[index+1]:null;
    if(!sourcePath)throw new Error('Usage: node --env-file=.env scripts/import-database.mjs --source /path/to/verified-backup.sqlite');
    if(!process.env.TURSO_DATABASE_URL||!process.env.TURSO_AUTH_TOKEN)throw new Error('Set Turso credentials in the local environment; do not paste them in chat');
    target=await openDatabase({databaseUrl:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
    await initializeSchema(target);
    const counts=await importToDatabase(sourcePath,target,{mfaKeyHex:process.env.MFA_ENCRYPTION_KEY||'',pushConfigured:!!(process.env.VAPID_PUBLIC_KEY&&process.env.VAPID_PRIVATE_KEY)});
    console.log(JSON.stringify({imported:counts,sessionsImported:0}));
  }catch(error){console.error(error.message.startsWith('Source')||error.message.startsWith('Destination')||error.message.startsWith('The original')||error.message.startsWith('The MFA')||error.message.startsWith('Usage:')||error.message.startsWith('Set Turso')?error.message:'Import failed. Check the source backup and remote database; no partial import was committed.');process.exitCode=1;}
  finally{await target?.close();}
}
