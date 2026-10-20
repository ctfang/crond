import React, { useState, useEffect, useRef } from 'react';
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
  const selectedProjectRef = useRef(selectedProjectId);
  selectedProjectRef.current = selectedProjectId;
  const [loading, setLoading] = useState(true);

  // Modals state
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [showJobModal, setShowJobModal] = useState(false);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
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
        setShowProjectModal(true);
      }
      setProjects(data);
      if (data.length > 0) {
        setSelectedProjectId(data[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '项目加载失败');
    }
  };

  const createProject = async (name: string, type: 'crond', slug: string) => {
     try {
        setErrorMsg('');
        const proj = await api.createProject(name, type, slug);
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
      if (selectedProjectRef.current === projectId) setJobs(data);
    } catch (err) {
      console.error(err);
    } finally {
      if (selectedProjectRef.current === projectId) setLoading(false);
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
      try {
        await api.deleteJob(id, selectedProjectId);
        fetchJobs(selectedProjectId);
      } catch (err: any) { setErrorMsg(err.message || '删除任务失败'); }
    }
  };

  const handleRun = async (id: string) => {
    if (!selectedProjectId) return;
    try {
        const result = await api.runJob(id, selectedProjectId);
        alert(result.status === 'success' ? '执行成功，可查看任务日志' : '执行失败：' + result.output);
    } catch (e: any) {
        alert(e.message || '执行失败');
    }
  };

  const handleToggle = async (job: Job) => {
    try {
      const updated = await api.updateJob(job.id, { projectId: job.projectId,
        status: job.status === 'active' ? 'inactive' : 'active' });
      setJobs(prev => prev.map(item => item.id === updated.id ? updated : item));
    } catch (err: any) { setErrorMsg(err.message || '更新状态失败'); }
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
    const project = projects.find(p => p.id === selectedProjectId);
    const useStarter = Boolean(project?.framework);
    // Create a skeleton job with the selected type
    const skeleton: Partial<Job> = {
      type,
      name: '',
      status: 'active',
      cronExp: '* * * * *',
      content: type === 'php' && useStarter ? '<?php\n\nuse Framework\\Task;\nuse Framework\\Logger;\nuse Framework\\Config;\nuse Framework\\Database;\n\nTask::run("my_task", function () {\n    Logger::info("Hello from task", ["app" => Config::get("app.name")]);\n    // 在此编写任务逻辑；需要持久化数据时使用 Database::collection()\n});' : type === 'php' ? '<?php\n\nfunction main()\n{\n    echo "PHP Crond task started...\\n";\n    // Your logic here\n}\n\nmain();' :
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

          {/* 框架文档 */}
          <button
            onClick={() => setActiveTab('framework')}
            className={`w-full flex items-center rounded-xl transition-all text-left ${
              !isSidebarCollapsed ? 'space-x-3 px-4 py-3' : 'justify-center p-3'
            } ${
              activeTab === 'framework'
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
            title="框架文档"
          >
            <Box className={`w-5 h-5 shrink-0 ${activeTab === 'framework' ? 'text-white' : 'text-slate-500'}`} />
            {!isSidebarCollapsed && (
              <div className="flex flex-col truncate">
                <span className="text-sm font-bold tracking-wide">框架文档</span>
                <span className={`text-[9.5px] font-semibold mt-0.5 ${activeTab === 'framework' ? 'text-indigo-200' : 'text-slate-600'}`}>
                  全局默认框架 · 只读文档
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
        <div className="h-14 px-4 bg-white border-b border-slate-200 flex items-center gap-2 shrink-0 overflow-x-auto scrollbar-hide">
          <label className="shrink-0 text-xs text-slate-500 flex items-center gap-2">当前项目
            <select aria-label="当前项目" value={selectedProjectId || ''}
              onChange={e => { setSelectedProjectId(e.target.value || null); setShowLogsModal(false); setShowMembersModal(false); setShowJobModal(false); }}
              className="h-8 border border-slate-200 rounded-md px-2 min-w-32 max-w-44 bg-white text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20">
              {!projects.length && <option value="">暂无项目</option>}
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <button onClick={() => setShowProjectModal(true)} title="新建项目" aria-label="新建项目" className="h-8 px-2.5 shrink-0 inline-flex items-center gap-1.5 text-xs text-indigo-600 rounded-md hover:bg-indigo-50"><Plus className="w-3.5 h-3.5" />新建</button>
          <button disabled={!selectedProjectId} onClick={() => setEditingProject(projects.find(p => p.id === selectedProjectId) || null)} title="编辑项目" aria-label="编辑项目" className="h-8 px-2.5 shrink-0 inline-flex items-center gap-1.5 text-xs text-slate-600 rounded-md hover:bg-slate-100 disabled:opacity-50"><Edit className="w-3.5 h-3.5" />编辑</button>
          <button disabled={!selectedProjectId} onClick={() => { setShowLogsJobId(undefined); setShowLogsModal(true); }} title="项目日志" aria-label="项目日志" className="h-8 px-2.5 shrink-0 inline-flex items-center gap-1.5 text-xs text-slate-600 rounded-md hover:bg-slate-100 disabled:opacity-50"><FileText className="w-3.5 h-3.5" />日志</button>
          <button disabled={!selectedProjectId} onClick={e => selectedProjectId && deleteProject(selectedProjectId, e)} title="删除项目" aria-label="删除项目" className="h-8 px-2.5 shrink-0 inline-flex items-center gap-1.5 text-xs text-rose-500 rounded-md hover:bg-rose-50 disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" />删除</button>
        </div>
        {errorMsg && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-rose-100 border border-rose-400 text-rose-700 px-4 py-3 rounded shadow-lg flex items-center justify-between min-w-[300px]">
            <span className="font-medium text-sm">{errorMsg}</span>
            <button onClick={() => setErrorMsg('')} className="text-rose-700 hover:text-rose-900 ml-4 font-bold">×</button>
          </div>
        )}
        {!selectedProjectId && activeTab !== 'jobs' ? (
          <div className="flex-1 flex items-center justify-center text-slate-500">请先创建或选择项目</div>
        ) : activeTab === 'stateless' ? (
          <StatelessServiceModal
            project={projects.find(p => p.id === selectedProjectId)}
            key={selectedProjectId}
            projectId={selectedProjectId || 'default'}
            onEditProject={() => setEditingProject(projects.find(p => p.id === selectedProjectId) || null)}
          />
        ) : activeTab === 'framework' ? (
          <FrameworkConfigModal />
        ) : activeTab === 'datastore' ? (
          <DataStoreModule
            key={selectedProjectId}
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
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-label={`启用调度：${job.name}`}
                                  aria-checked={job.status === 'active'}
                                  onClick={() => handleToggle(job)}
                                  title={job.status === 'active' ? '停用调度' : '启用调度'}
                                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${job.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`}
                                >
                                  <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${job.status === 'active' ? 'translate-x-4' : 'translate-x-1'}`} />
                                </button>
                                <span className={`inline-block w-20 shrink-0 text-[10px] font-bold uppercase tracking-widest ${job.status === 'active' ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {job.status === 'active' ? 'Active' : 'Inactive'}
                                </span>
                              </div>
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
          onSave={(name, slug) => createProject(name, 'crond', slug)}
        />
      )}

      {editingProject && (
        <ProjectModal key={editingProject.id} project={editingProject}
          onClose={() => setEditingProject(null)}
          onSave={async (name, slug) => {
            const updated = await api.updateProject(editingProject.id, { name, slug });
            setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
            setEditingProject(null);
          }}
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
