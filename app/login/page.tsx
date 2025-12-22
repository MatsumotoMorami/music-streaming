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
      const res = await fetch("http://localhost:4001/api/login", {
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
    <div className="min-h-screen flex items-center justify-center">
      <form className="w-full max-w-md bg-white p-6 rounded shadow" onSubmit={submit}>
        <h2 className="text-xl font-medium mb-4">登录</h2>
        {error && <div className="mb-2 text-red-600">{error}</div>}
        <label className="block text-sm">邮箱</label>
        <input className="w-full border p-2 mb-3" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="block text-sm">密码</label>
        <input type="password" className="w-full border p-2 mb-4" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-blue-600 text-white">登录</button>
          <a href="/register" className="px-4 py-2 bg-gray-200">注册</a>
        </div>
      </form>
    </div>
  );
}
