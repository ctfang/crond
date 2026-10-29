import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { URL, pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { act, create } from 'react-test-renderer';

const directory = await mkdtemp(new URL('../node_modules/.service-test-', import.meta.url));
after(() => rm(directory, { recursive: true, force: true }));
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/components/StatelessServiceModal.tsx', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
  external: ['react-dom', 'react', 'react/jsx-runtime', 'lucide-react'],
  plugins: [{ name: 'service-boundaries', setup(builder) {
    builder.onResolve({ filter: /services\/api$/ }, () => ({ path: 'api', namespace: 'test' }));
    builder.onResolve({ filter: /^@monaco-editor\/react$/ }, () => ({ path: 'editor', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'api' ?
      'export const api = globalThis.__serviceApi;' : 'export default function Editor() { return null; }' }));
  } }],
});
const service = { id: 'service', name: 'Hello', route: '/hello', content: '<?php', status: 'active' };
let invoke;
let updateStatus;
globalThis.__serviceApi = {
  getStatelessServices: async () => [service],
  invokeService: (...args) => invoke(...args),
  upsertStatelessService: (...args) => updateStatus(...args),
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { location: { origin: 'http://localhost:3000' } };
const modulePath = `${directory}/service.mjs`;
await writeFile(modulePath, compiled.outputFiles[0].text);
const { default: Services } = await import(pathToFileURL(modulePath));

async function mount(testService = service) {
  globalThis.__serviceApi.getStatelessServices = async () => [testService];
  let rendered;
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  await act(async () => { rendered = create(React.createElement(Services, { projectId: 'project', project: { slug: 'demo' } }), {
    createNodeMock: element => element.type === 'dialog' ? dialog : null,
  }); });
  await act(async () => rendered.root.findAllByType('h4').find(node => node.children.includes('Hello')).parent.parent.props.onClick());
  return { rendered, dialog };
}

test('test button precedes the path input and results stay inside the modal', async () => {
  let complete;
  let called;
  invoke = (...args) => { called = args; return new Promise(resolve => { complete = resolve; }); };
  const { rendered, dialog } = await mount();
  try {
    const pathRow = rendered.root.findByProps({ id: 'service-route' }).parent.parent;
    const testButton = pathRow.findByProps({ 'aria-label': '测试服务' });
    assert.equal(dialog.open, false);
    await act(async () => { testButton.props.onClick(); });
    assert.equal(dialog.open, true);
    assert.equal(called, undefined);
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求方法' }).props.onChange({ target: { value: 'POST' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '查询参数名称 1' }).props.onChange({ target: { value: 'message' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '查询参数值 1' }).props.onChange({ target: { value: 'hello world' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '添加查询参数' }).props.onClick());
    await act(async () => rendered.root.findByProps({ 'aria-label': '查询参数名称 2' }).props.onChange({ target: { value: 'q' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '查询参数值 2' }).props.onChange({ target: { value: 'a&b' } }));
    await act(async () => rendered.root.findByProps({ id: 'request-tab-headers' }).props.onClick());
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求头名称 1' }).props.onChange({ target: { value: 'X-Test' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求头值 1' }).props.onChange({ target: { value: 'demo' } }));
    await act(async () => rendered.root.findByProps({ id: 'request-tab-body' }).props.onClick());
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求体' }).props.onChange({ target: { value: '{"value":1}' } }));
    await act(async () => { rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(called, ['project', '/hello', { method: 'POST', query: 'message=hello+world&q=a%26b', headers: { 'content-type': 'application/json', 'x-test': 'demo' }, body: '{"value":1}' }]);
    assert.ok(JSON.stringify(rendered.toJSON()).includes('正在请求服务'));
    await act(async () => complete({ status: 200, statusText: 'OK', duration: 12, ok: true, body: '{"message":"working"}', headers: { 'content-type': 'application/json' }, size: 21 }));
    const output = rendered.root.findByType('pre');
    assert.ok(output.props.children.includes('"message": "working"'));
    assert.equal(rendered.root.findByType('dialog').findByType('pre'), output);
    await act(async () => rendered.root.findByProps({ 'aria-pressed': false }).props.onClick());
    assert.equal(rendered.root.findByType('pre').props.children, '{"message":"working"}');
    await act(async () => rendered.root.findByProps({ id: 'response-tab-headers' }).props.onClick());
    assert.ok(JSON.stringify(rendered.toJSON()).includes('application/json'));
    assert.equal(rendered.root.findByProps({ id: 'response-tab-headers' }).props['aria-selected'], true);
    await act(async () => rendered.root.findByProps({ 'aria-label': '关闭测试结果' }).props.onClick());
    assert.equal(dialog.open, false);
  } finally { await act(async () => rendered.unmount()); }
});

test('failed requests are displayed in the result modal and can be dismissed', async () => {
  invoke = async () => { throw new Error('服务执行失败：example'); };
  const { rendered, dialog } = await mount();
  try {
    await act(async () => rendered.root.findByProps({ 'aria-label': '测试服务' }).props.onClick());
    await act(async () => rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(dialog.open, true);
    assert.equal(rendered.root.findByType('pre').props.children, '服务执行失败：example');
    await act(async () => rendered.root.findByType('dialog').props.onCancel());
    assert.equal(dialog.open, false);
  } finally { await act(async () => rendered.unmount()); }
});

test('service fields share the title bar and the switch lives in the service list', async () => {
  const { rendered } = await mount();
  try {
    const titleBar = rendered.root.findAllByType('h3')[0].parent.parent;
    assert.equal(titleBar.findByProps({ id: 'service-name' }).props.value, 'Hello');
    assert.equal(titleBar.findByProps({ id: 'service-route' }).props.value, '/hello');
    assert.equal(titleBar.findByProps({ 'aria-label': '服务请求方法' }).props.value, 'GET');
    assert.equal(rendered.root.findAllByType('a').length, 0);
    assert.equal(titleBar.findAllByProps({ role: 'switch' }).length, 0);
    const toggle = rendered.root.findByProps({ role: 'switch' });
    assert.equal(toggle.props['aria-checked'], true);
    assert.equal(toggle.parent.parent.findByType('h4').props.title, 'Hello');
  } finally { await act(async () => rendered.unmount()); }
});


test('list switch saves only status and preserves unsaved editor fields', async () => {
  let submitted;
  let finish;
  updateStatus = (...args) => { submitted = args; return new Promise(resolve => { finish = resolve; }); };
  const { rendered } = await mount();
  try {
    await act(async () => rendered.root.findByProps({ id: 'service-name' }).props.onChange({ target: { value: 'Unsaved name' } }));
    let stopped = false;
    await act(async () => { rendered.root.findByProps({ role: 'switch' }).props.onClick({ stopPropagation() { stopped = true; } }); });
    assert.equal(stopped, true);
    assert.deepEqual(submitted, ['project', { id: 'service', status: 'inactive' }]);
    assert.equal(rendered.root.findByProps({ role: 'switch' }).props.disabled, true);
    await act(async () => finish({ ...service, status: 'inactive' }));
    assert.equal(rendered.root.findByProps({ role: 'switch' }).props['aria-checked'], false);
    assert.equal(rendered.root.findByProps({ id: 'service-name' }).props.value, 'Unsaved name');
    assert.equal(rendered.root.findByProps({ 'aria-label': '测试服务' }).props.disabled, true);
  } finally { await act(async () => rendered.unmount()); }
});

test('a failed status update preserves the previous switch state', async () => {
  updateStatus = async () => { throw new Error('没有修改权限'); };
  const { rendered, dialog } = await mount();
  try {
    await act(async () => rendered.root.findByProps({ role: 'switch' }).props.onClick({ stopPropagation() {} }));
    assert.equal(rendered.root.findByProps({ role: 'switch' }).props['aria-checked'], true);
    assert.equal(rendered.root.findByProps({ role: 'switch' }).props.disabled, false);
    assert.equal(dialog.open, true);
    assert.equal(rendered.root.findByType('pre').props.children, '没有修改权限');
  } finally { await act(async () => rendered.unmount()); }
});


test('invalid JSON is rejected before sending and GET omits a retained body', async () => {
  let called;
  invoke = (...args) => { called = args; return Promise.resolve({ status: 422, statusText: 'Unprocessable Entity', duration: 3, ok: false, body: '{"error":"invalid"}' }); };
  const { rendered } = await mount();
  try {
    await act(async () => rendered.root.findByProps({ 'aria-label': '测试服务' }).props.onClick());
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求方法' }).props.onChange({ target: { value: 'POST' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求体' }).props.onChange({ target: { value: '{bad json' } }));
    await act(async () => rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(called, undefined);
    assert.equal(rendered.root.findByType('pre').props.children, '请求体不是有效的 JSON');
    await act(async () => rendered.root.findByProps({ 'aria-label': '请求方法' }).props.onChange({ target: { value: 'GET' } }));
    await act(async () => rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(called[2].method, 'GET');
    assert.equal(called[2].body, undefined);
    assert.ok(rendered.root.findByType('pre').props.children.includes('"error": "invalid"'));
    assert.ok(JSON.stringify(rendered.toJSON()).includes('422'));
  } finally { await act(async () => rendered.unmount()); }
});


test('a service method is editable and initializes the tester from the saved definition', async () => {
  const { rendered } = await mount({ ...service, method: 'POST' });
  try {
    assert.equal(rendered.root.findByProps({ 'aria-label': '服务请求方法' }).props.value, 'POST');
    await act(async () => rendered.root.findByProps({ 'aria-label': '服务请求方法' }).props.onChange({ target: { value: 'PATCH' } }));
    assert.equal(rendered.root.findByProps({ 'aria-label': '服务请求方法' }).props.value, 'PATCH');
    await act(async () => rendered.root.findByProps({ 'aria-label': '测试服务' }).props.onClick());
    assert.equal(rendered.root.findByProps({ 'aria-label': '请求方法' }).props.value, 'POST');
  } finally { await act(async () => rendered.unmount()); }
});


test('request field rows can be disabled and removed without sending their values', async () => {
  let called;
  invoke = (...args) => { called = args; return Promise.resolve({ status: 200, statusText: 'OK', body: '{}', ok: true, duration: 1, headers: {}, size: 2 }); };
  const { rendered } = await mount();
  try {
    await act(async () => rendered.root.findByProps({ 'aria-label': '测试服务' }).props.onClick());
    await act(async () => rendered.root.findByProps({ 'aria-label': '查询参数名称 1' }).props.onChange({ target: { value: 'skip' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '查询参数值 1' }).props.onChange({ target: { value: 'hidden value' } }));
    await act(async () => rendered.root.findByProps({ 'aria-label': '启用查询参数 1' }).props.onChange({ target: { checked: false } }));
    await act(async () => rendered.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(called[2].query, '');
    await act(async () => rendered.root.findByProps({ 'aria-label': '删除查询参数 1' }).props.onClick());
    assert.equal(rendered.root.findByProps({ 'aria-label': '查询参数名称 1' }).props.value, '');
    assert.equal(rendered.root.findByProps({ 'aria-label': '启用查询参数 1' }).props.checked, true);
  } finally { await act(async () => rendered.unmount()); }
});
