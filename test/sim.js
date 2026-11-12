'use strict';
// จำลองกติกาตาม test scenario ใน spec หัวข้อ 14 (T-xx) — รันด้วย npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Room, CONFIG, validateConfig, randomPlacement, validatePlacement } = require('../game');
const { loadCards } = require('../server/cards');

const CARDS = [
  { id: 'bong', name: 'บ้อง', size: 5, flavor: 'เสาหลักของวง' },
  { id: 'grinder', name: 'เครื่องบด', size: 4 },
  { id: 'pipe', name: 'ไปป์', size: 3 },
  { id: 'joint', name: 'โรล', size: 3 },
  { id: 'lighter', name: 'ไฟแช็ก', size: 2 },
];
// T-07: แถวละชิ้น ชิดกัน
const LAYOUT = [
  { pieceId: 'bong', row: 0, col: 0, dir: 'H' }, { pieceId: 'grinder', row: 1, col: 0, dir: 'H' },
  { pieceId: 'pipe', row: 2, col: 0, dir: 'H' }, { pieceId: 'joint', row: 3, col: 0, dir: 'H' },
  { pieceId: 'lighter', row: 4, col: 0, dir: 'H' },
];
const SHIP_CELLS = LAYOUT.flatMap(p => Array.from({ length: CARDS.find(c => c.id === p.pieceId).size }, (_, i) => [p.row, p.col + i]));

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

let T = 1_000_000;
const clock = () => T;
function mkRoom(seed = 1) {
  const room = new Room('TEST1', { cards: CARDS, rand: mulberry32(seed), now: clock });
  const A = room.addPlayer('เอ'); const B = room.addPlayer('บี');
  return { room, A: A.pid, B: B.pid, tokA: A.token, tokB: B.token };
}
function toBattle(seed) {
  const x = mkRoom(seed);
  x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT });
  x.room.action(x.B, { type: 'submit_placement', placement: LAYOUT });
  return x;
}
const fire = (x, pid, row, col, extra = {}) => x.room.action(pid, { type: 'fire', row, col, turnNo: x.room.turnNo, ...extra });
const throwsCode = (fn, code, reason) => {
  try { fn(); } catch (e) { assert.strictEqual(e.code, code, `ได้ ${e.code} แทน ${code}`); if (reason) assert.strictEqual(e.reason, reason); return; }
  assert.fail('ควร throw ' + code);
};
// ช่องว่างบนกระดานที่วางตาม LAYOUT (แถว 5–9)
const emptyCells = []; for (let r = 5; r < 10; r++) for (let c = 0; c < 10; c++) emptyCells.push([r, c]);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------- การ์ด (R-4.1-xx) ----------
function cardDir(csv, tpl = { base: { w: 600, h: 900 } }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-'));
  fs.writeFileSync(path.join(d, 'template.json'), JSON.stringify(tpl));
  if (csv != null) fs.writeFileSync(path.join(d, 'data.csv'), csv);
  return d;
}
const HEAD = 'id,name,size,flavor\n';
const BASE = 'bong,บ้อง,5,เสาหลัก\ngrinder,เครื่องบด,4,หมุน\npipe,ไปป์,3,คลาสสิก\njoint,โรล,3,ม้วน\nlighter,ไฟแช็ก,2,เล็กสุด\n';
const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

test('T-01 CSV ค่าเริ่มต้น 5 แถว รวม 17 ช่อง ไม่มี image [R-4.1-01,04,05]', () => {
  const real = loadCards(path.join(__dirname, '..', 'cards'), CONFIG);
  assert.ok(real.ready, real.problem);
  assert.strictEqual(real.cards.length, 5);
  assert.strictEqual(real.cards.reduce((a, c) => a + c.size, 0), 17);
  assert.ok(real.cards.every(c => !('image' in c)));
});
test('T-02 id ซ้ำ ข้ามแถวหลัง [R-4.1-03]', () => {
  const r = quiet(() => loadCards(cardDir(HEAD + BASE + 'pipe,ไปป์ซ้ำ,3,\n'), CONFIG));
  assert.ok(r.ready); assert.strictEqual(r.cards.length, 5);
  assert.strictEqual(r.cards.find(c => c.id === 'pipe').name, 'ไปป์');
  assert.strictEqual(r.skipped[0].line, 7);
});
test('T-03 size 6 และ id ตัวใหญ่ ถูกข้าม [R-4.1-03]', () => {
  const r = quiet(() => loadCards(cardDir(HEAD + BASE + 'big,ใหญ่,6,\nBong,บ้อง,5,\n'), CONFIG));
  assert.strictEqual(r.cards.length, 5); assert.strictEqual(r.skipped.length, 2);
});
test('T-04 ข้อความไทยมีจุลภาคในเครื่องหมายคำพูด + BOM [R-4.1-01]', () => {
  const r = loadCards(cardDir('﻿' + HEAD + 'bong,บ้อง,5,"เล็ก, แต่แรง"\n'), CONFIG);
  assert.strictEqual(r.cards[0].flavor, 'เล็ก, แต่แรง');
});
test('T-05 8 แถวเกินเพดาน = ไม่พร้อม [R-4.1-04]', () => {
  const rows = Array.from({ length: 8 }, (_, i) => `p${i},ชิ้น${i},2,`).join('\n');
  const r = quiet(() => loadCards(cardDir(HEAD + rows + '\n'), CONFIG));
  assert.strictEqual(r.ready, false);
});
test('T-06 ไม่มีคอลัมน์ size / ไม่มีไฟล์ = ไม่พร้อม [R-4.1-02]', () => {
  assert.strictEqual(quiet(() => loadCards(cardDir('id,name\nbong,บ้อง\n'), CONFIG)).ready, false);
  assert.strictEqual(quiet(() => loadCards(cardDir(null), CONFIG)).ready, false);
});

// ---------- วาง (R-7-01..06, R-8-01) ----------
test('T-07 วางชิดกันได้ ยืนยันแล้ว ready [R-7-01,04,05]', () => {
  const x = mkRoom();
  assert.strictEqual(x.room.phase, 'PLACING');
  x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT });
  assert.ok(x.room.seat(x.A).ready);
});
test('T-08 ซ้อนกัน = OVERLAP [R-7-04]', () => {
  const x = mkRoom();
  const bad = LAYOUT.map(p => p.pieceId === 'grinder' ? { ...p, row: 0, col: 2, dir: 'V' } : p);
  throwsCode(() => x.room.action(x.A, { type: 'submit_placement', placement: bad }), 'PLACEMENT_INVALID', 'OVERLAP');
});
test('T-09 bong H (0,6) ล้นขอบ = BOUNDS [R-7-02]', () => {
  const x = mkRoom();
  const bad = LAYOUT.map(p => p.pieceId === 'bong' ? { ...p, col: 6 } : p);
  throwsCode(() => x.room.action(x.A, { type: 'submit_placement', placement: bad }), 'PLACEMENT_INVALID', 'BOUNDS');
});
test('T-10 ขาดชิ้น / ซ้ำ / dir ผิด [R-7-01,03]', () => {
  const x = mkRoom();
  throwsCode(() => x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT.slice(0, 4) }), 'PLACEMENT_INVALID', 'PIECES');
  throwsCode(() => x.room.action(x.A, { type: 'submit_placement', placement: [...LAYOUT.slice(0, 4), { ...LAYOUT[2], row: 6 }] }), 'PLACEMENT_INVALID', 'PIECES');
  throwsCode(() => x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT.map((p, i) => i ? p : { ...p, dir: 'D' }) }), 'PLACEMENT_INVALID', 'DIR');
});
test('T-11 ส่งการวางซ้ำ = ALREADY_PLACED [R-7-05]', () => {
  const x = mkRoom();
  x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT });
  throwsCode(() => x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT.map(p => ({ ...p, row: p.row + 5 })) }), 'ALREADY_PLACED');
  assert.strictEqual(x.room.seat(x.A).placement[0].row, 0);
});
test('T-12 หมดเวลาวาง server สุ่มให้ autoStreak = 0 [R-8-01, R-3-02]', () => {
  const x = mkRoom(7);
  x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT });
  T += CONFIG.PLACE_TIME * 1000; x.room.tick();
  assert.strictEqual(x.room.phase, 'BATTLE');
  const b = x.room.seat(x.B);
  assert.ok(b.ready); assert.strictEqual(b.autoStreak, 0);
  validatePlacement(b.placement, CARDS.map(c => ({ id: c.id, size: c.size })));
});
test('R-7-06 suggest ไม่บันทึก และจำกัดความถี่', () => {
  const x = mkRoom();
  const r1 = x.room.action(x.A, { type: 'suggest_placement' });
  assert.ok(r1.placement && r1.placement.length === 5);
  assert.strictEqual(x.room.seat(x.A).ready, false);
  assert.strictEqual(x.room.action(x.A, { type: 'suggest_placement' }).placement, null);
  T += 1000; assert.ok(x.room.action(x.A, { type: 'suggest_placement' }).placement);
});

// ---------- ยิง (R-7-07..16, R-9-xx) ----------
test('T-13 ยิงนอกตา = NOT_YOUR_TURN [R-7-07]', () => {
  const x = toBattle(); const other = x.room.turnPid === x.A ? x.B : x.A; const n = x.room.turnNo;
  throwsCode(() => fire(x, other, 5, 5), 'NOT_YOUR_TURN'); assert.strictEqual(x.room.turnNo, n);
});
test('T-14 ยิงช่องเดิม = ALREADY_SHOT ยังเป็นตาเดิม [R-7-09]', () => {
  const x = toBattle(); const p = x.room.turnPid; const q = p === x.A ? x.B : x.A;
  fire(x, p, 5, 5); fire(x, q, 5, 5);
  const dl = x.room.deadline;
  throwsCode(() => fire(x, p, 5, 5), 'ALREADY_SHOT');
  assert.strictEqual(x.room.turnPid, p); assert.strictEqual(x.room.deadline, dl);
});
test('T-15 โดนแล้วไม่ได้ยิงต่อ [R-7-12,13]', () => {
  const x = toBattle(); const p = x.room.turnPid;
  fire(x, p, 0, 0);
  assert.strictEqual(x.room.lastShot.result, 'hit');
  assert.notStrictEqual(x.room.turnPid, p);
});
test('T-16 lighter ดับ ส่งแค่ id ไม่ส่งช่อง [R-7-12, R-4-03]', () => {
  const x = toBattle(); const p = x.room.turnPid; const q = p === x.A ? x.B : x.A;
  fire(x, p, 4, 0); fire(x, q, 9, 9); fire(x, p, 4, 1);
  assert.strictEqual(x.room.lastShot.sunkPieceId, 'lighter');
  const st = x.room.getState(p);
  assert.deepStrictEqual(st.players.find(z => z.pid === q).sunk, ['lighter']);
  assert.strictEqual(st.players.find(z => z.pid === q).placement, null);
});
test('T-17 getState ไม่รั่วตำแหน่งคู่แข่งจนจบเกม [R-4-01, R-4-02]', () => {
  const x = toBattle();
  for (const [me, op] of [[x.A, x.B], [x.B, x.A]]) {
    const st = x.room.getState(me);
    assert.strictEqual(st.players.find(z => z.pid === op).placement, null);
    assert.ok(st.players.find(z => z.pid === me).placement);
    const j = JSON.stringify(st);
    assert.ok(!j.includes(x.tokA) && !j.includes(x.tokB), 'token รั่ว');
    assert.ok(!/"cells"|pieceId"\s*:\s*"[a-z]+"\s*,\s*"result/.test(j));
  }
  const p = x.room.turnPid; fire(x, p, 0, 0);
  const hitEntry = x.room.getState(x.A === p ? x.B : x.A).players.find(z => z.pid === p).shotsTaken[0];
  assert.deepStrictEqual(Object.keys(hitEntry).sort(), ['col', 'result', 'row']);
});
test('T-18 ยิงช่องสุดท้าย = ชนะ all_sunk เปิด placement [R-9-01, R-4-04, R-9-03]', () => {
  const x = toBattle(); const p = x.room.turnPid; const q = p === x.A ? x.B : x.A;
  let e = 0;
  for (let i = 0; i < SHIP_CELLS.length; i++) {
    fire(x, p, ...SHIP_CELLS[i]);
    if (x.room.phase === 'GAME_OVER') break;
    fire(x, q, ...emptyCells[e++]);
  }
  assert.strictEqual(x.room.phase, 'GAME_OVER');
  assert.deepStrictEqual(x.room.result, { winnerPid: p, reason: 'all_sunk' });
  assert.ok(x.room.getState(q).players.find(z => z.pid === p).placement);
  assert.strictEqual(x.room.deadline, null);
  throwsCode(() => fire(x, q, 9, 9), 'BAD_PHASE');
});
function toTurnOf(x, who) { if (x.room.turnPid !== who) fire(x, x.room.turnPid, 9, 9); }
test('T-19 ถูกยิงแทน 3 ตาติด = แพ้ auto_limit [R-8-02, R-8-03]', () => {
  const x = toBattle(3); toTurnOf(x, x.B);
  let e = 0; const aMiss = emptyCells.filter(([r, c]) => !(r === 9 && c === 9));
  for (let i = 0; i < 3; i++) {
    const before = x.room.seat(x.B).shotsTaken.size;
    T += CONFIG.SHOT_TIME * 1000; x.room.tick();
    assert.strictEqual(x.room.seat(x.B).shotsTaken.size, before + 1);
    assert.ok(x.room.lastShot.auto);
    if (i < 2) fire(x, x.A, ...aMiss[e++]);
  }
  assert.strictEqual(x.room.phase, 'GAME_OVER');
  assert.deepStrictEqual(x.room.result, { winnerPid: x.A, reason: 'auto_limit' });
});
test('T-20 ยิงเองหลังถูกยิงแทน 2 ตา = รีเซ็ต [R-7-16]', () => {
  const x = toBattle(3); toTurnOf(x, x.B);
  for (let i = 0; i < 2; i++) { T += CONFIG.SHOT_TIME * 1000; x.room.tick(); fire(x, x.A, 8, i); }
  assert.strictEqual(x.room.seat(x.B).autoStreak, 2);
  const free = []; for (let c = 0; c < 10; c++) if (!x.room.seat(x.B).shotsTaken.has(70 + c)) free.push(c);
  fire(x, x.B, 7, free[0]);
  assert.strictEqual(x.room.seat(x.B).autoStreak, 0); assert.strictEqual(x.room.phase, 'BATTLE');
});
test('T-21 turnNo เก่าหลังถูกยิงแทน = STALE_TURN [R-7-10]', () => {
  const x = toBattle(); toTurnOf(x, x.B);
  const stale = x.room.turnNo;
  T += CONFIG.SHOT_TIME * 1000; x.room.tick();
  throwsCode(() => x.room.action(x.B, { type: 'fire', row: 9, col: 0, turnNo: stale }), 'STALE_TURN');
});
test('T-22 reqId ซ้ำ ประมวลครั้งเดียว [R-7-11]', () => {
  const x = toBattle(); const p = x.room.turnPid; const n = x.room.turnNo;
  x.room.action(p, { type: 'fire', row: 9, col: 9, turnNo: n, reqId: 'abc' });
  const r = x.room.action(p, { type: 'fire', row: 9, col: 8, turnNo: n, reqId: 'abc' });
  assert.ok(r.dup); assert.strictEqual(x.room.seat(p).shotsTaken.size, 1);
});
test('Edge: row เป็น string = BAD_REQUEST, 2.5 = OUT_OF_BOUNDS [R-7-08]', () => {
  const x = toBattle(); const p = x.room.turnPid;
  throwsCode(() => fire(x, p, '3', 3), 'BAD_REQUEST');
  throwsCode(() => fire(x, p, 2.5, 3), 'OUT_OF_BOUNDS');
  throwsCode(() => fire(x, p, 10, 0), 'OUT_OF_BOUNDS');
  throwsCode(() => x.room.action(p, null), 'BAD_REQUEST');
});

// ---------- หลุด / ออก (R-8-04..07) ----------
test('T-23 หลุด 40 วิ แล้วกลับเข้า ได้ที่นั่งเดิม [R-8-04, R-8-05]', () => {
  const x = toBattle();
  x.room.setConnected(x.A, false); T += 40_000; x.room.tick();
  assert.strictEqual(x.room.resume(x.tokA), x.A);
  assert.strictEqual(x.room.phase, 'BATTLE');
  assert.ok(x.room.getState(x.A).players.find(z => z.pid === x.A).placement);
});
test('T-24 หลุดเกิน 60 วิ = แพ้ disconnect token ใช้ไม่ได้ [R-8-04, R-8-05]', () => {
  const x = toBattle();
  x.room.setConnected(x.A, false); T += 20_000; x.room.tick(); T += 40_000; x.room.tick();
  assert.deepStrictEqual(x.room.result, { winnerPid: x.B, reason: 'disconnect' });
  throwsCode(() => x.room.resume(x.tokA), 'BAD_TOKEN');
});
test('T-25 หลุดทั้งคู่ = cancelled [R-8-07]', () => {
  const x = toBattle();
  x.room.setConnected(x.A, false); x.room.setConnected(x.B, false);
  T += 60_000; x.room.tick();
  assert.deepStrictEqual(x.room.result, { winnerPid: null, reason: 'cancelled' });
});
test('T-26 เล่นอีก: คนแพ้เริ่มก่อน [R-8-08, R-7-14]', () => {
  const x = toBattle(5); const p = x.room.turnPid; const q = p === x.A ? x.B : x.A;
  x.room.action(p, { type: 'resign' });
  x.room.action(p, { type: 'rematch', want: true });
  assert.strictEqual(x.room.phase, 'GAME_OVER');
  x.room.action(q, { type: 'rematch', want: true });
  assert.strictEqual(x.room.phase, 'PLACING'); assert.strictEqual(x.room.gameNo, 2);
  x.room.action(x.A, { type: 'submit_placement', placement: LAYOUT });
  x.room.action(x.B, { type: 'submit_placement', placement: LAYOUT });
  assert.strictEqual(x.room.turnPid, p, 'คนที่ยอมแพ้ต้องได้เริ่ม');
  assert.strictEqual(x.room.seat(x.A).shotsTaken.size, 0);
});
test('T-27 เกมแรกสุ่มคนเริ่ม 45–55% (crypto) [R-7-14]', () => {
  let first = 0;
  for (let i = 0; i < 1000; i++) {
    const room = new Room('R', { cards: CARDS, now: clock });
    const a = room.addPlayer('ก').pid; room.addPlayer('ข');
    room.action(a, { type: 'submit_placement', placement: LAYOUT });
    room.action(room.players[1].pid, { type: 'submit_placement', placement: LAYOUT });
    if (room.turnPid === a) first++;
  }
  assert.ok(first >= 450 && first <= 550, `ได้ ${first}`);
});
test('T-28 ยอมแพ้ตอนวาง = อีกฝ่ายชนะ [R-7-15]', () => {
  const x = mkRoom(); x.room.action(x.A, { type: 'resign' });
  assert.deepStrictEqual(x.room.result, { winnerPid: x.B, reason: 'resign' });
});
test('T-29 คนที่ 3 = ROOM_FULL [R-5-04]', () => {
  const x = mkRoom(); throwsCode(() => x.room.addPlayer('ซี'), 'ROOM_FULL');
});
test('T-30 ชื่อว่าง / ชื่อซ้ำ / ยาวเกิน [R-5-02]', () => {
  const room = new Room('R', { cards: CARDS, now: clock });
  throwsCode(() => room.addPlayer('   '), 'NAME_INVALID');
  throwsCode(() => room.addPlayer('ก'.repeat(17)), 'NAME_INVALID');
  room.addPlayer('บี'); room.addPlayer(' บี ');
  assert.strictEqual(room.players[1].name, 'บี (2)');
});
test('T-31 ห้องไม่มีคนเชื่อมต่อ 600 วิ = หมดอายุ [R-8-09]', () => {
  const x = mkRoom(); x.room.setConnected(x.A, false); x.room.setConnected(x.B, false);
  T += 599_000; assert.strictEqual(x.room.expired(), false);
  T += 1_000; assert.strictEqual(x.room.expired(), true);
});
test('T-32 config ผิด = มีรายการปัญหา [R-3-01]', () => {
  assert.deepStrictEqual(validateConfig(CONFIG), []);
  assert.ok(validateConfig({ ...CONFIG, SHOT_TIME: 0 }).length);
  assert.ok(validateConfig({ ...CONFIG, AUTO_SHOT_LIMIT: 0 }).length);
});
test('T-33 สุ่มเล่น 1,000 เกม จบภายใน 199 ตา [R-9-02]', () => {
  const rand = mulberry32(99);
  for (let g = 0; g < 1000; g++) {
    const room = new Room('R', { cards: CARDS, rand, now: clock });
    const a = room.addPlayer('ก').pid, b = room.addPlayer('ข').pid;
    for (const p of [a, b]) room.action(p, { type: 'submit_placement', placement: randomPlacement(room.fleet, rand) });
    let guard = 0;
    while (room.phase === 'BATTLE' && guard++ < 300) {
      const s = room.seat(room.turnPid); const free = [];
      for (let k = 0; k < 100; k++) if (!s.shotsTaken.has(k)) free.push(k);
      const kk = free[Math.floor(rand() * free.length)];
      room.action(room.turnPid, { type: 'fire', row: Math.floor(kk / 10), col: kk % 10, turnNo: room.turnNo });
    }
    assert.strictEqual(room.phase, 'GAME_OVER'); assert.ok(room.turnNo <= 199, `turns ${room.turnNo}`);
  }
});
test('R-3-02 สุ่มวางผ่านกติกาเสมอ แม้ของในวงเต็มเพดาน 7 ชิ้น 30 ช่อง', () => {
  const big = [5, 5, 5, 5, 4, 4, 2].map((s, i) => ({ id: 'p' + i, size: s }));
  const rand = mulberry32(4);
  for (let i = 0; i < 300; i++) validatePlacement(randomPlacement(big, rand), big);
});
test('ออกจากห้องกลางเกม = ยอมแพ้ + ลบที่นั่ง แล้วกลับล็อบบี้ได้ [R-8-06]', () => {
  const x = toBattle(); x.room.leave(x.A);
  assert.deepStrictEqual(x.room.result, { winnerPid: x.B, reason: 'resign' });
  throwsCode(() => x.room.action(x.B, { type: 'rematch', want: true }), 'NO_OPPONENT');
  x.room.action(x.B, { type: 'back_to_lobby' });
  assert.strictEqual(x.room.phase, 'LOBBY');
  x.room.addPlayer('ซี'); assert.strictEqual(x.room.phase, 'PLACING');
});

// ---------- รัน ----------
let pass = 0;
for (const [name, fn] of tests) {
  try { fn(); pass++; console.log('ok   ' + name); }
  catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); }
}
console.log(`\n${pass}/${tests.length} ผ่าน`);
process.exit(pass === tests.length ? 0 : 1);
