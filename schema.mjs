import {companies} from './dist/catalog.js';
import {feeds} from './feeds.mjs';

const statements=[
  "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS user_state(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,data TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at)",
  "CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS user_mfa(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,secret TEXT,pending_secret TEXT,pending_until INTEGER,last_step INTEGER NOT NULL DEFAULT -1)",
  "CREATE TABLE IF NOT EXISTS market_feed_migrations(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE)",
  "CREATE TABLE IF NOT EXISTS ai_summaries(cache_key TEXT PRIMARY KEY, symbol TEXT NOT NULL, model TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS news_feeds(id TEXT PRIMARY KEY, data TEXT NOT NULL, checked_at TEXT, succeeded_at TEXT, error TEXT)",
  "CREATE TABLE IF NOT EXISTS stock_quotes(symbol TEXT PRIMARY KEY,data TEXT,attempted_at INTEGER NOT NULL,error TEXT)",
  "CREATE TABLE IF NOT EXISTS weekly_history(symbol TEXT PRIMARY KEY,data TEXT,attempted_at INTEGER NOT NULL,error TEXT)",
  "CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,last_sent_at INTEGER NOT NULL,created_at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id)",
  "CREATE TABLE IF NOT EXISTS email_verifications(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT,expires_at INTEGER,sent_at INTEGER,verified_at INTEGER)",
  "CREATE TABLE IF NOT EXISTS login_otp(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)"
];

export async function initializeSchema(db){
  await db.exec(['CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY)']);
  if(!(await db.get('SELECT id FROM schema_migrations WHERE id=?',['base-v1'])))await db.transaction(async tx=>{
    if(await tx.get('SELECT id FROM schema_migrations WHERE id=?',['base-v1']))return;
    await tx.exec(statements);
    if(!(await tx.all('PRAGMA table_info(user_state)')).some(c=>c.name==='revision'))await tx.exec(['ALTER TABLE user_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0']);
    const symbols=new Set(companies.map(c=>c.symbol));
    for(const row of await tx.all('SELECT user_id,data FROM user_state')){
      let data;try{data=JSON.parse(row.data);}catch{continue;}
      if(Array.isArray(data.watchlist))continue;
      const watchlist=[...new Set((Array.isArray(data.holdings)?data.holdings:[]).map(i=>i?.symbol).filter(s=>symbols.has(s)))];
      const alerts={daily:true,news:true,trend:true,time:'08:00',...data.alerts,scope:data.alerts?.scope==='all'?'all':'watchlist'};
      const sources=Array.isArray(data.sources)?data.sources:feeds.map(f=>({id:f.id,name:f.name,url:f.url,type:f.type||'company',symbol:f.symbol,enabled:true}));
      await tx.run('UPDATE user_state SET data=?,revision=revision+1 WHERE user_id=?',[JSON.stringify({watchlist,alerts,sources}),row.user_id]);
    }
    await tx.run('INSERT INTO schema_migrations VALUES(?)',['base-v1']);
  });
  if(!(await db.get('SELECT id FROM schema_migrations WHERE id=?',['account-tools-v1'])))await db.transaction(async tx=>{
    if(await tx.get('SELECT id FROM schema_migrations WHERE id=?',['account-tools-v1']))return;
    await tx.exec([
      'CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id)',
      "CREATE TABLE IF NOT EXISTS session_devices(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,created_at INTEGER,last_seen_at INTEGER)",
      "CREATE TABLE IF NOT EXISTS session_push(subscription_id TEXT PRIMARY KEY REFERENCES push_subscriptions(id) ON DELETE CASCADE,session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE)",
      'CREATE INDEX IF NOT EXISTS session_push_owner ON session_push(session_hash)',
      "CREATE TRIGGER IF NOT EXISTS session_push_cleanup BEFORE DELETE ON sessions BEGIN DELETE FROM push_subscriptions WHERE id IN (SELECT subscription_id FROM session_push WHERE session_hash=OLD.token_hash); END",
      "CREATE TABLE IF NOT EXISTS user_onboarding(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL CHECK(status IN ('pending','completed','skipped')),completed_at INTEGER)",
      "INSERT INTO session_devices(token_hash,id,name) SELECT token_hash,lower(hex(randomblob(16))),'อุปกรณ์เดิม' FROM sessions WHERE token_hash NOT IN (SELECT token_hash FROM session_devices)"
    ]);
    await tx.run('INSERT INTO schema_migrations VALUES(?)',['account-tools-v1']);
  });
}
