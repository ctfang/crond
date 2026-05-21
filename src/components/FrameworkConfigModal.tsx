import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Project, ProjectFile } from '../types';
import Editor from '@monaco-editor/react';
import { X, Save, Box, Info, File, Folder, Plus, Trash2, ChevronRight, ChevronDown, FileCode, FolderOpen, Edit3, Target, Check } from 'lucide-react';

interface Props {
  project: Project;
  onClose?: () => void;
  onUpdated: (updatedProject: Project) => void;
}

export default function FrameworkConfigModal({ project, onClose, onUpdated }: Props) {
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [localContent, setLocalContent] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root']));
  const [isSaving, setIsSaving] = useState(false);
  const [creatingItem, setCreatingItem] = useState<{ type: 'file' | 'folder', parentId: string } | null>(null);
  const [newItemName, setNewItemName] = useState('');

  // Custom states to avoid browser dialog limitations inside sandboxed iFrames
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<ProjectFile | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification(current => current?.message === message ? null : current);
    }, 3000);
  };

  // Initial load and subscription
  useEffect(() => {
    const unsubscribe = api.subscribeToFiles(project.id, (data) => {
      setFiles(data);
      if (data.length > 0 && !activeFileId) {
        const firstFile = data.find(f => f.type === 'file');
        if (firstFile) {
          setActiveFileId(firstFile.id);
          setLocalContent(firstFile.content || '');
        }
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveContent();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [project.id]);

  // Sync active file content when switching
  useEffect(() => {
    const active = files.find(f => f.id === activeFileId);
    if (active && !hasChanges) {
      setLocalContent(active.content || '');
    }
  }, [activeFileId, files]);

  const activeFile = files.find(f => f.id === activeFileId);

  const handleSelectFile = (id: string) => {
    if (hasChanges && !confirm('您有未保存的更改，确认切换？')) return;
    setActiveFileId(id);
    setHasChanges(false);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName || !creatingItem) return;

    try {
      const parent = files.find(f => f.id === creatingItem.parentId);
      const path = creatingItem.parentId === 'root' ? newItemName : `${parent?.path}/${newItemName}`;
      
      const newFile = await api.upsertProjectFile(project.id, {
        name: newItemName,
        type: creatingItem.type,
        parentId: creatingItem.parentId,
        path,
        content: creatingItem.type === 'file' ? '<?php\n\n' : undefined
      });

      if (creatingItem.type === 'file') {
        setActiveFileId(newFile.id);
        setLocalContent(newFile.content || '');
        setHasChanges(false);
      } else {
        const next = new Set(expandedFolders);
        next.add(creatingItem.parentId);
        setExpandedFolders(next);
      }
      
      setCreatingItem(null);
      setNewItemName('');
      showToast('success', '创建成功');
    } catch (err) {
      showToast('error', '创建失败');
    }
  };

  const handleRename = (file: ProjectFile) => {
    setRenamingFileId(file.id);
    setRenameInput(file.name);
  };

  const submitRename = async (file: ProjectFile) => {
    if (!renameInput || renameInput === file.name) {
      setRenamingFileId(null);
      return;
    }

    try {
      const parentPath = file.path.split('/').slice(0, -1).join('/');
      const newPath = parentPath ? `${parentPath}/${renameInput}` : renameInput;
      await api.upsertProjectFile(project.id, {
        ...file,
        name: renameInput,
        path: newPath
      });
      showToast('success', '重命名成功');
    } catch (err) {
      showToast('error', '重命名失败');
    } finally {
      setRenamingFileId(null);
    }
  };

  const handleSetEntryPoint = async (file: ProjectFile) => {
    if (file.type !== 'file') return;
    try {
      await api.updateProject(project.id, { entryFileId: file.id });
      onUpdated({ ...project, entryFileId: file.id });
      showToast('success', '设置入口成功');
    } catch (err) {
      showToast('error', '设置入口失败');
    }
  };

  const handleDelete = (file: ProjectFile) => {
    setShowDeleteConfirm(file);
  };

  const confirmDelete = async (file: ProjectFile) => {
    try {
      await api.deleteProjectFile(project.id, file.id);
      if (activeFileId === file.id) {
        setActiveFileId(null);
        setLocalContent('');
        setHasChanges(false);
      }
      showToast('success', '删除成功');
    } catch (err) {
      showToast('error', '删除失败');
    }
  };

  const handleSaveContent = async () => {
    if (!activeFileId || !hasChanges) return;
    setIsSaving(true);
    try {
      const activeItem = files.find(f => f.id === activeFileId);
      if (activeItem) {
        await api.upsertProjectFile(project.id, { ...activeItem, content: localContent });
        setHasChanges(false);
        showToast('success', '保存成功');
      }
    } catch (err) {
      showToast('error', '保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFolder = (id: string) => {
    const next = new Set(expandedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolders(next);
  };

  const renderTree = (parentId: string = 'root', level: number = 0) => {
    const children = files.filter(f => f.parentId === parentId).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <>
        {children.map(file => (
          <div key={file.id}>
            <div 
              className={`group flex items-center px-4 py-1.5 cursor-pointer text-sm transition-colors ${
                activeFileId === file.id ? 'bg-[#37373d] text-white' : 'text-slate-400 hover:bg-[#2a2d2e]'
              }`}
              style={{ paddingLeft: `${level * 16 + 12}px` }}
              onClick={() => {
                if (file.type === 'folder') toggleFolder(file.id);
                else handleSelectFile(file.id);
              }}
            >
              <div className="flex items-center flex-1 min-w-0">
                {file.type === 'folder' ? (
                  <>
                    {expandedFolders.has(file.id) ? (
                      <ChevronDown className="w-3.5 h-3.5 mr-1 shrink-0" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 mr-1 shrink-0" />
                    )}
                    <Folder className={`w-4 h-4 mr-2 shrink-0 ${expandedFolders.has(file.id) ? 'text-indigo-400' : 'text-slate-500'}`} />
                  </>
                ) : (
                  <FileCode className="w-4 h-4 mr-2 text-indigo-400 shrink-0 ml-4.5" />
                )}
                {renamingFileId === file.id ? (
                  <form 
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await submitRename(file);
                    }}
                    className="flex-1 min-w-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      autoFocus
                      value={renameInput}
                      onChange={(e) => setRenameInput(e.target.value)}
                      onBlur={() => setRenamingFileId(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setRenamingFileId(null)}
                      className="w-full bg-[#1e1e1e] border border-indigo-500 outline-none text-xs px-1.5 py-0.5 rounded text-white font-mono"
                    />
                  </form>
                ) : (
                  <span className="truncate">{file.name}</span>
                )}
              </div>
              <div className={`flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 ${activeFileId === file.id ? 'opacity-70 hover:opacity-100' : ''} transition-opacity shrink-0 ml-2`}>
                {file.type === 'file' && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSetEntryPoint(file); }}
                    className={`p-1 rounded transition-colors ${project.entryFileId === file.id ? 'text-green-400 bg-green-400/10' : 'text-slate-400 hover:text-indigo-400 hover:bg-[#3c3c3c]'}`}
                    title={project.entryFileId === file.id ? "框架入口" : "设为框架入口"}
                  >
                    <Target className="w-3.5 h-3.5" />
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleRename(file); }}
                  className="p-1 hover:bg-[#3c3c3c] rounded text-slate-400 hover:text-white"
                  title="重命名"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                {file.type === 'folder' && (
                  <>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setCreatingItem({ type: 'file', parentId: file.id }); }}
                      className="p-1 hover:bg-[#3c3c3c] rounded text-slate-400 hover:text-white"
                      title="新建文件"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setCreatingItem({ type: 'folder', parentId: file.id }); }}
                      className="p-1 hover:bg-[#3c3c3c] rounded text-slate-400 hover:text-white"
                      title="新建目录"
                    >
                      <Folder className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDelete(file); }}
                  className="p-1 hover:bg-[#3c3c3c] rounded text-slate-400 hover:text-rose-400"
                  title="删除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {file.type === 'folder' && expandedFolders.has(file.id) && renderTree(file.id, level + 1)}
          </div>
        ))}
        {creatingItem?.parentId === parentId && (
          <div className="px-4 py-1.5 flex items-center" style={{ paddingLeft: `${level * 16 + 12}px` }}>
            {creatingItem.type === 'folder' ? <Folder className="w-4 h-4 mr-2 text-slate-500" /> : <FileCode className="w-4 h-4 mr-2 text-indigo-400 ml-4.5" />}
            <form onSubmit={handleCreateSubmit} className="flex-1 min-w-0">
               <input
                 autoFocus
                 value={newItemName}
                 onChange={(e) => setNewItemName(e.target.value)}
                 onBlur={() => setCreatingItem(null)}
                 onKeyDown={(e) => e.key === 'Escape' && setCreatingItem(null)}
                 className="w-full bg-[#3c3c3c] border border-indigo-500 outline-none text-xs px-1 py-0.5 rounded text-white"
                 placeholder={`Enter name...`}
               />
            </form>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] flex flex-col overflow-hidden">
      
      {/* Header */}
      <div className="px-6 py-3 border-b border-[#333] flex items-center justify-between bg-[#252526] shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-indigo-500/10 rounded-lg flex items-center justify-center border border-indigo-500/20">
            <Box className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-widest leading-none">
              PHP 框架环境维护 (Framework Environment)
            </h3>
            <p className="text-[10px] text-slate-500 mt-1.5 uppercase font-bold tracking-tighter">Project Config: {project.name}</p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {activeFile && (
            <div className="flex items-center space-x-2 mr-4">
              {project.entryFileId === activeFile.id && (
                <div className="flex items-center text-[9px] bg-green-500/10 text-green-400 px-2 py-0.5 rounded border border-green-500/20 uppercase font-bold tracking-tighter">
                  <Check className="w-2.5 h-2.5 mr-1" />
                  Entry Point
                </div>
              )}
              {hasChanges && (
                <div className="w-2 h-2 rounded-full bg-indigo-400 mr-2 shadow-[0_0_8px_rgba(129,140,248,0.6)]" title="未保存更改" />
              )}
              <div className="flex items-center text-[10px] bg-slate-800 px-3 py-1 rounded border border-slate-700">
                <span className="text-slate-500 mr-2 uppercase tracking-widest">Editing:</span>
                <span className="text-indigo-300 font-mono">{activeFile.path}</span>
              </div>
            </div>
          )}
          <button
             onClick={() => handleSaveContent()}
             disabled={isSaving || !hasChanges}
             className="px-6 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded flex items-center transition-all disabled:opacity-50 shadow-lg shadow-indigo-900/20"
          >
             <Save className="w-3.5 h-3.5 mr-2" />
             {isSaving ? 'Saving...' : 'Save File'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
          {/* Sidebar - File Tree */}
          <div className="w-64 bg-[#252526] border-r border-[#333] flex flex-col">
            <div className="p-4 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Explorer</span>
              <div className="flex space-x-1">
                <button 
                  onClick={() => setCreatingItem({ type: 'file', parentId: 'root' })}
                  className="p-1.5 hover:bg-[#3c3c3c] rounded text-slate-400 hover:text-white transition-colors"
                  title="New File"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => setCreatingItem({ type: 'folder', parentId: 'root' })}
                  className="p-1.5 hover:bg-[#3c3c3c] rounded text-slate-400 hover:text-white transition-colors"
                  title="New Folder"
                >
                  <Folder className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pt-1 select-none">
              {renderTree()}
              {files.length === 0 && !creatingItem && (
                <div className="px-6 py-8 text-center">
                  <div className="w-12 h-12 bg-slate-800/50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <File className="w-6 h-6 text-slate-600" />
                  </div>
                  <p className="text-[10px] text-slate-600 uppercase font-bold tracking-widest">No Files Yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Main Area - Editor */}
          <div className="flex-1 flex flex-col bg-[#1e1e1e]">
            {activeFile ? (
              <div className="flex-1 min-h-0 relative">
                <Editor
                  height="100%"
                  language="php"
                  theme="vs-dark"
                  value={localContent}
                  onChange={(val) => {
                    setLocalContent(val || '');
                    setHasChanges(true);
                  }}
                  onMount={(editor) => {
                    editor.focus();
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    fontFamily: "'JetBrains Mono', monospace",
                    padding: { top: 20 },
                    wordWrap: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 4,
                  }}
                />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-600 flex-col">
                <FileCode className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm font-medium tracking-wide">Select a file from the explorer to edit</p>
                <div className="mt-6 flex space-x-4">
                  <div className="flex flex-col items-center">
                    <kbd className="px-2 py-1 bg-slate-800 text-slate-400 text-[10px] rounded border border-slate-700 mb-2">PHP 8.3</kbd>
                    <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Runtime</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <kbd className="px-2 py-1 bg-slate-800 text-slate-400 text-[10px] rounded border border-slate-700 mb-2">Composer</kbd>
                    <span className="text-[10px] uppercase font-bold tracking-widest opacity-40">Enabled</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-2 bg-[#007acc] text-white flex justify-between items-center text-[10px] uppercase tracking-widest font-bold font-mono">
           <div className="flex items-center space-x-4">
             <span className="flex items-center">
               <div className="w-1.5 h-1.5 bg-green-400 rounded-full mr-2 shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
               Framework Active
             </span>
             <span className="opacity-70">Total Files: {files.filter(f => f.type === 'file').length}</span>
           </div>
           <div className="flex items-center space-x-4 opacity-70">
             <span>Ln 1, Col 1</span>
             <span>UTF-8</span>
             <span>PHP</span>
           </div>
        </div>

        {/* Custom state-driven Delete Confirmation Overlay */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-[#1e1e1e] border border-slate-850 rounded-xl p-6 shadow-2xl max-w-sm w-full text-center animate-scale-in">
              <div className="w-12 h-12 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4 text-rose-500">
                <Trash2 className="w-6 h-6 animate-pulse" />
              </div>
              <h4 className="text-sm font-bold text-slate-100 uppercase tracking-widest mb-2">确认删除 / Confirm</h4>
              <p className="text-xs text-slate-400 leading-relaxed mb-6">
                您确实要删除 <span className="text-indigo-400 font-semibold font-mono">{showDeleteConfirm.name}</span> 吗？自此路径下的所有内容也将被清空。
              </p>
              <div className="flex space-x-3 justify-center">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 text-xs font-bold rounded-lg transition-colors border border-slate-800"
                >
                  取消 (Cancel)
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const file = showDeleteConfirm;
                    setShowDeleteConfirm(null);
                    await confirmDelete(file);
                  }}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-rose-900/30 transition-colors"
                >
                  确认删除 (Confirm)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Notifications / Toast */}
        {notification && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center bg-[#252526] border border-slate-705 text-slate-200 px-4 py-3 rounded-lg shadow-2xl min-w-[280px]">
            <div className={`w-2 h-2 rounded-full mr-3 shrink-0 ${notification.type === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
            <span className="text-xs font-medium font-sans">{notification.message}</span>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="text-slate-500 hover:text-slate-300 ml-auto font-bold text-sm select-none"
            >
              ×
            </button>
          </div>
        )}
      </div>
  );
}

