"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      const res = await fetch("http://localhost:4001/api/register", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const raw = await res.text();
      const data = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return null; } })() : null;
      if (!res.ok) {
        setMsg((raw && raw.trim()) || 'Register failed');
        return;
      }
      if (data && data.preview) {
        setMsg('注册成功。验证邮件预览：' + data.preview);
      } else {
        setMsg('注册成功，请查收邮箱并完成验证。');
      }
    } catch (e) {
      setMsg('Network error');
    }
  }

  return (
    <div className="page-container flex min-h-[70vh] items-center justify-center">
      <form className="glass-card w-full max-w-md space-y-4" onSubmit={submit}>
        <div className="space-y-2">
          <p className="kicker">create account</p>
          <h2 className="hero-title text-2xl">注册</h2>
          <p className="muted text-sm">注册后即可创建你的音乐房间。</p>
        </div>
        {msg && <div className="text-sm text-slate-200">{msg}</div>}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate-400">邮箱</label>
          <input className="input-field mt-2" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="text-xs uppercase tracking-[0.2em] text-slate-400">密码</label>
          <input type="password" className="input-field mt-2" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" type="submit">注册</button>
        </div>
        <div className="flex justify-end text-xs text-slate-500">
          <span>已有账号？</span>
          <a href="/login" className="ml-2 text-slate-400 hover:text-slate-200">去登录</a>
        </div>
      </form>
    </div>
  );
}
