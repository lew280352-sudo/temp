import {createHash} from 'node:crypto';
import {isIP} from 'node:net';

export function clientAddress(peerAddress,forwardedFor,trustedProxyHops=0){
  if(!Number.isInteger(trustedProxyHops)||trustedProxyHops<0||trustedProxyHops>4)throw new Error('TRUST_PROXY_HOPS must be 0–4');
  if(!trustedProxyHops||typeof forwardedFor!=='string'||forwardedFor.length>2048)return peerAddress;
  const chain=forwardedFor.split(',').map(s=>s.trim());
  const candidate=chain[chain.length-trustedProxyHops];
  return candidate&&isIP(candidate)?candidate:peerAddress;
}

export async function createAuthLimiter(db,{trustedProxyHops=0}={}){
  clientAddress('','',trustedProxyHops);
  await db.exec(['CREATE TABLE IF NOT EXISTS auth_limits(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,until INTEGER NOT NULL)']);
  const digest=s=>createHash('sha256').update(s).digest('hex');
  return {async consume({peerAddress='unknown',forwardedFor,email='',now=Date.now()}){
    const ip=clientAddress(peerAddress,forwardedFor,trustedProxyHops);
    const buckets=[[digest('ip:'+ip),200]];
    if(email)buckets.push([digest('account:'+email.trim().toLowerCase().slice(0,254)),10]);
    const limited=await db.transaction(async tx=>{
      await tx.run('DELETE FROM auth_limits WHERE until<=?',[now]);
      let blocked=false;
      for(const [bucket,maximum] of buckets){
        await tx.run('INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=auth_limits.attempts+1',[bucket,now+15*60*1000]);
        if((await tx.get('SELECT attempts FROM auth_limits WHERE bucket=?',[bucket])).attempts>maximum)blocked=true;
      }
      return blocked;
    });
    if(limited){const error=new Error('ลองสมัครหรือเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที');error.status=429;throw error;}
  }};
}
