"use strict";
const { app, NothingEnum } = require("indesign");

/* ============================================================
 *  CONFIG
 * ============================================================ */
let chunkLimit = 800;           // จำนวนตัวอักษรต่อ 1 request (ตั้งจากโปรไฟล์ที่ใช้อยู่)
const MAX_ORIGINAL_LEN = 30;    // ถ้า AI ส่ง "จุดผิด" ยาวกว่านี้ = กำลังเกลาประโยค -> ตัดทิ้ง
const K_PRESETS = "ai_proofread_custom_presets";
const K_IGNORE = "ai_proofread_ignore";
const THAI = /[\u0E01-\u0E7F]/;
const LATIN_WORD = /^[A-Za-z][A-Za-z'\u2019]*$/;
// ข้อความนี้มีภาษาที่ผู้ใช้เลือกตรวจหรือไม่
function wantText(t) { return (langs.th && THAI.test(t)) || (langs.en && /[A-Za-z]{3}/.test(t)); }
const MARK_L = "【";
const MARK_R = "】";
const CAND_CONTEXT = 30;        // โหมดจุดน่าสงสัย: ส่งบริบทรอบคำกี่ตัวอักษร
const RED = "err";    // ชื่อ class ของ #status (สีกำหนดใน CSS ตามธีม)
const GREEN = "ok";
const K_ACC = "ai_proofread_accordion";
const K_THEME = "ai_proofread_theme";

const BUILTIN_PRESETS = {
  strict_proofread: {
    name: "Proofreader ไทย + อังกฤษ (ผิดอย่างเดียว ไม่เกลา)",
    prompt: `คุณคือ "พิสูจน์อักษร" (Proofreader) ภาษาไทยและภาษาอังกฤษ ไม่ใช่บรรณาธิการ
ข้อความอาจเป็นไทย อังกฤษ หรือปนกัน ให้ตรวจแต่ละภาษาตามกติกาของภาษานั้น
ชี้เฉพาะจุดที่ผิดชัดเจนเท่านั้น ห้ามปรับสำนวน ห้ามเรียบเรียงใหม่ ห้ามแตะประโยคที่ถูกอยู่แล้ว

ตรวจเฉพาะ:
ภาษาไทย
1. สะกดผิด / พิมพ์ผิด เช่น "ประเทส" → "ประเทศ"
2. คำเกินหรือคำซ้ำที่พิมพ์เกินโดยไม่ตั้งใจ เช่น "ผมไปไป โรงเรียน" → "ไป"
3. อักขระแปลกปลอม สระ/วรรณยุกต์ผิดตำแหน่งหรือซ้อนกัน
ภาษาอังกฤษ
4. สะกดผิด (spelling) เช่น "recieve" → "receive", "teh" → "the"
5. คำซ้ำติดกันโดยไม่ตั้งใจ เช่น "the the" → "the" และไวยากรณ์ที่ผิดชัดเจนมาก เช่น "a apple" → "an apple"
ทั้งสองภาษา
6. ตัวอักษรหรือคำของอีกภาษาที่หลุดเข้ามาผิดที่ เช่น "โครงกaาร" → "โครงการ"

ไม่ถือว่าผิด: ชื่อเฉพาะ ชื่อแบรนด์ ตัวย่อ คำทับศัพท์ ศัพท์เทคนิค ภาษาพูด/สแลง การสะกดแบบ US หรือ UK (color / colour) และเรื่องสไตล์การเลือกใช้คำ
ถ้าไม่แน่ใจ 100% ห้ามรายงาน

กติกาการตอบ:
- "original" ต้องคัดลอกจากต้นฉบับตรงตัวอักษร และสั้นที่สุด (1 คำ หรือไม่เกิน 15 ตัวอักษร) ห้ามเอาทั้งประโยค
- "suggestion" คือคำที่ถูกต้องที่ใช้แทน original
- "issue" อธิบายสั้น ๆ ไม่เกิน 8 คำ`
  }
};

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "proofread_result",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        errors: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              original: { type: "string" },
              suggestion: { type: "string" },
              issue: { type: "string" }
            },
            required: ["original", "suggestion", "issue"]
          }
        }
      },
      required: ["errors"]
    }
  }
};

/* ============================================================
 *  STATE / HELPERS
 * ============================================================ */
const $ = (id) => document.getElementById(id);
let customPresets = {};
let ignoreSet = new Set();
let findings = [];
let running = false;
let cancelled = false;
let pendingConfirm = null;
let live = null;
let deleteArmedKey = null;
let langs = { th: true, en: true };   // ภาษาที่เลือกตรวจ
let enDict = null;
let segmenter = null;   // Intl.Segmenter("th")
let dict = null;        // Set ของคำไทยจาก words_th.js

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function setStatus(msg, color) {
  const s = $("status");
  s.textContent = msg;
  s.className = color || "";
}
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn(e); }
}
function cname(o) {
  try { return o.constructorName || (o.constructor && o.constructor.name) || ""; } catch (e) { return ""; }
}
function getContents(o) {
  let c = o.contents;
  if (Array.isArray(c)) c = c.join("");
  return typeof c === "string" ? c : "";
}
// แสดงอักขระที่มองไม่เห็นให้อ่านออก
function visible(s) {
  let t = s.replace(/[\u200B-\u200D\u2060\uFEFF\uFFFD\uE000-\uF8FF]/g,
    (c) => "[U+" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0") + "]");
  if (!t.trim()) t = "[เว้นวรรค " + s.length + " ตัว]";
  return t;
}

/* ============================================================
 *  RULE-BASED CHECKS  (เร็ว ไม่ใช้ AI ไม่เดา)
 * ============================================================ */
// ==== RULES START ====
function runRules(text, opts) {
  const out = [];
  const add = (start, original, suggestion, issue) => out.push({ start, original, suggestion, issue });
  const scan = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) { fn(m); if (m[0].length === 0) re.lastIndex++; }
  };
  // เพิ่มพยัญชนะตัวหน้าเป็น context เพื่อให้อ่านง่าย
  const TH_ON = !opts || opts.th !== false;
  const scanTh = (re, fn) => { if (TH_ON) scan(re, fn); };
  const ctx = (idx, len, replacement, issue) => {
    const p = idx > 0 && /[\u0E01-\u0E2E]/.test(text[idx - 1]) ? text[idx - 1] : "";
    add(idx - p.length, p + text.substr(idx, len), replacement == null ? "" : p + replacement, issue);
  };

  // 1) สระ/วรรณยุกต์/อักขระซ้ำติดกัน (สระเบิ้ล, ะะ, เเ ฯลฯ)
  scanTh(/([\u0E30-\u0E3A\u0E40-\u0E4E])\1+/g, (m) => {
    if (m[1] === "\u0E40" && m[0].length === 2) return add(m.index, m[0], "\u0E41", "เ สองตัวติดกัน (น่าจะเป็น แ)");
    if (/[\u0E40-\u0E45]/.test(m[1])) return add(m.index, m[0], m[1], "อักขระซ้ำติดกัน");
    ctx(m.index, m[0].length, m[1], "สระ/วรรณยุกต์ซ้ำติดกัน");
  });

  // 2) สระบน/วรรณยุกต์ซ้อนผิดลำดับ (วรรณยุกต์ซ้อนวรรณยุกต์, วรรณยุกต์อยู่ก่อนสระบน ฯลฯ)
  scanTh(/[\u0E31\u0E34-\u0E37\u0E47]{2}|[\u0E48-\u0E4B]{2}|[\u0E48-\u0E4B][\u0E31\u0E34-\u0E37]/g, (m) => {
    if (m[0][0] === m[0][1]) return; // กรณีซ้ำตัวเดิม กฎข้อ 1 จับไปแล้ว
    ctx(m.index, m[0].length, null, "สระ/วรรณยุกต์ซ้อนกันผิดตำแหน่ง");
  });

  // 3) นิคหิต + สระอา (ํา) ควรเป็นสระอำ
  scanTh(/\u0E4D\u0E32/g, (m) => ctx(m.index, 2, "\u0E33", "นิคหิต+สระอา ควรใช้สระอำ"));

  // 4) สระ/วรรณยุกต์ลอย (ไม่มีพยัญชนะนำหน้า)
  scanTh(/(?:^|[^\u0E01-\u0E4E])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g,
    (m) => add(m.index, m[0], "", "สระ/วรรณยุกต์ลอย ไม่มีพยัญชนะนำหน้า"));

  // 5) ตัวอังกฤษ 1 ตัวแทรกกลางคำไทย
  scanTh(/[\u0E01-\u0E7F][A-Za-z][\u0E01-\u0E7F]/g,
    (m) => add(m.index, m[0], "", "ตัวอักษรอังกฤษแทรกกลางคำไทย"));

  // 6) อักขระแปลกปลอม / อักขระล่องหน / ฟอนต์ไทยเก่า (Private Use)
  scan(/[\uFFFD\uE000-\uF8FF\uFEFF\u200B-\u200D\u2060]/g, (m) => {
    const hex = "U+" + m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    const hidden = /[\uFEFF\u200B-\u200D\u2060]/.test(m[0]);
    add(m.index, m[0], "", (hidden ? "อักขระล่องหน " : "อักขระแปลกปลอม ") + hex);
  });

  // 7) พยัญชนะซ้ำ 3 ตัวขึ้นไป (มากกก, สบายยย)
  scanTh(/([\u0E01-\u0E2E])\1{2,}/g, (m) => add(m.index, m[0], m[1], "พยัญชนะซ้ำเกิน"));

  // 8) คำอังกฤษซ้ำติดกัน (the the)
  if (opts && opts.en) {
    scan(/\b([A-Za-z]{2,})[ \t]+\1\b/gi, (m) => add(m.index, m[0], m[1], "คำอังกฤษซ้ำติดกัน"));
  }

  // 9) เว้นวรรคไม้ยมก / เว้นวรรคซ้อน (เปิด/ปิดได้)
  if (opts && opts.spacing) {
    scanTh(/([\u0E01-\u0E45\u0E47-\u0E7F]{1,4})\u0E46/g,
      (m) => add(m.index, m[0], m[1] + " \u0E46", "ไม้ยมกต้องเว้นวรรคหน้า"));
    scanTh(/\u0E46[\u0E01-\u0E45\u0E47-\u0E7F]/g,
      (m) => add(m.index, m[0], "\u0E46 " + m[0][1], "ไม้ยมกต้องเว้นวรรคหลัง"));
    scan(/ {2,}/g, (m) => add(m.index, m[0], " ", "เว้นวรรคซ้อน"));
  }
  return out;
}
// ==== RULES END ====

/* ============================================================
 *  LM STUDIO
 * ============================================================ */
function normalizeForAI(text) {
  return text
    .replace(/\t/g, " ")
    .replace(/\r\n?|\u2028/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\uFFFC\u00AD]/g, "") // อักขระควบคุม/anchored object/discretionary hyphen ของ InDesign
    .replace(/\n+$/, "");
}

// ตัดที่ขอบคำไทย (ไม่ตัดกลางคำ) เมื่อไม่มีช่องว่างให้ตัด
function wordBoundaryBefore(s, limit) {
  if (!segmenter) return limit;
  let last = 0;
  for (const sg of segmenter.segment(s.slice(0, limit + 20))) {
    if (sg.index <= limit) last = sg.index; else break;
  }
  return last > limit * 0.5 ? last : limit;
}

function splitLong(s, limit) {
  const out = [];
  let rest = s;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(" ", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = wordBoundaryBefore(rest, limit);
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest.length) out.push(rest);
  return out;
}

// รวมย่อหน้าสั้น ๆ เป็น chunk เดียว / ซอยย่อหน้ายาวเป็นหลาย chunk
function buildChunks(units) {
  const chunks = [];
  let cur = { parts: [], units: [], len: 0 };
  const flush = () => { if (cur.parts.length) chunks.push(cur); cur = { parts: [], units: [], len: 0 }; };
  for (const u of units) {
    const clean = normalizeForAI(u.text);
    if (!wantText(clean)) continue;
    for (const piece of splitLong(clean, chunkLimit)) {
      if (cur.len + piece.length > chunkLimit && cur.parts.length) flush();
      cur.parts.push(piece);
      if (cur.units.indexOf(u) < 0) cur.units.push(u);
      cur.len += piece.length + 1;
    }
  }
  flush();
  return chunks;
}

function buildUserMessage(text, marked) {
  if (marked) {
    return `ข้อความด้านล่างเป็นตัวอย่างบริบทสั้น ๆ ระบบคัดมาให้และใส่เครื่องหมาย ${MARK_L} ${MARK_R} ครอบคำที่ "สงสัยว่าอาจผิด" (ยังไม่แน่ใจ อาจเป็นชื่อเฉพาะ ทับศัพท์ หรือคำที่ถูกอยู่แล้ว)
ให้ตรวจเฉพาะคำที่ถูกครอบ ถ้าผิดจริงให้รายงาน ถ้าถูกต้องห้ามรายงาน และในช่อง original ให้คัดลอกคำนั้นโดยไม่ต้องรวมเครื่องหมาย ${MARK_L} ${MARK_R}
ตอบเป็น JSON เท่านั้น ในรูปแบบ {"errors":[{"original":"...","suggestion":"...","issue":"..."}]} ถ้าไม่มีที่ผิดให้ตอบ {"errors":[]}

<<<
${text}
>>>`;
  }
  return `ตรวจพิสูจน์อักษรข้อความระหว่าง <<< และ >>> แล้วตอบเป็น JSON เท่านั้น ในรูปแบบ {"errors":[{"original":"...","suggestion":"...","issue":"..."}]}
ถ้าไม่พบจุดผิดให้ตอบ {"errors":[]}

<<<
${text}
>>>`;
}

// ==== PARSE START ====
// คืน array ของ {original,suggestion,issue}  หรือ null ถ้าอ่านผลไม่ออก
function parseModelJson(raw) {
  const s = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const tryParse = (str) => {
    const fixed = str.replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(fixed); } catch (e) {}
    try { return JSON.parse(fixed.replace(/[\u0000-\u001F]+/g, " ")); } catch (e) {}
    return undefined;
  };
  const pick = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.errors) ? v.errors : undefined);

  let r = pick(tryParse(s));
  if (r) return r;
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a && (r = pick(tryParse(s.slice(a, b + 1))))) return r;
  const c = s.indexOf("["), d = s.lastIndexOf("]");
  if (c >= 0 && d > c && (r = pick(tryParse(s.slice(c, d + 1))))) return r;

  const rec = [];
  for (const o of s.match(/\{[^{}]*"original"[^{}]*\}/g) || []) {
    const v = tryParse(o);
    if (v) rec.push(v);
  }
  if (rec.length) return rec;
  if (/"errors"\s*:\s*\[\s*\]/.test(s) || s === "[]") return [];
  return null;
}
// ==== PARSE END ====

/* ============================================================
 *  โหมด "จุดน่าสงสัย": ตัดคำด้วย Intl.Segmenter + เทียบพจนานุกรม
 *  แล้วส่งให้ AI ตัดสินเฉพาะจุด (เร็วกว่า และมโนน้อยกว่า)
 * ============================================================ */
function initSegmenter() {
  try {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return false;
    const sg = new Intl.Segmenter("th", { granularity: "word" });
    let n = 0;
    for (const x of sg.segment("สวัสดีครับขอบคุณมาก")) n++;
    if (n < 3) return false; // ถ้าไม่มีพจนานุกรมไทยใน ICU จะได้ก้อนเดียว
    segmenter = sg;
    return true;
  } catch (e) { return false; }
}

function dictAvailable() {
  return typeof THAI_WORDS_TEXT === "string" && THAI_WORDS_TEXT.length > 1000;
}

function enDictAvailable() {
  return typeof EN_WORDS_TEXT === "string" && EN_WORDS_TEXT.length > 1000;
}

function getEnDict() {
  if (enDict) return enDict;
  enDict = new Set();
  if (enDictAvailable()) EN_WORDS_TEXT.split("\n").forEach((w) => { if (w) enDict.add(w); });
  ignoreSet.forEach((w) => enDict.add(String(w).toLowerCase()));
  return enDict;
}

// คำนี้อยู่ต้นประโยคหรือไม่ (ดูอักขระก่อนหน้าโดยข้ามช่องว่าง/เครื่องหมายคำพูด)
function isSentenceStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /[ \t"\u201C\u2018'(\[]/.test(text[j])) j--;
  return j < 0 || /[.!?:\r\n\u2028]/.test(text[j]);
}

function getDict() {
  if (dict) return dict;
  dict = new Set();
  if (dictAvailable()) THAI_WORDS_TEXT.split("\n").forEach((w) => { if (w) dict.add(w); });
  ignoreSet.forEach((w) => dict.add(w)); // คำที่กด "ละเว้น" ถือเป็นคำที่ถูก
  return dict;
}

// คืนช่วงที่น่าสงสัย [{start,end,kind}] : oov = ไม่อยู่ในพจนานุกรม, mixed = ไทยปนอังกฤษในคำเดียว, dup = คำซ้ำติดกัน
function findCandidates(text) {
  const D = getDict();
  const out = [];
  let prev = null;
  for (const sg of segmenter.segment(text)) {
    const s = sg.segment;
    const start = sg.index;
    const end = start + s.length;
    // --- คำอังกฤษ ---
    if (LATIN_WORD.test(s)) {
      if (!langs.en || !enDictAvailable()) { prev = null; continue; }
      const lower = s.toLowerCase().replace(/['\u2019]s$/, "");
      let kind = null;
      const odd = /[A-Z]/.test(s.slice(1));                 // iPhone / NASA / camelCase -> ข้าม
      const capital = /^[A-Z]/.test(s);
      if (lower.length >= 3 && !odd && (!capital || isSentenceStart(text, start)) && !getEnDict().has(lower)) kind = "en";
      if (!kind && prev && prev.lang === "en" && prev.bare === lower && lower.length >= 2) {
        out.push({ start: prev.start, end, kind: "dup" });
        prev = null;
        continue;
      }
      if (kind) out.push({ start, end, kind });
      prev = { bare: lower, start, end, lang: "en" };
      continue;
    }
    if (!THAI.test(s)) { if (!/^\s+$/.test(s)) prev = null; continue; }
    if (!langs.th || !dictAvailable()) { prev = null; continue; }
    const bare = s.replace(/[\u0E46\u0E2F]/g, "");
    if (!bare) { prev = null; continue; }

    let kind = null;
    if (/[A-Za-z0-9]/.test(bare)) kind = "mixed";
    else if (!D.has(bare) && bare !== "ณ" && !/^[\u0E50-\u0E59]+$/.test(bare)) {
      if (!(text[end] === "." && bare.length <= 2)) kind = "oov"; // ข้ามตัวย่อ เช่น "น."
    }
    if (!kind && prev && prev.bare === bare && bare.length >= 2) {
      out.push({ start: prev.start, end, kind: "dup" });
      prev = null;
      continue;
    }
    if (kind) out.push({ start, end, kind });
    prev = { bare, start, end };
  }
  return out;
}

function buildCandidateChunks(units) {
  const chunks = [];
  let cur = { parts: [], units: [], len: 0, marked: true };
  const flush = () => { if (cur.parts.length) chunks.push(cur); cur = { parts: [], units: [], len: 0, marked: true }; };
  let total = 0;
  const list = [];

  for (const u of units) {
    const cands = findCandidates(u.text);
    if (!cands.length) continue;
    total += cands.length;
    cands.forEach((c) => list.push({ unit: u, start: c.start, len: c.end - c.start, kind: c.kind }));

    const wins = [];
    for (const c of cands) {
      const ws = Math.max(0, c.start - CAND_CONTEXT);
      const we = Math.min(u.text.length, c.end + CAND_CONTEXT);
      const last = wins[wins.length - 1];
      if (last && ws <= last.end + 5) { last.end = Math.max(last.end, we); last.cands.push(c); }
      else wins.push({ start: ws, end: we, cands: [c] });
    }
    for (const w of wins) {
      let snip = u.text.slice(w.start, w.end);
      let limit = Infinity; // ใส่เครื่องหมายจากขวาไปซ้าย ข้ามช่วงที่ซ้อนกัน
      for (let k = w.cands.length - 1; k >= 0; k--) {
        const a = w.cands[k].start - w.start;
        const b = w.cands[k].end - w.start;
        if (b > limit) continue;
        snip = snip.slice(0, a) + MARK_L + snip.slice(a, b) + MARK_R + snip.slice(b);
        limit = a;
      }
      snip = normalizeForAI(snip);
      if (cur.len + snip.length > chunkLimit && cur.parts.length) flush();
      cur.parts.push(snip);
      if (cur.units.indexOf(u) < 0) cur.units.push(u);
      cur.len += snip.length + 1;
    }
  }
  flush();
  return { chunks, total, list };
}

/* ============================================================
 *  อ่านข้อความจาก InDesign
 * ============================================================ */
function collectUnits(scope) {
  const doc = app.activeDocument;
  const units = [];
  const seen = new Set();

  const addText = (story, keyPrefix) => {
    if (!story) return;
    let id;
    try { id = story.id; } catch (e) {}
    if (id !== undefined) { const k = keyPrefix + id; if (seen.has(k)) return; seen.add(k); }
    const paras = story.paragraphs;
    const n = paras.length;
    let texts = null;
    try { const t = paras.everyItem().contents; if (Array.isArray(t) && t.length === n) texts = t; } catch (e) {}
    for (let i = 0; i < n; i++) {
      const p = paras.item(i);
      units.push({ obj: p, text: texts ? texts[i] : getContents(p) });
    }
  };

  if (scope === "page") {
    // ทั้งหน้าปัจจุบัน: ตรวจเฉพาะข้อความที่อยู่ในกรอบบนหน้านี้ (กรอบที่ต่อไปหน้าอื่นจะได้เฉพาะส่วนในกรอบนี้)
    let page = null;
    try { page = app.activeWindow.activePage; } catch (e) {}
    if (!page) throw new Error("ไม่พบหน้าปัจจุบัน (ต้องอยู่ในมุมมอง Layout ไม่ใช่ Story Editor)");
    const items = page.allPageItems;
    for (let i = 0; i < items.length; i++) {
      if (cname(items[i]) === "TextFrame") addText(items[i], "f");
    }
  } else if (scope === "document") {
    const stories = doc.stories;
    for (let i = 0; i < stories.length; i++) addText(stories.item(i), "s");
  } else {
    const sel = app.selection;
    if (!sel || sel.length === 0) {
      throw new Error("ยังไม่ได้เลือกอะไร: คลิกในกรอบข้อความ / ลากเลือกข้อความ / เลือกกรอบ (หรือเปลี่ยนขอบเขตเป็น 'หน้าปัจจุบัน' หรือ 'ทั้งเอกสาร')");
    }
    for (let i = 0; i < sel.length; i++) {
      const item = sel[i];
      const cn = cname(item);
      if (cn === "Table" || cn === "Row" || cn === "Column" || cn === "Cell") {
        // ตาราง/แถว/คอลัมน์/เซลล์: ตรวจทีละเซลล์
        if (cn === "Cell") addText(item, "c");
        else {
          const cells = item.cells;
          for (let j = 0; j < cells.length; j++) addText(cells.item(j), "c");
        }
      } else if (cn === "TextFrame" || cn === "InsertionPoint") {
        addText(item.parentStory, "s");        // กรอบ/วางเคอร์เซอร์ = ทั้ง story (รวมกรอบที่ต่อกัน)
      } else if (item.parentStory && typeof item.contents !== "undefined") {
        const t = getContents(item);           // ปาดเลือกข้อความ = เฉพาะที่ปาด
        if (t) units.push({ obj: item, text: t });
      } else if (item.textFrames && item.textFrames.length) {
        for (let j = 0; j < item.textFrames.length; j++) addText(item.textFrames.item(j).parentStory, "s");
      } else if (item.paragraphs && item.paragraphs.length) {
        addText(item, "o"); // ชนิดอื่นที่มีข้อความ (ตัวดักสุดท้าย)
      }
    }
  }
  units.forEach((u, i) => { u.idx = i; });
  return units;
}

/* ============================================================
 *  ไปที่คำใน InDesign (เหมือน Find: เลือกคำ + เลื่อนหน้าจอไปให้)
 * ============================================================ */
function findFirst(obj, str) {
  try {
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
    app.findChangeTextOptions.caseSensitive = true;
    app.findChangeTextOptions.wholeWord = false;
    app.findTextPreferences.findWhat = str.replace(/\^/g, "^^"); // ^ เป็น meta char ของ Find
    const found = obj.findText();
    return found && found.length ? found[0] : null;
  } finally {
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) {}
  }
}

function locate(pos) {
  const unit = pos.unit;
  const expected = unit.text.substr(pos.start, pos.len);
  let cur;
  try { cur = getContents(unit.obj); } catch (e) { return { err: "ข้อความต้นทางถูกลบ/เปลี่ยนไปแล้ว กรุณากดตรวจใหม่" }; }
  if (cur !== unit.text) return { err: "ข้อความในเอกสารเปลี่ยนไปแล้ว กรุณากดตรวจใหม่" };
  try { // วิธีหลัก: ระบุตำแหน่งตัวอักษรตรง ๆ (แม่นกว่าการค้นหาคำ)
    const r = unit.obj.characters.itemByRange(pos.start, pos.start + pos.len - 1);
    if (getContents(r) === expected) return { range: r };
  } catch (e) {}
  try { // สำรอง: ใช้ Find
    const r = findFirst(unit.obj, expected);
    if (r) return { range: r };
  } catch (e) {}
  return { err: "หาตำแหน่งในเอกสารไม่เจอ" };
}

function goTo(f, btn) {
  const n = f.positions.length;
  const idx = f.cursor % n;
  f.cursor = idx + 1;
  const res = locate(f.positions[idx]);
  if (res.err) { setStatus("" + res.err, RED); return; }
  try {
    let pageObj = null;
    try {
      const tfs = res.range.parentTextFrames;
      if (tfs.length) pageObj = tfs[0].parentPage;
    } catch (e) {}
    // เด้งไปหน้าที่เจอ เฉพาะเมื่อไม่ได้อยู่หน้านั้นอยู่แล้ว (ถ้าอยู่หน้าเดียวกันจะไม่เลื่อนหน้า)
    if (pageObj) {
      try {
        const win = app.activeWindow;
        if (win.activePage.documentOffset !== pageObj.documentOffset) win.activePage = pageObj;
      } catch (e) {}
    }
    app.select(res.range);
    if (!pageObj) setStatus("ข้อความนี้อยู่ในส่วนที่ล้นกรอบ (overset) หรืออยู่นอกหน้า จึงมองไม่เห็น", RED);
    else setStatus(`เลือกคำแล้ว · หน้า ${pageObj.name}${n > 1 ? ` (ตำแหน่งที่ ${idx + 1}/${n})` : ""}`);
  } catch (e) {
    setStatus("เลือกข้อความไม่สำเร็จ: " + (e.message || e), RED);
  }
  if (btn && n > 1) btn.textContent = `ไปที่จุดนี้ (${idx + 1}/${n} · กดเพื่อไปจุดถัดไป)`;
}

/* ============================================================
 *  RESULT LIST
 * ============================================================ */
function pageOfFrame(tf) {
  try {
    const pg = tf.parentPage;
    return pg ? { name: String(pg.name), offset: pg.documentOffset } : null;
  } catch (e) { return null; }
}

// หาว่าตำแหน่งนี้อยู่หน้าไหน (cache ต่อ unit; ถ้า unit คร่อมหลายกรอบค่อยดูที่ตัวอักษรจริง)
function resolvePage(pos) {
  if (pos.pageDone) return pos.page;
  pos.pageDone = true;
  pos.page = null;
  const u = pos.unit;
  try {
    if (u.frameCount === undefined) u.frameCount = u.obj.parentTextFrames.length;
    if (u.frameCount === 1) {
      if (u.pageCache === undefined) u.pageCache = pageOfFrame(u.obj.parentTextFrames[0]);
      pos.page = u.pageCache;
    } else if (u.frameCount > 1) {
      const r = u.obj.characters.itemByRange(pos.start, pos.start + pos.len - 1);
      pos.page = pageOfFrame(r.parentTextFrames[0]);
    }
  } catch (e) {}
  return pos.page;
}

function pageLabel(f) {
  const names = [];
  f.positions.forEach((p) => {
    const pg = resolvePage(p);
    const n = pg ? pg.name : "ล้นกรอบ";
    if (names.indexOf(n) < 0) names.push(n);
  });
  return "หน้า " + names.slice(0, 4).join(", ") + (names.length > 4 ? "…" : "");
}

function makeFinding(kind, original, suggestion, issue, positions) {
  const pg = resolvePage(positions[0]);
  return {
    kind, original, suggestion, issue, positions, cursor: 0,
    pageOffset: pg ? pg.offset : 1e9,
    key: positions[0].unit.idx * 1e7 + positions[0].start
  };
}

function buildCard(f) {
  const card = el("div", "card");

  const head = el("div");
  head.appendChild(el("span", "tag-" + f.kind, f.kind === "rule" ? "กฎ" : f.kind === "cand" ? "สงสัย" : f.kind === "svc" ? "สะกด" : "AI"));
  head.appendChild(el("span", "err-tag", " "));
  head.appendChild(el("b", "", visible(f.original)));
  card.appendChild(head);
  card.appendChild(el("div", "issue", "" + pageLabel(f)));

  if (f.suggestion) {
    const sug = el("div");
    sug.appendChild(el("span", "sug-tag", "แก้เป็น: "));
    sug.appendChild(el("b", "", visible(f.suggestion)));
    card.appendChild(sug);
  }
  if (f.issue) card.appendChild(el("div", "issue", "สาเหตุ: " + f.issue));

  const row = el("div", "btn-row");
  const goBtn = el("button", "",
    "ไปที่จุดนี้" + (f.positions.length > 1 ? ` (พบ ${f.positions.length} ตำแหน่ง)` : ""));
  goBtn.addEventListener("click", () => goTo(f, goBtn));
  const ignBtn = el("button", "", "ละเว้น");
  ignBtn.title = "ไม่ใช่คำผิด – ไม่ต้องแจ้งอีกในครั้งต่อไป";
  ignBtn.addEventListener("click", () => {
    ignoreSet.add(f.original);
    if (dict) dict.add(f.original);
    lsSet(K_IGNORE, Array.from(ignoreSet));
    f.hidden = true;
    updateIgnoreLabel();
    renderFindings();
  });
  row.appendChild(goBtn);
  row.appendChild(ignBtn);
  card.appendChild(row);
  return card;
}

function renderFindings() {
  const list = $("resultList");
  list.innerHTML = "";
  findings.filter((f) => !f.hidden).sort((a, b) => a.pageOffset - b.pageOffset || a.key - b.key).forEach((f) => list.appendChild(buildCard(f)));
}

function updateIgnoreLabel() {
  $("btnClearIgnore").textContent = `ล้างรายการคำที่ละเว้น (${ignoreSet.size})`;
}

/* ============================================================
 *  MAIN
 * ============================================================ */
function setDisabled(elm, on) {
  elm.disabled = on;
  if (on) elm.setAttribute("disabled", ""); else elm.removeAttribute("disabled");
}

function toggleRunning(on) {
  running = on;
  setDisabled($("btnCheck"), on);
  $("btnCancel").style.display = on ? "block" : "none";
}

/* ============================================================
 *  Progress / สถิติ
 * ============================================================ */
function progressStart(total, label) {
  progressEnd();
  live = { total, done: 0, busy: 0, t0: Date.now(), label, timer: null };
  $("progressWrap").style.display = "block";
  progressRender();
  live.timer = setInterval(progressRender, 500);
}
function progressRender() {
  if (!live) return;
  const pct = live.total ? Math.round((live.done / live.total) * 100) : 0;
  $("progressFill").style.width = pct + "%";
  const sec = (Date.now() - live.t0) / 1000;
  let eta = "";
  if (live.done > 0 && live.done < live.total) eta = ` · เหลือประมาณ ${Math.ceil((sec / live.done) * (live.total - live.done))} วิ`;
  $("progressText").textContent = `${live.label} ${live.done}/${live.total} (${pct}%)` +
    (live.busy ? ` · รอโมเดล ${live.busy} request` : "") + ` · ผ่านไป ${Math.round(sec)} วิ` + eta;
}
function progressEnd() {
  if (live && live.timer) clearInterval(live.timer);
  live = null;
  $("progressWrap").style.display = "none";
}
function renderStats() { $("statsLine").textContent = Tele.summary(); }

async function runPool(limit, n, fn) {
  let next = 0;
  const workers = [];
  for (let w = 0; w < Math.min(Math.max(1, limit), n); w++) {
    workers.push((async () => { while (next < n) { const i = next++; await fn(i); } })());
  }
  await Promise.all(workers);
}

// รับผลจาก AI / บริการสะกด -> ตรวจว่ามีอยู่จริงในต้นฉบับ -> สร้างรายการ
function applyItems(items, chunkUnits, kind, ctx) {
  const strip = (x) => x.split(MARK_L).join("").split(MARK_R).join("").trim();
  for (const it of items) {
    if (!it || typeof it.original !== "string") continue;
    const original = strip(it.original);
    const suggestion = typeof it.suggestion === "string" ? strip(it.suggestion) : "";
    if (!original || original === suggestion || original.length > MAX_ORIGINAL_LEN || ignoreSet.has(original)) continue;

    // กันมโน: ต้องหา original เจอในต้นฉบับจริง
    const positions = [];
    let found = false;
    for (const u of chunkUnits) {
      let from = 0, at;
      while (positions.length < 50 && (at = u.text.indexOf(original, from)) >= 0) {
        found = true;
        if (!ctx.taken.has(u.idx + ":" + at)) positions.push({ unit: u, start: at, len: original.length });
        from = at + original.length;
      }
    }
    if (!positions.length) { if (!found) ctx.stat.dropped++; continue; } // เจอแต่ถูกรายงานโดยกฎไปแล้ว = ข้ามเฉย ๆ

    const mkey = kind + "|" + original + "|" + suggestion;
    if (ctx.merged.has(mkey)) {
      const f = ctx.merged.get(mkey);
      positions.forEach((p) => { if (!f.positions.some((q) => q.unit === p.unit && q.start === p.start)) f.positions.push(p); });
    } else {
      const f = makeFinding(kind, original, suggestion, String(it.issue || ""), positions);
      ctx.merged.set(mkey, f);
      findings.push(f);
      if (kind === "svc") ctx.stat.svc++; else ctx.stat.ai++;
    }
  }
}

async function runCheck() {
  if (running) return;
  if (app.documents.length === 0) return setStatus("กรุณาเปิดเอกสาร InDesign ก่อน", RED);

  const useRules = $("chkRules").checked;
  const useAI = $("chkAI").checked;
  const useService = $("chkService").checked;
  const spacing = $("chkSpacing").checked;
  const scope = $("scopeSelect").value;
  langs = { th: $("chkTH").checked, en: $("chkEN").checked };
  if (!langs.th && !langs.en) return setStatus("เลือกภาษาที่จะตรวจอย่างน้อย 1 ภาษา", RED);
  if (!useRules && !useAI && !useService) return setStatus("เลือกวิธีตรวจอย่างน้อย 1 อย่าง", RED);

  let units;
  try { units = collectUnits(scope); } catch (e) { return setStatus("" + (e.message || e), RED); }
  units = units.filter((u) => wantText(u.text));
  if (!units.length) {
    let kind = "";
    try { if (scope === "selection") kind = ` (ชนิดที่เลือก: ${cname(app.selection[0]) || "ไม่ทราบ"})`; } catch (e) {}
    return setStatus("ไม่พบข้อความที่จะตรวจในขอบเขตที่เลือก (ตรวจภาษาที่เลือกไว้)" + kind, RED);
  }

  // ---- ตรวจความพร้อมของผู้ให้บริการ AI ----
  const profile = activeProfile();
  const pr = presetOf(profile);
  if (useAI) {
    if (!profile.baseUrl) return setStatus("ยังไม่ได้ตั้ง Base URL (โมเดล AI > ตั้งค่า)", RED);
    if (pr.needsKey && !keyCache[profile.id]) return setStatus(`ยังไม่ได้ใส่ API key ของ "${profile.name}" (โมเดล AI > ตั้งค่า)`, RED);
    if (pr.cloud && !profile.cloudAck) return setStatus(`"${profile.name}" เป็นบริการ cloud : ข้อความในเอกสารจะถูกส่งออกจากเครื่อง ติ๊กยอมรับที่ โมเดล AI > ตั้งค่า ก่อนใช้งาน`, RED);
    if (pr.cloud && !profile.model) return setStatus("เลือกหรือพิมพ์ชื่อโมเดลก่อน (โมเดล AI > ตั้งค่า)", RED);
  }
  const cfg = { system: $("systemPrompt").value.trim(), maxTokens: parseInt($("maxTokensInput").value, 10) || 1500 };

  // ---- วางแผน chunk ก่อน (เพื่อประมาณการ) ----
  let candList = [];
  const stat = { rule: 0, ai: 0, svc: 0, dropped: 0, badChunks: 0, failChunks: 0, fatal: null, cands: 0, noCands: false, unconfirmed: 0, svcErr: "" };
  let aiChunks = [];
  if (useAI) {
    chunkLimit = profile.chunkLimit;
    if ($("aiMode").value === "candidates" && segmenter && (dictAvailable() || enDictAvailable())) {
      const r = buildCandidateChunks(units);
      aiChunks = r.chunks;
      stat.cands = r.total;
      candList = r.list;
      if (!aiChunks.length) stat.noCands = true;
    } else {
      aiChunks = buildChunks(units);
    }
    if (pr.cloud && aiChunks.length) {  // cloud + งานใหญ่ -> ให้กดยืนยันอีกครั้งพร้อมแสดงประมาณการ
      const chars = aiChunks.reduce((a, c) => a + c.len, 0);
      if (scope === "document" || aiChunks.length > 15) {
        const sig = [profile.id, scope, aiChunks.length, chars].join("|");
        if (!pendingConfirm || pendingConfirm.sig !== sig || Date.now() - pendingConfirm.t > 30000) {
          pendingConfirm = { sig, t: Date.now() };
          return setStatus(`จะส่ง ${aiChunks.length} request (ประมาณ ${chars} ตัวอักษร) ไปยัง ${profile.name} (cloud) กดปุ่มตรวจอีกครั้งภายใน 30 วินาทีเพื่อยืนยัน`);
        }
        pendingConfirm = null;
      }
    }
  }

  findings = [];
  cancelled = false;
  $("resultList").innerHTML = "";
  Tele.reset();
  renderStats();
  toggleRunning(true);

  try {
    // ---- 1) กฎ (ทันที) ----
    if (useRules) {
      for (const u of units) {
        for (const r of runRules(u.text, { spacing, th: langs.th, en: langs.en })) {
          if (ignoreSet.has(r.original)) continue;
          findings.push(makeFinding("rule", r.original, r.suggestion, r.issue, [{ unit: u, start: r.start, len: r.original.length }]));
        }
      }
      stat.rule = findings.length;
      renderFindings();
    }
    const ctx = { taken: new Set(), merged: new Map(), stat };
    findings.forEach((f) => f.positions.forEach((p) => ctx.taken.add(p.unit.idx + ":" + p.start)));

    // ---- 2) บริการตรวจสะกด (PyThaiNLP) ----
    if (useService) {
      const svcUrl = $("serviceUrl").value.trim();
      if (!svcUrl) {
        stat.svcErr = "ยังไม่ได้ใส่ URL บริการตรวจสะกด";
      } else {
        const keep = chunkLimit;
        chunkLimit = 2500;
        const sc = buildChunks(units);
        chunkLimit = keep;
        setStatus("กำลังตรวจด้วยบริการสะกด...");
        progressStart(sc.length, "บริการสะกด");
        for (let i = 0; i < sc.length; i++) {
          if (cancelled) break;
          try {
            const items = await serviceCheck(svcUrl, sc[i].parts.join("\n"), langs, 30);
            applyItems(items, sc[i].units, "svc", ctx);
          } catch (e) {
            stat.svcErr = friendlyError(e, { name: "บริการตรวจสะกด", baseUrl: svcUrl });
            break;
          }
          live.done++;
          renderFindings();
        }
        progressEnd();
      }
    }

    // ---- 3) AI (ทำงานพร้อมกันได้ตามค่า parallel ของโปรไฟล์) ----
    if (useAI && aiChunks.length && !cancelled) {
      const total = aiChunks.length;
      setStatus(`AI (${profile.name}) กำลังตรวจ ${total} ช่วง ดูความคืบหน้าด้านล่าง`);
      progressStart(total, "AI");
      const worker = async (i) => {
        if (cancelled || stat.fatal) return;
        const chunk = aiChunks[i];
        const req = { system: cfg.system, user: buildUserMessage(chunk.parts.join("\n"), chunk.marked), maxTokens: cfg.maxTokens };
        if (live) live.busy++;
        try {
          const r = await providerComplete(profile, req);
          Tele.ok(r, `ช่วง ${i + 1}/${total}`);
          setHealth("ok", `ทำงานปกติ (${(r.ms / 1000).toFixed(1)} วิ)`);
          const items = parseModelJson(r.text);
          if (items === null) {
            stat.badChunks++;
            Tele.parseBad++;
            Tele.add(`ช่วง ${i + 1}: ตอบผิดรูปแบบ` + (r.finish === "length" ? " (ถูกตัดเพราะ MAX TOKENS)" : ""));
          } else {
            applyItems(items, chunk.units, "ai", ctx);
          }
        } catch (e) {
          const msg = friendlyError(e, profile);
          Tele.failed(`ช่วง ${i + 1}/${total}`, msg);
          setHealth("bad", msg);
          if (isFatalError(e)) stat.fatal = new Error(msg); else stat.failChunks++;
        } finally {
          if (live) { live.busy--; live.done++; }
          renderFindings();
          renderStats();
        }
      };
      await runPool(profile.parallel, total, worker);
      progressEnd();
    }

    // ---- 4) จุดน่าสงสัยที่ AI ไม่ยืนยัน -> ให้ผู้ใช้ดูเอง ----
    if (candList.length) {
      const overlaps = (c) => findings.some((f) => f.kind !== "cand" && f.positions.some((p) =>
        p.unit === c.unit && p.start < c.start + c.len && c.start < p.start + p.len));
      const KIND = {
        oov: "ไม่พบในพจนานุกรม (AI ไม่ยืนยันว่าผิด อาจเป็นชื่อเฉพาะ/คำใหม่)",
        dup: "คำซ้ำติดกัน (AI ไม่ยืนยันว่าผิด)",
        mixed: "ไทยปนอังกฤษในคำเดียว (AI ไม่ยืนยันว่าผิด)",
        en: "ไม่พบในพจนานุกรมอังกฤษ (AI ไม่ยืนยันว่าผิด อาจเป็นชื่อ/ศัพท์เฉพาะ)"
      };
      const byWord = new Map();
      for (const c of candList) {
        const word = c.unit.text.substr(c.start, c.len).trim();
        if (!word || ignoreSet.has(word) || overlaps(c)) continue;
        const key = c.kind + "|" + word;
        if (byWord.has(key)) { byWord.get(key).positions.push({ unit: c.unit, start: c.start, len: c.len }); continue; }
        const f = makeFinding("cand", word, "", KIND[c.kind] || "น่าสงสัย", [{ unit: c.unit, start: c.start, len: c.len }]);
        byWord.set(key, f);
        findings.push(f);
        stat.unconfirmed++;
      }
      renderFindings();
    }
  } finally {
    progressEnd();
    toggleRunning(false);
    renderStats();
  }

  // ---- สรุป ----
  const visibleCount = findings.filter((f) => !f.hidden && f.kind !== "cand").length;
  const candShown = findings.filter((f) => !f.hidden && f.kind === "cand").length;
  const notes = [];
  if (candShown) notes.push(`จุดน่าสงสัยที่ AI ไม่ยืนยัน ${candShown} จุด (ดูในรายการ ป้าย "สงสัย")`);
  if (stat.noCands) notes.push("ไม่พบจุดน่าสงสัยตามพจนานุกรม (AI ไม่ได้ถูกเรียก)");
  if (stat.dropped) notes.push(`ตัดทิ้ง ${stat.dropped} จุดที่หาไม่เจอในต้นฉบับ`);
  if (stat.badChunks) notes.push(`${stat.badChunks} ช่วงที่ AI ตอบผิดรูปแบบ (ถ้าเป็นโมเดล thinking ให้เพิ่ม MAX TOKENS)`);
  if (stat.failChunks) notes.push(`${stat.failChunks} ช่วงที่เรียก AI ไม่สำเร็จ (ดูบันทึกการทำงาน)`);
  if (stat.svcErr) notes.push(stat.svcErr);
  if (cancelled) notes.push("หยุดก่อนครบ");
  if (stat.fatal) {
    setStatus(`${stat.fatal.message || stat.fatal}${visibleCount ? `  (ผลที่ได้ก่อนหน้า ${visibleCount} จุด)` : ""}`, RED);
  } else if (visibleCount === 0) {
    setStatus((candShown ? "AI ไม่ยืนยันจุดผิด" : "ไม่พบจุดผิด") + (notes.length ? "  ·  " + notes.join(" · ") : ""), GREEN);
  } else {
    const parts = [`กฎ ${stat.rule}`];
    if (useService) parts.push(`สะกด ${stat.svc}`);
    if (useAI) parts.push(`AI ${stat.ai}`);
    setStatus(`พบ ${visibleCount} จุด (${parts.join(" / ")})` + (notes.length ? "  ·  " + notes.join(" · ") : ""));
  }
}

/* ============================================================
 *  PRESETS (ผูก event ครั้งเดียว)
 * ============================================================ */
function getPresetPrompt(key) {
  return (BUILTIN_PRESETS[key] || customPresets[key] || {}).prompt || "";
}
function renderPresetOptions(selectedKey) {
  const sel = $("presetSelect");
  sel.innerHTML = "";
  const add = (k, label) => { const o = el("option", "", label); o.value = k; sel.appendChild(o); };
  Object.keys(BUILTIN_PRESETS).forEach((k) => add(k, BUILTIN_PRESETS[k].name));
  Object.keys(customPresets).forEach((k) => add(k, "* " + customPresets[k].name));
  sel.value = BUILTIN_PRESETS[selectedKey] || customPresets[selectedKey] ? selectedKey : "strict_proofread";
  $("systemPrompt").value = getPresetPrompt(sel.value);
}
function disarmDelete() {
  deleteArmedKey = null;
  $("btnDeletePreset").textContent = "ลบ Preset นี้";
}

function initPresets() {
  customPresets = lsGet(K_PRESETS, {});
  renderPresetOptions("strict_proofread");

  $("presetSelect").addEventListener("change", () => {
    $("systemPrompt").value = getPresetPrompt($("presetSelect").value);
    disarmDelete();
  });
  $("btnResetPrompt").addEventListener("click", () => {
    renderPresetOptions("strict_proofread");
    disarmDelete();
  });
  $("btnSavePreset").addEventListener("click", () => {
    const prompt = $("systemPrompt").value.trim();
    const name = $("presetName").value.trim();
    if (!prompt) return setStatus("ยังไม่มีข้อความ System Instruction ให้บันทึก", RED);
    if (!name) return setStatus("พิมพ์ชื่อ Preset ในช่องก่อนกดบันทึก", RED);
    const key = "custom_" + Date.now();
    customPresets[key] = { name, prompt };
    lsSet(K_PRESETS, customPresets);
    renderPresetOptions(key);
    $("presetName").value = "";
    setStatus("บันทึก Preset แล้ว", GREEN);
  });
  $("btnDeletePreset").addEventListener("click", () => {
    const key = $("presetSelect").value;
    if (BUILTIN_PRESETS[key]) return setStatus("ลบ Preset มาตรฐานไม่ได้", RED);
    if (deleteArmedKey !== key) { // กดครั้งแรก = ขอยืนยัน (UXP ไม่มี confirm())
      deleteArmedKey = key;
      $("btnDeletePreset").textContent = "กดอีกครั้งเพื่อลบ";
      setTimeout(() => { if (deleteArmedKey === key) disarmDelete(); }, 3000);
      return;
    }
    delete customPresets[key];
    lsSet(K_PRESETS, customPresets);
    disarmDelete();
    renderPresetOptions("strict_proofread");
    setStatus("ลบ Preset แล้ว");
  });
}

/* ============================================================
 *  INIT
 * ============================================================ */
/* ============================================================
 *  UI: accordion + ธีม
 * ============================================================ */
function initAccordions() {
  const state = lsGet(K_ACC, {});
  const accs = document.getElementsByClassName("acc");
  for (let i = 0; i < accs.length; i++) {
    const acc = accs[i];
    const head = acc.getElementsByClassName("acc-head")[0];
    const body = acc.getElementsByClassName("acc-body")[0];
    const ind = acc.getElementsByClassName("acc-ind")[0];
    if (!head || !body) continue;
    const apply = (open) => {
      body.style.display = open ? "block" : "none";
      if (ind) ind.textContent = open ? "-" : "+";
    };
    let open = state[acc.id] !== undefined ? !!state[acc.id] : acc.getAttribute("data-open") === "1";
    apply(open);
    head.addEventListener("click", () => {
      open = !open;
      apply(open);
      state[acc.id] = open;
      lsSet(K_ACC, state);
    });
  }
}

const THEME_LABEL = { auto: "อัตโนมัติ", dark: "มืด (ตัวอักษรขาว)", light: "สว่าง (ตัวอักษรเข้ม)" };
function applyTheme(mode) {
  document.documentElement.className = mode === "dark" ? "theme-dark" : mode === "light" ? "theme-light" : "";
  $("btnTheme").textContent = "ธีม: " + THEME_LABEL[mode] + " (กดเพื่อเปลี่ยน)";
}
function initTheme() {
  let mode = lsGet(K_THEME, "auto");
  if (!THEME_LABEL[mode]) mode = "auto";
  applyTheme(mode);
  $("btnTheme").addEventListener("click", () => {
    mode = mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto";
    lsSet(K_THEME, mode);
    applyTheme(mode);
  });
}

function init() {
  initAccordions();
  // ลบ initTheme(); ออกจากตรงนี้
  ignoreSet = new Set(lsGet(K_IGNORE, []));
  initPresets();
  if (!(initSegmenter() && (dictAvailable() || enDictAvailable()))) { 
    const opt = $("aiMode").querySelector('option[value="candidates"]');
    if (opt) { opt.disabled = true; opt.textContent = "จุดน่าสงสัย (ใช้ไม่ได้: ไม่พบ Intl.Segmenter หรือ words_th.js / words_en.js)"; }
    $("aiMode").value = "full";
  }
  updateIgnoreLabel();
  initSettings();
  $("btnClearIgnore").addEventListener("click", () => {
    ignoreSet.clear();
    lsSet(K_IGNORE, []);
    updateIgnoreLabel();
    setStatus("ล้างรายการคำที่ละเว้นแล้ว");
  });
  $("btnCheck").addEventListener("click", runCheck);
  $("btnCancel").addEventListener("click", () => { cancelled = true; setStatus("กำลังหยุด..."); });
}

init();