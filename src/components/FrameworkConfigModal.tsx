import React, { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { BookOpen, ChevronDown, ChevronRight, FileCode, Folder } from 'lucide-react';
import { api } from '../services/api';
import { ProjectFile } from '../types';

export default function FrameworkConfigModal() {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['root']));
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    api.getFrameworkFiles().then(data => {
      if (stopped) return;
      setFiles(data);
      setExpanded(new Set(['root', ...data.filter(file => file.type === 'folder').map(file => file.id)]));
      setActiveId((data.find(file => file.path === 'README.md') || data.find(file => file.type === 'file'))?.id ?? null);
    }).catch(err => { if (!stopped) setError(err.message || '框架文档加载失败'); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, []);

  const active = files.find(file => file.id === activeId);
  const renderTree = (parentId = 'root', level = 0): React.ReactNode => files
    .filter(file => file.parentId === parentId)
    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)
    .map(file => <div key={file.id}>
      <button type="button" style={{ paddingLeft: level * 16 + 12 }}
        className={`w-full flex items-center gap-2 py-2 pr-3 rounded-md text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${activeId === file.id ? 'bg-indigo-50 text-indigo-600 font-semibold' : 'text-slate-600 hover:bg-slate-100'}`}
        title={file.path}
        aria-current={activeId === file.id ? 'page' : undefined}
        aria-expanded={file.type === 'folder' ? expanded.has(file.id) : undefined}
        onClick={() => {
          if (file.type === 'file') { setActiveId(file.id); setShowSource(false); return; }
          setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(file.id)) next.delete(file.id); else next.add(file.id);
            return next;
          });
        }}>
        {file.type === 'folder' ? <>
          {expanded.has(file.id) ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
          <Folder className="w-4 h-4 shrink-0" />
        </> : <FileCode className="w-4 h-4 shrink-0 ml-5" />}
        <span className="truncate">{file.name}</span>
      </button>
      {file.type === 'folder' && expanded.has(file.id) && renderTree(file.id, level + 1)}
    </div>);

  return <div className="@container w-full h-full bg-white flex flex-col overflow-hidden">
    {error ? <p role="alert" className="p-6 text-sm text-rose-600">{error}</p> : loading ? <p role="status" className="p-6 text-sm text-slate-500">正在加载框架文档…</p> :
      <div className="flex-1 flex min-h-0">
        <nav aria-label="框架文件" className="w-40 @min-[720px]:w-52 @min-[1040px]:w-64 shrink-0 overflow-auto border-r border-slate-200 bg-slate-50/70 p-2">
          <button type="button" className="mb-2 w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-indigo-600 rounded-md hover:bg-indigo-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
            onClick={() => { setActiveId(files.find(file => file.path === 'README.md')?.id ?? null); setShowSource(false); }}><BookOpen className="w-4 h-4 shrink-0" />框架说明</button>
          {renderTree()}
        </nav>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col text-slate-700">
          {active ? <>
            <div className="h-10 px-4 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between gap-3 text-xs text-slate-500 shrink-0">
              <span className="min-w-0 truncate font-mono" title={`${active.path} · 只读 · 可复制、搜索`}>{active.path}</span>
              {active.path.endsWith('.md') && <button type="button" className="shrink-0 px-3 py-1.5 border border-slate-200 bg-white rounded-md text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" onClick={() => setShowSource(value => !value)}>{showSource ? '阅读文档' : '查看源码'}</button>}
            </div>
            {active.path.endsWith('.md') && !showSource ? <article className="flex-1 min-h-0 overflow-auto p-4 @min-[720px]:p-6 text-sm leading-7 break-words">
              {(active.content || '').split('\n').map((line, index) => line.startsWith('# ') ? <h1 key={index} className="text-2xl font-semibold tracking-tight text-slate-900 mb-5">{line.slice(2)}</h1> : line.startsWith('## ') ? <h2 key={index} className="text-lg font-semibold text-slate-900 mt-8 mb-3 pb-2 border-b border-slate-100">{line.slice(3)}</h2> : <p key={index} className="min-h-4 whitespace-pre-wrap">{line}</p>)}
            </article> : <div className="flex-1 min-h-0" aria-label="框架源码（只读）">
              <Editor key={active.id} path={active.path} height="100%" theme="vs-dark"
                language={active.path.endsWith('.md') ? 'markdown' : /\.(json|lock)$/.test(active.path) ? 'json' : active.path.endsWith('.php') ? 'php' : 'plaintext'}
                value={active.content || ''}
                options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontSize: 14,
                  lineNumbers: 'on', wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true,
                  padding: { top: 16 }, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }, contextmenu: true }} />
            </div>}
          </> : <p className="p-8 text-sm text-slate-500">选择框架文件以查看内容</p>}
        </div>
      </div>}
  </div>;
}
