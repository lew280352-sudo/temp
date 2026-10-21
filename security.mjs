import {createCipheriv,createDecipheriv,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(){
  let bits=0,value=0,result='';
  for(const byte of randomBytes(20)){
    value=(value<<8)|byte;bits+=8;
    while(bits>=5){result+=ALPHABET[(value>>>(bits-=5))&31];}
  }
  return result;
}
function decodeBase32(secret){
  let bits=0,value=0;const bytes=[];
  for(const char of secret){const n=ALPHABET.indexOf(char);if(n<0)throw new Error('Invalid MFA secret');value=(value<<5)|n;bits+=5;if(bits>=8){bytes.push((value>>>(bits-=8))&255);}}
  return Buffer.from(bytes);
}
export function totpCode(secret,step){
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));
  const digest=createHmac('sha1',decodeBase32(secret)).update(counter).digest();
  const offset=digest.at(-1)&15;
  return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
export function verifyTotp(secret,code,{now=Date.now(),lastStep=-1}={}){
  if(typeof code!=='string'||!/^[0-9]{6}$/.test(code))return null;
  const current=Math.floor(now/30000);
  for(const step of [current,current-1,current+1]){
    if(step<=lastStep)continue;
    if(timingSafeEqual(Buffer.from(totpCode(secret,step)),Buffer.from(code)))return step;
  }
  return null;
}
export function encryptSecret(secret,key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function decryptSecret(value,key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes');
  const bytes=Buffer.from(value,'base64url');
  if(bytes.length<29)throw new Error('Invalid MFA data');
  const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return decipher.update(bytes.subarray(28),undefined,'utf8')+decipher.final('utf8');
}
