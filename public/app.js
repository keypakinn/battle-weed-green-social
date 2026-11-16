/* Battle Weed: Green Social v2.4 — หน้าเว็บ (render ทั้งหน้าจาก state เดียว) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* โหมดส่วนตัว */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
  };
  const ss = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* */ } },
  };
  const qs = new URLSearchParams(location.search);
  const ROWL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const S = {
    ageOk: store.get('bw_age_ok') === true,                       // R-5-03
    session: ss.get('bw_session') || store.get('bw_session'),
    cat: new Map(), fit: {}, ver: '0',
    fitKey: '', fitCs: 0, fitLock: false,                         // v2.5.1 ขนาดช่องที่คำนวณไว้แล้วของสภาพจอปัจจุบัน
    st: null, offset: 0, recvAt: 0,
    name: store.get('bw_name') || '',
    // v2.3 ห้องรอ: ลิงก์เชิญ ?room=1234&pw=0420 (R-5-14)
    invite: { code: (qs.get('room') || '').replace(/\D/g, '').slice(0, 4), pw: (qs.get('pw') || '').replace(/\D/g, '').slice(0, 4), room: null, looked: false },
    rooms: [], listOn: false, createOpen: false, newRoom: { name: '', priv: false, pw: '' },
    // วาง
    draft: {}, sel: null, pick: null, drag: null, placingGame: 0, islMode: false, isl: new Set(),
    // ยิง
    aim: [], dbl: 'H', tab: null, zoom: 1, sumOpen: false,
    // แอนิเมชัน
    anim: new Map(), reveal: new Map(), lastResolveKey: null, seen: false,
    chat: { open: false, log: [], unread: 0, hidden: new Set(), lastNote: 0 }, sheet: null, // v2.4 แชท / เสียงสด
    modal: null, replaced: false, lost: null, installEvt: null, notes: [], turnKey: null, restoreAim: true,
  };
  let reqSeq = 0;
  const reqId = () => `r${Date.now().toString(36)}${(reqSeq++).toString(36)}`;

  // ---------- ข้อมูลชิ้น (R-4.1-04) ----------
  function parseShape(str) {
    const rows = String(str || '').split('/'); const out = [];
    rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === 'X') out.push([r, c]); }));
    return out;
  }
  function rotateCells(cells, rot) { // R-4.1-05
    let cur = cells.map(x => [...x]);
    for (let i = 0; i < rot; i++) { const H = Math.max(...cur.map(x => x[0])) + 1; cur = cur.map(([r, c]) => [c, H - 1 - r]); }
    const mr = Math.min(...cur.map(x => x[0])), mc = Math.min(...cur.map(x => x[1]));
    return cur.map(([r, c]) => [r - mr, c - mc]);
  }
  const piece = id => S.cat.get(id) || { id, name: id, cells: [[0, 0]] };
  fetch('/api/cards').then(r => r.json()).then(d => {
    S.ver = d.version; S.fit = d.fit || {};
    for (const c of d.cards) S.cat.set(c.id, { ...c, cells: parseShape(c.shape) });
    render();
  }).catch(() => toast('โหลดข้อมูลชิ้นไม่ได้'));
  const artURL = id => `/cards/art/${(S.fit[id] && S.fit[id].art) || id}.webp?v=${S.ver}`; // R-4.1-07 fit.art = ไฟล์ภาพที่ใช้แทน id
  const absCells = p => rotateCells(piece(p.pieceId).cells, p.rot).map(([r, c]) => [r + p.row, c + p.col]);

  // ---------- socket ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  const net = $('#net');
  socket.on('connect', () => { net.hidden = true; S.restoreAim = true; S.listOn = false; if (S.session && !S.replaced) resume(); else render(); });
  socket.on('rooms', list => { S.rooms = list || []; if (!S.session) render(); });   // R-5-12
  socket.on('disconnect', reason => { if (reason !== 'io server disconnect') net.hidden = false; });
  socket.on('replaced', () => { S.replaced = true; render(); });
  socket.on('state', st => {
    const prev = S.st;
    S.st = st; S.recvAt = Date.now(); S.offset = st.serverNow - Date.now();
    if (st.phase === 'PLACING' && S.placingGame !== st.gameNo) resetDraft(st.gameNo);
    if (st.phase !== 'BATTLE' || !prev || prev.turnNo !== st.turnNo) S.aim = [];
    if (S.restoreAim && st.phase === 'BATTLE' && st.me && st.me.aim) S.aim = st.me.aim.map(a => ({ board: a.board || '*', row: a.row, col: a.col })); // R-8-12 กลับเข้าแล้วช่องที่เลือกยังอยู่
    S.restoreAim = false;
    if (st.phase === 'BATTLE' && !S.tab) S.tab = null;
    onResolve(st, prev);
    turnAlert(st, prev);
    stateSounds(st, prev);
    try { VOICE.setSelf(st.you); VOICE.sync(st); } catch (e) { /* */ }
    S.seen = true;
    render();
    refreshSheet();
  });
  socket.on('chat', m => addChat(m, true));
  socket.on('chat_log', list => { S.chat.log = []; S.chat.unread = 0; for (const m of list || []) addChat(m, false); refreshSheet(); });
  socket.on('notice', list => { for (const n of list) {
    if (/^big_/.test(n.kind)) bigAlert(n.text); else note(n.text, n.kind);
    if (n.kind === 'big_again' || n.kind === 'big_two') SFX.play('power');   // R-10-09 ได้ยิงเพิ่ม
    if (n.kind === 'elim' && S.st && n.pid === S.st.you) SFX.play('elim');
  } });
  function resume() {
    socket.emit('resume', { code: S.session.code, token: S.session.token }, r => {
      if (!r || !r.ok) { S.lost = r && r.error ? r.error : 'การเชื่อมต่อหาย กรุณาสร้างห้องใหม่'; dropSession(); }
    });
  }
  function dropSession() { S.session = null; S.st = null; try { VOICE.reset(); } catch (e) { /* */ } S.sheet = null; S.chat.log = []; S.chat.unread = 0; try { SFX.bgm(null); } catch (e) { /* */ } renderSheet(); ss.del('bw_session'); store.del('bw_session'); render(); }
  function emit(ev, payload) {
    return new Promise(res => socket.emit(ev, payload, r => {
      if (!r || !r.ok) {
        const quiet = ['STALE_TURN', 'BAD_PHASE', 'ALREADY_PLACED', 'OUT_OF_BOUNDS', 'BAD_REQUEST', 'NOT_HOST', 'SHOT_COUNT', 'ALREADY_SUBMITTED'];
        if (payload && payload.type === 'aim') quiet.push('NOT_YOUR_TURN', 'DOUBLE_INVALID', 'ALREADY_SHOT', 'BAD_TARGET');
        if (ev === 'find_room' || ev === 'list_rooms') quiet.push('ROOM_NOT_FOUND');
        if (r && !quiet.includes(r.code)) toast(r.error || 'ทำไม่สำเร็จ');
        if (r && (r.code === 'ROOM_NOT_FOUND' || r.code === 'BAD_TOKEN') && ev !== 'find_room' && ev !== 'join') dropSession();
      }
      res(r || { ok: false });
    }));
  }
  const act = (type, extra) => emit('action', { type, reqId: reqId(), ...(extra || {}) });

  // ---------- ตัวช่วย ----------
  const me = () => S.st && S.st.players.find(p => p.pid === S.st.you);
  const pl = pid => S.st && S.st.players.find(p => p.pid === pid);
  const isHost = () => S.st && S.st.hostPid === S.st.you;
  const nowServer = () => Date.now() + S.offset;
  const secsLeft = () => S.st && S.st.deadline ? Math.max(0, Math.ceil((S.st.deadline - nowServer()) / 1000)) : null;
  const B = () => S.st.boardSize;
  const kk = (r, c) => r * 100 + c;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
  function note(text, kind) { // R-10-05 แจ้งเตือนต่อคิว
    const box = $('#notes'); if (!box || !text) return;
    const d = document.createElement('div'); d.className = 'note ' + (kind || ''); d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.classList.add('out'), 3200); setTimeout(() => d.remove(), 3700);
  }
  // R-10-07 ข้อความตัวใหญ่กลางจอ (ตาคุณ / ยิงต่อ / 2 นัด) ข้อความที่มาติดกันรวมเป็นหลายบรรทัด
  function bigAlert(text) {
    const el = $('#bigalert'); if (!el || !text) return;
    const t = Date.now();
    if (el.classList.contains('show') && t - bigAlert.at < 500) el.insertAdjacentHTML('beforeend', `<div>${esc(text)}</div>`);
    else { el.innerHTML = `<div>${esc(text)}</div>`; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); bigAlert.at = t; }
    clearTimeout(bigAlert.tm); bigAlert.tm = setTimeout(() => el.classList.remove('show'), 1700);
  }
  // [ใหม่ v2.5] R-10-12 แบนเนอร์ใหญ่เมื่อถึงตา: แสดง TURN_BANNER_MS แล้วหายเอง · แตะที่ไหนก็ได้ = หายทันที (การแตะยังทำงานตามปกติ ไม่ถูกกลืน)
  function hideTurnBanner() { const el = $('#turnbanner'); if (!el) return; clearTimeout(turnBanner.tm); el.hidden = true; el.classList.remove('show'); }
  function turnBanner([title, sub], ms) {
    const el = $('#turnbanner'); if (!el) return;
    el.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    el.hidden = false; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(turnBanner.tm); turnBanner.tm = setTimeout(hideTurnBanner, ms);
  }
  document.addEventListener('pointerdown', () => { const el = $('#turnbanner'); if (el && !el.hidden) hideTurnBanner(); }, { capture: true, passive: true });
  function turnAlert(st, prev) {
    const m = st.players.find(p => p.pid === st.you);
    const mine = st.phase === 'BATTLE' && m && m.alive && (st.turnStyle === 'turns' ? st.turnPid === m.pid : m.shooting && !m.submitted);
    const key = mine ? `${st.gameNo}:${st.turnStyle === 'turns' ? 'T' : st.roundNo}` : null;
    const cont = st.turnStyle === 'turns' && prev && prev.phase === 'BATTLE' && prev.turnPid === st.you; // ยิงต่อ ใช้ข้อความ "โดน! ยิงต่อได้อีกนัด" แทน
    if (key && key !== S.turnKey && !cont && S.seen) { turnBanner(st.turnStyle === 'turns' ? ['ตาคุณ!', 'เลือกช่องแล้วกดยิง'] : ['ถึงเวลายิง!', 'เลือกเป้าแล้วกดส่ง'], (st.config && st.config.TURN_BANNER_MS) || 3000); SFX.play('turn'); }
    if (!mine) hideTurnBanner();
    if (st.turnStyle === 'turns') S.turnKey = mine ? key : null; else if (key) S.turnKey = key;
  }
  const STATE_SVG = {
    miss: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.4" fill="#D5DED8" opacity=".85"/></svg>',
    hit: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 5.4 5.6-2-2.4 5.3L23 12l-5.6 1.4 2.4 5.3-5.6-2L12 22l-2.2-5.3-5.6 2 2.4-5.3L1 12l5.6-1.3-2.4-5.3 5.6 2z" fill="#1A0E08" stroke="#F07A2A" stroke-width="1.6"/></svg>',
    island: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21c0-5 .5-8 2-11" stroke="#7A5230" stroke-width="2" fill="none"/><path d="M14 10c-2-3-6-3-8-1 3-1 5 0 8 1zm0 0c1-3 5-5 8-3-3 0-5 1-8 3zm0 0c3-1 6 1 7 4-2-2-4-3-7-4z" fill="#2E9E4F"/><ellipse cx="12" cy="21.5" rx="7" ry="1.6" fill="#E9D79B"/></svg>',
    trap: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18M5 19l2-9 3 5 2-8 2 8 3-5 2 9" fill="none" stroke="#C77DFF" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="5" r="2" fill="#C77DFF"/></svg>',
  };
  STATE_SVG.island_hit = STATE_SVG.hit;
  const TARGET = '<img class="tgt" src="/icons/target.svg" alt="">';
  const LABEL = { miss: 'พลาด', hit: 'โดน', island: 'โดนเกาะ', island_hit: 'โดนเกาะและชิ้น', trap: 'กับดัก' };

  // ---------- แอนิเมชันยิง (R-8-05, หัวข้อ 10) ----------
  function onResolve(st, prev) {
    const key = st.phase === 'BATTLE' || st.phase === 'GAME_OVER' ? `${st.gameNo}:${st.turnNo}:${JSON.stringify(st.lastResolve).length}` : null;
    if (!key || key === S.lastResolveKey) { S.lastResolveKey = key; return; }
    S.lastResolveKey = key;
    if (!S.seen || !prev) return; // เพิ่งเปิดหน้า ไม่เล่นย้อนหลัง
    const C = st.config; const t0 = Date.now();
    for (const sh of st.lastResolve || []) for (const [r, c] of sh.cells) {
      S.anim.set(`${sh.board}|${kk(r, c)}`, { start: t0, mid: t0 + C.ANIM_BULLET_MS, end: t0 + C.ANIM_BULLET_MS + C.ANIM_EFFECT_MS });
    }
    for (const s of st.lastSunk || []) S.reveal.set(`${s.ownerPid}:${s.pieceId}`, t0 + C.ANIM_BULLET_MS + C.SUNK_REVEAL_MS);
    requestAnimationFrame(flyBullets);
    const kinds = new Set(); for (const sh of st.lastResolve || []) for (const c of sh.cells) kinds.add(c[2]);
    const sig = st.gameNo + '|' + JSON.stringify(st.lastResolve || []);
    if (kinds.size && sig !== S.lastShotSig) {                      // มีนัดยิงใหม่จริง (ไม่เล่นซ้ำเมื่อ state เปลี่ยนแต่ผลยิงเดิม)
    S.lastShotSig = sig;
    SFX.play('launch');                                              // R-10-09 กระสุนลอย แล้วเสียงผลตอนกระสุนตก
    const sunkNow = (st.lastSunk || []).length > 0;
    setTimeout(() => {
      if (sunkNow) SFX.play('sunk');
      else if (kinds.has('hit') || kinds.has('island_hit')) SFX.play('hit');
      if (kinds.has('trap')) SFX.play('trap');
      if (kinds.has('island') || kinds.has('island_hit')) SFX.play('island');
      if (kinds.has('miss') && !kinds.has('hit') && !kinds.has('island_hit') && !sunkNow) SFX.play('miss');
    }, C.ANIM_BULLET_MS);
    }
    const total = C.ANIM_BULLET_MS + Math.max(C.ANIM_EFFECT_MS, C.SUNK_REVEAL_MS) + 50;
    setTimeout(render, C.ANIM_BULLET_MS + 20); setTimeout(() => { cleanupAnim(); render(); }, total);
  }
  function cleanupAnim() { const t = Date.now(); for (const [k, v] of S.anim) if (v.end <= t) S.anim.delete(k); for (const [k, v] of S.reveal) if (v <= t) S.reveal.delete(k); }
  function flyBullets() {
    const t = Date.now();
    for (const [key, a] of S.anim) {
      if (a.flown || a.mid <= t) continue; a.flown = true;
      const [board, k] = key.split('|');
      const cell = document.querySelector(`.board[data-board="${CSS.escape(board)}"] .cell[data-k="${k}"]`);
      if (!cell) continue;
      const rc = cell.getBoundingClientRect();
      const b = document.createElement('div'); b.className = 'bullet'; document.body.appendChild(b);
      const x0 = innerWidth / 2, y0 = innerHeight + 10, x1 = rc.left + rc.width / 2, y1 = rc.top + rc.height / 2;
      const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - Math.max(80, innerHeight * 0.25);
      const dur = Math.max(200, a.mid - t);
      const kf = []; for (let i = 0; i <= 12; i++) { const u = i / 12; const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1; const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * my + u * u * y1; kf.push({ transform: `translate(${x - 6}px,${y - 6}px) scale(${1 - u * 0.4})` }); }
      const an = b.animate ? b.animate(kf, { duration: dur, easing: 'ease-in' }) : null;
      if (an) an.onfinish = () => b.remove(); else setTimeout(() => b.remove(), dur);
    }
  }

  // ---------- วาง (v2.2 R-7-08: แตะช่องว่าง = วาง · แตะชิ้น = เลือก แล้วย้าย/หมุน/เอาออก · กดค้างแล้วลาก) ----------
  function resetDraft(gameNo) {
    S.placingGame = gameNo; S.draft = {}; S.islMode = false; S.isl = new Set(); S.drag = null;
    S.sel = null; S.pick = S.st.fleet[0] || null; S.aim = []; S.tab = null; S.anim.clear(); S.reveal.clear();
  }
  function draftCells(except) {
    const m = new Map();
    for (const [id, v] of Object.entries(S.draft)) if (id !== except) for (const [r, c] of absCells({ pieceId: id, ...v })) m.set(kk(r, c), id);
    return m;
  }
  // คืน null ถ้าวางได้ หรือ {why, with}
  function fits(id, row, col, rot) {
    const taken = draftCells(id);
    for (const [r, c] of absCells({ pieceId: id, row, col, rot })) if (r < 0 || c < 0 || r >= B() || c >= B()) return { why: 'BOUNDS' };
    for (const [r, c] of absCells({ pieceId: id, row, col, rot })) if (taken.has(kk(r, c))) return { why: 'OVERLAP', with: taken.get(kk(r, c)) };
    return null;
  }
  // [ใหม่ v2.5.1] R-7-11 แตะ/ลากจนชิ้นจะล้นกระดาน = ขยับชิ้นเข้ามาชิดขอบกระดานแทน (ไม่ขึ้น "วางนอกกระดานไม่ได้")
  function clampPos(id, row, col, rot) {
    const cells = rotateCells(piece(id).cells, rot);
    const h = Math.max(...cells.map(x => x[0])) + 1, w = Math.max(...cells.map(x => x[1])) + 1;
    return { row: Math.max(0, Math.min(row, B() - h)), col: Math.max(0, Math.min(col, B() - w)) };
  }
  const whyText = f => f.why === 'BOUNDS' ? 'ไม่สามารถวางออกนอกกระดานได้' : `ไม่สามารถวางทับ${piece(f.with).name}ได้`;
  const nextUnplaced = () => S.st.fleet.find(id => !S.draft[id]) || null;
  function placeAt(r, c) {
    if (S.islMode) { // R-7-05 วาดเกาะ
      const k = kk(r, c);
      if (S.isl.has(k)) S.isl.delete(k);
      else if (S.isl.size < S.st.config.ISLAND_CELLS) S.isl.add(k);
      else toast(`เกาะครบ ${S.st.config.ISLAND_CELLS} ช่องแล้ว แตะช่องเกาะเพื่อลบ`);
      return render();
    }
    const here = draftCells().get(kk(r, c));
    if (here) { S.sel = S.sel === here ? null : here; return render(); }       // แตะชิ้น = เลือก / แตะซ้ำ = เลิกเลือก
    if (S.sel) {                                                               // ย้ายชิ้นที่เลือกไปช่องที่แตะ
      const v = S.draft[S.sel]; ({ row: r, col: c } = clampPos(S.sel, r, c, v.rot)); const bad = fits(S.sel, r, c, v.rot);
      if (bad) { SFX.play('invalid'); return toast(whyText(bad)); }
      S.draft[S.sel] = { ...v, row: r, col: c }; SFX.play('place'); return render();
    }
    const id = S.pick && !S.draft[S.pick] ? S.pick : nextUnplaced();
    if (!id) return toast('วางครบแล้ว แตะชิ้นบนกระดานเพื่อย้าย หมุน หรือเอาออก');
    ({ row: r, col: c } = clampPos(id, r, c, 0));
    const bad = fits(id, r, c, 0);
    if (bad) { SFX.play('invalid'); return toast(whyText(bad)); }
    S.draft[id] = { row: r, col: c, rot: 0 }; SFX.play('place');
    S.pick = nextUnplaced();
    render();
  }
  function rotateSel() {
    const id = S.sel; if (!id) return;
    const v = S.draft[id]; const rot = (v.rot + 1) % 4;
    const cells = rotateCells(piece(id).cells, rot);
    const h = Math.max(...cells.map(x => x[0])) + 1, w = Math.max(...cells.map(x => x[1])) + 1;
    const row = Math.max(0, Math.min(v.row, B() - h)), col = Math.max(0, Math.min(v.col, B() - w)); // หมุนแล้วล้น = ขยับเข้ามาในกระดาน
    const bad = fits(id, row, col, rot);
    if (bad) { SFX.play('invalid'); return toast(whyText(bad)); }
    S.draft[id] = { row, col, rot }; SFX.play('rotate'); render();
  }
  function removeSel() { if (!S.sel) return; delete S.draft[S.sel]; S.pick = S.sel; S.sel = null; render(); }

  // กดค้างที่ชิ้นแล้วลาก (ไม่ render ระหว่างลาก ขยับแค่เงา)
  const LONG_MS = 220;
  function dragStart(x, y, target) {
    if (!S.st || S.st.phase !== 'PLACING' || S.islMode) return;
    const cell = target && target.closest && target.closest('.board.placing .cell[data-r]'); if (!cell) return;
    const r = +cell.dataset.r, c = +cell.dataset.c; const id = draftCells().get(kk(r, c)); if (!id) return;
    const v = S.draft[id];
    S.drag = { id, dr: r - v.row, dc: c - v.col, x0: x, y0: y, active: false, pos: null, bad: null };
    S.drag.timer = setTimeout(() => dragActivate(), LONG_MS);
  }
  function dragActivate() {
    const d = S.drag; if (!d) return;
    const board = document.querySelector('.board.placing'); if (!board) { S.drag = null; return; }
    d.active = true; S.sel = d.id; d.cs = parseFloat(board.style.getPropertyValue('--cs'));
    const layer = board.querySelector('.layer');
    const orig = layer.querySelector(`.pimg[data-pid="${CSS.escape(d.id)}"]`); if (orig) orig.classList.add('dragging');
    layer.querySelectorAll(`.oline[data-pid="${CSS.escape(d.id)}"]`).forEach(e => { e.style.display = 'none'; });
    d.ghost = document.createElement('div'); d.ghost.className = 'dghost'; layer.appendChild(d.ghost);
    const v = S.draft[d.id]; dragDraw(v.row, v.col);
    if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* */ }
  }
  function dragDraw(row, col) {
    const d = S.drag; const v = S.draft[d.id];
    d.pos = { row, col }; d.bad = fits(d.id, row, col, v.rot);
    const p = { pieceId: d.id, row, col, rot: v.rot, cls: 'ghostimg' };
    d.ghost.innerHTML = pieceImg(p, d.cs) + outlineHTML({ cells: absCells(p), color: d.bad ? '#FF4B3A' : '#F2C230', w: 3 }, d.cs);
    d.ghost.classList.toggle('bad', !!d.bad);
  }
  function dragMove(x, y) {
    const d = S.drag; if (!d) return false;
    if (!d.active) { if (Math.hypot(x - d.x0, y - d.y0) > 8) { clearTimeout(d.timer); S.drag = null; } return false; }
    const el = document.elementFromPoint(x, y); const cell = el && el.closest && el.closest('.board.placing .cell[data-r]');
    if (cell) { const { row, col } = clampPos(d.id, +cell.dataset.r - d.dr, +cell.dataset.c - d.dc, S.draft[d.id].rot); if (!d.pos || d.pos.row !== row || d.pos.col !== col) dragDraw(row, col); }
    return true;
  }
  function dragEnd() {
    const d = S.drag; if (!d) return;
    clearTimeout(d.timer); S.drag = null;
    if (!d.active) return;
    S.dragEndAt = Date.now();
    if (d.pos && !d.bad) { S.draft[d.id] = { ...S.draft[d.id], row: d.pos.row, col: d.pos.col }; SFX.play('place'); }
    else if (d.bad) { SFX.play('invalid'); toast(whyText(d.bad)); }                                    // ปล่อยตรงที่วางไม่ได้ = กลับที่เดิม
    render();
  }
  document.addEventListener('touchstart', e => { if (e.touches.length === 1) dragStart(e.touches[0].clientX, e.touches[0].clientY, e.target); else if (S.drag) { clearTimeout(S.drag.timer); S.drag = null; render(); } }, { passive: true });
  document.addEventListener('touchend', () => dragEnd(), { passive: true });
  document.addEventListener('touchcancel', () => dragEnd(), { passive: true });
  document.addEventListener('mousedown', e => { if (e.button === 0) dragStart(e.clientX, e.clientY, e.target); });
  document.addEventListener('mousemove', e => { if (S.drag) dragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', () => dragEnd());
  document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.board.placing')) e.preventDefault(); });
  function islGroupsOk() {
    if (S.isl.size !== S.st.config.ISLAND_CELLS) return false;
    const seen = new Set();
    for (const k of S.isl) {
      if (seen.has(k)) continue;
      let n = 0; const q = [k]; seen.add(k);
      while (q.length) { const x = q.pop(); n++; for (const d of [1, -1, 100, -100]) { const y = x + d; if (S.isl.has(y) && !seen.has(y) && (Math.abs(d) === 100 || Math.floor(y / 100) === Math.floor(x / 100))) { seen.add(y); q.push(y); } } }
      if (n < S.st.config.ISLAND_MIN_GROUP) return false;
    }
    return true;
  }

  // ---------- กระดาน ----------
  function cellSize(nCols) {
    if (S.fitCs && S.fitKey === fitKey()) return S.fitCs;      // [v2.5.1] วาดด้วยขนาดที่จำไว้ตั้งแต่เฟรมแรก ไม่ใหญ่แล้วหดให้เห็น
    const w = Math.min(document.documentElement.clientWidth, 560) - 24 - 16;
    return Math.max(14, Math.floor(w / nCols)) * S.zoom;
  }
  // layers: { board, cells: Map(k->state), clickable(r,c,state)->bool, marks: Map(k->cls), pieces:[{pieceId,row,col,rot,cls}], outlines:[{cells,color,pieceId,owner}], islands:Set(k), traps:Set(k) }
  function boardHTML(o) {
    const n = B(); const cs = cellSize(n + 1);
    let h = `<div class="bwrap" data-zoomable="1"><div class="board${o.placing ? ' placing' : ''}" data-board="${esc(o.board)}" data-cs="${cs}" style="--n:${n};--cs:${cs}px">`;
    h += `<div class="lab corner"></div>`;
    for (let c = 0; c < n; c++) h += `<div class="lab top">${c + 1}</div>`;
    const t = Date.now();
    for (let r = 0; r < n; r++) {
      h += `<div class="lab side">${ROWL[r]}</div>`;
      for (let c = 0; c < n; c++) {
        const k = kk(r, c);
        let st = o.cells && o.cells.get(k);
        const a = S.anim.get(`${o.board}|${k}`);
        const cls = ['cell'];
        let inner = '';
        if (a && t < a.mid) { cls.push('aimed'); inner = TARGET; st = null; }
        else if (a && t < a.end) cls.push('burn');
        if (st && o.sunkCells && o.sunkCells.has(k) && (st === 'hit' || st === 'island_hit')) cls.push('s-sunk', st === 'island_hit' ? 's-island' : 'x');
        else if (st) { cls.push('s-' + st); inner = STATE_SVG[st] || ''; }
        else if (!inner) cls.push(o.ownCells && o.ownCells.has(k) ? 'own' : 's-unshot'); // v2.2 ช่องใต้ชิ้นของเราไม่มีลายใบ (เห็นเฉพาะเจ้าของ)
        if (o.islands && o.islands.has(k) && !st) cls.push('myisl');
        if (o.traps && o.traps.has(k) && !st) { cls.push('s-trap', 'reveal'); inner = STATE_SVG.trap; }
        if (o.marks && o.marks.get(k)) cls.push(o.marks.get(k));
        const can = o.clickable && o.clickable(r, c, st);
        const label = `${ROWL[r]}${c + 1} ${st ? LABEL[st] : ''}`;
        const style = `grid-row:${r + 2};grid-column:${c + 2}`;
        h += can ? `<button class="${cls.join(' ')}" style="${style}" data-act="${can}" data-r="${r}" data-c="${c}" data-k="${k}" aria-label="${label}">${inner}</button>`
          : `<div class="${cls.join(' ')}" style="${style}" data-k="${k}" aria-label="${label}">${inner}</div>`;
      }
    }
    h += `<div class="layer" style="left:var(--cs);top:var(--cs)">`;
    for (const p of o.pieces || []) h += pieceImg(p, cs);
    for (const ol of o.outlines || []) h += outlineHTML(ol, cs);
    h += `</div></div></div>`;
    return h;
  }
  const U = k => `calc(var(--cs) * ${+(+k).toFixed(4)})`; // [แก้ v2.5.1] ตำแหน่งภาพ/เส้นขอบตาม --cs (เดิมเป็น px คงที่ พอย่อพอดีจอแล้วภาพไม่ตรงช่อง)
  function pieceImg(p, cs) { // ภาพชิ้นตาม fit.json (หมุนได้ ไม่กลับด้าน)
    const f = S.fit[p.pieceId];
    const pc = piece(p.pieceId);
    const rows = f ? f.rows : Math.max(...pc.cells.map(x => x[0])) + 1, cols = f ? f.cols : Math.max(...pc.cells.map(x => x[1])) + 1;
    const odd = p.rot % 2 === 1;
    const W = odd ? rows : cols, H = odd ? cols : rows; // หน่วย = ช่อง
    const inner = f ? `<img src="${artURL(p.pieceId)}" alt="" style="left:${U(f.x)};top:${U(f.y)};width:${U(f.w)};height:${U(f.h)}" onerror="this.remove()">`
      : `<span class="pname">${esc(pc.name)}</span>`;
    return `<div class="pimg ${p.cls || ''}" data-pid="${esc(p.pieceId)}" style="left:${U(p.col)};top:${U(p.row)};width:${U(W)};height:${U(H)}">
      <div class="prot" style="width:${U(cols)};height:${U(rows)};left:${U((W - cols) / 2)};top:${U((H - rows) / 2)};transform:rotate(${p.rot * 90}deg)">${inner}</div></div>`;
  }
  function outlineHTML(ol, cs) { // R-10-03 เส้นขอบสีเจ้าของ + ภาพย่อ
    const set = new Set(ol.cells.map(([r, c]) => kk(r, c)));
    let h = '';
    for (const [r, c] of ol.cells) {
      const sides = [];
      if (!set.has(kk(r - 1, c))) sides.push('border-top'); if (!set.has(kk(r + 1, c))) sides.push('border-bottom');
      if (!set.has(kk(r, c - 1))) sides.push('border-left'); if (!set.has(kk(r, c + 1))) sides.push('border-right');
      h += `<div class="oline ${ol.cls || ''}" data-pid="${esc(ol.pieceId || '')}" style="left:${U(c)};top:${U(r)};width:var(--cs);height:var(--cs);${sides.map(s => `${s}:${ol.w || 3}px solid ${ol.color}`).join(';')}"></div>`;
    }
    return h;
  }
  // v2.2 R-10-08 ชิ้นของเราที่ยังไม่ดับ: ภาพเงาจาง + กรอบจางสีประจำตัว + ช่องไม่มีลายใบ (เห็นเฉพาะเจ้าของ)
  function ownLayers(m, placement, selId) {
    const sunk = new Set((m.sunk || []).map(s => s.pieceId));
    const live = (placement || []).filter(p => !sunk.has(p.pieceId));
    const ownCells = new Set();
    const outlines = live.map(p => { const cells = absCells(p); cells.forEach(([r, c]) => ownCells.add(kk(r, c)));
      return p.pieceId === selId ? { cells, color: '#FFFFFF', w: 3, pieceId: p.pieceId, cls: 'selol' } : { cells, color: m.color, w: 2, pieceId: p.pieceId, cls: 'faint' }; });
    return { pieces: live.map(p => ({ ...p, cls: 'mine' + (p.pieceId === selId ? ' selp' : '') })), outlines, ownCells };
  }
  function sunkLayers(owners) { // ชิ้นที่ดับ: ภาพเต็มชัดค้างไว้ + กรอบสีเจ้าของ ไม่มีรอยไหม้ในช่องของชิ้น
    const pieces = [], outlines = [], cells = new Set(); const t = Date.now();
    for (const p of owners) for (const s of p.sunk) {
      const until = S.reveal.get(`${p.pid}:${s.pieceId}`);
      pieces.push({ pieceId: s.pieceId, row: s.row, col: s.col, rot: s.rot, cls: until && until > t ? 'sunkimg revealing' : 'sunkimg' });
      outlines.push({ cells: s.cells, color: p.color, pieceId: s.pieceId, owner: p.pid });
      s.cells.forEach(([r, c]) => cells.add(kk(r, c)));
    }
    return { pieces, outlines, cells };
  }
  const cellsMap = board => { const b = S.st.boards.find(x => x.id === board); return new Map(b ? b.cells.map(([r, c, v]) => [kk(r, c), v]) : []); };

  // ---------- render ----------
  function render() {
    if (S.drag && S.drag.active) return; // กำลังลากชิ้น — render หลังปล่อย
    const scroll = [...document.querySelectorAll('.bwrap')].map(el => [el.scrollLeft, el.scrollTop]);
    const focusId = document.activeElement && document.activeElement.id;
    let html;
    if (!S.ageOk) html = viewAge();
    else if (S.replaced) html = viewReplaced();
    else if (!S.st || !S.session) html = viewHome();
    else if (!S.cat.size) html = '<p class="muted">กำลังโหลด…</p>';
    else html = ({ LOBBY: viewLobby, PLACING: viewPlacing, BATTLE: viewBattle, GAME_OVER: viewOver })[S.st.phase]();
    if (S.ageOk && !S.replaced) html = dockHTML(!!(S.st && S.session)) + html;   // v2.4 ปุ่มเสียง/แชท/เสียงสด
    if (S.modal) html += viewModal();
    app.innerHTML = html;
    document.querySelectorAll('.bwrap').forEach((el, i) => { if (scroll[i]) { el.scrollLeft = scroll[i][0]; el.scrollTop = scroll[i][1]; } });
    if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); if (f.setSelectionRange) { const v = f.value; f.setSelectionRange(v.length, v.length); } } }
    updateTimer();
    fitScreen();
  }

  // [ใหม่ v2.5] R-10-13 พอดีจอ: ช่วงวางชิ้น/ยิง ย่อช่องกระดานให้ทั้งหน้าอยู่ในจอเดียว ถ้าพอดีแล้วล็อกไม่ให้เลื่อนหน้า
  // ถ้าย่อถึงขั้นต่ำแล้วยังไม่พอ (จอเล็กมาก) = เลื่อนได้ตามปกติ · ซูมกระดานอยู่ (zoom > 1) = ไม่ย่อและไม่ล็อก
  const FIT_MIN_CS = 18;
  // [แก้ v2.5.1 D-56] คำนวณขนาดช่องครั้งเดียวต่อ "สภาพจอหนึ่งแบบ" แล้วจำไว้ (S.fitCs/S.fitKey)
  // render รอบถัดไปใช้ค่าที่จำไว้เลย ไม่วัดใหม่ ไม่ปลด/ใส่ noscroll สลับไปมา = กระดานไม่กระตุกทุกครั้งที่กดปุ่ม
  const fitKey = () => `${S.st && S.st.phase}|${S.st ? B() : 0}|${window.innerWidth}|${S.zoom}`;
  const isTyping = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };
  function fitScreen() {
    const root = document.documentElement, app = $('#app');
    const on = !!(app && S.st && S.session && (S.st.phase === 'PLACING' || S.st.phase === 'BATTLE') && S.zoom === 1);
    if (!on) { root.classList.remove('noscroll'); S.fitKey = ''; S.fitCs = 0; return; }
    const board = document.querySelector('.board'); if (!board) return;
    const key = fitKey();
    const bs = getComputedStyle(document.body);
    const pad = (parseFloat(bs.paddingTop) || 0) + (parseFloat(bs.paddingBottom) || 0);
    const avail = Math.floor(window.innerHeight);   // ไม่ใช้ visualViewport: ค่ามันหดตอนแป้นพิมพ์เด้ง
    const need = () => Math.ceil(app.getBoundingClientRect().height + pad);
    // สภาพจอเดิม = ไม่วัด/ไม่ย่อกระดานใหม่ (กันกระตุก) แต่ยังเช็กว่าควรล็อกเลื่อนไหม เผื่อเนื้อหาในหน้ายาวขึ้น เช่น มีข้อความแจ้งเพิ่ม
    if (key === S.fitKey && S.fitCs) { S.fitLock = need() <= avail; root.classList.toggle('noscroll', S.fitLock); return; }
    board.style.setProperty('--cs', board.dataset.cs + 'px');
    const n = B() + 1;
    for (let i = 0; i < 8 && need() > avail; i++) {   // v2.5.1 วัดรอบเดียวจึงต้องลองให้ครบ (เดิมอาศัยว่า render ทุกครั้งเรียกซ้ำ)
      const cur = parseFloat(board.style.getPropertyValue('--cs'));
      const next = Math.max(FIT_MIN_CS, Math.floor(cur - (need() - avail) / n) - 1);
      if (next >= cur) break;
      board.style.setProperty('--cs', next + 'px');
    }
    S.fitKey = key; S.fitCs = parseFloat(board.style.getPropertyValue('--cs')); S.fitLock = need() <= avail;
    root.classList.toggle('noscroll', !!S.fitLock);
  }
  // คำนวณใหม่เฉพาะตอนหมุนจอ หรือความกว้างจอเปลี่ยน (แถบที่อยู่ Safari ยืดหด = ความสูงเปลี่ยนอย่างเดียว ไม่คำนวณใหม่)
  let fitTm, lastW = window.innerWidth, lastH = window.innerHeight;
  const invalidateFit = () => { S.fitKey = ''; S.fitCs = 0; clearTimeout(fitTm); fitTm = setTimeout(() => { fitScreen(); render(); }, 80); };
  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight, wCh = w !== lastW;
    lastW = w;
    if (isTyping()) { lastH = h; return; }                 // แป้นพิมพ์เด้ง = ไม่แตะกระดาน
    const bigH = Math.abs(h - lastH) > 150; lastH = h;     // ความสูงเปลี่ยนมาก = หมุนจอ/ย่อหน้าต่าง ไม่ใช่แถบ Safari
    if (wCh || bigH) invalidateFit();
  });
  window.addEventListener('orientationchange', invalidateFit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { S.fitKey = ''; fitScreen(); });

  function viewAge() {
    return `<section class="panel gate"><div class="stripe"></div><img class="logo" src="/icons/icon-192.png" alt=""><h1>Battle Weed: Green Social</h1>
      <p>เกมนี้สำหรับผู้มีอายุ 20 ปีขึ้นไป</p>
      <div class="row"><button class="btn" data-act="age-ok">ฉันอายุ 20 ปีขึ้นไป</button><button class="btn ghost" data-act="age-no">ออก</button></div></section>`;
  }
  function viewReplaced() {
    return `<section class="panel"><h2>เปิดเกมจากอีกแท็บหรืออีกเครื่องแล้ว</h2><p class="muted">ที่นั่งนี้ย้ายไปเล่นที่อื่น</p>
      <button class="btn" data-act="take-back">เล่นต่อที่นี่</button></section>`;
  }
  // R-10-01 ปุ่มเพิ่มไปหน้าจอโฮม
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function installKind() {
    const ua = navigator.userAgent;
    if (/Line\/|FBAN|FBAV|FB_IAB|Messenger|Instagram/i.test(ua)) return 'inapp';
    if (S.installEvt) return 'prompt';
    if (/iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
    return 'menu';
  }
  // ---------- หน้าแรก + รายการห้อง (v2.3 R-5-12 ถึง R-5-14) ----------
  function ensureList() {
    if (S.listOn || S.session || !socket.connected) return;
    S.listOn = true;
    emit('list_rooms', {}).then(r => { if (r.ok) { S.rooms = r.rooms || []; render(); } else S.listOn = false; });
  }
  function lookInvite() {
    const iv = S.invite; if (!iv.code || iv.looked || !socket.connected) return;
    iv.looked = true;
    emit('find_room', { code: iv.code }).then(r => { iv.room = r.ok ? r.room : null; if (!r.ok) iv.code = ''; render(); });
  }
  const ISL_TAG = { random: 'เกาะสุ่ม', draw: 'เกาะวาดเอง' };
  function roomTags(rm) {
    const t = [`${rm.players}/${rm.max} คน`, rm.settings.mode === 'survival' ? 'Survival' : 'Classic'];
    if (rm.settings.islands !== 'off') t.push(ISL_TAG[rm.settings.islands]);
    if (rm.settings.traps) t.push('กับดัก');
    if (rm.settings.bonusOnHit) t.push('โดนแล้วยิงต่อ');
    return t.map(x => `<span class="tag">${esc(x)}</span>`).join('');
  }
  function roomCard(rm, pw) {
    const st = rm.status === 'open' ? `<button class="btn small" data-act="join-room" data-code="${esc(rm.code)}" data-priv="${rm.private ? 1 : 0}"${pw ? ` data-pw="${esc(pw)}"` : ''}>เข้าร่วม</button>`
      : `<span class="tag stat">${rm.status === 'full' ? 'เต็ม' : 'กำลังเล่น'}</span>`;
    return `<div class="rcard ${rm.status}"><div class="rinfo"><div class="rname">${rm.private ? '🔒 ' : ''}${esc(rm.name)}</div>
      <div class="muted small">โดย ${esc(rm.host)} · #${esc(rm.code)}</div><div class="tags">${roomTags(rm)}</div></div>${st}</div>`;
  }
  function viewHome() {
    ensureList(); lookInvite();
    const iv = S.invite; const nr = S.newRoom;
    const create = S.createOpen ? `<section class="panel"><h2>สร้างห้อง</h2>
        <label for="in-rname">ชื่อห้อง</label><input id="in-rname" maxlength="20" value="${esc(nr.name)}" placeholder="ห้องของ ${esc(S.name || 'คุณ')}">
        <div class="optgrp"><label class="opt"><input type="radio" name="npriv" value="0" data-new="priv" ${nr.priv ? '' : 'checked'}> สาธารณะ — ใครก็กดเข้าได้</label>
        <label class="opt"><input type="radio" name="npriv" value="1" data-new="priv" ${nr.priv ? 'checked' : ''}> 🔒 ส่วนตัว — ต้องใส่รหัสผ่าน</label></div>
        ${nr.priv ? `<label for="in-npw">รหัสผ่าน (ตัวเลข 4 หลัก)</label><input id="in-npw" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(nr.pw)}">` : ''}
        <div class="row"><button class="btn ghost" data-act="create-cancel">ยกเลิก</button><button class="btn" data-act="create">สร้างห้อง</button></div></section>` : '';
    const list = S.rooms.length ? S.rooms.map(rm => roomCard(rm)).join('') : '<p class="muted center">ยังไม่มีห้องที่เปิดอยู่ — สร้างห้องแรกได้เลย</p>';
    return `<div class="stripe"></div><div class="brand"><img class="logo" src="/icons/icon-192.png" alt=""><h1>Battle Weed: Green Social</h1></div>
      <p class="muted">ซ่อนอุปกรณ์สายเขียวบนกระดาน แล้วยิงหาของเพื่อน ใครเหลือรอดคนสุดท้ายชนะ เล่นได้ 2–7 คน</p>
      ${S.lost ? `<div class="warn">${esc(S.lost)}</div>` : ''}
      <section class="panel">
        <label for="in-name">ชื่อของคุณ</label>
        <input id="in-name" maxlength="16" autocomplete="nickname" value="${esc(S.name)}" placeholder="เช่น เอ">
        ${S.createOpen ? '' : '<div class="row"><button class="btn" data-act="create-open">สร้างห้อง</button><button class="btn ghost" data-act="find-open">🔍 ค้นหาห้อง</button></div>'}
      </section>
      ${iv.code && iv.room ? `<section class="panel invite"><h2>คำเชิญเข้าห้อง</h2>${roomCard(iv.room, iv.pw)}</section>` : ''}
      ${create}
      <section class="panel"><h2>ห้องที่เปิดอยู่ <span class="muted small">(${S.rooms.filter(r => r.status === 'open').length} ห้องรอคน)</span></h2><div class="rlist">${list}</div></section>
      ${standalone() ? '' : '<button class="btn ghost install-btn" data-act="install">📲 เพิ่มไปหน้าจอโฮม</button>'}`;
  }
  async function joinRoom(code, pw, el) {
    const name = (($('#in-name') || {}).value || S.name || '').trim();
    if (!name) { toast('ใส่ชื่อของคุณก่อน'); const f = $('#in-name'); if (f) f.focus(); return; }
    if (el) el.disabled = true;
    const res = await emit('join', { code, name, password: pw || undefined });
    if (el) el.disabled = false;
    if (res.ok) { S.modal = null; S.invite = { code: '', pw: '', room: null, looked: true }; saveSession({ code: res.code, playerId: res.pid, token: res.token }); S.lost = null; S.listOn = false; history.replaceState(null, '', '/'); }
    else if (res.code === 'BAD_PASSWORD') { S.modal = { type: 'pw', code, wrong: true }; render(); }
  }
  function header(extra) {
    const rn = S.st.room && S.st.room.name;
    return `<div class="row head"><h2>${rn ? esc(rn) : 'ห้อง ' + esc(S.st.code)}${S.st.room && S.st.room.private ? ' 🔒' : ''}</h2>${extra || ''}</div>`;
  }
  const dot = p => `<i class="pdot" style="background:${p.color}"></i>`;
  function playersHTML() {
    return S.st.players.filter(p => !p.removed).map(p => `<div class="pl"><span>${dot(p)}${esc(p.name)}${p.pid === S.st.hostPid ? ' 👑' : ''}${p.pid === S.st.you ? ' (คุณ)' : ''}</span>
      <span class="muted">${p.connected ? '' : 'หลุด'}</span></div>`).join('');
  }
  const MODE_TXT = { classic: 'Classic — คนละกระดาน', survival: 'Survival — กระดานรวม ของทับกันได้' };
  const ISL_TXT = { off: 'ไม่มี', random: 'สุ่มให้', draw: 'วาดเอง' };
  function settingsHTML(editable) {
    const s = S.st.settings; const dis = editable ? '' : 'disabled';
    const opt = (name, val, cur, txt) => `<label class="opt"><input type="radio" name="${name}" value="${val}" ${val === cur ? 'checked' : ''} ${dis} data-set="${name}"> ${txt}</label>`;
    return `<section class="panel"><h2>ตั้งค่าเกม${editable ? '' : ' (หัวห้องเป็นคนตั้ง)'}</h2>
      <div class="optgrp"><span class="muted">โหมด</span>${opt('mode', 'classic', s.mode, MODE_TXT.classic)}${opt('mode', 'survival', s.mode, MODE_TXT.survival)}</div>
      <label class="opt"><input type="checkbox" ${s.bonusOnHit ? 'checked' : ''} ${dis} data-set="bonusOnHit"> โดนแล้วได้ยิงเพิ่ม</label>
      <div class="optgrp"><span class="muted">เกาะส่วนตัว</span>${['off', 'random', 'draw'].map(v => opt('islands', v, s.islands, ISL_TXT[v])).join('')}</div>
      <label class="opt"><input type="checkbox" ${s.traps ? 'checked' : ''} ${dis} data-set="traps"> ช่องกับดัก</label></section>`;
  }
  // R-5-10 / R-5-14 ลิงก์เชิญของห้องส่วนตัวมีรหัสผ่านติดไป
  const inviteLink = () => `${location.origin}/?room=${S.st.code}${S.st.room && S.st.room.private && S.st.room.password ? `&pw=${S.st.room.password}` : ''}`;
  function roomMetaHTML() {
    const rm = S.st.room || {};
    if (!isHost()) return rm.private ? `<p class="muted center">🔒 ห้องส่วนตัว · รหัสผ่าน <b>${esc(rm.password || '')}</b></p>` : '<p class="muted center">ห้องสาธารณะ — ขึ้นในรายการหน้าแรก</p>';
    return `<section class="panel"><h2>ห้อง</h2>
      <label for="in-mname">ชื่อห้อง</label><input id="in-mname" maxlength="20" value="${esc(rm.name || '')}" data-meta="name">
      <div class="optgrp"><label class="opt"><input type="radio" name="mpriv" value="0" data-meta="private" ${rm.private ? '' : 'checked'}> สาธารณะ</label>
      <label class="opt"><input type="radio" name="mpriv" value="1" data-meta="private" ${rm.private ? 'checked' : ''}> 🔒 ส่วนตัว</label></div>
      ${rm.private ? `<label for="in-mpw">รหัสผ่าน (ตัวเลข 4 หลัก)</label><input id="in-mpw" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(rm.password || '')}" data-meta="password">` : ''}
      <p class="muted small">${rm.private ? 'ห้องขึ้นในรายการพร้อม 🔒 คนอื่นต้องใส่รหัสผ่าน ส่วนลิงก์ด้านบนมีรหัสผ่านติดไปแล้ว' : 'ห้องขึ้นในรายการหน้าแรก ใครก็กดเข้าได้'}</p></section>`;
  }
  function viewLobby() {
    const link = inviteLink();
    const n = S.st.players.filter(p => !p.removed && p.connected).length;
    return `${header('<button class="btn ghost small" data-act="leave">ออก</button>')}
      <section class="panel center"><p class="muted">ส่งลิงก์ให้เพื่อน หรือให้เพื่อนกดเข้าจากรายการห้อง (2–7 คน)</p>
        <div class="code">#${esc(S.st.code)}</div>
        <div class="row wide"><button class="btn" data-act="share" data-link="${esc(link)}">แชร์ลิงก์</button><button class="btn ghost" data-act="copy" data-link="${esc(link)}">คัดลอก</button></div></section>
      ${roomMetaHTML()}
      <section class="panel"><div class="players">${playersHTML()}</div></section>
      ${settingsHTML(isHost())}
      ${isHost() ? `<button class="btn" data-act="start" ${n < 2 ? 'disabled' : ''}>เริ่มเกม (${n} คน)</button>` : '<p class="muted center">รอหัวห้องกดเริ่มเกม…</p>'}`;
  }
  function timerHTML() { return '<span class="timer" id="timer"></span>'; }
  function warnHTML() {
    return S.st.players.filter(p => !p.removed && !p.connected && p.graceLeft != null && p.pid !== S.st.you)
      .map(p => `<div class="warn grace" data-base="${p.graceLeft}">${esc(p.name)} หลุด — รออีก <span class="graceN">${p.graceLeft}</span> วิ</div>`).join('');
  }

  // ---------- ช่วงวาง ----------
  function trayHTML() {
    return `<div class="tray">${S.st.fleet.map(id => {
      const p = piece(id); const cls = ['tpiece'];
      if (!S.islMode && (S.sel === id || (!S.sel && S.pick === id && !S.draft[id]))) cls.push('sel');
      if (S.draft[id]) cls.push('placed');
      return `<button class="${cls.join(' ')}" data-act="pick" data-id="${esc(id)}"><img src="${artURL(id)}" alt="" onerror="this.remove()"><span>${esc(p.name)} ${p.cells.length}</span>${S.draft[id] ? '<i class="ok">✓</i>' : ''}</button>`;
    }).join('')}</div>`;
  }
  function viewPlacing() {
    const m = me();
    const myIsl = new Set((m.islands || []).flat().map(([r, c]) => kk(r, c)));
    const others = S.st.players.filter(p => !p.removed && p.pid !== m.pid);
    const readyTxt = others.map(p => `${dot(p)}${esc(p.name)} ${p.ready ? '✓' : '…'}`).join(' · ');
    if (m.ready || !m.alive) {
      const ol = ownLayers(m, m.placement);
      return `${header(timerHTML())}<div class="status"><span>${m.alive ? 'วางเสร็จแล้ว รอคนอื่น…' : 'คุณออกจากเกมนี้แล้ว'}</span></div>
        <div class="muted">${readyTxt}</div>${warnHTML()}
        ${boardHTML({ board: 'me', islands: myIsl, pieces: ol.pieces, outlines: ol.outlines, ownCells: ol.ownCells })}
        ${m.alive ? '<button class="btn danger" data-act="resign">ยอมแพ้</button>' : ''}`;
    }
    const draw = S.st.settings.islands === 'draw';
    const islSet = draw ? S.isl : myIsl;
    if (S.sel && !S.draft[S.sel]) S.sel = null;
    const ol = ownLayers(m, Object.entries(S.draft).map(([id, v]) => ({ pieceId: id, ...v })), S.islMode ? null : S.sel);
    const all = S.st.fleet.every(id => S.draft[id]);
    const islOk = !draw || islGroupsOk();
    const nxt = S.pick && !S.draft[S.pick] ? S.pick : nextUnplaced();
    let status;
    if (S.islMode) status = `วาดเกาะ <b>${S.isl.size}/${S.st.config.ISLAND_CELLS}</b> ช่อง (เกาะละ ≥ ${S.st.config.ISLAND_MIN_GROUP} ช่องติดกัน)`;
    else if (S.sel) status = `เลือก <b>${esc(piece(S.sel).name)}</b> — แตะช่องว่างเพื่อย้าย หรือกดค้างแล้วลาก`;
    else if (nxt) status = `แตะช่องว่างเพื่อวาง <b>${esc(piece(nxt).name)}</b>`;
    else status = 'วางครบแล้ว — แตะชิ้นเพื่อย้าย หมุน หรือเอาออก';
    const tools = S.sel && !S.islMode ? `<div class="seltools"><button class="btn small" data-act="rot">หมุน ⟳</button><button class="btn ghost small" data-act="unplace">เอาออก ✕</button><button class="btn ghost small" data-act="desel">เสร็จ</button></div>` : '';
    return `${header(timerHTML())}
      <div class="status"><span>${status}</span></div>
      ${tools}
      <div class="muted">${readyTxt}</div>${warnHTML()}
      ${boardHTML({ board: 'me', placing: true, islands: islSet, pieces: ol.pieces, outlines: ol.outlines, ownCells: ol.ownCells, clickable: () => 'place' })}
      <div class="legend"><span class="howto">แตะช่องว่าง = วาง (ช่องที่แตะ = มุมซ้ายบนของชิ้น) · แตะชิ้น = เลือก แล้วย้าย หมุน เอาออก · กดค้างที่ชิ้นแล้วลากได้</span>${S.st.settings.mode === 'survival' ? '<span>Survival: ของคนอื่นอาจทับช่องเดียวกับคุณได้ (มองไม่เห็น)</span>' : ''}</div>
      ${trayHTML()}
      ${draw ? `<button class="btn ghost" data-act="islmode">${S.islMode ? 'กลับไปวางชิ้น' : `วาดเกาะ (${S.isl.size}/${S.st.config.ISLAND_CELLS})`}</button>` : ''}
      <div class="row"><button class="btn ghost" data-act="suggest">สุ่มวางให้</button><button class="btn" data-act="confirm" ${all && islOk ? '' : 'disabled'}>ยืนยัน</button></div>
      <button class="btn danger" data-act="resign">ยอมแพ้</button>`;
  }

  // ---------- ช่วงยิง ----------
  function summaryHTML() { // R-10-04
    const fleet = S.st.fleet;
    const rows = S.st.players.filter(p => p.ready || !p.alive).map(p => {
      const sunk = new Set(p.sunk.map(s => s.pieceId));
      const tags = [];
      if (!p.alive) tags.push('<span class="tag out">ตกรอบ</span>');
      else {
        if (p.skipNext) tags.push('<span class="tag skip">ข้ามตา</span>');
        if (S.st.turnStyle === 'rounds' && p.shotsAllowed > 1) tags.push('<span class="tag x2">2 นัด</span>');
        if (p.doubleBonus) tags.push('<span class="tag dbl">นัดคู่</span>');
        if (S.st.turnStyle === 'rounds' && p.submitted) tags.push('<span class="tag ok">ส่งแล้ว</span>');
        if (S.st.turnStyle === 'turns' && p.pid === S.st.turnPid) tags.push('<span class="tag turn">กำลังยิง</span>');
      }
      return `<tr class="${p.alive ? '' : 'dead'}"><th>${dot(p)}${esc(p.name)}${p.pid === S.st.you ? ' (คุณ)' : ''} ${tags.join('')}</th>
        ${fleet.map(id => `<td class="${sunk.has(id) ? 'gone' : ''}">${sunk.has(id) ? '✕' : '●'}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="summary ${S.sumOpen ? 'open' : ''}" data-act="sumtoggle"><table><thead><tr><th class="muted">แตะเพื่อ${S.sumOpen ? 'ย่อ' : 'ขยาย'}</th>
      ${fleet.map(id => `<th><img src="${artURL(id)}" alt="${esc(piece(id).name)}" title="${esc(piece(id).name)}" onerror="this.replaceWith('${esc(piece(id).name).slice(0, 2)}')"></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function canShoot() {
    const m = me(); if (!m || !m.alive) return false;
    if (S.st.turnStyle === 'turns') return S.st.turnPid === m.pid;
    return m.shooting && !m.submitted;
  }
  const needShots = () => S.st.turnStyle === 'turns' ? 1 : me().shotsAllowed;
  function viewBattle() {
    const m = me(); const st = S.st;
    const classic = st.settings.mode === 'classic';
    const alive = st.players.filter(p => p.alive && !p.removed);
    const opps = alive.filter(p => p.pid !== m.pid);
    if (classic && (!S.tab || (S.tab !== 'me' && !opps.some(p => p.pid === S.tab)))) S.tab = opps[0] ? opps[0].pid : 'me';
    const myTurn = canShoot();
    let status;
    if (!m.alive) status = 'คุณตกรอบแล้ว — ดูต่อได้';
    else if (st.turnStyle === 'turns') status = myTurn ? `<b>ตาคุณ</b> เลือกช่องแล้วกดยิง${m.doubleBonus ? ' (นัดคู่!)' : ''}` : `ตา ${esc((pl(st.turnPid) || {}).name || '')}`;
    else if (!m.shooting) status = 'รอบนี้คุณถูกข้าม';
    else if (m.submitted) status = `ส่งแล้ว รอคนอื่น (${alive.filter(p => p.submitted).length}/${alive.filter(p => p.shooting).length})`;
    else status = `<b>รอบ ${st.roundNo}</b> เลือก ${m.shotsAllowed} นัด${m.doubleBonus ? ' · นัดแรกเป็นนัดคู่' : ''}`;
    const aimSet = new Set(S.aim.filter(a => a.board === (classic ? S.tab : '*')).map(a => kk(a.row, a.col)));
    const target = classic ? S.tab : '*';
    const marks = new Map([...aimSet].map(k => [k, 'aim']));
    let boardBlock;
    if (classic) {
      const tabs = [...opps, m].map(p => `<button class="tab ${S.tab === (p.pid === m.pid ? 'me' : p.pid) ? 'on' : ''}" data-act="tab" data-id="${p.pid === m.pid ? 'me' : esc(p.pid)}" style="--pc:${p.color}">${dot(p)}${p.pid === m.pid ? 'ของคุณ' : esc(p.name)}</button>`).join('');
      if (S.tab === 'me') {
        const sl = sunkLayers([m]); const ol = ownLayers(m, m.placement);
        boardBlock = `<div class="tabs">${tabs}</div>${boardHTML({ board: m.pid, cells: cellsMap(m.pid), islands: new Set((m.islands || []).flat().map(([r, c]) => kk(r, c))),
          pieces: [...ol.pieces, ...sl.pieces], outlines: [...ol.outlines, ...sl.outlines], ownCells: ol.ownCells, sunkCells: sl.cells })}`;
      } else {
        const o = pl(S.tab); const sl = sunkLayers([o]);
        boardBlock = `<div class="tabs">${tabs}</div>${boardHTML({ board: o.pid, cells: cellsMap(o.pid), marks, pieces: sl.pieces, outlines: sl.outlines, sunkCells: sl.cells,
          clickable: (r, c, s) => (myTurn && !s ? 'aim' : null) })}`;
      }
    } else {
      const sl = sunkLayers(st.players); const ol = ownLayers(m, m.placement);
      boardBlock = boardHTML({ board: '*', cells: cellsMap('*'), marks, islands: new Set((m.islands || []).flat().map(([r, c]) => kk(r, c))),
        pieces: [...ol.pieces, ...sl.pieces], outlines: [...ol.outlines, ...sl.outlines], ownCells: ol.ownCells, sunkCells: sl.cells,
        clickable: (r, c, s) => (myTurn && !s ? 'aim' : null) });
    }
    const n = needShots();
    const dblCtl = myTurn && m.doubleBonus ? `<div class="row"><span class="muted">นัดคู่แนว</span><button class="btn ghost small ${S.dbl === 'H' ? 'on' : ''}" data-act="dbl" data-v="H">นอน ↔</button><button class="btn ghost small ${S.dbl === 'V' ? 'on' : ''}" data-act="dbl" data-v="V">ตั้ง ↕</button></div>` : '';
    // R-10-06 ปุ่มยิงติดขอบล่างจอ
    const fireBtn = myTurn ? `<div class="firebar">${dblCtl}<button class="btn fire" data-act="fire" ${S.aim.length === n ? '' : 'disabled'}>ยิง! (${S.aim.length}/${n})</button>
      <div class="muted center small">${S.aim.length ? 'ไม่กดยิงจนหมดเวลา = ยิงช่องที่เลือกไว้' : 'แตะช่องบนกระดานเพื่อเล็ง'}</div></div>` : '';
    return `${header(timerHTML())}
      <div class="status"><span>${status}</span><span class="zoomctl"><button class="btn ghost small" data-act="zoom" data-v="-1" aria-label="ย่อ">−</button><button class="btn ghost small" data-act="zoom" data-v="1" aria-label="ขยาย">+</button></span></div>
      ${m.autoStreak && m.alive ? `<div class="warn">ระบบยิงแทนคุณ ${m.autoStreak} ครั้งติดกันแล้ว ครบ 3 ครั้งจะตกรอบ</div>` : ''}
      ${warnHTML()}${summaryHTML()}
      ${boardBlock}
      ${fireBtn}
      <div class="legend">${['miss', 'hit', 'island', 'trap'].map(s => `<span>${STATE_SVG[s]} ${LABEL[s]}</span>`).join('')}</div>
      ${m.alive ? '<button class="btn danger" data-act="resign">ยอมแพ้</button>' : '<button class="btn ghost" data-act="leave">ออกจากห้อง</button>'}`;
  }

  // ---------- จบเกม ----------
  const ELIM_TXT = { sunk: 'ดับครบทุกชิ้น', auto_limit: 'ไม่ได้ยิงเอง 3 ตาติดกัน', resign: 'ยอมแพ้', disconnect: 'หลุดเกินเวลา' }; // R-9-07
  const REASON = { last_standing: 'เหลือรอดคนสุดท้าย', draw: 'ตกรอบพร้อมกันหมด', tiebreak_hits: 'ตกรอบพร้อมกัน ตัดสินด้วยจำนวนนัดที่ยิงโดนของคนอื่น', cancelled: 'ทุกคนหลุดหรือออก เกมถูกยกเลิก' };
  function viewOver() {
    const m = me(), res = S.st.result || {};
    const w = res.winnerPid && pl(res.winnerPid);
    const title = !res.winnerPid ? (res.reason === 'draw' ? 'เสมอ!' : 'เกมถูกยกเลิก') : res.winnerPid === m.pid ? 'คุณชนะ!' : `${esc(w ? w.name : '')} ชนะ`;
    const rk = Object.fromEntries((res.ranking || []).map(r => [r.pid, r.rank]));
    const rows = S.st.players.filter(p => p.pid in rk).sort((a, b) => rk[a.pid] - rk[b.pid]).map(p => {
      const s = p.stats || { shots: 0, hits: 0, hitsOnOthers: 0 };
      const why = p.pid === res.winnerPid ? '<span class="why win">ผู้ชนะ</span>' : (res.elimReasons || {})[p.pid] ? `<span class="why">${esc(ELIM_TXT[res.elimReasons[p.pid]] || '')}</span>` : '';
      return `<tr><td>${rk[p.pid]}</td><th>${dot(p)}${esc(p.name)}${p.pid === m.pid ? ' (คุณ)' : ''}${why}</th><td>${s.shots}</td><td>${s.shots ? Math.round(s.hits / s.shots * 100) : 0}%</td><td>${s.hitsOnOthers}</td></tr>`;
    }).join('');
    const classic = S.st.settings.mode === 'classic';
    const all = S.st.players.filter(p => p.placement);
    const outlinesOf = p => (p.placement || []).map(pp => ({ cells: absCells(pp), color: p.color, pieceId: pp.pieceId, owner: p.pid }));
    const imgsOf = p => (p.placement || []).map(pp => ({ ...pp, cls: p.sunk.some(s => s.pieceId === pp.pieceId) ? 'sunkimg' : 'reveal' }));
    const sunkSet = ps => new Set(ps.flatMap(p => p.sunk.flatMap(s => s.cells.map(([r, c]) => kk(r, c)))));
    let boards;
    if (classic) {
      if (!S.tab || S.tab === 'me' || !all.some(p => p.pid === S.tab)) S.tab = (all.find(p => p.pid !== m.pid) || m).pid;
      const o = pl(S.tab);
      const bd = S.st.boards.find(b => b.id === o.pid);
      boards = `<div class="tabs">${all.map(p => `<button class="tab ${S.tab === p.pid ? 'on' : ''}" data-act="tab" data-id="${esc(p.pid)}">${dot(p)}${esc(p.name)}</button>`).join('')}</div>
        ${boardHTML({ board: o.pid, cells: cellsMap(o.pid), islands: new Set((o.islands || []).flat().map(([r, c]) => kk(r, c))), traps: new Set(((bd && bd.traps) || []).map(([r, c]) => kk(r, c))),
          pieces: imgsOf(o), outlines: outlinesOf(o), sunkCells: sunkSet([o]) })}`;
    } else {
      const bd = S.st.boards.find(b => b.id === '*');
      boards = boardHTML({ board: '*', cells: cellsMap('*'), traps: new Set(((bd && bd.traps) || []).map(([r, c]) => kk(r, c))),
        islands: new Set(all.flatMap(p => (p.islands || []).flat().map(([r, c]) => kk(r, c)))), pieces: all.flatMap(imgsOf), outlines: all.flatMap(outlinesOf), sunkCells: sunkSet(all) });
    }
    const act2 = S.st.players.filter(p => !p.removed);
    const waiting = act2.filter(p => !p.wantsRematch).map(p => p.name);
    return `${header()}
      <section class="panel"><div class="result">${title}</div><p class="muted center">${esc(REASON[res.reason] || '')}</p>
        <table class="stats"><thead><tr><th>#</th><th>ผู้เล่น</th><th>นัด</th><th>อัตราโดน</th><th>โดนคนอื่น</th></tr></thead><tbody>${rows}</tbody></table></section>
      <h2>${classic ? 'กระดานทุกคน (เปิดหมด)' : 'กระดานรวม (เปิดหมด)'}</h2>${boards}
      ${act2.length >= 2 ? `<button class="btn" data-act="rematch" ${m.wantsRematch ? 'disabled' : ''}>${m.wantsRematch ? `รอ ${esc(waiting.join(', '))} กดเล่นอีก…` : 'เล่นอีก'}</button>` : '<div class="warn">เหลือคุณคนเดียวในห้อง</div>'}
      ${isHost() ? `${settingsHTML(true)}<button class="btn ghost" data-act="lobby">กลับล็อบบี้ (รอคนเพิ่ม)</button>` : ''}
      <button class="btn ghost" data-act="leave">ออกจากห้อง</button>`;
  }

  function viewModal() {
    const mm = S.modal;
    if (mm.type === 'find') return `<div class="modal"><section class="panel narrow"><h2>🔍 ค้นหาห้อง</h2>
      <label for="in-find">รหัสห้อง (ตัวเลข 4 หลัก)</label><input id="in-find" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${esc(mm.q || '')}" placeholder="เช่น 4821">
      <div class="row"><button class="btn ghost" data-act="close">ปิด</button><button class="btn" data-act="find-go">ค้นหา</button></div>
      ${mm.room ? roomCard(mm.room) : mm.none ? '<p class="muted center">ไม่พบห้องนี้</p>' : ''}</section></div>`;
    if (mm.type === 'pw') return `<div class="modal"><section class="panel narrow"><h2>🔒 ห้องส่วนตัว</h2>
      <label for="in-pw">รหัสผ่าน (ตัวเลข 4 หลัก)</label><input id="in-pw" maxlength="4" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="">
      ${mm.wrong ? '<p class="warn small">รหัสผ่านไม่ถูกต้อง</p>' : ''}
      <div class="row"><button class="btn ghost" data-act="close">ยกเลิก</button><button class="btn" data-act="pw-go" data-code="${esc(mm.code)}">เข้าห้อง</button></div></section></div>`;
    if (mm.type === 'resign') return `<div class="modal"><section class="panel narrow"><h2>ยอมแพ้เกมนี้?</h2><p class="muted">คุณจะตกรอบทันที</p>
      <div class="row"><button class="btn danger" data-act="resign-yes">ยอมแพ้</button><button class="btn" data-act="close">เล่นต่อ</button></div></section></div>`;
    if (mm.type === 'sunk') return `<div class="modal" data-act="close"><section class="panel narrow center"><img class="bigpiece" src="${artURL(mm.piece)}" alt=""><h2>${esc(piece(mm.piece).name)}ของ ${esc((pl(mm.owner) || {}).name || '')}</h2><p class="muted">แตะเพื่อปิด</p></section></div>`;
    if (mm.type === 'install') {
      const k = installKind();
      const body = {
        ios: '<ol><li>กดปุ่ม <b>แชร์</b> ⬆ ที่แถบล่างของ Safari</li><li>เลื่อนลงแล้วกด <b>เพิ่มไปยังหน้าจอโฮม</b></li><li>กด <b>เพิ่ม</b> มุมขวาบน</li></ol><p class="muted">iPhone ไม่ให้เว็บเพิ่มไอคอนเอง ต้องทำตามนี้</p>',
        inapp: `<p>เบราว์เซอร์ในแอปนี้เพิ่มไอคอนไม่ได้ เปิดลิงก์นี้ใน <b>Safari</b> หรือ <b>Chrome</b> ก่อน แล้วกดปุ่มนี้อีกครั้ง</p><button class="btn" data-act="copy" data-link="${esc(location.origin)}">คัดลอกลิงก์</button>`,
        menu: '<ol><li>กดเมนู <b>⋮</b> ของเบราว์เซอร์</li><li>เลือก <b>เพิ่มไปยังหน้าจอหลัก</b> หรือ <b>ติดตั้งแอป</b></li></ol>',
      }[k] || '';
      return `<div class="modal"><section class="panel narrow"><h2>เพิ่ม Battle Weed ไปหน้าจอโฮม</h2>${body}<button class="btn ghost" data-act="close">ปิด</button></section></div>`;
    }
    return '';
  }

  // ---------- นาฬิกา ----------
  function updateTimer() {
    const t = $('#timer'); const s = secsLeft();
    if (t) { t.textContent = s == null ? '' : `${s} วิ`; t.classList.toggle('low', s != null && s <= 5); }
    const bc = $('#bigcount'); // R-10-06 [แก้ v2.4] ตัวเลขใหญ่ตอนเหลือ ≤ 5 วิ เฉพาะคนที่ต้องยิง
    if (bc) {
      const from = (S.st && S.st.config && S.st.config.COUNTDOWN_FROM) || 5;
      const on = !!(S.st && S.st.phase === 'BATTLE' && S.session && canShoot() && s != null && s >= 1 && s <= from);
      bc.hidden = !on;
      if (on) {
        if (bc.dataset.n !== String(s)) { bc.dataset.n = String(s); bc.textContent = s; bc.classList.remove('tick'); void bc.offsetWidth; bc.classList.add('tick'); SFX.play(s <= 1 ? 'tickLast' : 'tick'); }
      } else bc.dataset.n = '';
      SFX.intense(on);
    }
    document.querySelectorAll('.grace').forEach(g => { const n = g.querySelector('.graceN'); if (n) n.textContent = Math.max(0, +g.dataset.base - Math.floor((Date.now() - S.recvAt) / 1000)); });
  }
  setInterval(updateTimer, 250);

  // R-8-12 ส่งช่องที่เลือกไว้ให้ server (หมดเวลาแล้วยิงช่องนี้เป็นการยิงเอง)
  function aimShots() {
    const m = me();
    return S.aim.map((x, i) => ({ row: x.row, col: x.col, ...(x.board !== '*' ? { board: x.board } : {}), ...(i === 0 && m && m.doubleBonus ? { double: S.dbl } : {}) }));
  }
  function syncAim() {
    clearTimeout(syncAim.t);
    syncAim.t = setTimeout(() => { if (S.st && S.st.phase === 'BATTLE' && canShoot()) emit('action', { type: 'aim', turnNo: S.st.turnNo, shots: aimShots() }); }, 120);
  }

  // ---------- คลิก ----------
  document.addEventListener('input', e => {
    if (e.target.id === 'in-name') { S.name = e.target.value; store.set('bw_name', S.name); }
    if (['in-find', 'in-pw', 'in-npw', 'in-mpw'].includes(e.target.id)) { const v = e.target.value.replace(/\D/g, '').slice(0, 4); if (v !== e.target.value) e.target.value = v; } // R-5-01 / R-5-10 ตัวเลข 4 หลัก
    if (e.target.id === 'in-find' && S.modal) S.modal.q = e.target.value;
    if (e.target.id === 'in-rname') S.newRoom.name = e.target.value;
    if (e.target.id === 'in-npw') S.newRoom.pw = e.target.value;
  });
  document.addEventListener('change', async e => {
    const d = e.target.dataset || {};
    if (d.new === 'priv') { S.newRoom.priv = e.target.value === '1'; if (S.newRoom.priv && !S.newRoom.pw) S.newRoom.pw = randPw(); return render(); }
    if (d.meta) { // R-5-10 host แก้ชื่อห้อง / ส่วนตัว / รหัสผ่าน
      const rm = S.st.room || {}; let meta;
      if (d.meta === 'name') meta = { name: e.target.value };
      else if (d.meta === 'private') meta = e.target.value === '1' ? { private: true, password: rm.password || randPw() } : { private: false };
      else { if (!/^[0-9]{4}$/.test(e.target.value)) { toast('รหัสผ่านต้องเป็นตัวเลข 4 หลัก'); return render(); } meta = { password: e.target.value }; }
      const r = await act('room_meta', { meta }); if (!r.ok) render(); return;
    }
    const k = d.set; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    await act('update_settings', { settings: { [k]: v } });
  });
  const randPw = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  function saveSession(s) { S.session = s; ss.set('bw_session', s); store.set('bw_session', s); }
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    if (S.dragEndAt && Date.now() - S.dragEndAt < 400 && el.dataset.act === 'place') return; // คลิกที่ตามหลังการลาก
    const a = el.dataset.act; const r = +el.dataset.r, c = +el.dataset.c;
    if (!['place', 'rot', 'chat-send', 'snd-fx', 'confirm'].includes(a)) SFX.play('click');
    switch (a) {
      case 'snd-fx': SFX.setPref('fx', !SFX.pref('fx')); if (SFX.pref('fx')) SFX.play('click'); return render();
      case 'snd-bgm': SFX.setPref('bgm', !SFX.pref('bgm')); return render();
      case 'chat-open': S.sheet = S.sheet === 'chat' ? null : 'chat'; S.chat.unread = 0; renderSheet(); updateBadge(); return;
      case 'voice-open': S.sheet = S.sheet === 'voice' ? null : 'voice'; renderSheet(); return;
      case 'sheet-close': S.sheet = null; renderSheet(); return;
      case 'chat-send': return sendChat();
      case 'chat-hide': { const pid = el.dataset.pid; if (S.chat.hidden.has(pid)) S.chat.hidden.delete(pid); else S.chat.hidden.add(pid); renderSheet(); return; }
      case 'voice-join': { const r = await VOICE.join(); if (r && !r.ok && r.error) toast(r.error); return; }
      case 'voice-leave': await VOICE.leave(); return;
      case 'voice-mic': VOICE.toggleMic(); return;
      case 'voice-mute': VOICE.toggleMute(el.dataset.pid); return;
      case 'age-ok': S.ageOk = true; store.set('bw_age_ok', true); return render();
      case 'age-no': location.href = 'about:blank'; return;
      case 'create-open': if (!(S.name || '').trim()) { toast('ใส่ชื่อของคุณก่อน'); return; } S.createOpen = true; return render();
      case 'create-cancel': S.createOpen = false; return render();
      case 'create': {
        const name = (($('#in-name') || {}).value || '').trim();
        if (!name) return toast('ใส่ชื่อของคุณก่อน');
        const nr = S.newRoom;
        if (nr.priv && !/^[0-9]{4}$/.test(nr.pw)) return toast('รหัสผ่านต้องเป็นตัวเลข 4 หลัก');
        el.disabled = true;
        const res = await emit('create', { name, roomName: nr.name.trim() || undefined, private: nr.priv, password: nr.priv ? nr.pw : undefined });
        el.disabled = false;
        if (res.ok) { S.createOpen = false; S.newRoom = { name: '', priv: false, pw: '' }; saveSession({ code: res.code, playerId: res.pid, token: res.token }); S.lost = null; S.listOn = false; history.replaceState(null, '', '/'); }
        return;
      }
      case 'join-room': {
        const code = el.dataset.code;
        if (el.dataset.priv === '1' && !el.dataset.pw) { if (!(($('#in-name') || {}).value || S.name || '').trim()) { toast('ใส่ชื่อของคุณก่อน'); return; } S.modal = { type: 'pw', code }; return render(); }
        return joinRoom(code, el.dataset.pw, el);
      }
      case 'pw-go': { const pw = (($('#in-pw') || {}).value || ''); if (!/^[0-9]{4}$/.test(pw)) return toast('รหัสผ่านต้องเป็นตัวเลข 4 หลัก'); return joinRoom(el.dataset.code, pw, el); }
      case 'find-open': S.modal = { type: 'find', q: '' }; return render();
      case 'find-go': { // R-5-13
        const q = (($('#in-find') || {}).value || '');
        if (q.length !== 4) return toast('ใส่รหัสห้อง 4 หลัก');
        const r = await emit('find_room', { code: q });
        if (S.modal && S.modal.type === 'find') { S.modal = { type: 'find', q, room: r.ok ? r.room : null, none: !r.ok }; render(); }
        return;
      }
      case 'copy': try { await navigator.clipboard.writeText(el.dataset.link); toast('คัดลอกลิงก์แล้ว'); } catch (x) { toast(el.dataset.link); } return;
      case 'share':
        if (navigator.share) { try { await navigator.share({ title: 'Battle Weed', text: 'มาเล่น Battle Weed กัน', url: el.dataset.link }); } catch (x) { /* ยกเลิก */ } }
        else { try { await navigator.clipboard.writeText(el.dataset.link); toast('คัดลอกลิงก์แล้ว'); } catch (x) { toast(el.dataset.link); } }
        return;
      case 'start': await act('start_game'); return;
      case 'pick': { S.islMode = false; const id = el.dataset.id; if (S.draft[id]) S.sel = S.sel === id ? null : id; else { S.pick = id; S.sel = null; } return render(); }
      case 'rot': return rotateSel();
      case 'unplace': return removeSel();
      case 'desel': S.sel = null; return render();
      case 'islmode': S.islMode = !S.islMode; return render();
      case 'place': return placeAt(r, c);
      case 'suggest': {
        const res = await act('suggest_placement');
        if (res.ok && res.placement) {
          S.draft = {}; for (const p of res.placement) S.draft[p.pieceId] = { row: p.row, col: p.col, rot: p.rot };
          if (res.islands) S.isl = new Set(res.islands.map(([y, x]) => kk(y, x)));
          S.sel = null; S.pick = null; S.islMode = false; render();
        }
        return;
      }
      case 'confirm': {
        SFX.play('ready');
        const placement = Object.entries(S.draft).map(([id, v]) => ({ pieceId: id, row: v.row, col: v.col, rot: v.rot }));
        const extra = { placement };
        if (S.st.settings.islands === 'draw') extra.islands = [...S.isl].map(k => [Math.floor(k / 100), k % 100]);
        el.disabled = true; await act('submit_placement', extra); return;
      }
      case 'tab': S.tab = el.dataset.id; return render();
      case 'aim': {
        const board = S.st.settings.mode === 'classic' ? S.tab : '*';
        const i = S.aim.findIndex(x => x.board === board && x.row === r && x.col === c);
        if (i >= 0) S.aim.splice(i, 1);
        else { if (S.aim.length >= needShots()) S.aim.shift(); S.aim.push({ board, row: r, col: c }); }
        syncAim();
        return render();
      }
      case 'dbl': S.dbl = el.dataset.v; syncAim(); return render();
      case 'fire': {
        const shots = aimShots();
        el.disabled = true; clearTimeout(syncAim.t);
        const res = await act('fire', { turnNo: S.st.turnNo, shots });
        if (res.ok) S.aim = [];
        return render();
      }
      case 'zoom': S.zoom = Math.min(3, Math.max(1, S.zoom + (+el.dataset.v) * 0.5)); return render();
      case 'sumtoggle': S.sumOpen = !S.sumOpen; return render();
      case 'resign': S.modal = { type: 'resign' }; return render();
      case 'resign-yes': S.modal = null; await act('resign'); return render();
      case 'close': S.modal = null; return render();
      case 'rematch': await act('rematch', { want: true }); return;
      case 'lobby': await act('back_to_lobby'); return;
      case 'leave': await emit('leave', {}); try { VOICE.reset(); } catch (x) { /* */ } S.sheet = null; S.chat.log = []; S.chat.unread = 0; dropSession(); return;
      case 'take-back': S.replaced = false; socket.connect(); return;
      case 'install': // R-10-01
        if (installKind() === 'prompt') { const ev = S.installEvt; S.installEvt = null; ev.prompt(); try { await ev.userChoice; } catch (x) { /* */ } return render(); }
        S.modal = { type: 'install' }; return render();
    }
  });

  // ---------- ซูมสองนิ้วบนกระดาน + M1 กันหน้าเด้ง ----------
  let pinch = null;
  document.addEventListener('touchstart', e => {
    const w = e.target.closest && e.target.closest('.bwrap');
    if (w && e.touches.length === 2) {
      const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: S.zoom };
    }
    const t = e.touches[0]; touch0 = t ? [t.clientX, t.clientY] : null;
  }, { passive: true });
  let touch0 = null;
  function scrollableParent(el, dx, dy) {
    for (; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (Math.abs(dx) > Math.abs(dy) && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth) return true;
      if (Math.abs(dy) >= Math.abs(dx) && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return true;
    }
    return false;
  }
  document.addEventListener('touchmove', e => {
    if (S.drag && e.touches.length === 1) { const t = e.touches[0]; if (dragMove(t.clientX, t.clientY)) { e.preventDefault(); return; } }
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const z = Math.min(3, Math.max(1, Math.round(pinch.z * d / pinch.d * 4) / 4));
      if (z !== S.zoom) { S.zoom = z; render(); }
      return;
    }
    if (e.touches.length > 1) { e.preventDefault(); return; }
    if (document.documentElement.scrollHeight > window.innerHeight + 1) return;
    const t = e.touches[0]; if (!t || !touch0) return;
    if (!scrollableParent(e.target, t.clientX - touch0[0], t.clientY - touch0[1])) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });
  window.addEventListener('resize', () => { clearTimeout(render.rt); render.rt = setTimeout(render, 150); });


  // ---------- v2.4 เสียง / แชท / เสียงสด ----------
  // R-10-09 เสียงตามสถานะ (ตอนยิงอยู่ใน onResolve) · R-10-10 BGM ตาม phase
  function stateSounds(st, prev) {
    SFX.bgm(st.phase === 'PLACING' ? 'place' : st.phase === 'BATTLE' ? 'battle' : null);
    if (!S.seen || !prev || prev.code !== st.code) return;      // เพิ่งเปิดหน้า / เข้าห้องใหม่ ไม่เล่นย้อนหลัง
    const cnt = x => x.players.filter(p => !p.removed).length;
    if (st.phase === 'LOBBY' && prev.phase === 'LOBBY') { if (cnt(st) > cnt(prev)) SFX.play('popUp'); else if (cnt(st) < cnt(prev)) SFX.play('popDown'); }
    if (prev.phase !== 'PLACING' && st.phase === 'PLACING') SFX.play('start');
    if (prev.phase !== 'GAME_OVER' && st.phase === 'GAME_OVER') {
      const r = st.result || {};
      SFX.play(r.winnerPid === st.you ? 'win' : (r.winnerPid ? 'elim' : 'draw'));
    }
  }
  function dockHTML(inRoom) {
    const fx = SFX.pref('fx'), bg = SFX.pref('bgm');
    const vc = S.st && S.st.voice ? S.st.voice.length : 0;
    const sp = VOICE.speaking.size > 0;
    return `<div class="dock" role="toolbar" aria-label="เสียงและการคุย">
      <button class="dockbtn ${fx ? '' : 'off'}" data-act="snd-fx" aria-pressed="${fx}" aria-label="เสียงเอฟเฟกต์ ${fx ? 'เปิดอยู่' : 'ปิดอยู่'}">${fx ? '🔊' : '🔇'}</button>
      <button class="dockbtn ${bg ? '' : 'off'}" data-act="snd-bgm" aria-pressed="${bg}" aria-label="ดนตรีประกอบ ${bg ? 'เปิดอยู่' : 'ปิดอยู่'}">🎵</button>
      ${inRoom ? `<button class="dockbtn" data-act="chat-open" aria-label="แชท">💬<b class="badge" ${S.chat.unread ? '' : 'hidden'}>${S.chat.unread}</b></button>` : ''}
      ${inRoom && VOICE.supported ? `<button class="dockbtn ${VOICE.joined ? 'live' : ''} ${sp ? 'speak' : ''}" data-act="voice-open" aria-label="เสียงสด">🎙${vc ? `<b class="badge vc">${vc}</b>` : ''}</button>` : ''}
    </div>`;
  }
  function updateBadge() {
    const b = document.querySelector('.dockbtn[data-act="chat-open"] .badge'); if (!b) return;
    b.textContent = S.chat.unread; b.hidden = !S.chat.unread;
  }
  const chatLine = m => `<div class="cm${S.st && m.pid === S.st.you ? ' mine' : ''}" data-pid="${esc(m.pid)}"><button class="cn" data-act="chat-hide" data-pid="${esc(m.pid)}" style="color:${esc(m.color)}" title="แตะเพื่อซ่อน/แสดงข้อความของคนนี้">${esc(m.name)}</button><span class="ct">${esc(m.text)}</span></div>`;
  function addChat(m, live) {
    if (!m || typeof m.text !== 'string') return;
    S.chat.log.push(m); if (S.chat.log.length > 50) S.chat.log.shift();
    if (!live) return;
    const mine = S.st && m.pid === S.st.you;
    if (S.sheet === 'chat') {
      const list = $('#chatlist');
      if (list && !S.chat.hidden.has(m.pid)) { const ph = list.querySelector('p'); if (ph) ph.remove(); list.insertAdjacentHTML('beforeend', chatLine(m)); list.scrollTop = list.scrollHeight; }
    } else if (!mine && !S.chat.hidden.has(m.pid)) {
      S.chat.unread++; updateBadge();
      note(`${m.name}: ${m.text}`, 'chat');                     // ข้อความใหม่ลอยดูสั้น ๆ เมื่อกล่องปิด
    }
    if (!mine && !S.chat.hidden.has(m.pid)) SFX.play('chat');
  }
  async function sendChat() {
    const inp = $('#in-chat'); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    const r = await act('chat', { text });
    if (r.ok) { inp.value = ''; S.chat.draft = ''; }
    inp.focus();
  }
  function voiceBody() {
    if (!VOICE.supported) return '<p class="muted">เบราว์เซอร์นี้ไม่รองรับเสียงสด</p>';
    const st = S.st; const inV = (st.voice || []);
    const rows = inV.map(pid => {
      const p = pl(pid); if (!p) return '';
      const self = pid === st.you; const sp = VOICE.speaking.has(pid); const c = VOICE.conn.get(pid);
      const stat = self ? (VOICE.mic ? 'ไมค์เปิด' : 'ไมค์ปิด') : (VOICE.muted.has(pid) ? 'ปิดเสียงคนนี้' : (c === 'connected' ? 'ต่อแล้ว' : c === 'failed' ? 'ต่อไม่ได้' : 'กำลังต่อ…'));
      return `<div class="vrow ${sp ? 'speak' : ''}"><span>${dot(p)}${esc(p.name)}${self ? ' (คุณ)' : ''}</span><span class="muted">${stat}</span>
        ${self || !VOICE.joined ? '' : `<button class="btn ghost small" data-act="voice-mute" data-pid="${esc(pid)}">${VOICE.muted.has(pid) ? 'เปิดเสียง' : 'ปิดเสียง'}</button>`}</div>`;
    }).join('') || '<p class="muted">ยังไม่มีใครเข้าร่วมเสียง</p>';
    const ctl = VOICE.joined
      ? `<div class="row"><button class="btn ${VOICE.mic ? 'fire' : ''}" data-act="voice-mic" ${VOICE.hasMic ? '' : 'disabled'}>${VOICE.mic ? '🎤 ปิดไมค์' : '🎤 เปิดไมค์พูด'}</button><button class="btn ghost" data-act="voice-leave">ออกจากเสียง</button></div>
         ${VOICE.err === 'mic' ? '<div class="warn">ไม่ได้รับอนุญาตใช้ไมค์ — ฟังอย่างเดียวได้ ถ้าอยากพูดให้อนุญาตไมค์ในเบราว์เซอร์แล้วเข้าร่วมใหม่</div>' : ''}`
      : `<button class="btn" data-act="voice-join" ${VOICE.busy ? 'disabled' : ''}>${VOICE.busy ? 'กำลังเชื่อมต่อ…' : '🎙 เข้าร่วมเสียง (ไมค์ปิดไว้ก่อน)'}</button>`;
    return `${ctl}<div class="vlist">${rows}</div><p class="muted small">เสียงเชื่อมตรงระหว่างผู้เล่น ไม่ผ่านเซิร์ฟเวอร์ · บางเครือข่ายอาจต่อกันไม่ติด · ใส่หูฟังจะไม่มีเสียงสะท้อน</p>`;
  }
  function renderSheet() {
    const el = $('#sheet'); if (!el) return;
    if (!S.sheet || !S.st || !S.session) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    if (S.sheet === 'chat') {
      const lines = S.chat.log.filter(m => !S.chat.hidden.has(m.pid)).map(chatLine).join('');
      el.innerHTML = `<section class="sheetbox" role="dialog" aria-label="แชท"><div class="row head"><h2>💬 แชทในห้อง</h2><button class="btn ghost small" data-act="sheet-close">ปิด</button></div>
        <div id="chatlist" class="chatlist">${lines || '<p class="muted center">ยังไม่มีข้อความ</p>'}</div>
        <div class="row nowrap"><input id="in-chat" maxlength="${(S.st.config && S.st.config.CHAT_MAX) || 100}" autocomplete="off" placeholder="พิมพ์ข้อความ…" value="${esc(S.chat.draft || '')}"><button class="btn small" data-act="chat-send">ส่ง</button></div>
        <p class="muted small">แตะชื่อคนเพื่อซ่อน/แสดงข้อความของคนนั้นเฉพาะในเครื่องคุณ · ข้อความไม่ถูกเก็บถาวร</p></section>`;
      const list = $('#chatlist'); if (list) list.scrollTop = list.scrollHeight;
    } else {
      el.innerHTML = `<section class="sheetbox" role="dialog" aria-label="เสียงสด"><div class="row head"><h2>🎙 เสียงสด</h2><button class="btn ghost small" data-act="sheet-close">ปิด</button></div><div id="voicebody" class="vbody">${voiceBody()}</div></section>`;
    }
  }
  function refreshSheet() { if (S.sheet === 'voice') { const b = $('#voicebody'); if (b) b.innerHTML = voiceBody(); else renderSheet(); } }
  VOICE.init({ socket, act });
  VOICE.onChange = () => {
    const b = document.querySelector('.dockbtn[data-act="voice-open"]');
    if (b) { b.classList.toggle('speak', VOICE.speaking.size > 0); b.classList.toggle('live', VOICE.joined); }
    refreshSheet();
  };
  document.addEventListener('input', e => { if (e.target.id === 'in-chat') S.chat.draft = e.target.value; });
  document.addEventListener('keydown', e => { if (e.target.id === 'in-chat' && e.key === 'Enter') { e.preventDefault(); sendChat(); } });

  // ---------- M2: ติดตั้งเป็นแอป ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  window.addEventListener('appinstalled', () => { S.installEvt = null; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  render();
})();
