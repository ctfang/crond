import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { X, Clock, CheckCircle2, Trash2, Globe, Terminal as TerminalIcon, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { CronExpressionParser } from 'cron-parser';
import { Job } from '../types';

interface HttpJobModalProps {
  projectId: string;
  job: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

interface HttpConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export function encodeHttpConfig(config: HttpConfig): string {
  return JSON.stringify(config);
}

export function decodeHttpConfig(content: string): HttpConfig {
  try {
    if (content && content.trim().startsWith('{')) {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        return {
          url: parsed.url || '',
          method: parsed.method || 'GET',
          headers: parsed.headers || {},
          body: parsed.body || '',
        };
      }
    }
  } catch (e) {
    // ignore
  }
  return {
    url: content || '',
    method: 'GET',
    headers: {},
    body: '',
  };
}

/**
 * 模拟发起真正的 HTTP/HTTPS 请求
 * 外部可直接对接真正的 Axios 或 Fetch API 替换此处的模拟实现
 */
export async function executeHttpSimulation(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string
): Promise<{ status: number; statusText: string; data: any; headers: Record<string, string> }> {
  // 模拟网络延迟
  await new Promise(resolve => setTimeout(resolve, 800));

  // 简单 URL 协议校验
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    throw new Error('无效的目标协议，请检查。URL 必须以 http:// 或 https:// 开头。');
  }

  // 准备响应数据
  let responseData: any = {
    message: "HTTP 定时任务模拟请求成功 (Simulated http trigger success)",
    timestamp: new Date().toISOString(),
    requestDetails: {
      method,
      url,
      headersCount: Object.keys(headers).length,
    }
  };

  if (body) {
    try {
      responseData.requestDetails.payload = JSON.parse(body);
    } catch {
      responseData.requestDetails.payload = body;
    }
  }

  let status = 200;
  let statusText = "OK";

  // 模拟一些状态报错，更贴合开发实际测试
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('error') || lowerUrl.includes('fail')) {
    status = 500;
    statusText = "Internal Server Error";
    responseData = { 
      error: "服务器内部异常 (Server Error)", 
      details: "Simulated host response status code 500 from endpoint." 
    };
  } else if (lowerUrl.includes('auth') && !headers['Authorization'] && !headers['authorization']) {
    status = 401;
    statusText = "Unauthorized";
    responseData = { 
      error: "未授权的访问 (Unauthorized)", 
      details: "请求头中缺少授权凭据 (Missing 'Authorization' in headers)" 
    };
  } else if (lowerUrl.includes('notfound') || lowerUrl.includes('404')) {
    status = 404;
    statusText = "Not Found";
    responseData = {
      error: "接口未找到 (Not Found)",
      details: "Simulated resource not found on remote worker host."
    };
  }

  return {
    status,
    statusText,
    data: responseData,
    headers: {
      "content-type": "application/json",
      "x-powered-by": "crond-http-runtime",
      "cache-control": "no-cache"
    }
  };
}

export default function HttpJobModal({ projectId, job, onClose, onSaved }: HttpJobModalProps) {
  const [formData, setFormData] = useState<Partial<Job>>(
    job || { 
      name: '', 
      type: 'http', 
      status: 'active', 
      cronExp: '* * * * *', 
      content: 'https://api.example.com/webhook',
    }
  );

  const initialConfig = decodeHttpConfig(job?.content || 'https://api.example.com/webhook');
  const [url, setUrl] = useState(initialConfig.url);
  const [method, setMethod] = useState(initialConfig.method);
  const [requestBody, setRequestBody] = useState(initialConfig.body);
  const [headerRows, setHeaderRows] = useState<{ key: string; value: string }[]>(() => {
    const entries = Object.entries(initialConfig.headers);
    return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [{ key: '', value: '' }];
  });

  const [activeTab, setActiveTab] = useState<'url' | 'headers' | 'body'>('url');
  const [error, setError] = useState('');
  const [nextRun, setNextRun] = useState('');
  
  const [httpResponse, setHttpResponse] = useState<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    data: any;
    error?: string;
    timeMs: number;
  } | null>(null);
  
  const [respTab, setRespTab] = useState<'body' | 'headers'>('body');
  const [isRunning, setIsRunning] = useState(false);

  // Parse and display next cron run time
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

  // Synchronize fields inside the unified Json string
  useEffect(() => {
    const headersObj: Record<string, string> = {};
    headerRows.forEach(row => {
      if (row.key.trim()) {
        headersObj[row.key.trim()] = row.value;
      }
    });

    const encoded = encodeHttpConfig({
      url,
      method,
      headers: headersObj,
      body: requestBody
    });

    setFormData(prev => ({ ...prev, content: encoded }));
  }, [url, method, headerRows, requestBody]);

  const handleAddHeader = () => {
    setHeaderRows(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaderRows(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length > 0 ? updated : [{ key: '', value: '' }];
    });
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', val: string) => {
    setHeaderRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: val } : row));
  };

  const handleRun = async () => {
    setIsRunning(true);
    setHttpResponse(null);
    
    const headersObj: Record<string, string> = {};
    headerRows.forEach(row => {
      if (row.key.trim()) {
        headersObj[row.key.trim()] = row.value;
      }
    });

    const startTime = Date.now();
    try {
      const response = await executeHttpSimulation(url, method, headersObj, requestBody);
      const duration = Date.now() - startTime;
      setHttpResponse({
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data,
        timeMs: duration
      });
    } catch (e: any) {
      const duration = Date.now() - startTime;
      setHttpResponse({
        status: 500,
        statusText: 'Error',
        headers: { 'content-type': 'text/plain' },
        data: null,
        error: e.message || '网络请求异常失败 (Simulation Error/Invalid Protocol)',
        timeMs: duration
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleSubmit = async () => {
    try {
      setError('');
      if (!url.trim()) {
        throw new Error('目标 URL 不能为空');
      }
      if (job) {
        await api.updateJob(job.id.toString(), { ...formData, projectId, type: 'http' });
      } else {
        await api.createJob(projectId, { ...formData, type: 'http' });
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || '保存失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-[#1e1e1e] rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col border border-slate-700/30 animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="h-14 bg-[#252526] flex items-center justify-between px-6 shrink-0 border-b border-[#333]">
          <div className="flex items-center space-x-3">
            <Globe className="w-5 h-5 text-indigo-400 animate-pulse" />
            <h2 className="text-sm font-bold text-slate-200 uppercase tracking-widest font-sans">
              HTTP 请求任务 (HTTP Request Task)
            </h2>
          </div>
          <div className="flex items-center space-x-3 text-slate-400">
             <button onClick={onClose} className="p-2 hover:text-white transition-colors">
                <X className="w-5 h-5" />
             </button>
          </div>
        </div>

        {/* Scrollable Container */}
        <div className="p-8 space-y-6 overflow-y-auto max-h-[calc(100vh-200px)]">
           {error && (
             <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3.5 text-xs text-red-400">
               {error}
             </div>
           )}

           <div className="grid grid-cols-2 gap-6">
              <div>
                 <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">任务名称 (Task Name)</label>
                 <input 
                   type="text"
                   className="w-full bg-[#151515] border border-[#3c3c3c] rounded-lg px-4 py-2 text-slate-200 text-xs outline-none focus:border-indigo-500"
                   placeholder="例如: Webhook 触发器"
                   value={formData.name || ''}
                   onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                 />
              </div>
              <div>
                 <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">Cron 表达式 (Cron Exp)</label>
                 <input 
                   type="text"
                   className="w-full bg-[#151515] border border-[#3c3c3c] font-mono rounded-lg px-4 py-2 text-emerald-400 text-xs outline-none focus:border-indigo-500"
                   placeholder="* * * * *"
                   value={formData.cronExp || ''}
                   onChange={e => setFormData(prev => ({ ...prev, cronExp: e.target.value }))}
                 />
                 <div className="mt-1 text-[10px] text-slate-500 flex items-center">
                    <Clock className="w-3 h-3 mr-1" /> 下一次运行: {nextRun}
                 </div>
              </div>
           </div>

           {/* HTTP Tab Settings */}
           <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#252526]/40 p-4 space-y-4">
              {/* Tab selector */}
              <div className="flex border-b border-slate-800 pb-2">
                 <button 
                   type="button"
                   onClick={() => setActiveTab('url')}
                   className={`px-4 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all ${activeTab === 'url' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                 >
                   常规设置 (URL & Method)
                 </button>
                 <button 
                   type="button"
                   onClick={() => setActiveTab('headers')}
                   className={`px-4 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all ${activeTab === 'headers' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                 >
                   请求头标头 (Headers)
                 </button>
                 <button 
                   type="button"
                   onClick={() => setActiveTab('body')}
                   className={`px-4 py-1.5 text-xs font-semibold rounded-t-lg border-b-2 transition-all ${activeTab === 'body' ? 'border-indigo-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                 >
                   请求主体内容 (Body)
                 </button>
              </div>

              {activeTab === 'url' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="grid grid-cols-6 gap-4">
                     <div className="col-span-2">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">请求方式 (Method)</label>
                        <select 
                          className="w-full bg-[#151515] border border-[#3c3c3c] text-indigo-400 text-xs rounded-lg px-3 py-2 outline-none focus:border-indigo-500 font-mono"
                          value={method}
                          onChange={e => setMethod(e.target.value)}
                        >
                          <option value="GET">GET</option>
                          <option value="POST">POST</option>
                          <option value="PUT">PUT</option>
                          <option value="DELETE">DELETE</option>
                          <option value="PATCH">PATCH</option>
                        </select>
                     </div>
                     <div className="col-span-4">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest font-sans">目标 URL (Target URL)</label>
                        <input 
                          type="url"
                          className="w-full bg-[#151515] border border-[#3c3c3c] font-mono text-indigo-400 text-xs rounded-lg px-4 py-2 outline-none focus:border-indigo-500"
                          placeholder="https://api.yoursite.com/cron"
                          value={url}
                          onChange={e => setUrl(e.target.value)}
                        />
                     </div>
                  </div>
                  <p className="text-[10px] text-slate-500">
                    * 支持标准的万维网 HTTP / HTTPS 外部服务器，系统将按指定的 Method 方式及 Cron 频率调用此接口。
                  </p>
                </div>
              )}

              {activeTab === 'headers' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                   <div className="flex items-center justify-between">
                     <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">自定义标头 (Custom HTTP Headers)</span>
                     <button 
                       type="button"
                       onClick={handleAddHeader}
                       className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 font-bold rounded flex items-center gap-1 transition-all"
                     >
                       <Plus className="w-3 h-3" /> 添加标头 (Add Header)
                     </button>
                   </div>

                   <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                     {headerRows.map((row, index) => (
                       <div key={index} className="flex gap-2 items-center">
                         <input 
                           type="text"
                           placeholder="Header 名称 (e.g. Content-Type)"
                           className="flex-1 bg-[#151515] border border-[#3c3c3c] font-mono text-slate-300 text-xs rounded px-3 py-1.5 outline-none focus:border-indigo-500"
                           value={row.key}
                           onChange={e => handleHeaderChange(index, 'key', e.target.value)}
                         />
                         <input 
                           type="text"
                           placeholder="Header 的值 (e.g. application/json)"
                           className="flex-1 bg-[#151515] border border-[#3c3c3c] font-mono text-slate-300 text-xs rounded px-3 py-1.5 outline-none focus:border-indigo-500"
                           value={row.value}
                           onChange={e => handleHeaderChange(index, 'value', e.target.value)}
                         />
                         <button 
                           type="button"
                           onClick={() => handleRemoveHeader(index)}
                           className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                         >
                           <Trash2 className="w-3.5 h-3.5" />
                         </button>
                       </div>
                     ))}
                   </div>
                </div>
              )}

              {activeTab === 'body' && (
                <div className="space-y-4 animate-in fade-in duration-200">
                   <div>
                     <div className="flex items-center justify-between mb-2">
                       <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">请求内容结构体 (Body Payload)</label>
                       {(method === 'GET' || method === 'DELETE') && (
                         <span className="text-[10px] text-amber-500">
                           ⚠️ 警告: {method} 请求规范中不建议携带 Body
                         </span>
                       )}
                     </div>
                     <textarea 
                       rows={4}
                       className="w-full bg-[#151515] border border-[#3c3c3c] font-mono text-xs rounded-lg px-4 py-2.5 text-slate-300 outline-none focus:border-indigo-500 resize-none"
                       placeholder="请输入请求体内容 (例如: JSON、文本或键值串)"
                       value={requestBody}
                       onChange={e => setRequestBody(e.target.value)}
                     />
                   </div>
                </div>
              )}
           </div>

           {/* Response Panel for HTTP */}
           <div className="bg-[#151515] rounded-xl border border-slate-800 overflow-hidden flex flex-col">
              {/* Header Info */}
              <div className="px-5 py-3 bg-slate-800/30 flex items-center justify-between border-b border-slate-800">
                 <div className="flex items-center space-x-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest font-sans">响应内容 (Response Body)</span>
                    {isRunning && (
                      <span className="flex items-center space-x-1.5 text-[10px] text-indigo-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>
                        <span className="animate-pulse">正在发送请求 (Requesting)...</span>
                      </span>
                    )}
                 </div>
                 
                 {httpResponse && (
                    <div className="flex items-center space-x-4">
                       <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded ${
                          httpResponse.status >= 200 && httpResponse.status < 300 
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30' 
                            : 'bg-red-950/80 text-red-400 border border-red-500/30'
                       }`}>
                          Status: {httpResponse.status} {httpResponse.statusText}
                       </span>
                       <span className="text-[10px] text-slate-400 font-mono">
                          Time: {httpResponse.timeMs} ms
                       </span>
                    </div>
                 )}
              </div>

              {/* Tabs & Content */}
              {httpResponse ? (
                 <div className="flex flex-col bg-black/20">
                    {/* Tab selectors for Body vs Headers */}
                    <div className="flex border-b border-slate-800 bg-[#1e1e1e] px-4 font-sans text-xs">
                       <button 
                         type="button"
                         onClick={() => setRespTab('body')}
                         className={`px-3 py-2 text-xs font-semibold border-b-2 transition-all ${respTab === 'body' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                       >
                         返回值主体 (Response Body)
                       </button>
                       <button 
                         type="button"
                         onClick={() => setRespTab('headers')}
                         className={`px-3 py-2 text-xs font-semibold border-b-2 transition-all ${respTab === 'headers' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
                       >
                         返回值标头 (Response Headers)
                       </button>
                    </div>

                    <div className="p-4 min-h-[140px] max-h-[300px] overflow-y-auto font-mono text-[11px] bg-[#121212]">
                       {respTab === 'body' ? (
                          httpResponse.error ? (
                             <div className="text-red-400 whitespace-pre-wrap leading-relaxed py-1">
                                [Error] 请求执行失败:
                                <br />
                                {httpResponse.error}
                             </div>
                          ) : (
                             <pre className="text-emerald-400 whitespace-pre-wrap leading-relaxed">
                                {typeof httpResponse.data === 'string' 
                                  ? httpResponse.data 
                                  : JSON.stringify(httpResponse.data, null, 2)}
                             </pre>
                          )
                       ) : (
                          <div className="space-y-1.5 py-1">
                             {Object.entries(httpResponse.headers).map(([k, v]) => (
                                <div key={k} className="flex justify-between border-b border-slate-950 pb-1.5">
                                   <span className="text-indigo-300">{k}:</span>
                                   <span className="text-slate-400 select-all">{v}</span>
                                </div>
                             ))}
                          </div>
                       )}
                    </div>
                 </div>
              ) : (
                 <div className="flex flex-col items-center justify-center py-10 px-6 text-center text-slate-500 bg-black/10">
                    {isRunning ? (
                      <div className="flex flex-col items-center space-y-3">
                         <div className="w-6 h-6 rounded-full border-2 border-indigo-500/25 border-t-indigo-500 animate-spin"></div>
                         <div className="text-xs text-indigo-400 font-mono animate-pulse">正在传输网络载荷并等待响应数据...</div>
                      </div>
                    ) : (
                      <div className="space-y-1 select-none">
                         <p className="text-xs font-medium text-slate-400">目前暂无请求返回值</p>
                         <p className="text-[10px] text-slate-600 font-sans">点击下方右侧的 &ldquo;立即测试&rdquo; 按钮即可模拟发起标准的 HTTP/HTTPS 网络请求对指定接口进行联调联试</p>
                      </div>
                    )}
                 </div>
              )}
           </div>
        </div>

        {/* Action Bar */}
        <div className="px-8 py-4 bg-[#252526] border-t border-[#333] flex items-center justify-between">
           <div className="flex items-center text-[10px] uppercase font-bold text-emerald-500/80">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              已就绪 (Ready to Deploy)
           </div>
           <div className="flex space-x-3">
              <button 
                onClick={handleRun}
                disabled={isRunning}
                className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg transition-all"
              >
                 {isRunning ? '正在发起...' : '立即测试 (Test Now)'}
              </button>
              <button 
                type="button"
                onClick={handleSubmit}
                className="px-8 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-indigo-900/20 transition-all font-bold"
              >
                 保存任务 (Save Job)
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
                  className="px-6 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg transition-all"
                  title="删除任务"
                >
                   删除任务 (Delete)
                </button>
              )}
           </div>
        </div>
      </div>
    </div>
  );
}
