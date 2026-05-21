import React, { useState } from 'react';
import { api } from '../services/api';
import { User } from '../types';
import { Lock, User as UserIcon } from 'lucide-react';

export const AuthModal: React.FC<{ onLogin: (uname: string) => void }> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const { username: un } = await api.login({});
      onLogin(un);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm px-4 font-sans">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-slate-200">
        <div className="p-8 text-center bg-slate-50 border-b border-slate-100">
          <div className="w-12 h-12 bg-indigo-500 rounded-xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Crond PHP 平台</h2>
          <p className="text-xs text-slate-500 mt-1">
            Sign in with your Google account to manage cron jobs.
          </p>
        </div>
        <div className="p-8">
          {error && <div className="mb-6 p-3 bg-rose-50 text-rose-600 rounded text-xs font-medium border border-rose-100 text-center">{error}</div>}
          
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center space-x-3 py-3 px-4 border border-slate-200 rounded-xl shadow-sm text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span>{loading ? 'Logging in...' : 'Sign in with Google'}</span>
          </button>

          <p className="mt-8 text-center text-[10px] text-slate-400 font-medium leading-relaxed">
            By signing in, you agree to our Terms of Service and Privacy Policy.
            <br />
            Secure multi-user management powered by Firebase.
          </p>
        </div>
      </div>
    </div>
  );
};
