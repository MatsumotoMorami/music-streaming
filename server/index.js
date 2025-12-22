import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import cookie from 'cookie';
import { PrismaClient } from '@prisma/client';

const PORT = process.env.PORT || 4000;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Prisma client for SQLite
const prisma = new PrismaClient();

// NOTE: users are now stored in SQLite via Prisma. previous JSON file is not migrated.

// nodemailer transport (use SMTP env or ethereal for dev)
let mailerPromise = null;
async function getTransport() {
  if (mailerPromise) return mailerPromise;
  if (process.env.SMTP_HOST && process.env.SMTP_PORT) {
    mailerPromise = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      logger: true,
      debug: true,
    });
    return mailerPromise;
  }
  // fallback: ethereal test account
  const testAccount = await nodemailer.createTestAccount();
  mailerPromise = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
    logger: true,
    debug: true,
  });
  return mailerPromise;
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-please-change';

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const rooms = {}; // { roomId: { members: { socketId: name }, state: { url, playing, currentTime } } }
const roomsSubscribers = new Set(); // socket ids that subscribed to rooms list

function sendRoomsToSocket(s) {
  try {
    const now = Date.now();
    const email = s.data && s.data.email;
    const list = Object.keys(rooms).map((id) => {
      const room = rooms[id];
      let active = 0;
      for (const sid of Object.keys(room.members)) {
        const sock = io.sockets.sockets.get(sid);
        if (sock && sock.connected && sock.data && sock.data.lastSeen && (now - sock.data.lastSeen) < 5000) active++;
      }
      return { id, members: active, url: room.state?.url || null, playing: room.state?.playing || false, joined: !!(email && room.byEmail && room.byEmail[email]), visibility: room.visibility || 'public' };
    }).filter((r) => r.members > 0);
    // diff against previous snapshot stored on the socket
    const prevMap = s.data.roomsSnapshot || {};
    // first time subscription: send full list
    if (!prevMap || Object.keys(prevMap).length === 0) {
      const map = {};
      list.forEach((r) => { map[r.id] = JSON.stringify({ members: r.members, url: r.url, playing: r.playing, joined: r.joined }); });
      s.data.roomsSnapshot = map;
      s.emit('rooms-list', list);
      return;
    }

    const newMap = {};
    list.forEach((r) => { newMap[r.id] = JSON.stringify({ members: r.members, url: r.url, playing: r.playing, joined: r.joined }); });

    const added = [];
    const updated = [];
    const removed = [];

    for (const id of Object.keys(newMap)) {
      if (!prevMap[id]) added.push(list.find((x) => x.id === id));
      else if (prevMap[id] !== newMap[id]) updated.push(list.find((x) => x.id === id));
    }
    for (const id of Object.keys(prevMap)) {
      if (!newMap[id]) removed.push(id);
    }

    if (added.length || updated.length || removed.length) {
      s.emit('rooms-diff', { added, updated, removed });
      s.data.roomsSnapshot = newMap;
    }
  } catch (e) {
    // ignore
  }
}

function broadcastRoomsToSubscribers() {
  for (const sid of Array.from(roomsSubscribers)) {
    const s = io.sockets.sockets.get(sid);
    if (!s || !s.connected) { roomsSubscribers.delete(sid); continue; }
    sendRoomsToSocket(s);
  }
}

io.on('connection', (socket) => {
  // allow a client to subscribe to rooms list; it may pass token in payload
  socket.on('subscribe-rooms', ({ token } = {}) => {
    try {
      if (token) {
        try { const payload = jwt.verify(token, JWT_SECRET); if (payload && payload.email) socket.data.email = payload.email; } catch (__) {}
      }
      roomsSubscribers.add(socket.id);
      sendRoomsToSocket(socket);
    } catch (e) {}
  });

  socket.on('unsubscribe-rooms', () => { roomsSubscribers.delete(socket.id); });
  let currentRoom = null;
  socket.data.lastSeen = Date.now();

  // update lastSeen on any incoming event
  socket.onAny(() => {
    socket.data.lastSeen = Date.now();
  });

  // explicit heartbeat pong from client
  socket.on('heartbeat-pong', () => {
    socket.data.lastSeen = Date.now();
  });

  // explicit leave-room event so client can quickly remove itself from member list
  socket.on('leave-room', ({ roomId: leavingId } = {}) => {
    const rid = leavingId || currentRoom;
    if (!rid) return;
    if (rooms[rid]) {
      const memberEmail = socket.data && socket.data.email;
      delete rooms[rid].members[socket.id];
      if (memberEmail && rooms[rid].byEmail && rooms[rid].byEmail[memberEmail] === socket.id) {
        delete rooms[rid].byEmail[memberEmail];
      }
      socket.leave(rid);
      io.to(rid).emit('user-list', Object.values(rooms[rid].members));
      if (Object.keys(rooms[rid].members).length === 0) {
        delete rooms[rid];
      }
    }
    if (rid === currentRoom) currentRoom = null;
    // notify rooms subscribers
    broadcastRoomsToSubscribers();
  });

  socket.on('join-room', async (payload = {}, cb) => {
    const { roomId, name, token, visibility, password } = payload || {};
    currentRoom = roomId;
    // verify token if provided to enforce one-account-per-room
    let accountEmail = null;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload && payload.email) accountEmail = payload.email;
      } catch (e) {
        // ignore invalid token
      }
    }

    if (!rooms[roomId]) {
      // try to load from DB
      let persisted = null;
      try { persisted = await prisma.room.findUnique({ where: { id: roomId } }); } catch (e) { persisted = null; }
      rooms[roomId] = { members: {}, byEmail: {}, playlist: [], visibility: 'public', passwordHash: null, state: { url: null, playing: false, currentTime: 0, updatedAt: Date.now(), playMode: 'sequence', currentIndex: 0 } };
      // if creator passed visibility/password, set them (hashing password)
      try {
        if (visibility === 'private' && password) {
          const hash = await bcrypt.hash(String(password), 10);
          rooms[roomId].visibility = 'private';
          rooms[roomId].passwordHash = hash;
        } else {
          rooms[roomId].visibility = 'public';
          rooms[roomId].passwordHash = null;
        }
      } catch (e) {
        rooms[roomId].visibility = 'public';
        rooms[roomId].passwordHash = null;
      }
      if (persisted) {
        try {
          rooms[roomId].playlist = Array.isArray(persisted.playlist) ? persisted.playlist : (persisted.playlist ? JSON.parse(String(persisted.playlist)) : []);
        } catch (_) { try { rooms[roomId].playlist = persisted.playlist ? JSON.parse(String(persisted.playlist)) : []; } catch (__){ rooms[roomId].playlist = []; } }
        rooms[roomId].state.playMode = persisted.playMode || rooms[roomId].state.playMode;
        rooms[roomId].state.currentIndex = typeof persisted.currentIndex === 'number' ? persisted.currentIndex : 0;
        const idx = rooms[roomId].state.currentIndex || 0;
        if (rooms[roomId].playlist && rooms[roomId].playlist[idx]) rooms[roomId].state.url = rooms[roomId].playlist[idx].url;
      }
    }

    // If room exists and is private, validate provided password (unless creator just created it above with password)
    if (rooms[roomId] && rooms[roomId].visibility === 'private') {
      const provided = password || null;
      // allow join if socket has an authenticated account that matches a stored byEmail member (auth bypass not allowed)
      let okPwd = false;
      try {
        if (rooms[roomId].passwordHash && provided) {
          okPwd = await bcrypt.compare(String(provided), rooms[roomId].passwordHash);
        }
      } catch (e) { okPwd = false; }
      if (!okPwd) {
        const err = { ok: false, code: 'password-required', message: '此房间为私密房间，需要正确密码才能加入' };
        if (typeof cb === 'function') try { cb(err); } catch (__) {}
        else socket.emit('join-error', err);
        return;
      }
    }

    // if accountEmail exists and already joined, reject the new join
    if (accountEmail) {
      const existingSid = rooms[roomId].byEmail && rooms[roomId].byEmail[accountEmail];
      const existingSocket = existingSid ? io.sockets.sockets.get(existingSid) : null;
      if (existingSocket && existingSocket.connected) {
        const err = { ok: false, code: 'already-in-room', message: 'Account already joined this room' };
        if (typeof cb === 'function') try { cb(err); } catch (__) {}
        else socket.emit('join-error', err);
        return;
      }
    }

    socket.join(roomId);
    socket.data.name = name || 'Anonymous';
    if (accountEmail) socket.data.email = accountEmail;

    rooms[roomId].members[socket.id] = socket.data.name;
    if (accountEmail) rooms[roomId].byEmail[accountEmail] = socket.id;

    // send updated user list to everyone
    io.to(roomId).emit('user-list', Object.values(rooms[roomId].members));

    // send current room state to the newly joined socket only
    socket.emit('room-state', rooms[roomId].state);
    // send current playlist and play mode as well
    try { socket.emit('playlist-updated', rooms[roomId].playlist || []); } catch (__) {}
    try { socket.emit('play-mode', rooms[roomId].state.playMode || 'sequence'); } catch (__) {}
    if (typeof cb === 'function') try { cb({ ok: true }); } catch (__) {}
    // notify rooms subscribers
    broadcastRoomsToSubscribers();
  });

  socket.on('play', (payload) => {
    if (!currentRoom) return;
    // update room state
    if (rooms[currentRoom]) {
      rooms[currentRoom].state.playing = true;
      rooms[currentRoom].state.currentTime = payload.currentTime || 0;
      rooms[currentRoom].state.updatedAt = Date.now();
    }
    socket.to(currentRoom).emit('play', payload);
  });

  socket.on('pause', (payload) => {
    if (!currentRoom) return;
    if (rooms[currentRoom]) {
      rooms[currentRoom].state.playing = false;
      rooms[currentRoom].state.currentTime = payload.currentTime || 0;
      rooms[currentRoom].state.updatedAt = Date.now();
    }
    socket.to(currentRoom).emit('pause', payload);
  });

  socket.on('seek', (payload) => {
    if (!currentRoom) return;
    if (rooms[currentRoom]) {
      rooms[currentRoom].state.currentTime = payload.currentTime || 0;
      rooms[currentRoom].state.updatedAt = Date.now();
    }
    socket.to(currentRoom).emit('seek', payload);
  });

  socket.on('set-track', (payload) => {
    if (!currentRoom) return;
    if (rooms[currentRoom]) {
      rooms[currentRoom].state.url = payload.url || null;
      rooms[currentRoom].state.currentTime = 0;
      rooms[currentRoom].state.playing = false;
      rooms[currentRoom].state.updatedAt = Date.now();
    }
    socket.to(currentRoom).emit('set-track', payload);
  });

  // Playlist management
  socket.on('playlist-add', async (track, cb) => {
    if (!currentRoom) return;
    try {
      if (!track || !track.url) {
        if (typeof cb === 'function') cb({ ok: false, message: 'missing url' });
        return;
      }
      const item = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`, url: track.url, title: track.title || '', addedBy: socket.data.name || 'Anonymous', ts: Date.now() };
      rooms[currentRoom].playlist = rooms[currentRoom].playlist || [];
      rooms[currentRoom].playlist.push(item);
      // persist to DB
      try { await prisma.room.upsert({ where: { id: currentRoom }, update: { playlist: JSON.stringify(rooms[currentRoom].playlist || []), currentIndex: rooms[currentRoom].state.currentIndex || 0, playMode: rooms[currentRoom].state.playMode || 'sequence' }, create: { id: currentRoom, playlist: JSON.stringify(rooms[currentRoom].playlist || []), currentIndex: rooms[currentRoom].state.currentIndex || 0, playMode: rooms[currentRoom].state.playMode || 'sequence' } }); } catch (_) {}
      io.to(currentRoom).emit('playlist-updated', rooms[currentRoom].playlist);
      // respond ok
      if (typeof cb === 'function') cb({ ok: true, item });
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, message: 'error' });
    }
  });

  socket.on('playlist-remove', async ({ id } = {}, cb) => {
    if (!currentRoom) return;
    try {
      rooms[currentRoom].playlist = rooms[currentRoom].playlist || [];
      const idx = rooms[currentRoom].playlist.findIndex((x) => x.id === id);
      if (idx === -1) { if (typeof cb === 'function') cb({ ok: false, message: 'not found' }); return; }
      const removed = rooms[currentRoom].playlist.splice(idx, 1)[0];
      // persist
      try { await prisma.room.upsert({ where: { id: currentRoom }, update: { playlist: JSON.stringify(rooms[currentRoom].playlist || []), currentIndex: rooms[currentRoom].state.currentIndex || 0, playMode: rooms[currentRoom].state.playMode || 'sequence' }, create: { id: currentRoom, playlist: JSON.stringify(rooms[currentRoom].playlist || []), currentIndex: rooms[currentRoom].state.currentIndex || 0, playMode: rooms[currentRoom].state.playMode || 'sequence' } }); } catch (_) {}
      io.to(currentRoom).emit('playlist-updated', rooms[currentRoom].playlist);
      if (typeof cb === 'function') cb({ ok: true, removed });
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, message: 'error' });
    }
  });

  // play mode: 'single' | 'sequence' | 'loop' | 'shuffle'
  socket.on('set-play-mode', (mode, cb) => {
    if (!currentRoom) return;
    try {
      const allowed = ['single', 'sequence', 'loop', 'shuffle'];
      if (!allowed.includes(mode)) {
        if (typeof cb === 'function') cb({ ok: false, message: 'invalid mode' });
        return;
      }
      rooms[currentRoom].state.playMode = mode;
      io.to(currentRoom).emit('play-mode', mode);
      // persist
      (async () => {
        try { await prisma.room.upsert({ where: { id: currentRoom }, update: { playMode: mode, playlist: JSON.stringify(rooms[currentRoom].playlist || []), currentIndex: rooms[currentRoom].state.currentIndex || 0 }, create: { id: currentRoom, playMode: mode, playlist: JSON.stringify(rooms[currentRoom].playlist || []), currentIndex: rooms[currentRoom].state.currentIndex || 0 } }); } catch (_) {}
      })();
      if (typeof cb === 'function') cb({ ok: true });
    } catch (e) {
      if (typeof cb === 'function') cb({ ok: false, message: 'error' });
    }
  });

  // server-driven track navigation
  socket.on('playlist-next', (cb) => {
    if (!currentRoom) return;
    try {
      const pl = rooms[currentRoom].playlist || [];
      if (!pl.length) { if (typeof cb === 'function') cb({ ok: false, message: 'empty' }); return; }
      const idx = typeof rooms[currentRoom].state.currentIndex === 'number' ? rooms[currentRoom].state.currentIndex : 0;
      const mode = rooms[currentRoom].state.playMode || 'sequence';
      let next = idx;
      if (mode === 'single') next = idx; else if (mode === 'sequence') next = Math.min(idx + 1, pl.length - 1); else if (mode === 'loop') next = (idx + 1) % pl.length; else if (mode === 'shuffle') next = Math.floor(Math.random() * pl.length);
      const prevIdx = typeof rooms[currentRoom].state.currentIndex === 'number' ? rooms[currentRoom].state.currentIndex : -1;
      rooms[currentRoom].state.currentIndex = next;
      rooms[currentRoom].state.url = pl[next].url;
      // reset playback position when switching tracks
      rooms[currentRoom].state.currentTime = 0;
      // if we actually moved to a different track (or mode intends replay), mark as playing so clients auto-play
      rooms[currentRoom].state.playing = (next !== prevIdx) || (rooms[currentRoom].state.playMode === 'single');
      rooms[currentRoom].state.updatedAt = Date.now();
      io.to(currentRoom).emit('playlist-updated', rooms[currentRoom].playlist);
      // also emit a explicit set-track + play so clients reliably load and start playback
      try { io.to(currentRoom).emit('set-track', { url: rooms[currentRoom].state.url }); } catch (_) {}
      try { io.to(currentRoom).emit('play', { currentTime: 0 }); } catch (_) {}
      io.to(currentRoom).emit('room-state', rooms[currentRoom].state);
      // persist
      (async () => { try { await prisma.room.upsert({ where: { id: currentRoom }, update: { currentIndex: rooms[currentRoom].state.currentIndex, playlist: JSON.stringify(rooms[currentRoom].playlist || []), playMode: rooms[currentRoom].state.playMode || 'sequence' }, create: { id: currentRoom, currentIndex: rooms[currentRoom].state.currentIndex, playlist: JSON.stringify(rooms[currentRoom].playlist || []), playMode: rooms[currentRoom].state.playMode || 'sequence' } }); } catch (_) {} })();
      if (typeof cb === 'function') cb({ ok: true, index: next });
    } catch (e) { if (typeof cb === 'function') cb({ ok: false }); }
  });

  socket.on('playlist-prev', (cb) => {
    if (!currentRoom) return;
    try {
      const pl = rooms[currentRoom].playlist || [];
      if (!pl.length) { if (typeof cb === 'function') cb({ ok: false, message: 'empty' }); return; }
      const idx = typeof rooms[currentRoom].state.currentIndex === 'number' ? rooms[currentRoom].state.currentIndex : 0;
      let prev = idx > 0 ? idx - 1 : 0;
      const prevIdx2 = typeof rooms[currentRoom].state.currentIndex === 'number' ? rooms[currentRoom].state.currentIndex : -1;
      rooms[currentRoom].state.currentIndex = prev;
      rooms[currentRoom].state.url = pl[prev].url;
      // reset playback position when switching tracks
      rooms[currentRoom].state.currentTime = 0;
      rooms[currentRoom].state.playing = (prev !== prevIdx2);
      rooms[currentRoom].state.updatedAt = Date.now();
      io.to(currentRoom).emit('playlist-updated', rooms[currentRoom].playlist);
      try { io.to(currentRoom).emit('set-track', { url: rooms[currentRoom].state.url }); } catch (_) {}
      try { io.to(currentRoom).emit('play', { currentTime: 0 }); } catch (_) {}
      io.to(currentRoom).emit('room-state', rooms[currentRoom].state);
      (async () => { try { await prisma.room.upsert({ where: { id: currentRoom }, update: { currentIndex: rooms[currentRoom].state.currentIndex, playlist: JSON.stringify(rooms[currentRoom].playlist || []), playMode: rooms[currentRoom].state.playMode || 'sequence' }, create: { id: currentRoom, currentIndex: rooms[currentRoom].state.currentIndex, playlist: JSON.stringify(rooms[currentRoom].playlist || []), playMode: rooms[currentRoom].state.playMode || 'sequence' } }); } catch (_) {} })();
      if (typeof cb === 'function') cb({ ok: true, index: prev });
    } catch (e) { if (typeof cb === 'function') cb({ ok: false }); }
  });

  socket.on('set-current-index', (idx, cb) => {
    if (!currentRoom) return;
    try {
      const pl = rooms[currentRoom].playlist || [];
      if (!pl.length || typeof idx !== 'number' || idx < 0 || idx >= pl.length) { if (typeof cb === 'function') cb({ ok: false, message: 'invalid index' }); return; }
      const prevIdx3 = typeof rooms[currentRoom].state.currentIndex === 'number' ? rooms[currentRoom].state.currentIndex : -1;
      rooms[currentRoom].state.currentIndex = idx;
      rooms[currentRoom].state.url = pl[idx].url;
      // reset playback position when switching tracks
      rooms[currentRoom].state.currentTime = 0;
      rooms[currentRoom].state.playing = (idx !== prevIdx3) || (rooms[currentRoom].state.playMode === 'single');
      rooms[currentRoom].state.updatedAt = Date.now();
      io.to(currentRoom).emit('room-state', rooms[currentRoom].state);
      try { io.to(currentRoom).emit('set-track', { url: rooms[currentRoom].state.url }); } catch (_) {}
      try { io.to(currentRoom).emit('play', { currentTime: 0 }); } catch (_) {}
      (async () => { try { await prisma.room.upsert({ where: { id: currentRoom }, update: { currentIndex: rooms[currentRoom].state.currentIndex, playlist: JSON.stringify(rooms[currentRoom].playlist || []), playMode: rooms[currentRoom].state.playMode || 'sequence' }, create: { id: currentRoom, currentIndex: rooms[currentRoom].state.currentIndex, playlist: JSON.stringify(rooms[currentRoom].playlist || []), playMode: rooms[currentRoom].state.playMode || 'sequence' } }); } catch (_) {} })();
      if (typeof cb === 'function') cb({ ok: true });
    } catch (e) { if (typeof cb === 'function') cb({ ok: false }); }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    if (rooms[currentRoom]) {
      // remove member
      const memberEmail = socket.data && socket.data.email;
      delete rooms[currentRoom].members[socket.id];
      if (memberEmail && rooms[currentRoom].byEmail && rooms[currentRoom].byEmail[memberEmail] === socket.id) {
        delete rooms[currentRoom].byEmail[memberEmail];
      }
      io.to(currentRoom).emit('user-list', Object.values(rooms[currentRoom].members));
      // if no members left, clean up room
      if (Object.keys(rooms[currentRoom].members).length === 0) {
        delete rooms[currentRoom];
      }
    }
    // notify rooms subscribers
    broadcastRoomsToSubscribers();
  });
});

// Heartbeat: ping rooms every 2s; if nobody responds (or lastSeen stale), destroy room
setInterval(() => {
  const now = Date.now();
  for (const roomId of Object.keys(rooms)) {
    const room = rooms[roomId];
    // broadcast heartbeat to room members
    io.to(roomId).emit('heartbeat', { ts: now });

    // determine if any member socket is alive (seen in last 5s)
    let anyAlive = false;
    for (const sid of Object.keys(room.members)) {
      const s = io.sockets.sockets.get(sid);
      if (s && s.connected && s.data && s.data.lastSeen && (now - s.data.lastSeen) < 5000) {
        anyAlive = true;
        break;
      }
    }

    if (!anyAlive) {
      // no active members responding — destroy the room
      console.log(`[ROOM] Destroying inactive room ${roomId}`);
      delete rooms[roomId];
    }
  }
  // after heartbeat cleanup broadcast rooms
  broadcastRoomsToSubscribers();
}, 2000);

// Create a separate API server to avoid interfering with Socket.IO polling requests
const API_PORT = process.env.API_PORT || 4001;
const VERIFY_URL_BASE = process.env.VERIFY_URL_BASE || `http://localhost:${API_PORT}`;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const apiServer = createServer(async (req, res) => {
  console.log(`[API] ${req.method} ${req.url}`);
  // Ensure CORS headers are always present so browser can read error responses
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Credentials': 'true' });
    return res.end();
  }

  // API: list rooms
  if (req.method === 'GET' && req.url && req.url.startsWith('/rooms')) {
    const now = Date.now();
    const list = Object.keys(rooms).map((id) => {
      const room = rooms[id];
      // count active members by checking live sockets and recent lastSeen (5s)
      let active = 0;
      for (const sid of Object.keys(room.members)) {
        const s = io.sockets.sockets.get(sid);
        if (s && s.connected && s.data && s.data.lastSeen && (now - s.data.lastSeen) < 5000) active++;
      }
      return { id, members: active, url: room.state?.url || null, playing: room.state?.playing || false };
    }).filter((r) => r.members > 0);
    const body = JSON.stringify(list);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
    });
    return res.end(body);
  }

  // API: register
  if (req.method === 'POST' && req.url === '/api/register') {
    try {
      const body = await parseJsonBody(req);
      console.log('[API] register body:', body && typeof body === 'object' ? { keys: Object.keys(body) } : body);
      const { email, password } = body;
      if (!email || !password) { res.writeHead(400); return res.end('Missing'); }
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) { res.writeHead(409); return res.end('User exists'); }
      const hash = await bcrypt.hash(password, 10);
      const verifyToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
      await prisma.user.create({ data: { email, passwordHash: hash, verified: false, verifyToken } });

      // respond immediately so client isn't blocked by SMTP/network delays
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
      res.end(JSON.stringify({ ok: true }));

      // send verification email asynchronously and log preview or errors
      (async () => {
        try {
          const transport = await getTransport();
          const verifyUrl = `${VERIFY_URL_BASE}/api/verify?token=${verifyToken}`;
          const mailFrom = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
          const info = await transport.sendMail({ from: mailFrom, to: email, subject: 'Verify your account', text: `Verify: ${verifyUrl}`, html: `<a href="${verifyUrl}">Verify</a>`, envelope: { from: mailFrom, to: email } });
          const preview = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null;
          console.log('[API] verification email sent, preview:', preview);
        } catch (err) {
          console.error('[API] verification email error', err && err.message ? err.message : err);
        }
      })();
      return;
    } catch (e) {
      console.error('[API] register error', e);
      // if we haven't sent a response yet, respond with 500
      try { res.writeHead(500); res.end('error'); } catch (__) {}
      return;
    }
  }

  // API: verify (redirect to home after verifying)
  if (req.method === 'GET' && req.url && req.url.startsWith('/api/verify')) {
    try {
      const url = new URL(req.url, `http://localhost:${API_PORT}`);
      const token = url.searchParams.get('token');
      if (!token) {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verification error</title></head><body style="font-family:sans-serif;padding:2rem;"><h1>Missing token</h1><p>No verification token provided.</p><p><a href="${FRONTEND_URL}">Return to app</a></p></body></html>`;
        res.writeHead(400, { 'Content-Type': 'text/html' });
        return res.end(html);
      }
      const userEntry = await prisma.user.findFirst({ where: { verifyToken: token } });
      if (!userEntry) {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verification error</title></head><body style="font-family:sans-serif;padding:2rem;"><h1>Invalid or expired token</h1><p>The verification link is invalid or has already been used.</p><p><a href="${FRONTEND_URL}">Return to app</a></p></body></html>`;
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end(html);
      }
      await prisma.user.update({ where: { email: userEntry.email }, data: { verified: true, verifyToken: null } });
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verified</title></head><body style="font-family:sans-serif;padding:2rem;"><h1>Verification successful</h1><p>Your email has been verified. You can now return to the app.</p><p><a href="${FRONTEND_URL}">Open app</a></p></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    } catch (e) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Server error</title></head><body style="font-family:sans-serif;padding:2rem;"><h1>Server error</h1><p>Unable to process verification at this time.</p><p><a href="${FRONTEND_URL}">Return to app</a></p></body></html>`;
      res.writeHead(500, { 'Content-Type': 'text/html' });
      return res.end(html);
    }
  }

  // API: login
  if (req.method === 'POST' && req.url === '/api/login') {
    try {
      const body = await parseJsonBody(req);
      const { email, password } = body;
      if (!email || !password) { res.writeHead(400); return res.end('Missing'); }
      const u = await prisma.user.findUnique({ where: { email } });
      if (!u) { res.writeHead(404); return res.end('Not found'); }
      if (!u.verified) { res.writeHead(403); return res.end('Not verified'); }
      const ok = await bcrypt.compare(password, u.passwordHash);
      if (!ok) { res.writeHead(401); return res.end('Invalid'); }
      const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: '7d' });
      const cookieStr = `token=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}`;
      console.log('[API] /api/login origin=', req.headers.origin, 'setting-cookie=', cookieStr.slice(0, 40) + '...');
      res.writeHead(200, {
        'Set-Cookie': cookieStr,
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers': 'Set-Cookie, X-Auth-Token',
        'X-Auth-Token': token,
      });
      return res.end(JSON.stringify({ ok: true, token }));
    } catch (e) {
      res.writeHead(500); return res.end('error');
    }
  }

  // API: me
  if (req.method === 'GET' && req.url === '/api/me') {
    try {
      // support cookie token or Authorization: Bearer <token>
      const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
      let token = cookies.token;
      if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7);
      }
      if (!token) { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }); return res.end(JSON.stringify({ user: null })); }
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        // optionally return minimal user info from DB
        const dbUser = await prisma.user.findUnique({ where: { email: payload.email } });
        const userInfo = dbUser ? { email: dbUser.email } : null;
        return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }).end(JSON.stringify({ user: userInfo }));
      } catch (e) {
        return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }).end(JSON.stringify({ user: null }));
      }
    } catch (e) {
      res.writeHead(500); return res.end('error');
    }
  }

  // API: profile (get/update)
  if (req.url === '/api/profile') {
    try {
      const method = req.method;
      // auth like /api/me
      const cookies = req.headers.cookie ? cookie.parse(req.headers.cookie) : {};
      let token = cookies.token;
      if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7);
      }
      if (!token) { res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }); return res.end(JSON.stringify({ error: 'unauthenticated' })); }
      let payload;
      try { payload = jwt.verify(token, JWT_SECRET); } catch (e) { res.writeHead(401, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }); return res.end(JSON.stringify({ error: 'invalid token' })); }
      const u = await prisma.user.findUnique({ where: { email: payload.email } });
      if (!u) { res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }); return res.end(JSON.stringify({ error: 'not found' })); }

      if (method === 'GET') {
        const profile = { email: u.email, nickname: u.nickname || '', bio: u.bio || '', avatar: u.avatar || null };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
        return res.end(JSON.stringify({ ok: true, profile }));
      }

      if (method === 'POST') {
        const body = await parseJsonBody(req);
        const { nickname, bio, avatarBase64, password } = body || {};
        const updateData = {};
        if (typeof nickname === 'string') updateData.nickname = nickname;
        if (typeof bio === 'string') updateData.bio = bio;
        if (typeof avatarBase64 === 'string') {
          if (avatarBase64.length < 2000000) {
            updateData.avatar = avatarBase64;
            console.log('[API] profile avatar stored, bytes=', avatarBase64.length);
          } else {
            console.log('[API] profile avatar too large, skipping, bytes=', avatarBase64.length);
          }
        }
        if (typeof password === 'string' && password.length > 0) {
          updateData.passwordHash = await bcrypt.hash(password, 10);
        }
        await prisma.user.update({ where: { email: payload.email }, data: updateData });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
        return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(405); return res.end();
    } catch (e) {
      console.error('[API] profile error', e);
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
      return res.end(JSON.stringify({ error: 'server' }));
    }
  }

  // API: logout (clears cookie and redirects back to frontend)
  if (req.method === 'GET' && req.url === '/api/logout') {
    try {
      res.writeHead(302, { 'Set-Cookie': `token=; HttpOnly; Path=/; Max-Age=0`, Location: FRONTEND_URL });
      return res.end();
    } catch (e) {
      res.writeHead(500); return res.end('error');
    }
  }

  // API: resend verification email (useful for debugging)
  if (req.method === 'POST' && req.url === '/api/resend') {
    try {
      const body = await parseJsonBody(req);
      const { email } = body || {};
      if (!email) { res.writeHead(400); return res.end('Missing email'); }
      const u = await prisma.user.findUnique({ where: { email } });
      if (!u) { res.writeHead(404); return res.end('Not found'); }
      if (u.verified) { res.writeHead(400); return res.end('Already verified'); }

      try {
        const transport = await getTransport();
        const verifyUrl = `${VERIFY_URL_BASE}/api/verify?token=${u.verifyToken}`;
        const mailFrom = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
        const info = await transport.sendMail({ from: mailFrom, to: email, subject: 'Verify your account', text: `Verify: ${verifyUrl}`, html: `<a href="${verifyUrl}">Verify</a>`, envelope: { from: mailFrom, to: email } });
        const preview = nodemailer.getTestMessageUrl ? nodemailer.getTestMessageUrl(info) : null;
        console.log('[API] resend verification email preview:', preview);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
        return res.end(JSON.stringify({ ok: true, preview }));
      } catch (err) {
        console.error('[API] resend email error', err && err.message ? err.message : err);
        res.writeHead(500); return res.end('send error');
      }
    } catch (e) {
      res.writeHead(500); return res.end('error');
    }
  }

  // API: search music (proxy to NeteaseCloudMusicApi)
  if (req.method === 'GET' && req.url && req.url.startsWith('/api/search')) {
    try {
      const url = new URL(req.url, `http://localhost:${API_PORT}`);
      const q = url.searchParams.get('q') || '';
      if (!q) { res.writeHead(400); return res.end('missing q'); }
      try {
        const mod = await import('NeteaseCloudMusicApi');
        const apiSearch = mod.search || (mod.default && mod.default.search);
        if (!apiSearch) { res.writeHead(500); return res.end('search unavailable'); }
        const apiRes = await apiSearch({ keywords: q });
        const songs = apiRes && apiRes.body && apiRes.body.result && apiRes.body.result.songs ? apiRes.body.result.songs : [];
        const list = songs.map((s) => ({
          id: s.id,
          name: s.name,
          artists: (s.ar || s.artists || []).map ? (s.ar || s.artists).map((a) => a.name || a).join(', ') : (s.artists || '').toString(),
          album: (s.al && s.al.name) || (s.album && s.album.name) || '',
          src: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`
        }));
        const body = JSON.stringify({ ok: true, list });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
        return res.end(body);
      } catch (e) {
        console.error('[API] search error', e && e.message ? e.message : e);
        res.writeHead(500); return res.end('search error');
      }
    } catch (e) {
      res.writeHead(500); return res.end('error');
    }
  }

  // default 404 for API
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' });
  res.end('Not Found');
});

apiServer.listen(API_PORT, () => {
  console.log(`API server running on port ${API_PORT}`);
});

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
