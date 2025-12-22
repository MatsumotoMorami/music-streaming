"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [rooms, setRooms] = useState<{ id: string; members: number; joined?: boolean }[]>([]);
  const [newId, setNewId] = useState("");
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

  function createRoom() {
    const id = Math.random().toString(36).slice(2, 9);
    router.push(`/${id}`);
  }

  function goToRoom(id?: string) {
    const rid = id || newId;
    if (!rid) return;
    router.push(`/${rid}`);
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-sans">
      <div className="mx-auto max-w-3xl bg-white p-6 rounded shadow">
        <h1 className="text-2xl font-semibold mb-4 text-black">房间列表</h1>

        <div className="mb-4">
          <button onClick={createRoom} className="px-4 py-2 bg-blue-600 text-white rounded">新建房间</button>
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
            {rooms.map((r) => (
              <li key={r.id} className="p-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{r.id}</div>
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
    </div>
  );
}
