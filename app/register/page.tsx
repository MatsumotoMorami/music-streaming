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
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg('Register failed');
        return;
      }
      if (data && data.preview) {
        setMsg('Registered. Preview email: ' + data.preview);
      } else {
        setMsg('Registered. Check your email to verify.');
      }
    } catch (e) {
      setMsg('Network error');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form className="w-full max-w-md bg-white p-6 rounded shadow" onSubmit={submit}>
        <h2 className="text-xl font-medium mb-4">注册</h2>
        {msg && <div className="mb-2 text-zinc-700">{msg}</div>}
        <label className="block text-sm">邮箱</label>
        <input className="w-full border p-2 mb-3" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="block text-sm">密码</label>
        <input type="password" className="w-full border p-2 mb-4" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-green-600 text-white">注册</button>
          <a href="/login" className="px-4 py-2 bg-gray-200">登录</a>
        </div>
      </form>
    </div>
  );
}
