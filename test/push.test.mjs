import { openDatabase } from '../database.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { validatePushSubscription, createPushService } from '../push.mjs';
import { createApp } from '../server.mjs';

const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-device-token', keys: { p256dh: Buffer.alloc(65, 7).toString('base64url'), auth: Buffer.alloc(16, 3).toString('base64url') } };
test('push subscriptions accept known browser services and reject local or arbitrary endpoints', () => {
  assert.equal(validatePushSubscription(subscription).endpoint, subscription.endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/x', 'https://127.0.0.1/x', 'https://example.com/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pass@fcm.googleapis.com/x']) assert.throws(() => validatePushSubscription({ ...subscription, endpoint }));
  assert.throws(() => validatePushSubscription({ ...subscription, keys: { ...subscription.keys, auth: 'bad' } }));
});

test('push sends only new enabled news for the subscribed account and stops after unsubscribe', async () => {
  const db = await openDatabase({ databasePath: ':memory:' });await db.exec(["PRAGMA foreign_keys=ON", "CREATE TABLE users(id TEXT PRIMARY KEY)", "CREATE TABLE user_state(user_id TEXT PRIMARY KEY,data TEXT NOT NULL)"]);
  await db.run('INSERT INTO users VALUES(?)', ['alice']);await db.run('INSERT INTO users VALUES(?)', ['bob']);
  const makeState = (enabled) => JSON.stringify({ watchlist: ['AAPL'], alerts: { news: enabled, scope: 'watchlist' }, sources: [{ url: 'https://www.apple.com/newsroom/', enabled: true }] });
  await db.run('INSERT INTO user_state VALUES(?,?)', ['alice', makeState(true)]);await db.run('INSERT INTO user_state VALUES(?,?)', ['bob', makeState(true)]);
  let time = Date.parse('2026-10-21T12:00:00Z');const sent = [];
  const push = await createPushService(db, { publicKey: 'fixture-public', privateKey: 'fixture-private', subject: 'https://example.org', now: () => time, sender: async (sub, payload) => sent.push({ sub, payload: JSON.parse(payload) }) });
  try {
    assert.equal((await push.subscribe('alice', subscription)).subscriptions, 1);
    const snapshot = { sources: [{ id: 'apple', url: 'https://www.apple.com/newsroom/' }], items: [{ feedId: 'apple', symbol: 'AAPL', stale: false, publishedAt: new Date(time + 60000).toISOString() }] };
    time += 120000;assert.equal((await push.deliver(snapshot)).sent, 1);assert.equal(sent.length, 1);assert.equal(sent[0].payload.title, 'StockLens');
    assert.equal((await push.deliver(snapshot)).sent, 0, 'same story is not pushed twice');
    await db.run('UPDATE user_state SET data=? WHERE user_id=?', [makeState(false), 'alice']);
    snapshot.items[0].publishedAt = new Date(time + 60000).toISOString();time += 120000;
    assert.equal((await push.deliver(snapshot)).sent, 0, 'news alert switch is respected');
    assert.equal(await push.unsubscribe('alice', subscription.endpoint), true);
    assert.equal((await push.status('alice')).subscriptions, 0);
  } finally {await db.close();}
});

test('push HTTP endpoints require a session and keep subscriptions account-scoped', async (t) => {
  const sent = [];
  const server = await createApp({ databasePath: ':memory:', pushPublicKey: 'fixture-public', pushPrivateKey: 'fixture-private', pushSubject: 'https://example.org', pushSender: async (sub) => sent.push(sub.endpoint) });
  server.listen(0, '127.0.0.1');await once(server, 'listening');t.after(() => server.shutdown());
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(base + route, { method, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const alice = { name: 'Alice', email: 'push-alice@example.com', password: 'correct-test-password' },bob = { name: 'Bob', email: 'push-bob@example.com', password: 'correct-test-password' };
  await call('/api/register', { method: 'POST', body: alice });await call('/api/register', { method: 'POST', body: bob });
  const a = await call('/api/login', { method: 'POST', body: alice }),b = await call('/api/login', { method: 'POST', body: bob });
  assert.equal((await call('/api/push/status')).status, 401);
  assert.equal((await call('/api/push/subscribe', { method: 'POST', cookie: a.cookie, body: { ...subscription, endpoint: 'https://example.com/internal' } })).status, 400);
  assert.equal((await call('/api/push/subscribe', { method: 'POST', cookie: a.cookie, body: subscription })).status, 200);
  assert.equal((await call('/api/push/status', { cookie: a.cookie })).data.subscriptions, 1);
  assert.equal((await call('/api/push/status', { cookie: b.cookie })).data.subscriptions, 0);
  assert.equal((await call('/api/push/test', { method: 'POST', cookie: a.cookie, body: {} })).data.sent, 1);assert.deepEqual(sent, [subscription.endpoint]);
  assert.equal((await call('/api/push/unsubscribe', { method: 'POST', cookie: b.cookie, body: { endpoint: subscription.endpoint } })).status, 200);
  assert.equal((await call('/api/push/status', { cookie: a.cookie })).data.subscriptions, 1);
});

for(const kind of ['news','test'])test(`queued ${kind} Push does not start another device send after account deletion`,async()=>{
 const db=await openDatabase({databasePath:':memory:'});await db.exec(['CREATE TABLE users(id TEXT PRIMARY KEY)','CREATE TABLE user_state(user_id TEXT PRIMARY KEY,data TEXT NOT NULL)']);await db.run('INSERT INTO users VALUES(?)',['queued']);await db.run('INSERT INTO user_state VALUES(?,?)',['queued',JSON.stringify({watchlist:['AAPL'],alerts:{news:true,scope:'watchlist'},sources:[{url:'https://www.apple.com/newsroom/',enabled:true}]})]);
 let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),sent=[];
 const service=await createPushService(db,{publicKey:'fixture',privateKey:'fixture',subject:'mailto:fixture@example.com',now:()=>1000,sender:async subscription=>{sent.push(subscription.endpoint);if(sent.length===1){entered();await gate;}}});
 try{
  for(const suffix of ['first','second'])await service.subscribe('queued',{...subscription,endpoint:subscription.endpoint+'-'+suffix});
  const pending=kind==='test'?service.test('queued'):service.deliver({sources:[{id:'apple',url:'https://www.apple.com/newsroom/'}],items:[{feedId:'apple',symbol:'AAPL',publishedAt:new Date(2000).toISOString(),stale:false}]});
  await ready;await db.run('DELETE FROM users WHERE id=?',['queued']);release();await pending;assert.equal(sent.length,1);
 }finally{release();await db.close();}
});
