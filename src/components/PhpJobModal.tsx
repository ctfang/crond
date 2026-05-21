import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import Editor, { useMonaco } from '@monaco-editor/react';
import { registerPhpCompletion } from '../lib/monaco-php';
import { X, Play, Clock, CheckCircle2, Save, Trash2, Terminal as TerminalIcon, Code2 } from 'lucide-react';
import { format } from 'date-fns';
import { CronExpressionParser } from 'cron-parser';
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
  const [nextRun, setNextRun] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['[System] PHP Environment initialized.', '[System] Ready for scripting.']);
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

  const monaco = useMonaco();

  useEffect(() => {
    if (monaco) {
      registerPhpCompletion(monaco);
    }
  }, [monaco]);

  const handleRun = () => {
    setIsRunning(true);
    setTerminalOutput(prev => [...prev, `[${format(new Date(), 'HH:mm:ss')}] Manual trigger starting...`]);
    
    setTimeout(() => {
      setTerminalOutput(prev => [
        ...prev, 
        `[${format(new Date(), 'HH:mm:ss')}] Loading Framework Bootstrap (Project Config)...`,
        `[System] PHP Environment initialized with framework.`,
        `[${format(new Date(), 'HH:mm:ss')}] PHP task finished (245ms).`, 
        '[STDOUT] PHP Crond task started...',
        '[STDOUT] Task executed successfully.'
      ]);
      setIsRunning(false);
    }, 1500);
  };

  const handleSubmit = async () => {
    try {
      if (job) {
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
              PHP 脚本任务 (PHP Script Task)
            </h2>
          </div>
          <div className="flex items-center space-x-3">
             <button 
                onClick={handleRun}
                disabled={isRunning}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded flex items-center transition-all"
             >
                <Play className={`w-3.5 h-3.5 mr-2 ${isRunning ? 'animate-pulse' : ''}`} />
                {isRunning ? '正在执行...' : '试运行 (Mock Run)'}
             </button>
             <button 
                onClick={handleSubmit}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded flex items-center transition-all"
             >
                <Save className="w-3.5 h-3.5 mr-2" />
                保存 (Save)
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
                  删除 (Delete)
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
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">任务名称 (Task Name)</label>
              <input 
                type="text"
                className="w-full bg-[#1e1e1e] border border-[#3c3c3c] rounded px-3 py-2 text-sm text-slate-200 outline-none focus:border-indigo-500"
                placeholder="例如: 每日报表分析"
                value={formData.name}
                onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
           </div>
           <div className="w-48">
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">Cron 表达式 (Cron Exp)</label>
              <input 
                type="text"
                className="w-full bg-[#1e1e1e] border border-[#3c3c3c] font-mono rounded px-3 py-2 text-sm text-emerald-400 outline-none focus:border-indigo-500"
                placeholder="* * * * *"
                value={formData.cronExp}
                onChange={e => setFormData(prev => ({ ...prev, cronExp: e.target.value }))}
              />
           </div>
           <div className="w-40 text-right">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">预计下次执行 (Next)</div>
              <div className="text-[11px] text-slate-400 font-mono truncate">{nextRun}</div>
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
                    模拟 PHP 输出 (Runtime Console)
                 </div>
                 <button onClick={() => setTerminalOutput(['[System] Logs cleared.'])} className="hover:text-white text-slate-500">
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
              <span className="flex items-center"><CheckCircle2 className="w-3 h-3 mr-1.5 text-emerald-400" /> PHP 8.3-ZTS Worker Node</span>
              <span>Memory: 256MB</span>
           </div>
           <div>Cloud Native Cron Service</div>
        </div>
      </div>
    </div>
  );
}
