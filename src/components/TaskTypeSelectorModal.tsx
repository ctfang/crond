import React from 'react';
import { X, Code2, Terminal, Globe, ChevronRight } from 'lucide-react';
import { JobType } from '../types';

interface TaskTypeSelectorModalProps {
  onClose: () => void;
  onSelect: (type: JobType) => void;
}

const types: { id: JobType; title: string; desc: string; icon: any; color: string }[] = [
  { 
    id: 'php', 
    title: 'PHP 脚本', 
    desc: '使用完整的 PHP 语法编写复杂的周期性业务逻辑。', 
    icon: Code2, 
    color: 'text-indigo-500 bg-indigo-50' 
  },
  { 
    id: 'shell', 
    title: 'Shell 脚本', 
    desc: '执行系统指令、清理缓存或进行数据备份。', 
    icon: Terminal, 
    color: 'text-amber-500 bg-amber-50' 
  },
  { 
    id: 'http', 
    title: 'HTTP 请求', 
    desc: '对特定 URL 进行定时 GET 请求，触发 Webhook。', 
    icon: Globe, 
    color: 'text-blue-500 bg-blue-50' 
  },
];

export default function TaskTypeSelectorModal({ onClose, onSelect }: TaskTypeSelectorModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">选择任务类型</h2>
          <button 
            onClick={onClose} 
            className="p-1 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          {types.map((type) => (
            <button
              key={type.id}
              onClick={() => onSelect(type.id)}
              className="w-full flex items-center p-4 rounded-xl border border-slate-100 hover:border-indigo-500 hover:bg-indigo-50/30 transition-all group text-left"
            >
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center mr-4 shrink-0 transition-transform group-hover:scale-110 ${type.color}`}>
                <type.icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-slate-800 mb-0.5">{type.title}</div>
                <div className="text-xs text-slate-500 line-clamp-1">{type.desc}</div>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 transition-colors" />
            </button>
          ))}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
