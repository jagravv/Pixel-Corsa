'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createHash } = require('crypto');
const { EventEmitter } = require('events');
const WebSocket = { OPEN: 1 };

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const MAX_PLAYERS = 4;
const ROOM_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const VALID_TRACKS = new Set(['tck01', 'tck02']);
const VALID_LIVERIES = new Set(['redbull', 'ferrari', 'mclaren']);
const VALID_RACE_LENGTHS = new Set(['practice', '3', '5']);
const rooms = new Map();
const clients = new Map();
let joinSequence = 0;


const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_MAX_PAYLOAD = 24 * 1024;
const wsClients = new Set();

// Minimal RFC 6455 server for this fixed-size LAN game protocol. It supports masked
// browser text frames, continuation frames, ping/pong, and close handshakes; it has
// no third-party runtime dependencies.
class LanWebSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = WebSocket.OPEN;
    this.isAlive = true;
    this.buffer = Buffer.alloc(0);
    this.fragmentOpcode = 0;
    this.fragments = [];
    this.fragmentLength = 0;
    socket.on('data', chunk => this.consume(chunk));
    socket.on('error', err => this.emit('error', err));
    socket.on('end', () => this.finishClose());
    socket.on('close', () => this.finishClose());
  }
  finishClose() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }
  frame(opcode, payload = Buffer.alloc(0)) {
    if (!Buffer.isBuffer(payload)) payload = Buffer.from(payload);
    const n = payload.length;
    let header;
    if (n < 126) {
      header = Buffer.from([0x80 | opcode, n]);
    } else if (n <= 0xffff) {
      header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(n, 2);
    } else {
      header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(n), 2);
    }
    return Buffer.concat([header, payload]);
  }
  send(data) {
    if (this.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open');
    this.socket.write(this.frame(1, Buffer.from(String(data), 'utf8')));
  }
  ping() {
    if (this.readyState === WebSocket.OPEN) this.socket.write(this.frame(9));
  }
  terminate() { this.socket.destroy(); }
  close(code = 1000, reason = '') {
    if (this.readyState !== WebSocket.OPEN) return;
    this.readyState = 2;
    const reasonBytes = Buffer.from(String(reason).slice(0, 80), 'utf8');
    const payload = Buffer.alloc(2 + Math.min(reasonBytes.length, 120));
    payload.writeUInt16BE(code, 0); reasonBytes.copy(payload, 2, 0, payload.length - 2);
    try { this.socket.write(this.frame(8, payload)); } catch (_) {}
    this.socket.end();
  }
  protocolClose(code, reason) {
    if (this.readyState === 3) return;
    const reasonBytes = Buffer.from(reason || '', 'utf8').subarray(0, 100);
    const payload = Buffer.alloc(2 + reasonBytes.length); payload.writeUInt16BE(code, 0); reasonBytes.copy(payload, 2);
    try { this.socket.write(this.frame(8, payload)); } catch (_) {}
    this.readyState = 2; this.socket.end();
  }
  consume(chunk) {
    if (this.readyState === 3) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    try {
      while (this.buffer.length >= 2) {
        const first = this.buffer[0], second = this.buffer[1];
        const fin = !!(first & 0x80), opcode = first & 0x0f, masked = !!(second & 0x80);
        if ((first & 0x70) !== 0 || !masked) return this.protocolClose(1002, 'Invalid WebSocket frame');
        let length = second & 0x7f, offset = 2;
        if (length === 126) {
          if (this.buffer.length < 4) return;
          length = this.buffer.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
          if (this.buffer.length < 10) return;
          const bigLength = this.buffer.readBigUInt64BE(2);
          if (bigLength > BigInt(WS_MAX_PAYLOAD)) return this.protocolClose(1009, 'Message too large');
          length = Number(bigLength); offset = 10;
        }
        const control = opcode >= 8;
        if (length > WS_MAX_PAYLOAD || (control && (!fin || length > 125))) return this.protocolClose(1009, 'Frame too large');
        if (this.buffer.length < offset + 4 + length) return;
        const mask = this.buffer.subarray(offset, offset + 4); offset += 4;
        const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
        this.buffer = this.buffer.subarray(offset + length);
        if (opcode === 8) {
          if (this.readyState === WebSocket.OPEN) {
            this.readyState = 2; try { this.socket.write(this.frame(8, payload)); } catch (_) {}
          }
          this.socket.end(); this.finishClose(); return;
        }
        if (opcode === 9) { if (this.readyState === WebSocket.OPEN) this.socket.write(this.frame(10, payload)); continue; }
        if (opcode === 10) { this.isAlive = true; this.emit('pong'); continue; }
        if (opcode === 1 || opcode === 2) {
          if (this.fragmentOpcode) return this.protocolClose(1002, 'Unexpected new data frame');
          if (fin) {
            if (opcode !== 1) return this.protocolClose(1003, 'Text messages only');
            this.emit('message', payload);
          } else {
            this.fragmentOpcode = opcode; this.fragments = [payload]; this.fragmentLength = payload.length;
          }
          continue;
        }
        if (opcode === 0) {
          if (!this.fragmentOpcode) return this.protocolClose(1002, 'Unexpected continuation');
          this.fragments.push(payload); this.fragmentLength += payload.length;
          if (this.fragmentLength > WS_MAX_PAYLOAD) return this.protocolClose(1009, 'Message too large');
          if (fin) {
            const message = Buffer.concat(this.fragments, this.fragmentLength);
            const originalOpcode = this.fragmentOpcode;
            this.fragmentOpcode = 0; this.fragments = []; this.fragmentLength = 0;
            if (originalOpcode !== 1) return this.protocolClose(1003, 'Text messages only');
            this.emit('message', message);
          }
          continue;
        }
        return this.protocolClose(1002, 'Unsupported WebSocket opcode');
      }
    } catch (err) {
      this.emit('error', err);
      this.protocolClose(1002, 'Malformed WebSocket frame');
    }
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8'
};

function send(ws, packet) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(packet)); } catch (_) { /* Closed connection */ }
  }
}
function error(ws, code, message) { send(ws, { type: 'error', code, message }); }
function safeName(value) {
  const name = String(value || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || `Driver${Math.floor(10 + Math.random() * 90)}`;
}
function validLivery(value) { return VALID_LIVERIES.has(value) ? value : 'redbull'; }
function validTrack(value) { return VALID_TRACKS.has(value) ? value : 'tck01'; }
function validRaceLength(value) { return VALID_RACE_LENGTHS.has(String(value)) ? String(value) : '3'; }
function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function normalizeAngle(value) {
  let angle = clampNumber(value, -100000, 100000, 0);
  angle = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return angle;
}
function generateRoomCode() {
  for (let attempts = 0; attempts < 100; attempts++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Could not allocate a room code');
}
function roomPlayers(room) {
  return [...room.players.values()].sort((a, b) => a.joinOrder - b.joinOrder);
}
function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    trackId: room.trackId,
    raceLength: room.raceLength,
    status: room.status,
    startAt: room.startAt || 0,
    maxPlayers: MAX_PLAYERS,
    players: roomPlayers(room).map(p => ({
      id: p.id, name: p.name, livery: p.livery, ready: p.ready,
      host: p.id === room.hostId,
      finished: !!(p.state && p.state.finished),
      state: p.state,
      joinedAt: p.joinedAt
    })),
    results: room.results.slice()
  };
}
function broadcastRoom(room) {
  const packet = { type: 'roomUpdate', room: publicRoom(room) };
  for (const p of room.players.values()) send(p.ws, packet);
}
function roomFor(client) { return client.roomCode ? rooms.get(client.roomCode) || null : null; }
function resetPlayerForLobby(player) {
  player.ready = player.id === (roomFor(player.client) || {}).hostId;
  player.state = null;
  player.lastStateAt = 0;
}
function detachClient(client, notify = true) {
  const room = roomFor(client);
  if (!room) { client.roomCode = null; return; }
  const leavingId = client.id;
  room.players.delete(leavingId);
  client.roomCode = null;
  if (room.players.size === 0) {
    if (room.startTimer) clearTimeout(room.startTimer);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === leavingId) {
    room.hostId = roomPlayers(room)[0].id;
    const newHost = room.players.get(room.hostId);
    if (newHost) newHost.ready = true;
  }
  if (room.status === 'starting' && room.players.size < 2) {
    if (room.startTimer) clearTimeout(room.startTimer);
    room.startTimer = null; room.startAt = 0; room.status = 'lobby';
    room.results = [];
  }
  if (room.status === 'racing' && room.raceLength !== 'practice') {
    const active = [...room.players.values()];
    if (active.length && active.every(p => room.results.some(r => r.playerId === p.id))) room.status = 'results';
  }
  if (notify) {
    for (const p of room.players.values()) send(p.ws, { type: 'playerLeft', playerId: leavingId, name: client.name || 'Driver' });
  }
  broadcastRoom(room);
}
function getTrackName(id) { return id === 'tck02' ? 'TCK-02' : 'TCK-01'; }
function publicError(ws, code, message) { error(ws, code, message); }
function parsePlayerState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const direction = ['left', 'right', 'center'].includes(raw.steerDir) ? raw.steerDir : 'center';
  return {
    x: clampNumber(raw.x, -10000, 50000, 0),
    y: clampNumber(raw.y, -10000, 50000, 0),
    heading: normalizeAngle(raw.heading),
    speedKmh: clampNumber(raw.speedKmh, 0, 700, 0),
    laps: Math.round(clampNumber(raw.laps, 0, 9999, 0)),
    lapTimeSeconds: clampNumber(raw.lapTimeSeconds, 0, 36000, 0),
    bestSeconds: raw.bestSeconds == null ? null : clampNumber(raw.bestSeconds, 0, 36000, null),
    elapsedSeconds: clampNumber(raw.elapsedSeconds, 0, 36000, 0),
    gear: Math.round(clampNumber(raw.gear, -1, 6, 0)),
    drsOpen: !!raw.drsOpen,
    steerDir: direction,
    paused: !!raw.paused,
    finished: !!raw.finished
  };
}
function broadcastPlayerState(room, client, state) {
  const player = room.players.get(client.id);
  if (!player) return;
  player.state = state;
  const packet = { type: 'playerState', player: {
    id: player.id, name: player.name, livery: player.livery,
    ready: player.ready, host: player.id === room.hostId, state
  } };
  for (const other of room.players.values()) if (other.id !== client.id) send(other.ws, packet);

  if (state.finished && room.status === 'racing' && !room.results.some(r => r.playerId === player.id)) {
    const result = {
      playerId: player.id, name: player.name, livery: player.livery,
      place: room.results.length + 1,
      elapsedSeconds: state.elapsedSeconds,
      bestSeconds: state.bestSeconds
    };
    room.results.push(result);
    const resultPacket = { type: 'playerFinished', result, room: publicRoom(room) };
    for (const other of room.players.values()) send(other.ws, resultPacket);
    if (room.raceLength !== 'practice' && roomPlayers(room).every(p => room.results.some(r => r.playerId === p.id))) {
      room.status = 'results';
    }
    broadcastRoom(room);
  }
}

function handleMessage(client, message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') return;
  let room = roomFor(client);
  switch (message.type) {
    case 'createRoom': {
      if (room) return publicError(client.ws, 'already_in_room', 'Leave your current room before creating another.');
      client.name = safeName(message.name);
      client.livery = validLivery(message.livery);
      const code = generateRoomCode();
      room = {
        code, hostId: client.id, trackId: validTrack(message.trackId),
        raceLength: validRaceLength(message.raceLength), status: 'lobby', startAt: 0,
        players: new Map(), results: [], startTimer: null
      };
      rooms.set(code, room);
      const player = { id: client.id, ws: client.ws, client, name: client.name, livery: client.livery,
        ready: true, state: null, lastStateAt: 0, joinOrder: ++joinSequence, joinedAt: Date.now() };
      room.players.set(player.id, player); client.roomCode = code;
      send(client.ws, { type: 'roomJoined', room: publicRoom(room), playerId: client.id, isHost: true });
      broadcastRoom(room);
      break;
    }
    case 'joinRoom': {
      if (room) return publicError(client.ws, 'already_in_room', 'Leave your current room before joining another.');
      const code = String(message.code || '').toUpperCase().replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '').slice(0, 4);
      room = rooms.get(code);
      if (!room) return publicError(client.ws, 'room_not_found', 'Room not found. Check the 4-character code.');
      if (room.status !== 'lobby') return publicError(client.ws, 'race_in_progress', 'That room has already started a race.');
      if (room.players.size >= MAX_PLAYERS) return publicError(client.ws, 'room_full', `Rooms are limited to ${MAX_PLAYERS} drivers.`);
      client.name = safeName(message.name); client.livery = validLivery(message.livery);
      const player = { id: client.id, ws: client.ws, client, name: client.name, livery: client.livery,
        ready: false, state: null, lastStateAt: 0, joinOrder: ++joinSequence, joinedAt: Date.now() };
      room.players.set(player.id, player); client.roomCode = code;
      send(client.ws, { type: 'roomJoined', room: publicRoom(room), playerId: client.id, isHost: false });
      broadcastRoom(room);
      break;
    }
    case 'setPreferences': {
      if (!room) return publicError(client.ws, 'not_in_room', 'Join a room first.');
      if (room.status !== 'lobby') return publicError(client.ws, 'race_in_progress', 'Preferences can only change in the lobby.');
      const p = room.players.get(client.id); if (!p) return;
      if (message.name != null) p.name = client.name = safeName(message.name);
      if (message.livery != null) p.livery = client.livery = validLivery(message.livery);
      if (p.id !== room.hostId) p.ready = false;
      broadcastRoom(room);
      break;
    }
    case 'setTrack': {
      if (!room) return publicError(client.ws, 'not_in_room', 'Join a room first.');
      if (client.id !== room.hostId) return publicError(client.ws, 'host_only', 'Only the host can choose the track.');
      if (room.status !== 'lobby') return publicError(client.ws, 'race_in_progress', 'The track is locked after the race starts.');
      room.trackId = validTrack(message.trackId);
      for (const p of room.players.values()) if (p.id !== room.hostId) p.ready = false;
      broadcastRoom(room);
      break;
    }
    case 'setRaceLength': {
      if (!room) return publicError(client.ws, 'not_in_room', 'Join a room first.');
      if (client.id !== room.hostId) return publicError(client.ws, 'host_only', 'Only the host can change race length.');
      if (room.status !== 'lobby') return publicError(client.ws, 'race_in_progress', 'Race length is locked after the race starts.');
      room.raceLength = validRaceLength(message.raceLength);
      for (const p of room.players.values()) if (p.id !== room.hostId) p.ready = false;
      broadcastRoom(room);
      break;
    }
    case 'setReady': {
      if (!room) return publicError(client.ws, 'not_in_room', 'Join a room first.');
      if (room.status !== 'lobby') return publicError(client.ws, 'race_in_progress', 'The lobby is locked after the race starts.');
      const p = room.players.get(client.id); if (!p) return;
      p.ready = p.id === room.hostId ? true : !!message.ready;
      broadcastRoom(room);
      break;
    }
    case 'startRace': {
      if (!room) return publicError(client.ws, 'not_in_room', 'Create or join a room first.');
      if (client.id !== room.hostId) return publicError(client.ws, 'host_only', 'Only the host can start the race.');
      if (room.status !== 'lobby') return publicError(client.ws, 'race_busy', 'The room is already starting or racing.');
      if (room.players.size < 2) return publicError(client.ws, 'need_players', 'At least 2 players are required to start a multiplayer race.');
      if (roomPlayers(room).some(p => !p.ready)) return publicError(client.ws, 'players_not_ready', 'Every driver must be ready before the race starts.');
      room.status = 'starting'; room.startAt = Date.now() + 4000; room.results = [];
      for (const p of room.players.values()) { p.state = null; p.lastStateAt = 0; }
      broadcastRoom(room);
      for (const p of room.players.values()) send(p.ws, { type: 'raceStarting', startAt: room.startAt, room: publicRoom(room) });
      const code = room.code, startAt = room.startAt;
      room.startTimer = setTimeout(() => {
        const current = rooms.get(code);
        if (!current || current.status !== 'starting' || current.startAt !== startAt) return;
        if (current.players.size < 2) {
          current.status = 'lobby'; current.startAt = 0; broadcastRoom(current); return;
        }
        current.status = 'racing'; current.startAt = 0;
        broadcastRoom(current);
        for (const p of current.players.values()) send(p.ws, { type: 'raceStarted', room: publicRoom(current), startAt });
      }, Math.max(1, startAt - Date.now()));
      break;
    }
    case 'playerState': {
      if (!room || room.status !== 'racing') return;
      const p = room.players.get(client.id); if (!p) return;
      const now = Date.now();
      if (now - p.lastStateAt < 32) return; // Server limits a client to about 31 updates/sec.
      p.lastStateAt = now;
      const state = parsePlayerState(message.state);
      if (state) broadcastPlayerState(room, client, state);
      break;
    }
    case 'restartPlayer': {
      if (!room || room.status !== 'racing') return publicError(client.ws, 'restart_not_available', 'This race cannot be restarted now.');
      const p = room.players.get(client.id); if (!p) return;
      room.results = room.results.filter(r => r.playerId !== p.id);
      p.state = null; p.lastStateAt = 0;
      send(client.ws, { type: 'playerRestarted' });
      broadcastRoom(room);
      break;
    }
    case 'returnToLobby': {
      if (!room) return publicError(client.ws, 'not_in_room', 'Join a room first.');
      if (client.id !== room.hostId) return publicError(client.ws, 'host_only', 'Only the host can return everyone to the lobby.');
      if (room.startTimer) clearTimeout(room.startTimer);
      room.startTimer = null; room.status = 'lobby'; room.startAt = 0; room.results = [];
      for (const p of room.players.values()) { p.ready = p.id === room.hostId; p.state = null; p.lastStateAt = 0; }
      broadcastRoom(room);
      break;
    }
    case 'leaveRoom': {
      detachClient(client, true);
      send(client.ws, { type: 'leftRoom' });
      break;
    }
    case 'ping': send(client.ws, { type: 'pong', at: Number(message.at) || Date.now() }); break;
    default: publicError(client.ws, 'unknown_message', 'Unknown multiplayer message.');
  }
}

function getLanIPv4Addresses() {
  const addresses = [];
  for (const list of Object.values(os.networkInterfaces())) for (const info of list || []) {
    if (info && info.family === 'IPv4' && !info.internal) addresses.push(info.address);
  }
  return [...new Set(addresses)];
}
function contentType(file) { return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'; }
function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed'); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname); }
  catch (_) { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const addresses = getLanIPv4Addresses();
    res.end(JSON.stringify({ ok: true, app: 'Pixel Corsa LAN Server', mode: 'LAN only', port: PORT, rooms: rooms.size, clients: clients.size, addresses: addresses.map(address => `http://${address}:${PORT}`) }));
    return;
  }
  if (pathname === '/multiplayer') { res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Use a WebSocket connection at /multiplayer.'); return; }
  if (pathname === '/') pathname = '/index.html';
  const fullPath = path.resolve(ROOT, '.' + pathname);
  if (fullPath !== ROOT && !fullPath.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(fullPath, (statErr, stats) => {
    if (statErr || !stats.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Not found'); return; }
    const cacheControl = /\.(html|js|css|webmanifest)$/.test(fullPath) ? 'no-store' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': contentType(fullPath), 'Content-Length': stats.size, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cacheControl });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(fullPath);
    stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end('Could not read file'); });
    stream.pipe(res);
  });
}

const server = http.createServer(serveStatic);
server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname; } catch (_) { /* rejected below */ }
  if (pathname !== '/multiplayer') { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' || parsed.host !== req.headers.host) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
    } catch (_) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers['sec-websocket-version'] !== '13' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
  }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const ws = new LanWebSocket(socket);
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  handleWsConnection(ws, req);
  if (head && head.length) ws.consume(head);
});
function handleWsConnection(ws, req) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const client = { id, ws, name: 'Driver', livery: 'redbull', roomCode: null, lastPing: Date.now() };
  clients.set(id, client);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { type: 'connected', playerId: id, maxPlayers: MAX_PLAYERS, serverVersion: '0.3.0-lan' });
  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch (_) { return error(ws, 'invalid_json', 'The server received an invalid message.'); }
    handleMessage(client, message);
  });
  ws.on('error', err => console.warn(`WebSocket error for ${id}:`, err.message));
  ws.on('close', () => { detachClient(client, true); clients.delete(id); });
}
const heartbeat = setInterval(() => {
  for (const ws of wsClients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 25000);
server.on('close', () => clearInterval(heartbeat));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other server or set PORT to another port.`);
  else console.error('Server error:', err);
  clearInterval(heartbeat);
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 50);
});
server.listen(PORT, HOST, () => {
  console.log('\n=============================================');
  console.log('       PIXEL CORSA — LAN MULTIPLAYER');
  console.log('=============================================');
  console.log(`Server port: ${PORT}`);
  console.log(`Host-local URL: http://localhost:${PORT}`);
  console.log('\nShare one of these URLs with people on the same Wi-Fi/LAN:');
  const addresses = getLanIPv4Addresses();
  if (addresses.length) for (const address of addresses) console.log(`  http://${address}:${PORT}`);
  else console.log(`  Find this PC's Wi-Fi IPv4 address with ipconfig, then open http://<IPv4>:${PORT}`);
  console.log('\nPlayers must be on the same local network. This build is LAN-only.');
  console.log('If Windows Firewall asks, allow Node.js on Private networks only.');
  console.log('Press Ctrl+C to stop the server.\n');
});
