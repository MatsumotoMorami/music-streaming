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

  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const io = (await import("socket.io-client")).io;
      const s = io("http://localhost:4000");
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

      s.on('room-state', (state: { url: string | null; playing: boolean; currentTime: number; updatedAt?: number }) => {
        if (!state) return;
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
    })();

    return () => {
      mounted = false;
      if (socket) socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-join when socket is ready and not yet joined
  useEffect(() => {
    if (socket && !joined) {
      const autoName = "Guest-" + Math.random().toString(36).slice(2, 6);
      setName(autoName);
      socket.emit("join-room", { roomId, name: autoName });
      setJoined(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket]);

  function joinRoom() {
    if (!socket || !roomId) return;
    socket.emit("join-room", { roomId, name: name || "Anonymous" });
    setJoined(true);
  }

  function setTrack() {
    if (!socket || !joined) return;
    socket.emit("set-track", { url: trackUrl });
    if (audioRef.current) {
      audioRef.current.src = trackUrl;
      audioRef.current.currentTime = 0;
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
              <label className="block text-sm">你的名字</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full border p-2" />
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

            <div className="flex items-center gap-2">
              <button onClick={handlePlay} className="px-3 py-2 bg-blue-600 text-white">播放</button>
              <button onClick={handlePause} className="px-3 py-2 bg-gray-300">暂停</button>
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

            <audio
              ref={audioRef}
              src={trackUrl}
              className="w-full mt-4"
              onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
              onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
