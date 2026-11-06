import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {findLegacyData} from '../scripts/find-legacy-data.mjs';
test('legacy finder identifies account databases without reading personal fields or changing the source',async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'stocklens-finder-')),directory=path.join(root,'old-app','.data');mkdirSync(directory,{recursive:true});
 const file=path.join(directory,'stocklens.sqlite'),db=new DatabaseSync(file);
 db.exec("CREATE TABLE users(email TEXT);CREATE TABLE user_state(data TEXT);INSERT INTO users VALUES('private@example.com');INSERT INTO user_state VALUES('private-watchlist');");db.close();const before=readFileSync(file);
 try{
  const result=await findLegacyData([root]);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].counts.users,1);assert.equal(result.candidates[0].path,file);assert.doesNotMatch(JSON.stringify(result),/private@example|private-watchlist/);assert.deepEqual(readFileSync(file),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
