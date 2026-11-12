'use strict';
// กติกาทั้งหมดของ Battle Weed: Green Social (spec v1.0) — ไม่ import express/socket.io
// รหัสกติกา R-x-yy อ้างถึงหัวข้อใน spec.md
const crypto = require('crypto');

// หัวข้อ 3: ค่าคงที่ทุกตัวอยู่ที่นี่ที่เดียว
const CONFIG = Object.freeze({
  BOARD_SIZE: 10,
  PLACE_TIME: 90,          // วินาที
  SHOT_TIME: 30,           // วินาทีต่อนัด
  AUTO_SHOT_LIMIT: 3,      // ตาติดกัน
  RECONNECT_GRACE: 60,     // วินาที
  ROOM_IDLE_CLOSE: 600,    // วินาทีที่ไม่มีผู้เล่นเชื่อมต่อ
  ROOM_CODE_LEN: 5,
  ROOM_CODE_CHARS: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
  NAME_MAX: 16,
  FLEET_MIN_PIECES: 1,
  FLEET_MAX_PIECES: 7,
  FLEET_MAX_CELLS: 30,
  PIECE_SIZE_MIN: 2,
  PIECE_SIZE_MAX: 5,
  MIN_AGE: 20,
  REQID_MEMORY: 50,
  SUGGEST_COOLDOWN: 1,     // วินาที
  SUNK_BANNER_MS: 2000,
  MIN_SCREEN_PX: 360,
  THUMB_MIN_PX: 110,
});

// R-3-01 ตรวจ config ตอนเริ่ม คืนรายการปัญหา (ว่าง = ผ่าน)
function validateConfig(c) {
  const errs = [];
  for (const k of ['PLACE_TIME', 'SHOT_TIME', 'RECONNECT_GRACE', 'ROOM_IDLE_CLOSE']) {
    if (!Number.isInteger(c[k]) || c[k] < 5) errs.push(`${k} ต้องเป็นจำนวนเต็ม >= 5 (ได้ ${c[k]})`);
  }
  if (!Number.isInteger(c.AUTO_SHOT_LIMIT) || c.AUTO_SHOT_LIMIT < 1) errs.push(`AUTO_SHOT_LIMIT ต้อง >= 1 (ได้ ${c.AUTO_SHOT_LIMIT})`);
  if (c.BOARD_SIZE !== 10) errs.push('BOARD_SIZE ล็อกไว้ที่ 10');
  return errs;
}

class GameError extends Error {
  constructor(code, message, reason) { super(message); this.code = code; this.reason = reason; }
}

const MSG = {
  ROOM_FULL: 'ห้องนี้เต็มหรือเริ่มเกมแล้ว',
  NAME_INVALID: 'กรุณาใส่ชื่อ 1–16 ตัวอักษร',
  BAD_PHASE: 'ทำแบบนี้ตอนนี้ไม่ได้',
  ALREADY_PLACED: 'ยืนยันการวางไปแล้ว',
  PLACEMENT_INVALID: 'การวางไม่ถูกต้อง',
  NOT_YOUR_TURN: 'ยังไม่ถึงตาคุณ',
  OUT_OF_BOUNDS: 'พิกัดอยู่นอกกระดาน',
  ALREADY_SHOT: 'ยิงช่องนี้ไปแล้ว',
  STALE_TURN: 'ตานี้ผ่านไปแล้ว',
  NO_OPPONENT: 'อีกฝ่ายออกจากห้องแล้ว',
  BAD_REQUEST: 'คำสั่งไม่ถูกต้อง',
  BAD_TOKEN: 'ที่นั่งนี้ใช้ไม่ได้แล้ว',
};
const REASON_MSG = {
  PIECES: 'ต้องวางอุปกรณ์ทุกชิ้น ชิ้นละครั้ง',
  BOUNDS: 'มีชิ้นล้นออกนอกกระดาน',
  DIR: 'ทิศต้องเป็นแนวนอนหรือแนวตั้ง',
  OVERLAP: 'อุปกรณ์วางซ้อนกัน',
};
const err = (code, reason) => new GameError(code, reason ? REASON_MSG[reason] : MSG[code], reason);

const N = CONFIG.BOARD_SIZE;
const key = (r, c) => r * N + c;
const isInt = v => Number.isInteger(v);

function pieceCells(p, size) { // R-7-03
  const out = [];
  for (let i = 0; i < size; i++) out.push(p.dir === 'H' ? [p.row, p.col + i] : [p.row + i, p.col]);
  return out;
}

// R-7-01..R-7-04 คืน Map(cellKey -> pieceId) หรือ throw
function validatePlacement(placement, fleet) {
  if (!Array.isArray(placement)) throw err('BAD_REQUEST');
  for (const p of placement) {
    if (!p || typeof p !== 'object' || typeof p.pieceId !== 'string') throw err('BAD_REQUEST');
  }
  const ids = new Set(fleet.map(f => f.id));
  const seen = new Set();
  for (const p of placement) {
    if (!ids.has(p.pieceId) || seen.has(p.pieceId)) throw err('PLACEMENT_INVALID', 'PIECES');
    seen.add(p.pieceId);
  }
  if (seen.size !== fleet.length) throw err('PLACEMENT_INVALID', 'PIECES');
  for (const p of placement) if (p.dir !== 'H' && p.dir !== 'V') throw err('PLACEMENT_INVALID', 'DIR');
  const size = Object.fromEntries(fleet.map(f => [f.id, f.size]));
  const cells = new Map();
  for (const p of placement) {
    if (!isInt(p.row) || !isInt(p.col)) throw err('PLACEMENT_INVALID', 'BOUNDS');
    for (const [r, c] of pieceCells(p, size[p.pieceId])) {
      if (r < 0 || r >= N || c < 0 || c >= N) throw err('PLACEMENT_INVALID', 'BOUNDS');
    }
  }
  for (const p of placement) {
    for (const [r, c] of pieceCells(p, size[p.pieceId])) {
      const k = key(r, c);
      if (cells.has(k)) throw err('PLACEMENT_INVALID', 'OVERLAP'); // R-7-04 ชิดได้ ห้ามซ้อน
      cells.set(k, p.pieceId);
    }
  }
  return cells;
}

// R-7-06 / R-8-01 สุ่มวาง: ชิ้นใหญ่ก่อน สุ่มจากตำแหน่งที่ถูกกติกาทั้งหมด ตันแล้วเริ่มใหม่
function randomPlacement(fleet, rand) {
  const order = fleet.map((f, i) => ({ ...f, i })).sort((a, b) => b.size - a.size || a.i - b.i);
  for (let attempt = 0; attempt < 200; attempt++) {
    const used = new Set(); const out = []; let ok = true;
    for (const f of order) {
      const opts = [];
      for (const dir of ['H', 'V']) for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const cells = pieceCells({ row: r, col: c, dir }, f.size);
        if (cells.every(([y, x]) => y < N && x < N && !used.has(key(y, x)))) opts.push({ pieceId: f.id, row: r, col: c, dir });
      }
      if (!opts.length) { ok = false; break; }
      const pick = opts[Math.floor(rand() * opts.length)];
      for (const [y, x] of pieceCells(pick, f.size)) used.add(key(y, x));
      out.push(pick);
    }
    if (ok) return out;
  }
  // R-3-02 ภายในเพดาน config วางแถวละชิ้นได้เสมอ
  return order.map((f, i) => ({ pieceId: f.id, row: i, col: 0, dir: 'H' }));
}

const cryptoRand = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

class Room {
  constructor(code, { cards, rand = cryptoRand, now = () => Date.now(), onLog = () => {}, config = CONFIG } = {}) {
    if (!Array.isArray(cards) || !cards.length) throw new Error('ต้องมี catalog การ์ด');
    this.code = code;
    this.fleet = cards.map(c => ({ id: c.id, size: +c.size })); // R-4.1-07 ทุกชิ้นใน catalog ชิ้นละ 1
    this.rand = rand; this.now = now; this.onLog = onLog; this.C = config;
    this.players = [];
    this.phase = 'LOBBY';
    this.gameNo = 0;
    this.turnPid = null; this.turnNo = 0; this.deadline = null;
    this.lastShot = null; this.result = null; this.prev = null;
    this.emptySince = null;
    this.log = [];
  }

  // ---------- เครื่องมือภายใน ----------
  _log(type, data = {}) {
    const e = { t: this.now(), room: this.code, game: this.gameNo, type, ...data };
    this.log.push(e); if (this.log.length > 2000) this.log.shift();
    this.onLog(e);
  }
  seat(pid) { return this.players.find(p => p.pid === pid); }
  opp(pid) { return this.players.find(p => p.pid !== pid); }
  _need(pid) { const s = this.seat(pid); if (!s) throw err('BAD_TOKEN'); return s; }

  // ---------- เข้าห้อง (R-5-02, R-5-04, R-5-05) ----------
  addPlayer(rawName) {
    if (typeof rawName !== 'string') throw err('NAME_INVALID');
    let name = rawName.trim();
    if (!name || [...name].length > this.C.NAME_MAX) throw err('NAME_INVALID');
    if (this.phase !== 'LOBBY' || this.players.length >= 2) throw err('ROOM_FULL');
    if (this.players.some(p => p.name === name)) name += ' (2)';
    const seat = {
      pid: crypto.randomBytes(8).toString('hex'), token: crypto.randomBytes(16).toString('hex'),
      name, connected: true, disconnectedAt: null, reqIds: [], lastSuggest: 0,
    };
    this._resetSeat(seat);
    this.players.push(seat);
    this.emptySince = null;
    this._log('join', { pid: seat.pid, name });
    if (this.players.length === 2) this._startGame();
    return { pid: seat.pid, token: seat.token };
  }
  _resetSeat(s) {
    s.ready = false; s.placement = null; s.cells = new Map();
    s.shotsTaken = new Map(); s.sunk = []; s.autoStreak = 0; s.wantsRematch = false;
  }
  resume(token) { // R-8-05
    const s = typeof token === 'string' && this.players.find(p => p.token === token);
    if (!s) throw err('BAD_TOKEN');
    s.connected = true; s.disconnectedAt = null; this.emptySince = null;
    this._log('rejoin', { pid: s.pid, ok: true });
    return s.pid;
  }
  setConnected(pid, on) {
    const s = this.seat(pid); if (!s) return;
    s.connected = on; s.disconnectedAt = on ? null : this.now();
    if (!on) this._log('disconnect', { pid });
    if (!this.players.some(p => p.connected) && this.emptySince == null) this.emptySince = this.now();
    if (on) this.emptySince = null;
  }
  _removeSeat(pid) {
    this.players = this.players.filter(p => p.pid !== pid);
    if (!this.players.some(p => p.connected) && this.emptySince == null) this.emptySince = this.now();
  }

  // ---------- เฟส ----------
  _startGame() { // R-5-05, R-8-08
    this.gameNo++;
    for (const s of this.players) this._resetSeat(s);
    this.phase = 'PLACING';
    this.turnPid = null; this.turnNo = 0; this.lastShot = null; this.result = null;
    this.deadline = this.now() + this.C.PLACE_TIME * 1000;
    this._log('game_start', { pids: this.players.map(p => p.pid) });
  }
  _firstPid() { // R-7-14
    const pair = this.players.map(p => p.pid).sort().join(',');
    if (this.prev && this.prev.loserPid && this.prev.pair === pair && this.prev.reason !== 'cancelled') return this.prev.loserPid;
    return this.players[this.rand() < 0.5 ? 0 : 1].pid;
  }
  _beginBattle() {
    this.phase = 'BATTLE';
    this.turnPid = this._firstPid();
    this.turnNo = 1;
    this.deadline = this.now() + this.C.SHOT_TIME * 1000;
    this._log('battle_start', { firstPid: this.turnPid });
  }
  _end(winnerPid, reason) { // R-9-03
    const loser = winnerPid ? this.players.find(p => p.pid !== winnerPid) : null;
    this.phase = 'GAME_OVER';
    this.deadline = null;
    this.result = { winnerPid: winnerPid || null, reason };
    this.prev = { loserPid: loser ? loser.pid : null, pair: this.players.map(p => p.pid).sort().join(','), reason };
    for (const s of this.players) s.wantsRematch = false;
    this._log('game_end', { winnerPid, reason, turns: this.turnNo });
  }
  _forfeit(pid, reason) {
    const o = this.opp(pid);
    this._end(o ? o.pid : null, o ? reason : 'cancelled');
  }

  // ---------- Actions ----------
  action(pid, msg) {
    const s = this._need(pid);
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw err('BAD_REQUEST');
    if (msg.reqId != null) { // R-7-11
      if (typeof msg.reqId !== 'string' || msg.reqId.length > 40) throw err('BAD_REQUEST');
      if (s.reqIds.includes(msg.reqId)) return { dup: true };
      s.reqIds.push(msg.reqId); if (s.reqIds.length > this.C.REQID_MEMORY) s.reqIds.shift();
    }
    switch (msg.type) {
      case 'suggest_placement': return this._suggest(s);
      case 'submit_placement': return this._submit(s, msg.placement);
      case 'fire': return this._fire(s, msg);
      case 'resign': return this._resign(s);
      case 'rematch': return this._rematch(s, msg.want);
      case 'back_to_lobby': return this._backToLobby(s);
      default: throw err('BAD_REQUEST');
    }
  }
  _suggest(s) { // R-7-06
    if (this.phase !== 'PLACING') throw err('BAD_PHASE');
    if (s.ready) throw err('ALREADY_PLACED');
    const t = this.now();
    if (t - s.lastSuggest < this.C.SUGGEST_COOLDOWN * 1000) return { placement: null };
    s.lastSuggest = t;
    return { placement: randomPlacement(this.fleet, this.rand) };
  }
  _submit(s, placement) { // R-7-05
    if (this.phase !== 'PLACING') throw err('BAD_PHASE');
    if (s.ready) throw err('ALREADY_PLACED');
    s.cells = validatePlacement(placement, this.fleet);
    s.placement = placement.map(p => ({ pieceId: p.pieceId, row: p.row, col: p.col, dir: p.dir }));
    s.ready = true;
    this._log('placed', { pid: s.pid, auto: false });
    if (this.players.length === 2 && this.players.every(p => p.ready)) this._beginBattle();
    return {};
  }
  _fire(s, msg) {
    if (this.phase !== 'BATTLE') throw err('BAD_PHASE');                       // R-7-07
    if (msg.turnNo !== this.turnNo) throw err('STALE_TURN');                   // R-7-10
    if (this.turnPid !== s.pid) throw err('NOT_YOUR_TURN');                    // R-7-07
    if (typeof msg.row !== 'number' || typeof msg.col !== 'number') throw err('BAD_REQUEST');
    if (!isInt(msg.row) || !isInt(msg.col) || msg.row < 0 || msg.row >= N || msg.col < 0 || msg.col >= N) throw err('OUT_OF_BOUNDS'); // R-7-08
    if (s.shotsTaken.has(key(msg.row, msg.col))) throw err('ALREADY_SHOT');   // R-7-09
    s.autoStreak = 0;                                                           // R-7-16
    this._shot(s, msg.row, msg.col, false);
    return {};
  }
  _shot(s, row, col, auto) { // R-7-12, R-7-13, R-9-01
    const o = this.opp(s.pid);
    const k = key(row, col);
    const pieceId = o.cells.get(k);
    const result = pieceId ? 'hit' : 'miss';
    s.shotsTaken.set(k, result);
    let sunkPieceId = null;
    if (pieceId) {
      const all = [...o.cells.entries()].filter(([, id]) => id === pieceId).map(([c]) => c);
      if (all.every(c => s.shotsTaken.get(c) === 'hit')) { sunkPieceId = pieceId; o.sunk.push(pieceId); }
    }
    this.lastShot = { shooterPid: s.pid, row, col, result, sunkPieceId, auto, turnNo: this.turnNo };
    this._log('shot', { pid: s.pid, row, col, result, sunkPieceId, auto });
    if (o.sunk.length === this.fleet.length) return this._end(s.pid, 'all_sunk');
    if (auto && s.autoStreak >= this.C.AUTO_SHOT_LIMIT) return this._forfeit(s.pid, 'auto_limit'); // R-8-03
    this.turnPid = o.pid; this.turnNo++;
    this.deadline = this.now() + this.C.SHOT_TIME * 1000;
  }
  _resign(s) { // R-7-15
    if (this.phase !== 'PLACING' && this.phase !== 'BATTLE') throw err('BAD_PHASE');
    this._forfeit(s.pid, 'resign');
    return {};
  }
  _rematch(s, want) { // R-8-08
    if (this.phase !== 'GAME_OVER') throw err('BAD_PHASE');
    if (this.players.length < 2) throw err('NO_OPPONENT');
    s.wantsRematch = want !== false;
    if (this.players.every(p => p.wantsRematch)) this._startGame();
    return {};
  }
  _backToLobby(s) {
    if (this.phase !== 'GAME_OVER' || this.players.length !== 1) throw err('BAD_PHASE');
    this.phase = 'LOBBY'; this.result = null; this.lastShot = null; this.deadline = null;
    this._resetSeat(s);
    return {};
  }
  leave(pid) { // R-8-06
    const s = this.seat(pid); if (!s) return;
    if (this.phase === 'PLACING' || this.phase === 'BATTLE') this._forfeit(pid, 'resign');
    this._removeSeat(pid);
    if (this.phase === 'GAME_OVER') for (const p of this.players) p.wantsRematch = false;
    this._log('leave', { pid });
  }

  // ---------- เวลา (เรียกจาก server ทุก ~0.5 วินาที) ----------
  tick() {
    const t = this.now();
    let changed = false;
    // R-8-04 / R-8-07 หลุดเกินกำหนด ตรวจทุกคนในรอบเดียวกัน
    const gone = this.players.filter(p => !p.connected && p.disconnectedAt != null && t - p.disconnectedAt >= this.C.RECONNECT_GRACE * 1000);
    if (gone.length) {
      if (this.phase === 'PLACING' || this.phase === 'BATTLE') {
        if (gone.length === this.players.length) this._end(null, 'cancelled');
        else this._forfeit(gone[0].pid, 'disconnect');
      }
      for (const g of gone) this._removeSeat(g.pid);
      if (this.phase === 'GAME_OVER') for (const p of this.players) p.wantsRematch = false;
      if (this.phase === 'LOBBY' && this.players.length === 0) this.deadline = null;
      changed = true;
    }
    if (this.phase === 'PLACING' && t >= this.deadline) { // R-8-01
      for (const s of this.players) if (!s.ready) {
        const pl = randomPlacement(this.fleet, this.rand);
        s.cells = validatePlacement(pl, this.fleet); s.placement = pl; s.ready = true;
        this._log('placed', { pid: s.pid, auto: true });
      }
      if (this.players.length === 2) this._beginBattle();
      changed = true;
    } else if (this.phase === 'BATTLE' && t >= this.deadline) { // R-8-02
      const s = this.seat(this.turnPid);
      const free = [];
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!s.shotsTaken.has(key(r, c))) free.push([r, c]);
      const [r, c] = free[Math.floor(this.rand() * free.length)];
      s.autoStreak++;
      this._shot(s, r, c, true);
      changed = true;
    }
    return changed;
  }
  expired() { // R-8-09
    return this.emptySince != null && this.now() - this.emptySince >= this.C.ROOM_IDLE_CLOSE * 1000;
  }

  // ---------- สิ่งที่ผู้เล่นเห็น (หัวข้อ 4, R-4-01..R-4-04) ----------
  getState(pid) {
    const t = this.now();
    const reveal = this.phase === 'GAME_OVER';
    return {
      code: this.code, phase: this.phase, gameNo: this.gameNo,
      you: pid, turnPid: this.turnPid, turnNo: this.turnNo,
      deadline: this.deadline, serverNow: t,
      lastShot: this.lastShot, result: this.result,
      config: { SHOT_TIME: this.C.SHOT_TIME, PLACE_TIME: this.C.PLACE_TIME, RECONNECT_GRACE: this.C.RECONNECT_GRACE, SUNK_BANNER_MS: this.C.SUNK_BANNER_MS },
      players: this.players.map(p => ({
        pid: p.pid, name: p.name, connected: p.connected, ready: p.ready,
        wantsRematch: p.wantsRematch, autoStreak: p.autoStreak,
        graceLeft: p.connected || p.disconnectedAt == null ? null
          : Math.max(0, Math.ceil((this.C.RECONNECT_GRACE * 1000 - (t - p.disconnectedAt)) / 1000)),
        shotsTaken: [...p.shotsTaken.entries()].map(([k, res]) => ({ row: Math.floor(k / N), col: k % N, result: res })),
        sunk: [...p.sunk],
        placement: (p.pid === pid || reveal) && p.placement ? p.placement.map(x => ({ ...x })) : null,
      })),
    };
  }
}

module.exports = { Room, GameError, CONFIG, validateConfig, validatePlacement, randomPlacement };
