import assert from 'node:assert/strict';
import { test } from 'node:test';

const env = {};
globalThis.Netlify = { env: { get: (name) => env[name] } };
const { default: inventory } = await import('../netlify/functions/inventory.mts');

const call = (path, method = 'GET', headers = {}) => inventory(new Request(`https://example.com${path}`, {
  method, headers, body: method === 'GET' ? undefined : '{}',
}));

test('the shared inventory is off without a site passcode, and needs it on every route', async () => {
  assert.equal((await call('/api/inventory/meta')).status, 403);
  env.APP_PASSCODE = '1223';
  try {
    assert.equal((await call('/api/inventory/meta')).status, 401);
    assert.equal((await call('/api/inventory')).status, 401);
    assert.equal((await call('/api/inventory', 'POST', { 'x-app-passcode': 'wrong' })).status, 401);
    assert.equal((await call('/api/inventory/patch', 'POST')).status, 401);
  } finally {
    delete env.APP_PASSCODE;
  }
});
