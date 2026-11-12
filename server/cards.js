'use strict';
// อ่านไฟล์การ์ดครั้งเดียวตอนเริ่ม (R-4.1-01..R-4.1-05) — server ห้ามล่มเพราะไฟล์การ์ด
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCSV } = require('./parse-csv');
const SCHEMA = require('../shared/card-schema');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function loadCards(dir, config) {
  const out = { ready: false, problem: null, version: '0', templates: {}, cards: [], skipped: [] };
  const fail = msg => { out.problem = msg; console.error('[cards] ' + msg); return out; };
  let csvText;
  try {
    out.templates.main = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'));
  } catch (e) { return fail('อ่าน cards/template.json ไม่ได้: ' + e.message); }
  try { csvText = fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'); } catch (e) { return fail('ไม่พบ cards/data.csv'); }

  const rows = parseCSV(csvText);
  if (!rows.length) return fail('cards/data.csv ว่าง');
  const head = rows[0].map(h => h.trim());
  for (const [col, def] of Object.entries(SCHEMA.columns)) {
    if (def.required && !head.includes(col)) return fail(`cards/data.csv ไม่มีคอลัมน์ ${col}`); // R-4.1-02
  }
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const rec = {}; head.forEach((h, j) => { rec[h] = (r[j] ?? '').trim(); });
    const bad = why => { out.skipped.push({ line, why }); console.error(`[cards] data.csv แถว ${line}: ${why} — ข้ามแถวนี้`); };
    // R-4.1-03
    if (!ID_RE.test(rec.id)) return bad(`id "${rec.id}" ผิดรูปแบบ`);
    if (seen.has(rec.id)) return bad(`id "${rec.id}" ซ้ำ`);
    const card = { id: rec.id };
    for (const [col, def] of Object.entries(SCHEMA.columns)) {
      if (col === 'id') continue;
      const v = rec[col] ?? '';
      if (v === '') { if (def.required) return bad(`${col} ว่าง`); continue; }
      if (def.type === 'text') {
        if ([...v].length > def.max) return bad(`${col} ยาวเกิน ${def.max} ตัว`);
        card[col] = v;
      } else if (def.type === 'int') {
        if (!/^-?\d+$/.test(v)) return bad(`${col} "${v}" ไม่ใช่จำนวนเต็ม`);
        const n = Number(v);
        if (n < def.min || n > def.max) return bad(`${col} ${n} อยู่นอกช่วง ${def.min}–${def.max}`);
        card[col] = n;
      }
    }
    seen.add(rec.id);
    for (const s of SCHEMA.secret) delete card[s]; // R-4.1-05
    out.cards.push(card);
  });
  // R-4.1-04 เพดานของในวง
  const total = out.cards.reduce((a, c) => a + c.size, 0);
  if (out.cards.length < config.FLEET_MIN_PIECES || out.cards.length > config.FLEET_MAX_PIECES)
    return fail(`ของในวงต้องมี ${config.FLEET_MIN_PIECES}–${config.FLEET_MAX_PIECES} ชิ้น (มี ${out.cards.length})`);
  if (total > config.FLEET_MAX_CELLS) return fail(`ผลรวม size ${total} เกิน ${config.FLEET_MAX_CELLS} ช่อง`);

  const h = crypto.createHash('sha1');
  h.update(JSON.stringify(out.templates)); h.update(csvText);
  try {
    const art = path.join(dir, 'art');
    for (const f of fs.readdirSync(art).sort()) h.update(f + ':' + fs.statSync(path.join(art, f)).size);
  } catch (e) { /* ยังไม่มีภาพ ใช้ fallback */ }
  out.version = h.digest('hex').slice(0, 10);
  out.ready = true;
  return out;
}

module.exports = { loadCards };
