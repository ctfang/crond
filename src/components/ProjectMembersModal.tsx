import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Project, ProjectMember } from '../types';
import { X, UserPlus, Trash2, Mail, Shield, User } from 'lucide-react';

interface Props {
  project: Project;
  onClose: () => void;
}

export default function ProjectMembersModal({ project, onClose }: Props) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMembers();
  }, [project.id]);

  const fetchMembers = async () => {
    try {
      const data = await api.getMembers(project.id);
      setMembers(data);
    } catch (err) {
      console.error('Failed to fetch members', err);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      await api.addMember(project.id, email, role);
      setEmail('');
      fetchMembers();
    } catch (err: any) {
      setError(err.message || '添加成员失败');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm('确认移除此成员？')) return;
    try {
      await api.removeMember(project.id, memberId);
      fetchMembers();
    } catch (err: any) {
      alert('移除失败: ' + err.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="font-bold text-slate-800 flex items-center">
              <UserPlus className="w-4 h-4 mr-2 text-indigo-500" />
              项目成员管理
            </h3>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-0.5">Project: {project.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {/* Add Member Form */}
          <form onSubmit={handleAddMember} className="mb-6">
            <div className="flex flex-col space-y-3">
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  placeholder="输入邀请成员的邮箱 (User Email)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                  required
                />
              </div>
              <div className="flex space-x-2">
                <select 
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none"
                >
                  <option value="editor">编辑器 (Editor)</option>
                  <option value="viewer">查看者 (Viewer)</option>
                </select>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 disabled:opacity-50 transition-all"
                >
                  {loading ? '邀请中...' : '添加成员'}
                </button>
              </div>
              {error && <p className="text-xs text-rose-500 font-medium">{error}</p>}
              <p className="text-[10px] text-slate-400 italic">注意：被邀请人必须先登录过本系统一次。</p>
            </div>
          </form>

          {/* Members List */}
          <div className="space-y-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 pb-1">Current Members</div>
            
            <div className="space-y-1">
               {/* Owner placeholder */}
               <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50/50 border border-slate-100">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">所有者 (Owner)</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded uppercase tracking-wider">Project Admin</span>
               </div>

               {members.map(member => (
                 <div key={member.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-100 transition-all">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                        <User className="w-4 h-4 text-slate-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 truncate">{member.userEmail}</p>
                        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold capitalize">{member.role}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleRemoveMember(member.id)}
                      className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                 </div>
               ))}

               {members.length === 0 && (
                 <div className="py-8 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                    <UserPlus className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">目前没有协作成员</p>
                 </div>
               )}
            </div>
          </div>
        </div>

        <div className="p-6 bg-slate-50 border-t border-slate-100 italic text-[11px] text-slate-400 text-center">
          项目成员可以根据角色权限共同管理任务脚本和查看执行日志。
        </div>
      </div>
    </div>
  );
}
