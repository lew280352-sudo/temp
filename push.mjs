import { createHash } from 'node:crypto';
import webpush from 'web-push';

const endpointHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const endpointId = (endpoint) => createHash('sha256').update(endpoint).digest('hex');

export function validatePushSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 4096) throw new Error('Invalid push subscription');
  let url;try {url = new URL(value.endpoint);} catch {throw new Error('Invalid push subscription');}
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !url.pathname || !(endpointHosts.has(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host))) throw new Error('Unsupported push service');
  const keys = value.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(keys.p256dh) || !/^[A-Za-z0-9_-]{20,35}$/.test(keys.auth) || Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) throw new Error('Invalid push keys');
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export async function createPushService(db, { publicKey = '', privateKey = '', subject = '', sender = webpush.sendNotification, now = Date.now } = {}) {
  await db.exec(["CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,last_sent_at INTEGER NOT NULL,created_at INTEGER NOT NULL)"]);
  await db.exec(["CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions(user_id)"]);
  const configured = !!(publicKey && privateKey && /^https:\/\/|^mailto:/i.test(subject));
  const vapidDetails = { subject, publicKey, privateKey };
  async function status(userId,connection=db) {return { configured, publicKey: configured ? publicKey : null, subscriptions: (await connection.get('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id=?', [userId])).total };}
  async function subscribe(userId, input,{connection=db}={}) {
    if (!configured) throw new Error('Push is not configured');
    const subscription = validatePushSubscription(input),id = endpointId(subscription.endpoint);
    const count = (await connection.get('SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id=? AND id<>?', [userId, id])).total;
    if (count >= 5) throw new Error('Maximum five push devices');
    await connection.run('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,last_sent_at=excluded.last_sent_at', [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now(), now()]);
    return await status(userId,connection);
  }
  async function unsubscribe(userId, endpoint) {
    if (typeof endpoint !== 'string' || endpoint.length > 4096) return false;
    return !!(await db.run('DELETE FROM push_subscriptions WHERE user_id=? AND id=?', [userId, endpointId(endpoint)])).changes;
  }
  async function send(row, payload) {
    try {
      await sender({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(payload), { vapidDetails, TTL: 3600, timeout: 10000 });
      return true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await db.run('DELETE FROM push_subscriptions WHERE id=? AND user_id=? AND p256dh=? AND auth=?', [row.id,row.user_id,row.p256dh,row.auth]);
      return false;
    }
  }
  async function test(userId) {
    if (!configured) throw new Error('Push is not configured');
    const rows = await db.all('SELECT * FROM push_subscriptions WHERE user_id=?', [userId]);
    let sent = 0;
    for(const reference of rows){
      const row=await db.get('SELECT p.* FROM push_subscriptions p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.user_id=?',[reference.id,reference.user_id]);
      if(row&&await send(row,{title:'StockLens',body:'ทดสอบการแจ้งเตือนสำเร็จ',url:'/'}))sent++;
    }
    return { sent, total: rows.length };
  }
  async function deliver(snapshot) {
    if (!configured) return { sent: 0 };
    const rows=await db.all('SELECT id,user_id FROM push_subscriptions',[]);
    let sent = 0;
    for (const reference of rows) {
      const row=await db.get('SELECT p.*,s.data AS state FROM push_subscriptions p JOIN users u ON u.id=p.user_id JOIN user_state s ON s.user_id=p.user_id WHERE p.id=? AND p.user_id=?',[reference.id,reference.user_id]);
      if(!row)continue;
      let state;try {state = JSON.parse(row.state);} catch {continue;}
      if (!state.alerts?.news) continue;
      const urls = new Set((state.sources || []).filter((source) => source.enabled).map((source) => source.url.replace(/\/$/, '')));
      const active = new Set(snapshot.sources.filter((source) => urls.has(source.url.replace(/\/$/, ''))).map((source) => source.id));
      const fresh = snapshot.items.filter((item) => active.has(item.feedId) && !item.stale && Date.parse(item.publishedAt) > row.last_sent_at && (state.alerts.scope === 'all' || state.watchlist.includes(item.symbol)));
      if (!fresh.length) continue;
      if (await send(row, { title: 'StockLens', body: `มีข่าวใหม่ ${fresh.length} เรื่องจากแหล่งที่ติดตาม`, url: '/' })) {
        await db.run('UPDATE push_subscriptions SET last_sent_at=? WHERE id=? AND user_id=? AND p256dh=? AND auth=?', [now(),row.id,row.user_id,row.p256dh,row.auth]);sent++;
      }
    }
    return { sent };
  }
  return { configured, status, subscribe, unsubscribe, test, deliver };
}
