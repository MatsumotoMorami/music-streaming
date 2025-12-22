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
    <div className="min-h-screen bg-zinc-50 p-6 text-sans">
      <div className="mx-auto max-w-3xl bg-white p-6 rounded shadow">
        <h1 className="text-2xl font-semibold mb-4 text-black">房间列表</h1>

        <div className="mb-4">
          <button onClick={() => setShowCreateForm((v) => !v)} className="px-4 py-2 bg-blue-600 text-white rounded">新建房间</button>
          {showCreateForm && (
            <div className="mt-3 p-3 border rounded">
              <div>
                <label className="block text-sm">可见性</label>
                <select value={createVisibility} onChange={(e) => setCreateVisibility(e.target.value as any)} className="mt-1 border p-2">
                  <option value="public">公开</option>
                  <option value="private">私密（需要密码）</option>
                </select>
              </div>
              {createVisibility === 'private' && (
                <div className="mt-2">
                  <label className="block text-sm">房间密码</label>
                  <input value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} className="mt-1 w-full border p-2" type="password" />
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={createRoom} className="px-3 bg-indigo-600 text-white">创建并进入</button>
                <button onClick={() => setShowCreateForm(false)} className="px-3 bg-gray-200">取消</button>
              </div>
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-sm">输入房间 ID 并前往</label>
          <div className="flex gap-2 mt-1">
            <input value={newId} onChange={(e) => setNewId(e.target.value)} className="flex-1 border p-2" />
            <button onClick={() => goToRoom()} className="px-3 bg-green-600 text-white">进入</button>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-2">可加入的房间</div>
          <ul className="divide-y">
            {rooms.length === 0 && <li className="p-2 text-sm text-zinc-600">暂无房间（可以新建）</li>}
            {rooms.map((r: any) => (
              <li key={r.id} className="p-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{r.id} {r.visibility === 'private' ? <span className="ml-2 text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">私密</span> : null}</div>
                  <div className="text-sm text-zinc-600">{r.members} 人在线</div>
                </div>
                <div>
                  <button disabled={!!r.joined} onClick={() => goToRoom(r.id)} className={`px-3 py-1 ${r.joined ? 'bg-gray-300' : 'bg-blue-600'} text-white rounded`}>
                    {r.joined ? '已在房间' : '加入'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {/* Join password modal */}
      {joinPrompt.open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white p-4 rounded shadow max-w-md w-full">
            <h3 className="font-medium mb-2">请输入房间密码</h3>
            <input value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} type="password" className="w-full border p-2" />
            <div className="mt-3 flex gap-2 justify-end">
              <button onClick={() => setJoinPrompt({ open: false })} className="px-3 bg-gray-200">取消</button>
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
              }} className="px-3 bg-blue-600 text-white">提交并加入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
