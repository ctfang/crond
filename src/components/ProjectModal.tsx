import React, { useState } from 'react';
import { X, Folder, Clock } from 'lucide-react';

interface ProjectModalProps {
  onClose: () => void;
  onCreated: (name: string, type: 'crond') => Promise<void>;
}

export default function ProjectModal({ onClose, onCreated }: ProjectModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    setError('');
    try {
      await onCreated(name, 'crond');
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-800 flex items-center">
            <Clock className="w-5 h-5 mr-2 text-indigo-500" />
            新建定时任务项目 (New Crond Project)
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
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">项目名称 (Project Name)</label>
            <input
              type="text"
              required
              autoFocus
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-400"
              placeholder="例如: 日常备份任务"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                <Clock className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <div className="text-xs font-bold text-slate-700">定时任务 (Crond)</div>
                <div className="text-[10px] text-slate-500">支持 PHP/Shell 脚本周期性执行</div>
              </div>
            </div>
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
              disabled={loading || !name.trim()}
              className="flex-[2] px-4 py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl hover:bg-slate-800 shadow-lg shadow-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '创建中...' : '确认创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
