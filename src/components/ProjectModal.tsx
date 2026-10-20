import React, { useState } from 'react';
import { X, Folder, Link } from 'lucide-react';
import type { Project } from '../types';

interface ProjectModalProps {
  onClose: () => void;
  project?: Project;
  onSave: (name: string, slug: string) => Promise<void>;
}

export default function ProjectModal({ onClose, onSave, project }: ProjectModalProps) {
  const [name, setName] = useState(project?.name || '');
  const [slug, setSlug] = useState(project?.slug || '');
  const validSlug = slug.length <= 63 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !validSlug) return;
    
    setLoading(true);
    setError('');
    try {
      await onSave(name.trim(), slug);
    } catch (err: any) {
      setError(err.message || '保存项目失败');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center">
            <Folder className="w-5 h-5 mr-2 text-indigo-500" />
            {project ? '编辑项目' : '新建项目'}
          </h2>
          <button 
            onClick={onClose} 
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 text-rose-600 text-xs font-medium rounded-lg border border-rose-100">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="project-name" className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">项目名称 (Project Name)</label>
            <input id="project-name"
              type="text"
              required
              autoFocus
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-400"
              placeholder="例如: 日常备份任务"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="project-slug" className="block text-xs font-medium text-slate-500 mb-2">项目标识</label>
            <div className="relative">
              <Link className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
              <input id="project-slug" required maxLength={63} pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none"
                placeholder="例如：my-project" value={slug} onChange={e => setSlug(e.target.value.toLowerCase())}
                aria-describedby="project-slug-help" />
            </div>
            <p id="project-slug-help" className="mt-2 text-xs text-slate-400">全局唯一，以字母开头，支持小写字母、数字和连字符。</p>
            {validSlug && <div className="mt-3 px-3 py-2 rounded-lg bg-indigo-50 text-xs text-indigo-600 font-mono break-all">
              {window.location.origin}/{slug}/**
            </div>}
            {project?.slug && slug !== project.slug && <p className="mt-2 text-xs text-amber-600">保存后，服务访问地址将使用新的项目标识。</p>}
          </div>

          <div className="pt-2 flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim() || !validSlug}
              className="flex-[2] px-4 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '保存中...' : project ? '保存修改' : '确认创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
