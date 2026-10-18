import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.env.DATABASE_PATH||path.join(root,'.data','stocklens.sqlite'));
if(!existsSync(source)){console.error('No database yet. Start StockLens and register an account first.');process.exitCode=1;}
else{
  const directory=path.join(root,'backups');mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,`stocklens-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  const db=new DatabaseSync(source,{readOnly:true});
  try{await backup(db,filename);console.log(`Backup saved: ${filename}`);}finally{db.close();}
}
