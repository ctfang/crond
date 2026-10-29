import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { URL, pathToFileURL, fileURLToPath } from 'node:url';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const directory = await mkdtemp(new URL('../node_modules/.cron-test-', import.meta.url));
after(() => rm(directory, { recursive: true, force: true }));
let preview;
globalThis.__cronApi = { previewCron: expression => preview(expression) };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const components = {};
for (const name of ['CronPreview', 'ShellJobModal', 'PhpJobModal', 'HttpJobModal']) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(`../src/components/${name}.tsx`, import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false,
    external: ['react-dom', 'react', 'react/jsx-runtime', 'lucide-react'],
    plugins: [{ name: 'cron-boundaries', setup(builder) {
      builder.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'test' }));
      builder.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'editor', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'api'
        ? 'export const api = globalThis.__cronApi;'
        : 'export default function Editor() { return null; } export function useMonaco() { return null; }' }));
    } }],
  });
  const modulePath = `${directory}/${name}.mjs`;
  await writeFile(modulePath, compiled.outputFiles[0].text);
  components[name] = (await import(pathToFileURL(modulePath))).default;
}
const result = { nextRun: '2026-10-20T09:00:00+08:00', timezone: 'Asia/Shanghai' };
const waitForPreview = () => act(() => new Promise(resolve => setTimeout(resolve, 280)));

test('all job editors use backend previews and display Shanghai time in a UTC browser', async () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    for (const type of ['shell', 'php', 'http']) {
      let called;
      preview = async expression => { called = expression; return result; };
      const name = `${type[0].toUpperCase()}${type.slice(1)}JobModal`;
      let rendered;
      await act(async () => { rendered = create(React.createElement(components[name], {
        projectId: 'project', job: { id: 'job', name: 'test', type, cronExp: '@every 5m', content: '', status: 'active' },
        onClose() {}, onSaved() {},
      })); });
      try {
        await waitForPreview();
        assert.equal(called, '@every 5m');
        assert.equal(rendered.root.findByProps({ role: 'status' }).children.join(''), '2026-10-20 09:00:00 (Asia/Shanghai)');
      } finally { await act(async () => rendered.unmount()); }
    }
  } finally {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
  }
});

test('preview displays backend validation errors for six-field expressions', async () => {
  let called;
  preview = async expression => { called = expression; throw new Error('无效的 Cron 表达式: expected exactly 5 fields, found 6'); };
  let rendered;
  await act(async () => { rendered = create(React.createElement(components.CronPreview, { expression: '0 0 9 * * *' })); });
  try {
    await waitForPreview();
    assert.equal(called, '0 0 9 * * *');
    assert.match(rendered.root.findByProps({ role: 'status' }).children.join(''), /无效的 Cron 表达式/);
  } finally { await act(async () => rendered.unmount()); }
});

test('late responses cannot replace the preview for a newer expression', async () => {
  const pending = new Map();
  preview = expression => new Promise(resolve => pending.set(expression, resolve));
  let rendered;
  await act(async () => { rendered = create(React.createElement(components.CronPreview, { expression: '@daily' })); });
  try {
    await waitForPreview();
    await act(async () => rendered.update(React.createElement(components.CronPreview, { expression: '@every 5m' })));
    await waitForPreview();
    await act(async () => pending.get('@every 5m')(result));
    await act(async () => pending.get('@daily')({ ...result, nextRun: '2026-10-21T00:00:00+08:00' }));
    assert.equal(rendered.root.findByProps({ role: 'status' }).children.join(''), '2026-10-20 09:00:00 (Asia/Shanghai)');
  } finally { await act(async () => rendered.unmount()); }
});
