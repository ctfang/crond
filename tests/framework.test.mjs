import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { URL, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const directory = await mkdtemp(new URL('../node_modules/.crond-test-', import.meta.url));
after(() => rm(directory, { recursive: true, force: true }));
const built = await build({
  entryPoints: [new URL('../src/components/FrameworkConfigModal.tsx', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react'],
  plugins: [{ name: 'test-boundaries', setup(builder) {
    builder.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'test' }));
    builder.onResolve({ filter: /ProjectTerminal$/ }, () => ({ path: 'terminal', namespace: 'test' }));
    builder.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'editor', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({
      contents: args.path === 'api' ? 'export const api = globalThis.__crondTestApi;' : args.path === 'terminal' ? 'import React from "react"; export default function Terminal(props) { return React.createElement("section", {"aria-label":"项目交互终端", ...props}); }' :
        'import React from "react"; export default function Editor(props) { return React.createElement("textarea", { value: props.value, readOnly: props.options.readOnly, "aria-readonly": props.options.domReadOnly }); }',
    }));
  } }],
});
let load;
globalThis.__crondTestApi = { getFrameworkFiles: () => load() };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compiledPath = `${directory}/framework.mjs`;
await writeFile(compiledPath, built.outputFiles[0].text);
const { default: Framework } = await import(pathToFileURL(compiledPath));

const readme = { id: 'readme', name: 'README.md', path: 'README.md', type: 'file', parentId: 'root', content: '# 默认框架说明\n\n统一入口 bootstrap.php' };
const source = { id: 'source', name: 'bootstrap.php', path: 'bootstrap.php', type: 'file', parentId: 'root', content: '<?php // shared framework' };

test('framework documentation loads global files and only exposes viewing controls', async () => {
  load = async () => [readme, source];
  let rendered;
  await act(async () => { rendered = create(React.createElement(Framework)); });
  try {
    assert.equal(rendered.root.findByType('h1').children.join(''), '默认框架说明');
    assert.equal(rendered.root.findAllByType('textarea').length, 0);
    assert.equal(rendered.root.findAllByType('input').length, 0);
    assert.equal(rendered.root.findAllByType('form').length, 0);
    assert.equal(rendered.root.findAllByProps({ 'aria-label': '项目交互终端' }).length, 0);
    const buttons = rendered.root.findAllByType('button');
    assert.equal(buttons.length, 4);
    const sourceButton = buttons.find(button => button.findAllByType('span').some(span => span.children.includes('bootstrap.php')));
    await act(async () => sourceButton.props.onClick());
    assert.equal(rendered.root.findByType('textarea').props.value, source.content);
    assert.equal(rendered.root.findByType('textarea').props.readOnly, true);
    assert.equal(rendered.root.findByType('textarea').props['aria-readonly'], true);
    await act(async () => rendered.root.findAllByType('button').find(button => button.children.includes('框架说明')).props.onClick());
    assert.equal(rendered.root.findByType('h1').children.join(''), '默认框架说明');
  } finally { await act(async () => rendered.unmount()); }
});

test('framework documentation reports loading errors', async () => {
  load = async () => { throw new Error('文档不可用'); };
  let rendered;
  await act(async () => { rendered = create(React.createElement(Framework)); });
  try { assert.equal(rendered.root.findByProps({ role: 'alert' }).children.join(''), '文档不可用'); }
  finally { await act(async () => rendered.unmount()); }
});


test('nested source files are visible by default and Markdown source is readable', async () => {
  const folder = { id: 'framework', name: 'framework', path: 'framework', type: 'folder', parentId: 'root' };
  const nested = { ...source, id: 'config', name: 'Config.php', path: 'framework/Config.php', parentId: 'framework' };
  load = async () => [readme, folder, nested];
  let rendered;
  await act(async () => { rendered = create(React.createElement(Framework)); });
  try {
    const nestedName = rendered.root.findAllByType('span').find(node => node.children.includes('Config.php'));
    assert.ok(nestedName, 'nested code must be visible without expanding folders');
    await act(async () => nestedName.parent.props.onClick());
    assert.equal(rendered.root.findByType('textarea').props.value, nested.content);
    assert.equal(rendered.root.findByType('textarea').props.readOnly, true);
    await act(async () => rendered.root.findAllByType('button').find(button => button.children.includes('框架说明')).props.onClick());
    await act(async () => rendered.root.findAllByType('button').find(button => button.children.includes('查看源码')).props.onClick());
    assert.equal(rendered.root.findByType('textarea').props.value, readme.content);
    assert.equal(rendered.root.findByType('textarea').props.readOnly, true);
    await act(async () => rendered.root.findAllByType('button').find(button => button.children.includes('阅读文档')).props.onClick());
    assert.equal(rendered.root.findByType('h1').children.join(''), '默认框架说明');
  } finally { await act(async () => rendered.unmount()); }
});
