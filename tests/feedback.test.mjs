import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const directory = await mkdtemp(new URL('../node_modules/.crond-test-', import.meta.url));
after(() => rm(directory, { recursive: true, force: true }));
const built = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/Feedback.tsx', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react'],
});
const modulePath = `${directory}/feedback.mjs`;
await writeFile(modulePath, built.outputFiles[0].text);
const { default: Feedback, confirmAction, notify } = await import(pathToFileURL(modulePath));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('confirmation waits for a choice, cancels safely and queues identical requests', async () => {
  let rendered;
  let opened = 0;
  await act(async () => { rendered = create(React.createElement(Feedback), {
    createNodeMock: node => node.type === 'dialog' ? { showModal: () => opened++, close() {} } : null,
  }); });
  try {
    let first;
    let second;
    let resolved = false;
    await act(async () => {
      first = confirmAction('删除任务？');
      first.then(() => { resolved = true; });
      second = confirmAction('删除任务？');
    });
    assert.equal(resolved, false);
    assert.equal(rendered.root.findAllByType('dialog').length, 1);
    assert.equal(rendered.root.findAllByType('button').find(node => node.children.includes('取消')).props.autoFocus, true);
    await act(async () => rendered.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
    assert.equal(await first, false);
    assert.equal(opened, 2);
    await act(async () => rendered.root.findAllByType('button').find(node => node.children.includes('确认删除')).props.onClick());
    assert.equal(await second, true);
    assert.equal(rendered.root.findAllByType('dialog').length, 0);
    let third;
    await act(async () => { third = confirmAction('删除记录？'); });
    await act(async () => rendered.root.findAllByType('button').find(node => node.children.includes('取消')).props.onClick());
    assert.equal(await third, false);
  } finally { await act(async () => rendered.unmount()); }
});

test('notifications show text safely and can be dismissed independently', async () => {
  let rendered;
  await act(async () => { rendered = create(React.createElement(Feedback)); });
  try {
    await act(async () => { notify('<script>message</script>'); notify('复制成功'); });
    assert.equal(rendered.root.findAllByProps({ role: 'status' }).length, 2);
    assert.equal(rendered.root.findAllByType('script').length, 0);
    await act(async () => rendered.root.findAllByProps({ 'aria-label': '关闭通知' })[0].props.onClick());
    assert.equal(rendered.root.findByType('p').children.join(''), '复制成功');
    await act(async () => rendered.root.findByProps({ 'aria-label': '关闭通知' }).props.onClick());
    assert.equal(rendered.root.findAllByProps({ role: 'status' }).length, 0);
  } finally { await act(async () => rendered.unmount()); }
});
