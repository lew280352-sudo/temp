import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../database.mjs';

test('schema initialization migrates legacy preferences once without removing accounts', async () => {
  const { initializeSchema } = await import('../schema.mjs');
  const db = await openDatabase({ databasePath: ':memory:' });
  try {
    await db.exec(['CREATE TABLE user_state(user_id TEXT PRIMARY KEY,data TEXT NOT NULL)']);
    await db.run('INSERT INTO user_state VALUES(?,?)', ['legacy', JSON.stringify({ holdings: [{ symbol: 'AAPL', qty: 9, cost: 100 }, { symbol: 'PTT', qty: 1 }], sources: [] })]);
    await initializeSchema(db);
    const row = await db.get('SELECT data,revision FROM user_state');
    assert.deepEqual(JSON.parse(row.data).watchlist, ['AAPL']);assert.equal(row.revision, 1);assert.doesNotMatch(row.data, /qty|cost|holdings/);
    await initializeSchema(db);
    assert.equal((await db.get('SELECT revision FROM user_state')).revision, 1);
  } finally {await db.close();}
});

test('local database persists after close and reopen', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stocklens-db-')),file = path.join(dir, 'account.sqlite');
  try {
    let db = await openDatabase({ databasePath: file });
    await db.exec(['CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT)']);
    assert.equal((await db.run('INSERT INTO accounts VALUES(?,?)', ['one', 'ไทย'])).changes, 1);
    await db.close();db = await openDatabase({ databasePath: file });
    assert.equal((await db.get('SELECT name FROM accounts WHERE id=?', ['one'])).name, 'ไทย');
    await db.close();
  } finally {rmSync(dir, { recursive: true });}
});

test('failed transaction rolls back and unrelated asynchronous queries stay outside it', async () => {
  const db = await openDatabase({ databasePath: ':memory:' });
  try {
    await db.exec(['CREATE TABLE accounts(id TEXT PRIMARY KEY)']);
    let resume, entered;
    const ready = new Promise((resolve) => entered = resolve),release = new Promise((resolve) => resume = resolve);
    const tx = db.transaction(async (tx) => {await tx.run('INSERT INTO accounts VALUES(?)', ['rolled-back']);entered();await release;throw new Error('cancel');});
    await ready;
    const outside = db.run('INSERT INTO accounts VALUES(?)', ['kept']);
    resume();await assert.rejects(tx, /cancel/);await outside;
    assert.deepEqual((await db.all('SELECT id FROM accounts')).map((r) => r.id), ['kept']);
    await db.transaction((tx) => tx.run('INSERT INTO accounts VALUES(?)', ['committed']));
    assert.equal((await db.get('SELECT COUNT(*) AS n FROM accounts')).n, 2);
  } finally {await db.close();}
});

test('remote misconfiguration fails without creating a local fallback database', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stocklens-no-fallback-')),file = path.join(dir, 'fallback.sqlite');
  try {
    await assert.rejects(openDatabase({ databasePath: file, databaseUrl: 'libsql://example.turso.io' }), /token/i);
    await assert.rejects(openDatabase({ databasePath: file, databaseUrl: 'file:/tmp/wrong.sqlite', authToken: 'not-real' }), /remote|URL/i);
    await assert.rejects(openDatabase({ databasePath: file, databaseUrl: 'libsql://example.turso.io', authToken: 'not-real', remoteClientFactory: () => ({ execute: async () => {throw new Error('network unavailable');}, close() {} }) }), /unavailable/);
    assert.equal(existsSync(file), false);
  } finally {rmSync(dir, { recursive: true });}
});

test('remote driver exposes affected rows and confines rollback to its transaction handle', async () => {
  const history = [];
  const handle = { execute: async ({ sql, args }) => {history.push(['tx', sql, args]);return { rows: [], rowsAffected: 1, lastInsertRowid: 7n };}, commit: async () => history.push(['commit']), rollback: async () => history.push(['rollback']), close() {} };
  const db = await openDatabase({ databaseUrl: 'libsql://example.turso.io', authToken: 'test-only', remoteClientFactory: () => ({ execute: async (input) => ({ rows: [], rowsAffected: 0 }), transaction: async () => handle, close() {} }) });
  try {
    const result = await db.transaction((tx) => tx.run('INSERT INTO accounts VALUES(?)', ['one']));
    assert.equal(result.changes, 1);assert.equal(result.lastInsertRowid, 7n);
    await assert.rejects(db.transaction(async (tx) => {await tx.run('UPDATE accounts SET id=?', ['two']);throw new Error('cancel');}), /cancel/);
    assert.deepEqual(history.map((x) => x[0]), ['tx', 'commit', 'tx', 'rollback']);
  } finally {await db.close();}
});
