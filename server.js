'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Room, GameError, CONFIG, validateConfig } = require('./game');
const { loadCards } = require('./server/cards');

process.on('uncaughtException', e => console.error('[uncaught]', e));
process.on('unhandledRejection', e => console.error('[unhandled]', e));

const CARDS_DIR = path.join(__dirname, 'cards');
const CARDS = loadCards(CARDS_DIR);
console.log(CARDS.ready ? `[cards] โหลด ${CARDS.cards.length} ชิ้น version ${CARDS.version}` : `[cards] ไม่พร้อม: ${CARDS.problem}`);

// R-3-01 (ตรวจ fleet กับ catalog ด้วยเมื่อข้อมูลชิ้นพร้อม)
const cfgErrors = validateConfig(CONFIG, CARDS.ready ? CARDS.cards.map(c => c.id) : null);
if (cfgErrors.length) { cfgErrors.forEach(e => console.error('[config] ' + e)); process.exit(1); }

const app = express();
app.disable('x-powered-by');
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/api/cards', (req, res) => res.json({ version: CARDS.version, cards: CARDS.cards, fit: CARDS.fit }));
app.use('/cards', express.static(CARDS_DIR, { maxAge: '30d' }));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });

const rooms = new Map();           // code -> Room
const sockRoom = new Map();        // socket.id -> { code, pid }

function newCode() {
  for (;;) {
    let c = String(1 + crypto.randomInt(9));        // [แก้ v2.2] ตัวแรก 1–9
    for (let i = 1; i < CONFIG.ROOM_CODE_LEN; i++) c += CONFIG.ROOM_CODE_CHARS[crypto.randomInt(CONFIG.ROOM_CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const logEvent = e => console.log(JSON.stringify(e)); // หัวข้อ 12: event log ไม่มี token

const pending = new Set();
function scheduleBroadcast(room) {
  if (pending.has(room)) return;
  pending.add(room);
  setImmediate(() => {
    pending.delete(room);
    try { broadcast(room); } catch (e) { console.error('[broadcast]', e); }
  });
}
function broadcast(room) {
  const notices = room.drainNotices(); // 'all' = ทุกคนในห้อง, pid = ส่วนตัว (R-4-04, R-10-05)
  for (const [sid, info] of sockRoom) {
    if (info.code !== room.code) continue;
    const s = io.sockets.sockets.get(sid);
    if (!s || !room.seat(info.pid)) continue;
    s.emit('state', room.getState(info.pid));
    const mine = notices.filter(n => n.to === 'all' || n.to === info.pid).map(({ to, ...n }) => n);
    if (mine.length) s.emit('notice', mine);
  }
}
function socketsOf(code, pid) {
  return [...sockRoom.entries()].filter(([, v]) => v.code === code && v.pid === pid).map(([sid]) => sid);
}
function attach(socket, room, pid) {
  // R-8-05 socket ใหม่แทนที่ socket เก่าของที่นั่งเดียวกัน
  for (const sid of socketsOf(room.code, pid)) {
    if (sid === socket.id) continue;
    const old = io.sockets.sockets.get(sid);
    sockRoom.delete(sid);
    if (old) { old.emit('replaced'); old.disconnect(true); }
  }
  sockRoom.set(socket.id, { code: room.code, pid });
  room.setConnected(pid, true);
}
function detach(socket) {
  const info = sockRoom.get(socket.id);
  if (!info) return;
  sockRoom.delete(socket.id);
  const room = rooms.get(info.code);
  if (room && !socketsOf(info.code, info.pid).length) { room.setConnected(info.pid, false); scheduleBroadcast(room); }
}

function safe(ack, fn) {
  const reply = typeof ack === 'function' ? ack : () => {};
  try { reply({ ok: true, ...(fn() || {}) }); }
  catch (e) {
    if (e instanceof GameError) reply({ ok: false, code: e.code, reason: e.reason, error: e.message });
    else { console.error('[handler]', e); reply({ ok: false, code: 'SERVER', error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' }); }
  }
}
const notReady = () => new GameError('CARDS_NOT_READY', 'ข้อมูลการ์ดไม่พร้อม');
const obj = p => (p && typeof p === 'object' ? p : {});

io.on('connection', socket => {
  socket.on('create', (p, ack) => safe(ack, () => {
    if (!CARDS.ready) throw notReady();                    // R-5-01
    const code = newCode();
    const room = new Room(code, { cards: CARDS.cards, onLog: logEvent });
    const { pid, token } = room.addPlayer(obj(p).name);
    rooms.set(code, room);
    detach(socket); attach(socket, room, pid); scheduleBroadcast(room);
    return { code, pid, token };
  }));
  socket.on('join', (p, ack) => safe(ack, () => {
    const code = String(obj(p).code || '').replace(/\s/g, '').toUpperCase().slice(0, 10);
    const room = rooms.get(code);
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'ไม่พบห้องนี้');   // R-5-04
    const { pid, token } = room.addPlayer(obj(p).name);
    detach(socket); attach(socket, room, pid); scheduleBroadcast(room);
    return { code, pid, token };
  }));
  socket.on('resume', (p, ack) => safe(ack, () => {
    const code = String(obj(p).code || '').toUpperCase().slice(0, 10);
    const room = rooms.get(code);
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'การเชื่อมต่อหาย กรุณาสร้างห้องใหม่'); // R-8-10
    const pid = room.resume(obj(p).token);
    detach(socket); attach(socket, room, pid); scheduleBroadcast(room);
    return { code, pid };
  }));
  socket.on('leave', (p, ack) => safe(ack, () => {
    const info = sockRoom.get(socket.id);
    if (!info) return {};
    const room = rooms.get(info.code);
    for (const sid of socketsOf(info.code, info.pid)) sockRoom.delete(sid);
    if (room) { room.leave(info.pid); scheduleBroadcast(room); }
    return {};
  }));
  socket.on('action', (p, ack) => safe(ack, () => {
    const info = sockRoom.get(socket.id);
    const room = info && rooms.get(info.code);
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'การเชื่อมต่อหาย กรุณาสร้างห้องใหม่');
    const r = room.action(info.pid, p);
    scheduleBroadcast(room);
    return r && r.placement !== undefined ? { placement: r.placement, islands: r.islands } : {};
  }));
  socket.on('disconnect', () => { try { detach(socket); } catch (e) { console.error('[disconnect]', e); } });
});

// งานเบื้องหลัง: เวลาเฟส การหลุด และลบห้องร้าง (R-8-01..R-8-04, R-8-09)
setInterval(() => {
  for (const [code, room] of rooms) {
    try {
      if (room.tick()) scheduleBroadcast(room);
      if (room.expired()) {
        rooms.delete(code);
        for (const [sid, v] of sockRoom) if (v.code === code) sockRoom.delete(sid);
        logEvent({ t: Date.now(), room: code, type: 'room_closed' });
      }
    } catch (e) { console.error('[tick]', code, e); }
  }
}, 500);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => console.log(`Battle Weed: Green Social พร้อมที่พอร์ต ${PORT}`));
