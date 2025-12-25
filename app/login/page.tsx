"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const t = await res.text();
        setError(t || 'Login failed');
        return;
      }
      // try to read token from response body, fallback to header if needed
      try {
        const data = await res.json();
        if (data && data.token) {
          localStorage.setItem('authToken', data.token);
          try { window.dispatchEvent(new Event('auth-changed')); } catch(_) {}
        } else {
          const headerToken = res.headers.get('x-auth-token');
          if (headerToken) localStorage.setItem('authToken', headerToken);
        }
      } catch (_) {
        const headerToken = res.headers.get('x-auth-token');
        if (headerToken) localStorage.setItem('authToken', headerToken);
      }
      router.push('/');
    } catch (e) {
      setError('Network error');
    }
  }

  return (
    <div className="page-container flex min-h-[70vh] items-center justify-center">
      <form className="glass-card w-full max-w-md space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <p className="kicker">welcome back</p>
          <h2 className="hero-title text-2xl">登录</h2>
          <p className="muted text-sm">使用账号进入实时音乐房间。</p>
        </div>
        {error && <div className="text-sm text-rose-200">{error}</div>}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate-400">邮箱</label>
          <input className="input-field mt-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate-400">密码</label>
          <input type="password" className="input-field mt-2" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" type="submit">登录</button>
        </div>
        <div className="flex justify-end text-xs text-slate-500">
          <span>没有账号？</span>
          <a href="/register" className="ml-2 text-slate-400 hover:text-slate-200">去注册</a>
        </div>
      </form>
    </div>
  );
}
