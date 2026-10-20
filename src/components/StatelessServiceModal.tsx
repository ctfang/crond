import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Play, Save, Activity, Layout, Copy, Check, Loader2, Send, TerminalSquare, ArrowDownToLine, Clock3, CircleAlert, RotateCcw } from 'lucide-react';
import { api, type ServiceTestResponse } from '../services/api';
import { Project, StatelessService, ServiceMethod } from '../types';
import Editor from '@monaco-editor/react';
import RequestFieldsEditor, { createRequestField, type RequestField } from './RequestFieldsEditor';

interface Props {
  projectId: string;
  project?: Project;
  onClose?: () => void;
  onEditProject?: () => void;
}

export default function StatelessServiceModal({ projectId, project, onClose, onEditProject }: Props) {
  const [services, setServices] = useState<StatelessService[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState<Partial<StatelessService> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingServiceId, setTogglingServiceId] = useState<string | null>(null);
  const statusMutation = useRef(false);
  const [isRunning, setIsRunning] = useState(false);
  const [serviceOutput, setServiceOutput] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [resultTitle, setResultTitle] = useState('服务测试');
  const [resultState, setResultState] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [testTarget, setTestTarget] = useState<StatelessService | null>(null);
  const [requestMethod, setRequestMethod] = useState('GET');
  const serviceMethods: ServiceMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const [queryFields, setQueryFields] = useState<RequestField[]>(() => [createRequestField()]);
  const [headerFields, setHeaderFields] = useState<RequestField[]>(() => [createRequestField()]);
  const [bodyInput, setBodyInput] = useState('');
  const [bodyFormat, setBodyFormat] = useState('json');
  const [requestTab, setRequestTab] = useState('params');
  const [responseTab, setResponseTab] = useState('body');
  const [rawResponse, setRawResponse] = useState(false);
  const [responseCopy, setResponseCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [testResponse, setTestResponse] = useState<ServiceTestResponse | null>(null);
  const hasRequestBody = requestMethod !== 'GET' && requestMethod !== 'HEAD';
  const resultDialog = useRef<HTMLDialogElement>(null);
  const serviceNameInput = useRef<HTMLInputElement>(null);
  const shouldFocusName = useRef(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const savedService = services.find(service => service.id === editingService?.id);
  const accessPrefix = project?.slug ? `${window.location.origin}/${project.slug}` : '';
  const draftRoute = editingService?.route || '/';
  const displayedAddress = accessPrefix ? `${accessPrefix}${draftRoute.startsWith('/') ? draftRoute : `/${draftRoute}`}` : '';
  const hasUnsavedChanges = Boolean(savedService && (editingService?.content !== savedService.content || editingService?.route !== savedService.route || editingService?.name !== savedService.name || editingService?.status !== savedService.status || (editingService?.method || 'GET') !== (savedService.method || 'GET')));

  useEffect(() => {
    if (copyStatus === 'idle') return;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => { setCopyStatus('idle'); }, [editingService?.route, project?.slug]);

  useEffect(() => {
    if (shouldFocusName.current) {
      serviceNameInput.current?.focus();
      shouldFocusName.current = false;
    }
  }, [editingService]);

  useEffect(() => {
    const dialog = resultDialog.current;
    if (!dialog) return;
    if (showResult && !dialog.open) dialog.showModal();
    if (!showResult && dialog.open) dialog.close();
  }, [showResult]);

  const handleCopyAddress = async () => {
    if (!displayedAddress) return;
    try {
      await navigator.clipboard.writeText(displayedAddress);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  };

  useEffect(() => {
    fetchServices();
  }, [projectId]);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const data = await api.getStatelessServices(projectId);
      setServices(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (service: StatelessService | null = null) => {
    shouldFocusName.current = service === null;
    setServiceOutput('');
    setCopyStatus('idle');
    if (service) {
      setEditingService({ ...service, method: service.method || 'GET' });
    } else {
      setEditingService({
        name: '',
        route: '/',
        method: 'GET',
        content: project?.framework
          ? '<?php\n\nfunction handle(\\Framework\\Request $request)\n{\n    \\Framework\\Logger::info("Service invoked", ["method" => $request->method]);\n    return ["app" => \\Framework\\Config::get("app.name"), "message" => $request->input("message", "Hello from Script Framework")];\n}\n'
          : '<?php\n\n/**\n * Origami Stateless Service Endpoint\n * Each request binds to this function execution\n */\nfunction handle(Request $request)\n{\n    return [\n        "status" => "success",\n        "message" => "Hello from Origami",\n        "timestamp" => time()\n    ];\n}\n',
        status: 'active'
      });
    }
  };

  const handleSave = async () => {
    if (statusMutation.current) return;
    if (!editingService?.name || !editingService?.route || !editingService?.content) {
      alert('请填写完整信息');
      return;
    }

    setIsSaving(true);
    try {
      const saved = await api.upsertStatelessService(projectId, editingService);
      setEditingService(saved);
      setServices(prev => [saved, ...prev.filter(service => service.id !== saved.id)]);
      setServiceOutput('');
      setCopyStatus('idle');
    } catch (err: any) {
      setServiceOutput(err.message || '保存失败');
      setResultTitle('保存失败');
      setResultState('error');
      setShowResult(true);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = () => {
    if (!savedService || isRunning) return;
    if (testTarget?.id !== savedService.id || testTarget?.method !== savedService.method) {
      setRequestMethod(savedService.method || 'GET'); setQueryFields([createRequestField()]); setHeaderFields([createRequestField()]); setBodyInput(''); setBodyFormat('json');
    }
    setTestTarget({ ...savedService });
    setServiceOutput('');
    setTestResponse(null);
    setResultTitle('服务测试');
    setResultState('idle');
    setRequestTab('params'); setResponseTab('body'); setRawResponse(false); setResponseCopy('idle');
    setShowResult(true);
  };

  const parseParameters = (text: string) => {
    const parameters = new URLSearchParams();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const separator = line.indexOf('=');
      if (separator < 1) throw new Error('参数请按每行 key=value 填写');
      const key = line.slice(0, separator).trim();
      if (!key) throw new Error('参数名称不能为空');
      parameters.append(key, line.slice(separator + 1).replace(/\r$/, ''));
    }
    return parameters.toString();
  };

  const handleSendRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!testTarget || isRunning) return;
    setServiceOutput(''); setTestResponse(null); setResponseTab('body'); setResponseCopy('idle');
    try {
      const parameters = new URLSearchParams();
      for (const field of queryFields) {
        if (!field.enabled || (!field.key.trim() && !field.value)) continue;
        if (!field.key.trim()) { setRequestTab('params'); throw new Error('查询参数名称不能为空'); }
        parameters.append(field.key.trim(), field.value);
      }
      const query = parameters.toString();
      const headers = new Headers();
      for (const field of headerFields) {
        if (!field.enabled || (!field.key.trim() && !field.value)) continue;
        if (!field.key.trim()) { setRequestTab('headers'); throw new Error('请求头名称不能为空'); }
        try { headers.append(field.key.trim(), field.value); } catch { setRequestTab('headers'); throw new Error('请求头名称或值无效，请检查后重试'); }
      }
      let body: string | undefined;
      if (hasRequestBody && bodyInput !== '') {
        body = bodyInput;
        if (bodyFormat === 'json') {
          try { JSON.parse(body); } catch { setRequestTab('body'); throw new Error('请求体不是有效的 JSON'); }
        }
        if (bodyFormat === 'form') body = parseParameters(bodyInput);
        if (!headers.has('Content-Type')) headers.set('Content-Type', bodyFormat === 'json' ? 'application/json' : bodyFormat === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain');
      }
      setResultState('running'); setIsRunning(true);
      const response = await api.invokeService(projectId, testTarget.route, { method: requestMethod, query, headers: Object.fromEntries(headers.entries()), body });
      setTestResponse(response);
      let output = response.body;
      try { output = JSON.stringify(JSON.parse(output), null, 2); } catch { /* Preserve plain text and empty responses. */ }
      setServiceOutput(output);
      setResultState(response.ok ? 'success' : 'error');
    } catch (err: any) {
      setServiceOutput(err.message || '服务执行失败');
      setResultState('error');
    } finally { setIsRunning(false); }
  };

  const activeQueryCount = queryFields.filter(field => field.enabled && field.key.trim()).length;
  const activeHeaderCount = headerFields.filter(field => field.enabled && field.key.trim()).length;
  const queryPreview = new URLSearchParams();
  queryFields.filter(field => field.enabled && field.key.trim()).forEach(field => queryPreview.append(field.key.trim(), field.value));
  const testAddress = testTarget ? `${accessPrefix || `${window.location.origin}/api/projects/${encodeURIComponent(projectId)}/invoke`}${testTarget.route}${queryPreview.toString() ? `?${queryPreview}` : ''}` : '';
  const responseHeaders = Object.entries(testResponse?.headers || {});
  const responseText = responseTab === 'headers' ? responseHeaders.map(([name, value]) => `${name}: ${value}`).join('\n') : rawResponse && testResponse ? testResponse.body : serviceOutput;

  useEffect(() => {
    if (responseCopy === 'idle') return;
    const timer = window.setTimeout(() => setResponseCopy('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [responseCopy]);

  const copyResponse = async () => {
    try { await navigator.clipboard.writeText(responseText); setResponseCopy('copied'); }
    catch { setResponseCopy('failed'); }
  };

  const navigateTabs = (event: React.KeyboardEvent<HTMLButtonElement>, values: string[], current: string, select: (value: string) => void) => {
    const index = values.indexOf(current);
    const next = event.key === 'ArrowRight' ? (index + 1) % values.length : event.key === 'ArrowLeft' ? (index + values.length - 1) % values.length : event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); select(values[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  const handleToggleStatus = async (service: StatelessService) => {
    if (statusMutation.current || isSaving) return;
    statusMutation.current = true;
    setTogglingServiceId(service.id);
    try {
      const saved = await api.upsertStatelessService(projectId, { id: service.id, status: service.status === 'active' ? 'inactive' : 'active' });
      setServices(prev => prev.map(item => item.id === saved.id ? saved : item));
      setEditingService(current => current?.id === saved.id ? { ...current, status: saved.status } : current);
    } catch (err: any) {
      setServiceOutput(err.message || '状态更新失败');
      setResultTitle('状态更新失败');
      setResultState('error');
      setShowResult(true);
    } finally {
      statusMutation.current = false;
      setTogglingServiceId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此无状态服务？')) return;
    try {
      await api.deleteStatelessService(projectId, id);
      fetchServices();
    } catch (err) {
      alert('删除失败');
    }
  };

  return (
    <div className="@container w-full h-full bg-white flex flex-col overflow-hidden">
      <div className="grid grid-cols-[128px_minmax(0,1fr)] @min-[720px]:grid-cols-[176px_minmax(0,1fr)] @min-[1040px]:grid-cols-[208px_minmax(0,1fr)] h-14 border-b border-slate-200 bg-white shrink-0">
        <div className="px-4 flex items-center gap-2 border-r border-slate-200">
          <h3 className="min-w-0 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Activity className="w-4 h-4 shrink-0 text-indigo-500" />
            <span className="@min-[720px]:hidden">服务</span><span className="hidden @min-[720px]:inline whitespace-nowrap">无状态服务</span>
          </h3>
          <button onClick={() => handleEdit()} title="新建服务" aria-label="新建服务" className="ml-auto h-7 w-7 shrink-0 grid place-items-center text-slate-500 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="min-w-0 px-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {editingService && <div className="flex items-center gap-2 flex-1 min-w-0">
            <label htmlFor="service-name" className="sr-only">服务名称</label>
            <input ref={serviceNameInput} id="service-name" className="w-16 @min-[720px]:w-24 @min-[1040px]:w-32 shrink-0 h-8 px-2.5 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              placeholder="服务名称" title="服务名称" value={editingService.name}
              onChange={e => setEditingService({...editingService, name: e.target.value})} />
            <select aria-label="服务请求方法" title="服务接收的请求方法，修改后保存生效" value={editingService.method || 'GET'}
              onChange={e => setEditingService({ ...editingService, method: e.target.value as ServiceMethod })}
              className="h-8 w-[76px] shrink-0 px-1.5 rounded-md border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {serviceMethods.map(method => <option key={method}>{method}</option>)}
            </select>
            <label htmlFor="service-route" className="sr-only">访问路径</label>
            <div className="h-8 min-w-32 flex-1 flex overflow-hidden bg-white border border-slate-200 rounded-md focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all">
              <button onClick={handleRun} disabled={isRunning || !savedService || savedService.status === 'inactive'} aria-label={isRunning ? '执行中' : '测试服务'} title="测试已保存的服务" className="self-stretch shrink-0 inline-flex items-center justify-center gap-1.5 px-2 border-r border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}<span className="hidden @min-[900px]:inline">测试</span>
              </button>
              <div className="min-w-0 flex-1 flex items-center overflow-x-auto">
                {accessPrefix ? <span className="pl-2 shrink-0 text-xs leading-5 font-mono text-slate-400 whitespace-nowrap select-text" title={accessPrefix}>{accessPrefix}</span> :
                  <button type="button" onClick={onEditProject} disabled={!onEditProject} className="px-3 shrink-0 text-xs text-indigo-600 hover:underline disabled:text-slate-400 disabled:no-underline" title="当前项目尚未设置标识，设置后生成服务地址">设置项目标识</button>}
                <input id="service-route"
                  className="h-full min-w-20 flex-1 pl-0 pr-2 bg-transparent text-xs leading-5 font-mono text-slate-700 outline-none"
                  placeholder="/user/info"
                  value={editingService.route}
                  onChange={e => setEditingService({...editingService, route: e.target.value.startsWith('/') ? e.target.value : `/${e.target.value}`})}
                />
              </div>
              <button onClick={handleCopyAddress} title={copyStatus === 'copied' ? '地址已复制' : copyStatus === 'failed' ? '复制失败，请重试' : '复制服务地址'} aria-label={copyStatus === 'copied' ? '地址已复制' : copyStatus === 'failed' ? '复制失败，请重试' : '复制地址'} disabled={!project?.slug} className="self-stretch shrink-0 inline-flex items-center justify-center px-2 bg-slate-50/60 text-slate-500 border-l border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                {copyStatus === 'copied' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className={`w-3.5 h-3.5 ${copyStatus === 'failed' ? 'text-rose-500' : ''}`} />}
              </button>
              <span role="status" className="sr-only">{copyStatus === 'copied' ? '地址已复制' : copyStatus === 'failed' ? '复制失败，请重试' : ''}</span>
            </div>
          </div>}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {editingService && <>
              <button onClick={handleSave} disabled={isSaving || togglingServiceId !== null} aria-label={isSaving ? '保存中' : '保存服务'} title={hasUnsavedChanges ? '保存修改，访问和测试使用已保存的版本' : '保存服务'} className="h-8 shrink-0 inline-flex items-center justify-center gap-1.5 px-2 @min-[720px]:px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-semibold transition-colors disabled:opacity-50">
                {hasUnsavedChanges && <span className="w-1.5 h-1.5 rounded-full bg-amber-300" aria-label="未保存修改" />}<Save className="w-3.5 h-3.5" /><span className="hidden @min-[720px]:inline">{isSaving ? '保存中…' : '保存'}</span>
              </button>

            </>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[128px_minmax(0,1fr)] @min-[720px]:grid-cols-[176px_minmax(0,1fr)] @min-[1040px]:grid-cols-[208px_minmax(0,1fr)] flex-1 min-h-0 overflow-hidden">
          {/* Sidebar / List */}
          <div className="min-w-0 border-r border-slate-200 flex flex-col bg-slate-50/70">
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="text-center py-8 text-slate-400 text-sm">加载中...</div>
              ) : services.length === 0 ? (
                <div className="text-center py-8 px-3">
                   <div className="w-9 h-9 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Layout className="w-4 h-4 text-slate-300" />
                   </div>
                   <p className="text-xs text-slate-400 font-medium">暂无无状态服务</p>
                </div>
              ) : (
                services.map(s => (
                  <div
                    key={s.id}
                    onClick={() => handleEdit(s)}
                    className={`p-2 rounded-md cursor-pointer border transition-colors relative group ${
                      editingService?.id === s.id
                        ? 'bg-indigo-50 border-indigo-100'
                        : 'bg-transparent border-transparent hover:bg-white hover:border-slate-200 text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <h4 title={s.name} className={`min-w-0 text-xs font-semibold truncate ${editingService?.id === s.id ? 'text-indigo-600' : 'text-slate-800'}`}>{s.name}</h4>
                      <div className="flex items-center space-x-1 shrink-0">
                        <button disabled={togglingServiceId === s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(s.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded hover:bg-rose-50 transition-all shrink-0"
                          title="删除无状态服务"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex items-center gap-1.5">
                        <span className="shrink-0 text-[9px] font-semibold text-slate-400">{s.method || 'GET'}</span>
                        <span className="text-[10px] font-mono text-slate-500 truncate" title={s.route}>{s.route}</span>
                      </span>
                      <button type="button" role="switch" aria-label={`启用服务：${s.name}`} aria-checked={s.status === 'active'}
                        disabled={togglingServiceId !== null || isSaving} aria-busy={togglingServiceId === s.id}
                        title={s.status === 'active' ? '点击停用，立即生效' : '点击启用，立即生效'}
                        onClick={e => { e.stopPropagation(); handleToggleStatus(s); }}
                        className="h-6 w-8 shrink-0 flex items-center justify-center rounded-md disabled:opacity-50 disabled:cursor-wait focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                        <span className={`relative inline-flex h-3 w-5 items-center rounded-full transition-colors ${s.status === 'active' ? 'bg-emerald-800' : 'bg-slate-500'}`}>
                          <span className={`h-2 w-2 bg-slate-100 rounded-full transition-transform ${s.status === 'active' ? 'translate-x-2.5' : 'translate-x-0.5'}`} />
                        </span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Editor Area */}
          <div className="min-w-0 flex-1 flex flex-col bg-white">
            {editingService ? (
              <>
                <div className="flex-1 relative">
                  <div className="absolute inset-0">
                    <Editor
                      height="100%"
                      defaultLanguage="php"
                      theme="vs-dark"
                      value={editingService.content}
                      onChange={val => setEditingService({...editingService, content: val || ''})}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineHeight: 20,
                        padding: { top: 16 },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace'
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-6 border border-slate-100">
                  <Activity className="w-10 h-10 text-slate-200" />
                </div>
                <h4 className="text-xl font-bold text-slate-700 mb-2">选择一个 Origami 服务开始编辑</h4>
                <p className="max-w-md text-sm leading-relaxed">
                   使用 PHP 风格语法编写服务，每次 HTTP 请求由独立的 Origami 运行环境执行。支持请求参数、JSON 返回和项目数据存储。
                </p>
                <button
                  onClick={() => handleEdit()}
                  className="mt-8 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  创建第一个服务
                </button>
              </div>
            )}
          </div>
        </div>
      <dialog ref={resultDialog} aria-labelledby="service-result-title" onCancel={() => setShowResult(false)} onClose={() => setShowResult(false)}
        onClick={e => { if (e.target === e.currentTarget) setShowResult(false); }}
        className={`@container/testpanel m-auto w-[calc(100%-2rem)] p-0 rounded-xl border border-slate-200 bg-white shadow-2xl backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm ${resultTitle === '服务测试' ? 'max-w-[1120px]' : 'max-w-xl'}`}>
        <div className={`flex flex-col overflow-hidden ${resultTitle === '服务测试' ? 'h-[min(760px,90vh)]' : 'max-h-[80vh]'}`}>
          <div className="h-16 px-5 flex items-center justify-between gap-3 border-b border-slate-200 shrink-0">
            <div className="min-w-0 flex items-center gap-3">
              <div className="h-8 w-8 shrink-0 grid place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600"><TerminalSquare className="w-4 h-4" /></div>
              <div className="min-w-0">
                <h3 id="service-result-title" className="text-sm font-semibold text-slate-800">{resultTitle}</h3>
                {resultTitle === '服务测试' && testTarget && <p className="mt-0.5 text-[11px] text-slate-400 truncate">{testTarget.name}<span className="mx-2 text-slate-200">/</span>已保存版本</p>}
              </div>
            </div>
            <button onClick={() => setShowResult(false)} aria-label="关闭测试结果" className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"><X className="w-4 h-4" /></button>
          </div>
          {resultTitle === '服务测试' && testTarget ? <>
            <form onSubmit={handleSendRequest} className="flex flex-col flex-1 min-h-0">
              <div className="px-5 py-4 flex items-center gap-3 border-b border-slate-200 shrink-0 bg-slate-50/50">
                <div className="h-10 min-w-0 flex-1 flex overflow-hidden rounded-lg border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-indigo-500/10 focus-within:border-indigo-400">
                  <select autoFocus aria-label="请求方法" value={requestMethod} disabled={isRunning} onChange={e => setRequestMethod(e.target.value)} className={`h-full w-24 shrink-0 px-3 border-r border-slate-200 bg-slate-50 text-xs font-semibold outline-none ${requestMethod === 'GET' ? 'text-emerald-700' : requestMethod === 'DELETE' ? 'text-rose-600' : 'text-indigo-600'}`}>
                    {serviceMethods.map(method => <option key={method}>{method}</option>)}
                  </select>
                  <input readOnly aria-label="测试地址" value={testAddress} title={testAddress} className="min-w-0 flex-1 px-3 bg-transparent font-mono text-xs text-slate-600 outline-none" />
                </div>
                <button type="submit" disabled={isRunning} className="h-10 px-4 shrink-0 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                  {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{isRunning ? '发送中…' : '发送请求'}
                </button>
              </div>
              <div className="grid grid-cols-1 @min-[900px]/testpanel:grid-cols-2 min-h-0 flex-1 overflow-auto">
                <section aria-label="请求配置" className="min-w-0 min-h-[320px] @min-[900px]/testpanel:min-h-0 flex flex-col border-b @min-[900px]/testpanel:border-b-0 @min-[900px]/testpanel:border-r border-slate-200">
                  <div className="h-10 px-4 flex items-center justify-between shrink-0 border-b border-slate-100">
                    <span className="text-[11px] font-semibold tracking-wide text-slate-500">请求配置</span>
                    <button type="button" disabled={isRunning} onClick={() => { setQueryFields([createRequestField()]); setHeaderFields([createRequestField()]); setBodyInput(''); setBodyFormat('json'); }} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 disabled:opacity-50"><RotateCcw className="w-3 h-3" />重置</button>
                  </div>
                  <div role="tablist" aria-label="请求配置选项" className="h-11 flex items-stretch px-4 gap-5 border-b border-slate-200 shrink-0">
                    {[{ id: 'params', label: '查询参数', count: activeQueryCount }, { id: 'headers', label: '请求头', count: activeHeaderCount }, { id: 'body', label: '请求体', count: hasRequestBody && bodyInput ? 1 : 0 }].map(tab => (
                      <button key={tab.id} type="button" role="tab" id={`request-tab-${tab.id}`} aria-selected={requestTab === tab.id} aria-controls={`request-panel-${tab.id}`} tabIndex={requestTab === tab.id ? 0 : -1}
                        onKeyDown={e => navigateTabs(e, ['params', 'headers', 'body'], requestTab, setRequestTab)} onClick={() => setRequestTab(tab.id)}
                        className={`flex items-center gap-1.5 border-b-2 text-xs font-medium transition-colors ${requestTab === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>
                        {tab.label}{tab.count > 0 && <span className="px-1.5 py-0.5 text-[9px] rounded bg-slate-100 text-slate-500 tabular-nums">{tab.count}</span>}
                      </button>
                    ))}
                  </div>
                  <div id="request-panel-params" role="tabpanel" aria-labelledby="request-tab-params" className={requestTab === 'params' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
                    <RequestFieldsEditor label="查询参数" fields={queryFields} disabled={isRunning} onChange={setQueryFields} />
                  </div>
                  <div id="request-panel-headers" role="tabpanel" aria-labelledby="request-tab-headers" className={requestTab === 'headers' ? 'flex-1 min-h-0 overflow-y-auto' : 'hidden'}>
                    <RequestFieldsEditor label="请求头" fields={headerFields} disabled={isRunning} onChange={setHeaderFields} />
                  </div>
                  <div id="request-panel-body" role="tabpanel" aria-labelledby="request-tab-body" className={requestTab === 'body' ? 'p-4 flex-1 min-h-0 flex flex-col gap-3' : 'hidden'}>
                    {hasRequestBody ? <>
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="service-test-body" className="text-xs font-medium text-slate-500">请求正文</label>
                        <select aria-label="请求体格式" value={bodyFormat} disabled={isRunning} onChange={e => setBodyFormat(e.target.value)} className="h-7 px-2 rounded-md bg-slate-50 border border-slate-200 text-[11px] text-slate-600"><option value="json">JSON</option><option value="form">Form URL Encoded</option><option value="text">Text</option></select>
                      </div>
                      <textarea id="service-test-body" aria-label="请求体" disabled={isRunning} value={bodyInput} onChange={e => setBodyInput(e.target.value)} spellCheck={false} placeholder={bodyFormat === 'json' ? '{\n  "message": "hello"\n}' : bodyFormat === 'form' ? 'message=hello\npage=1' : '填写请求正文'} className="flex-1 min-h-40 w-full resize-none p-3 rounded-lg border border-slate-200 bg-slate-50/50 font-mono text-xs leading-6 text-slate-700 placeholder:text-slate-300 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10" />
                      <p className="text-[11px] text-slate-400">{bodyFormat === 'json' ? '发送前校验 JSON 格式。' : bodyFormat === 'form' ? '每行填写 key=value，发送时自动编码。' : '按原始文本发送正文。'}</p>
                    </> : <div className="flex-1 flex items-center justify-center text-xs text-slate-400">{requestMethod} 请求不发送正文</div>}
                  </div>
                </section>
                <section aria-label="接口响应" className="min-w-0 min-h-[320px] @min-[900px]/testpanel:min-h-0 flex flex-col bg-slate-50/40">
                  <div className="h-10 px-4 flex items-center justify-between gap-2 shrink-0 border-b border-slate-100">
                    <span className="text-[11px] font-semibold tracking-wide text-slate-500">接口响应</span>
                    <span role="status" className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${resultState === 'error' ? 'text-rose-600' : resultState === 'success' ? 'text-emerald-700' : 'text-slate-400'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${resultState === 'error' ? 'bg-rose-500' : resultState === 'success' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      {testResponse ? `${testResponse.status} ${testResponse.statusText}` : resultState === 'running' ? '请求中' : resultState === 'error' ? '请求失败' : '未发送'}
                    </span>
                  </div>
                  <div className="h-11 px-4 flex items-center justify-between gap-2 border-b border-slate-200 shrink-0 bg-white">
                    <div role="tablist" aria-label="响应内容选项" className="h-full flex items-stretch gap-5">
                      {[{ id: 'body', label: '响应体' }, { id: 'headers', label: '响应头' }].map(tab => <button key={tab.id} type="button" role="tab" id={`response-tab-${tab.id}`} aria-controls="service-response-panel" aria-selected={responseTab === tab.id} tabIndex={responseTab === tab.id ? 0 : -1} onKeyDown={e => navigateTabs(e, ['body', 'headers'], responseTab, setResponseTab)} onClick={() => { setResponseTab(tab.id); setResponseCopy('idle'); }} className={`border-b-2 text-xs font-medium ${responseTab === tab.id ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{tab.label}</button>)}
                    </div>
                    <div className="flex items-center gap-2">
                      {responseTab === 'body' && testResponse && <button type="button" aria-pressed={rawResponse} onClick={() => { setRawResponse(!rawResponse); setResponseCopy('idle'); }} className="text-[10px] text-slate-500 hover:text-indigo-600">{rawResponse ? '原始' : '格式化'}</button>}
                      <button type="button" onClick={copyResponse} disabled={!responseText || isRunning} aria-label="复制响应" title={responseCopy === 'failed' ? '复制失败，请重试' : '复制当前响应内容'} className="h-7 inline-flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 disabled:opacity-30">
                        {responseCopy === 'copied' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}{responseCopy === 'copied' ? '已复制' : responseCopy === 'failed' ? '复制失败' : '复制'}
                      </button>
                    </div>
                  </div>
                  <div id="service-response-panel" role="tabpanel" aria-labelledby={`response-tab-${responseTab}`} className="flex-1 min-h-0 overflow-auto">
                    {resultState === 'idle' || resultState === 'running' ? <div className="h-full min-h-48 flex flex-col items-center justify-center px-6 text-center">
                      <div className="h-10 w-10 mb-3 grid place-items-center rounded-xl border border-slate-200 bg-white text-slate-300">{resultState === 'running' ? <Loader2 className="w-4 h-4 animate-spin text-indigo-500" /> : <ArrowDownToLine className="w-4 h-4" />}</div>
                      <p className="text-xs font-medium text-slate-500">{resultState === 'running' ? '正在请求服务…' : '等待响应'}</p>
                      <p className="mt-1.5 text-[11px] text-slate-400">{resultState === 'running' ? '响应内容将在这里显示' : '配置请求，点击发送后查看结果'}</p>
                    </div> : responseTab === 'headers' ? <div className="p-4">
                      {responseHeaders.length ? <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">{responseHeaders.map(([name, value]) => <div key={name} className="grid grid-cols-[minmax(100px,1fr)_minmax(0,1.6fr)] border-b last:border-b-0 border-slate-100 text-[11px] font-mono"><span className="px-3 py-2 text-slate-500 break-all bg-slate-50/50">{name}</span><span className="px-3 py-2 text-slate-700 break-all">{value}</span></div>)}</div> : <p className="text-xs text-slate-400">暂无响应头</p>}
                    </div> : <pre className={`min-h-full p-4 text-xs font-mono leading-6 whitespace-pre-wrap break-words ${resultState === 'error' ? 'bg-rose-50/40 text-rose-700' : 'bg-[#111827] text-slate-200'}`}>{responseText || '（空响应）'}</pre>}
                  </div>
                  <div className="h-9 px-4 flex items-center gap-4 text-[10px] tabular-nums text-slate-400 border-t border-slate-200 shrink-0 bg-white">
                    <span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />{testResponse ? `${testResponse.duration} ms` : '— ms'}</span>
                    <span>{testResponse ? `${((testResponse.size ?? new TextEncoder().encode(testResponse.body).length) / 1024).toFixed(2)} KB` : '— KB'}</span>
                    <span className="ml-auto truncate max-w-40">{testResponse?.headers?.['content-type'] || (testResponse ? '响应已接收' : '尚无响应')}</span>
                  </div>
                </section>
              </div>
            </form>
            <div className="h-9 px-5 flex items-center justify-between border-t border-slate-200 text-[10px] text-slate-400 bg-slate-50/50 shrink-0"><span>使用当前登录会话 · 测试已保存的服务</span><span>Esc 关闭</span></div>
          </> : <div className="min-h-0 overflow-y-auto p-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-rose-600"><CircleAlert className="w-4 h-4" />操作未完成</div>
            <pre className="p-4 rounded-lg bg-rose-50 text-xs leading-6 whitespace-pre-wrap break-words text-rose-700">{serviceOutput || '请稍后重试'}</pre>
          </div>}
        </div>
      </dialog>
    </div>
  );
}
