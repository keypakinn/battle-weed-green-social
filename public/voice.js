/* Battle Weed: Green Social v2.4 — เสียงสดในห้อง (WebRTC mesh) R-5-17 .. R-5-19
   เสียงไม่ผ่านเซิร์ฟเวอร์ · server เก็บแค่รายชื่อ pid ที่เปิดเสียง และส่งต่อข้อความเชื่อมต่อ (`rtc`) */
(function () {
  'use strict';
  const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
  const V = {
    supported: !!(window.RTCPeerConnection && navigator.mediaDevices),
    joined: false, busy: false, mic: false, hasMic: false, err: null,
    muted: new Set(), speaking: new Set(), conn: new Map(), // conn: pid -> 'connecting'|'connected'|'failed'
    onChange: () => {},
  };
  const peers = new Map();            // pid -> { pc, audio, queue, stop }
  let stream = null, socket = null, act = null, selfPid = null, level = null, actx = null, poll = null;

  const emitChange = () => { try { V.onChange(); } catch (e) { /* */ } };

  function sendRtc(to, kind, data) { if (socket) socket.emit('rtc', { to, kind, data }, () => {}); }

  function audioCtx() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { actx = new AC(); } catch (e) { /* */ } } }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function meter(mediaStream) { // คืนฟังก์ชันวัดระดับเสียง 0..1
    const c = audioCtx(); if (!c) return () => 0;
    try {
      const src = c.createMediaStreamSource(mediaStream); const an = c.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      return () => { an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; } return Math.sqrt(s / buf.length); };
    } catch (e) { return () => 0; }
  }
  function startPoll() {
    if (poll) return;
    poll = setInterval(() => {
      const next = new Set();
      if (V.mic && level && level() > 0.035 && selfPid) next.add(selfPid);
      for (const [pid, p] of peers) if (!V.muted.has(pid) && p.level && p.level() > 0.03) next.add(pid);
      const same = next.size === V.speaking.size && [...next].every(x => V.speaking.has(x));
      if (!same) { V.speaking = next; emitChange(); try { window.SFX && SFX.duck([...next].some(x => x !== selfPid)); } catch (e) { /* */ } }
    }, 160);
  }
  function stopPoll() { clearInterval(poll); poll = null; V.speaking = new Set(); try { window.SFX && SFX.duck(false); } catch (e) { /* */ } }

  function closePeer(pid) {
    const p = peers.get(pid); if (!p) return;
    peers.delete(pid); V.conn.delete(pid);
    try { p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = null; p.pc.close(); } catch (e) { /* */ }
    if (p.audio) { try { p.audio.srcObject = null; p.audio.remove(); } catch (e) { /* */ } }
    emitChange();
  }
  function makePeer(pid) {
    const pc = new RTCPeerConnection(ICE);
    const p = { pc, audio: null, queue: [], level: null };
    peers.set(pid, p); V.conn.set(pid, 'connecting');
    pc.onicecandidate = e => { if (e.candidate) sendRtc(pid, 'ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
    pc.ontrack = e => {
      const ms = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]);
      if (!p.audio) {
        const a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); a.style.display = 'none';
        a.muted = V.muted.has(pid); a.srcObject = ms; document.body.appendChild(a);
        a.play().catch(() => {});
        p.audio = a; p.level = meter(ms);
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') V.conn.set(pid, 'connected');
      else if (s === 'failed') V.conn.set(pid, 'failed');
      else if (s === 'closed') { closePeer(pid); return; }
      emitChange();
    };
    return p;
  }
  async function offerTo(pid) {
    const p = makePeer(pid);
    if (stream) stream.getTracks().forEach(t => p.pc.addTrack(t, stream)); else p.pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await p.pc.createOffer(); await p.pc.setLocalDescription(offer);
    sendRtc(pid, 'offer', { type: offer.type, sdp: offer.sdp });
  }
  async function onRtc(m) {
    if (!V.joined || !m || typeof m.from !== 'string') return;
    try {
      if (m.kind === 'offer') {
        closePeer(m.from);
        const p = makePeer(m.from);
        await p.pc.setRemoteDescription(m.data);
        if (stream) stream.getTracks().forEach(t => p.pc.addTrack(t, stream));
        const ans = await p.pc.createAnswer(); await p.pc.setLocalDescription(ans);
        sendRtc(m.from, 'answer', { type: ans.type, sdp: ans.sdp });
        for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (m.kind === 'answer') {
        const p = peers.get(m.from); if (!p) return;
        await p.pc.setRemoteDescription(m.data);
        for (const c of p.queue.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (m.kind === 'ice') {
        const p = peers.get(m.from); if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.data).catch(() => {}); else p.queue.push(m.data);
      }
    } catch (e) { V.conn.set(m.from, 'failed'); emitChange(); }
  }

  V.init = function (o) {
    socket = o.socket; act = o.act;
    socket.on('rtc', onRtc);
  };
  V.setSelf = pid => { selfPid = pid; };

  V.join = async function () {
    if (!V.supported || V.joined || V.busy) return { ok: false };
    V.busy = true; V.err = null; emitChange();
    try {
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
          V.hasMic = true; level = meter(stream);
        } catch (e) { stream = null; V.hasMic = false; V.err = 'mic'; }          // ปฏิเสธไมค์ = ฟังอย่างเดียว
      }
      if (stream) stream.getAudioTracks().forEach(t => { t.enabled = false; });   // R-5-18 ปิดไมค์เป็นค่าเริ่มต้น
      V.mic = false;
      audioCtx();
      const r = await act('voice_join');
      if (!r || !r.ok) { cleanup(); V.busy = false; emitChange(); return r || { ok: false }; }
      V.joined = true;
      for (const pid of r.peers || []) { try { await offerTo(pid); } catch (e) { V.conn.set(pid, 'failed'); } }
      startPoll();
    } finally { V.busy = false; emitChange(); }
    return { ok: true };
  };
  function cleanup() {
    for (const pid of [...peers.keys()]) closePeer(pid);
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    level = null; V.hasMic = false; V.mic = false; V.joined = false; stopPoll();
  }
  V.leave = async function () {
    if (!V.joined && !stream) return;
    cleanup(); emitChange();
    try { await act('voice_leave'); } catch (e) { /* */ }
  };
  V.toggleMic = function () {
    if (!V.joined || !stream) return false;
    V.mic = !V.mic; stream.getAudioTracks().forEach(t => { t.enabled = V.mic; });
    emitChange(); return V.mic;
  };
  V.toggleMute = function (pid) {
    if (V.muted.has(pid)) V.muted.delete(pid); else V.muted.add(pid);
    const p = peers.get(pid); if (p && p.audio) p.audio.muted = V.muted.has(pid);
    emitChange();
  };
  // เรียกทุกครั้งที่ได้ state ใหม่: ปิดการเชื่อมต่อกับคนที่ออกจากเสียงสด / ต่อใหม่เมื่อ server เอาเราออก (เช่น หลุดแล้วกลับ)
  V.sync = function (st) {
    if (!V.joined || !st) return;
    const inVoice = new Set(st.voice || []);
    if (!inVoice.has(st.you) && !V.busy) { // server ไม่มีเรา: ต่อใหม่ทั้งหมด
      V.busy = true;
      for (const pid of [...peers.keys()]) closePeer(pid);
      act('voice_join').then(async r => {
        if (r && r.ok) for (const pid of r.peers || []) { try { await offerTo(pid); } catch (e) { V.conn.set(pid, 'failed'); } }
        else { cleanup(); }
      }).finally(() => { V.busy = false; emitChange(); });
      return;
    }
    for (const pid of [...peers.keys()]) if (!inVoice.has(pid)) closePeer(pid);
  };
  V.reset = function () { cleanup(); emitChange(); };   // ออกจากห้อง
  window.VOICE = V;
})();
