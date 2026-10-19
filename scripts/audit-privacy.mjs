import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const databasePath=path.resolve(process.env.DATABASE_PATH||'.data/stocklens.sqlite');
const db=new DatabaseSync(databasePath,{readOnly:true});
const rows=db.prepare('SELECT data FROM user_state').all();
const privateFields=['"holdings"','"qty"','"cost"'];
const legacyPrivateFields=rows.filter(row=>privateFields.some(field=>row.data.includes(field))).length;
db.close();
console.log(JSON.stringify({stateRows:rows.length,legacyPrivateFields}));
if(legacyPrivateFields)process.exitCode=1;
