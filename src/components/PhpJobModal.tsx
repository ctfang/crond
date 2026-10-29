import Select from './Select';
import { confirmAction } from './Feedback';
import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import Editor, { useMonaco } from '@monaco-editor/react';
import { registerPhpCompletion } from '../lib/monaco-php';
import { X, Play, Clock, CheckCircle2, Save, Trash2, Terminal as TerminalIcon, Code2 } from 'lucide-react';
import CronPreview from './CronPreview';
import { Job } from '../types';

interface PhpJobModalProps {
  projectId: string;
  job: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function PhpJobModal({ projectId, job, onClose, onSaved }: PhpJobModalProps) {
  const [formData, setFormData] = useState<Partial<Job>>(
    job || { 
      name: '', 
      type: 'php', 
      status: 'active', 
      cronExp: '* * * * *', 
      content: '<?php\n\nfunction main()\n{\n    echo "PHP Crond task started...\\n";\n    // Your logic here\n}\n\nmain();',
    }
  );
  const [error, setError] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['[系统] PHP 后台工作站就绪。', '[系统] 脚本编辑就绪。']);
  const [isRunning, setIsRunning] = useState(false);

  const monaco = useMonaco();

  useEffect(() => {
    if (monaco) {
      registerPhpCompletion(monaco);
    }
  }, [monaco]);

  const handleRun = async () => {
    setIsRunning(true);
    setTerminalOutput(prev => [...prev, '[系统] 正在执行后台脚本...']);
    try {
      const result = await api.executeJob(projectId, { ...formData, type: 'php' });
      setTerminalOutput(prev => [...prev, result.output || '(无输出)', `[系统] 执行${result.status === 'success' ? '成功' : '失败'}，用时 ${result.duration}ms`]);
    } catch (err: any) {
      setTerminalOutput(prev => [...prev, `[ERROR] ${err.message || '执行失败'}`]);
    } finally {
      setIsRunning(false);
    }
  };

  const handleSubmit = async () => {
    try {
      if (job?.id) {
        await api.updateJob(job.id.toString(), { ...formData, projectId, type: 'php' });
      } else {
        await api.createJob(projectId, { ...formData, type: 'php' });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1e1e1e] rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] overflow-hidden flex flex-col border border-slate-700/30">
        
        {/* Header */}
        <div className="h-14 bg-[#252526] flex items-center justify-between px-6 shrink-0 border-b border-[#333]">
          <div className="flex items-center space-x-3">
            <Code2 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-widest">
              PHP 脚本任务
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
             {job?.id && (
               <button 
                  onClick={async () => {
                     if (await confirmAction('确认删除此定时任务？')) {
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
                placeholder="例如: 每日报表分析"
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
           </div>
           <label className="text-xs text-slate-400">调度状态
             <Select dark aria-label="调度状态" value={formData.status || 'active'}
               onChange={e => setFormData(prev => ({ ...prev, status: e.target.value as Job['status'] }))}
               className="flex mt-2 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-slate-200">
               <option value="active">启用</option><option value="inactive">停用（仅手动运行）</option>
             </Select>
           </label>
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
           <div className="max-w-64 text-right">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">预计下次执行时间</div>
              <div className="text-[11px] text-slate-400 font-mono"><CronPreview expression={formData.cronExp} /></div>
           </div>
        </div>

        {/* Editor Main */}
        <div className="flex-1 flex flex-col min-h-0">
           <div className="flex-1 min-h-0 relative">
              <Editor
                 height="100%"
                 language="php"
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
                    lineNumbersMinChars: 4,
                    automaticLayout: true,
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    tabSize: 2,
                 }}
              />
           </div>

           {/* Terminal Output */}
           <div className="h-48 bg-[#0c0c0c] border-t border-[#333] flex flex-col shrink-0">
              <div className="h-8 bg-[#252526] px-4 flex items-center justify-between border-b border-[#333]">
                 <div className="text-[10px] font-bold text-white uppercase tracking-widest flex items-center">
                    <TerminalIcon className="w-3 h-3 mr-2 text-indigo-400" />
                    PHP 控制台输出
                 </div>
                 <button onClick={() => setTerminalOutput(['[系统] 控制台日志已清空。'])} className="hover:text-white text-slate-500">
                    <Trash2 className="w-3 h-3" />
                 </button>
              </div>
              <div className="flex-1 p-3 font-mono text-[11px] overflow-y-auto">
                 {terminalOutput.map((l, i) => (
                    <div key={i} className="mb-0.5 flex items-start">
                       <span className="text-slate-600 mr-2 shrink-0 select-none">php@worker:~$</span>
                       <span className={l.includes('Error') ? 'text-rose-400' : l.includes('Success') || l.includes('Output') ? 'text-indigo-400' : 'text-slate-300'}>
                          {l}
                       </span>
                    </div>
                 ))}
                 {isRunning && (
                    <div className="flex items-center">
                       <span className="text-slate-600 mr-2 select-none">php@worker:~$</span>
                       <div className="w-1.5 h-3 bg-indigo-500 animate-pulse ml-1"></div>
                    </div>
                 )}
              </div>
           </div>
        </div>

        {/* Footer */}
        <div className="h-6 bg-indigo-900 text-white flex items-center px-4 justify-between shrink-0 text-[10px] font-bold tracking-wider uppercase">
           <div className="flex items-center space-x-4">
              <span className="flex items-center"><CheckCircle2 className="w-3 h-3 mr-1.5 text-emerald-400" /> Origami 工作节点</span>
              <span>内存限额: 256MB</span>
           </div>
           <div>云原生 Crond 自动化调度平台</div>
        </div>
      </div>
    </div>
  );
}
