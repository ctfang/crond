import React, { useState } from 'react';
import { api } from '../services/api';
import { Lock, MessageCircle } from 'lucide-react';

export const AuthModal: React.FC<{ onLogin: (uname: string) => void }> = ({ onLogin }) => {
  const [error, setError] = useState('');
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [loadingQQ, setLoadingQQ] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoadingGoogle(true);
    try {
      const { username: un } = await api.login({});
      onLogin(un);
    } catch (err: any) {
      setError(err.message || 'Google 登录失败，请重试');
    } finally {
      setLoadingGoogle(false);
    }
  };

  const handleQQSignIn = async () => {
    setError('');
    setLoadingQQ(true);
    try {
      const { username: un } = await api.loginWithQQ();
      onLogin(un);
    } catch (err: any) {
      setError(err.message || 'QQ 登录失败，请重试');
    } finally {
      setLoadingQQ(false);
    }
  };

  const isLoading = loadingGoogle || loadingQQ;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
        <div className="p-8 text-center bg-slate-50 border-b border-slate-100">
          <div className="w-12 h-12 bg-indigo-500 rounded-xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 font-sans">Crond 定时任务管理平台</h2>
          <p className="text-xs text-slate-500 mt-1.5 font-sans">
            请选择登录方式以安全管理您的定时任务与无状态服务。
          </p>
        </div>
        <div className="p-8 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 text-rose-600 rounded-lg text-xs font-medium border border-rose-100 text-center animate-in fade-in duration-150">
              {error}
            </div>
          )}
          
          {/* Google Login Button */}
          <button
            onClick={handleGoogleSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center space-x-3 py-3 px-4 border border-slate-200 rounded-xl shadow-sm text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="font-sans text-xs shrink-0">
              {loadingGoogle ? '正在使用 Google 登录...' : '使用 Google 快捷登录'}
            </span>
          </button>

          {/* QQ Login Button */}
          <button
            onClick={handleQQSignIn}
            disabled={isLoading}
            className="w-full flex items-center justify-center space-x-3 py-3 px-4 border border-sky-100 rounded-xl shadow-sm text-sm font-bold text-white bg-sky-500 hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-400 transition-all disabled:opacity-50 cursor-pointer"
          >
            {/* Official Tencent QQ brand logo */}
            <svg className="w-5 h-5 fill-current shrink-0 text-white" viewBox="0 0 24 24">
              <path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673" />
            </svg>
            <span className="font-sans text-xs shrink-0">
              {loadingQQ ? '正在使用 QQ 登录...' : '使用 QQ 快捷登录'}
            </span>
          </button>

          <p className="mt-6 text-center text-[10px] text-slate-400 font-medium leading-relaxed font-sans">
            登录即代表您同意我们的 服务条款 与 隐私政策
            <br />
            安全多用户配置基于高级 Firebase 实例加密
          </p>
        </div>
      </div>
    </div>
  );
};
