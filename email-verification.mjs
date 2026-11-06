import { randomBytes, createHash } from 'node:crypto';
import nodemailer from 'nodemailer';

const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function createEmailVerification(db, { origin = '', smtpHost = '', smtpPort = 587, smtpUser = '', smtpPass = '', smtpFrom = '', sender, now = Date.now } = {}) {
  await db.exec(["CREATE TABLE IF NOT EXISTS email_verifications(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT,expires_at INTEGER,sent_at INTEGER,verified_at INTEGER)"]);
  const configured = !!(origin && smtpHost && smtpUser && smtpPass && smtpFrom);
  const transport = configured && !sender ? nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, requireTLS: smtpPort !== 465, auth: { user: smtpUser, pass: smtpPass }, connectionTimeout: 10000, socketTimeout: 10000 }) : null;
  const send = sender || ((message) => transport.sendMail(message));
  async function status(userId) {return { emailAvailable: configured, emailVerified: !!(await db.get('SELECT verified_at FROM email_verifications WHERE user_id=?', [userId]))?.verified_at };}
  async function request(user) {
    if (!configured) throw new Error('Email verification is not configured');
    if ((await status(user.id)).emailVerified) return { alreadyVerified: true };
    const previous = await db.get('SELECT sent_at FROM email_verifications WHERE user_id=?', [user.id]);
    if (previous?.sent_at && now() - previous.sent_at < 60000) throw new Error('Wait before requesting another email');
    const token = randomBytes(32).toString('hex'),url = `${origin}/verify-email.html?token=${token}`;
    await db.run('INSERT INTO email_verifications(user_id,token_hash,expires_at,sent_at,verified_at) VALUES(?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at', [user.id, hash(token), now() + 3600000, now()]);
    try {await send({ from: smtpFrom, to: user.email, subject: 'ยืนยันอีเมล StockLens', text: `เปิดลิงก์นี้เพื่อยืนยันอีเมลของคุณภายใน 1 ชั่วโมง:\n${url}\n\nหากคุณไม่ได้ขอให้ยืนยันอีเมล ให้ละเว้นข้อความนี้` });}
    catch (error) {await db.run('UPDATE email_verifications SET token_hash=NULL,expires_at=NULL,sent_at=NULL WHERE user_id=? AND token_hash=?', [user.id, hash(token)]);throw error;}
    return { sent: true };
  }
  async function verify(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
    const row = await db.get('SELECT user_id FROM email_verifications WHERE token_hash=? AND expires_at>? AND verified_at IS NULL', [hash(token), now()]);
    if (!row) return false;
    return !!(await db.run('UPDATE email_verifications SET token_hash=NULL,expires_at=NULL,verified_at=? WHERE user_id=? AND token_hash=?', [now(), row.user_id, hash(token)])).changes;
  }
  return { configured, status, request, verify, close() {transport?.close();} };
}
