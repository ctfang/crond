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
        className={`w-full flex items-center gap-2 py-2 pr-3 text-left text-sm ${activeId === file.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:bg-slate-800'}`}
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

  return <div className="w-full h-full bg-[#1e1e1e] flex flex-col overflow-hidden">
    <div className="px-6 py-4 border-b border-slate-700 bg-[#252526]">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-200"><BookOpen className="w-5 h-5 text-indigo-400" />框架文档</h3>
      <p className="mt-2 text-xs text-slate-400">所有用户、所有项目共用默认框架。所有文件均可展开查看和复制，仅禁止修改。</p>
      <button type="button" className="mt-3 px-3 py-1.5 text-xs text-slate-200 border border-slate-600 rounded"
        onClick={() => { setActiveId(files.find(file => file.path === 'README.md')?.id ?? null); setShowSource(false); }}>框架说明</button>
    </div>
    {error ? <p role="alert" className="p-6 text-rose-400">{error}</p> : loading ? <p role="status" className="p-6 text-slate-400">正在加载框架文档…</p> :
      <div className="flex-1 flex min-h-0">
        <nav aria-label="框架文件" className="w-64 shrink-0 overflow-auto border-r border-slate-700 bg-[#252526] py-3">{renderTree()}</nav>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col text-slate-200">
          {active ? <>
            <div className="px-6 py-3 border-b border-slate-700 flex items-center justify-between text-xs text-slate-400">
              <span>{active.path} · 只读 · 可复制、搜索</span>
              {active.path.endsWith('.md') && <button type="button" className="px-3 py-1 border border-slate-600 rounded text-slate-200" onClick={() => setShowSource(value => !value)}>{showSource ? '阅读文档' : '查看源码'}</button>}
            </div>
            {active.path.endsWith('.md') && !showSource ? <article className="flex-1 overflow-auto p-8 text-sm leading-7">
              {(active.content || '').split('\n').map((line, index) => line.startsWith('# ') ? <h1 key={index} className="text-2xl font-bold mb-5">{line.slice(2)}</h1> : line.startsWith('## ') ? <h2 key={index} className="text-lg font-bold mt-6 mb-2">{line.slice(3)}</h2> : <p key={index} className="min-h-4 whitespace-pre-wrap">{line}</p>)}
            </article> : <div className="flex-1 min-h-0" aria-label="框架源码（只读）">
              <Editor key={active.id} path={active.path} height="100%" theme="vs-dark"
                language={active.path.endsWith('.md') ? 'markdown' : /\.(json|lock)$/.test(active.path) ? 'json' : active.path.endsWith('.php') ? 'php' : 'plaintext'}
                value={active.content || ''}
                options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, fontSize: 14,
                  lineNumbers: 'on', wordWrap: 'on', scrollBeyondLastLine: false, automaticLayout: true,
                  padding: { top: 16 }, contextmenu: true }} />
            </div>}
          </> : <p className="text-slate-500">选择框架文件以查看内容</p>}
        </div>
      </div>}
  </div>;
}
