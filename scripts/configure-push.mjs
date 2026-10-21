import webpush from 'web-push';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const envPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.env');
let contents=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
if(!/^VAPID_PUBLIC_KEY=[A-Za-z0-9_-]+$/m.test(contents)||!/^VAPID_PRIVATE_KEY=[A-Za-z0-9_-]+$/m.test(contents)){
  const keys=webpush.generateVAPIDKeys();
  for(const [name,value] of [['VAPID_PUBLIC_KEY',keys.publicKey],['VAPID_PRIVATE_KEY',keys.privateKey]]){
    contents=new RegExp(`^${name}=.*$`,'m').test(contents)?contents.replace(new RegExp(`^${name}=.*$`,'m'),`${name}=${value}`):contents.replace(/\s*$/,'')+`\n${name}=${value}\n`;
  }
  console.log('Generated private VAPID keys in ignored .env');
}else console.log('VAPID keys are already configured in .env');
if(!/^VAPID_SUBJECT=\S+$/m.test(contents))contents=contents.replace(/^VAPID_SUBJECT=.*$/m,'').replace(/\s*$/,'')+'\nVAPID_SUBJECT=https://github.com/lew280352-sudo/temp\n';
writeFileSync(envPath,contents,{encoding:'utf8',mode:0o600});
