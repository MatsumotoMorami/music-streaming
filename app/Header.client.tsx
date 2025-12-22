"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Header() {
  const [user, setUser] = useState<{ email?: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        if (token) {
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(decodeURIComponent(escape(window.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))));
              if (mounted && payload && payload.email) setUser({ email: payload.email });
            }
          } catch (err) {
            // ignore decode errors
            console.debug('Header: token decode failed', err);
          }
        }

        const headers: any = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        console.debug('Header: fetching /api/me with token?', !!token);
        const res = await fetch("http://localhost:4001/api/me", { credentials: 'include', headers });
        if (!res.ok) {
          console.debug('Header: /api/me responded not ok', res.status);
          return;
        }
        const data = await res.json();
        if (mounted) setUser(data.user || null);
      } catch (e) {
        console.debug('Header: /api/me error', e);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <nav className="flex items-center gap-3">
      {user ? (
        <>
          <span className="text-sm text-gray-700">{user.email}</span>
          <button
            onClick={async () => {
              try {
                await fetch('http://localhost:4001/api/logout', { method: 'GET', credentials: 'include' });
              } catch (_) {}
              try { localStorage.removeItem('authToken'); } catch (_) {}
              setUser(null);
              // reload to ensure app state resets
              window.location.href = window.location.origin;
            }}
            className="px-3 py-1 rounded bg-red-600 text-white"
          >Logout</button>
        </>
      ) : (
        <>
          <Link href="/login" className="px-3 py-1 rounded bg-blue-600 text-white">登录</Link>
          <Link href="/register" className="px-3 py-1 rounded bg-green-600 text-white">注册</Link>
        </>
      )}
    </nav>
  );
}
