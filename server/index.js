require('dotenv').config();
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 4000;

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const USERS_FILE = path.join(__dirname, 'users.json');
function loadUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function saveUsers(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2), 'utf8');
}

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

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId, name }) => {
    currentRoom = roomId;
    socket.join(roomId);
    socket.data.name = name || 'Anonymous';

    if (!rooms[roomId]) {
      rooms[roomId] = { members: {}, state: { url: null, playing: false, currentTime: 0, updatedAt: Date.now() } };
    }
    rooms[roomId].members[socket.id] = socket.data.name;

    // send updated user list to everyone
    io.to(roomId).emit('user-list', Object.values(rooms[roomId].members));

    // send current room state to the newly joined socket only
    socket.emit('room-state', rooms[roomId].state);
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

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    if (rooms[currentRoom]) {
      delete rooms[currentRoom].members[socket.id];
      io.to(currentRoom).emit('user-list', Object.values(rooms[currentRoom].members));
      // if no members left, clean up room
      if (Object.keys(rooms[currentRoom].members).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

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
    const list = Object.keys(rooms).map((id) => ({ id, members: Object.keys(rooms[id].members).length, url: rooms[id].state?.url || null, playing: rooms[id].state?.playing || false }));
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
      const users = loadUsers();
      if (users[email]) { res.writeHead(409); return res.end('User exists'); }
      const hash = await bcrypt.hash(password, 10);
      const verifyToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
      users[email] = { email, passwordHash: hash, verified: false, verifyToken, createdAt: Date.now() };
      saveUsers(users);

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
      const u = loadUsers();
      const url = new URL(req.url, `http://localhost:${API_PORT}`);
      const token = url.searchParams.get('token');
      if (!token) {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verification error</title></head><body style="font-family:sans-serif;padding:2rem;"><h1>Missing token</h1><p>No verification token provided.</p><p><a href="${FRONTEND_URL}">Return to app</a></p></body></html>`;
        res.writeHead(400, { 'Content-Type': 'text/html' });
        return res.end(html);
      }
      const userEntry = Object.values(u).find((x) => x.verifyToken === token);
      if (!userEntry) {
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Verification error</title></head><body style="font-family:sans-serif;padding:2rem;"><h1>Invalid or expired token</h1><p>The verification link is invalid or has already been used.</p><p><a href="${FRONTEND_URL}">Return to app</a></p></body></html>`;
        res.writeHead(404, { 'Content-Type': 'text/html' });
        return res.end(html);
      }
      u[userEntry.email].verified = true;
      delete u[userEntry.email].verifyToken;
      saveUsers(u);
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
      const users = loadUsers();
      const u = users[email];
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
        return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }).end(JSON.stringify({ user: payload }));
      } catch (e) {
        return res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }).end(JSON.stringify({ user: null }));
      }
    } catch (e) {
      res.writeHead(500); return res.end('error');
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
      const users = loadUsers();
      const u = users[email];
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
