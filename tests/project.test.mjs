import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { URL, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const directory = await mkdtemp(new URL('../node_modules/.project-test-', import.meta.url));
after(() => rm(directory, { recursive: true, force: true }));
const compiled = await build({
  entryPoints: [new URL('../src/components/ProjectModal.tsx', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react'],
});
const modulePath = `${directory}/project.mjs`;
await writeFile(modulePath, compiled.outputFiles[0].text);
const { default: ProjectModal } = await import(pathToFileURL(modulePath));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { location: { origin: 'http://localhost:3000' } };

test('an existing project without a slug can be completed and saved', async () => {
  let rendered;
  let saved;
  await act(async () => { rendered = create(React.createElement(ProjectModal, {
    project: { id: 'old-project', name: '测试项目' }, onClose() {},
    onSave: async (name, slug) => { saved = { name, slug }; },
  })); });
  try {
    assert.equal(rendered.root.findByProps({ id: 'project-name' }).props.value, '测试项目');
    assert.equal(rendered.root.findByProps({ id: 'project-slug' }).props.value, '');
    assert.equal(rendered.root.findByProps({ type: 'submit' }).props.disabled, true);
    assert.equal(JSON.stringify(rendered.toJSON()).includes('my-project/**'), false);
    await act(async () => rendered.root.findByProps({ id: 'project-slug' }).props.onChange({ target: { value: 'test-project' } }));
    assert.equal(rendered.root.findByProps({ type: 'submit' }).props.disabled, false);
    assert.ok(JSON.stringify(rendered.toJSON()).includes('test-project'));
    await act(async () => rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(saved, { name: '测试项目', slug: 'test-project' });
  } finally { await act(async () => rendered.unmount()); }
});

test('duplicate slug errors keep edits available for correction', async () => {
  let rendered;
  await act(async () => { rendered = create(React.createElement(ProjectModal, {
    project: { id: 'project', name: 'Original', slug: 'original' }, onClose() {},
    onSave: async () => { throw new Error('项目标识已被使用'); },
  })); });
  try {
    await act(async () => rendered.root.findByProps({ id: 'project-slug' }).props.onChange({ target: { value: 'taken' } }));
    await act(async () => rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.ok(JSON.stringify(rendered.toJSON()).includes('项目标识已被使用'));
    assert.equal(rendered.root.findByProps({ id: 'project-slug' }).props.value, 'taken');
    assert.equal(rendered.root.findByProps({ type: 'submit' }).props.disabled, false);
  } finally { await act(async () => rendered.unmount()); }
});
