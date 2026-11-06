import {openDatabase} from '../database.mjs';
import {runtimeConfig} from '../config.mjs';
import path from 'node:path';
const {databaseUrl,authToken}=runtimeConfig();
const db=await openDatabase({databasePath:path.resolve(process.env.DATABASE_PATH||'.data/stocklens.sqlite'),databaseUrl,authToken});
try{
  const rows=await db.all('SELECT data FROM user_state');
  const privateFields=['"holdings"','"qty"','"cost"'];
  const legacyPrivateFields=rows.filter(row=>privateFields.some(field=>row.data.includes(field))).length;
  console.log(JSON.stringify({stateRows:rows.length,legacyPrivateFields}));
  if(legacyPrivateFields)process.exitCode=1;
}finally{await db.close();}
