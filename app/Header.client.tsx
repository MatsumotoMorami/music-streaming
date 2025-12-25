"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Header() {
  const [user, setUser] = useState<{ email?: string } | null>(null);
  const [profile, setProfile] = useState<{ nickname?: string; avatar?: string } | null>(null);

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
        const res = await fetch("/api/me", { credentials: 'include', headers });
        if (!res.ok) {
          console.debug('Header: /api/me responded not ok', res.status);
          return;
        }
        const data = await res.json();
        if (mounted) setUser(data.user || null);
        // load profile details
        try {
          const token2 = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
          const headers2: any = {};
          if (token2) headers2['Authorization'] = `Bearer ${token2}`;
          const pRes = await fetch('/api/profile', { credentials: 'include', headers: headers2 });
          if (pRes.ok) {
            const pData = await pRes.json();
            if (mounted) setProfile(pData.profile || null);
          }
        } catch (_) {}
      } catch (e) {
        console.debug('Header: /api/me error', e);
      }
    })();

    // listen for auth changes (login/logout) performed elsewhere
    const onAuthChanged = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        if (token) {
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(decodeURIComponent(escape(window.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))));
              if (mounted && payload && payload.email) setUser({ email: payload.email });
            }
          } catch (_) {}
        } else {
          if (mounted) setUser(null);
        }
        // revalidate with server
        const headers: any = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch("/api/me", { credentials: 'include', headers });
        if (res.ok) {
          const data = await res.json();
          if (mounted) setUser(data.user || null);
        }
        // refresh profile
        try {
          const token2 = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
          const headers2: any = {};
          if (token2) headers2['Authorization'] = `Bearer ${token2}`;
          const pRes = await fetch('/api/profile', { credentials: 'include', headers: headers2 });
          if (pRes.ok) {
            const pData = await pRes.json();
            if (mounted) setProfile(pData.profile || null);
          } else {
            if (mounted) setProfile(null);
          }
        } catch (_) { if (mounted) setProfile(null); }
      } catch (e) {
        console.debug('Header: auth-changed handler error', e);
      }
    };
    window.addEventListener('auth-changed', onAuthChanged);
    return () => { mounted = false; window.removeEventListener('auth-changed', onAuthChanged); };
  }, []);


  function makeAvatar(name?: string) {
    const label = (name || 'U').slice(0, 2).toUpperCase();
    // simple color hash
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
    const color = `hsl(${Math.abs(h) % 360} 60% 60%)`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='100%' height='100%' fill='${color}' rx='10' ry='10'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Arial, Helvetica, sans-serif' font-size='26' fill='#fff'>${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return (
    <nav className="flex items-center gap-3">
      {user ? (
        <>
          {profile && profile.avatar ? (
            <img src={profile.avatar} alt="avatar" className="h-9 w-9 rounded-xl border border-white/10 object-cover" />
          ) : (
            <img src={makeAvatar(profile?.nickname || user.email)} alt="avatar" className="h-9 w-9 rounded-xl border border-white/10" />
          )}
          <span className="hidden text-sm text-slate-200 md:inline">{profile?.nickname || user.email}</span>
          <a href="/profile" className="btn-secondary">个人资料</a>
          <button
            onClick={async () => {
              try {
                await fetch('/api/logout', { method: 'GET', credentials: 'include' });
              } catch (_) {}
              try { localStorage.removeItem('authToken'); } catch (_) {}
              setUser(null);
              // reload to ensure app state resets
              window.location.href = window.location.origin;
            }}
            className="btn-danger"
          >登出</button>
        </>
      ) : (
        <>
          <Link href="/login" className="btn-secondary">登录</Link>
          <Link href="/register" className="btn-primary">注册</Link>
        </>
      )}
    </nav>
  );
}
