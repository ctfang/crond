import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { JobLog } from '../types';
import { X, Calendar, Clock, Terminal } from 'lucide-react';
import { format } from 'date-fns';

interface LogsModalProps {
  projectId: string;
  jobId?: string;
  onClose: () => void;
}

const LogsModal: React.FC<LogsModalProps> = ({ projectId, jobId, onClose }) => {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    try {
      const data = jobId ? await api.getJobLogs(jobId, projectId) : await api.getLogs(projectId);
      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [jobId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 py-8 font-sans">
      <div className="bg-slate-50 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col border border-slate-700/20">
        <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Terminal className="w-5 h-5 text-indigo-500" />
            Execution Logs {jobId ? '' : '(Global)'}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto relative">
          {loading && (
             <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-100 overflow-hidden z-20">
               <div className="h-full bg-indigo-500 animate-progress w-1/3 rounded-full"></div>
             </div>
          )}
          <div className="p-6 space-y-4">
          {logs.length === 0 && !loading ? (
            <div className="text-center text-slate-500 py-10 font-medium">No logs found.</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded ${
                      log.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {log.status === 'success' ? 'Success' : 'Failed'}
                    </span>
                    <span className="font-semibold text-slate-700 text-sm">{log.jobName}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      {format(new Date(log.triggerTime), 'yyyy-MM-dd HH:mm:ss')}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {log.duration}ms
                    </div>
                  </div>
                </div>
                
                {/* Log Editor View Style */}
                <div className="flex-1 relative font-mono text-xs leading-6 flex overflow-hidden bg-slate-900 border-x border-b border-transparent rounded-b-xl">
                  {/* Line Numbers mock */}
                  <div className="w-10 border-r border-slate-700 text-right pr-2 pt-4 text-slate-500 select-none bg-slate-800 hidden sm:block">
                    {log.output.split('\n').map((_, i) => (
                        <div key={i}>{i+1}</div>
                    ))}
                  </div>
                  {/* Code Body */}
                  <div className="flex-1 p-4 overflow-auto">
                    <pre className="text-slate-300 whitespace-pre-wrap break-all">{log.output}</pre>
                  </div>
                </div>
              </div>
            ))
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogsModal;
