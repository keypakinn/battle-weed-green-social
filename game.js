'use strict';
// กติกาทั้งหมดของ Battle Weed: Green Social (spec v2.5) — ไม่ import express/socket.io
// รหัสกติกา R-x-yy อ้างถึงหัวข้อใน spec.md
const crypto = require('crypto');

// หัวข้อ 3: ค่าคงที่ทุกตัวอยู่ที่นี่ที่เดียว
const CONFIG = Object.freeze({
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 7,
  SIMUL_MIN_PLAYERS: 3,
  CLASSIC_BOARD: 11,
  CLASSIC_FLEET: ['bong', 'grinder', 'pipe', 'joint', 'lighter'],
  // [แก้ v2.5 D-51..D-53] ชุดชิ้นเดียวใช้ทุกโหมด 27 ช่อง (ไม่มี id รุ่น -s แล้ว) · กระดานเล็กลงตามสัดส่วน
  SURVIVAL_BOARD: { 2: 13, 3: 15, 4: 15, 5: 16, 6: 17, 7: 17 },
  SURVIVAL_FLEET: {
    2: ['bong', 'grinder', 'pipe', 'joint', 'lighter'], 3: ['bong', 'grinder', 'pipe', 'joint', 'lighter'],
    4: ['grinder', 'pipe', 'joint', 'lighter'], 5: ['grinder', 'pipe', 'joint', 'lighter'],
    6: ['pipe', 'joint', 'lighter'], 7: ['pipe', 'joint', 'lighter'],
  },
  PLACE_TIME: 120,          // วินาที
  ISLAND_DRAW_TIME: 60,     // วินาที เพิ่มเมื่อเกาะแบบวาดเอง
  SHOT_TIME: 15,            // วินาทีต่อตา (ค่าเริ่มต้นของ settings.shotTime)
  SHOT_TIME_CHOICES: [10, 15, 20, 25, 30, 40],   // [ใหม่ v2.7] R-5-21 host เลือกได้
  ROUND_TIME_DOUBLE: 20,    // วินาที รอบที่มีคนได้ 2 นัด (Q78)
  MAX_SHOTS_PER_ROUND: 12,          // [แก้ v2.7] เพดานรวมนัดต่อรอบ (พื้นฐาน + โบนัส)
  AUTO_SHOT_LIMIT: 3,
  RECONNECT_GRACE: 60,
  ROOM_IDLE_CLOSE: 600,
  ISLAND_CELLS: 8,
  ISLAND_MIN_GROUP: 4,
  ISLAND_RANDOM_MAX_SHARED: 2,
  TRAP_RATE: 0.02,
  ANIM_BULLET_MS: 1000,
  ANIM_EFFECT_MS: 1000,
  SUNK_REVEAL_MS: 2000,
  IMAGE_MARGIN: 0.12,
  ROOM_CODE_LEN: 4,                 // [แก้ v2.2] รหัสห้องตัวเลข 4 หลัก ตัวแรกไม่ใช่ 0
  ROOM_CODE_CHARS: '0123456789',
  NAME_MAX: 16,
  CHAT_MAX: 100,                    // [ใหม่ v2.4] R-5-15 ตัวอักษรต่อข้อความ
  CHAT_COOLDOWN_MS: 1000,           // [ใหม่ v2.4] ส่งถี่กว่านี้ไม่ได้
  CHAT_KEEP: 30,                    // [ใหม่ v2.4] R-5-16 ข้อความล่าสุดที่เก็บต่อห้อง
  VOICE_MAX: 7,                     // [ใหม่ v2.4] R-5-17
  RTC_DATA_MAX: 8192,               // [ใหม่ v2.4] R-5-19 ไบต์ของข้อมูล signaling
  TURN_BANNER_MS: 3000,             // [ใหม่ v2.5] R-10-12 แบนเนอร์ "ตาคุณ!" แสดงกี่ ms
  COUNTDOWN_FROM: 5,                // [ใหม่ v2.4] R-10-06 นับถอยหลังตัวใหญ่เมื่อเหลือ ≤ ค่านี้
  ROOM_NAME_MAX: 20,                // [ใหม่ v2.3] R-5-09
  ROOM_PASSWORD_RE: /^[0-9]{4}$/,   // [ใหม่ v2.3] R-5-10 รหัสผ่านตัวเลข 4 หลัก
  MIN_AGE: 20,
  PLAYER_COLORS: ['#F2C230', '#FF5FA2', '#F5F5F5', '#E53935', '#A1673A', '#FFB74D', '#3F51B5'],
  REQID_MEMORY: 50,
  SUGGEST_COOLDOWN: 1,
  MIN_SCREEN_PX: 360,
});

// R-3-01 ตรวจ config ตอนเริ่ม (catalogIds = id ใน cards/data.csv) คืนรายการปัญหา
function validateConfig(c, catalogIds) {
  const errs = [];
  for (const k of ['PLACE_TIME', 'ISLAND_DRAW_TIME', 'SHOT_TIME', 'ROUND_TIME_DOUBLE', 'RECONNECT_GRACE', 'ROOM_IDLE_CLOSE']) {
    if (!Number.isInteger(c[k]) || c[k] < 5) errs.push(`${k} ต้องเป็นจำนวนเต็ม >= 5 (ได้ ${c[k]})`);
  }
  if (!Number.isInteger(c.AUTO_SHOT_LIMIT) || c.AUTO_SHOT_LIMIT < 1) errs.push('AUTO_SHOT_LIMIT ต้อง >= 1');
  if (c.PLAYER_COLORS.length < c.MAX_PLAYERS) errs.push('PLAYER_COLORS ต้องมีอย่างน้อย MAX_PLAYERS สี');
  for (let n = c.MIN_PLAYERS; n <= c.MAX_PLAYERS; n++) {
    if (!Number.isInteger(c.SURVIVAL_BOARD[n])) errs.push(`SURVIVAL_BOARD ไม่มีค่าของ ${n} คน`);
    if (!Array.isArray(c.SURVIVAL_FLEET[n]) || !c.SURVIVAL_FLEET[n].length) errs.push(`SURVIVAL_FLEET ไม่มีค่าของ ${n} คน`);
  }
  if (catalogIds) {
    const ids = new Set(catalogIds);
    const all = [...c.CLASSIC_FLEET, ...Object.values(c.SURVIVAL_FLEET).flat()];
    for (const id of new Set(all)) if (!ids.has(id)) errs.push(`fleet อ้าง id "${id}" ที่ไม่มีใน catalog`);
  }
  return errs;
}

class GameError extends Error {
  constructor(code, message, reason) { super(message); this.code = code; this.reason = reason; }
}
const MSG = {
  ROOM_NAME_INVALID: 'ชื่อห้อง 1–20 ตัวอักษร', PASSWORD_INVALID: 'รหัสผ่านต้องเป็นตัวเลข 4 หลัก', BAD_PASSWORD: 'รหัสผ่านไม่ถูกต้อง',
  CHAT_INVALID: 'ข้อความต้องยาว 1–100 ตัวอักษร', CHAT_RATE: 'ส่งข้อความถี่เกินไป รอสักครู่', VOICE_INVALID: 'ใช้เสียงสดตอนนี้ไม่ได้',
  ROOM_FULL: 'ห้องนี้เต็มหรือเริ่มเกมแล้ว', NAME_INVALID: 'กรุณาใส่ชื่อ 1–16 ตัวอักษร', BAD_PHASE: 'ทำแบบนี้ตอนนี้ไม่ได้',
  ALREADY_PLACED: 'ยืนยันการวางไปแล้ว', PLACEMENT_INVALID: 'การวางไม่ถูกต้อง', NOT_YOUR_TURN: 'ยังยิงไม่ได้ตอนนี้',
  OUT_OF_BOUNDS: 'พิกัดอยู่นอกกระดาน', ALREADY_SHOT: 'ช่องนี้ถูกยิงแล้ว', STALE_TURN: 'ตานี้ผ่านไปแล้ว',
  BAD_REQUEST: 'คำสั่งไม่ถูกต้อง', BAD_TOKEN: 'ที่นั่งนี้ใช้ไม่ได้แล้ว', NOT_HOST: 'เฉพาะหัวห้องเท่านั้น',
  BOARD_REPEAT: 'นัดพื้นฐานต้องยิงคนละกระดาน',   // [ใหม่ v2.7] R-7-17
  SETTINGS_INVALID: 'ค่าที่ตั้งไม่ถูกต้อง',        // [ใหม่ v2.7]
  NOT_ENOUGH_PLAYERS: 'ต้องมีผู้เล่นอย่างน้อย 2 คน', BAD_TARGET: 'ยิงกระดานนี้ไม่ได้', SHOT_COUNT: 'จำนวนนัดไม่ถูกต้อง',
  ALREADY_SUBMITTED: 'ส่งนัดของรอบนี้แล้ว', DOUBLE_INVALID: 'นัดคู่ต้องยิง 2 ช่องติดกันที่ยังไม่ถูกยิง',
  CARDS_NOT_READY: 'ข้อมูลชิ้นไม่พร้อม',
};
const REASON_MSG = {
  PIECES: 'ต้องวางอุปกรณ์ทุกชิ้น ชิ้นละครั้ง', BOUNDS: 'มีชิ้นล้นออกนอกกระดาน', ROT: 'การหมุนไม่ถูกต้อง',
  OVERLAP: 'อุปกรณ์ของคุณวางซ้อนกัน', ISLANDS: 'เกาะต้องครบจำนวนช่อง และแต่ละเกาะต่อกันอย่างน้อย 4 ช่อง',
};
const err = (code, reason) => new GameError(code, reason ? REASON_MSG[reason] : MSG[code], reason);
const isInt = v => Number.isInteger(v);

// ---------- รูปช่อง (R-4.1-03, R-4.1-05) ----------
// "XX./XXX" -> [[r,c],...] หรือ null ถ้าผิดรูปแบบ
function parseShape(str) {
  if (typeof str !== 'string' || !/^[X.]+(\/[X.]+)*$/.test(str)) return null;
  const rows = str.split('/');
  if (rows.some(r => r.length !== rows[0].length)) return null;
  const cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') cells.push([r, c]); }));
  if (!cells.length || cells.length > 30) return null;
  const set = new Set(cells.map(([r, c]) => r + ',' + c));
  const seen = new Set([cells[0].join(',')]); const q = [cells[0]];
  while (q.length) {
    const [r, c] = q.pop();
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (r + dr) + ',' + (c + dc);
      if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([r + dr, c + dc]); }
    }
  }
  return seen.size === cells.length ? cells : null;
}
function rotateCells(cells, rot) { // R-4.1-05 หมุน 90° ตามเข็ม (r,c)->(c,H-1-r) ไม่มีกลับด้าน
  let cur = cells.map(x => [...x]);
  for (let i = 0; i < rot; i++) {
    const H = Math.max(...cur.map(x => x[0])) + 1;
    cur = cur.map(([r, c]) => [c, H - 1 - r]);
  }
  const mr = Math.min(...cur.map(x => x[0])), mc = Math.min(...cur.map(x => x[1]));
  return cur.map(([r, c]) => [r - mr, c - mc]);
}

const cryptoRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

class Room {
  constructor(code, { cards, rand = cryptoRand, now = () => Date.now(), onLog = () => {}, config = CONFIG } = {}) {
    if (!Array.isArray(cards) || !cards.length) throw new Error('ต้องมี catalog ชิ้น');
    this.code = code;
    this.catalog = new Map(cards.map(c => [c.id, { id: c.id, name: c.name, shape: parseShape(c.shape) }]));
    this.rand = rand; this.now = now; this.onLog = onLog; this.C = config;
    this.players = []; this.joinSeq = 0;
    this.hostPid = null;
    this.settings = { mode: 'classic', bonusOnHit: true, islands: 'off', traps: false, shotsPerTurn: 1, shotTime: 15 }; // R-5-01 · [ใหม่ v2.7] R-5-20, R-5-21
    this.meta = { name: '', private: false, password: null };                          // R-5-09, R-5-10
    this.phase = 'LOBBY'; this.gameNo = 0;
    this.turnStyle = null; this.boardSize = null; this.fleet = [];
    this.turnPid = null; this.turnNo = 0; this.roundNo = 0; this.deadline = null;
    this.boards = new Map(); this.lastResolve = []; this.result = null; this.prev = null;
    this.elimCount = 0; this.emptySince = null; this.log = []; this.notices = [];
    this.chatLog = []; this.chatSeq = 0; this.chatOut = [];   // [ใหม่ v2.4] R-5-16 แชท (ไม่เก็บถาวร ไม่ลง log)
    this.voice = new Set();                                    // [ใหม่ v2.4] R-5-17 pid ที่เปิดเสียงสดอยู่
  }

  // ---------- เครื่องมือ ----------
  _log(type, data = {}) {
    const e = { t: this.now(), room: this.code, game: this.gameNo, type, ...data };
    this.log.push(e); if (this.log.length > 3000) this.log.shift();
    this.onLog(e);
  }
  _notice(to, kind, text, data = {}) { this.notices.push({ to, kind, text, ...data }); }
  drainNotices() { const n = this.notices; this.notices = []; return n; }
  seat(pid) { return this.players.find(p => p.pid === pid && !p.removed); }
  _need(pid) { const s = this.seat(pid); if (!s) throw err('BAD_TOKEN'); return s; }
  active() { return this.players.filter(p => !p.removed); }
  alive() { return this.players.filter(p => p.alive && !p.removed); }
  _rint(n) { return Math.floor(this.rand() * n); }
  _key(r, c) { return r * this.boardSize + c; }
  _rc(k) { return [Math.floor(k / this.boardSize), k % this.boardSize]; }
  _pieceName(id) { return (this.catalog.get(id) || {}).name || id; }

  // ---------- ห้อง (R-5-01..R-5-08) ----------
  addPlayer(rawName) {
    if (typeof rawName !== 'string') throw err('NAME_INVALID');
    let name = rawName.trim();
    if (!name || [...name].length > this.C.NAME_MAX) throw err('NAME_INVALID');
    const act = this.active();
    if (this.phase !== 'LOBBY' || act.length >= this.C.MAX_PLAYERS) throw err('ROOM_FULL');   // R-5-04
    if (act.some(p => p.name === name)) {                                                     // R-5-02
      let i = 2; while (act.some(p => p.name === `${name} (${i})`)) i++;
      name = `${name} (${i})`;
    }
    const used = new Set(act.map(p => p.color));
    const seat = {
      pid: crypto.randomBytes(8).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
      name, color: this.C.PLAYER_COLORS.find(c => !used.has(c)), joinSeq: this.joinSeq++,   // R-5-07
      connected: true, disconnectedAt: null, reqIds: [], lastSuggest: 0, removed: false,
    };
    this._resetSeat(seat);
    this.players.push(seat);
    if (!this.hostPid || !this.seat(this.hostPid)) this.hostPid = seat.pid;
    this.emptySince = null;
    this._log('join', { pid: seat.pid, name });
    return { pid: seat.pid, token: seat.token };
  }
  _resetSeat(s) {
    Object.assign(s, {
      ready: false, alive: true, wantsRematch: false, placement: null, pieces: [], islands: [],
      autoStreak: 0, shotsAllowed: 1, shotsBase: 1, bonusShots: 0, doubleBonus: false, skipNext: false, hitsOnOthers: 0, aim: null,
      pending: null, elimAt: null, elimReason: null, shots: 0, hits: 0,
    });
  }
  resume(token) {
    const s = typeof token === 'string' && this.players.find(p => p.token === token && !p.removed);
    if (!s) throw err('BAD_TOKEN');
    s.connected = true; s.disconnectedAt = null; this.emptySince = null;
    this._log('rejoin', { pid: s.pid, ok: true });
    return s.pid;
  }
  setConnected(pid, on) {
    const s = this.seat(pid); if (!s) return;
    s.connected = on; s.disconnectedAt = on ? null : this.now();
    if (!on) { this.voice.delete(pid); this._log('disconnect', { pid }); }   // R-5-17 หลุด = ออกจากเสียงสด
    this._checkEmpty();
  }
  _checkEmpty() {
    if (!this.active().some(p => p.connected)) { if (this.emptySince == null) this.emptySince = this.now(); }
    else this.emptySince = null;
  }
  _fixHost() { // R-5-08
    if (this.seat(this.hostPid)) return;
    const next = this.active().sort((a, b) => a.joinSeq - b.joinSeq)[0];
    this.hostPid = next ? next.pid : null;
    if (next) this._notice('all', 'host', `${next.name} เป็นหัวห้องแล้ว`);
  }
  _removeSeat(pid) {
    const s = this.players.find(p => p.pid === pid); if (!s) return;
    this.voice.delete(pid);
    if (this.phase === 'LOBBY') this.players = this.players.filter(p => p.pid !== pid);
    else s.removed = true;
    this._fixHost(); this._checkEmpty();
  }
  _purgeRemoved() { this.players = this.players.filter(p => !p.removed); this._fixHost(); }

  // ---------- เริ่มเกม ----------
  _startGame() { // R-5-06, R-8-09
    this._purgeRemoved();
    const act = this.active();
    const n = act.length;
    this.gameNo++;
    const st = this.settings;
    this.turnStyle = n >= this.C.SIMUL_MIN_PLAYERS ? 'rounds' : 'turns';
    this.boardSize = st.mode === 'classic' ? this.C.CLASSIC_BOARD : this.C.SURVIVAL_BOARD[n];
    const ids = st.mode === 'classic' ? this.C.CLASSIC_FLEET : this.C.SURVIVAL_FLEET[n];
    this.fleet = ids.map(id => ({ id, name: this._pieceName(id), shape: this.catalog.get(id).shape }));
    for (const s of act) this._resetSeat(s);
    this.phase = 'PLACING';
    this.turnPid = null; this.turnNo = 0; this.roundNo = 0; this.lastResolve = []; this.result = null;
    this.boards = new Map(); this.elimCount = 0;
    if (st.islands === 'random') this._randomIslandsAll();                    // R-7-06
    this.deadline = this.now() + (this.C.PLACE_TIME + (st.islands === 'draw' ? this.C.ISLAND_DRAW_TIME : 0)) * 1000;
    this._log('game_start', { pids: act.map(p => p.pid), mode: st.mode, n, board: this.boardSize, settings: { ...st } });
  }

  // ---------- การวาง ----------
  _pieceAbs(p) { // {pieceId,row,col,rot} -> [[r,c]]
    const f = this.fleet.find(x => x.id === p.pieceId);
    return rotateCells(f.shape, p.rot).map(([r, c]) => [r + p.row, c + p.col]);
  }
  validatePlacement(placement) { // R-7-01..R-7-03 คืน [{id, cells:[key]}]
    if (!Array.isArray(placement)) throw err('BAD_REQUEST');
    for (const p of placement) if (!p || typeof p !== 'object' || typeof p.pieceId !== 'string') throw err('BAD_REQUEST');
    const ids = new Set(this.fleet.map(f => f.id)); const seen = new Set();
    for (const p of placement) {
      if (!ids.has(p.pieceId) || seen.has(p.pieceId)) throw err('PLACEMENT_INVALID', 'PIECES');
      seen.add(p.pieceId);
    }
    if (seen.size !== this.fleet.length) throw err('PLACEMENT_INVALID', 'PIECES');
    for (const p of placement) if (![0, 1, 2, 3].includes(p.rot)) throw err('PLACEMENT_INVALID', 'ROT');
    const B = this.boardSize; const used = new Set(); const pieces = [];
    for (const p of placement) {
      if (!isInt(p.row) || !isInt(p.col)) throw err('PLACEMENT_INVALID', 'BOUNDS');
      const cells = this._pieceAbs(p);
      if (cells.some(([r, c]) => r < 0 || c < 0 || r >= B || c >= B)) throw err('PLACEMENT_INVALID', 'BOUNDS');
      pieces.push({ id: p.pieceId, row: p.row, col: p.col, rot: p.rot, cells: cells.map(([r, c]) => this._key(r, c)) });
    }
    for (const pc of pieces) for (const k of pc.cells) {
      if (used.has(k)) throw err('PLACEMENT_INVALID', 'OVERLAP');                // R-7-03 ของตัวเองห้ามทับ
      used.add(k);
    }
    return pieces;
  }
  _groups(keys) {
    const set = new Set(keys); const seen = new Set(); const out = [];
    for (const k of keys) {
      if (seen.has(k)) continue;
      const g = []; const q = [k]; seen.add(k);
      while (q.length) {
        const x = q.pop(); g.push(x); const [r, c] = this._rc(x);
        for (const [dr, dc] of NB4) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= this.boardSize || cc >= this.boardSize) continue;
          const y = this._key(rr, cc);
          if (set.has(y) && !seen.has(y)) { seen.add(y); q.push(y); }
        }
      }
      out.push(g.sort((a, b) => a - b));
    }
    return out;
  }
  validateIslands(list) { // R-7-05
    if (!Array.isArray(list) || list.length !== this.C.ISLAND_CELLS) throw err('PLACEMENT_INVALID', 'ISLANDS');
    const B = this.boardSize; const keys = [];
    for (const x of list) {
      if (!Array.isArray(x) || !isInt(x[0]) || !isInt(x[1]) || x[0] < 0 || x[1] < 0 || x[0] >= B || x[1] >= B) throw err('PLACEMENT_INVALID', 'ISLANDS');
      keys.push(this._key(x[0], x[1]));
    }
    if (new Set(keys).size !== keys.length) throw err('PLACEMENT_INVALID', 'ISLANDS');
    const groups = this._groups(keys);
    if (groups.some(g => g.length < this.C.ISLAND_MIN_GROUP)) throw err('PLACEMENT_INVALID', 'ISLANDS');
    return groups;
  }
  randomPlacement() { // R-7-06, R-3-02 ชิ้นใหญ่ก่อน
    const B = this.boardSize;
    const order = [...this.fleet].sort((a, b) => b.shape.length - a.shape.length);
    for (let set = 0; set < 50; set++) {
      const used = new Set(); const out = []; let ok = true;
      for (const f of order) {
        let placed = false;
        for (let t = 0; t < 2000 && !placed; t++) {
          const rot = this._rint(4); const cells = rotateCells(f.shape, rot);
          const h = Math.max(...cells.map(x => x[0])) + 1, w = Math.max(...cells.map(x => x[1])) + 1;
          if (h > B || w > B) continue;
          const row = this._rint(B - h + 1), col = this._rint(B - w + 1);
          const ks = cells.map(([r, c]) => this._key(r + row, c + col));
          if (ks.some(k => used.has(k))) continue;
          ks.forEach(k => used.add(k)); out.push({ pieceId: f.id, row, col, rot }); placed = true;
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return out;
    }
    return null;
  }
  _randomBlob(size, forbid) {
    const B = this.boardSize;
    for (let t = 0; t < 500; t++) {
      const start = this._key(this._rint(B), this._rint(B));
      if (forbid(start)) continue;
      const blob = [start]; const inBlob = new Set(blob);
      while (blob.length < size) {
        const front = [];
        for (const k of blob) {
          const [r, c] = this._rc(k);
          for (const [dr, dc] of NB4) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= B || cc >= B) continue;
            const y = this._key(rr, cc);
            if (!inBlob.has(y) && !forbid(y)) front.push(y);
          }
        }
        if (!front.length) break;
        const y = front[this._rint(front.length)]; blob.push(y); inBlob.add(y);
      }
      if (blob.length === size) return blob;
    }
    return null;
  }
  randomIslands(othersCells) { // คืน [[r,c]] ISLAND_CELLS ช่อง กลุ่มละ ISLAND_MIN_GROUP
    const n = this.C.ISLAND_CELLS, g = this.C.ISLAND_MIN_GROUP;
    const sizes = []; let left = n;
    while (left > 0) { const s = left - g < g ? left : g; sizes.push(s); left -= s; }
    for (let set = 0; set < 50; set++) {
      const mine = new Set(); let shared = 0; let ok = true;
      for (const sz of sizes) {
        const nb = new Set();
        for (const k of mine) { const [r, c] = this._rc(k); for (const [dr, dc] of NB4) { const rr = r + dr, cc = c + dc; if (rr >= 0 && cc >= 0 && rr < this.boardSize && cc < this.boardSize) nb.add(this._key(rr, cc)); } }
        let blob = null;
        for (let t = 0; t < 30 && !blob; t++) {
          const b = this._randomBlob(sz, k => mine.has(k) || nb.has(k));
          if (!b) continue;
          const sh = othersCells ? b.filter(k => othersCells.has(k)).length : 0;
          if (shared + sh <= this.C.ISLAND_RANDOM_MAX_SHARED) { blob = b; shared += sh; }
        }
        if (!blob) { ok = false; break; }
        blob.forEach(k => mine.add(k));
      }
      if (ok) return [...mine].map(k => this._rc(k));
    }
    return null;
  }
  _randomIslandsAll() {
    const classic = this.settings.mode === 'classic';
    const taken = new Set();
    for (const s of this.active()) {
      const isl = this.randomIslands(classic ? null : taken);
      s.islands = isl ? this._groups(isl.map(([r, c]) => this._key(r, c))) : [];
      if (!classic) s.islands.flat().forEach(k => taken.add(k));
    }
  }

  // ---------- Actions ----------
  action(pid, msg) {
    const s = this._need(pid);
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw err('BAD_REQUEST');
    if (msg.reqId != null) { // R-7-16
      if (typeof msg.reqId !== 'string' || msg.reqId.length > 40) throw err('BAD_REQUEST');
      if (s.reqIds.includes(msg.reqId)) return { dup: true };
      s.reqIds.push(msg.reqId); if (s.reqIds.length > this.C.REQID_MEMORY) s.reqIds.shift();
    }
    switch (msg.type) {
      case 'update_settings': return this._settings(s, msg.settings);
      case 'room_meta': return this._meta(s, msg.meta);
      case 'start_game': return this._start(s);
      case 'suggest_placement': return this._suggest(s);
      case 'submit_placement': return this._submit(s, msg.placement, msg.islands);
      case 'fire': return this._fire(s, msg);
      case 'aim': return this._aim(s, msg);
      case 'resign': return this._resign(s);
      case 'rematch': return this._rematch(s, msg.want);
      case 'back_to_lobby': return this._backToLobby(s);
      case 'chat': return this._chat(s, msg.text);
      case 'voice_join': return this._voiceJoin(s);
      case 'voice_leave': this.voice.delete(s.pid); return {};
      default: throw err('BAD_REQUEST');
    }
  }
  // [ใหม่ v2.4] R-5-15 / R-5-16 แชทข้อความ (ทุก phase รวมคนตกรอบ) ข้อความไม่ลง event log
  _chat(s, raw) {
    if (typeof raw !== 'string') throw err('CHAT_INVALID');
    const text = raw.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || [...text].length > this.C.CHAT_MAX) throw err('CHAT_INVALID');
    const t = this.now();
    if (s.lastChat != null && t - s.lastChat < this.C.CHAT_COOLDOWN_MS) throw err('CHAT_RATE');
    s.lastChat = t;
    const m = { id: ++this.chatSeq, pid: s.pid, name: s.name, color: s.color, text, t };
    this.chatLog.push(m); if (this.chatLog.length > this.C.CHAT_KEEP) this.chatLog.shift();
    this.chatOut.push(m);
    return {};
  }
  drainChat() { const o = this.chatOut; this.chatOut = []; return o; }
  chatHistory() { return this.chatLog.map(m => ({ ...m })); }
  // [ใหม่ v2.4] R-5-17..R-5-19 เสียงสด: server เก็บแค่ว่าใครเปิดอยู่ และส่งต่อข้อความเชื่อมต่อ
  _voiceJoin(s) {
    if (!this.voice.has(s.pid) && this.voice.size >= this.C.VOICE_MAX) throw err('VOICE_INVALID');
    this.voice.add(s.pid);
    return { peers: [...this.voice].filter(p => p !== s.pid && this.seat(p) && this.seat(p).connected) };
  }
  // คืน pid ปลายทางที่ถูกต้อง หรือ throw VOICE_INVALID (ผู้ส่งและปลายทางอยู่ในห้องและอยู่ในเสียงสดทั้งคู่ ข้อมูล ≤ RTC_DATA_MAX)
  rtcTarget(fromPid, toPid, kind, data) {
    if (!this.seat(fromPid) || !this.seat(toPid) || fromPid === toPid) throw err('VOICE_INVALID');
    if (!this.voice.has(fromPid) || !this.voice.has(toPid)) throw err('VOICE_INVALID');
    if (!['offer', 'answer', 'ice'].includes(kind)) throw err('VOICE_INVALID');
    let size; try { size = Buffer.byteLength(JSON.stringify(data) || ''); } catch (e) { throw err('VOICE_INVALID'); }
    if (size > this.C.RTC_DATA_MAX) throw err('VOICE_INVALID');
    return toPid;
  }
  // [ใหม่ v2.3] R-5-09 / R-5-10 ชื่อห้อง + สาธารณะ/ส่วนตัว + รหัสผ่าน
  setMeta(v) {
    if (!v || typeof v !== 'object') throw err('BAD_REQUEST');
    const n = { ...this.meta };
    if ('name' in v) {
      if (typeof v.name !== 'string') throw err('ROOM_NAME_INVALID');
      const name = v.name.trim().replace(/\s+/g, ' ');
      if (!name || [...name].length > this.C.ROOM_NAME_MAX) throw err('ROOM_NAME_INVALID');
      n.name = name;
    }
    if ('private' in v) { if (typeof v.private !== 'boolean') throw err('BAD_REQUEST'); n.private = v.private; }
    if ('password' in v && v.password != null) {
      if (typeof v.password !== 'string' || !this.C.ROOM_PASSWORD_RE.test(v.password)) throw err('PASSWORD_INVALID');
      n.password = v.password;
    }
    if (n.private && !n.password) throw err('PASSWORD_INVALID');
    if (!n.private) n.password = null;
    this.meta = n;
    this._log('room_meta', { name: n.name, private: n.private });
    return {};
  }
  _meta(s, v) {
    if (s.pid !== this.hostPid) throw err('NOT_HOST');
    if (this.phase !== 'LOBBY' && this.phase !== 'GAME_OVER') throw err('BAD_PHASE');
    return this.setMeta(v);
  }
  checkPassword(pw) { // R-5-11
    if (!this.meta.private) return;
    if (typeof pw !== 'string' || pw !== this.meta.password) throw err('BAD_PASSWORD');
  }
  // R-5-12 ข้อมูลห้องสำหรับรายการห้องหน้าแรก (ไม่มีรหัสผ่าน ไม่มี token)
  summary() {
    const act = this.active();
    const host = this.seat(this.hostPid);
    const full = act.length >= this.C.MAX_PLAYERS;
    return {
      code: this.code, name: this.meta.name, host: host ? host.name : '', private: this.meta.private,
      players: act.length, max: this.C.MAX_PLAYERS,
      status: this.phase === 'LOBBY' ? (full ? 'full' : 'open') : 'playing',
      settings: { ...this.settings },
    };
  }
  listed() { return this.active().some(p => p.connected); }
  _settings(s, v) { // R-5-05
    if (s.pid !== this.hostPid) throw err('NOT_HOST');
    if (this.phase !== 'LOBBY' && this.phase !== 'GAME_OVER') throw err('BAD_PHASE');
    if (!v || typeof v !== 'object') throw err('BAD_REQUEST');
    const n = { ...this.settings };
    if ('mode' in v) { if (!['classic', 'survival'].includes(v.mode)) throw err('BAD_REQUEST'); n.mode = v.mode; }
    if ('bonusOnHit' in v) { if (typeof v.bonusOnHit !== 'boolean') throw err('BAD_REQUEST'); n.bonusOnHit = v.bonusOnHit; }
    if ('islands' in v) { if (!['off', 'random', 'draw'].includes(v.islands)) throw err('BAD_REQUEST'); n.islands = v.islands; }
    if ('traps' in v) { if (typeof v.traps !== 'boolean') throw err('BAD_REQUEST'); n.traps = v.traps; }
    // [ใหม่ v2.7] R-5-20 นัดต่อตา: 1 ถึง MAX_PLAYERS-1 (เพดานจริงตอนเล่นคิดจากคู่แข่งที่ยังอยู่)
    if ('shotsPerTurn' in v) {
      if (!isInt(v.shotsPerTurn) || v.shotsPerTurn < 1 || v.shotsPerTurn > this.C.MAX_PLAYERS - 1) throw err('SETTINGS_INVALID');
      n.shotsPerTurn = v.shotsPerTurn;
    }
    // [ใหม่ v2.7] R-5-21 เวลาต่อตา
    if ('shotTime' in v) {
      if (!this.C.SHOT_TIME_CHOICES.includes(v.shotTime)) throw err('SETTINGS_INVALID');
      n.shotTime = v.shotTime;
    }
    this.settings = n;
    return {};
  }
  _start(s) { // R-5-06
    if (s.pid !== this.hostPid) throw err('NOT_HOST');
    if (this.phase !== 'LOBBY') throw err('BAD_PHASE');
    if (this.active().filter(p => p.connected).length < this.C.MIN_PLAYERS) throw err('NOT_ENOUGH_PLAYERS');
    this._startGame();
    return {};
  }
  _suggest(s) {
    if (this.phase !== 'PLACING') throw err('BAD_PHASE');
    if (s.ready) throw err('ALREADY_PLACED');
    const t = this.now();
    if (t - s.lastSuggest < this.C.SUGGEST_COOLDOWN * 1000) return { placement: null };
    s.lastSuggest = t;
    const out = { placement: this.randomPlacement() };
    if (this.settings.islands === 'draw') out.islands = this.randomIslands(null);
    return out;
  }
  _submit(s, placement, islands) { // R-7-07
    if (this.phase !== 'PLACING') throw err('BAD_PHASE');
    if (s.ready) throw err('ALREADY_PLACED');
    const pieces = this.validatePlacement(placement);
    let groups = s.islands;
    if (this.settings.islands === 'draw') groups = this.validateIslands(islands);
    s.pieces = pieces.map(p => ({ ...p, sunk: false }));
    s.placement = placement.map(p => ({ pieceId: p.pieceId, row: p.row, col: p.col, rot: p.rot }));
    s.islands = groups;
    s.ready = true;
    this._log('placed', { pid: s.pid, auto: false });
    this._maybeBattle();
    return {};
  }
  _autoPlace(s) { // R-8-01
    const pl = this.randomPlacement();
    if (!pl) return false;
    s.pieces = this.validatePlacement(pl).map(p => ({ ...p, sunk: false }));
    s.placement = pl;
    if (this.settings.islands === 'draw') {
      const isl = this.randomIslands(null);
      s.islands = isl ? this._groups(isl.map(([r, c]) => this._key(r, c))) : [];
    }
    s.ready = true;
    this._log('placed', { pid: s.pid, auto: true });
    return true;
  }
  _maybeBattle() {
    const al = this.alive();
    if (al.length >= 2 && al.every(p => p.ready)) this._beginBattle();
  }

  // ---------- กระดาน ----------
  _boardIds() { return this.settings.mode === 'classic' ? this.active().map(p => p.pid) : ['*']; }
  _beginBattle() {
    this.phase = 'BATTLE';
    const B = this.boardSize;
    for (const id of this._boardIds()) this.boards.set(id, { shot: new Map(), shotBy: new Map(), traps: new Set(), trapsHit: new Set() });
    if (this.settings.traps) { // R-7-60
      const nTrap = Math.max(1, Math.round(this.C.TRAP_RATE * B * B));
      for (const [id, bd] of this.boards) {
        const occ = new Set();
        for (const p of this.alive()) {
          if (id !== '*' && p.pid !== id) continue;
          p.pieces.forEach(pc => pc.cells.forEach(k => occ.add(k)));
          p.islands.flat().forEach(k => occ.add(k));
        }
        const free = []; for (let k = 0; k < B * B; k++) if (!occ.has(k)) free.push(k);
        for (let i = 0; i < nTrap && free.length; i++) bd.traps.add(free.splice(this._rint(free.length), 1)[0]);
      }
    }
    this._log('battle_start', { style: this.turnStyle });
    if (this.turnStyle === 'turns') {
      this.turnPid = this._firstPid();
      this.turnNo = 1;
      this.deadline = this.now() + this._shotMs();
    } else this._beginRound();
  }
  _firstPid() { // R-7-10
    const al = this.alive();
    const pair = al.map(p => p.pid).sort().join(',');
    if (this.prev && this.prev.loserPid && this.prev.pair === pair && al.some(p => p.pid === this.prev.loserPid)) return this.prev.loserPid;
    return al[this._rint(al.length)].pid;
  }
  // เจ้าของในช่อง (เฉพาะผู้รอด ณ ตอนนั้น)
  _occupants(boardId, k, aliveSet) {
    const pieces = []; const islands = [];
    for (const p of this.players) {
      if (!aliveSet.has(p.pid)) continue;
      if (boardId !== '*' && p.pid !== boardId) continue;
      p.pieces.forEach((pc, i) => { if (pc.cells.includes(k)) pieces.push({ pid: p.pid, idx: i }); });
      p.islands.forEach((g, i) => { if (g.includes(k)) islands.push({ pid: p.pid, idx: i }); });
    }
    return { pieces, islands };
  }
  // ตัดสินชุดนัด (turns: 1 นัด, rounds: ทุกนัดของรอบ) R-7-20..R-7-26
  // shots: [{shooter, board, cells:[k], auto}]
  _resolve(shots) {
    const aliveSet = new Set(this.alive().map(p => p.pid));
    const byCell = new Map(); // "board|k" -> [shotIdx]
    shots.forEach((sh, i) => sh.cells.forEach(k => {
      const id = sh.board + '|' + k; if (!byCell.has(id)) byCell.set(id, []); byCell.get(id).push(i);
    }));
    const per = shots.map(() => ({ bonusHit: false, ownHit: false, islandOther: false, trap: false, cells: [] }));
    const hitPieces = []; // {pid, idx}
    const touchedIslands = [];
    for (const [id, idxs] of byCell) {
      const [board, ks] = id.split('|'); const k = Number(ks);
      const bd = this.boards.get(board);
      const occ = this._occupants(board, k, aliveSet);
      let pub;
      if (bd.traps.has(k)) { pub = 'trap'; bd.trapsHit.add(k); }
      else if (occ.pieces.length && occ.islands.length) pub = 'island_hit';
      else if (occ.pieces.length) pub = 'hit';
      else if (occ.islands.length) pub = 'island';
      else pub = 'miss';
      bd.shot.set(k, pub);
      bd.shotBy.set(k, shots[idxs[0]].shooter);   // [ใหม่ v2.6 R-7-15] จำคนยิง (หลายคนยิงช่องเดียวกัน = คนแรกตามลำดับที่ประมวลผล)
      occ.pieces.forEach(x => hitPieces.push(x));
      occ.islands.forEach(x => touchedIslands.push({ ...x, board }));
      // แจ้งเตือนส่วนตัว R-4-04
      for (const x of occ.pieces) this._notice(x.pid, 'my_hit', `${this._pieceName(this.seat(x.pid).pieces[x.idx].id)}ของคุณโดนยิง`, { board, cell: this._rc(k) });
      for (const ipid of new Set(occ.islands.map(x => x.pid))) this._notice(ipid, 'my_island', 'เกาะของคุณโดนยิง', { board, cell: this._rc(k) });
      for (const i of idxs) {
        const sh = shots[i];
        per[i].cells.push([...this._rc(k), pub]);
        if (pub === 'trap') per[i].trap = true;
        if (occ.pieces.some(x => x.pid !== sh.shooter)) per[i].bonusHit = true;            // R-7-40
        if (occ.pieces.some(x => x.pid === sh.shooter)) per[i].ownHit = true;              // R-7-45
        if (occ.islands.some(x => x.pid !== sh.shooter)) per[i].islandOther = true;        // R-7-51
      }
    }
    // ชิ้นดับ (หลังทุกนัดในชุด) R-7-21
    const sunkNow = [];
    for (const p of this.players) {
      if (!aliveSet.has(p.pid)) continue;
      const bd = this.boards.get(this.settings.mode === 'classic' ? p.pid : '*');
      p.pieces.forEach((pc, i) => {
        if (pc.sunk || !pc.cells.every(k => bd.shot.has(k))) return;
        pc.sunk = true; sunkNow.push({ ownerPid: p.pid, pieceId: pc.id, row: pc.row, col: pc.col, rot: pc.rot, cells: pc.cells.map(k => this._rc(k)) });
        this._notice('all', 'sunk', `${this._pieceName(pc.id)}ของ ${p.name} ดับแล้ว!`, { ownerPid: p.pid, pieceId: pc.id });
      });
    }
    // เกาะครบ R-7-53, R-7-54
    const doneIsl = new Set();
    for (const x of touchedIslands) {
      const key = x.pid + ':' + x.idx; if (doneIsl.has(key)) continue;
      const owner = this.seat(x.pid); const g = owner && owner.islands[x.idx];
      const bd = this.boards.get(x.board);
      if (!g || !g.every(k => bd.shot.has(k))) continue;
      doneIsl.add(key);
      shots.forEach((sh, i) => {
        if (sh.shooter === x.pid) return;
        if (!sh.cells.some(k => g.includes(k)) || sh.board !== x.board) return;
        const sp = this.seat(sh.shooter); if (!sp || sp.doubleBonus) return;
        sp.doubleBonus = true;
        this._notice('all', 'island_bonus', this.settings.mode === 'classic'
          ? `${sp.name} ทำลายเกาะของ ${owner.name} ครบ ได้นัดคู่!` : `${sp.name} ทำลายเกาะครบ ได้นัดคู่!`, { pid: sp.pid });
      });
    }
    // สถิติ + hitsOnOthers (R-9-03)
    shots.forEach((sh, i) => {
      const sp = this.seat(sh.shooter); if (!sp) return;
      sp.shots++; if (per[i].bonusHit) sp.hits++;
      if (per[i].bonusHit && !sh.auto) sp.hitsOnOthers++;
      if (per[i].islandOther) this._notice(sp.pid, 'you_island', 'โดนเกาะ!');
      if (per[i].trap) { sp.skipNext = true; this._notice(sp.pid, 'you_trap', 'โดนกับดัก! ข้ามตาหน้า'); this._notice('all', 'trap', `${sp.name} โดนกับดัก`, { pid: sp.pid }); }
    });
    this.lastResolve = shots.map((sh, i) => ({ shooterPid: sh.shooter, board: sh.board, cells: per[i].cells, auto: !!sh.auto, double: sh.cells.length > 1 }));
    this.lastSunk = sunkNow;
    this._log('resolve', { shots: this.lastResolve, sunk: sunkNow.map(x => x.ownerPid + ':' + x.pieceId) });
    // ตกรอบ R-7-22
    const elim = this.alive().filter(p => p.pieces.length && p.pieces.every(pc => pc.sunk));
    return { per, elim };
  }
  _eliminate(list, reason) {
    if (!list.length) return;
    this.elimCount++;
    for (const p of list) {
      p.alive = false; p.elimAt = this.elimCount; p.elimReason = reason;
      this._notice('all', 'elim', `${p.name} ตกรอบ`, { pid: p.pid });
    }
    this._log('eliminated', { pids: list.map(p => p.pid), reason });
  }
  // ตรวจจบเกมหลังมีคนตกรอบ (R-9-01..R-9-03, R-8-08)
  _checkEnd(batch, foul) {
    const al = this.alive();
    if (al.length === 1) return this._end(al[0].pid, 'last_standing'), true;
    if (al.length === 0) {
      if (foul) return this._end(null, 'cancelled'), true;
      if (this.settings.mode === 'survival') {
        const best = Math.max(...batch.map(p => p.hitsOnOthers));
        const top = batch.filter(p => p.hitsOnOthers === best);
        if (top.length === 1) return this._end(top[0].pid, 'tiebreak_hits'), true;
      }
      return this._end(null, 'draw'), true;
    }
    return false;
  }
  _end(winnerPid, reason) {
    this.phase = 'GAME_OVER'; this.deadline = null;
    const ranks = []; // R-9-04
    const ps = this.players.filter(p => p.ready || p.elimAt != null);
    const key = p => (p.pid === winnerPid ? Infinity : p.alive ? Infinity - 1 : p.elimAt || 0);
    const sorted = [...ps].sort((a, b) => key(b) - key(a));
    let rank = 0, last = null;
    sorted.forEach((p, i) => { const kv = key(p); if (kv !== last) { rank = i + 1; last = kv; } ranks.push({ pid: p.pid, rank }); });
    this.result = { winnerPid: winnerPid || null, reason, ranking: ranks,
      hitsOnOthers: Object.fromEntries(ps.map(p => [p.pid, p.hitsOnOthers])),
      elimReasons: Object.fromEntries(ps.filter(p => p.elimReason).map(p => [p.pid, p.elimReason])) }; // R-9-07 [ใหม่ v2.2]
    const al2 = this.active();
    const loser = winnerPid && al2.length === 2 ? al2.find(p => p.pid !== winnerPid) : null;
    this.prev = { loserPid: loser ? loser.pid : null, pair: al2.map(p => p.pid).sort().join(',') };
    for (const s of this.players) s.wantsRematch = false;
    this._notice('all', 'game_end', winnerPid ? `${this.seat(winnerPid)?.name || ''} ชนะ!` : (reason === 'draw' ? 'เสมอ' : 'เกมถูกยกเลิก'));
    this._log('game_end', { winnerPid, reason, turns: this.turnNo, rounds: this.roundNo });
  }

  // ---------- การยิง ----------
  _parseShots(s, msg, startIdx = 0) {
    if (!Array.isArray(msg.shots) || !msg.shots.length) throw err('BAD_REQUEST');
    const B = this.boardSize; const out = []; const used = new Set();
    msg.shots.forEach((x, i) => {
      if (!x || typeof x !== 'object' || typeof x.row !== 'number' || typeof x.col !== 'number') throw err('BAD_REQUEST');
      if (!isInt(x.row) || !isInt(x.col) || x.row < 0 || x.col < 0 || x.row >= B || x.col >= B) throw err('OUT_OF_BOUNDS');
      let board = '*';
      if (this.settings.mode === 'classic') {                                                        // R-7-15
        const t = this.seat(x.board);
        if (typeof x.board !== 'string' || !t || !t.alive || t.pid === s.pid) throw err('BAD_TARGET');
        board = t.pid;
      }
      const bd = this.boards.get(board);
      const cells = [this._key(x.row, x.col)];
      const first = i + startIdx === 0;
      const wantDouble = first && s.doubleBonus;
      if (x.double != null || wantDouble) {                                                        // R-7-53
        if (!s.doubleBonus || !first) throw err('DOUBLE_INVALID');
        if (x.double == null) { if (this._anyDouble(board)) throw err('DOUBLE_INVALID'); }
        else {
          if (x.double !== 'H' && x.double !== 'V') throw err('DOUBLE_INVALID');
          const r2 = x.row + (x.double === 'V' ? 1 : 0), c2 = x.col + (x.double === 'H' ? 1 : 0);
          if (r2 >= B || c2 >= B || bd.shot.has(this._key(r2, c2))) {
            if (this._anyDouble(board)) throw err('DOUBLE_INVALID');
          } else cells.push(this._key(r2, c2));
        }
      }
      for (const k of cells) {
        if (bd.shot.has(k) || used.has(board + '|' + k)) throw err('ALREADY_SHOT');                 // R-7-14
        used.add(board + '|' + k);
      }
      out.push({ shooter: s.pid, board, cells, auto: false });
    });
    return out;
  }
  _anyDouble(board) {
    const bd = this.boards.get(board); const B = this.boardSize;
    for (let r = 0; r < B; r++) for (let c = 0; c < B; c++) {
      if (bd.shot.has(this._key(r, c))) continue;
      if ((c + 1 < B && !bd.shot.has(this._key(r, c + 1))) || (r + 1 < B && !bd.shot.has(this._key(r + 1, c)))) return true;
    }
    return false;
  }
  _fire(s, msg) {
    if (this.phase !== 'BATTLE') throw err('BAD_PHASE');
    if (msg.turnNo !== this.turnNo) throw err('STALE_TURN');                                       // R-7-16
    if (!s.alive) throw err('NOT_YOUR_TURN');
    if (this.turnStyle === 'turns') {
      if (this.turnPid !== s.pid) throw err('NOT_YOUR_TURN');                                      // R-7-13
      if (!Array.isArray(msg.shots) || msg.shots.length !== 1) throw err('SHOT_COUNT');
      const shots = this._parseShots(s, msg);
      s.autoStreak = 0;                                                                           // R-7-71
      s.aim = null;
      this._turnShot(s, shots[0]);
    } else {
      if (!this.roundShooters.has(s.pid)) throw err('NOT_YOUR_TURN');
      if (s.pending) throw err('ALREADY_SUBMITTED');
      if (!Array.isArray(msg.shots) || msg.shots.length !== s.shotsAllowed) throw err('SHOT_COUNT'); // R-7-12
      const parsed = this._parseShots(s, msg);
      this._checkSpread(s, parsed);                                                                 // [ใหม่ v2.7] R-7-17
      s.pending = parsed;
      s.autoStreak = 0; s.aim = null;
      if ([...this.roundShooters].every(pid => { const p = this.seat(pid); return !p || !p.alive || p.pending; })) this._resolveRound();
    }
    return {};
  }
  // [ใหม่ v2.2] R-8-12 ช่องที่เลือกไว้ (ยังไม่กดยิง) เก็บที่ server แบบส่วนตัว
  _canShootNow(s) {
    if (this.phase !== 'BATTLE' || !s.alive) return false;
    if (this.turnStyle === 'turns') return this.turnPid === s.pid;
    return !!this.roundShooters && this.roundShooters.has(s.pid) && !s.pending;
  }
  _aim(s, msg) {
    if (this.phase !== 'BATTLE') throw err('BAD_PHASE');
    if (msg.turnNo !== this.turnNo) throw err('STALE_TURN');
    if (!this._canShootNow(s)) throw err('NOT_YOUR_TURN');
    if (!Array.isArray(msg.shots)) throw err('BAD_REQUEST');
    const max = this.turnStyle === 'turns' ? 1 : s.shotsAllowed;
    if (msg.shots.length > max) throw err('SHOT_COUNT');
    if (!msg.shots.length) { s.aim = null; return {}; }
    this._checkSpread(s, this._parseShots(s, msg));   // ตรวจเหมือนการยิงจริง
    s.aim = msg.shots.map(x => ({ board: x.board, row: x.row, col: x.col, double: x.double }));
    return {};
  }
  // R-8-13 หมดเวลา: ช่องที่เลือกไว้ที่ยังยิงได้ = ยิงเอง (auto: false)
  _aimShots(s, max) {
    const out = []; const used = new Set();
    for (const x of (s.aim || []).slice(0, max)) {
      try {
        const spec = { ...x }; if (out.length !== 0) delete spec.double;
        const sh = this._parseShots(s, { shots: [spec] }, out.length)[0];
        if (sh.cells.some(k => used.has(sh.board + '|' + k))) continue;
        sh.cells.forEach(k => used.add(sh.board + '|' + k));
        out.push(sh);
      } catch (e) { /* ช่องนั้นใช้ไม่ได้แล้ว ข้าม */ }
    }
    return out;
  }
  _autoFill(s, own, count) { // สุ่มนัดที่ขาด ไม่ซ้ำกับนัดที่เลือกเอง
    const taken = new Set(); own.forEach(sh => sh.cells.forEach(k => taken.add(sh.board + '|' + k)));
    const extra = this._autoShots(s, count, taken, own.length);
    return extra;
  }
  _consumeDouble(s, shot) { if (s.doubleBonus) s.doubleBonus = false; return shot; }

  // --- turns (2 คน) ---
  _turnShot(s, shot) {
    this._consumeDouble(s, shot);
    const { per, elim } = this._resolve([shot]);
    this._eliminate(elim, 'sunk');
    if (elim.length && this._checkEnd(elim, false)) return;
    const r = per[0];
    let again = false;
    if (!shot.auto && !r.trap) {                                                                   // R-7-41, R-7-52, R-7-61
      if (this.settings.bonusOnHit && r.bonusHit) again = true;
      if (r.islandOther) again = true;
    }
    if (!shot.auto && !r.trap && !again && r.ownHit && this.settings.bonusOnHit)                    // R-7-45 [ใหม่ v2.2]
      this._notice(s.pid, 'own_hit', 'โดนของคุณเอง ไม่ได้ยิงต่อ');
    if (shot.auto && s.autoStreak >= this.C.AUTO_SHOT_LIMIT) {                                     // R-8-04
      this._eliminate([s], 'auto_limit');
      if (this._checkEnd([s], true)) return;
    }
    this.turnNo++; s.aim = null;
    if (again && s.alive) {                                                                        // R-10-07 [ใหม่ v2.2]
      this._notice(s.pid, 'big_again', 'โดน! ยิงต่อได้อีกนัด');
      this._others(s.pid, 'again', `${s.name} ได้ยิงต่อ`);
      this.deadline = this.now() + this._shotMs(); return;
    }
    this._nextTurn(s.pid);
  }
  // [ใหม่ v2.7] R-7-17 Classic: นัดพื้นฐานต้องยิงคนละกระดาน (นัดโบนัสยิงซ้ำได้)
  _checkSpread(s, shots) {
    if (this.settings.mode !== 'classic') return;
    const opp = this.alive().filter(p => p.pid !== s.pid).length;
    const need = Math.min(s.shotsBase || 1, opp, shots.length);
    if (new Set(shots.map(x => x.board)).size < need) throw err('BOARD_REPEAT');
  }
  // [ใหม่ v2.7] R-5-21 เวลาต่อตาตามที่ host ตั้ง
  _shotMs() { return (this.settings.shotTime || this.C.SHOT_TIME) * 1000; }
  // [ใหม่ v2.7] R-7-17 นัดพื้นฐาน = min(ค่าที่ตั้ง, คู่แข่งที่ยังอยู่) อย่างน้อย 1
  _baseShots(s) {
    const opp = this.alive().filter(p => p.pid !== s.pid).length;
    return Math.max(1, Math.min(this.settings.shotsPerTurn || 1, opp));
  }
  _others(pid, kind, text) { for (const p of this.active()) if (p.pid !== pid) this._notice(p.pid, kind, text, { pid }); }
  _nextTurn(fromPid) {
    const al = this.alive(); if (al.length < 2) return;
    if (al.every(p => p.skipNext)) al.forEach(p => { p.skipNext = false; });                        // R-7-63
    const order = this.players.filter(p => p.alive && !p.removed);
    let i = order.findIndex(p => p.pid === fromPid);
    for (let step = 0; step < order.length * 2; step++) {
      i = (i + 1) % order.length;
      const p = order[i];
      if (p.skipNext) { p.skipNext = false; this._notice('all', 'skip', `${p.name} ถูกข้ามตา`, { pid: p.pid }); continue; } // R-7-62
      this.turnPid = p.pid; break;
    }
    this.deadline = this.now() + this._shotMs();
  }

  // --- rounds (3+ คน) ---
  _beginRound() {
    this.roundNo++; this.turnNo++;
    const al = this.alive();
    if (al.every(p => p.skipNext)) al.forEach(p => { p.skipNext = false; });                        // R-7-63
    this.roundShooters = new Set();
    for (const p of al) {
      p.pending = null;
      if (p.skipNext) { p.skipNext = false; p.skippedRound = this.roundNo; this._notice('all', 'skip', `${p.name} ถูกข้ามรอบนี้`, { pid: p.pid }); continue; }
      this.roundShooters.add(p.pid);
      p.aim = null;
      // [แก้ v2.7] R-7-17 นัดพื้นฐานคิดใหม่ทุกรอบ (คู่แข่งตกรอบ = ลดลง) · R-7-18 บวกนัดโบนัสที่ได้จากรอบก่อน
      p.shotsBase = this._baseShots(p);
      p.shotsAllowed = Math.min(p.shotsBase + (p.bonusShots || 0), this.C.MAX_SHOTS_PER_ROUND);
      if (p.bonusShots) { this._notice(p.pid, 'big_two', `รอบนี้ยิงได้ ${p.shotsAllowed} นัด (โบนัส ${p.bonusShots})`); this._others(p.pid, 'two', `${p.name} ได้ ${p.shotsAllowed} นัดรอบนี้`); } // R-10-07
    }
    this.deadline = this.now() + this._shotMs();                                                   // R-8-03 · [แก้ v2.7] ใช้เวลาที่ host ตั้ง ไม่ยืดอัตโนมัติแล้ว
  }
  _autoShots(s, count, taken, startIdx = 0) { // R-8-02 / R-8-03 สุ่มช่องที่ยังไม่ถูกยิง
    const out = []; const used = new Set(taken || []);
    for (let i = startIdx; i < startIdx + count; i++) {
      let board = '*';
      if (this.settings.mode === 'classic') {
        const opts = this.alive().filter(p => p.pid !== s.pid && this._freeCells(p.pid, used).length);
        if (!opts.length) break;
        board = opts[this._rint(opts.length)].pid;
      }
      const free = this._freeCells(board, used); if (!free.length) break;
      const k = free[this._rint(free.length)];
      const cells = [k];
      if (i === 0 && s.doubleBonus) {
        const [r, c] = this._rc(k); const bd = this.boards.get(board); const B = this.boardSize;
        const opts = [];
        if (c + 1 < B && !bd.shot.has(k + 1) && !used.has(board + '|' + (k + 1))) opts.push(k + 1);
        if (r + 1 < B && !bd.shot.has(k + B) && !used.has(board + '|' + (k + B))) opts.push(k + B);
        if (opts.length) cells.push(opts[this._rint(opts.length)]);
      }
      cells.forEach(x => used.add(board + '|' + x));
      out.push({ shooter: s.pid, board, cells, auto: true });
    }
    return out;
  }
  _freeCells(board, used) {
    const bd = this.boards.get(board); const B = this.boardSize; const out = [];
    for (let k = 0; k < B * B; k++) if (!bd.shot.has(k) && !used.has(board + '|' + k)) out.push(k);
    return out;
  }
  _resolveRound() {
    const shooters = [...this.roundShooters].map(pid => this.seat(pid)).filter(p => p && p.alive);
    const all = [];
    const autoPids = new Set();
    for (const p of shooters) {
      if (!p.pending) { // R-8-03, R-8-13, R-8-14
        const own = this._aimShots(p, p.shotsAllowed);
        if (!own.length) { p.pending = this._autoShots(p, p.shotsAllowed); p.autoStreak++; autoPids.add(p.pid); }
        else {
          p.pending = own.length < p.shotsAllowed ? [...own, ...this._autoFill(p, own, p.shotsAllowed - own.length)] : own;
          p.autoStreak = 0;
          this._notice(p.pid, 'aim_fired', 'หมดเวลา — ยิงช่องที่คุณเลือกไว้');
        }
        p.aim = null;
      }
      if (p.doubleBonus && p.pending.length) p.doubleBonus = false;
      all.push(...p.pending);
    }
    const { per, elim } = this._resolve(all);
    // สิทธิ์ 2 นัดรอบหน้า R-7-42, R-7-52, R-7-43
    for (const p of shooters) {
      // [แก้ v2.7] R-7-18 โดนกี่นัด ได้นัดโบนัสรอบหน้าเท่านั้น
      // Survival นับเฉพาะนัดพื้นฐาน (นัดโบนัสที่โดนไม่ต่อโบนัส) · Classic นับทุกนัด
      const countAll = this.settings.mode === 'classic';
      const limit = countAll ? Infinity : (p.shotsBase || 1);
      let idx = 0, bonus = 0, two = false;
      all.forEach((sh, i) => {
        if (sh.shooter !== p.pid) return;
        const n = idx++;
        if (sh.auto || n >= limit) return;
        if ((this.settings.bonusOnHit && per[i].bonusHit) || per[i].islandOther) { bonus++; two = true; }
      });
      p.bonusShots = Math.min(bonus, this.C.MAX_SHOTS_PER_ROUND - 1);
      if (!two && this.settings.bonusOnHit && all.some((sh, i) => sh.shooter === p.pid && !sh.auto && per[i].ownHit && !per[i].trap))
        this._notice(p.pid, 'own_hit', 'โดนของคุณเอง ไม่ได้ 2 นัดรอบหน้า');                     // R-7-45
      p.pending = null;
    }
    this._eliminate(elim, 'sunk');
    if (elim.length && this._checkEnd(elim, false)) return;
    const fouls = shooters.filter(p => p.alive && autoPids.has(p.pid) && p.autoStreak >= this.C.AUTO_SHOT_LIMIT);
    if (fouls.length) { this._eliminate(fouls, 'auto_limit'); if (this._checkEnd(fouls, true)) return; }
    this._beginRound();
  }

  // ---------- อื่น ๆ ----------
  _resign(s) {
    if (this.phase !== 'PLACING' && this.phase !== 'BATTLE') throw err('BAD_PHASE');
    if (!s.alive) throw err('BAD_PHASE');
    this._foul([s], 'resign');
    return {};
  }
  _foul(list, reason) { // R-7-70, R-8-06, R-8-08
    if (this.phase === 'PLACING') {
      for (const p of list) { p.alive = false; p.elimReason = reason; this.elimCount++; p.elimAt = this.elimCount; }
      const al = this.alive();
      if (al.length <= 1) { this._end(al.length ? al[0].pid : null, al.length ? 'last_standing' : 'cancelled'); return; }
      this._maybeBattle(); return;
    }
    if (this.phase !== 'BATTLE') return;
    this._eliminate(list.filter(p => p.alive), reason);
    if (this._checkEnd(list, true)) return;
    if (this.turnStyle === 'turns' && list.some(p => p.pid === this.turnPid)) { this.turnNo++; this._nextTurn(this.turnPid); }
    if (this.turnStyle === 'rounds' && [...this.roundShooters].every(pid => { const p = this.seat(pid); return !p || !p.alive || p.pending; })) {
      if ([...this.roundShooters].some(pid => { const p = this.seat(pid); return p && p.alive; })) this._resolveRound();
      else this._beginRound();
    }
  }
  _rematch(s, want) { // R-8-09
    if (this.phase !== 'GAME_OVER') throw err('BAD_PHASE');
    s.wantsRematch = want !== false;
    const act = this.active();
    if (act.length >= this.C.MIN_PLAYERS && act.every(p => p.wantsRematch)) this._startGame();
    return {};
  }
  _backToLobby(s) {
    if (this.phase !== 'GAME_OVER') throw err('BAD_PHASE');
    if (s.pid !== this.hostPid) throw err('NOT_HOST');
    this.phase = 'LOBBY'; this.result = null; this.lastResolve = []; this.deadline = null; this.boards = new Map();
    this._purgeRemoved();
    for (const p of this.active()) this._resetSeat(p);
    return {};
  }
  leave(pid) { // R-8-06
    const s = this.seat(pid); if (!s) return;
    this._log('leave', { pid });
    if ((this.phase === 'PLACING' || this.phase === 'BATTLE') && s.alive) this._foul([s], 'resign');
    this._removeSeat(pid);
    if (this.phase === 'GAME_OVER') for (const p of this.players) p.wantsRematch = false;
  }

  // ---------- เวลา (server เรียกทุก ~0.5 วิ) ----------
  tick() {
    const t = this.now(); let changed = false;
    const gone = this.active().filter(p => !p.connected && p.disconnectedAt != null && t - p.disconnectedAt >= this.C.RECONNECT_GRACE * 1000);
    if (gone.length) {
      const inGame = this.phase === 'PLACING' || this.phase === 'BATTLE';
      const aliveGone = gone.filter(p => p.alive);
      gone.forEach(p => this._log('leave', { pid: p.pid, reason: 'disconnect' }));
      if (inGame && aliveGone.length) this._foul(aliveGone, 'disconnect');
      for (const g of gone) this._removeSeat(g.pid);
      if (this.phase === 'GAME_OVER') for (const p of this.players) p.wantsRematch = false;
      changed = true;
    }
    if (this.phase === 'PLACING' && t >= this.deadline) { // R-8-01
      for (const s of this.alive()) if (!s.ready && !this._autoPlace(s)) { this._end(null, 'cancelled'); return true; }
      this._maybeBattle(); changed = true;
    } else if (this.phase === 'BATTLE' && t >= this.deadline) {
      if (this.turnStyle === 'turns') { // R-8-02
        const s = this.seat(this.turnPid);
        const own = this._aimShots(s, 1);                                                           // R-8-13
        if (own.length) { s.autoStreak = 0; s.aim = null; this._notice(s.pid, 'aim_fired', 'หมดเวลา — ยิงช่องที่คุณเลือกไว้'); this._turnShot(s, own[0]); }
        else { const shot = this._autoShots(s, 1)[0]; s.autoStreak++; s.aim = null; this._turnShot(s, shot); }
      } else this._resolveRound(); // R-8-03
      changed = true;
    }
    return changed;
  }
  expired() { return this.emptySince != null && this.now() - this.emptySince >= this.C.ROOM_IDLE_CLOSE * 1000; }

  // ---------- สิ่งที่ผู้เล่นเห็น (หัวข้อ 4, R-4-01..R-4-09) ----------
  getState(pid) {
    const t = this.now(); const reveal = this.phase === 'GAME_OVER';
    const me = this.seat(pid);
    const boards = [];
    for (const [id, bd] of this.boards) {
      boards.push({
        id, cells: [...bd.shot.entries()].map(([k, v]) => [...this._rc(k), v, bd.shotBy.get(k) || null]),   // v2.6: เพิ่ม pid คนยิง
        traps: reveal ? [...bd.traps].map(k => this._rc(k)) : undefined,
      });
    }
    const C = this.C;
    return {
      code: this.code, phase: this.phase, gameNo: this.gameNo, you: pid, hostPid: this.hostPid,
      room: { name: this.meta.name, private: this.meta.private, password: me ? this.meta.password : null }, // R-5-10 คนในห้องเห็นรหัสผ่าน
      settings: { ...this.settings }, turnStyle: this.turnStyle, boardSize: this.boardSize,
      fleet: this.fleet.map(f => f.id),
      turnPid: this.turnPid, turnNo: this.turnNo, roundNo: this.roundNo,
      deadline: this.deadline, serverNow: t, voice: [...this.voice],
      lastResolve: this.lastResolve.map(x => ({ ...x })), lastSunk: this.lastSunk || [],
      result: this.result,
      boards,
      config: {
        SHOT_TIME: C.SHOT_TIME, PLACE_TIME: C.PLACE_TIME, RECONNECT_GRACE: C.RECONNECT_GRACE, ISLAND_CELLS: C.ISLAND_CELLS,
        ISLAND_MIN_GROUP: C.ISLAND_MIN_GROUP, ANIM_BULLET_MS: C.ANIM_BULLET_MS, ANIM_EFFECT_MS: C.ANIM_EFFECT_MS,
        SUNK_REVEAL_MS: C.SUNK_REVEAL_MS, MIN_PLAYERS: C.MIN_PLAYERS, MAX_PLAYERS: C.MAX_PLAYERS,
        COUNTDOWN_FROM: C.COUNTDOWN_FROM, TURN_BANNER_MS: C.TURN_BANNER_MS, CHAT_MAX: C.CHAT_MAX,
        SHOT_TIME_CHOICES: C.SHOT_TIME_CHOICES, MAX_SHOTS_PER_ROUND: C.MAX_SHOTS_PER_ROUND,   // [ใหม่ v2.7]
      },
      players: this.players.filter(p => !p.removed || reveal).map(p => ({
        pid: p.pid, name: p.name, color: p.color, connected: p.connected, ready: p.ready, alive: p.alive, shotsBase: p.shotsBase,
        removed: !!p.removed, wantsRematch: p.wantsRematch, autoStreak: p.autoStreak,
        shotsAllowed: p.shotsAllowed, doubleBonus: p.doubleBonus, skipNext: p.skipNext,
        submitted: this.turnStyle === 'rounds' && this.phase === 'BATTLE' ? !!p.pending : false,
        shooting: this.turnStyle === 'rounds' && this.phase === 'BATTLE' && this.roundShooters ? this.roundShooters.has(p.pid) : p.pid === this.turnPid,
        graceLeft: p.connected || p.disconnectedAt == null ? null
          : Math.max(0, Math.ceil((C.RECONNECT_GRACE * 1000 - (t - p.disconnectedAt)) / 1000)),
        sunk: p.pieces.filter(pc => pc.sunk).map(pc => ({ pieceId: pc.id, row: pc.row, col: pc.col, rot: pc.rot, cells: pc.cells.map(k => this._rc(k)) })),
        stats: reveal ? { shots: p.shots, hits: p.hits, hitsOnOthers: p.hitsOnOthers } : undefined,
        placement: (p.pid === pid || reveal) && p.placement ? p.placement.map(x => ({ ...x })) : null,
        islands: (p.pid === pid || reveal) ? p.islands.map(g => g.map(k => this._rc(k))) : null,
      })),
      me: me ? {
        hitsOnMe: me.pieces.flatMap(pc => pc.cells.filter(k => {
          const bd = this.boards.get(this.settings.mode === 'classic' ? me.pid : '*'); return bd && bd.shot.has(k);
        }).map(k => [...this._rc(k), pc.id])),
        pending: me.pending ? me.pending.map(sh => ({ board: sh.board, cells: sh.cells.map(k => this._rc(k)) })) : null,
        aim: me.aim ? me.aim.map(x => ({ ...x })) : null,
      } : null,
    };
  }
}

module.exports = { Room, GameError, CONFIG, validateConfig, parseShape, rotateCells };
