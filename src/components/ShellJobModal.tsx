import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import Editor from '@monaco-editor/react';
import { X, Play, Clock, CheckCircle2, Save, Trash2, Terminal as TerminalIcon, Terminal } from 'lucide-react';
import { format } from 'date-fns';
import { CronExpressionParser } from 'cron-parser';
import { Job } from '../types';

interface ShellJobModalProps {
  projectId: string;
  job: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function ShellJobModal({ projectId, job, onClose, onSaved }: ShellJobModalProps) {
  const [formData, setFormData] = useState<Partial<Job>>(
    job || { 
      name: '', 
      type: 'shell', 
      status: 'active', 
      cronExp: '* * * * *', 
      content: '#!/bin/bash\n\necho "Starting maintenance...";\n# Add your commands here',
    }
  );
  const [error, setError] = useState('');
  const [nextRun, setNextRun] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['[系统] Shell 仿真终端环境就绪。', '[系统] Bash 安全会话已建立。']);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    try {
      if (formData.cronExp) {
        const interval = CronExpressionParser.parse(formData.cronExp);
        setNextRun(format(interval.next().toDate(), 'yyyy-MM-dd HH:mm:ss'));
      }
    } catch (e) {
      setNextRun('表达式无效');
    }
  }, [formData.cronExp]);

  const handleRun = () => {
    setIsRunning(true);
    setTerminalOutput(prev => [...prev, `[Bash] ${new Date().toLocaleTimeString()} 正在安全运行脚本...`]);
    
    setTimeout(() => {
      setTerminalOutput(prev => [...prev, '[输出] 执行成功: 所有 Shell 批处理指令完成。', '[进程] 进程正常退出，退出返回码 (Code 0)']);
      setIsRunning(false);
    }, 1000);
  };

  const handleSubmit = async () => {
    try {
      if (job) {
        await api.updateJob(job.id.toString(), { ...formData, projectId, type: 'shell' });
      } else {
        await api.createJob(projectId, { ...formData, type: 'shell' });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1e1e1e] rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col border border-slate-700/30">
        
        {/* Header */}
        <div className="h-14 bg-[#252526] flex items-center justify-between px-6 shrink-0 border-b border-[#333]">
          <div className="flex items-center space-x-3">
            <Terminal className="w-5 h-5 text-amber-400" />
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-widest">
              Shell 脚本任务
            </h2>
          </div>
          <div className="flex items-center space-x-3">
             <button 
                onClick={handleRun}
                disabled={isRunning}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded flex items-center transition-all"
             >
                <Play className={`w-3.5 h-3.5 mr-2 ${isRunning ? 'animate-pulse' : ''}`} />
                {isRunning ? '正在执行...' : '试运行'}
             </button>
             <button 
                onClick={handleSubmit}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded flex items-center transition-all"
             >
                <Save className="w-3.5 h-3.5 mr-2" />
                保存
             </button>
             {job && (
               <button 
                  onClick={async () => {
                     if (confirm('确认删除此定时任务？')) {
                        try {
                           await api.deleteJob(job.id, projectId);
                           onSaved();
                        } catch (err: any) {
                           setError(err.message || '删除失败');
                        }
                     }
                  }}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded flex items-center transition-all"
                  title="删除此任务"
               >
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  删除
               </button>
             )}
             <button onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
             </button>
          </div>
        </div>

        {/* Config Bar */}
        <div className="bg-[#252526] p-4 flex flex-wrap gap-6 items-end border-b border-[#333]">
           <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">任务名称</label>
              <input 
                type="text"
                className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
                placeholder="例如: 自动归档志信息"
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
           </div>
           <div className="w-48">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">Cron 表达式</label>
              <input 
                type="text"
                className="w-full bg-[#1e1e1e] border border-[#3c3c3c] font-mono rounded px-3 py-2 text-sm text-emerald-400 outline-none focus:border-indigo-500"
                placeholder="* * * * *"
                value={formData.cronExp}
                onChange={e => setFormData(prev => ({ ...prev, cronExp: e.target.value }))}
              />
           </div>
           <div className="w-40 text-right text-slate-400 text-xs font-mono">
              下次预期执行时间: {nextRun}
           </div>
        </div>

        {/* Editor Main */}
        <div className="flex-1 min-h-0 relative">
           <Editor
              height="100%"
              language="shell"
              theme="vs-dark"
              value={formData.content}
              onChange={(val) => setFormData(prev => ({ ...prev, content: val || '' }))}
              options={{
                 minimap: { enabled: false },
                 fontSize: 14,
                 fontFamily: "'JetBrains Mono', monospace",
                 padding: { top: 20 },
                 wordWrap: 'on',
                 scrollBeyondLastLine: false,
                 automaticLayout: true,
                 tabSize: 2,
              }}
           />
        </div>

        {/* Terminal Area */}
        <div className="h-44 bg-[#0a0a0a] border-t border-[#333] flex flex-col shrink-0">
           <div className="h-7 bg-[#252526] px-4 flex items-center justify-between border-b border-[#333]">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center">
                 <TerminalIcon className="w-3 h-3 mr-2" />
                 BASH 模拟控制台
              </div>
              <button onClick={() => setTerminalOutput([])} className="hover:text-white text-slate-600">
                 <Trash2 className="w-3 h-3" />
              </button>
           </div>
           <div className="flex-1 p-3 font-mono text-[11px] overflow-y-auto">
              {terminalOutput.map((l, i) => (
                 <div key={i} className="mb-0.5 flex items-start">
                    <span className="text-emerald-900 mr-2 shrink-0 user-select-none">root@node:~$</span>
                    <span className="text-slate-200">{l}</span>
                 </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
}
