import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { URL, pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(new URL('../node_modules/.service-api-test-', import.meta.url));
const { Response, TextEncoder } = globalThis;
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await rm(directory, { recursive: true, force: true }); });
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/services/api.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'auth-boundary', setup(builder) {
    builder.onResolve({ filter: /^(\.\/firebase|firebase\/auth)$/ }, args => ({ path: args.path, namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === './firebase' ? 'export const auth = {};' : 'export class GoogleAuthProvider {} export async function signInWithPopup() {} export async function signOut() {}' }));
  } }],
});
const modulePath = `${directory}/api.mjs`;
await writeFile(modulePath, compiled.outputFiles[0].text);
const { api } = await import(pathToFileURL(modulePath));

test('service tests forward request options and retain HTTP error bodies', async () => {
  let called;
  globalThis.fetch = async (...args) => { called = args; return new Response('{"error":"invalid"}', { status: 422, statusText: 'Unprocessable Entity' }); };
  const response = await api.invokeService('p one', '/hello', { method: 'PATCH', query: 'message=a%26b', headers: { 'X-Test': 'demo', 'Content-Type': 'application/json' }, body: '{"value":1}' });
  assert.equal(called[0], '/api/projects/p%20one/invoke/hello?message=a%26b');
  assert.equal(called[1].method, 'PATCH');
  assert.equal(called[1].credentials, 'same-origin');
  assert.equal(called[1].headers['X-Test'], 'demo');
  assert.equal(called[1].body, '{"value":1}');
  assert.equal(response.status, 422);
  assert.equal(response.ok, false);
  assert.equal(response.body, '{"error":"invalid"}');
  assert.ok(response.headers['content-type']);
  assert.equal(response.size, new TextEncoder().encode(response.body).byteLength);
});

test('GET never sends a body and valid null responses are preserved', async () => {
  let called;
  globalThis.fetch = async (...args) => { called = args; return new Response('null'); };
  const response = await api.invokeService('project', '/hello', { method: 'GET', query: '', headers: {}, body: 'ignored' });
  assert.equal(called[1].body, undefined);
  assert.equal(response.ok, true);
  assert.equal(response.body, 'null');
});

test('cron previews send expressions to the backend and preserve validation errors', async () => {
  let called;
  const expected = { nextRun: '2026-10-20T09:00:00+08:00', timezone: 'Asia/Shanghai' };
  globalThis.fetch = async (...args) => { called = args; return new Response(JSON.stringify(expected)); };
  assert.deepEqual(await api.previewCron('@every 5m'), expected);
  assert.equal(called[0], '/api/cron/preview');
  assert.equal(called[1].method, 'POST');
  assert.equal(called[1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(called[1].body), { cronExp: '@every 5m' });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: '无效的 Cron 表达式' }), { status: 400 });
  await assert.rejects(api.previewCron('0 0 9 * * *'), /无效的 Cron 表达式/);
});
