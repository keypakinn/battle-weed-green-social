/* Battle Weed: Green Social v2 — หน้าเว็บ (render ทั้งหน้าจาก state เดียว) */
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
    st: null, offset: 0, recvAt: 0,
    name: store.get('bw_name') || '', code: (qs.get('room') || '').toUpperCase().slice(0, 10),
    // วาง
    draft: {}, sel: null, rot: 0, placingGame: 0, islMode: false, isl: new Set(),
    // ยิง
    aim: [], dbl: 'H', tab: null, zoom: 1, sumOpen: false,
    // แอนิเมชัน
    anim: new Map(), reveal: new Map(), lastResolveKey: null, seen: false,
    modal: null, replaced: false, lost: null, installEvt: null, notes: [],
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
  const artURL = id => `/cards/art/${id}.webp?v=${S.ver}`;
  const absCells = p => rotateCells(piece(p.pieceId).cells, p.rot).map(([r, c]) => [r + p.row, c + p.col]);

  // ---------- socket ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  const net = $('#net');
  socket.on('connect', () => { net.hidden = true; if (S.session && !S.replaced) resume(); });
  socket.on('disconnect', reason => { if (reason !== 'io server disconnect') net.hidden = false; });
  socket.on('replaced', () => { S.replaced = true; render(); });
  socket.on('state', st => {
    const prev = S.st;
    S.st = st; S.recvAt = Date.now(); S.offset = st.serverNow - Date.now();
    if (st.phase === 'PLACING' && S.placingGame !== st.gameNo) resetDraft(st.gameNo);
    if (st.phase !== 'BATTLE' || !prev || prev.turnNo !== st.turnNo) S.aim = [];
    if (st.phase === 'BATTLE' && !S.tab) S.tab = null;
    onResolve(st, prev);
    S.seen = true;
    render();
  });
  socket.on('notice', list => { for (const n of list) note(n.text, n.kind); });
  function resume() {
    socket.emit('resume', { code: S.session.code, token: S.session.token }, r => {
      if (!r || !r.ok) { S.lost = r && r.error ? r.error : 'การเชื่อมต่อหาย กรุณาสร้างห้องใหม่'; dropSession(); }
    });
  }
  function dropSession() { S.session = null; S.st = null; ss.del('bw_session'); store.del('bw_session'); render(); }
  function emit(ev, payload) {
    return new Promise(res => socket.emit(ev, payload, r => {
      if (!r || !r.ok) {
        const quiet = ['STALE_TURN', 'BAD_PHASE', 'ALREADY_PLACED', 'OUT_OF_BOUNDS', 'BAD_REQUEST', 'NOT_HOST', 'SHOT_COUNT', 'ALREADY_SUBMITTED'];
        if (r && !quiet.includes(r.code)) toast(r.error || 'ทำไม่สำเร็จ');
        if (r && (r.code === 'ROOM_NOT_FOUND' || r.code === 'BAD_TOKEN')) dropSession();
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
  const STATE_SVG = {
    miss: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="15" r="5" fill="#9AA79E" opacity=".55"/><circle cx="15" cy="10" r="4" fill="#9AA79E" opacity=".45"/><circle cx="18" cy="5" r="2.5" fill="#9AA79E" opacity=".35"/></svg>',
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

  // ---------- วาง ----------
  function resetDraft(gameNo) {
    S.placingGame = gameNo; S.draft = {}; S.rot = 0; S.islMode = false; S.isl = new Set();
    S.sel = S.st.fleet[0] || null; S.aim = []; S.tab = null; S.anim.clear(); S.reveal.clear();
  }
  function draftCells(except) {
    const m = new Map();
    for (const [id, v] of Object.entries(S.draft)) if (id !== except) for (const [r, c] of absCells({ pieceId: id, ...v })) m.set(kk(r, c), id);
    return m;
  }
  function fits(id, row, col, rot) {
    const taken = draftCells(id);
    for (const [r, c] of absCells({ pieceId: id, row, col, rot })) {
      if (r < 0 || c < 0 || r >= B() || c >= B()) return 'BOUNDS';
      if (taken.has(kk(r, c))) return 'OVERLAP';
    }
    return null;
  }
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
    if (here) { S.sel = here; S.rot = S.draft[here].rot; delete S.draft[here]; return render(); }
    if (!S.sel) S.sel = nextUnplaced();
    if (!S.sel) return toast('วางครบแล้ว แตะชิ้นบนกระดานเพื่อย้าย');
    const bad = fits(S.sel, r, c, S.rot);
    if (bad) return toast(bad === 'BOUNDS' ? 'ล้นออกนอกกระดาน ลองหมุนหรือขยับ' : 'ทับกับชิ้นของคุณเอง');
    S.draft[S.sel] = { row: r, col: c, rot: S.rot };
    S.sel = nextUnplaced(); S.rot = 0;
    render();
  }
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
    const w = Math.min(document.documentElement.clientWidth, 560) - 24 - 16;
    return Math.max(14, Math.floor(w / nCols)) * S.zoom;
  }
  // layers: { board, cells: Map(k->state), clickable(r,c,state)->bool, marks: Map(k->cls), pieces:[{pieceId,row,col,rot,cls}], outlines:[{cells,color,pieceId,owner}], islands:Set(k), traps:Set(k) }
  function boardHTML(o) {
    const n = B(); const cs = cellSize(n + 1);
    let h = `<div class="bwrap" data-zoomable="1"><div class="board" data-board="${esc(o.board)}" style="--n:${n};--cs:${cs}px">`;
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
        else if (!inner) cls.push('s-unshot');
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
    h += `<div class="layer" style="left:${cs}px;top:${cs}px">`;
    for (const p of o.pieces || []) h += pieceImg(p, cs);
    for (const ol of o.outlines || []) h += outlineHTML(ol, cs);
    h += `</div></div></div>`;
    return h;
  }
  function pieceImg(p, cs) { // ภาพชิ้นตาม fit.json (หมุนได้ ไม่กลับด้าน)
    const f = S.fit[p.pieceId];
    const pc = piece(p.pieceId);
    const rows = f ? f.rows : Math.max(...pc.cells.map(x => x[0])) + 1, cols = f ? f.cols : Math.max(...pc.cells.map(x => x[1])) + 1;
    const odd = p.rot % 2 === 1;
    const W = (odd ? rows : cols) * cs, H = (odd ? cols : rows) * cs;
    const inner = f ? `<img src="${artURL(p.pieceId)}" alt="" style="left:${f.x * cs}px;top:${f.y * cs}px;width:${f.w * cs}px;height:${f.h * cs}px" onerror="this.remove()">`
      : `<span class="pname">${esc(pc.name)}</span>`;
    return `<div class="pimg ${p.cls || ''}" style="left:${p.col * cs}px;top:${p.row * cs}px;width:${W}px;height:${H}px">
      <div class="prot" style="width:${cols * cs}px;height:${rows * cs}px;left:${(W - cols * cs) / 2}px;top:${(H - rows * cs) / 2}px;transform:rotate(${p.rot * 90}deg)">${inner}</div></div>`;
  }
  function outlineHTML(ol, cs) { // R-10-03 เส้นขอบสีเจ้าของ + ภาพย่อ
    const set = new Set(ol.cells.map(([r, c]) => kk(r, c)));
    let h = '';
    for (const [r, c] of ol.cells) {
      const sides = [];
      if (!set.has(kk(r - 1, c))) sides.push('border-top'); if (!set.has(kk(r + 1, c))) sides.push('border-bottom');
      if (!set.has(kk(r, c - 1))) sides.push('border-left'); if (!set.has(kk(r, c + 1))) sides.push('border-right');
      h += `<div class="oline" style="left:${c * cs}px;top:${r * cs}px;width:${cs}px;height:${cs}px;${sides.map(s => `${s}:3px solid ${ol.color}`).join(';')}"></div>`;
    }
    return h;
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
    const scroll = [...document.querySelectorAll('.bwrap')].map(el => [el.scrollLeft, el.scrollTop]);
    const focusId = document.activeElement && document.activeElement.id;
    let html;
    if (!S.ageOk) html = viewAge();
    else if (S.replaced) html = viewReplaced();
    else if (!S.st || !S.session) html = viewHome();
    else if (!S.cat.size) html = '<p class="muted">กำลังโหลด…</p>';
    else html = ({ LOBBY: viewLobby, PLACING: viewPlacing, BATTLE: viewBattle, GAME_OVER: viewOver })[S.st.phase]();
    if (S.modal) html += viewModal();
    app.innerHTML = html;
    document.querySelectorAll('.bwrap').forEach((el, i) => { if (scroll[i]) { el.scrollLeft = scroll[i][0]; el.scrollTop = scroll[i][1]; } });
    if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); if (f.setSelectionRange) { const v = f.value; f.setSelectionRange(v.length, v.length); } } }
    updateTimer();
  }

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
  function viewHome() {
    return `<div class="stripe"></div><div class="brand"><img class="logo" src="/icons/icon-192.png" alt=""><h1>Battle Weed: Green Social</h1></div>
      <p class="muted">ซ่อนอุปกรณ์สายเขียวบนกระดาน แล้วยิงหาของเพื่อน ใครเหลือรอดคนสุดท้ายชนะ เล่นได้ 2–7 คน</p>
      ${S.lost ? `<div class="warn">${esc(S.lost)}</div>` : ''}
      <section class="panel">
        <label for="in-name">ชื่อของคุณ</label>
        <input id="in-name" maxlength="16" autocomplete="nickname" value="${esc(S.name)}" placeholder="เช่น เอ">
        ${S.code ? `<label for="in-code">รหัสห้อง</label><input id="in-code" maxlength="10" autocapitalize="characters" value="${esc(S.code)}">
          <button class="btn" data-act="join">เข้าห้อง ${esc(S.code)}</button><button class="btn ghost" data-act="create">สร้างห้องใหม่แทน</button>`
        : `<button class="btn" data-act="create">สร้างห้อง</button>
          <label for="in-code">หรือใส่รหัสห้องของเพื่อน</label><input id="in-code" maxlength="10" autocapitalize="characters" value="" placeholder="เช่น K7MPQ">
          <button class="btn ghost" data-act="join">เข้าห้อง</button>`}
      </section>
      ${standalone() ? '' : '<button class="btn ghost install-btn" data-act="install">📲 เพิ่มไปหน้าจอโฮม</button>'}`;
  }
  function header(extra) {
    return `<div class="row head"><h2>ห้อง ${esc(S.st.code)}</h2>${extra || ''}</div>`;
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
  function viewLobby() {
    const link = `${location.origin}/?room=${S.st.code}`;
    const n = S.st.players.filter(p => !p.removed && p.connected).length;
    return `${header('<button class="btn ghost small" data-act="leave">ออก</button>')}
      <section class="panel center"><p class="muted">ส่งรหัสหรือลิงก์ให้เพื่อน (2–7 คน)</p>
        <div class="code">${esc(S.st.code)}</div>
        <div class="row wide"><button class="btn" data-act="share" data-link="${esc(link)}">แชร์ลิงก์</button><button class="btn ghost" data-act="copy" data-link="${esc(link)}">คัดลอก</button></div></section>
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
      const p = piece(id); const cls = ['tpiece']; if (S.sel === id && !S.islMode) cls.push('sel'); if (S.draft[id]) cls.push('placed');
      return `<button class="${cls.join(' ')}" data-act="pick" data-id="${esc(id)}"><img src="${artURL(id)}" alt="" onerror="this.remove()"><span>${esc(p.name)} ${p.cells.length}</span></button>`;
    }).join('')}</div>`;
  }
  function viewPlacing() {
    const m = me();
    const myIsl = new Set((m.islands || []).flat().map(([r, c]) => kk(r, c)));
    const others = S.st.players.filter(p => !p.removed && p.pid !== m.pid);
    const readyTxt = others.map(p => `${dot(p)}${esc(p.name)} ${p.ready ? '✓' : '…'}`).join(' · ');
    if (m.ready || !m.alive) {
      return `${header(timerHTML())}<div class="status"><span>${m.alive ? 'วางเสร็จแล้ว รอคนอื่น…' : 'คุณออกจากเกมนี้แล้ว'}</span></div>
        <div class="muted">${readyTxt}</div>${warnHTML()}
        ${boardHTML({ board: 'me', islands: myIsl, pieces: (m.placement || []).map(p => ({ ...p, cls: 'mine' })) })}
        ${m.alive ? '<button class="btn danger" data-act="resign">ยอมแพ้</button>' : ''}`;
    }
    const draw = S.st.settings.islands === 'draw';
    const islSet = draw ? S.isl : myIsl;
    const placed = Object.entries(S.draft).map(([id, v]) => ({ pieceId: id, ...v, cls: 'mine' }));
    const marks = new Map();
    for (const k of draftCells().keys()) marks.set(k, 'placed');
    if (S.sel && !S.islMode) for (let r = 0; r < B(); r++) for (let c = 0; c < B(); c++) if (fits(S.sel, r, c, S.rot)) marks.set(kk(r, c), 'nostart');
    const all = S.st.fleet.every(id => S.draft[id]);
    const islOk = !draw || islGroupsOk();
    const sp = S.sel ? piece(S.sel) : null;
    return `${header(timerHTML())}
      <div class="status"><span>${S.islMode ? `วาดเกาะ <b>${S.isl.size}/${S.st.config.ISLAND_CELLS}</b> ช่อง (เกาะละ ≥ ${S.st.config.ISLAND_MIN_GROUP} ช่องติดกัน)`
        : sp ? `วาง <b>${esc(sp.name)}</b>` : 'วางครบแล้ว'}</span>
        ${S.islMode ? '' : '<button class="btn ghost small" data-act="rot">หมุน ⟳</button>'}</div>
      <div class="muted">${readyTxt}</div>${warnHTML()}
      ${boardHTML({ board: 'me', islands: islSet, marks, pieces: placed, clickable: () => 'place' })}
      <div class="legend"><span>แตะช่อง = มุมซ้ายบนของชิ้น · แตะชิ้นบนกระดาน = ยกกลับ · ช่องแดง = เริ่มตรงนั้นไม่ได้</span>${S.st.settings.mode === 'survival' ? '<span>Survival: ของคนอื่นอาจทับช่องเดียวกับคุณได้ (มองไม่เห็น)</span>' : ''}</div>
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
        const sl = sunkLayers([m]);
        boardBlock = `<div class="tabs">${tabs}</div>${boardHTML({ board: m.pid, cells: cellsMap(m.pid), islands: new Set((m.islands || []).flat().map(([r, c]) => kk(r, c))),
          pieces: [...(m.placement || []).filter(p => !m.sunk.some(s => s.pieceId === p.pieceId)).map(p => ({ ...p, cls: 'mine' })), ...sl.pieces], outlines: sl.outlines, sunkCells: sl.cells })}`;
      } else {
        const o = pl(S.tab); const sl = sunkLayers([o]);
        boardBlock = `<div class="tabs">${tabs}</div>${boardHTML({ board: o.pid, cells: cellsMap(o.pid), marks, pieces: sl.pieces, outlines: sl.outlines, sunkCells: sl.cells,
          clickable: (r, c, s) => (myTurn && !s ? 'aim' : null) })}`;
      }
    } else {
      const sl = sunkLayers(st.players);
      const mySunk = new Set(m.sunk.map(s => s.pieceId));
      boardBlock = boardHTML({ board: '*', cells: cellsMap('*'), marks, islands: new Set((m.islands || []).flat().map(([r, c]) => kk(r, c))),
        pieces: [...(m.placement || []).filter(p => !mySunk.has(p.pieceId)).map(p => ({ ...p, cls: 'mine' })), ...sl.pieces], outlines: sl.outlines, sunkCells: sl.cells,
        clickable: (r, c, s) => (myTurn && !s ? 'aim' : null) });
    }
    const n = needShots();
    const dblCtl = myTurn && m.doubleBonus ? `<div class="row"><span class="muted">นัดคู่แนว</span><button class="btn ghost small ${S.dbl === 'H' ? 'on' : ''}" data-act="dbl" data-v="H">นอน ↔</button><button class="btn ghost small ${S.dbl === 'V' ? 'on' : ''}" data-act="dbl" data-v="V">ตั้ง ↕</button></div>` : '';
    const fireBtn = myTurn ? `<button class="btn fire" data-act="fire" ${S.aim.length === n ? '' : 'disabled'}>ยิง! (${S.aim.length}/${n})</button>` : '';
    return `${header(timerHTML())}
      <div class="status"><span>${status}</span><span class="zoomctl"><button class="btn ghost small" data-act="zoom" data-v="-1" aria-label="ย่อ">−</button><button class="btn ghost small" data-act="zoom" data-v="1" aria-label="ขยาย">+</button></span></div>
      ${m.autoStreak && m.alive ? `<div class="warn">ระบบยิงแทนคุณ ${m.autoStreak} ครั้งติดกันแล้ว ครบ 3 ครั้งจะตกรอบ</div>` : ''}
      ${warnHTML()}${summaryHTML()}
      ${boardBlock}
      ${dblCtl}${fireBtn}
      <div class="legend">${['miss', 'hit', 'island', 'trap'].map(s => `<span>${STATE_SVG[s]} ${LABEL[s]}</span>`).join('')}</div>
      ${m.alive ? '<button class="btn danger" data-act="resign">ยอมแพ้</button>' : '<button class="btn ghost" data-act="leave">ออกจากห้อง</button>'}`;
  }

  // ---------- จบเกม ----------
  const REASON = { last_standing: 'เหลือรอดคนสุดท้าย', draw: 'ตกรอบพร้อมกันหมด', tiebreak_hits: 'ตกรอบพร้อมกัน ตัดสินด้วยจำนวนนัดที่ยิงโดนของคนอื่น', cancelled: 'ทุกคนหลุดหรือออก เกมถูกยกเลิก' };
  function viewOver() {
    const m = me(), res = S.st.result || {};
    const w = res.winnerPid && pl(res.winnerPid);
    const title = !res.winnerPid ? (res.reason === 'draw' ? 'เสมอ!' : 'เกมถูกยกเลิก') : res.winnerPid === m.pid ? 'คุณชนะ!' : `${esc(w ? w.name : '')} ชนะ`;
    const rk = Object.fromEntries((res.ranking || []).map(r => [r.pid, r.rank]));
    const rows = S.st.players.filter(p => p.pid in rk).sort((a, b) => rk[a.pid] - rk[b.pid]).map(p => {
      const s = p.stats || { shots: 0, hits: 0, hitsOnOthers: 0 };
      return `<tr><td>${rk[p.pid]}</td><th>${dot(p)}${esc(p.name)}${p.pid === m.pid ? ' (คุณ)' : ''}</th><td>${s.shots}</td><td>${s.shots ? Math.round(s.hits / s.shots * 100) : 0}%</td><td>${s.hitsOnOthers}</td></tr>`;
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
    document.querySelectorAll('.grace').forEach(g => { const n = g.querySelector('.graceN'); if (n) n.textContent = Math.max(0, +g.dataset.base - Math.floor((Date.now() - S.recvAt) / 1000)); });
  }
  setInterval(updateTimer, 250);

  // ---------- คลิก ----------
  document.addEventListener('input', e => {
    if (e.target.id === 'in-name') { S.name = e.target.value; store.set('bw_name', S.name); }
    if (e.target.id === 'in-code') S.code = e.target.value.toUpperCase();
  });
  document.addEventListener('change', async e => {
    const k = e.target.dataset && e.target.dataset.set; if (!k) return;
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    await act('update_settings', { settings: { [k]: v } });
  });
  function saveSession(s) { S.session = s; ss.set('bw_session', s); store.set('bw_session', s); }
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act; const r = +el.dataset.r, c = +el.dataset.c;
    switch (a) {
      case 'age-ok': S.ageOk = true; store.set('bw_age_ok', true); return render();
      case 'age-no': location.href = 'about:blank'; return;
      case 'create': case 'join': {
        const name = ($('#in-name') || {}).value || '';
        const code = (($('#in-code') || {}).value || '').trim().toUpperCase();
        if (a === 'join' && !code) return toast('ใส่รหัสห้องก่อน');
        el.disabled = true;
        const res = await emit(a, a === 'join' ? { code, name } : { name });
        el.disabled = false;
        if (res.ok) { saveSession({ code: res.code, playerId: res.pid, token: res.token }); S.lost = null; history.replaceState(null, '', '/'); }
        return;
      }
      case 'copy': try { await navigator.clipboard.writeText(el.dataset.link); toast('คัดลอกลิงก์แล้ว'); } catch (x) { toast(el.dataset.link); } return;
      case 'share':
        if (navigator.share) { try { await navigator.share({ title: 'Battle Weed', text: 'มาเล่น Battle Weed กัน', url: el.dataset.link }); } catch (x) { /* ยกเลิก */ } }
        else { try { await navigator.clipboard.writeText(el.dataset.link); toast('คัดลอกลิงก์แล้ว'); } catch (x) { toast(el.dataset.link); } }
        return;
      case 'start': await act('start_game'); return;
      case 'pick': S.islMode = false; S.sel = el.dataset.id; if (S.draft[S.sel]) { S.rot = S.draft[S.sel].rot; delete S.draft[S.sel]; } return render();
      case 'rot': S.rot = (S.rot + 1) % 4; return render();
      case 'islmode': S.islMode = !S.islMode; return render();
      case 'place': return placeAt(r, c);
      case 'suggest': {
        const res = await act('suggest_placement');
        if (res.ok && res.placement) {
          S.draft = {}; for (const p of res.placement) S.draft[p.pieceId] = { row: p.row, col: p.col, rot: p.rot };
          if (res.islands) S.isl = new Set(res.islands.map(([y, x]) => kk(y, x)));
          S.sel = null; S.islMode = false; render();
        }
        return;
      }
      case 'confirm': {
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
        return render();
      }
      case 'dbl': S.dbl = el.dataset.v; return render();
      case 'fire': {
        const m = me();
        const shots = S.aim.map((x, i) => ({ row: x.row, col: x.col, ...(x.board !== '*' ? { board: x.board } : {}), ...(i === 0 && m.doubleBonus ? { double: S.dbl } : {}) }));
        el.disabled = true;
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
      case 'leave': await emit('leave', {}); dropSession(); return;
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

  // ---------- M2: ติดตั้งเป็นแอป ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; });
  window.addEventListener('appinstalled', () => { S.installEvt = null; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  render();
})();
