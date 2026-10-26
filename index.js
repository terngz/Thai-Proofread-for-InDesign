"use strict";
const { app, NothingEnum, ScriptLanguage, UndoModes } = require("indesign");
const { shell } = require("uxp");

// =========================================================================
// OPTIMIZED STATE MANAGEMENT (แยกข้อมูลตาม Document Tab + Auto Clean Memory)
// =========================================================================
const docFindingsMap = new Map();
let currentDocId = null;

function syncStateWithActiveDocument() {
  if (!app.documents || app.documents.length === 0) {
    if (currentDocId !== null) {
      currentDocId = null;
      findings = [];
      renderFindings();
      if (typeof setStatus === "function") setStatus(tr("status.ready"));
    }
    return;
  }

  let activeId = null;
  try {
    activeId = app.activeDocument.id;
  } catch (e) {
    return;
  }

  // สลับ Tab ไปยังไฟล์งานอื่น
  if (currentDocId !== activeId) {
    currentDocId = activeId;

    if (!docFindingsMap.has(currentDocId)) {
      docFindingsMap.set(currentDocId, []);
    }

    // ดึง findings ของไฟล์นั้นกลับมาแสดง
    findings = docFindingsMap.get(currentDocId);

    // วาด Card ผลลัพธ์กลับมาบนหน้าจอ และอัปเดต Status
    renderFindings();

    const visibleCount = findings.filter((f) => !f.hidden).length;
    if (visibleCount === 0) {
      if (typeof setStatus === "function") setStatus(tr("status.ready"));
      if ($("disclaimerBox")) $("disclaimerBox").style.display = "none";
    } else {
      if (typeof setStatus === "function") setStatus(tr("run.found", { n: visibleCount }), GREEN);
      if ($("disclaimerBox")) $("disclaimerBox").style.display = "block";
    }
  }
}

// Event Listeners สำหรับการสลับ Tab และปิดไฟล์
try {
  app.addEventListener("afterSelectionChanged", syncStateWithActiveDocument);
} catch (e) {
  console.warn("Failed to bind afterSelectionChanged:", e);
}

try {
  app.addEventListener("beforeClose", (evt) => {
    try {
      const targetDoc = evt.target;
      if (targetDoc && targetDoc.id) {
        docFindingsMap.delete(targetDoc.id); // ล้าง Memory ทันทีที่ปิดไฟล์
        if (currentDocId === targetDoc.id) {
          currentDocId = null;
          findings = [];
        }
      }
    } catch (err) {
      /* ignore */
    }
  });
} catch (e) {
  console.warn("Failed to bind beforeClose:", e);
}
// =========================================================================

let chunkLimit = 800;
const MAX_ORIGINAL_LEN = 30;
const K_PRESETS = "ai_proofread_custom_presets";
const K_IGNORE = "ai_proofread_ignore";
const THAI = /[\u0E01-\u0E7F]/;
/* const LATIN_WORD = /^[A-Za-z][A-Za-z'\u2019]*$/; */
const MARK_L = "【";
const MARK_R = "】";
const RED = "err";
const GREEN = "ok";
const URL_README = "https://github.com/terngz/Thai-Proofread-for-InDesign/blob/main/README.md";
const URL_CHANGELOG = "https://github.com/terngz/Thai-Proofread-for-InDesign/blob/main/CHANGELOG.md";
const URL_KOFI = "https://ko-fi.com/Y8I2292JV2";

const BUILTIN_PRESETS = {
  strict_proofread: {
    get name() { return tr("ps.builtinName"); },
    prompts: {
      th: `คุณคือ "นักพิสูจน์อักษร" (Proofreader) ที่เชี่ยวชาญทั้งภาษาไทยและภาษาอังกฤษ ไม่ใช่บรรณาธิการ โดยมีหน้าที่ในการตรวจคำสะกดทั้งภาษาไทยและอังกฤษ ตามเงื่อนไขของภาษานั้น ๆ เช่น ภาษาไทยใช้หลักของราชบัณฑิตยสถาน ส่วนภาษาอังกฤษใช้หลักของ Cambridge หรือ Oxford ก็ได้ โดยอิงจากบริบทในข้อความ หน้าที่คือ ตรวจหาคำผิด ชี้เฉพาะจุดที่มีคำที่สะกดผิด สะกดเกิน เจออักขระผิดตำแหน่ง เจอสระหรือวรรณยุกต์ซ้อน เป็นต้น ทำหน้าที่ ตรวจพิสูจน์อักษร ไม่ใช่หน้าที่ของบรรณาธิการ ห้ามปรับสำนวน ห้ามเรียบเรียงใหม่`,
      en: `You are a "Proofreader" fluent in both Thai and English, You're not an Editor. Your responsibility is to check spelling in BOTH Thai and English according to their respective standard guidelines—for example, following the Royal Society of Thailand for Thai, and Cambridge or Oxford standards for English, based on text context. Your role is to identify typos by pointing out specific instances of misspelled words, extra characters, misplaced characters, or overlapping vowels and tone marks. You act strictly as a proofreader, not an editor: do not alter the style, tone, or rewrite the text.`
    },
    get prompt() { return this.prompts[uiLang] || this.prompts.th; }
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

const $ = (id) => document.getElementById(id);
let customPresets = {};
let presetMode = "view";
let ignoreSet = new Set();
let findings = [];
let running = false;
let cancelled = false;
let live = null;
let deleteArmedKey = null;
let segmenter = null;

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
  if (!t.trim()) t = tr("v.space", { n: s.length });
  return t;
}
function wantText(t) { return THAI.test(t) || /[A-Za-z]{3}/.test(t); }

function runRules(text, opts) {
  const out = [];
  const add = (start, original, suggestion, issue) => out.push({ start, original, suggestion, issue });
  const scan = (re, fn) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) { fn(m); if (m[0].length === 0) re.lastIndex++; }
  };

  const ctx = (idx, len, replacement, issue) => {
    const p = idx > 0 && /[\u0E01-\u0E2E]/.test(text[idx - 1]) ? text[idx - 1] : "";
    add(idx - p.length, p + text.substr(idx, len), replacement == null ? "" : p + replacement, issue);
  };

  // ==========================================
  // 1. AUTOMATIC RULES (กฎภาษาไทย / โครงสร้างคำ)
  // ==========================================
  if (opts && opts.rules) {
    // ซ้ำสระ/อักขระ
    scan(/([\u0E30-\u0E3A\u0E40-\u0E4E])\1+/g, (m) => {
      if (m[1] === "\u0E40" && m[0].length === 2) return add(m.index, m[0], "\u0E41", { k: "r.doubleE" });
      if (/[\u0E40-\u0E45]/.test(m[1])) return add(m.index, m[0], m[1], { k: "r.dupChar" });
      ctx(m.index, m[0].length, m[1], { k: "r.dupVowel" });
    });

    // สระ/วรรณยุกต์ซ้อนผิดตำแหน่ง
    scan(/[\u0E31\u0E34-\u0E37\u0E47]{2}|[\u0E48-\u0E4B]{2}|[\u0E48-\u0E4B][\u0E31\u0E34-\u0E37]/g, (m) => {
      if (m[0][0] === m[0][1]) return;
      ctx(m.index, m[0].length, null, { k: "r.stacked" });
    });

    // นฤคหิต
    scan(/\u0E4D\u0E32/g, (m) => ctx(m.index, 2, "\u0E33", { k: "r.nikhahit" }));

    // วรรณยุกต์ลอย
    scan(/(?:^|[^\u0E01-\u0E4E])[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g,
      (m) => add(m.index, m[0], "", { k: "r.floating" }));

    // อักษรภาษาอังกฤษโผล่กลางคำไทย
    scan(/[\u0E01-\u0E7F][A-Za-z][\u0E01-\u0E7F]/g,
      (m) => add(m.index, m[0], "", { k: "r.latinInThai" }));

    // อักขระแปลกปลอม/ซ่อน
    scan(/[\uFFFD\uE000-\uF8FF\uFEFF\u200B-\u200D\u2060]/g, (m) => {
      const hex = "U+" + m[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");
      const hidden = /[\uFEFF\u200B-\u200D\u2060]/.test(m[0]);
      add(m.index, m[0], "", { k: hidden ? "r.hidden" : "r.strange", p: { hex } });
    });

    // พยัญชนะซ้ำเกินปกติ
    scan(/([\u0E01-\u0E2E])\1{2,}/g, (m) => add(m.index, m[0], m[1], { k: "r.consRepeat" }));

    // คำอังกฤษซ้ำ
    scan(/\b([A-Za-z]{2,})[ \t]+\1\b/gi, (m) => add(m.index, m[0], m[1], { k: "r.enDup" }));

    // [ย้ายมาไว้ที่นี่] กฎการเว้นวรรคไม้ยมก (ตามหลักภาษาไทย)
    scan(/([\u0E01-\u0E45\u0E47-\u0E7F]{1,4})\u0E46/g,
      (m) => add(m.index, m[0], m[1] + " \u0E46", { k: "r.yamokBefore" }));
    scan(/\u0E46[\u0E01-\u0E45\u0E47-\u0E7F]/g,
      (m) => add(m.index, m[0], "\u0E46 " + m[0][1], { k: "r.yamokAfter" }));
  }

  // ==========================================
  // 2. CHECK SPACING (ตรวจเฉพาะระยะการเคาะ Spacebar)
  // ==========================================
  if (opts && opts.spacing) {
    // เคาะ Spacebar ซ้ำเกิน 1 ครั้ง (Double Space)
    scan(/ {2,}/g, (m) => add(m.index, m[0], " ", { k: "r.dblSpace" }));
  }

  return out;
}

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

function buildUserMessage(text) {
  const head = uiLang === "en"
    ? `Proofread the text between <<< and >>> and reply with JSON only, in this format: {"errors":[{"original":"...","suggestion":"...","issue":"..."}]}\nIf there are no errors, reply {"errors":[]}`
    : `ตรวจพิสูจน์อักษรข้อความระหว่าง <<< และ >>> แล้วตอบเป็น JSON เท่านั้น ในรูปแบบ {"errors":[{"original":"...","suggestion":"...","issue":"..."}]}\nถ้าไม่พบจุดผิดให้ตอบ {"errors":[]}`;
  return `${head}\n\n<<<\n${text}\n>>>`;
}

function parseModelJson(raw) {
  const s = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const tryParse = (str) => {
    const fixed = str.replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(fixed); } catch (e) { }
    try { return JSON.parse(fixed.replace(/[\u0000-\u001F]+/g, " ")); } catch (e) { }
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

function initSegmenter() {
  try {
    if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return false;
    const sg = new Intl.Segmenter("th", { granularity: "word" });
    if (Array.from(sg.segment("สวัสดีครับขอบคุณมาก")).length < 3) return false;
    segmenter = sg;
    return true;
  } catch (e) { return false; }
}

function collectUnits(scope) {
  const doc = app.activeDocument;
  const units = [];
  const seen = new Set();

  const addText = (story, keyPrefix) => {
    if (!story) return;
    let id;
    try { id = story.id; } catch (e) { }
    if (id !== undefined) { const k = keyPrefix + id; if (seen.has(k)) return; seen.add(k); }
    const paras = story.paragraphs;
    const n = paras.length;
    let texts = null;
    try { const t = paras.everyItem().contents; if (Array.isArray(t) && t.length === n) texts = t; } catch (e) { }
    for (let i = 0; i < n; i++) {
      const p = paras.item(i);
      units.push({ obj: p, text: texts ? texts[i] : getContents(p) });
    }
  };

  if (scope === "page") {
    let page = null;
    try { page = app.activeWindow.activePage; } catch (e) { }
    if (!page) throw new Error(tr("e.noPage"));
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
      throw new Error(tr("e.noSel"));
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
    try { app.findTextPreferences = NothingEnum.nothing; } catch (e) { }
  }
}

function locate(pos) {
  const unit = pos.unit;
  const expected = unit.text.substr(pos.start, pos.len);
  let cur;
  try { cur = getContents(unit.obj); } catch (e) { return { err: tr("e.srcGone") }; }
  if (cur !== unit.text) return { err: tr("e.docChanged") };
  try {
    const r = unit.obj.characters.itemByRange(pos.start, pos.start + pos.len - 1);
    if (getContents(r) === expected) return { range: r };
  } catch (e) { }
  try {
    const r = findFirst(unit.obj, expected);
    if (r) return { range: r };
  } catch (e) { }
  return { err: tr("e.notFound") };
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
      const r = res.range;
      const tfs = r.parentTextFrames && r.parentTextFrames.length ? r.parentTextFrames : null;
      if (tfs) {
        pageObj = tfs[0].parentPage;
      } else if (r.parent && r.parent.parentPage) {
        pageObj = r.parent.parentPage;
      }
    } catch (e) { }

    if (!pageObj) {
      const resolved = resolvePage(f.positions[idx]);
      if (resolved) {
        try {
          pageObj = app.activeDocument.pages.itemByName(resolved.name);
        } catch (e) { }
      }
    }

    if (pageObj && app.activeWindow) {
      try {
        app.activeWindow.activePage = pageObj;
      } catch (e) {
        console.warn("Failed to set activePage:", e);
      }
    }

    app.select(res.range);

    if (!pageObj) setStatus(tr("e.overset"), RED);
    else setStatus(tr("e.selected", { page: pageObj.name }));
  } catch (e) {
    setStatus(tr("e.selectFail") + (e.message || e), RED);
  }
  if (btn && n > 1) btn.textContent = tr("go.btnIdx", { i: idx + 1, n });
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
  } catch (e) { }
  return pos.page;
}

function pageLabel(f) {
  const names = [];
  f.positions.forEach((p) => {
    const pg = resolvePage(p);
    const n = pg ? pg.name : tr("pg.overset");
    if (names.indexOf(n) < 0) names.push(n);
  });
  return tr("pg.label", { names: names.slice(0, 4).join(", ") });
}

function makeFinding(kind, original, suggestion, issue, positions) {
  const pg = resolvePage(positions[0]);
  return {
    kind, original, suggestion, issue, positions, cursor: 0,
    pageOffset: pg ? pg.offset : 1e9,
    key: positions[0].unit.idx * 1e7 + positions[0].start
  };
}

function makeBtn(label, cls, onClick) {
  const b = el("button", cls, label);
  b.addEventListener("click", onClick);
  return b;
}

const TAG_KEY = { rule: "tag.rule", space: "tag.space", cand: "tag.cand", svc: "tag.svc", ai: "tag.ai" };

function buildCard(f) {
  const card = el("div", "card");

  const top = el("div", "card-top");
  top.appendChild(el("span", "tag tag-" + f.kind, tr(TAG_KEY[f.kind] || "tag.ai")));
  top.appendChild(el("span", "card-page", pageLabel(f)));
  card.appendChild(top);

  const word = el("div", "card-word");
  word.appendChild(el("span", "w-err", visible(f.original)));
  if (f.suggestion) {
    word.appendChild(el("span", "w-arrow", "→"));
    word.appendChild(el("span", "w-ok", visible(f.suggestion)));
  }
  card.appendChild(word);

  const issueText = f.issue && typeof f.issue === "object" ? tr(f.issue.k, f.issue.p) : f.issue;
  if (issueText && issueText !== "สะกดผิด") card.appendChild(el("div", "issue", issueText));

  const n = f.positions.length;
  const main = el("div", "card-actions");
  const goBtn = makeBtn(tr("go.btn") + (n > 1 ? ` (${n})` : ""), "", () => goTo(f, goBtn));
  main.appendChild(goBtn);
  if (f.suggestion) main.appendChild(makeBtn(tr("card.fix"), "btn-accent", () => applyFix(f, false)));
  card.appendChild(main);

  const more = el("div", "card-more");
  if (f.suggestion && n > 1) more.appendChild(makeBtn(tr("card.fixAll", { n }), "btn-text", () => applyFix(f, true)));
  more.appendChild(makeBtn(tr("card.done"), "btn-text", () => { f.hidden = true; renderFindings(); }));
  more.appendChild(makeBtn(tr("card.ignore"), "btn-text", () => {
    ignoreSet.add(f.original);
    lsSet(K_IGNORE, Array.from(ignoreSet));
    f.hidden = true;
    updateIgnoreLabel();
    renderFindings();
  }));
  card.appendChild(more);
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
  try { res.range.contents = replacement; } catch (e) { return { err: tr("fix.failed") + (e.message || e) }; }
  let now;
  try { now = getContents(unit.obj); } catch (e) { return { err: tr("fix.readFail") }; }
  const drift = now !== want;
  unit.text = now;
  adjustAfterEdit(unit, pos, replacement.length, drift);
  return { ok: true, drift };
}

function applyFix(f, all) {
  if (!f.suggestion) return setStatus(tr("fix.none"), RED);
  let targets = all ? f.positions.slice() : [f.positions[f.lastIdx !== undefined && f.lastIdx < f.positions.length ? f.lastIdx : 0]];
  targets.sort((a, b) => (a.unit === b.unit ? b.start - a.start : a.unit.idx - b.unit.idx));
  const original = f.original, suggestion = f.suggestion;
  let done = 0, err = "";
  runUndoable(() => {
    for (const pos of targets) {
      const r = replaceAt(pos, suggestion);
      if (r.err) { err = r.err; break; }
      done++;
    }
  }, tr("fix.undoLabel"));
  renderFindings();
  if (err) return setStatus((done ? tr("fix.partial", { done }) : "") + err, RED);
  setStatus(tr("fix.ok", { o: original, s: suggestion, n: done }), GREEN);
}

let renderTimer = null;
function renderFindings() {
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  const list = $("resultList");
  if (!list) return;
  const frag = document.createDocumentFragment();
  findings
    .filter((f) => !f.hidden)
    .sort((a, b) => a.pageOffset - b.pageOffset || a.key - b.key)
    .forEach((f) => frag.appendChild(buildCard(f)));
  list.innerHTML = "";
  list.appendChild(frag);
}
function renderSoon() {
  if (!renderTimer) renderTimer = setTimeout(renderFindings, 250);
}

function resetCheck() {
  if (running) return setStatus(tr("rst.running"), RED);
  findings = [];
  if (currentDocId) {
    docFindingsMap.set(currentDocId, []);
  }
  renderFindings();
  progressEnd();
  Tele.reset();
  renderStats();
  if ($("disclaimerBox")) $("disclaimerBox").style.display = "none";
  setStatus(tr("status.ready"));
}

function updateIgnoreLabel() {
  if ($("btnClearIgnore")) $("btnClearIgnore").textContent = tr("foot.ignore", { n: ignoreSet.size });
}

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
  if ($("progressText")) $("progressText").textContent = tr("prog.text", { label: live.label, done: live.done, total: live.total, pct, sec: Math.round(sec) });
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

    let rawIssue = String(it.issue || "").trim();
    if (kind === "svc") rawIssue = "สะกดผิด";
    if (kind === "ai") {
      if (!rawIssue || rawIssue.length > 12 || /สระ|อักขระ|พยัญชนะ|เกิน|ขาด|หาย|หลุด/.test(rawIssue)) {
        rawIssue = "สะกดผิด";
      }
    }

    const positions = [];
    let found = false;
    const latin = /^[A-Za-z][A-Za-z'\u2019]*$/.test(original);
    const wordCh = (c) => !!c && /[A-Za-z0-9_]/.test(c);
    for (const u of chunkUnits) {
      let from = 0, at;
      while (positions.length < 50 && (at = u.text.indexOf(original, from)) >= 0) {
        found = true;
        const edgeOk = !latin || (!wordCh(u.text[at - 1]) && !wordCh(u.text[at + original.length]));
        if (edgeOk && !ctx.taken.has(u.idx + ":" + at)) positions.push({ unit: u, start: at, len: original.length });
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

async function runCheck() {
  if (running) return;
  if (app.documents.length === 0) return setStatus(tr("run.noDoc"), RED);

  const engineMode = getSelectedEngineMode();
  const useSpelling = $("chkSpelling") ? $("chkSpelling").checked : true;
  const useRules = $("chkRules") ? $("chkRules").checked : true;
  const useSpacing = $("chkSpacing") ? $("chkSpacing").checked : true;
  /* const spacing = $("chkSpacing") ? $("chkSpacing").checked : false; */
  const useService = engineMode === "pythainlp";
  const useAI = engineMode === "ai";

  const scope = $("scopeSelect") ? $("scopeSelect").value : "selection";

  if ($("disclaimerBox")) $("disclaimerBox").style.display = "none";

  let units;
  try { units = collectUnits(scope); } catch (e) { return setStatus("" + (e.message || e), RED); }
  units = units.filter((u) => wantText(u.text));
  if (!units.length) return setStatus(tr("run.noText"), RED);

  if (useSpelling && useAI) {
    const profile = activeProfile();
    const pr = presetOf(profile);
    if (!profile.baseUrl) return setStatus(tr("run.noBase"), RED);
    if (pr.needsKey && !keyCache[profile.id]) return setStatus(tr("run.noKey", { name: profile.name }), RED);
  }

  const svcUrl = useService && $("serviceUrl") ? $("serviceUrl").value.trim() : "";
  if (useSpelling && useService && !svcUrl) return setStatus(tr("run.noSvcUrl"), RED);

  cancelled = false;
  toggleRunning(true);

  try {
    if (useSpelling && useService) {
      setStatus(tr("run.svcConnecting"));
      try { await serviceHealth(svcUrl); } catch (e) { return setStatus(tr("run.svcDown"), RED); }
    }

    findings = [];
    if ($("resultList")) $("resultList").innerHTML = "";
    Tele.reset();
    renderStats();

    // 1. ตรวจสอบ Rules / Spacing
    if (useRules || useSpacing) {
      for (const u of units) {
        for (const r of runRules(u.text, { rules: useRules, spacing: useSpacing })) {
          if (ignoreSet.has(r.original)) continue;

          const kind = (r.issue && r.issue.k === "r.dblSpace") ? "space" : "rule";
          findings.push(makeFinding(kind, r.original, r.suggestion, r.issue, [{ unit: u, start: r.start, len: r.original.length }]));
        }
      }
      renderFindings();
    }

    const ctx = { taken: new Set(), merged: new Map(), stat: { rule: findings.length, ai: 0, svc: 0, dropped: 0 } };
    findings.forEach((f) => f.positions.forEach((p) => ctx.taken.add(p.unit.idx + ":" + p.start)));

    // 2. ตรวจสอบ Spelling (ถ้าติ๊กเลือกไว้)
    if (useSpelling) {
      if (useService && !cancelled) {
        chunkLimit = 4000;
        const sc = buildChunks(units);
        setStatus(tr("run.svcChecking"));
        progressStart(sc.length, "PyThaiNLP");

        let lost = false;
        await runPool(3, sc.length, async (i) => {
          if (cancelled || lost) return;
          try {
            const items = await serviceCheck(svcUrl, sc[i].parts.join("\n"), { th: true, en: true }, 30);
            applyItems(items, sc[i].units, "svc", ctx);
          } catch (e) {
            console.warn("Service check error", e);
            if (e && (e.network || e.timeout)) lost = true;
          }
          if (live) live.done++;
          renderSoon();
        });
        progressEnd();
        if (lost) return setStatus(tr("run.svcLost"), RED);
        renderFindings();
      }

      if (useAI && !cancelled) {
        const profile = activeProfile();
        chunkLimit = profile.chunkLimit;

        const aiChunks = buildChunks(units);
        const total = aiChunks.length;

        setStatus(tr("run.aiChecking", { name: profile.name, total }));
        progressStart(total, "AI Engine");

        const systemPrompt = $("systemPrompt") ? $("systemPrompt").value.trim() : "";
        const isThinkOff = profile.think === "off" || profile.think === "disabled" || profile.think === "ปิด";
        const temperature = typeof profile.temperature === "number" ? profile.temperature : 0.3;

        const worker = async (i) => {
          if (cancelled) return;
          const chunk = aiChunks[i];

          const req = {
            system: systemPrompt,
            user: buildUserMessage(chunk.parts.join("\n")),
            maxTokens: profile.maxTokens,
            temperature,
            chat_template_config: { enable_thinking: !isThinkOff },
            thinking: { type: isThinkOff ? "disabled" : "enabled" },
            reasoning_effort: isThinkOff ? "none" : (profile.think || "medium")
          };

          if (live) live.busy++;
          try {
            const r = await providerComplete(profile, req);
            Tele.ok(r, tr("tele.chunk", { i: i + 1, total }));
            const items = parseModelJson(r.text);
            if (items) applyItems(items, chunk.units, "ai", ctx);
          } catch (e) {
            Tele.failed(tr("tele.chunk", { i: i + 1, total }), friendlyError(e, profile));
          } finally {
            if (live) { live.busy--; live.done++; }
            renderSoon();
            renderStats();
          }
        };

        await runPool(profile.parallel, total, worker);
      }
    }

  } finally {
    progressEnd();
    toggleRunning(false);
    renderStats();
    renderFindings();
  }

  const visibleCount = findings.filter((f) => !f.hidden).length;
  if (visibleCount === 0) {
    setStatus(tr("run.none"), GREEN);
    if ($("disclaimerBox")) $("disclaimerBox").style.display = "none";
  } else {
    setStatus(tr("run.found", { n: visibleCount }), GREEN);
    if ($("disclaimerBox")) $("disclaimerBox").style.display = "block";
  }

  // อัปเดต Map ประจำ Document ID ล่าสุด
  if (currentDocId) {
    docFindingsMap.set(currentDocId, findings);
  }
}

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
      if (ind) ind.textContent = open ? "\u2212" : "+";
    };
    let open = acc.getAttribute("data-open") === "1";
    apply(open);
    head.addEventListener("click", () => {
      open = !open;
      apply(open);
    });
  }
}

function getPresetPrompt(key) {
  return (BUILTIN_PRESETS[key] || customPresets[key] || {}).prompt || "";
}

function renderPresetOptions(selectedKey) {
  const sel = $("presetSelect");
  if (!sel) return;
  const opts = [];
  const add = (k, label) => opts.push({ value: k, label });

  Object.keys(BUILTIN_PRESETS).forEach((k) => add(k, BUILTIN_PRESETS[k].name));
  Object.keys(customPresets).forEach((k) => add(k, "* " + customPresets[k].name));

  ddFill(sel, opts, BUILTIN_PRESETS[selectedKey] || customPresets[selectedKey] ? selectedKey : "strict_proofread");
  if ($("systemPrompt")) {
    $("systemPrompt").value = getPresetPrompt(sel.value);
  }
  applyPresetMode();
}

function presetKey() {
  return $("presetSelect") ? $("presetSelect").value : "";
}

function setDisabled(el, on) {
  if (!el) return;
  if (on) el.setAttribute("disabled", "");
  else el.removeAttribute("disabled");
  try { el.disabled = !!on; } catch (e) { /* ignore */ }
}

function showEl(id, on, display) {
  if ($(id)) $(id).style.display = on ? display : "none";
}

function applyPresetMode() {
  const busy = presetMode !== "view";
  const custom = !!customPresets[presetKey()];
  setDisabled($("systemPrompt"), !busy);
  setDisabled($("btnEditPreset"), !custom);
  setDisabled($("btnDeletePreset"), !custom);
  showEl("presetNameBox", busy, "block");
  showEl("presetViewBtns", !busy, "flex");
  showEl("presetEditBtns", busy, "flex");
}

function disarmDelete() {
  deleteArmedKey = null;
  if ($("btnDeletePreset")) $("btnDeletePreset").textContent = tr("btn.delete");
}

function initPresets() {
  customPresets = lsGet(K_PRESETS, {});
  renderPresetOptions("strict_proofread");

  if ($("presetSelect")) {
    $("presetSelect").addEventListener("change", () => {
      presetMode = "view";
      if ($("presetName")) $("presetName").value = "";
      if ($("systemPrompt")) $("systemPrompt").value = getPresetPrompt($("presetSelect").value);
      disarmDelete();
      applyPresetMode();
    });
  }

  if ($("btnResetPrompt")) {
    $("btnResetPrompt").addEventListener("click", () => {
      presetMode = "view";
      if ($("presetName")) $("presetName").value = "";
      renderPresetOptions("strict_proofread");
      disarmDelete();
    });
  }

  if ($("btnAddPreset")) {
    $("btnAddPreset").addEventListener("click", () => {
      presetMode = "add";
      disarmDelete();
      if ($("presetName")) $("presetName").value = "";
      if ($("systemPrompt")) $("systemPrompt").value = "";
      applyPresetMode();
    });
  }

  if ($("btnEditPreset")) {
    $("btnEditPreset").addEventListener("click", () => {
      const key = presetKey();
      if (!customPresets[key]) return;
      presetMode = "edit";
      disarmDelete();
      if ($("presetName")) $("presetName").value = customPresets[key].name;
      applyPresetMode();
    });
  }

  if ($("btnCancelPreset")) {
    $("btnCancelPreset").addEventListener("click", () => {
      presetMode = "view";
      if ($("presetName")) $("presetName").value = "";
      if ($("systemPrompt")) $("systemPrompt").value = getPresetPrompt(presetKey());
      applyPresetMode();
    });
  }

  if ($("btnSavePreset")) {
    $("btnSavePreset").addEventListener("click", () => {
      const prompt = $("systemPrompt") ? $("systemPrompt").value.trim() : "";
      const name = $("presetName") ? $("presetName").value.trim() : "";
      if (!name) return setStatus(tr("ps.noName"), RED);
      if (!prompt) return setStatus(tr("ps.noPrompt"), RED);
      const editing = presetMode === "edit";
      const key = editing ? presetKey() : "custom_" + Date.now();
      if (editing && !customPresets[key]) return;
      customPresets[key] = { name, prompt };
      lsSet(K_PRESETS, customPresets);
      presetMode = "view";
      if ($("presetName")) $("presetName").value = "";
      renderPresetOptions(key);
      setStatus(tr(editing ? "ps.updated" : "ps.saved"), GREEN);
    });
  }

  if ($("btnCloseServiceHelp")) {
    $("btnCloseServiceHelp").addEventListener("click", () => {
      const box = $("serviceHelp");
      if (box) box.style.display = "none";
    });
  }

  if ($("btnDeletePreset")) {
    $("btnDeletePreset").addEventListener("click", () => {
      const key = $("presetSelect") ? $("presetSelect").value : "";
      if (BUILTIN_PRESETS[key]) return setStatus(tr("ps.noDeleteBuiltin"), RED);
      if (deleteArmedKey !== key) {
        deleteArmedKey = key;
        $("btnDeletePreset").textContent = tr("btn.confirm");
        setTimeout(() => { if (deleteArmedKey === key) disarmDelete(); }, 3000);
        return;
      }
      delete customPresets[key];
      lsSet(K_PRESETS, customPresets);
      disarmDelete();
      renderPresetOptions("strict_proofread");
      setStatus(tr("ps.deleted"));
    });
  }
}

const PANELS = [["helpBox", "btnHelp"], ["aboutBox", "btnAbout"]];
function showPanel(openId) {
  PANELS.forEach(([box]) => { if ($(box)) $(box).style.display = box === openId ? "block" : "none"; });
}
function togglePanel(id) {
  showPanel($(id) && $(id).style.display === "block" ? null : id);
}
if ($("btnHelp")) $("btnHelp").addEventListener("click", () => togglePanel("helpBox"));
if ($("btnAbout")) $("btnAbout").addEventListener("click", () => togglePanel("aboutBox"));
document.addEventListener("click", (e) => {
  const inside = PANELS.some(([box, btn]) => [$(box), $(btn)].some((n) => n && n.contains(e.target)));
  if (!inside) showPanel(null);
});

function openLink(url) {
  try {
    Promise.resolve(shell.openExternal(url)).catch((e) => console.warn("openExternal failed", e));
  } catch (e) {
    console.warn("openExternal failed", e);
  }
}

[["btnOpenGithub", URL_README], ["btnOpenChangelog", URL_CHANGELOG], ["btnKofi", URL_KOFI]].forEach(([id, url]) => {
  if ($(id)) $(id).addEventListener("click", () => openLink(url));
});

function updateLangButtons() {
  ["th", "en"].forEach((l) => {
    const b = $("lang" + l.toUpperCase());
    if (b) b.classList.toggle("active", uiLang === l);
  });
}

function syncReadyStatus() {
  const s = $("status");
  if (s && (s.textContent === I18N.th["status.ready"] || s.textContent === I18N.en["status.ready"])) s.textContent = tr("status.ready");
}

function onUiLangChange(lang) {
  const sel = $("presetSelect");
  const box = $("systemPrompt");
  const cur = sel ? sel.value : "";
  const stock = BUILTIN_PRESETS[cur] ? Object.keys(BUILTIN_PRESETS[cur].prompts).map((l) => BUILTIN_PRESETS[cur].prompts[l]) : [];
  const keepTyped = !!(box && stock.indexOf(box.value) < 0);
  const typed = box ? box.value : "";

  setUiLang(lang);
  updateLangButtons();
  syncReadyStatus();
  updateIgnoreLabel();
  renderFindings();

  if (sel) {
    renderPresetOptions(cur);
    if (box && keepTyped) box.value = typed;
  }
  disarmDelete();
  refreshLangUI();
}

function bindAutoSelect(elementId) {
  const el = $(elementId);
  if (!el) return;
  el.addEventListener("click", () => {
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {
      console.warn("Select text failed:", e);
    }
  });
}

async function copyToClipboard(text) {
  if (!text) return;
  try {
    const { clipboard } = require("uxp");
    if (clipboard) {
      await clipboard.setContent({ "text/plain": text });
      setStatus(uiLang === "th" ? "คัดลอกคำสั่งเรียบร้อยแล้ว!" : "Command copied to clipboard!", GREEN);
    } else {
      throw new Error("UXP Clipboard API not available");
    }
  } catch (err) {
    console.warn("Clipboard write failed:", err);
    setStatus(uiLang === "th" ? "คัดลอกไม่สำเร็จ" : "Failed to copy text.", RED);

    try {
      await navigator.clipboard.writeText(text);
      setStatus(uiLang === "th" ? "คัดลอกคำสั่งเรียบร้อยแล้ว!" : "Command copied to clipboard!", GREEN);
    } catch (fallbackErr) {
      console.error("Fallback copy failed:", fallbackErr);
      setStatus(uiLang === "th" ? "คัดลอกไม่สำเร็จ" : "Failed to copy text.", RED);
    }
  }
}

function lockWheelOnFields() {
  const block = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const locked = new WeakSet();
  const attach = () => {
    document.querySelectorAll("select, sp-dropdown, input, textarea, sp-textarea").forEach((n) => {
      if (locked.has(n)) return;
      locked.add(n);
      n.addEventListener("wheel", block, { passive: false, capture: true });
    });
  };
  attach();
  document.addEventListener("wheel", (e) => {
    const t = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : "";
    if (t === "select" || t === "sp-dropdown" || t === "input" || t === "textarea" || t === "sp-textarea") block(e);
  }, { passive: false, capture: true });
}

function init() {
  applyI18n();
  updateLangButtons();
  if ($("langTH")) $("langTH").addEventListener("click", () => onUiLangChange("th"));
  if ($("langEN")) $("langEN").addEventListener("click", () => onUiLangChange("en"));
  initAccordions();
  lockWheelOnFields();
  ignoreSet = new Set(lsGet(K_IGNORE, []));

  initSegmenter();

  updateIgnoreLabel();
  initPresets();
  initSettings();

  if ($("btnSaveServerScript")) {
    $("btnSaveServerScript").addEventListener("click", async () => {
      try {
        const { storage } = require("uxp");
        const pluginFolder = await storage.localFileSystem.getPluginFolder();
        const scriptEntry = await pluginFolder.getEntry("spellcheck_server.py");
        const scriptContent = await scriptEntry.read();

        const targetFile = await storage.localFileSystem.getFileForSaving("spellcheck_server.py", {
          types: ["py"]
        });

        if (targetFile) {
          await targetFile.write(scriptContent);
          const savedScriptFullPath = targetFile.nativePath;

          lsSet("ai_proofread_saved_script_path", savedScriptFullPath);

          const runCommand = `python "${savedScriptFullPath}"`;
          if ($("runCmdCode")) $("runCmdCode").textContent = runCommand;
          if ($("savedScriptPath")) $("savedScriptPath").textContent = `Saved: ${savedScriptFullPath}`;

          setStatus(uiLang === "th" ? "บันทึกไฟล์ spellcheck_server.py เรียบร้อยแล้ว!" : "Script saved successfully!", GREEN);
        }
      } catch (e) {
        console.warn("Failed to save script:", e);
        setStatus(uiLang === "th" ? "ไม่สามารถบันทึกไฟล์ได้" : "Failed to save script file.", RED);
      }
    });
  }

  if ($("btnSaveLauncher")) {
    $("btnSaveLauncher").addEventListener("click", async () => {
      try {
        const { storage } = require("uxp");

        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const sourceFileName = isMac ? "spellcheck_launcher.command" : "spellcheck_launcher.bat";
        const fileExt = isMac ? "command" : "bat";

        const pluginFolder = await storage.localFileSystem.getPluginFolder();
        const launcherEntry = await pluginFolder.getEntry(sourceFileName);
        const launcherContent = await launcherEntry.read();

        const targetFile = await storage.localFileSystem.getFileForSaving(sourceFileName, {
          types: [fileExt]
        });

        if (targetFile) {
          await targetFile.write(launcherContent);
          setStatus(
            uiLang === "th"
              ? `บันทึกไฟล์ ${sourceFileName} เรียบร้อยแล้ว!`
              : `Saved ${sourceFileName} successfully!`,
            GREEN
          );
        }
      } catch (e) {
        console.warn("Failed to save launcher file:", e);
        setStatus(
          uiLang === "th" ? "ไม่สามารถบันทึกไฟล์ตัวรันได้" : "Failed to save launcher file.",
          RED);
      }
    });
  }

  function updateSavedPathUI(path) {
    if (!path) return;
    const runCommand = `python "${path}"`;
    if ($("runCmdCode")) $("runCmdCode").textContent = runCommand;
    if ($("savedScriptPath")) $("savedScriptPath").textContent = `Saved to: ${path}`;
  }

  if ($("linkPython")) {
    $("linkPython").addEventListener("click", () => {
      openLink("[https://www.python.org/downloads/](https://www.python.org/downloads/)");
    });
  }

  if ($("btnCopyPip")) {
    $("btnCopyPip").addEventListener("click", async () => {
      const text = $("pipInstallCode") ? $("pipInstallCode").textContent.trim() : "";
      await copyToClipboard(text);
    });
  }

  if ($("btnCopyRun")) {
    $("btnCopyRun").addEventListener("click", async () => {
      const text = $("runCmdCode") ? $("runCmdCode").textContent.trim() : "";
      await copyToClipboard(text);
    });
  }

  if ($("btnClearIgnore")) {
    $("btnClearIgnore").addEventListener("click", () => {
      ignoreSet.clear();
      lsSet(K_IGNORE, []);
      updateIgnoreLabel();
      setStatus(tr("ign.cleared"));
    });
  }

  if ($("btnCheck")) $("btnCheck").addEventListener("click", runCheck);
  if ($("btnResetAll")) $("btnResetAll").addEventListener("click", resetCheck);
  if ($("btnCancel")) $("btnCancel").addEventListener("click", () => { cancelled = true; setStatus(tr("run.stopping")); });

  // เช็ก Document ปัจจุบันทันทีที่เปิด Plugin
  syncStateWithActiveDocument();
}

init();