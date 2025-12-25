"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";

export default function RoomPage() {
  const params = useParams();
  const roomId = params?.roomId || "";

  const [socket, setSocket] = useState(null as any);
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [trackUrl, setTrackUrl] = useState("");

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playlist, setPlaylist] = useState<Array<any>>([]);
  const [playlistFilter, setPlaylistFilter] = useState('');
  const [newTrackUrl, setNewTrackUrl] = useState('');
  const [newTrackTitle, setNewTrackTitle] = useState('');
  const [playMode, setPlayMode] = useState<'single'|'sequence'|'loop'|'shuffle'>('sequence');
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<any>>([]);
  const [searching, setSearching] = useState(false);
  const [importPlaylistId, setImportPlaylistId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [roomPassword, setRoomPassword] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createVisibility, setCreateVisibility] = useState<'public'|'private'>('public');
  const [createPassword, setCreatePassword] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [autoCreateIntent, setAutoCreateIntent] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const autoJoinRef = useRef(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAdvancedAdd, setShowAdvancedAdd] = useState(false);
  const [roomLocked, setRoomLocked] = useState(false);
  const [roomVisibility, setRoomVisibility] = useState<'public'|'private'>('public');
  const [visibilityDraft, setVisibilityDraft] = useState<'public'|'private'>('public');
  const [visibilityPassword, setVisibilityPassword] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);

  const currentTrack =
    (typeof currentIndex === 'number' && currentIndex >= 0 ? playlist[currentIndex] : null) ||
    playlist.find((p) => p.url === trackUrl) ||
    null;
  const currentTitle = currentTrack?.title || currentTrack?.url || trackUrl || '暂无播放';
  const filteredPlaylist = playlistFilter.trim()
    ? playlist.filter((item) => {
        const title = String(item?.title || '').toLowerCase();
        const url = String(item?.url || '').toLowerCase();
        const query = playlistFilter.trim().toLowerCase();
        return title.includes(query) || url.includes(query);
      })
    : playlist;

  function formatTime(sec: number) {
    if (!Number.isFinite(sec)) return '00:00';
    const clamped = Math.max(0, Math.floor(sec));
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let mounted = true;
    let s: any = null;
    (async () => {
      const io = (await import("socket.io-client")).io;
      const base = window.location.origin;
      s = io(base, { path: '/ws/socket.io' });
      if (!mounted) return;
      setSocket(s);

      s.on("user-list", (list: string[]) => setUsers(list));
      s.on("connect", () => setSocketReady(true));
      s.on("disconnect", () => setSocketReady(false));

      s.on("set-track", ({ url }: { url: string }) => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = url;
          audioRef.current.currentTime = 0;
        }
        setTrackUrl(url);
      });

      s.on("play", ({ currentTime }: { currentTime?: number }) => {
        if (audioRef.current) {
          audioRef.current.currentTime = currentTime || 0;
          audioRef.current.play().catch(() => {});
        }
        setIsPlaying(true);
      });

      s.on("pause", ({ currentTime }: { currentTime?: number }) => {
        if (audioRef.current) {
          audioRef.current.currentTime = currentTime || audioRef.current.currentTime;
          audioRef.current.pause();
        }
        setIsPlaying(false);
      });

      s.on("seek", ({ currentTime }: { currentTime?: number }) => {
        if (audioRef.current) audioRef.current.currentTime = currentTime || 0;
        setCurrentTime(currentTime || 0);
      });

      s.on('room-state', (state: { url: string | null; playing: boolean; currentTime: number; updatedAt?: number; currentIndex?: number; locked?: boolean; visibility?: 'public'|'private' }) => {
        if (!state) return;
        if (typeof state.currentIndex === 'number') setCurrentIndex(state.currentIndex);
        if (typeof state.locked === 'boolean') setRoomLocked(state.locked);
        if (state.visibility === 'public' || state.visibility === 'private') {
          setRoomVisibility(state.visibility);
          setVisibilityDraft(state.visibility);
        }
        if (typeof state.playing === 'boolean') setIsPlaying(state.playing);
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
      s.on('room-lock', ({ locked }: { locked?: boolean }) => {
        if (typeof locked === 'boolean') setRoomLocked(locked);
      });
      s.on('room-visibility', ({ visibility }: { visibility?: 'public'|'private' }) => {
        if (visibility === 'public' || visibility === 'private') {
          setRoomVisibility(visibility);
          setVisibilityDraft(visibility);
        }
      });

      // respond to server heartbeat so room liveness can be tracked
      s.on('heartbeat', (data: { ts?: number }) => {
        try { s.emit('heartbeat-pong', { ts: data?.ts || Date.now() }); } catch (e) {}
      });
      // server may return join-error if account already in room
      s.on('join-error', (err: { code?: string; message?: string }) => {
        try { alert(err?.message || '加入被拒绝'); } catch (_) {}
      });

      const attemptAutoJoin = () => {
        if (!roomId || autoJoinRef.current) return;
        autoJoinRef.current = true;
        try {
          const createKey = `room_create:${roomId}`;
          const joinKey = `room_join:${roomId}`;
          const storedCreate = typeof window !== 'undefined' ? sessionStorage.getItem(createKey) : null;
          const storedJoin = typeof window !== 'undefined' ? sessionStorage.getItem(joinKey) : null;
          const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
          if (storedCreate) setAutoCreateIntent(true);
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

          setJoining(true);
          setJoinError(null);
          const timeoutId = setTimeout(() => {
            if (!mounted) return;
            setJoining(false);
            setJoinError('连接超时，请重试');
          }, 5000);
          s.emit('join-room', joinPayload, (resp: any) => {
            clearTimeout(timeoutId);
            if (!mounted) return;
            setJoining(false);
            try { if (storedJoin) sessionStorage.removeItem(joinKey); if (storedCreate) sessionStorage.removeItem(createKey); } catch (e) {}
            if (resp && resp.ok) {
              setJoined(true);
              setShowCreateForm(false);
              setAutoCreateIntent(false);
            } else {
              if (resp && resp.code === 'password-required') {
                setShowPasswordPrompt(true);
                setJoinError(resp?.message || '此房间需要密码');
              } else {
                setJoinError(resp?.message || '无法加入房间');
              }
            }
          });
        } catch (e) {}
      };

      // Auto-join only after socket connected to avoid silent timeouts.
      if (s.connected) {
        attemptAutoJoin();
      } else {
        s.once("connect", attemptAutoJoin);
      }
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
    if (!socket.connected) {
      setJoinError('未连接到实时服务器');
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      socket.emit("join-room", { roomId, name: name || "Anonymous", token, password: roomPassword || undefined }, (resp: any) => {
        setJoining(false);
        if (resp && resp.ok) {
          setJoined(true);
          setShowPasswordPrompt(false);
          setJoinError(null);
        } else {
          if (resp && resp.code === 'password-required') {
            // server indicates room is private or password missing/incorrect
            setShowPasswordPrompt(true);
            setJoinError(resp?.message || '此房间需要密码');
          } else {
            setJoinError(resp?.message || '无法加入房间');
          }
          setJoined(false);
        }
      });
    } catch (e) {
      setJoining(false);
      setJoinError('无法连接到实时服务器');
    }
  }

  // Explicitly create a room (choose visibility and password) then join it
  function createRoom() {
    if (!socket || !roomId) return;
    if (!socket.connected) {
      setJoinError('未连接到实时服务器');
      return;
    }
    setJoining(true);
    setJoinError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
      socket.emit('join-room', { roomId, name: name || 'Anonymous', token, visibility: createVisibility, password: createVisibility === 'private' ? createPassword : undefined }, (resp: any) => {
        setJoining(false);
        if (resp && resp.ok) {
          setJoined(true);
          setShowCreateForm(false);
          setAutoCreateIntent(false);
        } else {
          setJoinError(resp?.message || '无法创建房间');
        }
      });
    } catch (e) {
      setJoining(false);
      setJoinError('无法连接到实时服务器');
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
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) { setSearchResults([]); setSearching(false); return; }
      const data = await res.json();
      setSearchResults(data.list || []);
    } catch (e) {
      setSearchResults([]);
    }
    setSearching(false);
  }

  function formatArtists(list: any) {
    if (!list || !Array.isArray(list)) return '';
    return list.map((a) => a?.name || a).filter(Boolean).join(', ');
  }

  function parsePlaylistId(input: string) {
    const raw = input.trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    const match = raw.match(/(?:\?|&|#)id=(\d+)/i) || raw.match(/playlist\?id=(\d+)/i);
    if (match && match[1]) return Number(match[1]);
    return null;
  }

  async function importPlaylist() {
    if (!socket || !joined) return;
    const id = parsePlaylistId(importPlaylistId);
    if (!Number.isFinite(id as number) || (id as number) <= 0) {
      setImportError('请输入正确的歌单 ID');
      return;
    }
    setImportError(null);
    setImportStatus(null);
    setImporting(true);
    try {
      const batchSize = 1000;
      let totalImported = 0;
      let currentOffset = 0;
      let total = null as number | null;
      while (true) {
        const params = new URLSearchParams({
          id: String(id),
          limit: String(batchSize),
          offset: String(currentOffset),
        });
        const res = await fetch(`/api/playlist/track/all?${params.toString()}`);
        if (!res.ok) {
          setImportError('导入失败，请稍后再试');
          break;
        }
        const data = await res.json();
        if (typeof data?.total === 'number') total = data.total;
        const songs = Array.isArray(data?.songs)
          ? data.songs
          : (Array.isArray(data?.playlist?.tracks) ? data.playlist.tracks : []);
        if (!songs.length) break;
        const batch = songs.map((song: any) => {
          const songId = song?.id;
          const name = song?.name || '';
          const artists = formatArtists(song?.ar || song?.artists || []);
          const title = artists ? `${name} — ${artists}` : name || String(songId || '');
          const url = song?.url || (songId ? `https://music.163.com/song/media/outer/url?id=${songId}.mp3` : '');
          const cover = song?.al?.picUrl || song?.album?.picUrl || song?.picUrl || null;
          if (!url) return null;
          return { url, title, cover };
        }).filter(Boolean);
        if (batch.length) {
          socket.emit('playlist-add-batch', batch, (resp: any) => {
            if (!resp || !resp.ok) {
              setImportError(resp?.message || '导入失败');
            }
          });
        }
        totalImported += songs.length;
        setImportStatus(`已导入 ${totalImported}${total ? ` / ${total}` : ''} 首歌曲`);
        currentOffset += songs.length;
        if (songs.length === 0) break;
        if (total !== null && currentOffset >= total) break;
      }
      if (totalImported > 0) setImportPlaylistId('');
    } catch (e) {
      setImportError('导入失败，请检查网络或接口');
    }
    setImporting(false);
  }

  function clearPlaylist() {
    if (!socket || !joined) return;
    if (!playlist.length) return;
    const ok = window.confirm('确认清空当前房间歌单？');
    if (!ok) return;
    playlist.forEach((item) => {
      if (item?.id) socket.emit('playlist-remove', { id: item.id });
    });
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
    setIsPlaying(true);
  }

  function handlePause() {
    if (!audioRef.current) return;
    audioRef.current.pause();
    if (socket && joined) socket.emit("pause", { currentTime: audioRef.current.currentTime });
    setIsPlaying(false);
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    if (!audioRef.current) return;
    audioRef.current.currentTime = t;
    setCurrentTime(t);
    if (socket && joined) socket.emit("seek", { currentTime: t });
  }

  const playModeIcons: Record<string, { label: string; icon: ReactNode }> = {
    single: {
      label: '单曲循环',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 7h8a4 4 0 1 1 0 8H9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M7 7l2-2m-2 2l2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M11.8 10.2h1.4v3.6m0 0h-1.4m1.4 0h-1.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    sequence: {
      label: '顺序播放',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h10m0 0l-2-2m2 2l-2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4 17h10m0 0l-2-2m2 2l-2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    loop: {
      label: '循环播放',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 8h9a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M6 8l2-2m-2 2l2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M8 16l-2 2m2-2l-2-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
    shuffle: {
      label: '随机播放',
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h4l6 10h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14 7h6m0 0l-2-2m2 2l-2 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M10 17H4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ),
    },
  };

  return (
    <div className="page-container space-y-6">
      <section className="hero-card">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <p className="kicker">room sync</p>
            <h1 className="hero-title">共享音乐房间</h1>
            <p className="hero-subtitle">房间 ID: {roomId || '未命名'}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="pill">{joined ? '已加入' : '未加入'}</span>
            <span className="muted text-sm">在线 {users.length}</span>
            {joined && (
              <button
                className="btn-outline"
                onClick={() => {
                  if (!socket || !joined) return;
                  socket.emit('set-room-locked', { roomId, locked: !roomLocked }, (resp: any) => {
                    if (resp && typeof resp.locked === 'boolean') setRoomLocked(resp.locked);
                  });
                }}
              >
                {roomLocked ? '已锁定' : '锁定'}
              </button>
            )}
          </div>
        </div>
        {joined && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-400">房间可见性</span>
            <select
              value={visibilityDraft}
              onChange={(e) => setVisibilityDraft(e.target.value as 'public'|'private')}
              className="select-field"
            >
              <option value="public">公开</option>
              <option value="private">私密</option>
            </select>
            {visibilityDraft === 'private' && (
              <input
                type="password"
                placeholder="设置新密码"
                value={visibilityPassword}
                onChange={(e) => setVisibilityPassword(e.target.value)}
                className="input-field"
              />
            )}
            <button
              className="btn-secondary"
              onClick={() => {
                if (!socket || !joined) return;
                if (visibilityDraft === 'private' && !visibilityPassword.trim()) {
                  try { alert('请设置私密房间密码'); } catch (_) {}
                  return;
                }
                socket.emit('set-room-visibility', {
                  roomId,
                  visibility: visibilityDraft,
                  password: visibilityDraft === 'private' ? visibilityPassword : undefined,
                }, (resp: any) => {
                  if (resp && resp.ok) {
                    setRoomVisibility(resp.visibility || visibilityDraft);
                    setVisibilityDraft(resp.visibility || visibilityDraft);
                    setVisibilityPassword('');
                  } else {
                    try { alert(resp?.message || '无法更新房间可见性'); } catch (_) {}
                  }
                });
              }}
            >
              保存
            </button>
            {roomVisibility !== visibilityDraft && (
              <span className="muted text-xs">未保存</span>
            )}
          </div>
        )}
      </section>

      <div className="glass-card space-y-6">
        {!joined ? (
          <div className="space-y-4">
            {autoCreateIntent && (
              <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="section-title">正在创建并进入房间…</div>
                <p className="muted text-sm">创建完成后会自动进入控制台。</p>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">加入时的显示名</div>
              <div className="mt-2 text-lg font-medium">{name || 'Guest'}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={joinRoom} className="btn-primary" disabled={joining}>加入房间 {roomId}</button>
              <button onClick={() => setShowCreateForm((v) => !v)} className="btn-secondary" disabled={joining}>创建房间</button>
            </div>

            {showCreateForm && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
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
                    <input type="password" placeholder="设置房间密码" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} className="input-field mt-2" />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={createRoom} className="btn-primary" disabled={joining}>创建并加入</button>
                  <button onClick={() => setShowCreateForm(false)} className="btn-secondary" disabled={joining}>取消</button>
                </div>
              </div>
            )}

            {showPasswordPrompt ? (
              <div className="space-y-2">
                <label className="text-sm text-slate-300">此房间为私密房间，请输入密码</label>
                <div className="flex flex-wrap gap-2">
                  <input type="password" placeholder="房间密码" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} className="input-field flex-1" />
                  <button onClick={joinRoom} className="btn-primary" disabled={joining}>提交密码并加入</button>
                </div>
              </div>
            ) : null}

            {joinError && <p className="text-sm text-rose-200">{joinError}</p>}
            <p className="muted text-sm">加入后你会与房间的播放状态同步。</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:justify-evenly lg:gap-2">
              <div className="flex items-center lg:justify-center">
                {currentTrack?.cover ? (
                  <img
                    src={currentTrack.cover}
                    alt=""
                    className="h-40 w-40 rounded-2xl object-cover shadow-md"
                  />
                ) : (
                  <div className="h-40 w-40 rounded-2xl bg-slate-700/60" />
                )}
              </div>
              <div className="space-y-3 lg:flex lg:flex-col lg:justify-between">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-400">当前歌曲</label>
                  <div className="mt-2 scroll-title text-lg font-medium">{currentTitle}</div>
                </div>
                <div className="flex items-center gap-3 lg:justify-center">
                  <button onClick={goPrev} className="mode-btn media-btn" aria-label="上一首">
                    <span className="mode-icon">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 6v12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M18 7.5l-8 4.5 8 4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  <button
                    onClick={() => (isPlaying ? handlePause() : handlePlay())}
                    className="mode-btn media-btn media-btn-primary"
                    aria-label={isPlaying ? '暂停' : '播放'}
                  >
                    <span className="mode-icon">
                      {isPlaying ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M8 6v12M16 6v12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 7l9 5-9 5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                  </button>
                  <button onClick={goNext} className="mode-btn media-btn" aria-label="下一首">
                    <span className="mode-icon">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M17 6v12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        <path d="M6 7.5l8 4.5-8 4.5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                </div>
              </div>
              <div className="space-y-3 lg:min-w-[360px] lg:flex lg:flex-col lg:justify-between">
                <div>
                  <label className="text-xs uppercase tracking-[0.2em] text-slate-400">播放模式</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['single', 'sequence', 'loop', 'shuffle'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        disabled={!joined}
                        aria-label={playModeIcons[mode].label}
                        title={playModeIcons[mode].label}
                        onClick={() => {
                          setPlayMode(mode);
                          try { socket?.emit('set-play-mode', mode); } catch (_) {}
                        }}
                        className={`mode-btn ${playMode === mode ? 'mode-btn-active' : ''}`}
                      >
                        <span className="mode-icon">{playModeIcons[mode].icon}</span>
                        <span className="mode-label">{playModeIcons[mode].label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-[220px]">
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
                    className="w-full accent-sky-400"
                  />
                  <div className="mt-1 text-xs text-slate-400">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="section-title">房间成员</div>
              <div className="mt-2 space-y-2">
                {users.length === 0 && <div className="muted text-sm">暂无成员</div>}
                {users.map((u, i) => (
                  <div key={i} className="list-row">
                    <span>{u}</span>
                    <span className="muted text-xs">在线</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="section-title">房间歌单 <span className="muted text-sm">({playlist.length} 首)</span></div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setShowAddModal(true)} className="btn-primary">添加歌曲</button>
                <button onClick={clearPlaylist} disabled={!playlist.length} className="btn-danger">清空歌单</button>
                <input
                  placeholder="筛选歌单"
                  value={playlistFilter}
                  onChange={(e) => setPlaylistFilter(e.target.value)}
                  className="select-field"
                />
              </div>

              <div className="space-y-2">
                {playlist.length === 0 && <div className="muted text-sm">歌单为空</div>}
                {playlist.length > 0 && filteredPlaylist.length === 0 && <div className="muted text-sm">未找到匹配歌曲</div>}
                {filteredPlaylist.map((it, idx) => (
                  <div key={it.id || idx} className={`list-row ${currentIndex === idx ? 'ring-1 ring-emerald-400/40' : ''}`}>
                    <div className="min-w-0">
                      <div className="font-medium truncate max-w-[320px]">{it.title || it.url}</div>
                      <div className="muted text-sm">{it.addedBy} • {new Date(it.ts || Date.now()).toLocaleString()}</div>
                    </div>
                    <div className="ml-auto flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <button
                        onClick={() => playFromPlaylist(it, idx)}
                        className="brand-mark"
                        aria-label="播放"
                        title="播放"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                          <path d="M12 5v9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <path d="M12 5c3 1.2 4.5 2.6 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <circle cx="10.2" cy="17.3" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
                        </svg>
                      </button>
                      <button
                        onClick={() => removeTrack(it.id)}
                        className="brand-mark"
                        aria-label="删除"
                        title="删除"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                          <path d="M4 7h16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <path d="M9 7l1-2h4l1 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          <path d="M8 10v7M12 10v7M16 10v7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {trackUrl ? (
              <audio
                ref={audioRef}
                src={trackUrl}
                className="w-full"
                onEnded={handleEnded}
                onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
                onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
              />
            ) : (
              <div className="muted text-sm">暂无可播放的音频</div>
            )}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 flex items-center justify-center modal-backdrop px-4">
          <div className="modal-card w-full max-w-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="section-title">添加歌曲</div>
              <button onClick={() => setShowAddModal(false)} className="btn-secondary">关闭</button>
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input placeholder="搜索网易云曲目（关键词）" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="input-field flex-1" />
                  <button onClick={doSearch} disabled={searching} className="btn-secondary">搜索</button>
                </div>
                <div className="space-y-2">
                  {searching && <div className="muted text-sm">搜索中...</div>}
                  {!searching && searchResults.length > 0 && (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {searchResults.map((r, i) => (
                        <div key={r.id || i} className="list-row">
                          <div>
                            <div className="font-medium">{r.name} — {r.artists}</div>
                            <div className="muted text-sm">{r.album}</div>
                          </div>
                          <button
                            disabled={!joined}
                            onClick={() => {
                              if (socket && joined) socket.emit('playlist-add', { url: r.src, title: `${r.name} — ${r.artists}`, cover: r.cover || null });
                            }}
                            className="btn-outline"
                          >
                            添加
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-100">导入网易云歌单</div>
                <div className="flex flex-wrap gap-2">
                  <input placeholder="歌单 ID 或含分享链接的文本" value={importPlaylistId} onChange={(e) => setImportPlaylistId(e.target.value)} className="input-field flex-1" />
                  <button onClick={importPlaylist} disabled={!joined || importing} className="btn-secondary">
                    {importing ? '导入中...' : '导入'}
                  </button>
                </div>
                {importError && <div className="text-sm text-rose-300">{importError}</div>}
                {importStatus && <div className="text-sm text-emerald-300">{importStatus}</div>}
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowAdvancedAdd((v) => !v)}
                  className="disclosure"
                >
                  <span className={`disclosure-icon ${showAdvancedAdd ? 'disclosure-open' : ''}`} aria-hidden="true">▸</span>
                  <span>高级选项</span>
                </button>
                {showAdvancedAdd && (
                  <div className="flex flex-wrap gap-2">
                    <input placeholder="音频 URL" value={newTrackUrl} onChange={(e) => setNewTrackUrl(e.target.value)} className="input-field flex-1" />
                    <input placeholder="标题（可选）" value={newTrackTitle} onChange={(e) => setNewTrackTitle(e.target.value)} className="input-field w-48" />
                    <button
                      disabled={!joined}
                      onClick={() => {
                        addTrack();
                      }}
                      className="btn-primary"
                    >
                      添加
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
