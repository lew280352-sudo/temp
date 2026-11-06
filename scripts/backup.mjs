import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.env.TURSO_DATABASE_URL){
  console.error('Remote database selected: use the Turso export procedure in docs/FREE_CLOUD.md. No local backup was created.');
  process.exit(1);
}
const source=path.resolve(process.env.DATABASE_PATH||path.join(root,'.data','stocklens.sqlite'));
if(!existsSync(source)){console.error('No database yet. Start StockLens and register an account first.');process.exitCode=1;}
else{
  const directory=path.join(root,'backups');mkdirSync(directory,{recursive:true});
  const filename=path.join(directory,`stocklens-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  const db=new DatabaseSync(source,{readOnly:true});
  try{await backup(db,filename);console.log(`Backup saved: ${filename}`);}finally{db.close();}
}
