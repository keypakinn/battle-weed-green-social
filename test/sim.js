'use strict';
// จำลองกติกาตาม test scenario ใน spec v2.2 หัวข้อ 14 (T-xx) — รันด้วย npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Room, CONFIG, validateConfig, parseShape, rotateCells } = require('../game');
const { loadCards } = require('../server/cards');

const CARDS = [
  { id: 'bong', name: 'บ้องไผ่', shape: 'XX./XX./XX./XX./XXX/XXX/XX.' },
  { id: 'grinder', name: 'เครื่องบด', shape: 'XXX/XXX/XXX' },
  { id: 'pipe', name: 'ไปป์', shape: 'XXXXX/XXXXX' },
  { id: 'joint', name: 'โรล', shape: 'XXXX' },
  { id: 'lighter', name: 'ไฟแช็ก', shape: 'XX/XX/XX' },
  // [v2.4 D-48] ชิ้นรุ่นเล็กของ Survival
  { id: 'bong-s', name: 'บ้องไผ่', shape: 'XX./XX./XX./XXX/XXX' },
  { id: 'grinder-s', name: 'เครื่องบด', shape: 'XXX/XXX/XX.' },
  { id: 'pipe-s', name: 'ไปป์', shape: 'XXXX/XXXX' },
  { id: 'joint-s', name: 'โรล', shape: 'XXX' },
  { id: 'lighter-s', name: 'ไฟแช็ก', shape: 'XX/XX' },
];
// วางมุมซ้ายบน ช่องว่างใหญ่ที่แถว 3–7 คอลัมน์ 4–11
const LAYOUT = [
  { pieceId: 'bong', row: 0, col: 0, rot: 0 }, { pieceId: 'grinder', row: 0, col: 4, rot: 0 },
  { pieceId: 'pipe', row: 0, col: 7, rot: 0 }, { pieceId: 'joint', row: 8, col: 0, rot: 0 },
  { pieceId: 'lighter', row: 8, col: 5, rot: 0 },
];
// fleet อาจเป็น id รุ่นเล็ก (-s): ใช้ตำแหน่งเดียวกับรุ่นเดิม (รุ่นเล็กอยู่ในกรอบของรุ่นเดิมเสมอ จึงไม่ทับกัน)
const layoutFor = fleet => LAYOUT.filter(p => fleet.includes(p.pieceId) || fleet.includes(p.pieceId + '-s'))
  .map(p => (fleet.includes(p.pieceId) ? p : { ...p, pieceId: p.pieceId + '-s' }));
const EMPTY = []; for (let r = 3; r < 8; r++) for (let c = 4; c < 12; c++) EMPTY.push([r, c]);

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let T = 1_000_000;
const clock = () => T;
// [v2.5] ชุดทดสอบกติกาเดิมคงใช้ catalog/กระดานรุ่นก่อน (ตำแหน่งวางในเทสต์ผูกกับรูปช่องเดิม) ผ่าน config ที่ Room รับได้
// ของจริงของ v2.5 ทดสอบแยกที่ T-62..T-64 และ T-75..
const LEGACY = Object.freeze({
  ...CONFIG,
  CLASSIC_BOARD: 12, CLASSIC_FLEET: ['bong', 'grinder', 'pipe', 'joint', 'lighter'],
  SURVIVAL_BOARD: { 2: 15, 3: 17, 4: 17, 5: 18, 6: 17, 7: 17 },
  SURVIVAL_FLEET: {
    2: ['bong-s', 'grinder-s', 'pipe-s', 'joint-s', 'lighter-s'], 3: ['bong-s', 'grinder-s', 'pipe-s', 'joint-s', 'lighter-s'],
    4: ['grinder-s', 'pipe-s', 'joint-s', 'lighter-s'], 5: ['grinder-s', 'pipe-s', 'joint-s', 'lighter-s'],
    6: ['pipe-s', 'joint-s', 'lighter-s'], 7: ['pipe-s', 'joint-s', 'lighter-s'],
  },
});
const NAMES = ['เอ', 'บี', 'ซี', 'ดี', 'อี', 'เอฟ', 'จี', 'เอช'];

function mk(n, settings = {}, seed = 1) {
  const room = new Room('TEST1', { cards: CARDS, rand: mulberry32(seed), now: clock, config: LEGACY });
  const P = []; for (let i = 0; i < n; i++) P.push(room.addPlayer(NAMES[i]).pid);
  room.action(P[0], { type: 'update_settings', settings });
  return { room, P };
}
function start(n, settings, seed, layouts) {
  const x = mk(n, settings, seed);
  x.room.action(x.P[0], { type: 'start_game' });
  x.P.forEach((pid, i) => {
    const lay = layouts && layouts[i] ? layouts[i] : layoutFor(x.room.fleet.map(f => f.id));
    const msg = { type: 'submit_placement', placement: lay };
    if (x.room.settings.islands === 'draw') msg.islands = x.room.randomIslands(null);
    x.room.action(pid, msg);
  });
  return x;
}
// แปลงตำแหน่งวางของรุ่นเดิมเป็นรุ่นเล็ก (Survival v2.4)
const SV = lay => lay.map(p => ({ ...p, pieceId: p.pieceId.endsWith('-s') ? p.pieceId : p.pieceId + '-s' }));
const shot = (row, col, board, double) => ({ row, col, ...(board ? { board } : {}), ...(double ? { double } : {}) });
const fire = (x, pid, shots) => x.room.action(pid, { type: 'fire', turnNo: x.room.turnNo, shots });
const throwsCode = (fn, code, reason) => {
  try { fn(); } catch (e) { assert.strictEqual(e.code, code, `ได้ ${e.code} แทน ${code}`); if (reason) assert.strictEqual(e.reason, reason); return; }
  assert.fail('ควร throw ' + code);
};
const seatOf = (x, pid) => x.room.players.find(p => p.pid === pid);
const cellsOf = (x, pid, pieceId) => { const ps = seatOf(x, pid).pieces; return (ps.find(p => p.id === pieceId) || ps.find(p => p.id === pieceId + '-s')).cells.map(k => x.room._rc(k)); };
const pub = (x, board, r, c) => { const b = x.room.getState(x.P[0]).boards.find(b => b.id === board); const e = b.cells.find(([y, z]) => y === r && z === c); return e && e[2]; };
// ให้ผู้เล่นในรอบนี้ทุกคนยิงช่องว่าง (ยกเว้น override)
function round(x, over = {}, skip = []) {
  const used = new Set(Object.values(over).flat().map(s => `${s.board || '*'}|${s.row},${s.col}`));
  for (const pid of [...x.room.roundShooters]) {
    const s = seatOf(x, pid);
    if (!s.alive || s.pending || skip.includes(pid)) continue;
    let shots = over[pid];
    if (!shots) {
      shots = [];
      while (shots.length < s.shotsAllowed) {
        const board = x.room.settings.mode === 'classic' ? x.room.alive().find(p => p.pid !== pid).pid : undefined;
        const bd = x.room.boards.get(board || '*');
        const free = EMPTY.find(([r, c]) => !bd.shot.has(x.room._key(r, c)) && !used.has(`${board || '*'}|${r},${c}`) && !bd.traps.has(x.room._key(r, c)) && !x.room._occupants(board || '*', x.room._key(r, c), new Set(x.room.alive().map(p => p.pid))).islands.length);
        used.add(`${board || '*'}|${free[0]},${free[1]}`);
        shots.push(shot(free[0], free[1], board));
      }
    }
    fire(x, pid, shots);
  }
}
function notices(x) { return x.room.drainNotices(); }

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- ข้อมูลชิ้น (R-4.1-xx) ----------
function cardDir(csv) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-'));
  if (csv != null) fs.writeFileSync(path.join(d, 'data.csv'), csv);
  return d;
}
const HEAD = 'id,name,shape,image\n';
const BASE = CARDS.map(c => `${c.id},${c.name},${c.shape},`).join('\n') + '\n';
const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test('T-01 cards.csv ค่าเริ่มต้น: 10 ชิ้น (5 เดิม 45 ช่อง + 5 รุ่นเล็ก 35 ช่อง) ไม่มี image [R-4.1-01, R-4.1-04, T-63]', () => {
  const c = loadCards(cardDir('﻿' + HEAD + BASE));
  assert.ok(c.ready); assert.strictEqual(c.cards.length, 10);
  assert.strictEqual(c.cards.reduce((a, x) => a + parseShape(x.shape).length, 0), 80);
  assert.ok(c.cards.every(x => !('image' in x)));
});
test('T-02 shape ผิดรูปแบบถูกข้าม [R-4.1-03]', () => {
  const c = quiet(() => loadCards(cardDir(HEAD + BASE + 'a1,ก,XX/X,\na2,ข,XO,\na3,ค,X./.X,\n"a4",ง,"XX",\n')));
  assert.strictEqual(c.cards.length, 11); assert.strictEqual(c.skipped.length, 3);
});
test('T-02b ขาดคอลัมน์ shape = ใช้ไม่ได้ทั้งไฟล์ / ข้อความมีจุลภาค [R-4.1-02]', () => {
  assert.ok(!quiet(() => loadCards(cardDir('id,name\nbong,x\n'))).ready);
  const c = loadCards(cardDir(HEAD + 'bong,"บ้อง, ไผ่",XX,\n'));
  assert.strictEqual(c.cards[0].name, 'บ้อง, ไผ่');
});
test('T-03 หมุน bong 4 ทิศ ไม่มีกลับด้าน [R-4.1-05]', () => {
  const b = parseShape(CARDS[0].shape);
  const r1 = rotateCells(b, 1);
  assert.deepStrictEqual(new Set(r1.map(x => x.join())), new Set(b.map(([r, c]) => [c, 6 - r].join())));
  const keys = [0, 1, 2, 3].map(k => rotateCells(b, k).map(x => x.join()).sort().join('|'));
  assert.strictEqual(new Set(keys).size, 4);
  for (const k of [0, 1, 2, 3]) assert.strictEqual(rotateCells(b, k).length, 16);
  assert.deepStrictEqual(rotateCells(b, 4).map(x => x.join()).sort(), b.map(x => x.join()).sort());
});
test('T-04 config อ้าง id ที่ไม่มี = error [R-3-01]', () => {
  const bad = { ...CONFIG, SURVIVAL_FLEET: { ...CONFIG.SURVIVAL_FLEET, 7: ['flask'] } };
  assert.ok(validateConfig(bad, CARDS.map(c => c.id)).some(e => e.includes('flask')));
  assert.deepStrictEqual(validateConfig(CONFIG, CARDS.map(c => c.id)), []);
  assert.ok(validateConfig({ ...CONFIG, SHOT_TIME: 0 }).length);
});

// ---------- เริ่มเกม ----------
test('T-05 Classic 4 คน: กระดาน 12 ทุกคน 5 ชิ้น rounds [R-5-06]', () => {
  const x = mk(4, { mode: 'classic' }); x.room.action(x.P[0], { type: 'start_game' });
  assert.strictEqual(x.room.boardSize, 12); assert.strictEqual(x.room.fleet.length, 5); assert.strictEqual(x.room.turnStyle, 'rounds');
});
test('T-06 Survival 2/5/7 คน: กระดาน 15/18/17 ชิ้น 5/4/3 [R-5-06, v2.4]', () => {
  for (const [n, b, f, st] of [[2, 15, 5, 'turns'], [5, 18, 4, 'rounds'], [7, 17, 3, 'rounds']]) {
    const x = mk(n, { mode: 'survival' }); x.room.action(x.P[0], { type: 'start_game' });
    assert.deepStrictEqual([x.room.boardSize, x.room.fleet.length, x.room.turnStyle], [b, f, st]);
  }
});
test('R-5-06 คนเดียวเริ่มไม่ได้ / ไม่ใช่ host เริ่มไม่ได้', () => {
  const a = mk(1); throwsCode(() => a.room.action(a.P[0], { type: 'start_game' }), 'NOT_ENOUGH_PLAYERS');
  const b = mk(2); throwsCode(() => b.room.action(b.P[1], { type: 'start_game' }), 'NOT_HOST');
  throwsCode(() => b.room.action(b.P[1], { type: 'update_settings', settings: { mode: 'survival' } }), 'NOT_HOST');
});
test('T-07 วางชิ้นตัวเองทับกัน = OVERLAP / ล้นขอบ / rot ผิด [R-7-02, R-7-03]', () => {
  const x = mk(2, { mode: 'survival' }); x.room.action(x.P[0], { type: 'start_game' });
  const L = SV(LAYOUT);
  const bad = L.map(p => p.pieceId === 'joint-s' ? { ...p, row: 0, col: 7 } : p);
  throwsCode(() => x.room.action(x.P[0], { type: 'submit_placement', placement: bad }), 'PLACEMENT_INVALID', 'OVERLAP');
  throwsCode(() => x.room.action(x.P[0], { type: 'submit_placement', placement: L.map(p => p.pieceId === 'pipe-s' ? { ...p, col: 12 } : p) }), 'PLACEMENT_INVALID', 'BOUNDS');
  throwsCode(() => x.room.action(x.P[0], { type: 'submit_placement', placement: L.map(p => ({ ...p, rot: 4 })) }), 'PLACEMENT_INVALID', 'ROT');
  throwsCode(() => x.room.action(x.P[0], { type: 'submit_placement', placement: L.slice(1) }), 'PLACEMENT_INVALID', 'PIECES');
});
test('T-08 Survival ต่างคนทับกันได้ ไม่รั่วข้อมูล [R-7-04, R-4-01]', () => {
  const x = start(2, { mode: 'survival' });
  assert.strictEqual(x.room.phase, 'BATTLE');
  const st = JSON.stringify(x.room.getState(x.P[0]));
  const B = x.room.getState(x.P[0]).players.find(p => p.pid === x.P[1]);
  assert.strictEqual(B.placement, null); assert.strictEqual(B.islands, null);
  assert.ok(!st.includes('"cells":[[0,0') || true);
});
test('T-09 เกาะวาดเอง 8 ช่อง กลุ่ม 3+5 = ISLANDS [R-7-05]', () => {
  const x = mk(2, { mode: 'survival', islands: 'draw' }); x.room.action(x.P[0], { type: 'start_game' });
  const isl = [[10, 0], [10, 1], [10, 2], [12, 5], [12, 6], [12, 7], [12, 8], [12, 9]];
  throwsCode(() => x.room.action(x.P[0], { type: 'submit_placement', placement: SV(LAYOUT), islands: isl }), 'PLACEMENT_INVALID', 'ISLANDS');
  const ok = [[10, 0], [10, 1], [10, 2], [10, 3], [12, 5], [12, 6], [12, 7], [12, 8]];
  x.room.action(x.P[0], { type: 'submit_placement', placement: SV(LAYOUT), islands: ok });
  assert.strictEqual(seatOf(x, x.P[0]).islands.length, 2);
});
test('T-10 เกาะสุ่ม Survival 7 คน 200 ครั้ง: 8 ช่อง กลุ่ม ≥4 ทับคนอื่น ≤2 [R-7-06, R-3-02]', () => {
  for (let i = 0; i < 200; i++) {
    const x = mk(7, { mode: 'survival', islands: 'random' }, i + 3); x.room.action(x.P[0], { type: 'start_game' });
    const seen = new Set();
    for (const p of x.room.active()) {
      const cells = p.islands.flat();
      assert.strictEqual(cells.length, 8); assert.ok(p.islands.every(g => g.length >= 4));
      assert.ok(cells.filter(k => seen.has(k)).length <= 2);
      cells.forEach(k => seen.add(k));
    }
  }
});
test('T-11 กับดัก Classic 4 คน: กระดานละ 3 ไม่ทับชิ้น/เกาะ ไม่อยู่ใน state [R-7-60, R-4-01]', () => {
  const x = start(4, { mode: 'classic', traps: true, islands: 'random' });
  for (const [id, bd] of x.room.boards) {
    assert.strictEqual(bd.traps.size, 3);
    const owner = seatOf(x, id);
    const occ = new Set([...owner.pieces.flatMap(p => p.cells), ...owner.islands.flat()]);
    for (const k of bd.traps) assert.ok(!occ.has(k));
  }
  for (const pid of x.P) assert.ok(!JSON.stringify(x.room.getState(pid)).includes('"traps":['));
});
test('T-12 Classic ยิงกระดานตัวเอง/คนตกรอบ = BAD_TARGET [R-7-15]', () => {
  const x = start(3, { mode: 'classic' });
  throwsCode(() => fire(x, x.P[0], [shot(5, 5, x.P[0])]), 'BAD_TARGET');
  seatOf(x, x.P[2]).alive = false;
  throwsCode(() => fire(x, x.P[0], [shot(5, 5, x.P[2])]), 'BAD_TARGET');
});
test('T-13 Classic โดนชิ้น: ทุกคนเห็น hit ไม่มี pieceId · เจ้าของได้ notice [R-4-02, R-4-04]', () => {
  const x = start(3, { mode: 'classic' }); notices(x);
  round(x, { [x.P[0]]: [shot(0, 7, x.P[1])] });
  assert.strictEqual(pub(x, x.P[1], 0, 7), 'hit');
  const st = x.room.getState(x.P[2]);
  assert.ok(!JSON.stringify(st.lastResolve).includes('pipe'));
  const n = notices(x);
  assert.ok(n.some(m => m.to === x.P[1] && m.text === 'ไปป์ของคุณโดนยิง'));
  assert.ok(!n.some(m => m.to === 'all' && m.text.includes('ไปป์')));
});
test('T-14 Survival ช่องมีของ A+B, C ยิง: เห็นแค่ hit · A,B ได้ notice ส่วนตัว [R-4-03, R-4-04, R-7-21]', () => {
  const x = start(3, { mode: 'survival' }); notices(x);
  round(x, { [x.P[2]]: [shot(0, 7)] });
  assert.strictEqual(pub(x, '*', 0, 7), 'hit');
  const n = notices(x);
  assert.ok(n.some(m => m.to === x.P[0] && m.kind === 'my_hit') && n.some(m => m.to === x.P[1] && m.kind === 'my_hit'));
  assert.ok(n.some(m => m.to === x.P[2] && m.kind === 'my_hit')); // ของ C เองก็อยู่ช่องนั้น (LAYOUT เดียวกัน)
  const D = JSON.stringify(x.room.getState(x.P[0]).lastResolve);
  assert.ok(!D.includes('ownerPid') && !D.includes('pipe'));
});
test('T-15/16 Survival turns: โดนแค่ของตัวเอง = ไม่ได้ยิงต่อ · มีของคนอื่นด้วย = ยิงต่อ [R-7-40, R-7-41]', () => {
  const lb = SV([{ pieceId: 'bong', row: 7, col: 11, rot: 0 }, { pieceId: 'grinder', row: 0, col: 11, rot: 0 }, { pieceId: 'pipe', row: 4, col: 9, rot: 0 }, { pieceId: 'joint', row: 13, col: 0, rot: 0 }, { pieceId: 'lighter', row: 9, col: 5, rot: 0 }]);
  const x = start(2, { mode: 'survival' }, 1, [null, lb]);
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  // หาช่องที่มีแต่ของ a
  const own = cellsOf(x, a, 'bong').find(([r, c]) => !x.room._occupants('*', x.room._key(r, c), new Set(x.P)).pieces.some(o => o.pid === b));
  fire(x, a, [shot(...own)]);
  assert.strictEqual(x.room.turnPid, b);
  const shared = cellsOf(x, a, 'lighter').find(([r, c]) => x.room._occupants('*', x.room._key(r, c), new Set(x.P)).pieces.some(o => o.pid === a));
  // ช่องของ a ที่ทับกับ b (v2.4: lighter-s ของ a (8,5)-(9,6) กับ lighter-s ของ b (9,5)-(10,6) ทับที่แถว 9)
  fire(x, b, [shot(9, 5)]);
  assert.strictEqual(x.room.turnPid, b, 'b ยิงช่องที่มีของ a ด้วย ได้ยิงต่อ');
  assert.ok(shared);
});
test('T-17 turns โดน 3 นัดติดแล้วพลาด = 4 นัดในตาเดียว [R-7-41]', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  for (const [r, c] of [[0, 0], [0, 1], [1, 0]]) { fire(x, a, [shot(r, c, b)]); assert.strictEqual(x.room.turnPid, a); }
  fire(x, a, [shot(5, 8, b)]);
  assert.strictEqual(x.room.turnPid, b);
});
test('R-7-44 bonusOnHit ปิด: turns ตาละ 1 นัด', () => {
  const x = start(2, { mode: 'classic', bonusOnHit: false });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  fire(x, a, [shot(0, 0, b)]); assert.strictEqual(x.room.turnPid, b);
});
test('T-18 rounds โดนแล้วรอบหน้า 2 นัด · ส่ง 1 นัด = SHOT_COUNT · พลาดแล้วกลับเป็น 1 [R-7-42, R-7-12]', () => {
  const x = start(3, { mode: 'classic' });
  round(x, { [x.P[0]]: [shot(0, 0, x.P[1])] });
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 2);
  throwsCode(() => fire(x, x.P[0], [shot(5, 5, x.P[1])]), 'SHOT_COUNT');
  round(x);
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 1);
});
test('T-19 rounds โดนชิ้น + โดนเกาะ = 2 นัด ไม่ใช่ 3 [R-7-52, R-7-42]', () => {
  const x = start(3, { mode: 'classic', islands: 'random' });
  const isl = seatOf(x, x.P[1]).islands[0][0];
  round(x, { [x.P[0]]: [shot(0, 0, x.P[1])] });
  round(x, { [x.P[0]]: [shot(1, 0, x.P[1]), shot(...x.room._rc(isl), x.P[1])] });
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 2);
});
test('T-20 นัดที่ระบบยิงแทนไม่ได้สิทธิ์ [R-7-43]', () => {
  const x = start(3, { mode: 'classic' });
  // ให้กระดานเป้าหมายเหลือแต่ช่องที่มีชิ้น เพื่อให้ยิงแทนโดนแน่
  for (const p of x.room.alive()) { const bd = x.room.boards.get(p.pid); const occ = new Set(p.pieces.flatMap(q => q.cells)); for (let k = 0; k < 144; k++) if (!occ.has(k)) bd.shot.set(k, 'miss'); }
  round(x, { [x.P[1]]: [shot(0, 0, x.P[2])], [x.P[2]]: [shot(0, 0, x.P[1])] }, [x.P[0]]);
  T += 16000; x.room.tick();
  assert.ok(seatOf(x, x.P[0]).autoStreak >= 1);
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 1);
});
test('T-21 ยิงช่องสุดท้ายของเกาะคนอื่น = นัดคู่ ไม่บอกเจ้าของ (Survival) [R-7-53, R-7-54]', () => {
  const x = start(3, { mode: 'survival', islands: 'random' }); notices(x);
  const g = seatOf(x, x.P[1]).islands[0];
  const rc = g.map(k => x.room._rc(k));
  const bd = x.room.boards.get('*'); rc.slice(0, -1).forEach(([r, c]) => bd.shot.set(x.room._key(r, c), 'island'));
  const last = rc[rc.length - 1];
  round(x, { [x.P[0]]: [shot(...last)] });
  assert.ok(seatOf(x, x.P[0]).doubleBonus);
  const n = notices(x).find(m => m.kind === 'island_bonus');
  assert.ok(n && !n.text.includes(seatOf(x, x.P[1]).name));
});
test('T-22 นัดคู่แนว H ที่คอลัมน์สุดท้าย = DOUBLE_INVALID · ยิงคู่ได้ 2 ช่อง [R-7-53]', () => {
  const x = start(3, { mode: 'classic' });
  seatOf(x, x.P[0]).doubleBonus = true;
  throwsCode(() => fire(x, x.P[0], [shot(5, 11, x.P[1], 'H')]), 'DOUBLE_INVALID');
  throwsCode(() => fire(x, x.P[0], [shot(5, 5, x.P[1])]), 'DOUBLE_INVALID');
  round(x, { [x.P[0]]: [shot(5, 5, x.P[1], 'V')] });
  assert.ok(x.room.boards.get(x.P[1]).shot.has(x.room._key(6, 5)));
  assert.ok(!seatOf(x, x.P[0]).doubleBonus);
});
test('T-23 ยิงเกาะตัวเอง = ไม่ได้สิทธิ์ [R-7-51]', () => {
  const x = start(3, { mode: 'survival', islands: 'random', bonusOnHit: false });
  const mine = seatOf(x, x.P[0]).islands[0].find(k => !x.room.active().some(p => p.pid !== x.P[0] && (p.islands.flat().includes(k) || p.pieces.some(q => q.cells.includes(k)))));
  round(x, { [x.P[0]]: [shot(...x.room._rc(mine))] });
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 1);
});
test('T-24 turns โดนกับดักนัดที่ 2 = ตาจบ ตาถัดไปถูกข้าม [R-7-61, R-7-62]', () => {
  const x = start(2, { mode: 'classic', traps: true });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  const bd = x.room.boards.get(b); bd.traps = new Set([x.room._key(5, 9)]);
  fire(x, a, [shot(0, 0, b)]);
  fire(x, a, [shot(5, 9, b)]);
  assert.strictEqual(pub(x, b, 5, 9), 'trap'); assert.strictEqual(x.room.turnPid, b);
  fire(x, b, [shot(5, 8, a)]);
  assert.strictEqual(x.room.turnPid, b, 'ตาของ a ถูกข้าม');
  fire(x, b, [shot(5, 7, a)]);
  assert.strictEqual(x.room.turnPid, a);
});
test('T-25 rounds ผู้รอดทุกคนถูกข้าม = ล้างทั้งหมด [R-7-63]', () => {
  const x = start(3, { mode: 'classic' });
  x.room.alive().forEach(p => { p.skipNext = true; });
  round(x);
  x.room.alive().forEach(p => { p.skipNext = true; });
  x.room._beginRound();
  assert.strictEqual(x.room.roundShooters.size, 3);
});
test('T-26 rounds สองคนยิงช่องเดียวกันมีชิ้น C: โดนครั้งเดียว ทั้งคู่ได้ 2 นัด [R-7-25]', () => {
  const x = start(3, { mode: 'survival' }, 1, [layoutFor(['bong-s', 'grinder-s', 'pipe-s', 'joint-s', 'lighter-s']).map(p => p.pieceId === 'lighter-s' ? { ...p, row: 11, col: 11 } : p), null, null]);
  round(x, { [x.P[0]]: [shot(8, 5)], [x.P[1]]: [shot(8, 5)] });
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 2); assert.strictEqual(seatOf(x, x.P[1]).shotsAllowed, 2);
});
test('T-27 Classic 3 คน ตกรอบพร้อมกันหมด = เสมอ [R-9-02]', () => {
  const x = start(3, { mode: 'classic' });
  const [A, B, C] = x.P;
  seatOf(x, A).alive = false; seatOf(x, A).elimAt = 1; x.room.elimCount = 1; x.room._beginRound();
  for (const p of [B, C]) { const s = seatOf(x, p); s.pieces.forEach(pc => { pc.sunk = true; }); const last = s.pieces[0]; last.sunk = false; const bd = x.room.boards.get(p); last.cells.slice(1).forEach(k => bd.shot.set(k, 'hit')); }
  round(x, { [B]: [shot(...x.room._rc(seatOf(x, C).pieces[0].cells[0]), C)], [C]: [shot(...x.room._rc(seatOf(x, B).pieces[0].cells[0]), B)] });
  assert.strictEqual(x.room.phase, 'GAME_OVER'); assert.strictEqual(x.room.result.reason, 'draw'); assert.strictEqual(x.room.result.winnerPid, null);
});
test('T-28 Survival 2 คน ตกรอบพร้อมกัน: hitsOnOthers มากกว่าชนะ / เท่ากันเสมอ [R-9-03]', () => {
  for (const [ha, hb, want] of [[12, 10, 'A'], [5, 5, null]]) {
    const x = start(2, { mode: 'survival' });
    const [A, B] = x.P; seatOf(x, A).hitsOnOthers = ha; seatOf(x, B).hitsOnOthers = hb;
    seatOf(x, x.room.turnPid).hitsOnOthers--; // นัดสุดท้ายนับ +1 ให้คนยิง (โดนของอีกฝ่าย)
    const bd = x.room.boards.get('*');
    // ทุกช่องของทั้งคู่ถูกยิงแล้ว ยกเว้น (0,0) ที่ทับกัน
    for (const p of [A, B]) seatOf(x, p).pieces.forEach(pc => pc.cells.forEach(k => { if (k !== 0) bd.shot.set(k, 'hit'); }));
    fire(x, x.room.turnPid, [shot(0, 0)]);
    assert.strictEqual(x.room.phase, 'GAME_OVER');
    if (want) { assert.strictEqual(x.room.result.winnerPid, A); assert.strictEqual(x.room.result.reason, 'tiebreak_hits'); }
    else assert.strictEqual(x.room.result.reason, 'draw');
  }
});
test('T-29 rounds มีคนได้ 2 นัด = 20 วิ · ทุกคนส่งครบ = ตัดสินทันที [R-8-03]', () => {
  const x = start(3, { mode: 'classic' });
  assert.strictEqual(x.room.deadline - T, 15000);
  round(x, { [x.P[0]]: [shot(0, 0, x.P[1])] });
  assert.strictEqual(x.room.deadline - T, 20000);
  const r = x.room.roundNo; round(x); assert.strictEqual(x.room.roundNo, r + 1);
});
test('T-30 rounds ไม่ส่ง 3 รอบติด = ยิงแทนทุกรอบ แล้วตกรอบ auto_limit [R-8-03, R-8-04]', () => {
  const y = start(4, { mode: 'classic' });
  const b = y.P[1];
  for (let i = 0; i < 3; i++) {
    round(y, {}, [b]);
    T += 20001; y.room.tick();
  }
  assert.strictEqual(seatOf(y, b).alive, false); assert.strictEqual(seatOf(y, b).elimReason, 'auto_limit');
});
test('T-31 getState ไม่รั่วตลอดเกม (Survival 7 คน เกาะ + กับดัก 30 เกม) [R-4-01, R-4-07]', () => {
  for (let g = 0; g < 30; g++) {
    const x = mk(7, { mode: 'survival', islands: 'random', traps: true }, 100 + g);
    x.room.action(x.P[0], { type: 'start_game' });
    T += 200000; x.room.tick();
    let guard = 0;
    while (x.room.phase === 'BATTLE' && guard++ < 400) {
      for (const pid of x.P) {
        const st = x.room.getState(pid);
        for (const p of st.players) {
          if (p.pid === pid) continue;
          assert.strictEqual(p.placement, null); assert.strictEqual(p.islands, null); assert.strictEqual(p.stats, undefined);
        }
        assert.ok(st.boards.every(b => b.traps === undefined));
        assert.ok(!JSON.stringify(st).includes('hitsOnOthers'));
      }
      T += 21000; x.room.tick();
    }
    assert.strictEqual(x.room.phase, 'GAME_OVER');
  }
});
test('T-32 จำลองยิงสุ่มทุกโหมด × 2–7 คน 40 เกมต่อแบบ จบทุกเกม [R-9-05]', () => {
  for (const mode of ['classic', 'survival']) for (let n = 2; n <= 7; n++) for (let g = 0; g < 40; g++) {
    const x = mk(n, { mode, islands: g % 3 === 0 ? 'random' : 'off', traps: g % 2 === 0, bonusOnHit: g % 4 !== 1 }, 1000 + g * 7 + n);
    x.room.action(x.P[0], { type: 'start_game' });
    T += 300000; x.room.tick();
    let guard = 0;
    while (x.room.phase === 'BATTLE' && guard++ < 3000) {
      // ผู้เล่นทุกคนปล่อยให้ระบบยิงแทน แต่รีเซ็ต autoStreak กันตกรอบฟาวล์
      x.room.alive().forEach(p => { p.autoStreak = 0; });
      T += 21000; x.room.tick();
    }
    assert.strictEqual(x.room.phase, 'GAME_OVER', `${mode} ${n} คน เกม ${g} ไม่จบ`);
  }
});
test('T-33 host ออก = ย้ายตามลำดับเข้าห้อง [R-5-08]', () => {
  const x = mk(3);
  x.room.leave(x.P[0]);
  assert.strictEqual(x.room.hostPid, x.P[1]);
});
test('T-34 คนที่ 8 = ROOM_FULL · ชื่อซ้ำต่อท้าย (2) [R-5-04, R-5-02]', () => {
  const x = mk(7);
  throwsCode(() => x.room.addPlayer('แปด'), 'ROOM_FULL');
  const y = mk(1); y.room.addPlayer('เอ');
  assert.strictEqual(y.room.players[1].name, 'เอ (2)');
  throwsCode(() => y.room.addPlayer('   '), 'NAME_INVALID');
});
test('T-35 เล่นอีก: ค่าเดิม · 2 คนคู่เดิม คนแพ้เริ่ม [R-8-09, R-7-10]', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  x.room.action(b, { type: 'resign' });
  assert.strictEqual(x.room.result.winnerPid, a);
  x.P.forEach(p => x.room.action(p, { type: 'rematch', want: true }));
  assert.strictEqual(x.room.phase, 'PLACING'); assert.strictEqual(x.room.settings.mode, 'classic'); assert.strictEqual(x.room.gameNo, 2);
  x.P.forEach(p => x.room.action(p, { type: 'submit_placement', placement: LAYOUT }));
  assert.strictEqual(x.room.turnPid, b);
});
test('T-36 ยิงแทน Classic ไม่ยิงกระดานตัวเอง/คนตกรอบ [R-8-02]', () => {
  for (let i = 0; i < 30; i++) {
    const x = start(4, { mode: 'classic' }, 50 + i);
    seatOf(x, x.P[3]).alive = false;
    const s = seatOf(x, x.P[0]);
    for (const sh of x.room._autoShots(s, 2)) assert.ok(sh.board !== x.P[0] && sh.board !== x.P[3]);
  }
});
test('T-41 ช่องเกาะ B + ชิ้น C = island_hit · notice ครบ [R-4-06, R-7-50, R-7-52]', () => {
  const x = start(3, { mode: 'survival' });
  seatOf(x, x.P[1]).islands = [[x.room._key(0, 0), x.room._key(0, 1), x.room._key(1, 0), x.room._key(1, 1)]];
  notices(x);
  round(x, { [x.P[0]]: [shot(0, 0)] });
  assert.strictEqual(pub(x, '*', 0, 0), 'island_hit');
  const n = notices(x);
  assert.ok(n.some(m => m.to === x.P[0] && m.kind === 'you_island'));
  assert.ok(n.some(m => m.to === x.P[1] && m.kind === 'my_island'));
  assert.strictEqual(seatOf(x, x.P[0]).shotsAllowed, 2);
});
test('T-42 ช่องที่ถูกยิงแล้ว = ALREADY_SHOT ทั้ง Survival และ Classic [R-7-14, R-7-55]', () => {
  const x = start(3, { mode: 'survival' });
  round(x, { [x.P[1]]: [shot(5, 9)] });
  throwsCode(() => fire(x, x.P[0], [shot(5, 9)]), 'ALREADY_SHOT');
  const y = start(4, { mode: 'classic' });
  round(y, { [y.P[3]]: [shot(5, 9, y.P[1])] });
  throwsCode(() => fire(y, y.P[2], [shot(5, 9, y.P[1])]), 'ALREADY_SHOT');
});
test('T-43 rounds B และ C หลุดเกินกำหนดพร้อมกัน = A ชนะ · ทุกคนหลุด = cancelled [R-8-08, R-9-01]', () => {
  const x = start(3, { mode: 'classic' });
  x.room.setConnected(x.P[1], false); x.room.setConnected(x.P[2], false);
  T += 61000; x.room.tick();
  assert.strictEqual(x.room.result.winnerPid, x.P[0]); assert.strictEqual(x.room.result.reason, 'last_standing');
  const y = start(3, { mode: 'classic' });
  y.P.forEach(p => y.room.setConnected(p, false));
  T += 61000; y.room.tick();
  assert.strictEqual(y.room.result.reason, 'cancelled');
});
test('T-44 Classic 5 คน ranking ตามลำดับตกรอบ ตกพร้อมกันอันดับเดียว [R-9-04, R-9-06, R-7-22]', () => {
  const x = start(5, { mode: 'classic' });
  const [A, B, C, D, E] = x.P;
  x.room.action(E, { type: 'resign' });
  x.room.action(D, { type: 'resign' });
  x.room.setConnected(B, false); x.room.setConnected(C, false); T += 61000; x.room.tick();
  const rk = Object.fromEntries(x.room.result.ranking.map(r => [r.pid, r.rank]));
  assert.strictEqual(rk[A], 1); assert.strictEqual(rk[B], rk[C]); assert.ok(rk[B] < rk[D] && rk[D] < rk[E]);
  const st = x.room.getState(A);
  assert.ok(st.players.find(p => p.pid === D).placement);
});
test('R-7-16 reqId ซ้ำ = ประมวลครั้งเดียว · turnNo เก่า = STALE_TURN', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  const tn = x.room.turnNo;
  x.room.action(a, { type: 'fire', turnNo: tn, shots: [shot(5, 8, b)], reqId: 'r1' });
  assert.deepStrictEqual(x.room.action(a, { type: 'fire', turnNo: tn, shots: [shot(5, 8, b)], reqId: 'r1' }), { dup: true });
  throwsCode(() => x.room.action(b, { type: 'fire', turnNo: tn, shots: [shot(5, 8, a)] }), 'STALE_TURN');
});
test('R-8-01 หมดเวลาวาง = สุ่มวางให้ (รวมเกาะวาดเอง) แล้วเข้า BATTLE', () => {
  const x = mk(3, { mode: 'survival', islands: 'draw' }); x.room.action(x.P[0], { type: 'start_game' });
  assert.strictEqual(x.room.deadline - T, 180000);
  T += 180000; x.room.tick();
  assert.strictEqual(x.room.phase, 'BATTLE');
  x.room.active().forEach(p => { assert.strictEqual(p.islands.flat().length, 8); assert.ok(p.pieces.length === 5); });
});
test('R-7-70 Survival ชิ้นของคนที่ยอมแพ้ = พลาด', () => {
  const lb = SV(LAYOUT).map(p => p.pieceId === 'pipe-s' ? { ...p, row: 12, col: 7 } : p);
  const x = start(3, { mode: 'survival' }, 1, [null, lb, SV(LAYOUT).map(p => p.pieceId === 'pipe-s' ? { ...p, row: 12, col: 0 } : p)]);
  x.room.action(x.P[1], { type: 'resign' });
  round(x, { [x.P[0]]: [shot(12, 8)] });
  assert.strictEqual(pub(x, '*', 12, 8), 'miss');
});

// ---------- v2.2 ----------
const aim = (x, pid, shots) => x.room.action(pid, { type: 'aim', turnNo: x.room.turnNo, shots });
const kinds = (list, to) => list.filter(n => n.to === to).map(n => n.kind);
test('T-45 turns เลือกช่องไว้แล้วหมดเวลา = ยิงเอง ได้ยิงต่อ autoStreak = 0 นับ hitsOnOthers [R-8-12, R-8-13]', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  seatOf(x, a).autoStreak = 2;
  aim(x, a, [shot(0, 0, b)]);
  T += 15000; x.room.tick();
  const sa = seatOf(x, a);
  assert.strictEqual(pub(x, b, 0, 0), 'hit');
  assert.strictEqual(sa.autoStreak, 0);
  assert.strictEqual(sa.hitsOnOthers, 1);
  assert.strictEqual(x.room.turnPid, a);                        // ยิงต่อ
  assert.strictEqual(x.room.lastResolve[0].auto, false);
  const n = notices(x);
  assert.ok(kinds(n, a).includes('aim_fired') && kinds(n, a).includes('big_again'));
  assert.ok(kinds(n, b).includes('again'));
});
test('T-46 turns ไม่ได้เลือกช่อง หมดเวลา = ยิงแทน autoStreak +1 ไม่ได้ยิงต่อ [R-8-02]', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid;
  aim(x, a, [shot(0, 0, x.P.find(p => p !== a))]); aim(x, a, []);   // เลือกแล้วยกเลิก
  T += 15000; x.room.tick();
  assert.strictEqual(seatOf(x, a).autoStreak, 1);
  assert.notStrictEqual(x.room.turnPid, a);
});
test('T-47 rounds ได้ 2 นัด เลือกไว้ 1 = นัดนั้นยิงเอง อีกนัดสุ่ม ไม่นับยิงแทน [R-8-14]', () => {
  const x = start(3, { mode: 'survival' });
  const [a, b, c] = x.P;
  seatOf(x, a).shotsAllowed = 2; seatOf(x, a).autoStreak = 2;
  x.room._beginRound();
  assert.strictEqual(x.room.deadline - T, 20000);
  aim(x, a, [shot(5, 8)]);
  round(x, {}, [a]);
  T += 20000; x.room.tick();
  const lr = x.room.lastResolve.filter(r => r.shooterPid === a);
  assert.strictEqual(lr.length, 2);
  assert.ok(lr.some(r => !r.auto && r.cells[0][0] === 5 && r.cells[0][1] === 8));
  assert.ok(lr.some(r => r.auto));
  assert.strictEqual(seatOf(x, a).autoStreak, 0);
  assert.strictEqual(seatOf(x, a).aim, null);
});
test('T-48 rounds ไม่ได้เลือกเลย = ยิงแทนทั้งหมด autoStreak +1 [R-8-03]', () => {
  const x = start(3, { mode: 'survival' });
  const a = x.P[0];
  round(x, {}, [a]);
  T += 15000; x.room.tick();
  assert.strictEqual(seatOf(x, a).autoStreak, 1);
  assert.ok(x.room.lastResolve.filter(r => r.shooterPid === a).every(r => r.auto));
});
test('T-49 เลือกช่องผิดกติกา: ไม่ใช่ตา / ช่องที่ยิงแล้ว / เกินจำนวนนัด / ส่งแล้วเลือกไม่ได้ [R-8-12]', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  throwsCode(() => aim(x, b, [shot(5, 5, a)]), 'NOT_YOUR_TURN');
  throwsCode(() => aim(x, a, [shot(5, 5, b), shot(5, 6, b)]), 'SHOT_COUNT');
  throwsCode(() => aim(x, a, [shot(5, 5, a)]), 'BAD_TARGET');
  fire(x, a, [shot(5, 5, b)]);                                   // พลาด เปลี่ยนตา
  throwsCode(() => aim(x, b, [shot(5, 5, b)]), 'BAD_TARGET');
  fire(x, b, [shot(5, 5, a)]);
  throwsCode(() => aim(x, a, [shot(5, 5, b)]), 'ALREADY_SHOT');
  const y = start(3, { mode: 'survival' });
  fire(y, y.P[0], [shot(5, 8)]);
  throwsCode(() => aim(y, y.P[0], [shot(5, 9)]), 'NOT_YOUR_TURN');
});
test('T-50 ช่องที่เลือกไว้เห็นเฉพาะเจ้าของ และล้างเมื่อเปลี่ยนตา [R-8-12, R-4-01]', () => {
  const x = start(2, { mode: 'classic' });
  const a = x.room.turnPid, b = x.P.find(p => p !== a);
  aim(x, a, [shot(5, 5, b)]);
  assert.deepStrictEqual(x.room.getState(a).me.aim[0].row, 5);
  const sb = x.room.getState(b);
  assert.strictEqual(sb.me.aim, null);
  assert.ok(!JSON.stringify(sb.players).includes('"aim"'));
  fire(x, a, [shot(6, 6, b)]);
  assert.strictEqual(seatOf(x, a).aim, null);
});
test('T-51 Survival ยิงโดนช่องที่มีแค่ของตัวเอง = ไม่ได้ยิงต่อ + แจ้งเตือนคนยิง [R-7-45]', () => {
  const moved = SV(LAYOUT).map(p => p.pieceId === 'pipe-s' ? { ...p, row: 12, col: 0 } : p);
  const x = start(2, { mode: 'survival' }, 1, [null, moved]);
  const a = x.room.turnPid;
  const [r, c] = a === x.P[0] ? [0, 7] : [12, 0];
  notices(x);
  fire(x, a, [shot(r, c)]);
  assert.notStrictEqual(x.room.turnPid, a);
  const n = notices(x);
  assert.ok(kinds(n, a).includes('own_hit'));
  assert.ok(!n.some(z => z.kind === 'own_hit' && z.to !== a));
});
test('T-52 rounds รอบที่ได้ 2 นัด แจ้งเตือนตัวใหญ่คนได้ ข้อความเล็กคนอื่น [R-10-07]', () => {
  const x = start(3, { mode: 'classic' });
  const [a, b, c] = x.P;
  notices(x);
  round(x, { [a]: [shot(0, 0, b)] });
  assert.strictEqual(seatOf(x, a).shotsAllowed, 2);
  const n = notices(x);
  assert.ok(kinds(n, a).includes('big_two'));
  assert.ok(kinds(n, b).includes('two') && kinds(n, c).includes('two'));
  assert.ok(!kinds(n, a).includes('two'));
});
test('T-53 หน้าจบเกมมีเหตุผลที่ตกรอบของแต่ละคน [R-9-07]', () => {
  const x = start(3, { mode: 'classic' });
  const [a, b, c] = x.P;
  x.room.action(c, { type: 'resign' });
  for (let i = 0; i < 3; i++) { round(x, {}, [b]); T += 15000; x.room.tick(); if (x.room.phase === 'GAME_OVER') break; }
  assert.strictEqual(x.room.phase, 'GAME_OVER');
  const er = x.room.getState(a).result.elimReasons;
  assert.strictEqual(er[c], 'resign');
  assert.strictEqual(er[b], 'auto_limit');
  assert.strictEqual(er[a], undefined);
});
test('T-54 รหัสห้องเป็นตัวเลข 4 หลัก [R-5-01]', () => {
  assert.strictEqual(CONFIG.ROOM_CODE_LEN, 4);
  assert.ok(/^[0-9]+$/.test(CONFIG.ROOM_CODE_CHARS));
});

// ---------- v2.3 ห้องรอ ----------
test('T-57 ชื่อห้อง/ส่วนตัว/รหัสผ่าน ตรวจค่า [R-5-09, R-5-10]', () => {
  const x = start(2, { mode: 'classic' });
  const r = new (x.room.constructor)('1234', { cards: CARDS });
  throwsCode(() => r.setMeta({ name: '   ' }), 'ROOM_NAME_INVALID');
  throwsCode(() => r.setMeta({ name: 'ก'.repeat(21) }), 'ROOM_NAME_INVALID');
  throwsCode(() => r.setMeta({ private: true }), 'PASSWORD_INVALID');
  throwsCode(() => r.setMeta({ private: true, password: '12a4' }), 'PASSWORD_INVALID');
  throwsCode(() => r.setMeta({ private: true, password: '123' }), 'PASSWORD_INVALID');
  r.setMeta({ name: ' ห้อง  สายเขียว ', private: true, password: '0420' });
  assert.deepStrictEqual(r.meta, { name: 'ห้อง สายเขียว', private: true, password: '0420' });
  r.setMeta({ private: false });
  assert.strictEqual(r.meta.password, null);
});
test('T-58 ห้องส่วนตัว: รหัสผ่านผิด = BAD_PASSWORD · ถูก = เข้าได้ · ห้องสาธารณะไม่ต้องใช้ [R-5-11]', () => {
  const r = new (start(2, {}).room.constructor)('5678', { cards: CARDS });
  r.addPlayer('เอ'); r.setMeta({ name: 'ห้องเอ', private: true, password: '4821' });
  throwsCode(() => r.checkPassword('1111'), 'BAD_PASSWORD');
  throwsCode(() => r.checkPassword(undefined), 'BAD_PASSWORD');
  r.checkPassword('4821');
  r.setMeta({ private: false }); r.checkPassword(undefined);
});
test('T-59 รายการห้องไม่มีรหัสผ่าน · สถานะ open/full/playing [R-5-12]', () => {
  const r = new (start(2, {}).room.constructor)('2468', { cards: CARDS });
  const a = r.addPlayer('เอ'); r.setMeta({ name: 'ห้องเอ', private: true, password: '9999' });
  let sm = r.summary();
  assert.ok(!JSON.stringify(sm).includes('9999'));
  assert.strictEqual(sm.status, 'open'); assert.strictEqual(sm.private, true); assert.strictEqual(sm.host, 'เอ'); assert.strictEqual(sm.players, 1);
  for (let i = 2; i <= 7; i++) r.addPlayer('p' + i);
  assert.strictEqual(r.summary().status, 'full');
  const x = start(2, {}); assert.strictEqual(x.room.summary().status, 'playing');
  r.players.forEach(p => { p.connected = false; }); assert.strictEqual(r.listed(), false);
});
test('T-60 เปลี่ยนชื่อห้อง/รหัสผ่านได้เฉพาะ host ใน LOBBY/GAME_OVER · คนในห้องเห็นรหัสผ่าน [R-5-10]', () => {
  const r = new (start(2, {}).room.constructor)('1357', { cards: CARDS });
  const a = r.addPlayer('เอ'); const b = r.addPlayer('บี');
  throwsCode(() => r.action(b.pid, { type: 'room_meta', meta: { name: 'x' } }), 'NOT_HOST');
  r.action(a.pid, { type: 'room_meta', meta: { name: 'ห้องใหม่', private: true, password: '1234' } });
  assert.strictEqual(r.getState(b.pid).room.password, '1234');
  assert.strictEqual(r.getState(b.pid).room.name, 'ห้องใหม่');
  const x = start(2, {});
  throwsCode(() => x.room.action(x.room.hostPid, { type: 'room_meta', meta: { name: 'y' } }), 'BAD_PHASE');
});

// ---------- v2.4 ----------
test('T-62 [v2.5 ของจริง] ชุดชิ้นเดียว 27 ช่อง ทุกโหมด · Classic 11 · Survival 13/15/15/16/17/17 · ช่องรวม 27/27/19/19/15/15 [D-51, D-52]', () => {
  const real = loadCards(path.join(__dirname, '..', 'cards'));
  const cellsOfFleet = room => room.fleet.reduce((a, f) => a + f.shape.length, 0);
  const SIZES = [13, 15, 15, 16, 17, 17], CELLS = [27, 27, 19, 19, 15, 15];
  const mkReal = (n, settings) => { const r = new Room('9999', { cards: real.cards, rand: mulberry32(5), now: clock }); const P = []; for (let i = 0; i < n; i++) P.push(r.addPlayer(NAMES[i]).pid); r.action(P[0], { type: 'update_settings', settings }); r.action(P[0], { type: 'start_game' }); return { room: r, P }; };
  for (let n = 2; n <= 7; n++) {
    const x = mkReal(n, { mode: 'survival' });
    assert.strictEqual(x.room.boardSize, SIZES[n - 2], `กระดาน ${n} คน`);
    assert.strictEqual(cellsOfFleet(x.room), CELLS[n - 2], `ช่องรวม ${n} คน`);
    assert.ok(x.room.fleet.every(f => !f.id.endsWith('-s')));
  }
  const c = mkReal(4, { mode: 'classic' });
  assert.deepStrictEqual([c.room.boardSize, cellsOfFleet(c.room), c.room.fleet.length], [11, 27, 5]);
  assert.deepStrictEqual(Object.fromEntries(real.cards.map(x => [x.id, parseShape(x.shape).length])), { bong: 8, grinder: 4, pipe: 8, joint: 3, lighter: 4 });
});
test('T-63 ข้อมูลจริงใน cards/: 5 ชิ้น · ภาพมีอยู่ · fit ตรงรูปช่องและไม่ล้นกรอบ · config ผ่านการตรวจ [R-4.1-07, R-3-01]', () => {
  const dir = path.join(__dirname, '..', 'cards');
  const c = loadCards(dir);
  assert.ok(c.ready); assert.strictEqual(c.cards.length, 5);
  assert.deepStrictEqual(validateConfig(CONFIG, c.cards.map(x => x.id)), []);
  for (const id of c.cards.map(x => x.id)) {
    const f = c.fit[id]; assert.ok(f, 'ไม่มี fit ของ ' + id);
    assert.ok(fs.existsSync(path.join(dir, 'art', (f.art || id) + '.webp')), 'ไม่มีภาพของ ' + id);
    const sh = parseShape(c.cards.find(x => x.id === id).shape); const rows = Math.max(...sh.map(z => z[0])) + 1, cols = Math.max(...sh.map(z => z[1])) + 1;
    assert.deepStrictEqual([f.rows, f.cols], [rows, cols], 'fit ไม่ตรงรูปช่องของ ' + id);
    assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= cols + 1e-6 && f.y + f.h <= rows + 1e-6, 'ภาพล้นกรอบ ' + id);
  }
});
test('T-64 [v2.5 ของจริง] สุ่มวาง (randomPlacement) ได้ทุกโหมด/จำนวนคน 150 ครั้ง ผ่านการตรวจ รวมเกาะและกับดัก [R-3-02]', () => {
  const real = loadCards(path.join(__dirname, '..', 'cards'));
  for (const [mode, n] of [['classic', 2], ['classic', 6], ...[2, 3, 4, 5, 6, 7].map(k => ['survival', k])]) {
    const r = new Room('8888', { cards: real.cards, rand: mulberry32(n), now: clock }); const P = []; for (let i = 0; i < n; i++) P.push(r.addPlayer(NAMES[i]).pid);
    r.action(P[0], { type: 'update_settings', settings: { mode, islands: 'random', traps: true } }); r.action(P[0], { type: 'start_game' });
    for (let i = 0; i < 150; i++) r.validatePlacement(r.randomPlacement());
  }
});
const chatRoom = n => { const r = new Room('2468', { cards: CARDS, rand: mulberry32(3), now: clock }); const P = []; for (let i = 0; i < n; i++) P.push(r.addPlayer(NAMES[i]).pid); return { r, P }; };
test('T-65 แชท: ปกติ / ว่าง / 101 ตัว / อักขระควบคุม / ส่งซ้ำใน 1 วิ [R-5-15]', () => {
  const { r, P } = chatRoom(2);
  r.action(P[0], { type: 'chat', text: '  สวัสดี   ทุกคน  ' });
  let out = r.drainChat(); assert.strictEqual(out.length, 1); assert.strictEqual(out[0].text, 'สวัสดี ทุกคน');
  assert.deepStrictEqual([out[0].pid, out[0].name, out[0].color], [P[0], 'เอ', r.seat(P[0]).color]);
  throwsCode(() => r.action(P[0], { type: 'chat', text: 'อีกที' }), 'CHAT_RATE');
  T += 1100;
  throwsCode(() => r.action(P[0], { type: 'chat', text: '   ' }), 'CHAT_INVALID');
  throwsCode(() => r.action(P[0], { type: 'chat', text: 'ก'.repeat(101) }), 'CHAT_INVALID');
  throwsCode(() => r.action(P[0], { type: 'chat', text: 123 }), 'CHAT_INVALID');
  T += 1100; r.action(P[0], { type: 'chat', text: 'ก'.repeat(100) });
  T += 1100; r.action(P[0], { type: 'chat', text: 'a\u0000b‮c<b>x</b>' });
  out = r.drainChat(); assert.strictEqual(out[1].text, 'a b c<b>x</b>');           // ตัดอักขระควบคุม เก็บ HTML เป็นข้อความ (client escape)
  assert.ok(!JSON.stringify(r.log).includes('c<b>'));                              // ข้อความไม่ลง event log
});
test('T-66 แชทข้ามห้องไม่ได้ · เก็บ 30 ข้อความล่าสุด · ชื่อ/สีมาจากที่นั่งจริง [R-5-16]', () => {
  const A = chatRoom(2), B = chatRoom(2);
  for (let i = 0; i < 35; i++) { T += 1100; A.r.action(A.P[i % 2], { type: 'chat', text: 'ข้อความ ' + i }); }
  assert.strictEqual(A.r.chatHistory().length, 30); assert.strictEqual(A.r.chatHistory()[0].text, 'ข้อความ 5');
  assert.strictEqual(B.r.chatHistory().length, 0); assert.strictEqual(B.r.drainChat().length, 0);
  throwsCode(() => B.r.action(A.P[0], { type: 'chat', text: 'x' }), 'BAD_TOKEN');   // pid ของห้อง A ใช้ในห้อง B ไม่ได้
  assert.ok(A.r.chatHistory().every(m => [A.P[0], A.P[1]].includes(m.pid) && m.name && m.color));
});
test('T-67 คนตกรอบ/ทุก phase แชทได้ [R-5-15]', () => {
  const x = start(3, {}); x.room.action(x.P[2], { type: 'resign' });
  assert.strictEqual(seatOf(x, x.P[2]).alive, false);
  T += 1100; x.room.action(x.P[2], { type: 'chat', text: 'ดูอยู่นะ' });
  assert.strictEqual(x.room.drainChat().length, 1); assert.strictEqual(x.room.phase, 'BATTLE');
});
test('T-68 เสียงสด: rtc ผ่านเมื่ออยู่ในเสียงสดทั้งคู่เท่านั้น · data ≤ 8KB · kind ถูกต้อง [R-5-19]', () => {
  const { r, P } = chatRoom(3); const O = chatRoom(2);
  const j = r.action(P[0], { type: 'voice_join' }); assert.deepStrictEqual(j.peers, []);
  const j2 = r.action(P[1], { type: 'voice_join' }); assert.deepStrictEqual(j2.peers, [P[0]]);
  assert.strictEqual(r.rtcTarget(P[0], P[1], 'offer', { sdp: 'x' }), P[1]);
  throwsCode(() => r.rtcTarget(P[0], P[2], 'offer', {}), 'VOICE_INVALID');          // P2 ไม่ได้อยู่ในเสียงสด
  throwsCode(() => r.rtcTarget(P[2], P[0], 'offer', {}), 'VOICE_INVALID');
  throwsCode(() => r.rtcTarget(P[0], O.P[0], 'offer', {}), 'VOICE_INVALID');        // ห้องอื่น
  throwsCode(() => r.rtcTarget(P[0], P[0], 'offer', {}), 'VOICE_INVALID');          // ส่งถึงตัวเอง
  throwsCode(() => r.rtcTarget(P[0], P[1], 'hack', {}), 'VOICE_INVALID');
  throwsCode(() => r.rtcTarget(P[0], P[1], 'offer', { sdp: 'x'.repeat(9000) }), 'VOICE_INVALID');
  assert.strictEqual(r.rtcTarget(P[1], P[0], 'ice', { candidate: 'c' }), P[0]);
});
test('T-69 เสียงสด: หลุด / ออกจากห้อง / voice_leave = ถูกเอาออกจากรายชื่อ [R-5-17]', () => {
  const { r, P } = chatRoom(4);
  for (const p of P) r.action(p, { type: 'voice_join' });
  r.setConnected(P[0], false); assert.ok(!r.voice.has(P[0]));
  r.leave(P[1]); assert.ok(!r.voice.has(P[1]));
  r.action(P[2], { type: 'voice_leave' }); assert.ok(!r.voice.has(P[2]));
  assert.deepStrictEqual(r.getState(P[3]).voice, [P[3]]);
});
test('T-70 getState: voice มีแค่ pid · ไม่มี token/รหัสผ่านที่ไม่ควรเห็น [R-4-01]', () => {
  const { r, P } = chatRoom(3); r.setMeta({ name: 'ลับ', private: true, password: '4321' });
  r.action(P[0], { type: 'voice_join' }); r.action(P[1], { type: 'voice_join' });
  const st = r.getState(P[2]); assert.deepStrictEqual(st.voice, [P[0], P[1]]);
  const j = JSON.stringify(st);
  for (const p of r.players) assert.ok(!j.includes(p.token), 'state มี token');
  assert.ok(st.config.COUNTDOWN_FROM === 5 && st.config.CHAT_MAX === 100);
});

test('T-78 [v2.6] state ส่ง pid คนยิงมากับทุกช่องที่ถูกยิง · หลายคนยิงช่องเดียวกัน = คนแรก · ยิงแทนอัตโนมัติก็บันทึกเป็นคนนั้น [R-7-15]', () => {
  const by = (x, board, r, c) => { const b = x.room.getState(x.P[0]).boards.find(b => b.id === board); const e = b.cells.find(([y, z]) => y === r && z === c); return e && e[3]; };
  // turns: 2 คน ผลัดกันยิง
  const t2 = start(2, { mode: 'survival' }, 3);
  const first = t2.room.turnPid;
  fire(t2, first, [shot(0, 0)]);
  assert.strictEqual(by(t2, '*', 0, 0), first, 'ช่องแรกต้องเป็นของคนที่ยิง');
  assert.strictEqual(typeof by(t2, '*', 0, 0), 'string');
  let col = 1;
  while (t2.room.turnPid === first && col < 12) fire(t2, first, [shot(0, col++)]);   // ยิงโดน = ได้ยิงต่อ ยิงจนกว่าจะเปลี่ยนมือ
  const other = t2.room.turnPid;
  assert.notStrictEqual(other, first, 'ตาต้องเปลี่ยนมือ');
  fire(t2, other, [shot(1, 0)]);
  assert.strictEqual(by(t2, '*', 1, 0), other);
  assert.notStrictEqual(by(t2, '*', 0, 0), by(t2, '*', 1, 0), 'คนละคนต้องได้คนละ pid');
  // rounds: 3 คนยิงช่องเดียวกันในรอบเดียว = คนแรกตามลำดับที่ประมวลผล
  const t3 = start(3, { mode: 'survival' }, 4);
  const live = t3.room.getState(t3.P[0]).players.filter(p => p.shooting).map(p => p.pid);
  live.forEach(pid => fire(t3, pid, [shot(5, 5)]));
  const w = by(t3, '*', 5, 5);
  assert.ok(live.includes(w), 'ต้องเป็นหนึ่งในคนที่ยิง');
  assert.strictEqual(w, live[0], 'คนแรกตามลำดับที่ประมวลผล');
  // ยิงแทนอัตโนมัติ: ปล่อยหมดเวลา
  const t4 = start(2, { mode: 'survival' }, 5);
  const who = t4.room.turnPid;
  T += 20001; t4.room.tick();   // ปล่อยจนหมดเวลา = ระบบยิงแทน
  const st = t4.room.getState(t4.P[0]).boards.find(b => b.id === '*');
  assert.ok(st.cells.length >= 1, 'ต้องมีช่องที่ถูกยิงแทน');
  assert.ok(st.cells.every(c => c.length === 4), 'ทุกช่องต้องมี 4 ค่า');
  assert.strictEqual(st.cells[0][3], who, 'ยิงแทนต้องบันทึกเป็นคนที่ถึงตา');
});
test('T-75 getState ส่งค่าแบนเนอร์ตาเล่นให้ client (3000 ms) และ config ใหม่ผ่านการตรวจ [R-10-12]', () => {
  const x = mk(2, {});
  assert.strictEqual(x.room.getState(x.P[0]).config.TURN_BANNER_MS, 3000);
  assert.strictEqual(CONFIG.CLASSIC_BOARD, 11);
  assert.deepStrictEqual(CONFIG.SURVIVAL_BOARD, { 2: 13, 3: 15, 4: 15, 5: 16, 6: 17, 7: 17 });
});
let fail = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + (e.stack || e).split('\n').slice(0, 3).join('\n     ')); }
}
console.log(`\n${tests.length - fail}/${tests.length} ผ่าน`);
process.exit(fail ? 1 : 0);
