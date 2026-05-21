import React, { useState, useEffect } from 'react';
import { api } from './services/api';
import { Job, Project, JobType } from './types';
import PhpJobModal from './components/PhpJobModal';
import ShellJobModal from './components/ShellJobModal';
import HttpJobModal from './components/HttpJobModal';
import LogsModal from './components/LogsModal';
import ProjectModal from './components/ProjectModal';
import TaskTypeSelectorModal from './components/TaskTypeSelectorModal';
import ProjectMembersModal from './components/ProjectMembersModal';
import FrameworkConfigModal from './components/FrameworkConfigModal';
import StatelessServiceModal from './components/StatelessServiceModal';
import DataStoreModule from './components/DataStoreModule';
import { AuthModal } from './components/AuthModal';
import { Plus, Play, Edit, Trash2, Activity, FileText, Code2, Terminal, Globe, Folder, LogOut, User, Clock, Users, Box, ChevronLeft, ChevronRight, Database } from 'lucide-react';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  // Projects and Jobs State
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals state
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [showLogsJobId, setShowLogsJobId] = useState<string | undefined>(undefined);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'jobs' | 'stateless' | 'framework' | 'datastore'>('jobs');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const user = await api.getMe();
      setIsAuthenticated(true);
      setCurrentUser(user.username || user.email);
      fetchProjects();
    } catch {
      setIsAuthenticated(false);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await api.logout();
    setIsAuthenticated(false);
    setCurrentUser('');
    setProjects([]);
    setSelectedProjectId(null);
    setJobs([]);
  };

  const fetchProjects = async () => {
    try {
      let data = await api.getProjects();
      if (data.length === 0) {
        const proj = await api.createProject('默认系统', 'crond');
        data = [proj];
      }
      setProjects(data);
      if (data.length > 0) {
        setSelectedProjectId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to fetch projects', err);
    }
  };

  const createProject = async (name: string, type: 'crond') => {
     try {
        setErrorMsg('');
        const proj = await api.createProject(name, type);
        setProjects(prev => [proj, ...prev]);
        setSelectedProjectId(proj.id);
        setShowProjectModal(false);
     } catch (err: any) {
        throw new Error(err.message || '创建项目失败');
     }
  };
  
  const deleteProject = async (id: string, e: React.MouseEvent) => {
     e.stopPropagation();
     if (!confirm('确认删除此项目及其下所有任务？(Confirm deleting this project and its tasks?)')) return;
     try {
        setErrorMsg('');
        await api.deleteProject(id);
        const nextProjects = projects.filter(p => p.id !== id);
        setProjects(nextProjects);
        if (selectedProjectId === id) {
           setSelectedProjectId(nextProjects.length > 0 ? nextProjects[0].id : null);
        }
     } catch (err: any) {
        setErrorMsg('删除项目失败: ' + err.message);
     }
  };

  // Fetch jobs whenever selectedProjectId changes
  useEffect(() => {
    if (selectedProjectId) {
      fetchJobs(selectedProjectId);
      setActiveTab('jobs');
    } else {
      setJobs([]);
      setLoading(false);
    }
  }, [selectedProjectId]);

  const fetchJobs = async (projectId: string) => {
    setLoading(true);
    try {
      const data = await api.getJobs(projectId);
      setJobs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Periodic refresh of jobs if a project is selected
  useEffect(() => {
    if (!selectedProjectId) return;
    const interval = setInterval(() => {
       fetchJobs(selectedProjectId);
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedProjectId]);

  const handleDelete = async (id: string) => {
    if (!selectedProjectId) return;
    if (confirm('确认删除此任务？')) {
      await api.deleteJob(id, selectedProjectId);
      fetchJobs(selectedProjectId);
    }
  };

  const handleRun = async (id: string) => {
    if (!selectedProjectId) return;
    try {
        await api.runJob(id, selectedProjectId);
        alert('执行指令已发送');
    } catch (e: any) {
        alert(e.message || '执行失败');
    }
  };

  const handleOpenJobModal = (job: Job | null = null) => {
    if (!selectedProjectId) {
       alert("请先选择或创建一个项目 (Please select or create a project first)");
       return;
    }
    
    if (job) {
       // Edit mode
       setEditingJob(job);
       setShowJobModal(true);
    } else {
       // Creation mode: show type selector first
       setShowTypeSelector(true);
    }
  };

  const handleTypeSelected = (type: JobType) => {
    setShowTypeSelector(false);
    // Create a skeleton job with the selected type
    const skeleton: Partial<Job> = {
      type,
      name: '',
      status: 'active',
      cronExp: '* * * * *',
      content: type === 'php' ? '<?php\n\nfunction main()\n{\n    echo "PHP Crond task started...\\n";\n    // Your logic here\n}\n\nmain();' : 
               type === 'shell' ? '#!/bin/bash\n\necho "Shell task running..."' : 
               'https://',
    };
    setEditingJob(skeleton as Job);
    setShowJobModal(true);
  };

  if (authLoading) return <div className="h-screen flex items-center justify-center bg-slate-100">Loading...</div>;

  if (!isAuthenticated) {
    return <AuthModal onLogin={(username) => { setIsAuthenticated(true); setCurrentUser(username); fetchProjects(); }} />
  }

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* Left Sidebar Navigation */}
      <aside className={`bg-slate-900 flex flex-col shrink-0 hidden md:flex transition-all duration-300 ease-in-out ${isSidebarCollapsed ? 'w-20' : 'w-64'}`}>
        {!isSidebarCollapsed ? (
          <div className="p-6 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-3 truncate">
              <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-white animate-pulse" />
              </div>
              <span className="text-white font-bold text-lg tracking-tight truncate">Crond PHP System</span>
            </div>
            <button 
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors ml-2 shrink-0"
              title="收起侧边栏"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center space-y-4 shrink-0">
            <div className="w-8 h-8 bg-indigo-500 rounded flex items-center justify-center shrink-0 cursor-pointer" title="Crond PHP System" onClick={() => setIsSidebarCollapsed(false)}>
              <Clock className="w-5 h-5 text-white" />
            </div>
            <button 
              onClick={() => setIsSidebarCollapsed(false)}
              className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded transition-colors"
              title="展开侧边栏"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        
        {/* Navigation Items - 平级设计 */}
        <div className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
          {!isSidebarCollapsed && (
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-3">
              管理模块 (MODULES)
            </div>
          )}
          
          {/* 定时器 (Crond Jobs) */}
          <button
            onClick={() => setActiveTab('jobs')}
            className={`w-full flex items-center rounded-xl transition-all text-left ${
              !isSidebarCollapsed ? 'space-x-3 px-4 py-3' : 'justify-center p-3'
            } ${
              activeTab === 'jobs'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title="定时器"
          >
            <Clock className={`w-5 h-5 shrink-0 ${activeTab === 'jobs' ? 'text-white' : 'text-slate-500'}`} />
            {!isSidebarCollapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold tracking-wide">定时器</span>
                <span className={`text-[9.5px] font-semibold mt-0.5 ${activeTab === 'jobs' ? 'text-indigo-200' : 'text-slate-600'}`}>
                  系统定时任务 & crond
                </span>
              </div>
            )}
          </button>

          {/* 无状态服务 */}
          <button
            onClick={() => setActiveTab('stateless')}
            className={`w-full flex items-center rounded-xl transition-all text-left ${
              !isSidebarCollapsed ? 'space-x-3 px-4 py-3' : 'justify-center p-3'
            } ${
              activeTab === 'stateless'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title="无状态服务"
          >
            <Activity className={`w-5 h-5 shrink-0 ${activeTab === 'stateless' ? 'text-white' : 'text-slate-500'}`} />
            {!isSidebarCollapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold tracking-wide">无状态服务</span>
                <span className={`text-[9.5px] font-semibold mt-0.5 ${activeTab === 'stateless' ? 'text-indigo-200' : 'text-slate-600'}`}>
                  API 接口即时维护
                </span>
              </div>
            )}
          </button>

          {/* 框架配置 */}
          <button
            onClick={() => setActiveTab('framework')}
            className={`w-full flex items-center rounded-xl transition-all text-left ${
              !isSidebarCollapsed ? 'space-x-3 px-4 py-3' : 'justify-center p-3'
            } ${
              activeTab === 'framework'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title="框架配置"
          >
            <Box className={`w-5 h-5 shrink-0 ${activeTab === 'framework' ? 'text-white' : 'text-slate-500'}`} />
            {!isSidebarCollapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold tracking-wide">框架配置</span>
                <span className={`text-[9.5px] font-semibold mt-0.5 ${activeTab === 'framework' ? 'text-indigo-200' : 'text-slate-600'}`}>
                  运行环境 & 入口维护
                </span>
              </div>
            )}
          </button>

          {/* 数据存储 */}
          <button
            onClick={() => setActiveTab('datastore')}
            className={`w-full flex items-center rounded-xl transition-all text-left ${
              !isSidebarCollapsed ? 'space-x-3 px-4 py-3' : 'justify-center p-3'
            } ${
              activeTab === 'datastore'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title="数据存储"
          >
            <Database className={`w-5 h-5 shrink-0 ${activeTab === 'datastore' ? 'text-white' : 'text-slate-500'}`} />
            {!isSidebarCollapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold tracking-wide">数据存储</span>
                <span className={`text-[9.5px] font-semibold mt-0.5 ${activeTab === 'datastore' ? 'text-indigo-200' : 'text-slate-600'}`}>
                  定时任务与微服务中继站
                </span>
              </div>
            )}
          </button>
        </div>

        {/* User Footer with collapsed state support */}
        {!isSidebarCollapsed ? (
          <div className="p-4 bg-slate-950/50 flex items-center space-x-3 border-t border-slate-800 shrink-0">
            <div className="w-9 h-9 bg-slate-800 rounded-xl border border-slate-700 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">已认证</span>
                <span className="text-slate-300 text-sm font-bold truncate leading-tight" title={currentUser}>{currentUser}</span>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-rose-400 bg-slate-900/50 rounded-lg transition-colors border border-slate-800 shrink-0" title="退出登录">
               <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="p-4 bg-slate-950/50 flex flex-col items-center space-y-3 border-t border-slate-800 w-full shrink-0">
            <div className="w-9 h-9 bg-slate-800 rounded-xl border border-slate-700 flex items-center justify-center" title={`用户: ${currentUser}`}>
              <User className="w-5 h-5 text-indigo-400" />
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-rose-400 bg-slate-900/50 rounded-lg transition-colors border border-slate-800 shrink-0" title="退出登录">
               <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Main Content Container */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {errorMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-rose-100 border border-rose-400 text-rose-700 px-4 py-3 rounded shadow-lg flex items-center justify-between min-w-[300px]">
            <span className="font-medium text-sm">{errorMsg}</span>
            <button onClick={() => setErrorMsg('')} className="text-rose-700 hover:text-rose-900 ml-4 font-bold">×</button>
          </div>
        )}
        {activeTab === 'stateless' ? (
          <StatelessServiceModal
            projectId={selectedProjectId || 'default'}
          />
        ) : activeTab === 'framework' ? (
          <FrameworkConfigModal
            project={projects.find(p => p.id === selectedProjectId) || {
              id: selectedProjectId || 'default',
              name: '默认系统',
              type: 'crond',
              ownerId: '',
              createdAt: Date.now()
            }}
            onUpdated={(updatedProj) => {
              setProjects(prev => prev.map(p => p.id === updatedProj.id ? updatedProj : p));
            }}
          />
        ) : activeTab === 'datastore' ? (
          <DataStoreModule
            projectId={selectedProjectId || 'default'}
          />
        ) : (
          <>
            {/* Top Header */}
            <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-4">
                <h2 className="text-lg font-bold text-slate-800 flex items-center">
                   定时器管理 (Crond Tasks)
                </h2>
                <span className="px-2 py-0.5 bg-indigo-50/65 text-indigo-600 rounded text-xs border border-indigo-100 font-semibold">
                  {jobs.filter(j => j.status === 'active').length} 个激活任务 (Active)
                </span>
              </div>
              <div className="flex space-x-3">
                  <div className="flex space-x-2">
                     <button
                      onClick={() => setShowMembersModal(true)}
                      className="px-4 py-2 bg-white text-slate-700 border border-slate-200 text-sm font-bold rounded hover:bg-slate-50 transition-all flex items-center"
                    >
                      <Users className="w-4 h-4 mr-2 text-slate-500" />
                      成员管理
                    </button>
                  </div>
                  <button
                    onClick={() => handleOpenJobModal()}
                    disabled={!selectedProjectId}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    新增定时任务
                  </button>
              </div>
            </header>

            {/* Content Area */}
            <div className="flex-1 flex overflow-hidden">
              <div className="bg-white flex-1 flex flex-col overflow-hidden">
                {!selectedProjectId ? (
                   <div className="p-12 pl-6 text-center text-slate-500 flex flex-col items-center justify-center h-full">
                      <Clock className="w-12 h-12 text-slate-300 mb-4 animate-spin" />
                      <p className="font-medium text-lg text-slate-600">正在初始化系统，请稍候...</p>
                   </div>
                ) : (
                  <div className="flex-1 overflow-auto relative">
                    {loading && (
                       <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-100 overflow-hidden z-20">
                         <div className="h-full bg-indigo-500 animate-progress w-1/3 rounded-full"></div>
                       </div>
                    )}
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-400 font-bold uppercase tracking-wider sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-4">任务名称 (Task)</th>
                          <th className="px-6 py-4">类型 (Type)</th>
                          <th className="px-6 py-4">执行周期 (Cron)</th>
                          <th className="px-6 py-4">状态 (Status)</th>
                          <th className="px-6 py-4 text-right">操作 (Actions)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {jobs.map((job) => (
                          <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-semibold text-slate-700">{job.name}</td>
                            <td className="px-6 py-4">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${
                                job.type === 'http' ? 'bg-blue-100 text-blue-700' :
                                job.type === 'shell' ? 'bg-amber-100 text-amber-700' :
                                'bg-indigo-100 text-indigo-700'
                              }`}>
                                {job.type}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-mono text-slate-500 text-xs">
                              {job.cronExp ? job.cronExp : <span className="text-[10px] text-slate-400 font-sans tracking-wide">HTTP Endpoint / Manual</span>}
                            </td>
                            <td className="px-6 py-4">
                              {job.status === 'active' ? (
                                <div className="flex items-center text-[10px] text-emerald-600 font-bold uppercase tracking-widest">
                                  <div className="w-2 h-2 rounded-full bg-emerald-500 mr-2"></div> Active
                                </div>
                              ) : (
                                <div className="flex items-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                                  <div className="w-2 h-2 rounded-full bg-slate-300 mr-2"></div> Inactive
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right space-x-2">
                              <button onClick={() => handleRun(job.id)} className="text-emerald-500 hover:text-emerald-700 transition-colors p-1" title="运行">
                                <Play className="w-4 h-4" />
                              </button>
                              <button onClick={() => { setShowLogsJobId(job.id); setShowLogsModal(true); }} className="text-slate-400 hover:text-indigo-500 transition-colors p-1" title="日志">
                                <FileText className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleOpenJobModal(job)} className="text-slate-400 hover:text-indigo-500 transition-colors p-1" title="编辑">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button onClick={() => handleDelete(job.id)} className="text-slate-400 hover:text-rose-500 transition-colors p-1" title="删除">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {jobs.length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-6 py-8 text-center text-slate-500 font-medium">
                              暂无定时任务。请点击右上角【新增定时任务】进行创建
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Modals */}
      {showJobModal && selectedProjectId && editingJob?.type === 'php' && (
        <PhpJobModal
          projectId={selectedProjectId}
          job={editingJob}
          onClose={() => setShowJobModal(false)}
          onSaved={() => {
            setShowJobModal(false);
            fetchJobs(selectedProjectId);
          }}
        />
      )}

      {showJobModal && selectedProjectId && editingJob?.type === 'shell' && (
        <ShellJobModal
          projectId={selectedProjectId}
          job={editingJob}
          onClose={() => setShowJobModal(false)}
          onSaved={() => {
            setShowJobModal(false);
            fetchJobs(selectedProjectId);
          }}
        />
      )}

      {showJobModal && selectedProjectId && editingJob?.type === 'http' && (
        <HttpJobModal
          projectId={selectedProjectId}
          job={editingJob}
          onClose={() => setShowJobModal(false)}
          onSaved={() => {
            setShowJobModal(false);
            fetchJobs(selectedProjectId);
          }}
        />
      )}

      {showTypeSelector && (
        <TaskTypeSelectorModal
          onClose={() => setShowTypeSelector(false)}
          onSelect={handleTypeSelected}
        />
      )}

      {showProjectModal && (
        <ProjectModal 
          onClose={() => setShowProjectModal(false)}
          onCreated={createProject}
        />
      )}

      {showLogsModal && selectedProjectId && (
        <LogsModal
          projectId={selectedProjectId}
          jobId={showLogsJobId}
          onClose={() => setShowLogsModal(false)}
        />
      )}

      {showMembersModal && selectedProjectId && (
        <ProjectMembersModal
          project={projects.find(p => p.id === selectedProjectId)!}
          onClose={() => setShowMembersModal(false)}
        />
      )}
    </div>
  );
}
