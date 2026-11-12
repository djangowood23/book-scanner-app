import assert from 'node:assert/strict';
import { test } from 'node:test';

// Outside Netlify there is no API key and no blob store, which is exactly the
// degraded path worth pinning down: the function must still answer cleanly.
const env = {};
globalThis.Netlify = { env: { get: (name) => env[name] } };
const { default: scan } = await import('../netlify/functions/scan.mts');

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const post = (body, headers = {}) => scan(new Request('https://example.com/api/scan', {
  method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
}));

test('rejects malformed requests', async () => {
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post({ images: [] })).status, 400);
  assert.equal((await post({ images: Array(5).fill({ data: PIXEL }) })).status, 400);
  assert.equal((await post({ images: [{ data: 'data:text/html;base64,PGI+' }] })).status, 400);
});

test('reports missing API key and storage failure without failing the request', async () => {
  const response = await post({ images: [{ data: PIXEL }] });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.book, null);
  assert.match(body.read_error, /ANTHROPIC_API_KEY/);
  assert.deepEqual(body.image_urls, [null]);
  assert.match(body.storage_error, /could not be saved/);
});

test('skips the AI when read is false', async () => {
  const body = await (await post({ images: [{ data: PIXEL }], read: false })).json();
  assert.equal(body.read_error, null);
});

test('enforces the passcode when one is configured', async () => {
  env.APP_PASSCODE = 'shelf';
  try {
    assert.equal((await post({ images: [{ data: PIXEL }] })).status, 401);
    assert.equal((await post({ images: [{ data: PIXEL }] }, { 'x-app-passcode': 'wrong' })).status, 401);
    assert.equal((await post({ images: [{ data: PIXEL }] }, { 'x-app-passcode': 'shelf' })).status, 200);
  } finally {
    delete env.APP_PASSCODE;
  }
});
