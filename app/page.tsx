"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [rooms, setRooms] = useState<{ id: string; members: number }[]>([]);
  const [newId, setNewId] = useState("");
  const router = useRouter();

  async function fetchRooms() {
    try {
      const res = await fetch("http://localhost:4001/rooms");
      if (!res.ok) return;
      const data = await res.json();
      setRooms(data);
    } catch (e) {
      console.warn("failed to fetch rooms", e);
    }
  }

  useEffect(() => {
    fetchRooms();
    const t = setInterval(fetchRooms, 3000);
    return () => clearInterval(t);
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
                  <button onClick={() => goToRoom(r.id)} className="px-3 py-1 bg-blue-600 text-white rounded">加入</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
