import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfig} from '../config.mjs';

test('Render uses its assigned HTTPS origin and refuses ephemeral account storage',()=>{
  assert.throws(()=>runtimeConfig({RENDER:'true',HOST:'0.0.0.0',RENDER_EXTERNAL_URL:'https://stocklens-example.onrender.com'}),/TURSO/);
  const config=runtimeConfig({RENDER:'true',PORT:'10000',RENDER_EXTERNAL_URL:'https://stocklens-example.onrender.com',TURSO_DATABASE_URL:'libsql://example.turso.io',TURSO_AUTH_TOKEN:'fixture'});
  assert.equal(config.publicOrigin,'https://stocklens-example.onrender.com');assert.equal(config.host,'0.0.0.0');assert.equal(config.port,10000);
  assert.equal(config.databaseUrl,'libsql://example.turso.io');assert.equal(config.authToken,'fixture');
  assert.throws(()=>runtimeConfig({HOST:'0.0.0.0'}),/APP_ORIGIN/);
  assert.throws(()=>runtimeConfig({PORT:'0'}),/PORT/);
  assert.throws(()=>runtimeConfig({TRUST_PROXY_HOPS:'NaN'}),/TRUST_PROXY_HOPS/);
});

test('local configuration remains usable without cloud credentials',()=>{
  assert.deepEqual(runtimeConfig({}),{port:4173,host:'127.0.0.1',publicOrigin:null,databaseUrl:'',authToken:'',trustedProxyHops:0,hostingProfile:''});
});
