/* Battle Weed: Green Social v2.4 — เสียงเอฟเฟกต์ + BGM สังเคราะห์ด้วย Web Audio (R-10-09 .. R-10-11)
   ไม่มีไฟล์เสียง ไม่มีผลต่อกติกา เล่นที่ client เท่านั้น เริ่มได้หลังผู้เล่นแตะจอครั้งแรก */
(function () {
  'use strict';
  const AC = window.AudioContext || window.webkitAudioContext;
  const KEY = 'bw_snd';
  const prefs = { fx: true, bgm: true };
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && typeof v === 'object') { prefs.fx = v.fx !== false; prefs.bgm = v.bgm !== false; } } catch (e) { /* โหมดส่วนตัว */ }
  const savePrefs = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* */ } };

  let ctx = null, master = null, fxBus = null, bgmBus = null, noiseBuf = null;
  let wantMode = null, mode = null, intense = false, duck = false;
  const lastPlayed = {}; const calls = [];

  function ensure() {
    if (!AC) return false;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { return false; }
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); master.gain.value = 0.9;
      fxBus = ctx.createGain(); fxBus.gain.value = 0.8;
      bgmBus = ctx.createGain(); bgmBus.gain.value = 0.28; // R-10-10 BGM เบากว่าเอฟเฟกต์
      fxBus.connect(comp); bgmBus.connect(comp); comp.connect(master); master.connect(ctx.destination);
      const n = Math.floor(ctx.sampleRate * 2); noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }
  // ---------- ตัวสร้างเสียงพื้นฐาน ----------
  function tone(o) {
    const t = ctx.currentTime + (o.at || 0); const dur = o.dur || 0.15;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + dur);
    const g = ctx.createGain(); const v = o.vol == null ? 0.2 : o.vol; const a = o.attack || 0.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc; if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.bus || fxBus);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    const t = ctx.currentTime + (o.at || 0); const dur = o.dur || 0.2;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.Q.value = o.q || 0.8;
    f.frequency.setValueAtTime(o.f || 1000, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + dur);
    const g = ctx.createGain(); const v = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + (o.attack || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.bus || fxBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  // ---------- เอฟเฟกต์ตามตาราง R-10-09 ----------
  const FX = {
    click() { tone({ f: 1200, f2: 900, dur: 0.04, vol: 0.1 }); },
    rotate() { tone({ f: 800, f2: 1150, dur: 0.05, vol: 0.1 }); },
    popUp() { tone({ f: 600, f2: 950, dur: 0.1, vol: 0.14 }); },
    popDown() { tone({ f: 900, f2: 480, dur: 0.12, vol: 0.14 }); },
    start() { [330, 440, 660].forEach((f, i) => tone({ f, dur: 0.16, at: i * 0.1, vol: 0.16, type: 'triangle' })); tone({ f: 880, dur: 0.4, at: 0.3, vol: 0.14, type: 'triangle' }); },
    place() { tone({ f: 150, f2: 60, dur: 0.14, vol: 0.4 }); noise({ f: 500, dur: 0.07, vol: 0.18 }); },
    invalid() { tone({ f: 170, f2: 110, dur: 0.14, vol: 0.12, type: 'square', lp: 900 }); },
    ready() { tone({ f: 1320, dur: 0.25, vol: 0.14 }); tone({ f: 1760, dur: 0.3, at: 0.07, vol: 0.1 }); },
    launch() { tone({ f: 260, f2: 1500, dur: 0.95, vol: 0.09, type: 'sawtooth', lp: 2200, attack: 0.05 }); noise({ type: 'highpass', f: 3000, dur: 0.8, vol: 0.03, attack: 0.1 }); },
    miss() { noise({ type: 'bandpass', f: 1500, f2: 500, q: 1.2, dur: 0.45, vol: 0.16, attack: 0.03 }); },
    hit() {
      noise({ f: 3200, f2: 180, dur: 0.42, vol: 0.42 }); tone({ f: 130, f2: 38, dur: 0.34, vol: 0.5 });
      for (let i = 0; i < 4; i++) noise({ type: 'highpass', f: 2500, dur: 0.03, at: 0.12 + i * 0.07 + Math.random() * 0.03, vol: 0.14 });
    },
    island() { noise({ type: 'bandpass', f: 1800, q: 2, dur: 0.35, vol: 0.14 }); [700, 920, 1150].forEach((f, i) => tone({ f, f2: f * 1.3, dur: 0.07, at: i * 0.07, vol: 0.1 })); },
    trap() { [0, 0.22].forEach(at => tone({ f: 118, f2: 96, dur: 0.17, at, vol: 0.2, type: 'square', lp: 700 })); },
    sunk() {
      noise({ f: 1400, f2: 50, dur: 1.0, vol: 0.5 }); tone({ f: 95, f2: 32, dur: 0.95, vol: 0.5, type: 'sawtooth', lp: 500 });
      [220, 277, 330].forEach(f => tone({ f, dur: 0.7, at: 0.12, vol: 0.12, type: 'sawtooth', lp: 1200 }));
    },
    turn() { tone({ f: 880, dur: 0.22, vol: 0.16, type: 'triangle' }); tone({ f: 1320, dur: 0.3, at: 0.13, vol: 0.16, type: 'triangle' }); },
    power() { [440, 554, 659, 880].forEach((f, i) => tone({ f, dur: 0.1, at: i * 0.06, vol: 0.15, type: 'triangle' })); },
    tick() { tone({ f: 880, dur: 0.09, vol: 0.22, type: 'square', lp: 2400 }); },
    tickLast() { tone({ f: 1320, dur: 0.2, vol: 0.24, type: 'square', lp: 3000 }); },
    elim() { tone({ f: 420, f2: 70, dur: 0.75, vol: 0.2, type: 'sawtooth', lp: 900 }); },
    win() {
      [523, 659, 784].forEach((f, i) => tone({ f, dur: 0.18, at: i * 0.14, vol: 0.18, type: 'square', lp: 2600 }));
      [523, 659, 784, 1047].forEach(f => tone({ f, dur: 0.9, at: 0.5, vol: 0.1, type: 'square', lp: 2200 }));
    },
    draw() { tone({ f: 440, dur: 0.3, vol: 0.16, type: 'triangle' }); tone({ f: 440, dur: 0.4, at: 0.3, vol: 0.16, type: 'triangle' }); },
    chat() { tone({ f: 1000, dur: 0.05, vol: 0.06 }); },
  };
  const MIN_GAP = { click: 50, tick: 400, tickLast: 400, chat: 150, popUp: 150, popDown: 150 };

  function play(name) {
    if (!prefs.fx || !FX[name] || !ensure()) return;
    const now = Date.now();
    if (lastPlayed[name] && now - lastPlayed[name] < (MIN_GAP[name] || 60)) return;
    lastPlayed[name] = now;
    while (calls.length && now - calls[0] > 400) calls.shift();
    if (calls.length >= 6) return;                   // ไม่ซ้อนเสียงมากเกินไป
    calls.push(now);
    try { FX[name](); } catch (e) { /* เสียงพัง ห้ามทำให้เกมพัง */ }
  }

  // ---------- BGM แนวสนามรบ R-10-10 ----------
  // A ไมเนอร์ / เฟรเจียน · กลองมาร์ช + เบสวน + แตรสั้น ๆ · place = เบา 100 BPM · battle = เต็ม 132 BPM
  const A1 = 55;
  const hz = semi => A1 * Math.pow(2, semi / 12);
  const ROOTS = [0, 1, 0, -2];                       // A, Bb, A, G
  const BASS = { 0: 0, 2: 0, 3: 0, 4: 12, 6: 0, 8: 0, 10: 7, 11: 3, 12: 0, 14: 5 };  // step -> semitone เหนือราก
  let timer = null, nextT = 0, step = 0, bar = 0;
  const bTone = o => tone({ ...o, bus: bgmBus });
  const bNoise = o => noise({ ...o, bus: bgmBus });
  function scheduleStep(t0, st, br) {
    const at = t0 - ctx.currentTime; const full = mode === 'battle'; const root = ROOTS[br % 4];
    const spb = 60 / (full ? 132 : 100) / 4;
    if (st in BASS && (full || st % 4 === 0)) bTone({ f: hz(root + BASS[st]), dur: spb * (st % 2 ? 1.6 : 1.8), at, vol: full ? 0.34 : 0.22, type: 'sawtooth', lp: full ? 420 : 300 });
    if (full) {
      if (st % 4 === 0) { bTone({ f: 120, f2: 42, dur: 0.2, at, vol: 0.6 }); bNoise({ f: 300, dur: 0.05, at, vol: 0.2 }); }                // กลองใหญ่
      if (st === 4 || st === 12) bNoise({ type: 'bandpass', f: 1800, q: 0.7, dur: 0.16, at, vol: 0.32 });                                       // แสแนร์
      if (st % 2 === 0 || intense) bNoise({ type: 'highpass', f: 7000, dur: 0.03, at, vol: intense && st % 2 ? 0.06 : 0.1 });                  // ฮาย-แฮต (เร่ง = 16 ตัว)
      if (st === 0 && br % 4 === 3) [0, 3, 7].forEach(i => bTone({ f: hz(root + 24 + i), dur: 0.5, at, vol: 0.11, type: 'sawtooth', lp: 1500 })); // แตรสั้น
      if (st === 10 && br % 2 === 1) bTone({ f: hz(root + 31), f2: hz(root + 30), dur: 0.4, at, vol: 0.08, type: 'square', lp: 1800 });          // ทริลตึงเครียด
      if (intense && st % 4 === 2) bTone({ f: hz(36), dur: spb * 0.9, at, vol: 0.1, type: 'square', lp: 900 });
    } else {
      if (st === 0) bTone({ f: 90, f2: 45, dur: 0.35, at, vol: 0.4 });                                                                         // ทอมเบา ๆ
      if (st === 8) bNoise({ f: 200, dur: 0.1, at, vol: 0.12 });
      if (st === 0 && br % 4 === 0) [0, 7, 12].forEach(i => bTone({ f: hz(root + 24 + i), dur: 1.8, at, vol: 0.05, type: 'triangle', lp: 900 })); // แพดค้าง
    }
  }
  function pump() {
    if (!ctx || !mode) return;
    const spb = 60 / (mode === 'battle' ? 132 : 100) / 4;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + 0.25) {
      scheduleStep(nextT, step, bar); nextT += spb; step++;
      if (step >= 16) { step = 0; bar++; }
    }
  }
  function applyBgm() {
    const want = prefs.bgm && wantMode && ctx ? wantMode : null;
    if (want === mode) return;
    if (!want) {
      mode = null; clearInterval(timer); timer = null;
      if (bgmBus) bgmBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
      return;
    }
    mode = want; step = 0; bar = 0; nextT = ctx.currentTime + 0.1;
    bgmBus.gain.cancelScheduledValues(ctx.currentTime); bgmBus.gain.setTargetAtTime(duck ? 0.14 : 0.28, ctx.currentTime, 0.1);
    if (!timer) timer = setInterval(pump, 60);
    pump();
  }
  function applyDuck() { if (ctx && mode) bgmBus.gain.setTargetAtTime(duck ? 0.14 : 0.28, ctx.currentTime, 0.2); }

  // ---------- เปิดใช้งานหลังแตะจอครั้งแรก ----------
  function unlock() {
    if (!ensure()) return;
    try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* iOS */ }
    applyBgm();
  }
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));
  document.addEventListener('visibilitychange', () => {   // แท็บที่ไม่ได้เปิดอยู่หยุดเสียง (R-10-11)
    if (!ctx) return;
    if (document.hidden) { ctx.suspend().catch(() => {}); clearInterval(timer); timer = null; mode = null; }
    else { ctx.resume().then(applyBgm).catch(() => {}); }
  });

  window.SFX = {
    play, unlock,
    pref: k => prefs[k],
    setPref(k, v) { if (!(k in prefs)) return; prefs[k] = !!v; savePrefs(); if (k === 'bgm') applyBgm(); },
    bgm(m) { wantMode = m || null; applyBgm(); },      // 'place' | 'battle' | null
    intense(on) { intense = !!on; },
    duck(on) { duck = !!on; applyDuck(); },
    supported: !!AC,
  };
})();
