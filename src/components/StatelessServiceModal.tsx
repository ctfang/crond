import React, { useState, useEffect } from 'react';
import { X, Plus, Terminal, Globe, Trash2, Edit, Play, Code2, Save, Activity, Layout } from 'lucide-react';
import { api } from '../services/api';
import { Project, StatelessService } from '../types';
import Editor from '@monaco-editor/react';

interface Props {
  projectId: string;
  onClose?: () => void;
}

export default function StatelessServiceModal({ projectId, onClose }: Props) {
  const [services, setServices] = useState<StatelessService[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingService, setEditingService] = useState<Partial<StatelessService> | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchServices();
  }, [projectId]);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const data = await api.getStatelessServices(projectId);
      setServices(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (service: StatelessService | null = null) => {
    if (service) {
      setEditingService(service);
    } else {
      setEditingService({
        name: '',
        route: '/api/',
        content: '<?php\n\n/**\n * Stateless Service Endpoint\n * Each request binds to this function execution\n */\nfunction handle(Request $request)\n{\n    return [\n        "status" => "success",\n        "message" => "Hello from stateless PHP service",\n        "timestamp" => time()\n    ];\n}\n',
        status: 'active'
      });
    }
  };

  const handleSave = async () => {
    if (!editingService?.name || !editingService?.route || !editingService?.content) {
      alert('请填写完整信息');
      return;
    }

    setIsSaving(true);
    try {
      await api.upsertStatelessService(projectId, editingService);
      setEditingService(null);
      fetchServices();
    } catch (err) {
      alert('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除此无状态服务？')) return;
    try {
      await api.deleteStatelessService(projectId, id);
      fetchServices();
    } catch (err) {
      alert('删除失败');
    }
  };

  return (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200/50">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">无状态服务 (Stateless Services)</h3>
            <p className="text-xs text-slate-500 font-medium tracking-wide">Manage serverless PHP endpoints for your project</p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
          {/* Sidebar / List */}
          <div className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/50">
            <div className="p-4 border-b border-slate-100">
              <button 
                onClick={() => handleEdit()}
                className="w-full flex items-center justify-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>新建服务</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading ? (
                <div className="text-center py-8 text-slate-400 text-sm">加载中...</div>
              ) : services.length === 0 ? (
                <div className="text-center py-12 px-6">
                   <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Layout className="w-6 h-6 text-slate-300" />
                   </div>
                   <p className="text-xs text-slate-400 font-medium">暂无无状态服务</p>
                </div>
              ) : (
                services.map(s => (
                  <div 
                    key={s.id}
                    onClick={() => handleEdit(s)}
                    className={`p-3 rounded-xl cursor-pointer border transition-all relative group ${
                      editingService?.id === s.id 
                        ? 'bg-white border-indigo-200 shadow-md ring-1 ring-indigo-50 border-l-4 border-l-indigo-600' 
                        : 'bg-white/50 border-slate-100 hover:border-slate-200 hover:bg-white text-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h4 className={`text-sm font-bold truncate ${editingService?.id === s.id ? 'text-indigo-600' : 'text-slate-800'}`}>{s.name}</h4>
                      <div className="flex items-center space-x-1 shrink-0">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter ${s.status === 'active' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                          {s.status}
                        </span>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(s.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded hover:bg-rose-50 transition-all shrink-0"
                          title="删除无状态服务"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1.5">
                       <Globe className="w-3 h-3 text-slate-400" />
                       <span className="text-[10px] font-mono text-slate-500 truncate">{s.route}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex-1 flex flex-col bg-white">
            {editingService ? (
              <>
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">服务名称 (Service Name)</label>
                      <input 
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="例如: 获取用户信息"
                        value={editingService.name}
                        onChange={e => setEditingService({...editingService, name: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">访问路径 (Route)</label>
                      <input 
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="/api/user/info"
                        value={editingService.route}
                        onChange={e => setEditingService({...editingService, route: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 ml-6 self-end">
                    <button 
                      onClick={() => setEditingService(null)}
                      className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm font-bold"
                    >
                      取消
                    </button>
                    {editingService.id && (
                      <button 
                        onClick={() => handleDelete(editingService.id!)}
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-100"
                        title="删除服务"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button 
                      onClick={handleSave}
                      disabled={isSaving}
                      className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-100 transition-all flex items-center disabled:opacity-50"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {isSaving ? '保存中...' : '保存服务'}
                    </button>
                  </div>
                </div>
                <div className="flex-1 relative">
                  <div className="absolute inset-0">
                    <Editor
                      height="100%"
                      defaultLanguage="php"
                      theme="vs-dark"
                      value={editingService.content}
                      onChange={val => setEditingService({...editingService, content: val || ''})}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 13,
                        lineHeight: 20,
                        padding: { top: 16 },
                        scrollBeyondLastLine: false,
                        automaticLayout: true,
                        fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace'
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 text-center">
                <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-6 border border-slate-100">
                  <Activity className="w-10 h-10 text-slate-200" />
                </div>
                <h4 className="text-xl font-bold text-slate-700 mb-2">选择一个无状态服务开始编辑</h4>
                <p className="max-w-md text-sm leading-relaxed">
                   无状态服务允许您定义一个 Web 接口，每次 HTTP 请求都会独立触发 PHP 代码执行。它非常适合 API 接口、外部回调等场景。
                </p>
                <button 
                  onClick={() => handleEdit()}
                  className="mt-8 px-8 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  创建第一个服务
                </button>
              </div>
            )}
          </div>
        </div>
    </div>
  );
}
