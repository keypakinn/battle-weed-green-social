/* Battle Weed: Green Social — หน้าเว็บ (render ทั้งหน้าจาก state เดียว) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const app = $('#app');
  const N = 10, ROWS = 'ABCDEFGHIJ';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* โหมดส่วนตัว */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } },
  };
  const qs = new URLSearchParams(location.search);

  const S = {
    ageOk: store.get('bw_age_ok') === true,          // R-5-03
    session: store.get('bw_session'),                 // { code, playerId, token }
    catalog: null, st: null, offset: 0, recvAt: 0,
    name: store.get('bw_name') || '', code: (qs.get('room') || '').toUpperCase().slice(0, 10),
    draft: {}, sel: null, dir: 'H', placingGame: 0,
    modal: null, banner: null, lastShotKey: null, replaced: false, lost: null,
    installEvt: null, iosHintOff: store.get('bw_ios_hint_off') === true,
  };
  let reqSeq = 0;
  const reqId = () => `r${Date.now().toString(36)}${(reqSeq++).toString(36)}`;

  // ---------- การ์ด ----------
  const cardCache = new Map();
  function cardEl(id, mode, n) {
    const k = id + '|' + mode + '|' + n;
    if (!cardCache.has(k)) {
      const c = S.catalog && S.catalog.find(x => x.id === id);
      if (!c) return null;
      cardCache.set(k, CardKit.render(c, { mode }));
    }
    return cardCache.get(k);
  }
  const cardById = id => (S.catalog || []).find(c => c.id === id) || { id, name: id, size: 0 };
  CardKit.load().then(cards => { S.catalog = cards; render(); }).catch(() => toast('โหลดข้อมูลการ์ดไม่ได้'));

  // ---------- socket ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  const net = $('#net');
  socket.on('connect', () => { net.hidden = true; if (S.session && !S.replaced) resume(); });
  socket.on('disconnect', reason => { if (reason !== 'io server disconnect') net.hidden = false; });
  socket.on('replaced', () => { S.replaced = true; render(); });
  socket.on('state', st => {
    if (S.st && S.st.phase !== st.phase && st.phase === 'PLACING') S.banner = null; // เกมใหม่ ไม่โชว์ป้ายของเกมก่อน
    S.st = st; S.recvAt = Date.now(); S.offset = st.serverNow - Date.now();
    onShot(st); S.seenState = true;
    if (st.phase !== 'PLACING' || S.placingGame !== st.gameNo) { if (st.phase === 'PLACING') resetDraft(st.gameNo); }
    render();
  });
  function resume() {
    socket.emit('resume', { code: S.session.code, token: S.session.token }, r => {
      if (!r || !r.ok) {
        S.lost = r && r.error ? r.error : 'การเชื่อมต่อหาย กรุณาสร้างห้องใหม่'; // R-8-10
        S.session = null; S.st = null; store.del('bw_session'); render();
      }
    });
  }
  function emit(ev, payload) {
    return new Promise(res => socket.emit(ev, payload, r => {
      if (!r || !r.ok) {
        const quiet = ['STALE_TURN', 'BAD_PHASE', 'ALREADY_PLACED', 'OUT_OF_BOUNDS', 'BAD_REQUEST'];
        if (r && !quiet.includes(r.code)) toast(r.error || 'ทำไม่สำเร็จ');
        if (r && (r.code === 'ROOM_NOT_FOUND' || r.code === 'BAD_TOKEN')) { S.session = null; S.st = null; store.del('bw_session'); render(); }
      }
      res(r || { ok: false });
    }));
  }
  const act = (type, extra) => emit('action', { type, reqId: reqId(), ...(extra || {}) });

  // ---------- ตัวช่วย ----------
  const me = () => S.st && S.st.players.find(p => p.pid === S.st.you);
  const them = () => S.st && S.st.players.find(p => p.pid !== S.st.you);
  const nowServer = () => Date.now() + S.offset;
  const secsLeft = () => S.st && S.st.deadline ? Math.max(0, Math.ceil((S.st.deadline - nowServer()) / 1000)) : null;
  const k = (r, c) => r * N + c;
  const cellsOf = p => { const size = cardById(p.pieceId).size; const o = []; for (let i = 0; i < size; i++) o.push(p.dir === 'H' ? [p.row, p.col + i] : [p.row + i, p.col]); return o; };
  function occ(placement) { const m = new Map(); for (const p of placement || []) for (const [r, c] of cellsOf(p)) m.set(k(r, c), p.pieceId); return m; }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }
  const ICON = {
    miss: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="14" r="5" fill="#B9CDBE"/><circle cx="15" cy="10" r="4" fill="#B9CDBE" opacity=".8"/><circle cx="18" cy="5" r="2.5" fill="#B9CDBE" opacity=".6"/></svg>',
    hit: '<svg class="mk" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5L19 19M19 5L5 19" stroke="#FFD27A" stroke-width="4" stroke-linecap="round"/></svg>',
  };

  // ---------- เหตุการณ์ยิง (ป้ายดับ / ยิงแทน) ----------
  function onShot(st) {
    const ls = st.lastShot;
    const key = ls ? `${st.gameNo}:${ls.turnNo}:${ls.shooterPid}` : null;
    if (!ls || key === S.lastShotKey) { S.lastShotKey = key; return; }
    const first = !S.seenState;
    S.lastShotKey = key;
    if (first) return; // เพิ่งเปิดหน้า/รีโหลด ไม่ต้องโชว์ป้ายย้อนหลัง
    const shooter = st.players.find(p => p.pid === ls.shooterPid);
    const owner = st.players.find(p => p.pid !== ls.shooterPid);
    if (ls.sunkPieceId) showBanner(`${cardById(ls.sunkPieceId).name}ของ ${owner ? owner.name : ''} ดับแล้ว!`, '');
    else if (ls.auto) showBanner(`หมดเวลา ระบบยิงให้ ${shooter ? shooter.name : ''}`, 'auto');
  }
  function showBanner(text, cls) {
    S.banner = { text, cls };
    clearTimeout(showBanner.t);
    showBanner.t = setTimeout(() => { S.banner = null; render(); }, (S.st && S.st.config.SUNK_BANNER_MS) || 2000);
  }

  // ---------- วางอุปกรณ์ ----------
  function resetDraft(gameNo) {
    if (S.placingGame === gameNo) return;
    S.placingGame = gameNo; S.draft = {}; S.dir = 'H';
    S.sel = S.catalog && S.catalog.length ? S.catalog[0].id : null;
  }
  function fits(pieceId, row, col, dir, draft) {
    const size = cardById(pieceId).size;
    const taken = occ(Object.entries(draft).filter(([id]) => id !== pieceId).map(([id, v]) => ({ pieceId: id, ...v })));
    for (let i = 0; i < size; i++) {
      const r = dir === 'H' ? row : row + i, c = dir === 'H' ? col + i : col;
      if (r >= N || c >= N) return 'BOUNDS';
      if (taken.has(k(r, c))) return 'OVERLAP';
    }
    return null;
  }
  function nextUnplaced() { const c = (S.catalog || []).find(x => !S.draft[x.id]); return c ? c.id : null; }
  function placeAt(r, c) {
    const draftOcc = occ(Object.entries(S.draft).map(([id, v]) => ({ pieceId: id, ...v })));
    const here = draftOcc.get(k(r, c));
    if (here) { S.dir = S.draft[here].dir; delete S.draft[here]; S.sel = here; return render(); } // ยกกลับ
    if (!S.sel) S.sel = nextUnplaced();
    if (!S.sel) return toast('วางครบแล้ว แตะชิ้นบนกระดานเพื่อย้าย');
    const bad = fits(S.sel, r, c, S.dir, S.draft);
    if (bad) return toast(bad === 'BOUNDS' ? 'ล้นออกนอกกระดาน ลองหมุนหรือขยับ' : 'ทับกับชิ้นอื่น');
    S.draft[S.sel] = { row: r, col: c, dir: S.dir };
    S.sel = nextUnplaced();
    render();
  }

  // ---------- render ----------
  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    let html;
    if (!S.ageOk) html = viewAge();
    else if (S.replaced) html = viewReplaced();
    else if (!S.st || !S.session) html = viewHome();
    else html = ({ LOBBY: viewLobby, PLACING: viewPlacing, BATTLE: viewBattle, GAME_OVER: viewOver })[S.st.phase]();
    if (S.banner) html += `<div class="banner ${S.banner.cls}">${esc(S.banner.text)}</div>`;
    if (S.modal) html += viewModal();
    app.innerHTML = html;
    const seen = {};
    document.querySelectorAll('.cardslot').forEach(el => {
      const kk = el.dataset.id + '|' + el.dataset.mode; seen[kk] = (seen[kk] || 0) + 1;
      const node = cardEl(el.dataset.id, el.dataset.mode, seen[kk]);
      if (node) el.prepend(node);
    });
    if (focusId) { const f = document.getElementById(focusId); if (f) { f.focus(); if (f.setSelectionRange) { const v = f.value; f.setSelectionRange(v.length, v.length); } } }
    updateTimer();
  }

  function viewAge() {
    return `<section class="panel gate"><div class="stripe"></div><h1>Battle Weed: Green Social</h1>
      <p>เกมนี้สำหรับผู้มีอายุ 20 ปีขึ้นไป</p>
      <div class="row"><button class="btn" data-act="age-ok">ฉันอายุ 20 ปีขึ้นไป</button><button class="btn ghost" data-act="age-no">ออก</button></div></section>`;
  }
  function viewReplaced() {
    return `<section class="panel"><h2>เปิดเกมจากอีกแท็บหรืออีกเครื่องแล้ว</h2><p class="muted">ที่นั่งนี้ย้ายไปเล่นที่อื่น</p>
      <button class="btn" data-act="take-back">เล่นต่อที่นี่</button></section>`;
  }
  function installBox() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return '';
    if (S.installEvt) return `<div class="install"><span>ติดตั้ง Battle Weed ไว้บนหน้าจอโฮม</span><button class="btn" data-act="install">ติดตั้ง</button></div>`;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (ios && !S.iosHintOff) return `<div class="install"><span>เพิ่มเป็นแอป: กด แชร์ → เพิ่มไปยังหน้าจอโฮม</span><button class="x" data-act="ios-x" aria-label="ปิด">×</button></div>`;
    return '';
  }
  function viewHome() {
    return `<div class="stripe"></div><h1>Battle Weed: Green Social</h1>
      <p class="muted">ซ่อนอุปกรณ์ 5 ชิ้นบนกระดาน 10×10 แล้วผลัดกันยิงทีละนัด ใครทำให้ของอีกฝ่ายดับครบก่อนชนะ</p>
      ${S.lost ? `<div class="warn">${esc(S.lost)}</div>` : ''}
      <section class="panel">
        <label for="in-name">ชื่อของคุณ</label>
        <input id="in-name" maxlength="16" autocomplete="nickname" value="${esc(S.name)}" placeholder="เช่น เอ">
        ${S.code ? `<label for="in-code">รหัสห้อง</label><input id="in-code" maxlength="10" autocapitalize="characters" value="${esc(S.code)}">
          <button class="btn" data-act="join">เข้าห้อง ${esc(S.code)}</button><button class="btn ghost" data-act="create">สร้างห้องใหม่แทน</button>`
        : `<button class="btn" data-act="create">สร้างห้อง</button>
          <label for="in-code">หรือใส่รหัสห้องของเพื่อน</label><input id="in-code" maxlength="10" autocapitalize="characters" value="" placeholder="เช่น K7MPQ">
          <button class="btn ghost" data-act="join">เข้าห้อง</button>`}
      </section>${installBox()}`;
  }
  function header(extra) {
    return `<div class="row" style="justify-content:space-between"><h2>ห้อง ${esc(S.st.code)}</h2>${extra || ''}</div>`;
  }
  function viewLobby() {
    const link = `${location.origin}/?room=${S.st.code}`;
    return `${header('<button class="btn ghost" data-act="leave" style="flex:0">ออก</button>')}
      <section class="panel" style="align-items:center"><p class="muted">ส่งรหัสหรือลิงก์ให้เพื่อน</p>
        <div class="code">${esc(S.st.code)}</div>
        <div class="row" style="width:100%"><button class="btn" data-act="share" data-link="${esc(link)}">แชร์ลิงก์</button><button class="btn ghost" data-act="copy" data-link="${esc(link)}">คัดลอก</button></div></section>
      <section class="panel"><div class="players">${playersHTML()}</div><p class="muted">รออีกคน… ครบ 2 คนแล้วเกมเริ่มเอง</p></section>`;
  }
  function playersHTML() {
    return S.st.players.map(p => `<div class="pl"><span><i class="dot ${p.connected ? '' : 'off'}"></i>${esc(p.name)}${p.pid === S.st.you ? ' (คุณ)' : ''}</span>
      <span class="muted">${p.connected ? '' : 'หลุด'}</span></div>`).join('');
  }
  function timerHTML() { return `<span class="timer" id="timer"></span>`; }
  function oppWarn() {
    const o = them();
    if (!o || o.connected || o.graceLeft == null) return '';
    const left = Math.max(0, o.graceLeft - Math.floor((Date.now() - S.recvAt) / 1000));
    return `<div class="warn" id="grace" data-base="${o.graceLeft}">${esc(o.name)} หลุด — รออีก <span id="graceN">${left}</span> วิ</div>`;
  }

  function boardHTML(opts) {
    // opts: { cls, ships: Map, shots: Map(k->result), clickable: fn(r,c)->act|null, bad: Set, sel: Set, sunkCells: Set, last: k }
    let h = `<div class="board ${opts.cls || ''}" role="grid"><div></div>`;
    for (let c = 0; c < N; c++) h += `<div class="lab">${c + 1}</div>`;
    for (let r = 0; r < N; r++) {
      h += `<div class="lab">${ROWS[r]}</div>`;
      for (let c = 0; c < N; c++) {
        const kk = k(r, c), shot = opts.shots && opts.shots.get(kk), ship = opts.ships && opts.ships.get(kk);
        const cls = ['cell'];
        if (ship) cls.push('ship');
        if (opts.sel && opts.sel.has(kk)) cls.push('sel');
        if (opts.ghost && opts.ghost.has(kk)) cls.push('ghost');
        if (shot === 'hit') cls.push('hit');
        if (opts.sunkCells && opts.sunkCells.has(kk)) cls.push('sunk');
        if (opts.bad && opts.bad.has(kk) && !ship) cls.push('bad');
        if (opts.last === kk) cls.push('last');
        const mark = shot ? ICON[shot] : '';
        const a = opts.clickable && opts.clickable(r, c, shot, ship);
        const label = `${ROWS[r]}${c + 1}${shot === 'hit' ? ' โดน' : shot === 'miss' ? ' ควันลอย' : ''}`;
        h += a ? `<button class="${cls.join(' ')} target" data-act="${a}" data-r="${r}" data-c="${c}" aria-label="${label}">${mark}</button>`
          : `<div class="${cls.join(' ')}" aria-label="${label}">${mark}</div>`;
      }
    }
    return h + '</div>';
  }
  function fleetHTML(owner, opts) {
    // opts: { pick: true } ช่วงวาง
    return `<div class="fleet">${(S.catalog || []).map(c => {
      const sunk = owner && owner.sunk.includes(c.id);
      const cls = ['cardwrap'];
      if (opts && opts.pick) { if (S.sel === c.id) cls.push('sel'); if (S.draft[c.id]) cls.push('placed'); }
      const a = opts && opts.pick ? 'pick' : 'card';
      return `<button class="${cls.join(' ')} cardslot" data-act="${a}" data-id="${esc(c.id)}" data-mode="thumb" aria-label="${esc(c.name)} ${c.size} ช่อง${sunk ? ' ดับแล้ว' : ''}">${sunk ? '<span class="sunkTag">ดับ</span>' : ''}</button>`;
    }).join('')}</div>`;
  }

  function viewPlacing() {
    const m = me();
    if (m.ready) {
      const o = them();
      return `${header(timerHTML())}<div class="status"><span>วางเสร็จแล้ว</span><span class="muted">${o && o.ready ? 'กำลังเริ่ม…' : `รอ ${esc(o ? o.name : 'คู่แข่ง')} วาง…`}</span></div>
        ${oppWarn()}${boardHTML({ ships: occ(m.placement) })}${fleetHTML(m)}
        <button class="btn danger" data-act="resign">ยอมแพ้</button>`;
    }
    const placed = Object.entries(S.draft).map(([id, v]) => ({ pieceId: id, ...v }));
    const ships = occ(placed);
    const sel = new Set(); const ghost = new Set();
    let bad = new Set();
    if (S.sel) {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (fits(S.sel, r, c, S.dir, S.draft)) bad.add(k(r, c));
    }
    const all = (S.catalog || []).every(c => S.draft[c.id]);
    const selCard = S.sel ? cardById(S.sel) : null;
    return `${header(timerHTML())}
      <div class="status"><span>${selCard ? `วาง <b>${esc(selCard.name)}</b> (${selCard.size} ช่อง)` : 'วางครบแล้ว'}</span>
        <button class="btn ghost" data-act="rot" style="flex:0;min-height:40px">${S.dir === 'H' ? 'แนวนอน ↔' : 'แนวตั้ง ↕'}</button></div>
      ${oppWarn()}
      ${boardHTML({ ships, sel, ghost, bad, clickable: () => 'place' })}
      <div class="legend"><span>แตะช่องเพื่อวางจุดเริ่ม · แตะชิ้นบนกระดานเพื่อยกกลับ · ช่องแดง = เริ่มตรงนั้นไม่ได้</span></div>
      ${fleetHTML(m, { pick: true })}
      <div class="row"><button class="btn ghost" data-act="suggest">สุ่มวางให้</button><button class="btn" data-act="confirm" ${all ? '' : 'disabled'}>ยืนยัน</button></div>
      <button class="btn danger" data-act="resign">ยอมแพ้</button>`;
  }
  function shotsMap(p) { return new Map((p ? p.shotsTaken : []).map(s => [k(s.row, s.col), s.result])); }
  function lastKey(pid) { const ls = S.st.lastShot; return ls && ls.shooterPid === pid ? k(ls.row, ls.col) : null; }
  function sunkCellsOf(owner) {
    if (!owner || !owner.placement) return new Set();
    return new Set(owner.placement.filter(p => owner.sunk.includes(p.pieceId)).flatMap(p => cellsOf(p).map(([r, c]) => k(r, c))));
  }
  function viewBattle() {
    const m = me(), o = them();
    const mine = S.st.turnPid === m.pid;
    const myShots = shotsMap(m);
    return `${header(timerHTML())}
      <div class="status"><span>${mine ? '<b>ตาคุณ</b> แตะช่องบนกระดานคู่แข่ง' : `ตา ${esc(o ? o.name : '')}`}</span></div>
      ${m.autoStreak ? `<div class="warn">ระบบยิงแทนคุณ ${m.autoStreak} ตาติดกันแล้ว ครบ 3 ตาจะแพ้</div>` : ''}
      ${oppWarn()}
      <h2>กระดาน ${esc(o ? o.name : 'คู่แข่ง')}</h2>
      ${boardHTML({ shots: myShots, last: lastKey(m.pid), clickable: (r, c, shot) => (mine && !shot ? 'fire' : null) })}
      <div class="legend"><span>${ICON.miss} ควันลอย</span><span>${ICON.hit} โดน!</span></div>
      ${fleetHTML(o)}
      <h2>กระดานของคุณ</h2>
      ${boardHTML({ cls: 'small', ships: occ(m.placement), shots: shotsMap(o), sunkCells: sunkCellsOf(m), last: o ? lastKey(o.pid) : null })}
      ${fleetHTML(m)}
      <button class="btn danger" data-act="resign">ยอมแพ้</button>`;
  }
  const REASON = { all_sunk: 'ดับครบทุกชิ้น', resign: 'อีกฝ่ายยอมแพ้', disconnect: 'อีกฝ่ายหลุดเกินเวลา', auto_limit: 'หมดเวลาติดกัน 3 ตา', cancelled: 'ทั้งคู่หลุด เกมถูกยกเลิก' };
  function viewOver() {
    const m = me(), o = them(), res = S.st.result || {};
    const win = res.winnerPid === m.pid;
    const title = !res.winnerPid ? 'เกมถูกยกเลิก' : win ? 'คุณชนะ!' : 'คุณแพ้';
    const why = res.reason === 'resign' || res.reason === 'disconnect' || res.reason === 'auto_limit'
      ? (win ? REASON[res.reason] : { resign: 'คุณยอมแพ้', disconnect: 'คุณหลุดเกินเวลา', auto_limit: 'หมดเวลาติดกัน 3 ตา' }[res.reason]) : REASON[res.reason] || '';
    const stat = p => { const n = p.shotsTaken.length, h = p.shotsTaken.filter(s => s.result === 'hit').length; return `<span>${esc(p.name)}</span><span>${n} นัด</span><span>โดน ${n ? Math.round(h / n * 100) : 0}%</span>`; };
    const oppBoard = o ? boardHTML({ ships: occ(o.placement), shots: shotsMap(m), sunkCells: sunkCellsOf(o) }) : '';
    return `${header()}
      <section class="panel"><div class="result">${title}</div><p class="muted" style="text-align:center">${esc(why)}</p>
        <div class="stats">${[m, o].filter(Boolean).map(stat).join('')}</div></section>
      ${o ? `<h2>กระดาน ${esc(o.name)} (เปิดหมด)</h2>${oppBoard}` : ''}
      <h2>กระดานของคุณ</h2>${boardHTML({ cls: 'small', ships: occ(m.placement), shots: shotsMap(o), sunkCells: sunkCellsOf(m) })}
      ${o ? `<div class="row"><button class="btn" data-act="rematch" ${m.wantsRematch ? 'disabled' : ''}>${m.wantsRematch ? `รอ ${esc(o.name)} กดเล่นอีก…` : 'เล่นอีก'}</button></div>`
        : `<div class="warn">อีกฝ่ายออกจากห้องแล้ว</div><button class="btn" data-act="lobby">กลับล็อบบี้ (รอคนใหม่)</button>`}
      <button class="btn ghost" data-act="leave">ออกจากห้อง</button>`;
  }
  function viewModal() {
    if (S.modal.type === 'card') return `<div class="modal" data-act="close"><div class="cardslot" data-id="${esc(S.modal.id)}" data-mode="full"></div></div>`;
    return `<div class="modal"><section class="panel" style="max-width:340px"><h2>ยอมแพ้เกมนี้?</h2><p class="muted">อีกฝ่ายจะชนะทันที</p>
      <div class="row"><button class="btn danger" data-act="resign-yes">ยอมแพ้</button><button class="btn" data-act="close">เล่นต่อ</button></div></section></div>`;
  }

  // ---------- นาฬิกา (อัปเดตเฉพาะตัวเลข ไม่ render ทั้งหน้า) ----------
  function updateTimer() {
    const t = $('#timer'); const s = secsLeft();
    if (t) { t.textContent = s == null ? '' : `${s} วิ`; t.classList.toggle('low', s != null && s <= 5); }
    const g = $('#graceN'), gb = $('#grace');
    if (g && gb) g.textContent = Math.max(0, +gb.dataset.base - Math.floor((Date.now() - S.recvAt) / 1000));
  }
  setInterval(updateTimer, 250);

  // ---------- คลิก ----------
  document.addEventListener('input', e => {
    if (e.target.id === 'in-name') { S.name = e.target.value; store.set('bw_name', S.name); }
    if (e.target.id === 'in-code') S.code = e.target.value.toUpperCase();
  });
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act;
    const r = +el.dataset.r, c = +el.dataset.c;
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
        if (res.ok) { S.session = { code: res.code, playerId: res.pid, token: res.token }; store.set('bw_session', S.session); S.lost = null; history.replaceState(null, '', '/'); }
        return;
      }
      case 'copy': try { await navigator.clipboard.writeText(el.dataset.link); toast('คัดลอกลิงก์แล้ว'); } catch (x) { toast(el.dataset.link); } return;
      case 'share':
        if (navigator.share) { try { await navigator.share({ title: 'Battle Weed', text: 'มาเล่น Battle Weed กัน', url: el.dataset.link }); } catch (x) { /* ยกเลิก */ } }
        else { try { await navigator.clipboard.writeText(el.dataset.link); toast('คัดลอกลิงก์แล้ว'); } catch (x) { toast(el.dataset.link); } }
        return;
      case 'pick': S.sel = el.dataset.id; if (S.draft[S.sel]) { S.dir = S.draft[S.sel].dir; delete S.draft[S.sel]; } return render();
      case 'rot': S.dir = S.dir === 'H' ? 'V' : 'H'; return render();
      case 'place': return placeAt(r, c);
      case 'suggest': {
        const res = await act('suggest_placement');
        if (res.ok && res.placement) { S.draft = {}; for (const p of res.placement) S.draft[p.pieceId] = { row: p.row, col: p.col, dir: p.dir }; S.sel = null; render(); }
        return;
      }
      case 'confirm': {
        const placement = Object.entries(S.draft).map(([id, v]) => ({ pieceId: id, row: v.row, col: v.col, dir: v.dir }));
        el.disabled = true; await act('submit_placement', { placement }); return;
      }
      case 'fire': el.disabled = true; await act('fire', { row: r, col: c, turnNo: S.st.turnNo }); return;
      case 'card': S.modal = { type: 'card', id: el.dataset.id }; return render();
      case 'resign': S.modal = { type: 'resign' }; return render();
      case 'resign-yes': S.modal = null; await act('resign'); return render();
      case 'close': S.modal = null; return render();
      case 'rematch': await act('rematch', { want: true }); return;
      case 'lobby': await act('back_to_lobby'); return;
      case 'leave': await emit('leave', {}); S.session = null; S.st = null; store.del('bw_session'); return render();
      case 'take-back': S.replaced = false; socket.connect(); return;
      case 'install': if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; render(); } return;
      case 'ios-x': S.iosHintOff = true; store.set('bw_ios_hint_off', true); return render();
    }
  });

  // ---------- M1: กันหน้าเลื่อน/เด้งเมื่อเนื้อหาพอดีจอ ----------
  function scrollableParent(el, dx, dy) {
    for (; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (Math.abs(dx) > Math.abs(dy) && /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth) return true;
      if (Math.abs(dy) >= Math.abs(dx) && /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return true;
    }
    return false;
  }
  let t0 = null;
  document.addEventListener('touchstart', e => { const t = e.touches[0]; t0 = t ? [t.clientX, t.clientY] : null; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (document.documentElement.scrollHeight > window.innerHeight + 1) return;
    const t = e.touches[0]; if (!t || !t0) return;
    if (!scrollableParent(e.target, t.clientX - t0[0], t.clientY - t0[1])) e.preventDefault();
  }, { passive: false });

  // ---------- M2: ติดตั้งเป็นแอป ----------
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installEvt = e; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  render();
})();
