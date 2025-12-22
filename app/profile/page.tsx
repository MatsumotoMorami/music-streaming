"use client";

import { useEffect, useState } from "react";

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<{ email?: string; nickname?: string; bio?: string; avatar?: string } | null>(null);
  const [password, setPassword] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const headers: any = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch('http://localhost:4001/api/profile', { credentials: 'include', headers });
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && data && data.profile) setProfile(data.profile);
      } catch (e) {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  function makeAvatarDataUrl(name?: string) {
    const label = (name || 'U').slice(0, 2).toUpperCase();
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h << 5) - h + label.charCodeAt(i);
    const color = `hsl(${Math.abs(h) % 360} 60% 60%)`;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='100%' height='100%' fill='${color}' rx='20' ry='20'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-family='Arial, Helvetica, sans-serif' font-size='64' fill='#fff'>${label}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }


  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let avatarBase64 = undefined;
      if (avatarFile) {
        // resize image on client to reduce payload
        avatarBase64 = await new Promise<string | null>((resolve) => {
          const url = URL.createObjectURL(avatarFile);
          const img = new Image();
          img.onload = () => {
            try {
              const max = 512;
              let w = img.width;
              let h = img.height;
              if (w > max || h > max) {
                const ratio = Math.min(max / w, max / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
              }
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (!ctx) return resolve(null);
              ctx.drawImage(img, 0, 0, w, h);
              // use jpeg to compress if original large
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
              resolve(dataUrl);
            } catch (e) {
              resolve(null);
            } finally {
              URL.revokeObjectURL(url);
            }
          };
          img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
          img.src = url;
        });
      }
      const headers: any = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const body: any = { nickname: profile?.nickname || '', bio: profile?.bio || '' };
      if (avatarBase64) body.avatarBase64 = avatarBase64;
      if (password) body.password = password;
      const res = await fetch('http://localhost:4001/api/profile', { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Save failed');
      alert('保存成功');
      // refresh profile after save
      try {
        const headers2: any = {};
        if (token) headers2['Authorization'] = `Bearer ${token}`;
        const pRes = await fetch('http://localhost:4001/api/profile', { credentials: 'include', headers: headers2 });
        if (pRes.ok) {
          const pData = await pRes.json();
          setProfile(pData.profile || null);
        }
      } catch (_) {}
      try { window.dispatchEvent(new Event('auth-changed')); } catch(_) {}
    } catch (e) {
      alert('保存失败');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-6">加载中…</div>;
  if (!profile) return <div className="p-6">未登录</div>;

  return (
    <div className="min-h-screen p-6">
      <div className="mx-auto max-w-2xl bg-white p-6 rounded shadow">
        <h1 className="text-xl font-semibold mb-4">用户信息</h1>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm">邮箱（不可修改）</label>
            <div className="mt-1">{profile.email}</div>
          </div>

          <div>
            <label className="block text-sm">昵称</label>
            <input className="w-full border p-2 mt-1" value={profile.nickname || ''} onChange={(e) => setProfile({ ...(profile||{}), nickname: e.target.value })} />
          </div>

          <div>
            <label className="block text-sm">简介</label>
            <textarea className="w-full border p-2 mt-1" value={profile.bio || ''} onChange={(e) => setProfile({ ...(profile||{}), bio: e.target.value })} />
          </div>

          <div>
            <label className="block text-sm">头像</label>
            <div className="flex items-center gap-4 mt-2">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="avatar-preview" className="w-20 h-20 rounded" />
                  ) : profile.avatar ? (
                    <img src={profile.avatar} alt="avatar" className="w-20 h-20 rounded" />
                  ) : (
                    <img src={makeAvatarDataUrl(profile.nickname || profile.email)} alt="avatar" className="w-20 h-20 rounded" />
                  )}
                  <input type="file" accept="image/*" onChange={(e) => {
                    const f = e.target.files ? e.target.files[0] : null;
                    setAvatarFile(f);
                    if (f) {
                      const url = URL.createObjectURL(f);
                      setAvatarPreview(url);
                    } else {
                      setAvatarPreview(null);
                    }
                  }} />
            </div>
          </div>

          <div>
            <label className="block text-sm">修改密码（留空则不变）</label>
            <input type="password" className="w-full border p-2 mt-1" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          <div>
            <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white">{saving ? '保存中…' : '保存'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
