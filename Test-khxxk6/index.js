"use strict";
const { app, NothingEnum, ScriptLanguage, UndoModes } = require("indesign");

/* ============================================================
 *  CONFIG
 * ============================================================ */
let chunkLimit = 800;
const MAX_ORIGINAL_LEN = 30;
const K_PRESETS = "ai_proofread_custom_presets";
const K_IGNORE = "ai_proofread_ignore";
const THAI = /[\u0E01-\u0E7F]/;
const LATIN_WORD = /^[A-Za-z][A-Za-z'\u2019]*$/;

function wantText(t) { return (langs.th && THAI.test(t)) || (langs.en && /[A-Za-z]{3}/.test(t)); }
const MARK_L = "【";
const MARK_R = "】";
const CAND_CONTEXT = 30;
const RED = "err";
const GREEN = "ok";
const K_ACC = "ai_proofread_accordion";

const BUILTIN_PRESETS = {
  strict_proofread: {
    name: "Proofreader ไทย + อังกฤษ",
    prompt: `คุณคือ "นักพิสูจน์อักษร" (Proofreader) ที่เชี่ยวชาญทั้งภาษาไทยและภาษาอังกฤษ ไม่ใช่บรรณาธิการ โดยมีหน้าที่ในการตรวจแต่ละภาษาทั้งไทยและอังกฤษ ตามเงื่อนไขของภาษานั้น ๆ เช่น ภาษาไทยใช้หลักของราชบัณฑิตยสถาน ส่วนภาษาอังกฤษใช้หลักของ Cambridge หรือ Oxford ก็ได้ โดยอิงจากบริบทในข้อความ หน้าที่คือ ตรวจหาคำผิด ชี้เฉพาะจุดที่มีคำที่สะกดผิด สะกดเกิน เจออักขระผิดตำแหน่ง เจอสระหรือวรรณยุกต์ซ็อน เป็นต้น ทำหน้าที่ ตรวจพิสูจน์อักษร ไม่ใช่หน้าที่ของบรรณาธิการ ห้ามปรับสำนวน ห้ามเรียบเรียงใหม่`
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
let langs = { th: true, en: true };
let enDict = null;
let segmenter = null;
let dict = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function setStatus(msg, color) {
  const s = $("status");
  if (s) {
    s.textContent = msg;
    s.className = color || "";
  }
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
function visible(s) {
  let t = s.replace(/[\u200B-\u200D\u2060\uFEFF\uFFFD\uE000-\uF8FF]/g,
    (c) => "[U+" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0") + "]");
  if (!t.trim()) t = "[เว้นวรรค " + s.length + " ตัว]";
  return t;
}

/* ============================================================
 *  RULE-BASED CHECKS
 * ============================================================ */
function runRules(text, opts) {
  const out = [];
  const add = (start, original, suggestion, issue) => out.push({ start, original, suggestion, issue });
  const scan = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) { fn(m); if (m[0].length === 0) re.lastIndex++; }
  };
  const TH_ON = !opts || opts.th !== false;
  const scanTh = (re, fn) => { if (TH_ON) scan(re, fn); };
  const ctx = (idx, len, replacement, issue) => {
    const p = idx > 0 && /[\u0E01-\u0E2E]/.test(text[idx - 1]) ? text[idx - 1] : "";
    add(idx - p.length, p + text.substr(idx, len), replacement == null ? "" : p + replacement, issue);
  };

  scanTh(/([\u0E30-\u0E3A\u0E40-\u0E4E])\1+/g, (m) => {
    if (m[1] === "\u0E40" && m[0].length === 2) return add(m.index, m[0], "\u0E41", "เ สองตัวติดกัน (น่าจะเป็น แ)");
    if (/[\u0E40-\u0E45]/.test(m[1])) return add(m.index, m[0], m[1], "อักขระซ้ำติดกัน");
    ctx(m.index, m[0].length, m[1], "สระ/วรรณยุกต์ซ้ำติดกัน");
  });

  scanTh(/[\u0E31\u0E34-\u0E37\u0E47]{2}|[\u0E48-\u0E4B]{2}|[\u0E48-\u0E4B][\u0E31\u0E34-\u0E37]/g, (m) => {
    if (m[0][0] === m[0][1]) return;
    ctx(m.index, m[0].length, null, "สระ/วรรณยุกต์ซ้อนกันผิดตำแหน่ง");
  });

  scanTh(/\u0E4D\u0E32/g, (m) => ctx(m.index, 2, "\u0E33", "นิคหิต+สระอา ควรใช้สระอำ"));

  scanTh(/(?:^|[^\u0E01-\u0E4E])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g,
    (m) => add(m.index, m[0], "", "สระ/วรรณยุกต์ลอย ไม่มีพยัญชนะนำหน้า"));

  scanTh(/[\u0E01-\u0E7F][A-Za-z][\u0E01-\u0E7F]/g,
    (m) => add(m.index, m[0], "", "ตัวอักษรอังกฤษแทรกกลางคำไทย"));

  scan(/[\uFFFD\uE000-\uF8FF\uFEFF\u200B-\u200D\u2060]/g, (m) => {
    const hex = "U+" + m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
    const hidden = /[\uFEFF\u200B-\u200D\u2060]/.test(m[0]);
    add(m.index, m[0], "", (hidden ? "อักขระล่องหน " : "อักขระแปลกปลอม ") + hex);
  });

  scanTh(/([\u0E01-\u0E2E])\1{2,}/g, (m) => add(m.index, m[0], m[1], "พยัญชนะซ้ำเกิน"));

  if (opts && opts.en) {
    scan(/\b([A-Za-z]{2,})[ \t]+\1\b/gi, (m) => add(m.index, m[0], m[1], "คำอังกฤษซ้ำติดกัน"));
  }

  if (opts && opts.spacing) {
    scanTh(/([\u0E01-\u0E45\u0E47-\u0E7F]{1,4})\u0E46/g,
      (m) => add(m.index, m[0], m[1] + " \u0E46", "ไม้ยมกต้องเว้นวรรคหน้า"));
    scanTh(/\u0E46[\u0E01-\u0E45\u0E47-\u0E7F]/g,
      (m) => add(m.index, m[0], "\u0E46 " + m[0][1], "ไม้ยมกต้องเว้นวรรคหลัง"));
    scan(/ {2,}/g, (m) => add(m.index, m[0], " ", "เว้นวรรคซ้อน"));
  }
  return out;
}

/* ============================================================
 *  CHUNK BUILDERS & PARSER
 * ============================================================ */
function normalizeForAI(text) {
  return text
    .replace(/\t/g, " ")
    .replace(/\r\n?|\u2028/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\uFFFC\u00AD]/g, "")
    .replace(/\n+$/, "");
}

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
  return `ตรวจพิสูจน์อักษรข้อความระหว่าง <<< และ >>> แล้วตอบเป็น JSON เท่านั้น ในรูปแบบ {"errors":[{"original":"...","suggestion":"...","issue":"..."}]}
ถ้าไม่พบจุดผิดให้ตอบ {"errors":[]}

<<<
${text}
>>>`;
}

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

/* ============================================================
 *  LOCAL DICTIONARY & CANDIDATES SCANNER
 * ============================================================ */
function initSegmenter() {
  try {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return false;
    const sg = new Intl.Segmenter("th", { granularity: "word" });
    let n = 0;
    for (const x of sg.segment("สวัสดีครับขอบคุณมาก")) n++;
    if (n < 3) return false;
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

function getDict() {
  if (dict) return dict;
  dict = new Set();
  if (dictAvailable()) THAI_WORDS_TEXT.split("\n").forEach((w) => { if (w) dict.add(w); });
  ignoreSet.forEach((w) => dict.add(w));
  return dict;
}

function getEnDict() {
  if (enDict) return enDict;
  enDict = new Set();
  if (enDictAvailable()) EN_WORDS_TEXT.split("\n").forEach((w) => { if (w) enDict.add(w); });
  ignoreSet.forEach((w) => enDict.add(String(w).toLowerCase()));
  return enDict;
}

function isSentenceStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /[ \t"\u201C\u2018'(\[]/.test(text[j])) j--;
  return j < 0 || /[.!?:\r\n\u2028]/.test(text[j]);
}

function findCandidates(text) {
  if (!segmenter) return [];
  const D = getDict();
  const out = [];
  let prev = null;
  for (const sg of segmenter.segment(text)) {
    const s = sg.segment;
    const start = sg.index;
    const end = start + s.length;
    if (LATIN_WORD.test(s)) {
      if (!langs.en || !enDictAvailable()) { prev = null; continue; }
      const lower = s.toLowerCase().replace(/['\u2019]s$/, "");
      let kind = null;
      const odd = /[A-Z]/.test(s.slice(1));
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
      if (!(text[end] === "." && bare.length <= 2)) kind = "oov";
    }
    if (!kind && prev && prev.bare === bare && bare.length >= 2) {
      out.push({ start: prev.start, end, kind: "dup" });
      prev = null;
      continue;
    }
    if (kind) out.push({ start, end, kind });
    prev = { bare, start };
  }
  return out;
}

/* ============================================================
 *  INDESIGN DOM MANIPULATION
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
    let page = null;
    try { page = app.activeWindow.activePage; } catch (e) {}
    if (!page) throw new Error("ไม่พบหน้าปัจจุบัน (ต้องอยู่ในมุมมอง Layout)");
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
      throw new Error("ยังไม่ได้เลือกอะไร: คลิกในกรอบข้อความ / เลือกกรอบ");
    }
    for (let i = 0; i < sel.length; i++) {
      const item = sel[i];
      const cn = cname(item);
      if (cn === "Table" || cn === "Row" || cn === "Column" || cn === "Cell") {
        if (cn === "Cell") addText(item, "c");
        else {
          const cells = item.cells;
          for (let j = 0; j < cells.length; j++) addText(cells.item(j), "c");
        }
      } else if (cn === "TextFrame" || cn === "InsertionPoint") {
        addText(item.parentStory, "s");
      } else if (item.parentStory && typeof item.contents !== "undefined") {
        const t = getContents(item);
        if (t) units.push({ obj: item, text: t });
      } else if (item.textFrames && item.textFrames.length) {
        for (let j = 0; j < item.textFrames.length; j++) addText(item.textFrames.item(j).parentStory, "s");
      } else if (item.paragraphs && item.paragraphs.length) {
        addText(item, "o");
      }
    }
  }
  units.forEach((u, i) => { u.idx = i; });
  return units;
}

function findFirst(obj, str) {
  try {
    app.findTextPreferences = NothingEnum.nothing;
    app.changeTextPreferences = NothingEnum.nothing;
    app.findChangeTextOptions.caseSensitive = true;
    app.findChangeTextOptions.wholeWord = false;
    app.findTextPreferences.findWhat = str.replace(/\^/g, "^^");
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
  try { cur = getContents(unit.obj); } catch (e) { return { err: "ข้อความต้นทางถูกลบ/เปลี่ยนไปแล้ว" }; }
  if (cur !== unit.text) return { err: "ข้อความในเอกสารเปลี่ยนไปแล้ว" };
  try {
    const r = unit.obj.characters.itemByRange(pos.start, pos.start + pos.len - 1);
    if (getContents(r) === expected) return { range: r };
  } catch (e) {}
  try {
    const r = findFirst(unit.obj, expected);
    if (r) return { range: r };
  } catch (e) {}
  return { err: "หาตำแหน่งในเอกสารไม่เจอ" };
}

function goTo(f, btn) {
  const n = f.positions.length;
  const idx = f.cursor % n;
  f.cursor = idx + 1;
  f.lastIdx = idx;
  const res = locate(f.positions[idx]);
  if (res.err) { setStatus("" + res.err, RED); return; }
  try {
    let pageObj = null;
    try {
      const tfs = res.range.parentTextFrames;
      if (tfs.length) pageObj = tfs[0].parentPage;
    } catch (e) {}
    if (pageObj) {
      try {
        const win = app.activeWindow;
        if (win.activePage.documentOffset !== pageObj.documentOffset) win.activePage = pageObj;
      } catch (e) {}
    }
    app.select(res.range);
    if (!pageObj) setStatus("ข้อความนี้อยู่ในส่วนที่ล้นกรอบ (overset)", RED);
    else setStatus(`เลือกคำแล้ว · หน้า ${pageObj.name}`);
  } catch (e) {
    setStatus("เลือกข้อความไม่สำเร็จ: " + (e.message || e), RED);
  }
  if (btn && n > 1) btn.textContent = `ไปที่จุดนี้ (${idx + 1}/${n})`;
}

function pageOfFrame(tf) {
  try {
    const pg = tf.parentPage;
    return pg ? { name: String(pg.name), offset: pg.documentOffset } : null;
  } catch (e) { return null; }
}

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
  return "หน้า " + names.slice(0, 4).join(", ");
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
  
  // 🟢 แสดงสาเหตุเฉพาะกรณีที่มีรายละเอียดอื่นเพิ่มเติมนอกจาก "สะกดผิด" ทั่วไป
  if (f.issue && f.issue !== "สะกดผิด") {
    card.appendChild(el("div", "issue", "สาเหตุ: " + f.issue));
  }

  const row = el("div", "btn-row");
  const goBtn = el("button", "", "ไปที่จุดนี้" + (f.positions.length > 1 ? ` (${f.positions.length})` : ""));
  goBtn.addEventListener("click", () => goTo(f, goBtn));
  row.appendChild(goBtn);
  if (f.suggestion) {
    const fixBtn = el("button", "", "แก้เลย");
    fixBtn.addEventListener("click", () => applyFix(f, false));
    row.appendChild(fixBtn);
  }
  card.appendChild(row);

  const row2 = el("div", "btn-row2");
  if (f.suggestion && f.positions.length > 1) {
    const allBtn = el("button", "", `แก้ทั้งหมด (${f.positions.length})`);
    allBtn.addEventListener("click", () => applyFix(f, true));
    row2.appendChild(allBtn);
  }
  const doneBtn = el("button", "", "แก้แล้ว");
  doneBtn.addEventListener("click", () => { f.hidden = true; renderFindings(); });
  const ignBtn = el("button", "", "ละเว้น");
  ignBtn.addEventListener("click", () => {
    ignoreSet.add(f.original);
    lsSet(K_IGNORE, Array.from(ignoreSet));
    f.hidden = true;
    updateIgnoreLabel();
    renderFindings();
  });
  row2.appendChild(doneBtn);
  row2.appendChild(ignBtn);
  card.appendChild(row2);
  return card;
}

function runUndoable(fn, label) {
  let ran = false, out;
  try {
    if (typeof ScriptLanguage !== "undefined" && ScriptLanguage && typeof UndoModes !== "undefined" && UndoModes && app.doScript) {
      app.doScript(() => { ran = true; out = fn(); }, ScriptLanguage.UXPSCRIPT, [], UndoModes.ENTIRE_SCRIPT, label);
      return out;
    }
  } catch (e) { if (ran) return out; }
  return fn();
}

function adjustAfterEdit(unit, pos, newLen, drift) {
  const delta = newLen - pos.len;
  for (const g of findings) {
    g.positions = g.positions.filter((q) => {
      if (q === pos) return false;
      if (q.unit !== unit) return true;
      if (drift) return false;
      if (q.start >= pos.start + pos.len) { q.start += delta; return true; }
      if (q.start + q.len <= pos.start) return true;
      return false;
    });
    g.cursor = 0;
    if (!g.positions.length) g.hidden = true;
  }
}

function replaceAt(pos, replacement) {
  const res = locate(pos);
  if (res.err) return { err: res.err };
  const unit = pos.unit;
  const before = unit.text;
  const want = before.slice(0, pos.start) + replacement + before.slice(pos.start + pos.len);
  try { res.range.contents = replacement; } catch (e) { return { err: "แก้ข้อความไม่สำเร็จ: " + (e.message || e) }; }
  let now;
  try { now = getContents(unit.obj); } catch (e) { return { err: "อ่านข้อความหลังแก้ไม่ได้" }; }
  const drift = now !== want;
  unit.text = now;
  adjustAfterEdit(unit, pos, replacement.length, drift);
  return { ok: true, drift };
}

function applyFix(f, all) {
  if (!f.suggestion) return setStatus("ไม่มีคำแนะนำให้แก้", RED);
  let targets = all ? f.positions.slice() : [f.positions[f.lastIdx !== undefined && f.lastIdx < f.positions.length ? f.lastIdx : 0]];
  targets.sort((a, b) => (a.unit === b.unit ? b.start - a.start : a.unit.idx - b.unit.idx));
  const original = f.original, suggestion = f.suggestion;
  let done = 0, err = "", drift = false;
  runUndoable(() => {
    for (const pos of targets) {
      const r = replaceAt(pos, suggestion);
      if (r.err) { err = r.err; break; }
      done++;
      if (r.drift) drift = true;
    }
  }, "AI Proofreader: แก้คำผิด");
  renderFindings();
  if (err) return setStatus((done ? `แก้แล้ว ${done} จุด แต่ ` : "") + err, RED);
  setStatus(`แก้ "${original}" เป็น "${suggestion}" แล้ว ${done} จุด`, GREEN);
}

function renderFindings() {
  const list = $("resultList");
  if (!list) return;
  list.innerHTML = "";
  findings.filter((f) => !f.hidden).sort((a, b) => a.pageOffset - b.pageOffset || a.key - b.key).forEach((f) => list.appendChild(buildCard(f)));
}

function updateIgnoreLabel() {
  if ($("btnClearIgnore")) $("btnClearIgnore").textContent = `ล้างรายการคำที่ละเว้น (${ignoreSet.size})`;
}

function setDisabled(elm, on) {
  if (!elm) return;
  elm.disabled = on;
  if (on) elm.setAttribute("disabled", ""); else elm.removeAttribute("disabled");
  if (elm.classList) { if (on) elm.classList.add("is-disabled"); else elm.classList.remove("is-disabled"); }
  elm.style.pointerEvents = on ? "none" : "";
}

// 🟢 สลับการแสดงผลปุ่มตรวจคำผิด/หยุด อยู่ตำแหน่งเดิม 100%
function toggleRunning(on) {
  running = on;
  if ($("btnCheck")) $("btnCheck").style.display = on ? "none" : "block";
  if ($("btnCancel")) $("btnCancel").style.display = on ? "block" : "none";
}

function progressStart(total, label) {
  progressEnd();
  live = { total, done: 0, busy: 0, t0: Date.now(), label, timer: null };
  if ($("progressWrap")) $("progressWrap").style.display = "block";
  progressRender();
  live.timer = setInterval(progressRender, 500);
}

function progressRender() {
  if (!live) return;
  const pct = live.total ? Math.round((live.done / live.total) * 100) : 0;
  if ($("progressFill")) $("progressFill").style.width = pct + "%";
  const sec = (Date.now() - live.t0) / 1000;
  if ($("progressText")) $("progressText").textContent = `${live.label} ${live.done}/${live.total} (${pct}%) · ผ่านไป ${Math.round(sec)} วิ`;
}

function progressEnd() {
  if (live && live.timer) clearInterval(live.timer);
  live = null;
  if ($("progressWrap")) $("progressWrap").style.display = "none";
}

function renderStats() { if ($("statsLine")) $("statsLine").textContent = Tele.summary(); }

async function runPool(limit, n, fn) {
  let next = 0;
  const workers = [];
  for (let w = 0; w < Math.min(Math.max(1, limit), n); w++) {
    workers.push((async () => { while (next < n) { const i = next++; await fn(i); } })());
  }
  await Promise.all(workers);
}

function applyItems(items, chunkUnits, kind, ctx) {
  const strip = (x) => x.split(MARK_L).join("").split(MARK_R).join("").trim();
  for (const it of items) {
    if (!it || typeof it.original !== "string") continue;
    const original = strip(it.original);
    const suggestion = typeof it.suggestion === "string" ? strip(it.suggestion) : "";
    if (!original || original === suggestion || original.length > MAX_ORIGINAL_LEN || ignoreSet.has(original)) continue;

    // 🟢 กรองข้อความ issue จาก AI เพื่อป้องกันการมโนระบุสระ/อักขระผิดพลาด
    let rawIssue = String(it.issue || "").trim();
    if (kind === "ai") {
      if (!rawIssue || rawIssue.length > 12 || /สระ|อักขระ|พยัญชนะ|เกิน|ขาด|หาย|หลุด/.test(rawIssue)) {
        rawIssue = "สะกดผิด";
      }
    }

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
    if (!positions.length) { if (!found) ctx.stat.dropped++; continue; }

    const mkey = kind + "|" + original + "|" + suggestion;
    if (ctx.merged.has(mkey)) {
      const f = ctx.merged.get(mkey);
      positions.forEach((p) => { if (!f.positions.some((q) => q.unit === p.unit && q.start === p.start)) f.positions.push(p); });
    } else {
      const f = makeFinding(kind, original, suggestion, rawIssue, positions);
      ctx.merged.set(mkey, f);
      findings.push(f);
      if (kind === "svc") ctx.stat.svc++; else ctx.stat.ai++;
    }
  }
}

/* ============================================================
 *  MAIN CHECK RUNNER
 * ============================================================ */
async function runCheck() {
  if (running) return;
  if (app.documents.length === 0) return setStatus("กรุณาเปิดเอกสาร InDesign ก่อน", RED);

  const isPyMode = $("modePyThaiNLP") ? $("modePyThaiNLP").checked : true;
  const useRules = $("chkRules") ? $("chkRules").checked : true;
  const useService = isPyMode;
  const useAI = !isPyMode;

  const spacing = $("chkSpacing") ? $("chkSpacing").checked : false;
  const scope = $("scopeSelect") ? $("scopeSelect").value : "selection";
  langs = { th: $("chkTH") ? $("chkTH").checked : true, en: $("chkEN") ? $("chkEN").checked : true };

  if (!langs.th && !langs.en) return setStatus("เลือกภาษาที่จะตรวจอย่างน้อย 1 ภาษา", RED);

  let units;
  try { units = collectUnits(scope); } catch (e) { return setStatus("" + (e.message || e), RED); }
  units = units.filter((u) => wantText(u.text));
  if (!units.length) return setStatus("ไม่พบข้อความที่จะตรวจในขอบเขตที่เลือก", RED);

  if (useAI) {
    const profile = activeProfile();
    const pr = presetOf(profile);
    if (!profile.baseUrl) return setStatus("ยังไม่ได้ตั้ง Base URL สำหรับ AI", RED);
    if (pr.needsKey && !keyCache[profile.id]) return setStatus(`ยังไม่ได้ใส่ API key ของ "${profile.name}"`, RED);
  }

  if (useService) {
    const svcUrl = $("serviceUrl") ? $("serviceUrl").value.trim() : "";
    if (!svcUrl) return setStatus("กรุณากรอก URL บริการตรวจสะกด PyThaiNLP", RED);
  }

  findings = [];
  cancelled = false;
  if ($("resultList")) $("resultList").innerHTML = "";
  Tele.reset();
  renderStats();
  toggleRunning(true);

  try {
    // Step 1: กฎการตรวจพื้นฐาน (สระซ้อน, ไม้ยมก, พิมพ์ซ้ำ)
    if (useRules) {
      for (const u of units) {
        for (const r of runRules(u.text, { spacing, th: langs.th, en: langs.en })) {
          if (ignoreSet.has(r.original)) continue;
          findings.push(makeFinding("rule", r.original, r.suggestion, r.issue, [{ unit: u, start: r.start, len: r.original.length }]));
        }
      }
      renderFindings();
    }

    const ctx = { taken: new Set(), merged: new Map(), stat: { rule: findings.length, ai: 0, svc: 0, dropped: 0 } };
    findings.forEach((f) => f.positions.forEach((p) => ctx.taken.add(p.unit.idx + ":" + p.start)));

    // Step 2: รัน PyThaiNLP Engine + Local Candidates Check (เฉพาะโหมด PyThaiNLP)
    if (useService && !cancelled) {
      const svcUrl = $("serviceUrl") ? $("serviceUrl").value.trim() : "";
      const sc = buildChunks(units);
      setStatus("กำลังตรวจสะกดด้วย PyThaiNLP...");
      progressStart(sc.length, "PyThaiNLP");

      for (let i = 0; i < sc.length; i++) {
        if (cancelled) break;
        try {
          const items = await serviceCheck(svcUrl, sc[i].parts.join("\n"), langs, 30);
          applyItems(items, sc[i].units, "svc", ctx);
        } catch (e) {
          console.warn("Service check error", e);
        }
        if (live) live.done++;
        renderFindings();
      }
      progressEnd();

      const useCand = $("chkCandPy") ? $("chkCandPy").checked : false;
      if (useCand && segmenter && (dictAvailable() || enDictAvailable())) {
        const CAND_KIND = {
          oov: "ไม่พบในพจนานุกรม (อาจพิมพ์ผิด หรือเป็นชื่อเฉพาะ/คำใหม่)",
          dup: "คำซ้ำติดกัน",
          mixed: "ไทยปนอังกฤษในคำเดียว",
          en: "ไม่พบในพจนานุกรมอังกฤษ"
        };

        for (const u of units) {
          try {
            const cands = findCandidates(u.text);
            for (const c of cands) {
              const word = u.text.substr(c.start, c.end - c.start).trim();
              if (!word || ignoreSet.has(word)) continue;
              
              const exists = findings.some((f) => f.positions.some((p) => p.unit === u && p.start === c.start));
              if (!exists) {
                const f = makeFinding("cand", word, "", CAND_KIND[c.kind] || "จุดน่าสงสัย", [{ unit: u, start: c.start, len: c.end - c.start }]);
                findings.push(f);
              }
            }
          } catch (e) {
            console.warn("Candidate scan error", e);
          }
        }
        renderFindings();
      }
    }

    // Step 3: รัน AI Engine (ตรวจทั้งข้อความอัตโนมัติ)
    if (useAI && !cancelled) {
      const profile = activeProfile();
      chunkLimit = profile.chunkLimit;

      const aiChunks = buildChunks(units);
      const total = aiChunks.length;

      setStatus(`AI (${profile.name}) กำลังตรวจ ${total} ช่วง...`);
      progressStart(total, "AI Engine");

      const worker = async (i) => {
        if (cancelled) return;
        const chunk = aiChunks[i];
        const isThinkOff = profile.think === "off" || profile.think === "disabled" || profile.think === "ปิด";

        const req = {
          system: $("systemPrompt") ? $("systemPrompt").value.trim() : "",
          user: buildUserMessage(chunk.parts.join("\n"), false),
          maxTokens: profile.maxTokens,
          temperature: typeof profile.temperature === "number" ? profile.temperature : 0.3,
          chat_template_config: { enable_thinking: !isThinkOff },
          thinking: { type: isThinkOff ? "disabled" : "enabled" },
          reasoning_effort: isThinkOff ? "none" : (profile.think || "medium")
        };

        if (live) live.busy++;
        try {
          const r = await providerComplete(profile, req);
          Tele.ok(r, `ช่วง ${i + 1}/${total}`);
          const items = parseModelJson(r.text);
          if (items) applyItems(items, chunk.units, "ai", ctx);
        } catch (e) {
          Tele.failed(`ช่วง ${i + 1}/${total}`, friendlyError(e, profile));
        } finally {
          if (live) { live.busy--; live.done++; }
          renderFindings();
          renderStats();
        }
      };

      await runPool(profile.parallel, total, worker);
      progressEnd();
    }

  } finally {
    progressEnd();
    toggleRunning(false);
    renderStats();
  }

  const visibleCount = findings.filter((f) => !f.hidden).length;
  if (visibleCount === 0) {
    setStatus("ไม่พบจุดผิด", GREEN);
  } else {
    setStatus(`พบ ${visibleCount} จุด`, GREEN);
  }
}

/* ============================================================
 *  INIT & ACCORDION
 * ============================================================ */
function initAccordions() {
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
    let open = acc.getAttribute("data-open") === "1";
    apply(open);
    head.addEventListener("click", () => {
      open = !open;
      apply(open);
    });
  }
}

/* ============================================================
 *  PRESETS & SYSTEM INSTRUCTION MANAGEMENT
 * ============================================================ */
function getPresetPrompt(key) {
  return (BUILTIN_PRESETS[key] || customPresets[key] || {}).prompt || "";
}

function renderPresetOptions(selectedKey) {
  const sel = $("presetSelect");
  if (!sel) return;
  sel.innerHTML = "";
  const add = (k, label) => { const o = el("option", "", label); o.value = k; sel.appendChild(o); };
  
  Object.keys(BUILTIN_PRESETS).forEach((k) => add(k, BUILTIN_PRESETS[k].name));
  Object.keys(customPresets).forEach((k) => add(k, "* " + customPresets[k].name));
  
  sel.value = BUILTIN_PRESETS[selectedKey] || customPresets[selectedKey] ? selectedKey : "strict_proofread";
  if ($("systemPrompt")) {
    $("systemPrompt").value = getPresetPrompt(sel.value);
  }
}

function disarmDelete() {
  deleteArmedKey = null;
  if ($("btnDeletePreset")) $("btnDeletePreset").textContent = "ลบ";
}

function initPresets() {
  customPresets = lsGet(K_PRESETS, {});
  renderPresetOptions("strict_proofread");

  if ($("presetSelect")) {
    $("presetSelect").addEventListener("change", () => {
      if ($("systemPrompt")) $("systemPrompt").value = getPresetPrompt($("presetSelect").value);
      disarmDelete();
    });
  }

  if ($("btnResetPrompt")) {
    $("btnResetPrompt").addEventListener("click", () => {
      renderPresetOptions("strict_proofread");
      disarmDelete();
    });
  }

  if ($("btnSavePreset")) {
    $("btnSavePreset").addEventListener("click", () => {
      const prompt = $("systemPrompt") ? $("systemPrompt").value.trim() : "";
      const name = $("presetName") ? $("presetName").value.trim() : "";
      if (!prompt) return setStatus("ยังไม่มีข้อความ System Instruction ให้บันทึก", RED);
      if (!name) return setStatus("พิมพ์ชื่อ Preset ในช่องก่อนกดบันทึก", RED);
      const key = "custom_" + Date.now();
      customPresets[key] = { name, prompt };
      lsSet(K_PRESETS, customPresets);
      renderPresetOptions(key);
      if ($("presetName")) $("presetName").value = "";
      setStatus("บันทึก Preset แล้ว", GREEN);
    });
  }

  if ($("btnDeletePreset")) {
    $("btnDeletePreset").addEventListener("click", () => {
      const key = $("presetSelect") ? $("presetSelect").value : "";
      if (BUILTIN_PRESETS[key]) return setStatus("ลบ Preset มาตรฐานไม่ได้", RED);
      if (deleteArmedKey !== key) {
        deleteArmedKey = key;
        $("btnDeletePreset").textContent = "ยืนยัน?";
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
}

function init() {
  initAccordions();
  ignoreSet = new Set(lsGet(K_IGNORE, []));
  
  initSegmenter();
  
  updateIgnoreLabel();
  initPresets();
  initSettings();

  if ($("btnClearIgnore")) {
    $("btnClearIgnore").addEventListener("click", () => {
      ignoreSet.clear();
      lsSet(K_IGNORE, []);
      updateIgnoreLabel();
      setStatus("ล้างรายการคำที่ละเว้นแล้ว");
    });
  }

  if ($("btnCheck")) $("btnCheck").addEventListener("click", runCheck);
  if ($("btnCancel")) $("btnCancel").addEventListener("click", () => { cancelled = true; setStatus("กำลังหยุด..."); });
}

init();