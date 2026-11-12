import assert from 'node:assert/strict';
import { test } from 'node:test';

const env = {};
globalThis.Netlify = { env: { get: (name) => env[name] } };
const { default: send } = await import('../netlify/functions/send.mts');

const post = (body, headers = {}) => send(new Request('https://example.com/api/send', {
  method: 'POST', headers, body: JSON.stringify(body),
}));
const file = { filename: 'aob_export_20261112030405.csv', content: 'sku,location\nK-1,A1' };

test('refuses to send without a site passcode', async () => {
  const body = await (await post(file)).json();
  assert.equal(body.sent, false);
  assert.match(body.message, /passcode/);
});

test('requires the passcode, then the FTP login, then a well-formed file', async () => {
  env.APP_PASSCODE = 'shelf';
  try {
    assert.equal((await post(file)).status, 401);
    const auth = { 'x-app-passcode': 'shelf' };
    assert.match((await (await post(file, auth)).json()).message, /not set up yet/);
    env.AOB_FTP_USER = 'u';
    env.AOB_FTP_PASSWORD = 'p';
    assert.equal((await post({ ...file, filename: '../etc/passwd' }, auth)).status, 400);
    assert.equal((await post({ ...file, content: '<html>' }, auth)).status, 400);
  } finally {
    for (const key of Object.keys(env)) delete env[key];
  }
});
