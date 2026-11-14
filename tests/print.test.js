import assert from 'node:assert/strict';
import { test } from 'node:test';

const env = {};
globalThis.Netlify = { env: { get: (name) => env[name] } };
const { default: print } = await import('../netlify/functions/print.mts');

const post = (path, headers = {}) => print(new Request(`https://example.com${path}`, { method: 'POST', headers, body: '{}' }));

test('printing is off without a site passcode, and both ends must present it', async () => {
  assert.equal((await (await post('/api/print')).json()).queued, false);
  env.APP_PASSCODE = '1223';
  try {
    assert.equal((await post('/api/print')).status, 401);
    assert.equal((await post('/api/print/next', { 'x-app-passcode': 'nope' })).status, 401);
  } finally {
    delete env.APP_PASSCODE;
  }
});
