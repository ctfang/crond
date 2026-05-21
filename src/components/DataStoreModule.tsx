import React, { useState, useEffect } from 'react';
import { 
  Database, Plus, Trash2, Edit, Search, Info, Code, FileJson, Table2, 
  Save, AlertCircle, BookOpen, ArrowRight, RefreshCw, Layers, Check 
} from 'lucide-react';
import { api } from '../services/api';
import { DataCollection, DataRecord } from '../types';

interface Props {
  projectId: string;
}

export default function DataStoreModule({ projectId }: Props) {
  const [collections, setCollections] = useState<DataCollection[]>([]);
  const [records, setRecords] = useState<DataRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCollection, setSelectedCollection] = useState<DataCollection | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modals state
  const [showCreateCollection, setShowCreateCollection] = useState(false);
  const [showEditRecord, setShowEditRecord] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DataRecord | null>(null);
  const [showIntegrationDoc, setShowIntegrationDoc] = useState(false);

  // New Collection Inputs
  const [newColId, setNewColId] = useState('');
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [colError, setColError] = useState('');

  // New/Edit Record JSON
  const [recordJson, setRecordJson] = useState('{\n  \n}');
  const [recordError, setRecordError] = useState('');

  // Load collections
  const loadCollections = async () => {
    setLoading(true);
    try {
      const data = await api.getDataCollections(projectId);
      setCollections(data);
      // Select first collection by default
      if (data.length > 0 && !selectedCollection) {
        setSelectedCollection(data[0]);
      }
    } catch (err) {
      console.error('Error fetching collections:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load records when selected collection changes
  const loadRecords = async (colId: string) => {
    try {
      const data = await api.getDataRecords(projectId, colId);
      setRecords(data);
    } catch (err) {
      console.error('Error fetching records:', err);
    }
  };

  useEffect(() => {
    loadCollections();
  }, [projectId]);

  useEffect(() => {
    if (selectedCollection) {
      loadRecords(selectedCollection.id);
    } else {
      setRecords([]);
    }
  }, [selectedCollection]);

  // Create Collection
  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    setColError('');
    
    const cleanId = newColId.trim().toLowerCase();
    const cleanName = newColName.trim();
    
    if (!cleanId || !cleanName) {
      setColError('标识 ID 与通用中文字称均为必填项');
      return;
    }

    if (!/^[a-z0-9_]+$/.test(cleanId)) {
      setColError('集合标识 ID 必须为小写字母、数字与下划线的组合（例如：users_log）');
      return;
    }

    if (collections.some(c => c.name === cleanId)) {
      setColError(`已存在名为 ${cleanId} 的集合`);
      return;
    }

    try {
      const isMock = cleanId.startsWith('mock_');
      let createdCol: DataCollection;
      
      if (isMock) {
        createdCol = {
          id: cleanId,
          projectId,
          name: cleanId.replace('mock_', ''),
          displayName: cleanName,
          description: newColDesc.trim(),
          createdAt: Date.now()
        };
        setCollections(prev => [createdCol, ...prev]);
      } else {
        createdCol = await api.upsertDataCollection(projectId, {
          name: cleanId,
          displayName: cleanName,
          description: newColDesc.trim()
        });
        setCollections(prev => [createdCol, ...prev]);
      }
      
      setSelectedCollection(createdCol);
      setShowCreateCollection(false);
      setNewColId('');
      setNewColName('');
      setNewColDesc('');
    } catch (err: any) {
      setColError('创建失败: ' + (err.message || err));
    }
  };

  // Delete Collection
  const handleDeleteCollection = async (col: DataCollection) => {
    const confirmation = window.confirm(`警告：您确认要删除集合【${col.displayName}】吗？这会清空集合内的全部文档且不可恢复。`);
    if (!confirmation) return;

    try {
      if (col.id.startsWith('mock_')) {
        setCollections(prev => prev.filter(c => c.id !== col.id));
        if (selectedCollection?.id === col.id) {
          setSelectedCollection(null);
        }
      } else {
        await api.deleteDataCollection(projectId, col.id);
        setCollections(prev => prev.filter(c => c.id !== col.id));
        if (selectedCollection?.id === col.id) {
          setSelectedCollection(null);
        }
      }
    } catch (err) {
      alert('删除失败');
    }
  };

  // Open Record Modal
  const handleOpenRecordEdit = (record: DataRecord | null = null) => {
    setRecordError('');
    if (record) {
      setEditingRecord(record);
      setRecordJson(JSON.stringify(record.data, null, 2));
    } else {
      setEditingRecord(null);
      
      // Provide appropriate placeholder template JSON depending on the collection (Ensuring 'key' is present)
      let defaultTemplate = '{\n  "key": "custom_record_key",\n  "title": "",\n  "status": "pending"\n}';
      if (selectedCollection?.id === 'mock_users') {
        defaultTemplate = '{\n  "key": "user_' + Math.random().toString(36).substring(2, 6) + '",\n  "username": "王五",\n  "email": "wangwu@example.com",\n  "role": "member",\n  "age": 25,\n  "status": "active",\n  "balance": 100.0,\n  "lastLogin": "' + new Date().toISOString().replace('T', ' ').substring(0, 19) + '"\n}';
      } else if (selectedCollection?.id === 'mock_configs') {
        defaultTemplate = '{\n  "key": "custom_api_url",\n  "config_key": "custom_api_url",\n  "value": "https://api.myproject.com",\n  "type": "string",\n  "group": "network",\n  "last_updated_by": "developer_sys"\n}';
      } else if (selectedCollection?.id === 'mock_api_logs') {
        defaultTemplate = '{\n  "key": "log_' + Math.random().toString(36).substring(2, 8) + '",\n  "request_id": "req_' + Math.random().toString(36).substring(2, 8) + '",\n  "endpoint": "/api/v1/data/query",\n  "method": "POST",\n  "ip": "127.0.0.1",\n  "status": 200,\n  "execution_ms": 15,\n  "client": "local-crond"\n}';
      }
      setRecordJson(defaultTemplate);
    }
    setShowEditRecord(true);
  };

  // Save Record
  const handleSaveRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecordError('');
    if (!selectedCollection) return;

    let parsedData: Record<string, any>;
    try {
      parsedData = JSON.parse(recordJson);
      if (typeof parsedData !== 'object' || parsedData === null || Array.isArray(parsedData)) {
        setRecordError('文档内容必须为一个有效的 JSON 对象');
        return;
      }
      
      // Enforce the mandatory 'key' field as requested
      if (!parsedData.key || typeof parsedData.key !== 'string' || !parsedData.key.trim()) {
        setRecordError('数据存储强制：所有文档都必须包含一个非空的 "key" 属性（例如："key": "my_unique_id"）作为关键索引值');
        return;
      }
    } catch (err: any) {
      setRecordError(`JSON 格式错误：${err.message}`);
      return;
    }

    try {
      const isMockCol = selectedCollection.id.startsWith('mock_');
      const isMockRec = editingRecord?.id.startsWith('rec_');
      
      if (isMockCol) {
        // Handle mock update / insert
        if (editingRecord) {
          setRecords(prev => prev.map(r => r.id === editingRecord.id ? { ...r, data: parsedData, updatedAt: Date.now() } : r));
        } else {
          const freshMock: DataRecord = {
            id: 'rec_custom_' + Math.random().toString(36).substring(2, 9),
            collectionId: selectedCollection.id,
            projectId,
            data: parsedData,
            updatedAt: Date.now()
          };
          setRecords(prev => [freshMock, ...prev]);
        }
      } else {
        const result = await api.upsertDataRecord(
          projectId, 
          selectedCollection.id, 
          editingRecord ? editingRecord.id : null, 
          parsedData
        );
        
        if (editingRecord) {
          setRecords(prev => prev.map(r => r.id === editingRecord.id ? result : r));
        } else {
          setRecords(prev => [result, ...prev]);
        }
      }
      setShowEditRecord(false);
    } catch (err: any) {
      setRecordError('文档保存失败：' + (err.message || err));
    }
  };

  // Delete Record
  const handleDeleteRecord = async (recordId: string) => {
    if (!selectedCollection) return;
    const confirmation = window.confirm('您确定要永久删除本条数据记录吗？');
    if (!confirmation) return;

    try {
      if (selectedCollection.id.startsWith('mock_')) {
        setRecords(prev => prev.filter(r => r.id !== recordId));
      } else {
        await api.deleteDataRecord(projectId, selectedCollection.id, recordId);
        setRecords(prev => prev.filter(r => r.id !== recordId));
      }
    } catch (err) {
      alert('删除失败');
    }
  };

  // Extract all unique fields inside records to build the dynamic table columns!
  const getDynamicKeys = () => {
    const keysSet = new Set<string>();
    records.forEach(r => {
      if (r.data && typeof r.data === 'object') {
        Object.keys(r.data).forEach(k => keysSet.add(k));
      }
    });
    return Array.from(keysSet);
  };

  const dynamicKeys = getDynamicKeys();

  // Filter records based on search query
  const filteredRecords = records.filter(record => {
    if (!searchQuery) return true;
    const queryLower = searchQuery.toLowerCase();
    
    // Check inside JSON string of data
    try {
      const dataStr = JSON.stringify(record.data).toLowerCase();
      return dataStr.includes(queryLower);
    } catch {
      return false;
    }
  });

  return (
    <div className="w-full h-full bg-white flex flex-col overflow-hidden">
      {/* Top Banner Header */}
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/60 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200/50">
            <Database className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800 flex items-center">
              共享数据存储存储模块 (Project Data Store)
            </h3>
            <p className="text-xs text-slate-500 font-medium tracking-wide">
              为系统定时器 crond 任务与无状态服务提供敏捷、可读可写的数据结构，支持无痛集成
            </p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button 
            onClick={() => setShowIntegrationDoc(true)}
            className="px-4 py-2 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
          >
            <BookOpen className="w-4 h-4" />
            查看集成对接文档 (APIs integration)
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Side: Collection Lists */}
        <div className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/30 shrink-0">
          <div className="p-4 border-b border-slate-100">
            <button 
              onClick={() => setShowCreateCollection(true)}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>新建数据集合 (Create Collection)</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider px-2 block mb-1">
              内部数据包 (Collections list)
            </span>
            
            {loading ? (
              <div className="py-6 text-center text-xs text-slate-400 font-mono animate-pulse">
                数据加载中 / Connecting...
              </div>
            ) : collections.length === 0 ? (
              <div className="py-12 px-3 text-center text-xs text-slate-400 leading-relaxed bg-white rounded-xl border border-dashed border-slate-200">
                暂无集合。请点击上方按钮定义您的第一个存储容器。
              </div>
            ) : (
              collections.map(col => {
                const isSelected = selectedCollection?.id === col.id;
                const isMock = col.id.startsWith('mock_');
                return (
                  <div 
                    key={col.id}
                    onClick={() => setSelectedCollection(col)}
                    className={`group flex flex-col p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected 
                        ? 'bg-indigo-50/70 border-indigo-200 shadow-sm' 
                        : 'bg-white border-slate-150 hover:bg-slate-50 hover:border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-sm font-bold text-slate-800 truncate">
                        <Database className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-indigo-600' : 'text-slate-400'}`} />
                        <span className="truncate">{col.displayName}</span>
                      </div>
                      
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCollection(col);
                        }}
                        className={`opacity-0 group-hover:opacity-100 flex p-1 text-slate-400 hover:text-rose-500 rounded transition-all hover:bg-slate-100`}
                        title="删除集合"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    
                    <span className="text-[10px] font-mono text-slate-400 mt-1 block tracking-wider uppercase font-semibold">
                      id: {col.name} {isMock && <span className="text-[8px] bg-amber-50 text-amber-600 border border-amber-100 px-1 rounded ml-1 font-sans">示范 Demo</span>}
                    </span>
                    
                    {col.description && (
                      <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed truncate group-hover:text-slate-600">
                        {col.description}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Data view panel */}
        <div className="flex-1 flex flex-col bg-slate-50/20 overflow-hidden">
          {selectedCollection ? (
            <>
              {/* Collection stats header */}
              <div className="bg-white border-b border-slate-100 p-4 shrink-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-base font-bold text-slate-800">
                      {selectedCollection.displayName}
                    </h4>
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-mono border border-indigo-100">
                      count: {records.length} 条数据
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                    {selectedCollection.description || "暂无具体描述。任何无状态服务可以并发写入和读取当前集合内定义的数据结构。"}
                  </p>
                </div>
                
                <div className="flex items-center space-x-2 shrink-0">
                  {/* Search query input */}
                  <div className="relative flex items-center h-8">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text" 
                      placeholder="全文过滤条件 (Filter rows)..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 bg-slate-50 border border-slate-200 text-xs font-medium rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-indigo-500 w-44 md:w-56 h-full py-0 flex items-center"
                    />
                  </div>

                  <button 
                    onClick={() => handleOpenRecordEdit(null)}
                    className="px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow transition-all flex items-center justify-center gap-1 h-8 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>导入新记录 (Add Row)</span>
                  </button>
                </div>
              </div>

              {/* NoSQL Document Workspace Card Grid */}
              <div className="flex-1 overflow-auto bg-slate-50/50 p-6">
                {filteredRecords.length === 0 ? (
                  <div className="py-24 text-center bg-white border border-slate-150 rounded-2xl shadow-xs">
                    <FileJson className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-slate-500 text-sm font-bold">
                      {searchQuery ? "未能检索到与过滤词匹配的 JSON 文档" : "当前 NoSQL 数据集合为空"}
                    </p>
                    <p className="text-xs text-slate-450 mt-1.5 max-w-sm mx-auto">
                      请点击页面上方的 ”导入新记录“ 来追加 JSON 文档，也可以使用微服务器 API 推送载荷。
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4 max-w-5xl mx-auto">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-bold px-1 select-none">
                      <span className="uppercase tracking-wider">
                        已检索到 {filteredRecords.length} 个文档数据对象 (JSON Documents)
                      </span>
                      <span>
                        格式: {"{ ID + JSON Document }"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {filteredRecords.map((record) => {
                        const formattedJson = JSON.stringify(record.data, null, 2);
                        return (
                          <div 
                            key={record.id}
                            className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all hover:shadow-md hover:border-slate-300 overflow-hidden flex flex-col"
                            id={`doc-card-${record.id}`}
                          >
                            {/* Document Ribbon Header */}
                            <div className="px-5 py-3.5 bg-slate-50/60 border-b border-slate-100 flex items-center justify-between">
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <div className="p-1 px-2 bg-indigo-50 text-indigo-700 text-[10px] font-mono font-black rounded-lg border border-indigo-100">
                                  DOC_ID
                                </div>
                                <span className="font-mono text-xs font-bold text-slate-700 truncate" title={record.id}>
                                  {record.id}
                                </span>
                              </div>

                              {/* Operations actions */}
                              <div className="flex items-center space-x-2">
                                <span className="text-[10px] text-slate-400 font-mono font-medium">
                                  更新于: {new Date(record.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                                </span>
                                <div className="h-3 w-px bg-slate-200 mx-1" />
                                
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(formattedJson);
                                    alert('已将文档 JSON 拷贝至剪贴板');
                                  }}
                                  className="text-xs text-indigo-650 hover:text-indigo-800 bg-white hover:bg-slate-100 px-2 py-1 rounded-lg border border-slate-200 transition-all font-bold"
                                  title="复制 JSON 数据"
                                >
                                  复制 JSON (Copy)
                                </button>

                                <button 
                                  onClick={() => handleOpenRecordEdit(record)}
                                  className="text-slate-500 hover:text-indigo-600 transition-colors p-1 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg inline-flex items-center justify-center h-7 w-7"
                                  title="编辑 JSON 文档"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                
                                <button 
                                  onClick={() => handleDeleteRecord(record.id)}
                                  className="text-slate-500 hover:text-rose-650 transition-colors p-1 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg inline-flex items-center justify-center h-7 w-7"
                                  title="物理删除文档"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {/* Collapsible Document Content */}
                            <div className="p-5 flex flex-col md:flex-row gap-5">
                              {/* Left Pane structured fields preview for readability */}
                              <div className="flex-1 space-y-2">
                                <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-2">
                                  结构解析 (Fields preview)
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  {Object.entries(record.data || {}).map(([k, v]) => {
                                    const type = typeof v;
                                    let strVal = typeof v === 'object' ? JSON.stringify(v) : String(v);
                                    return (
                                      <div key={k} className="flex flex-col p-2 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-705">
                                        <div className="flex items-center justify-between mb-0.5">
                                          <span className="font-bold text-slate-500 font-mono truncate">{k}</span>
                                          <span className="text-[9px] text-slate-400 bg-slate-200/50 px-1 rounded uppercase font-mono">{type}</span>
                                        </div>
                                        <div className="font-medium truncate text-slate-800" title={strVal}>
                                          {type === 'boolean' ? (
                                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-black ${
                                              v ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-500 border border-rose-100'
                                            }`}>
                                              {strVal}
                                            </span>
                                          ) : type === 'number' ? (
                                            <span className="font-mono text-amber-650 font-bold">{strVal}</span>
                                          ) : (
                                            strVal
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Right Pane raw beautified JSON text */}
                              <div className="w-full md:w-1/2 shrink-0 flex flex-col">
                                <div className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-2">
                                  RAW JSON DATA
                                </div>
                                <div className="bg-slate-900 rounded-2xl p-3.5 border border-slate-800 font-mono text-[11px] leading-relaxed text-teal-300 max-h-48 overflow-y-auto whitespace-pre">
                                  {formattedJson}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-50/10">
              <Database className="w-16 h-16 text-indigo-400/30 mb-4 stroke-1 animate-pulse" />
              <h3 className="text-base font-bold text-slate-700">未选择或未加载数据集合</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1 mb-6">
                高内聚的数据可以大大减轻定时任务和后台的硬编码。请点击左侧面板在当前 Project 底下初始化或者选择一个数据容器集合。
              </p>
              <button 
                onClick={() => setShowCreateCollection(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>一键创建初始存储</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL 1: Create Collection Collection Drawer/Modal */}
      {showCreateCollection && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl p-6 overflow-hidden animate-scale-in">
            <h4 className="text-base font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
              <Database className="w-5 h-5 text-indigo-600" />
              新建数据存储集合容器 (Create Data Collection)
            </h4>

            <form onSubmit={handleCreateCollection} className="space-y-4">
              {colError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl flex items-center space-x-2 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{colError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  集合英文标识 (Collection Key / ID)
                </label>
                <input 
                  type="text" 
                  placeholder="如: users, config_items, payment_orders"
                  value={newColId}
                  onChange={(e) => {
                    setNewColId(e.target.value);
                    setColError('');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-700 focus:outline-none focus:border-indigo-500 font-mono"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  必填：请使用小写英文拼写、数字、下划线，作为应用/微服务对接调用时定位的名字。
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  显示中文描述名称 (Chinese Name Dashboard)
                </label>
                <input 
                  type="text" 
                  placeholder="如: 网站付费用户资料, 广告参数缓存"
                  value={newColName}
                  onChange={(e) => {
                    setNewColName(e.target.value);
                    setColError('');
                  }}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-700 focus:outline-none focus:border-indigo-500"
                  required
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  必填：便于后台管理系统一眼识别。
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                  集合容器说明内容 (Description details - Optional)
                </label>
                <textarea 
                  placeholder="简要写出这个集合是哪个定时器，或者由哪个 API 无状态服务所订阅维护..."
                  value={newColDesc}
                  onChange={(e) => setNewColDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:border-indigo-500 min-h-[60px]"
                />
              </div>

              <div className="flex space-x-3 pt-3 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setShowCreateCollection(false)}
                  className="flex-1 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-150 text-slate-600 rounded-xl transition-all"
                >
                  取消 (Cancel)
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow transition-all"
                >
                  一键创建集合
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Add/Edit Record Row (JSON Interface) */}
      {showEditRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl p-6 overflow-hidden animate-scale-in">
            <h4 className="text-base font-bold text-slate-800 flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
              <FileJson className="w-5 h-5 text-indigo-600" />
              {editingRecord ? '更新/编辑现有数据行' : '在当前集合写入新行记录 (Insert JSON Data)'}
            </h4>

            <form onSubmit={handleSaveRecord} className="space-y-4">
              {recordError && (
                <div className="p-3 bg-rose-50 text-rose-700 border border-rose-100 rounded-xl flex items-center space-x-2 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="break-all">{recordError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex justify-between">
                  <span>文档包含的数据字段 (Row Data Object) </span>
                  <span className="text-indigo-600 text-[10px] font-semibold lowercase">格式：JSON objects keys and values</span>
                </label>
                
                <textarea 
                  value={recordJson}
                  onChange={(e) => {
                    setRecordJson(e.target.value);
                    setRecordError('');
                  }}
                  className="w-full px-4 py-3 border border-slate-850 rounded-xl font-mono text-xs focus:outline-none focus:border-indigo-500 min-h-[220px]"
                  style={{ 
                    tabSize: 2, 
                    color: '#2dd4bf', 
                    backgroundColor: '#0f172a' 
                  }}
                />
                <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                  提示：您可以自由写入任何非扁平的 JSON 属性键值。保存时如果格式合法，该数据将在当前列表的列中自动识别并生成可视表格排版。
                </p>
              </div>

              {editingRecord && (
                <div className="text-[10px] font-mono p-2.5 bg-slate-50 border border-slate-150 rounded-lg text-slate-400">
                  物理底层文档 UID：{editingRecord.id} (不可更改)
                </div>
              )}

              <div className="flex space-x-3 pt-3 border-t border-slate-100">
                <button 
                  type="button"
                  onClick={() => setShowEditRecord(false)}
                  className="flex-1 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-150 text-slate-600 rounded-xl transition-all"
                >
                  取消 (Cancel)
                </button>
                <button 
                  type="submit"
                  className="flex-1 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow transition-all"
                >
                  确定并即时写入存储 (Save Record)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: API Integration Guide Doc */}
      {showIntegrationDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl shadow-2xl p-6 overflow-hidden max-h-[85vh] flex flex-col animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 shrink-0">
              <h4 className="text-base font-bold text-slate-800 flex items-center gap-1.5">
                <Code className="w-5 h-5 text-indigo-600" />
                系统集成文档 (How to Connect Tasks & Stateless Services to Database)
              </h4>
              <button 
                onClick={() => setShowIntegrationDoc(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 text-xs text-slate-650 leading-relaxed font-medium">
              <div>
                <h5 className="text-[13px] font-bold text-slate-800 mb-2 border-l-3 border-indigo-600 pl-2">
                  1. 定时任务中写入数据示例 (PHP Executable Job)
                </h5>
                <p className="mb-2 text-slate-500">
                  在您配置的 PHP Job 或者 crond 定时执行脚本中，直接调用系统预装的库来写数据。
                </p>
                <pre className="p-3 bg-slate-900 text-amber-300 rounded-xl font-mono text-[10px] leading-relaxed overflow-x-auto">
{`<?php
// 定时任务每天同步今日注册量
require_once "src/Database.php";

$collection = Database::collection("system_configs");

// 写入数据
$collection->insert([
    "config_key" => "daily_cron_run_checksum",
    "value" => md5(time()),
    "type" => "string",
    "last_updated_by" => "cron_task_process"
]);

echo "[INFO] 写入审计配置完毕";
`}
                </pre>
              </div>

              <div>
                <h5 className="text-[13px] font-bold text-slate-800 mb-2 border-l-3 border-indigo-600 pl-2">
                  2. 无状态服务中查询数据示例 (Stateless PHP Endpoint)
                </h5>
                <p className="mb-2 text-slate-500">
                  无状态服务接口可以通过此共享微存储读取全局配置来实现动态响应行为！
                </p>
                <pre className="p-3 bg-slate-900 text-amber-300 rounded-xl font-mono text-[10px] leading-relaxed overflow-x-auto">
{`<?php

function handle(Request $request) 
{
    require_once "src/Database.php";
    
    // 获取全局系统配置
    $configs = Database::collection("system_configs")->find([
        "config_key" => "enable_new_user_registration"
    ]);
    
    $isEnabled = empty($configs) ? true : $configs[0]['value'];
    
    if (!$isEnabled) {
        return [
            "status" => "error",
            "message" => "系统维护中，注册入口已全局禁用！"
        ];
    }
    
    return [
        "status" => "success",
        "message" => "注册通过！"
    ];
}
`}
                </pre>
              </div>

              <div>
                <h5 className="text-[13px] font-bold text-slate-800 mb-2 border-l-3 border-indigo-600 pl-2">
                  3. 使用标准 curl / CLI 写入行数据 (Bash Shell)
                </h5>
                <p className="mb-2 text-slate-500">
                  如果您在 Shell 定时任务中，也可以采用系统内设的环境变量直接推送记录。
                </p>
                <pre className="p-3 bg-slate-900 text-amber-300 rounded-xl font-mono text-[10px] leading-relaxed overflow-x-auto">
{`# 模拟在 Crond Job Bash 代码块中进行推送
curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"request_id":"cron_shell_run","endpoint":"system_reboot","status":200,"execution_ms":453}' \\
  "http://localhost:3000/api/internal/collections/api_logs/records"
`}
                </pre>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end shrink-0">
              <button 
                onClick={() => setShowIntegrationDoc(false)}
                className="px-5 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-md hover:bg-indigo-700 transition-all"
              >
                我已了解 (Got it)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
