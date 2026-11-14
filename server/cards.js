'use strict';
// อ่านข้อมูลชิ้นครั้งเดียวตอนเริ่ม (R-4.1-01..R-4.1-04) — server ห้ามล่มเพราะไฟล์ข้อมูล
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCSV } = require('./parse-csv');
const SCHEMA = require('../shared/card-schema');
const { parseShape } = require('../game');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function loadCards(dir) {
  const out = { ready: false, problem: null, version: '0', cards: [], fit: {}, skipped: [] };
  const fail = msg => { out.problem = msg; console.error('[cards] ' + msg); return out; };
  let csvText;
  try { csvText = fs.readFileSync(path.join(dir, 'data.csv'), 'utf8'); } catch (e) { return fail('ไม่พบ cards/data.csv'); }
  try { out.fit = JSON.parse(fs.readFileSync(path.join(dir, 'fit.json'), 'utf8')); } catch (e) { out.fit = {}; } // R-4.1-06 ไม่มี = fallback

  const rows = parseCSV(csvText.replace(/^﻿/, ''));
  if (!rows.length) return fail('cards/data.csv ว่าง');
  const head = rows[0].map(h => h.trim());
  for (const [col, def] of Object.entries(SCHEMA.columns)) {
    if (def.required && !head.includes(col)) return fail(`cards/data.csv ไม่มีคอลัมน์ ${col}`); // R-4.1-02
  }
  const seen = new Set();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (r.every(x => !String(x || '').trim())) return;
    const rec = {}; head.forEach((h, j) => { rec[h] = (r[j] ?? '').trim(); });
    const bad = why => { out.skipped.push({ line, why }); console.error(`[cards] data.csv แถว ${line}: ${why} — ข้ามแถวนี้`); };
    // R-4.1-03
    if (!ID_RE.test(rec.id)) return bad(`id "${rec.id}" ผิดรูปแบบ`);
    if (seen.has(rec.id)) return bad(`id "${rec.id}" ซ้ำ`);
    if (!rec.name) return bad('name ว่าง');
    if ([...rec.name].length > SCHEMA.columns.name.max) return bad(`name ยาวเกิน ${SCHEMA.columns.name.max} ตัว`);
    if ([...rec.shape].length > SCHEMA.columns.shape.max || !parseShape(rec.shape)) return bad(`shape "${rec.shape}" ผิดรูปแบบ`);
    seen.add(rec.id);
    out.cards.push({ id: rec.id, name: rec.name, shape: rec.shape }); // R-4.1-04 ไม่มี image
  });
  if (!out.cards.length) return fail('ไม่มีชิ้นที่ใช้ได้ใน cards/data.csv');

  const h = crypto.createHash('sha1');
  h.update(csvText); h.update(JSON.stringify(out.fit));
  try {
    const art = path.join(dir, 'art');
    for (const f of fs.readdirSync(art).sort()) h.update(f + ':' + fs.statSync(path.join(art, f)).size);
  } catch (e) { /* ยังไม่มีภาพ ใช้ fallback */ }
  out.version = h.digest('hex').slice(0, 10);
  out.ready = true;
  return out;
}

module.exports = { loadCards };
