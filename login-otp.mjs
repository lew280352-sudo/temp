import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import nodemailer from 'nodemailer';

const digest=(id,code)=>createHash('sha256').update(`${id}:${code}`).digest();

export function createLoginOtp(db,{enabled=false,smtpHost='',smtpPort=587,smtpUser='',smtpPass='',smtpFrom='',sender,now=Date.now}={}){
  if(enabled&&!(smtpHost&&smtpUser&&smtpPass&&smtpFrom))throw new Error('EMAIL_LOGIN_OTP_ENABLED requires SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM');
  db.exec('CREATE TABLE IF NOT EXISTS login_otp(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,code_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL)');
  const transport=enabled&&!sender?nodemailer.createTransport({host:smtpHost,port:smtpPort,secure:smtpPort===465,requireTLS:smtpPort!==465,auth:{user:smtpUser,pass:smtpPass},connectionTimeout:10000,socketTimeout:10000}):null;
  const send=sender||((message)=>transport.sendMail(message));
  async function request(user){
    if(!enabled)throw new Error('Email login is not configured');
    const previous=db.prepare('SELECT created_at FROM login_otp WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(user.id);
    if(previous&&now()-previous.created_at<60000)throw new Error('Wait before requesting another login code');
    const id=randomBytes(32).toString('hex'),code=String(randomBytes(4).readUInt32BE()%1000000).padStart(6,'0');
    db.prepare('DELETE FROM login_otp WHERE user_id=? OR expires_at<=?').run(user.id,now());
    db.prepare('INSERT INTO login_otp(id,user_id,code_hash,expires_at,created_at) VALUES(?,?,?,?,?)').run(id,user.id,digest(id,code).toString('hex'),now()+10*60*1000,now());
    try{await send({from:smtpFrom,to:user.email,subject:'รหัสเข้าสู่ระบบ StockLens',text:`รหัสเข้าสู่ระบบ StockLens ของคุณ: ${code}\n\nรหัสนี้ใช้ได้ครั้งเดียวภายใน 10 นาที หากคุณไม่ได้พยายามเข้าสู่ระบบ ให้ละเว้นอีเมลนี้และเปลี่ยนรหัสผ่าน`});}
    catch(error){db.prepare('DELETE FROM login_otp WHERE id=?').run(id);throw error;}
    return {challengeId:id,factor:'email',expiresMinutes:10};
  }
  function verify(id,code){
    if(!enabled)return null;
    if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)||typeof code!=='string'||!/^[0-9]{6}$/.test(code))return null;
    const row=db.prepare('SELECT * FROM login_otp WHERE id=?').get(id);
    if(!row||now()>=row.expires_at||row.attempts>=5)return null;
    db.prepare('UPDATE login_otp SET attempts=attempts+1 WHERE id=?').run(id);
    if(!timingSafeEqual(digest(id,code),Buffer.from(row.code_hash,'hex')))return null;
    if(!db.prepare('DELETE FROM login_otp WHERE id=?').run(id).changes)return null;
    return row.user_id;
  }
  return {enabled,request,verify,close(){transport?.close();}};
}
