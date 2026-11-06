import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { companies } from '../dist/catalog.js';
import { companyIcons } from '../dist/company-icons.js';
import { marketFeeds } from '../market-news.mjs';
import { createApp } from '../server.mjs';

test('expanded US directory serves verified local company icons and market mappings', async (t) => {
  assert.equal(companies.length, 36);
  assert.equal(new Set(companies.map((company) => company.symbol)).size, 36);
  assert.equal(marketFeeds.length, 36);
  assert.ok(Object.keys(companyIcons).length > 0);
  for(const iconPath of Object.values(companyIcons))assert.match(iconPath,/^\/company-icons\/[a-z0-9]+\.svg$/);
  assert.equal(companies.find((company) => company.symbol === 'AVGO')?.icon, companyIcons.AVGO);
  assert.equal(companies.find((company) => company.symbol === 'BRK.B')?.icon, null);

  const server = await createApp({ databasePath: ':memory:' });server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => server.shutdown());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const symbol of Object.keys(companyIcons)) {
    const response = await fetch(base + companyIcons[symbol]);
    assert.equal(response.status, 200, symbol);
    assert.match(response.headers.get('content-type'), /^image\/svg\+xml/);
    assert.ok((await response.arrayBuffer()).byteLength > 100);
  }
  assert.equal((await fetch(base + '/icons.js')).status,200);
  assert.equal((await fetch(base + '/vendor/external-link.svg')).headers.get('content-type'),'image/svg+xml; charset=utf-8');
  for(const path of ['/company-icons/unknown.svg','/vendor/ICONS.md','/database.mjs','/.env'])assert.equal((await fetch(base+path)).status,404,path);
});
