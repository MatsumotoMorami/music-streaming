"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

export default function RoomPage() {
  const params = useParams();
  const roomId = params?.roomId || "";

  const [socket, setSocket] = useState(null as any);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [trackUrl, setTrackUrl] = useState(
    "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
  );

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playlist, setPlaylist] = useState<Array<any>>([]);
  const [newTrackUrl, setNewTrackUrl] = useState('');
  const [newTrackTitle, setNewTrackTitle] = useState('');
  const [playMode, setPlayMode] = useState<'single'|'sequence'|'loop'|'shuffle'>('sequence');
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<any>>([]);
  const [searching, setSearching] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createVisibility, setCreateVisibility] = useState<'public'|'private'>('public');
  const [createPassword, setCreatePassword] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let s: any = null;
    (async () => {
      const io = (await import("socket.io-client")).io;
      s = io("http://localhost:4000");
      if (!mounted) return;
      setSocket(s);

      s.on("user-list", (list: string[]) => setUsers(list));

      s.on("set-track", ({ url }: { url: string }) => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = url;
          audioRef.current.currentTime = 0;
        }
        setTrackUrl(url);
      });

      s.on("play", ({ currentTime }) => {
        if (audioRef.current) {
          audioRef.current.currentTime = currentTime || 0;
          audioRef.current.play().catch(() => {});
        }
      });

      s.on("pause", ({ currentTime }) => {
        if (audioRef.current) {
          audioRef.current.currentTime = currentTime || audioRef.current.currentTime;
          audioRef.current.pause();
        }
      });

      s.on("seek", ({ currentTime }) => {
        if (audioRef.current) audioRef.current.currentTime = currentTime || 0;
        setCurrentTime(currentTime || 0);
      });

      s.on('room-state', (state: { url: string | null; playing: boolean; currentTime: number; updatedAt?: number; currentIndex?: number }) => {
        if (!state) return;
        if (typeof state.currentIndex === 'number') setCurrentIndex(state.currentIndex);
        const serverUpdated = state.updatedAt || Date.now();
        const now = Date.now();
        const deltaSec = Math.max(0, (now - serverUpdated) / 1000);
        const targetTime = (state.currentTime || 0) + (state.playing ? deltaSec : 0);

        if (state.url) {
          setTrackUrl(state.url);
          if (audioRef.current) {
            audioRef.current.src = state.url;
            audioRef.current.currentTime = targetTime;
          }
        }

        setCurrentTime(targetTime);

        if (state.playing) {
          setTimeout(() => {
            audioRef.current?.play().catch(() => {});
          }, 50);
        } else {
          audioRef.current?.pause();
        }
      });

      s.on('playlist-updated', (list: any[]) => {
        try { setPlaylist(list || []); } catch (_) {}
      });
      s.on('play-mode', (mode: string) => {
        try { if (mode) setPlayMode(mode as any); } catch (_) {}
      });

      // respond to server heartbeat so room liveness can be tracked
      s.on('heartbeat', (data: { ts?: number }) => {
        try { s.emit('heartbeat-pong', { ts: data?.ts || Date.now() }); } catch (e) {}
      });
      // server may return join-error if account already in room
      s.on('join-error', (err: { code?: string; message?: string }) => {
        try { alert(err?.message || '加入被拒绝'); } catch (_) {}
      });

      // Auto-join: try to join immediately when opening a room page.
      // If the server requires a password, show the password prompt; otherwise navigate once joined.
      try {
        const createKey = `room_create:${roomId}`;
        const joinKey = `room_join:${roomId}`;
        const storedCreate = typeof window !== 'undefined' ? sessionStorage.getItem(createKey) : null;
        const storedJoin = typeof window !== 'undefined' ? sessionStorage.getItem(joinKey) : null;
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        // derive a display name from token if available
        let autoName = 'Guest-' + Math.random().toString(36).slice(2, 6);
        try {
          if (token) {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(decodeURIComponent(escape(window.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))));
              if (payload && payload.email) autoName = payload.email.split('@')[0];
            }
          }
        } catch (_) {}

        const joinPayload: any = { roomId, name: autoName, token };
        // prefer join intent (from homepage join modal) over create intent
        const prefer = storedJoin || storedCreate;
        if (prefer) {
          try {
            const payload = JSON.parse(prefer || '{}');
            if (payload.visibility) joinPayload.visibility = payload.visibility;
            if (payload.password) joinPayload.password = payload.password;
          } catch (_) {}
        }

        s.emit('join-room', joinPayload, (resp: any) => {
          try { if (storedJoin) sessionStorage.removeItem(joinKey); if (storedCreate) sessionStorage.removeItem(createKey); } catch (e) {}
          if (resp && resp.ok) {
            setJoined(true);
            setShowCreateForm(false);
          } else {
            if (resp && resp.code === 'password-required') {
              setShowPasswordPrompt(true);
            } else {
              try { alert(resp?.message || '无法加入房间'); } catch (_) {}
            }
          }
        });
      } catch (e) {}
    })();

    return () => {
      mounted = false;
      try {
        if (s) {
          if (joined) {
            try { s.emit('leave-room', { roomId }); } catch (e) {}
          }
          s.disconnect();
        }
      } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When socket connects, set a default name but DO NOT auto-join.
  // Joining (and creating a private room) must be explicit so the user can choose visibility/password.
  useEffect(() => {
    if (socket && !joined) {
      let autoName = "Guest-" + Math.random().toString(36).slice(2, 6);
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
        if (token) {
          try {
            const parts = token.split('.');
            if (parts.length === 3) {
              const payload = JSON.parse(decodeURIComponent(escape(window.atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))));
              if (payload && payload.email) {
                autoName = payload.email.split('@')[0];
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
      setName(autoName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  function joinRoom() {
    if (!socket || !roomId) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      socket.emit("join-room", { roomId, name: name || "Anonymous", token, password: roomPassword || undefined }, (resp: any) => {
        if (resp && resp.ok) {
          setJoined(true);
          setShowPasswordPrompt(false);
        } else {
          if (resp && resp.code === 'password-required') {
            // server indicates room is private or password missing/incorrect
            setShowPasswordPrompt(true);
            try { alert(resp?.message || '此房间需要密码'); } catch (_) {}
          } else {
            try { alert(resp?.message || '无法加入房间'); } catch (_) {}
          }
          setJoined(false);
        }
      });
    } catch (e) {
      socket.emit("join-room", { roomId, name: name || "Anonymous", password: roomPassword || undefined });
      setJoined(true);
    }
  }

  // Explicitly create a room (choose visibility and password) then join it
  function createRoom() {
    if (!socket || !roomId) return;
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      socket.emit('join-room', { roomId, name: name || 'Anonymous', token, visibility: createVisibility, password: createVisibility === 'private' ? createPassword : undefined }, (resp: any) => {
        if (resp && resp.ok) {
          setJoined(true);
          setShowCreateForm(false);
        } else {
          try { alert(resp?.message || '无法创建房间'); } catch (_) {}
        }
      });
    } catch (e) {
      socket.emit('join-room', { roomId, name: name || 'Anonymous', visibility: createVisibility, password: createVisibility === 'private' ? createPassword : undefined });
      setJoined(true);
      setShowCreateForm(false);
    }
  }

  function setTrack() {
    if (!socket || !joined) return;
    socket.emit("set-track", { url: trackUrl });
    if (audioRef.current) {
      audioRef.current.src = trackUrl;
      audioRef.current.currentTime = 0;
    }
  }

  function addTrack() {
    if (!socket || !joined) return;
    const url = newTrackUrl.trim();
    const title = newTrackTitle.trim();
    if (!url) return;
    socket.emit('playlist-add', { url, title }, (resp: any) => {
      if (resp && resp.ok) {
        setNewTrackUrl(''); setNewTrackTitle('');
      } else {
        try { alert(resp?.message || '添加失败'); } catch (_) {}
      }
    });
  }

  async function doSearch() {
    if (!searchQuery || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`http://localhost:4001/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) { setSearchResults([]); setSearching(false); return; }
      const data = await res.json();
      setSearchResults(data.list || []);
    } catch (e) {
      setSearchResults([]);
    }
    setSearching(false);
  }

  function removeTrack(id: string) {
    if (!socket || !joined) return;
    socket.emit('playlist-remove', { id }, (resp: any) => {
      if (!resp || !resp.ok) {
        try { alert(resp?.message || '删除失败'); } catch (_) {}
      }
    });
  }

  function playFromPlaylist(item: any, idx: number) {
    if (!socket || !joined) return;
    socket.emit('set-current-index', idx, (resp: any) => {
      if (!resp || !resp.ok) try { alert(resp?.message || '无法播放'); } catch(_) {}
    });
  }

  function goNext() {
    if (!socket || !joined) return;
    socket.emit('playlist-next');
  }

  function goPrev() {
    if (!socket || !joined) return;
    socket.emit('playlist-prev');
  }

  function handleEnded() {
    // If we're joined to a room, let the server decide the next track
    if (socket && joined) {
      try { socket.emit('playlist-next'); } catch (_) {}
      return;
    }

    // Fallback local behavior when not joined to a room
    if (!playlist || playlist.length === 0) return;
    const idx = playlist.findIndex((p) => p.url === trackUrl);
    const len = playlist.length;
    if (playMode === 'single') {
      try { audioRef.current!.currentTime = 0; audioRef.current!.play().catch(() => {}); } catch (_) {}
      return;
    }
    let nextIdx = -1;
    if (playMode === 'sequence') {
      nextIdx = idx >= 0 ? idx + 1 : 0;
      if (!(nextIdx < len)) return;
    } else if (playMode === 'loop') {
      nextIdx = idx >= 0 ? (idx + 1) % len : 0;
    } else if (playMode === 'shuffle') {
      if (len === 1) nextIdx = 0;
      else {
        nextIdx = Math.floor(Math.random() * len);
        if (idx >= 0 && nextIdx === idx) nextIdx = (nextIdx + 1) % len;
      }
    }

    if (nextIdx >= 0 && nextIdx < len) {
      const item = playlist[nextIdx];
      try {
        setTrackUrl(item.url);
        if (audioRef.current) {
          audioRef.current.src = item.url;
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
        }
      } catch (_) {}
    }
  }

  function handlePlay() {
    if (!audioRef.current) return;
    audioRef.current.play();
    if (socket && joined) socket.emit("play", { currentTime: audioRef.current.currentTime });
  }

  function handlePause() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    if (socket && joined) socket.emit("pause", { currentTime: audioRef.current.currentTime });
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    if (!audioRef.current) return;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
    if (socket && joined) socket.emit("seek", { currentTime: t });
  }

  return (
    <div className="min-h-screen bg-zinc-50 p-6 text-sans">
      <div className="mx-auto max-w-3xl bg-white p-6 rounded shadow">
        <h1 className="text-2xl font-semibold mb-4 text-black">共享音乐房间</h1>

        {!joined ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm text-zinc-600">加入时的显示名</div>
              <div className="font-medium">{name || 'Guest'}</div>
            </div>

            <div>
              <div className="flex gap-2">
                <button onClick={joinRoom} className="px-3 bg-blue-600 text-white">加入房间 {roomId}</button>
                <button onClick={() => setShowCreateForm((v) => !v)} className="px-3 bg-emerald-600 text-white">创建房间</button>
              </div>

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
                      <input type="password" placeholder="设置房间密码" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} className="mt-1 w-full border p-2" />
                    </div>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button onClick={createRoom} className="px-3 bg-indigo-600 text-white">创建并加入</button>
                    <button onClick={() => setShowCreateForm(false)} className="px-3 bg-gray-200">取消</button>
                  </div>
                </div>
              )}

              {showPasswordPrompt ? (
                <div className="mt-3">
                  <label className="block text-sm">此房间为私密房间，请输入密码</label>
                  <div className="flex gap-2 mt-1">
                    <input type="password" placeholder="房间密码" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} className="flex-1 border p-2" />
                    <button onClick={joinRoom} className="px-3 bg-blue-600 text-white">提交密码并加入</button>
                  </div>
                </div>
              ) : null}
            </div>

            <div>
              <div className="flex gap-2 mt-1">
                <button onClick={joinRoom} className="px-3 bg-blue-600 text-white">加入房间 {roomId}</button>
              </div>
            </div>

            <p className="text-sm text-zinc-800">加入后你会与房间的播放状态同步</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-zinc-600">房间</div>
                <div className="font-medium">{roomId}</div>
              </div>
              <div>
                <div className="text-sm text-zinc-600">在线</div>
                <div className="font-medium">{users.length}</div>
              </div>
            </div>

            <div>
              <label className="block text-sm">音频 URL</label>
              <div className="flex gap-2 mt-1">
                <input value={trackUrl} onChange={(e) => setTrackUrl(e.target.value)} className="flex-1 border p-2" />
                <button onClick={setTrack} className="px-3 bg-green-600 text-white">设置</button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-sm">播放模式</div>
              <select disabled={!joined} value={playMode} onChange={(e) => {
                const v = e.target.value as any;
                setPlayMode(v);
                try { socket?.emit('set-play-mode', v); } catch (_) {}
              }} className="border p-2">
                <option value="single">单曲循环</option>
                <option value="sequence">顺序播放</option>
                <option value="loop">按顺序循环</option>
                <option value="shuffle">随机播放</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={handlePlay} className="px-3 py-2 bg-blue-600 text-white">播放</button>
              <button onClick={handlePause} className="px-3 py-2 bg-gray-300">暂停</button>
              <button onClick={goPrev} className="px-3 py-2 bg-indigo-500 text-white">上一首</button>
              <button onClick={goNext} className="px-3 py-2 bg-indigo-500 text-white">下一首</button>
              <div className="flex-1">
                <input
                  type="range"
                  min={0}
                  max={Math.floor(duration) || 0}
                  value={Math.floor(currentTime)}
                  onChange={handleSeek}
                  onMouseUp={() => {
                    if (socket && joined) socket.emit("seek", { currentTime });
                  }}
                  onTouchEnd={() => {
                    if (socket && joined) socket.emit("seek", { currentTime });
                  }}
                  className="w-full"
                />
              </div>
            </div>

            <div>
              <div className="text-sm font-medium">房间成员</div>
              <ul className="mt-2 list-disc list-inside">
                {users.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-sm font-medium">房间歌单</div>
              <div className="mt-2 space-y-2">
                <div className="flex gap-2">
                  <input placeholder="音频 URL" value={newTrackUrl} onChange={(e) => setNewTrackUrl(e.target.value)} className="flex-1 border p-2" />
                  <input placeholder="标题（可选）" value={newTrackTitle} onChange={(e) => setNewTrackTitle(e.target.value)} className="w-48 border p-2" />
                  <button disabled={!joined} onClick={addTrack} className="px-3 bg-indigo-600 text-white">添加</button>
                </div>

                <div className="mt-2">
                  <div className="flex gap-2">
                    <input placeholder="搜索网易云曲目（关键词）" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 border p-2" />
                    <button onClick={doSearch} disabled={searching} className="px-3 bg-emerald-600 text-white">搜索</button>
                  </div>
                  <div className="mt-2">
                    {searching && <div className="text-sm text-zinc-600">搜索中...</div>}
                    {!searching && searchResults.length > 0 && (
                      <ul className="divide-y">
                        {searchResults.map((r, i) => (
                          <li key={r.id || i} className="p-2 flex items-center justify-between">
                            <div>
                              <div className="font-medium">{r.name} — {r.artists}</div>
                              <div className="text-sm text-zinc-600">{r.album}</div>
                            </div>
                            <div>
                              <button disabled={!joined} onClick={() => { if (socket && joined) socket.emit('playlist-add', { url: r.src, title: `${r.name} — ${r.artists}` }); }} className="px-3 py-1 bg-blue-600 text-white rounded">添加</button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <ul className="mt-2 divide-y">
                  {playlist.length === 0 && <li className="p-2 text-sm text-zinc-600">歌单为空</li>}
                  {playlist.map((it, idx) => (
                    <li key={it.id || idx} className={`p-2 flex items-center justify-between ${currentIndex === idx ? 'bg-yellow-50' : ''}`}>
                      <div>
                        <div className="font-medium">{it.title || it.url}</div>
                        <div className="text-sm text-zinc-600">{it.addedBy} • {new Date(it.ts || Date.now()).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => playFromPlaylist(it, idx)} className="px-2 py-1 bg-green-600 text-white rounded">播放</button>
                        <button onClick={() => removeTrack(it.id)} className="px-2 py-1 bg-red-600 text-white rounded">删除</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <audio
              ref={audioRef}
              src={trackUrl}
              className="w-full mt-4"
              onEnded={handleEnded}
              onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
