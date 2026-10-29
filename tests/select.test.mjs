import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const directory = await mkdtemp(new URL('../node_modules/.select-test-', import.meta.url));
after(() => rm(directory, { recursive: true, force: true }));
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/Select.tsx', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react'],
  plugins: [{ name: 'portal', setup(builder) {
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const createPortal = children => children;' }));
  } }],
});
const modulePath = `${directory}/select.mjs`;
await writeFile(modulePath, built.outputFiles[0].text);
const { default: Select } = await import(pathToFileURL(modulePath));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.document = { body: {}, addEventListener() {}, removeEventListener() {} };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
after(() => { delete globalThis.document; delete globalThis.window; });

test('select supports keyboard choice, skips disabled options and cancels without changing value', async () => {
  const changes = [];
  let rendered;
  await act(async () => { rendered = create(React.createElement(Select, {
    value: 'GET', onChange: event => changes.push(event.target.value), 'aria-label': '请求方法',
  }, ['GET', 'POST', 'DELETE'].map(value => React.createElement('option', { key: value, value, disabled: value === 'POST' }, value)))); });
  const trigger = () => rendered.root.findByProps({ role: 'combobox' });
  const key = async key => act(async () => trigger().props.onKeyDown({ key, preventDefault() {}, stopPropagation() {} }));
  try {
    await key('Enter');
    assert.equal(trigger().props['aria-expanded'], true);
    assert.equal(rendered.root.findAllByProps({ role: 'option' }).length, 3);
    await key('ArrowDown');
    await key('Enter');
    assert.deepEqual(changes, ['DELETE']);
    assert.equal(trigger().props['aria-expanded'], false);
    await key('Enter');
    await key('Escape');
    assert.deepEqual(changes, ['DELETE']);
    await key('p');
    await key('Escape');
    await key('Enter');
    await key('Tab');
    assert.equal(trigger().props['aria-expanded'], false);
  } finally { await act(async () => rendered.unmount()); }
});

test('disabled select does not open a menu', async () => {
  let rendered;
  await act(async () => { rendered = create(React.createElement(Select, { value: 'a', disabled: true, onChange() { throw new Error('must not change'); } }, React.createElement('option', { value: 'a' }, 'A'))); });
  try {
    await act(async () => rendered.root.findByType('button').props.onClick());
    assert.equal(rendered.root.findAllByProps({ role: 'listbox' }).length, 0);
  } finally { await act(async () => rendered.unmount()); }
});
