"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [rooms, setRooms] = useState<{ id: string; members: number; joined?: boolean }[]>([]);
  const [newId, setNewId] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createVisibility, setCreateVisibility] = useState<'public'|'private'>('public');
  const [createPassword, setCreatePassword] = useState('');
  const [joinPrompt, setJoinPrompt] = useState<{ open: boolean; roomId?: string }>({ open: false, roomId: undefined });
  const [joinPassword, setJoinPassword] = useState('');
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    (async () => {
      const io = (await import('socket.io-client')).io;
      const s = io('http://localhost:4000');
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      s.on('connect', () => {
        try { s.emit('subscribe-rooms', { token }); } catch (e) {}
      });
      s.on('rooms-list', (list: any[]) => { if (!mounted) return; setRooms(list); });
      s.on('rooms-diff', ({ added = [], updated = [], removed = [] }: any) => {
        if (!mounted) return;
        setRooms((prev) => {
          const map = new Map(prev.map((r) => [r.id, r]));
          // removals
          removed.forEach((id: string) => map.delete(id));
          // updates
          updated.forEach((r: any) => map.set(r.id, r));
          // additions
          added.forEach((r: any) => map.set(r.id, r));
          return Array.from(map.values());
        });
      });
      // keep socket reference in window for manual join page use
        (window as any).__roomsSocket = s;
    })();
    return () => { mounted = false; try { const s = (window as any).__roomsSocket; if (s) { try { s.emit('unsubscribe-rooms'); } catch(_){} s.disconnect(); } } catch(_){} };
  }, []);

  async function createRoom() {
    const id = Math.random().toString(36).slice(2, 9);
    // store creation intent so the room page can auto-join using these params
    try {
      const payload = { visibility: createVisibility, password: createVisibility === 'private' ? createPassword : undefined, name: 'Creator' };
      sessionStorage.setItem(`room_create:${id}`, JSON.stringify(payload));
    } catch (e) {}
    router.push(`/${id}`);
  }

  function goToRoom(id?: string) {
    const rid = id || newId;
    if (!rid) return;
    const s = (window as any).__roomsSocket;
    // if we know the room is private from server list, prompt for password first
    const r = rooms.find((x) => x.id === rid) as any;
    if (r && r.visibility === 'private') {
      setJoinPrompt({ open: true, roomId: rid });
      return;
    }
    // try to join directly (public)
    if (s && s.connected) {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      s.emit('join-room', { roomId: rid, name: 'Guest', token }, (resp: any) => {
        if (resp && resp.ok) router.push(`/${rid}`);
        else {
          if (resp && resp.code === 'password-required') setJoinPrompt({ open: true, roomId: rid });
          else try { alert(resp?.message || '无法加入房间'); } catch (_) {}
        }
      });
      return;
    }
    try { alert('无法连接到实时服务器，无法加入房间，请稍后重试'); } catch (_) {}
  }

  return (
    <div className="page-container space-y-8">
      <section className="hero-card">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <p className="kicker">live sync rooms</p>
            <h1 className="hero-title">共享音乐房间</h1>
            <p className="hero-subtitle">
              创建私密或公开房间，让同一首歌在所有人的设备上同步播放。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={createRoom} className="btn-primary">
              新建房间
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass-card space-y-4">
          <div className="section-title">创建新房间</div>
          <p className="muted text-sm">选择房间可见性，私密房间需要密码。</p>
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">可见性</label>
              <select value={createVisibility} onChange={(e) => setCreateVisibility(e.target.value as any)} className="select-field mt-2">
                <option value="public">公开</option>
                <option value="private">私密（需要密码）</option>
              </select>
            </div>
            {createVisibility === 'private' && (
              <div>
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">房间密码</label>
                <input value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} className="input-field mt-2" type="password" />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={createRoom} className="btn-primary">创建并进入</button>
            </div>
          </div>
        </section>

        <section className="glass-card space-y-4">
          <div className="section-title">加入房间</div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">输入房间 ID</label>
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={newId} onChange={(e) => setNewId(e.target.value)} className="input-field flex-1" />
              <button onClick={() => goToRoom()} className="btn-primary">进入</button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="section-title">可加入的房间</div>
            <div className="space-y-2">
              {rooms.length === 0 && <div className="muted text-sm">暂无房间（可以新建）</div>}
              {rooms.map((r: any) => (
                <div key={r.id} className="list-row">
                  <div>
                    <div className="font-medium">
                      {r.id}
                      {r.visibility === 'private' ? (
                        <span className="ml-2 pill gap-1">
                          <svg className="h-3 w-3" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M7 11V8a5 5 0 0110 0v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            <rect x="6.5" y="11" width="11" height="9" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                          </svg>
                          <span>私密</span>
                        </span>
                      ) : null}
                      {r.locked ? <span className="ml-2 pill">锁定</span> : null}
                    </div>
                    <div className="muted text-sm">{r.members} 人在线</div>
                  </div>
                  <button
                    disabled={!!r.joined}
                    onClick={() => goToRoom(r.id)}
                    className={r.joined ? 'btn-secondary' : 'btn-primary'}
                  >
                    {r.joined ? '已在房间' : '加入'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Join password modal */}
      {joinPrompt.open && (
        <div className="fixed inset-0 flex items-center justify-center modal-backdrop px-4">
          <div className="modal-card w-full max-w-md space-y-3">
            <h3 className="section-title">请输入房间密码</h3>
            <input value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} type="password" className="input-field" />
            <div className="flex flex-wrap gap-2 justify-end">
              <button onClick={() => setJoinPrompt({ open: false })} className="btn-secondary">取消</button>
              <button onClick={() => {
                const rid = joinPrompt.roomId;
                const s = (window as any).__roomsSocket;
                if (!rid) return;
                if (s && s.connected) {
                  const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
                  // store join intent so room page auto-join can reuse the password and avoid double prompt
                  try { sessionStorage.setItem(`room_join:${rid}`, JSON.stringify({ password: joinPassword, name: 'Guest' })); } catch (e) {}
                  s.emit('join-room', { roomId: rid, name: 'Guest', token, password: joinPassword }, (resp: any) => {
                    if (resp && resp.ok) {
                      setJoinPrompt({ open: false });
                      setJoinPassword('');
                      router.push(`/${rid}`);
                    } else {
                      try { alert(resp?.message || '密码错误'); } catch(_) {}
                      try { sessionStorage.removeItem(`room_join:${rid}`); } catch (e) {}
                    }
                  });
                } else {
                  try { alert('无法连接到实时服务器，无法加入房间，请稍后重试'); } catch (_) {}
                }
              }} className="btn-primary">提交并加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
