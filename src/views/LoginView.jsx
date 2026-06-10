import React, { useState, useEffect } from 'react';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { api }         from '../lib/api';
import { saveSession } from '../lib/auth';
import { users as mockUsers } from '../data/mockData';

const IS_DEMO = !import.meta.env.VITE_API_URL;

export default function LoginView({ onLogin }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  // Pre-warm the Render server the moment the login page appears so it's
  // ready (or much closer to ready) by the time the user finishes logging in.
  useEffect(() => {
    if (!IS_DEMO) api.warmup();
  }, []);
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (IS_DEMO) {
        const user = mockUsers.find((u) => u.email === email);
        if (!user || password !== 'flowdesk123') throw new Error('Invalid credentials');
        saveSession('demo-mode', user);
        onLogin(user);
      } else {
        const data = await api.post('/api/auth/login', { email, password });
        saveSession(data.token, data.user);
        onLogin(data.user);
      }
    } catch (err) {
      setError(err.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: '#ECEDF5' }}
    >
      <div className="fd-card w-full max-w-sm p-8 space-y-6 shadow-md">

        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#1E1B3A] flex items-center justify-center text-white font-black select-none">
            F
          </div>
          <div>
            <p className="font-bold text-[#111827] leading-none">FlowDesk</p>
            <p className="text-[11px] text-[#9CA3AF] tracking-wide uppercase mt-0.5">Task Operations</p>
          </div>
        </div>

        {/* Heading */}
        <div>
          <h1 className="text-2xl font-bold text-[#111827] tracking-tight">Sign in</h1>
          <p className="text-sm text-[#9CA3AF] mt-1">Use your FlowDesk account credentials.</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="label">Email</label>
            <input
              type="email"
              className="fd-input w-full"
              placeholder="you@flowdesk.io"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-1">
            <label className="label">Password</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                className="fd-input w-full pr-10"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#374151] transition-colors"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-xs text-[#B91C1C] font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="fd-btn-primary w-full justify-center py-2.5"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <LogIn className="w-4 h-4" />
            )}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-[11px] text-[#9CA3AF] text-center">
          Demo:{' '}
          <span className="font-mono text-[#374151]">aarav@flowdesk.io</span>
          {' '}/ <span className="font-mono text-[#374151]">flowdesk123</span>
        </p>
      </div>
    </div>
  );
}
