import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const envPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.env');
const contents=existsSync(envPath)?readFileSync(envPath,'utf8'):'';
if(/^MFA_ENCRYPTION_KEY=[a-f0-9]{64}$/im.test(contents)){
  console.log('MFA encryption key is already configured in .env');
}else{
  const key=randomBytes(32).toString('hex');
  const next=/^MFA_ENCRYPTION_KEY=.*$/m.test(contents)
    ?contents.replace(/^MFA_ENCRYPTION_KEY=.*$/m,`MFA_ENCRYPTION_KEY=${key}`)
    :contents.replace(/\s*$/,'')+`\nMFA_ENCRYPTION_KEY=${key}\n`;
  writeFileSync(envPath,next,{encoding:'utf8',mode:0o600});
  console.log('Generated MFA encryption key in ignored .env; keep it with database backups');
}
