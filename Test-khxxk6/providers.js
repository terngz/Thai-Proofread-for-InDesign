"use strict";
/* ============================================================
 *  providers.js
 *  - ผู้ให้บริการ AI (LM Studio / Ollama / OpenAI / Claude / Gemini / อื่น ๆ)
 *  - โปรไฟล์การเชื่อมต่อ + เก็บ API key
 *  - ตัวเรียกโมเดลแบบรวมศูนย์ (retry / timeout / ปรับพารามิเตอร์อัตโนมัติเมื่อโมเดลไม่รองรับ)
 *  - Telemetry (จำนวน token, ความเร็ว, บันทึกการทำงาน)
 *  - ตัวเรียกบริการตรวจสะกดภายนอก (PyThaiNLP)
 *  โหลดก่อน index.js ; ใช้ RESPONSE_SCHEMA ที่ประกาศใน index.js (อ้างตอนเรียกใช้เท่านั้น)
 * ============================================================ */

const K_PROFILES = "ai_proofread_profiles_v2";
const K_KEY_PREFIX = "ai_proofread_key_";

// jsonMode: structured = บังคับโครงสร้าง JSON (json_schema / tool use) | object = json_object | off = ไม่บังคับ
// URL / ชื่อโมเดลของแต่ละเจ้าเปลี่ยนได้ ควรเทียบกับเอกสารของผู้ให้บริการอีกครั้ง
const PROVIDER_PRESETS = {
  lmstudio: { label: "LM Studio (Local)", type: "openai", baseUrl: "http://127.0.0.1:1234/v1", needsKey: false, cloud: false, tokenParam: "max_tokens", jsonMode: "structured", parallel: 1, chunkLimit: 800, timeoutSec: 180 },
  ollama: { label: "Ollama (Local)", type: "openai", baseUrl: "http://127.0.0.1:11434/v1", needsKey: false, cloud: false, tokenParam: "max_tokens", jsonMode: "structured", parallel: 1, chunkLimit: 800, timeoutSec: 180 },
  openai: { label: "OpenAI (ChatGPT)", type: "openai", baseUrl: "https://api.openai.com/v1", needsKey: true, cloud: true, tokenParam: "max_completion_tokens", jsonMode: "structured", parallel: 3, chunkLimit: 2500, timeoutSec: 90 },
  anthropic: { label: "Anthropic (Claude)", type: "anthropic", baseUrl: "https://api.anthropic.com/v1", needsKey: true, cloud: true, jsonMode: "structured", parallel: 3, chunkLimit: 2500, timeoutSec: 90 },
  gemini: { label: "Google Gemini", type: "openai", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "structured", parallel: 3, chunkLimit: 2500, timeoutSec: 90 },
  openrouter: { label: "OpenRouter", type: "openai", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 3, chunkLimit: 2000, timeoutSec: 90 },
  groq: { label: "Groq", type: "openai", baseUrl: "https://api.groq.com/openai/v1", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 2, chunkLimit: 2000, timeoutSec: 60 },
  mistral: { label: "Mistral", type: "openai", baseUrl: "https://api.mistral.ai/v1", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 3, chunkLimit: 2000, timeoutSec: 90 },
  deepseek: { label: "DeepSeek", type: "openai", baseUrl: "https://api.deepseek.com/v1", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 2, chunkLimit: 2000, timeoutSec: 120 },
  xai: { label: "xAI (Grok)", type: "openai", baseUrl: "https://api.x.ai/v1", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 2, chunkLimit: 2000, timeoutSec: 90 },
  together: { label: "Together AI", type: "openai", baseUrl: "https://api.together.xyz/v1", needsKey: true, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 3, chunkLimit: 2000, timeoutSec: 90 },
  custom: { label: "อื่น ๆ (OpenAI-compatible)", type: "openai", baseUrl: "http://127.0.0.1:8000/v1", needsKey: false, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 1, chunkLimit: 1200, timeoutSec: 120 }
};

/* ---------------- storage ---------------- */
function pLsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function pLsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn(e); }
}

let ProfileStore = { active: "", list: [] };
const keyCache = {};          // id -> API key (อยู่ในหน่วยความจำเท่านั้น)
const capsByProfile = {};     // id -> ความสามารถที่ตรวจพบระหว่างใช้งาน (เช่น temperature ใช้ไม่ได้)

function presetOf(profile) { return PROVIDER_PRESETS[profile.preset] || PROVIDER_PRESETS.custom; }
function providerType(profile) { return presetOf(profile).type; }

function makeProfile(presetId, name) {
  const p = PROVIDER_PRESETS[presetId] || PROVIDER_PRESETS.custom;
  return {
    id: "p" + Date.now().toString(36) + Math.floor(Math.random() * 1000),
    preset: PROVIDER_PRESETS[presetId] ? presetId : "custom",
    name: name || p.label,
    baseUrl: p.baseUrl,
    model: "",
    temperature: 0,
    timeoutSec: p.timeoutSec,
    retries: 2,
    parallel: p.parallel,
    chunkLimit: p.chunkLimit,
    jsonMode: p.jsonMode,
    lmNative: true,
    cloudAck: false
  };
}

function loadProfiles() {
  const saved = pLsGet(K_PROFILES, null);
  if (saved && Array.isArray(saved.list) && saved.list.length) {
    ProfileStore = saved;
    if (!ProfileStore.list.some((p) => p.id === ProfileStore.active)) ProfileStore.active = ProfileStore.list[0].id;
  } else {
    const p = makeProfile("lmstudio");
    ProfileStore = { active: p.id, list: [p] };
    saveProfiles();
  }
}
function saveProfiles() { pLsSet(K_PROFILES, ProfileStore); }
function activeProfile() {
  return ProfileStore.list.find((p) => p.id === ProfileStore.active) || ProfileStore.list[0];
}

/* ---------------- API key ---------------- */
function decodeBytes(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return new TextDecoder().decode(v); } catch (e) {}
  let s = "";
  const a = new Uint8Array(v.buffer || v);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return s;
}

// พยายามใช้ secureStorage ของ UXP ก่อน ถ้าใช้ไม่ได้ค่อยถอยไป localStorage (ไม่เข้ารหัส)
const KeyStore = {
  mode: "unknown", // "secure" | "plain"
  _ss() {
    try {
      const u = require("uxp");
      return u.storage && u.storage.secureStorage ? u.storage.secureStorage : null;
    } catch (e) { return null; }
  },
  async get(id) {
    const name = K_KEY_PREFIX + id;
    const ss = this._ss();
    if (ss) {
      try {
        const v = await ss.getItem(name);
        const s = decodeBytes(v);
        if (s) { this.mode = "secure"; return s; }
      } catch (e) {}
    }
    try {
      const v = localStorage.getItem(name);
      if (v) { if (!ss) this.mode = "plain"; return v; }
    } catch (e) {}
    return "";
  },
  async set(id, value) {
    const name = K_KEY_PREFIX + id;
    const ss = this._ss();
    if (ss) {
      try { await ss.setItem(name, value); this.mode = "secure"; try { localStorage.removeItem(name); } catch (e) {} return; } catch (e) {}
      try { await ss.setItem(name, new TextEncoder().encode(value)); this.mode = "secure"; try { localStorage.removeItem(name); } catch (e) {} return; } catch (e) {}
    }
    try { localStorage.setItem(name, value); this.mode = "plain"; } catch (e) { console.warn(e); }
  },
  async remove(id) {
    const name = K_KEY_PREFIX + id;
    const ss = this._ss();
    if (ss) { try { await ss.removeItem(name); } catch (e) {} }
    try { localStorage.removeItem(name); } catch (e) {}
  }
};

async function loadKeyFor(profile) {
  keyCache[profile.id] = await KeyStore.get(profile.id);
  return keyCache[profile.id];
}

/* ---------------- HTTP ---------------- */
class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status || 0;
    this.body = body || "";
  }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function httpJson(url, opts, timeoutSec) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => { const e = new HttpError("timeout", 0); e.timeout = true; rej(e); }, (timeoutSec || 120) * 1000);
  });
  try {
    let res;
    try {
      res = await Promise.race([fetch(url, opts), timeout]);
    } catch (e) {
      if (e && e.timeout) throw e;
      const ne = new HttpError("network", 0);
      ne.network = true;
      ne.detail = String((e && e.message) || e);
      throw ne;
    }
    if (!res.ok) {
      let body = "";
      try { body = await res.text(); } catch (e) {}
      throw new HttpError("HTTP " + res.status, res.status, body);
    }
    return await Promise.race([res.json(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function extractErrMsg(body) {
  try {
    let j = JSON.parse(body);
    if (Array.isArray(j)) j = j[0] || {};
    const m = (j.error && (j.error.message || j.error)) || j.message || "";
    return String(m).slice(0, 160);
  } catch (e) { return String(body || "").slice(0, 120); }
}

function friendlyError(e, profile) {
  const name = profile ? profile.name : "ผู้ให้บริการ";
  if (e && e.timeout) return `${name}: ไม่ตอบภายในเวลาที่กำหนด (เพิ่ม Timeout หรือใช้โมเดลที่เร็วขึ้น)`;
  if (e && e.network) return `${name}: เชื่อมต่อไม่ได้ (${profile ? profile.baseUrl : ""}) ตรวจ URL / เปิด server / อินเทอร์เน็ต`;
  const hints = {
    400: "คำขอไม่ถูกต้อง",
    401: "API key ไม่ถูกต้องหรือหมดอายุ",
    403: "ไม่มีสิทธิ์ใช้งาน (ตรวจ key / ภูมิภาค / การเรียกเก็บเงิน)",
    404: "ไม่พบ endpoint หรือโมเดล (ตรวจ Base URL และชื่อโมเดล)",
    429: "ถูกจำกัดอัตราหรือโควตาหมด",
    529: "ผู้ให้บริการกำลังโหลดหนัก"
  };
  const status = e && e.status;
  const hint = hints[status] || (status ? "HTTP " + status : String((e && e.message) || e));
  const snip = e && e.body ? extractErrMsg(e.body) : "";
  return `${name}: ${hint}${snip ? " — " + snip : ""}`;
}
// ข้อผิดพลาดที่ลองใหม่ก็ไม่หาย -> หยุดทั้งงาน
function isFatalError(e) {
  return !!e && (e.status === 401 || e.status === 403 || e.status === 404 || e.status === 400);
}

/* ---------------- รายชื่อโมเดล ---------------- */
function anthropicHeaders(key) {
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  };
}

async function providerListModels(profile) {
  const key = keyCache[profile.id] || "";
  const base = profile.baseUrl.replace(/\/+$/, "");
  const t0 = Date.now();
  let ids;
  if (providerType(profile) === "anthropic") {
    const data = await httpJson(base + "/models?limit=100", { method: "GET", headers: anthropicHeaders(key) }, 20);
    ids = (data.data || []).map((m) => String(m.id));
  } else {
    const headers = {};
    if (key) headers["Authorization"] = "Bearer " + key;
    const data = await httpJson(base + "/models", { method: "GET", headers }, 20);
    ids = (data.data || data.models || []).map((m) => String(m.id || m.name || ""));
    ids = ids.map((id) => id.replace(/^models\//, "")).filter((id) => id && !/embed|whisper|tts|dall-e|moderation|rerank|transcribe|realtime|audio|image/i.test(id));
  }
  ids.sort();
  return { ids, ms: Date.now() - t0 };
}

/* ---------------- เรียกโมเดล ---------------- */
function adaptOpenAICaps(caps, profile, errText) {
  const t = String(errText || "").toLowerCase();
  const mode = caps.jsonMode || profile.jsonMode;
  if (/temperature/.test(t) && caps.temperature !== false) { caps.temperature = false; return true; }
  if (/max_completion_tokens|max_tokens/.test(t) && !caps.tokenSwapped) {
    const cur = caps.tokenParam || presetOf(profile).tokenParam || "max_tokens";
    caps.tokenParam = cur === "max_tokens" ? "max_completion_tokens" : "max_tokens";
    caps.tokenSwapped = true;
    return true;
  }
  if (mode === "structured") { caps.jsonMode = "object"; return true; }
  if (mode === "object") { caps.jsonMode = "off"; return true; }
  return false;
}

function adaptAnthropicCaps(caps, profile, errText) {
  const t = String(errText || "").toLowerCase();
  if (/temperature/.test(t) && caps.temperature !== false) { caps.temperature = false; return true; }
  if ((caps.jsonMode || profile.jsonMode) === "structured") { caps.jsonMode = "off"; return true; }
  return false;
}

async function completeOpenAI(profile, req, caps) {
  const key = keyCache[profile.id] || "";
  const base = profile.baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = "Bearer " + key;

  for (let attempt = 0; attempt < 6; attempt++) {
    const useNative = profile.preset === "lmstudio" && profile.lmNative !== false && !caps.nativeFail;
    const url = useNative ? base.replace(/\/v1$/, "") + "/api/v0/chat/completions" : base + "/chat/completions";
    const body = {
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      stream: false
    };
    if (profile.model) body.model = profile.model;
    if (caps.temperature !== false) body.temperature = Number(profile.temperature) || 0;
    body[caps.tokenParam || presetOf(profile).tokenParam || "max_tokens"] = req.maxTokens;
    const mode = caps.jsonMode || profile.jsonMode;
    if (mode === "structured") body.response_format = RESPONSE_SCHEMA;
    else if (mode === "object") body.response_format = { type: "json_object" };

    let data;
    try {
      data = await httpJson(url, { method: "POST", headers, body: JSON.stringify(body) }, profile.timeoutSec);
    } catch (e) {
      if (useNative && (e.status === 404 || e.status === 405)) { caps.nativeFail = true; continue; }
      if (e.status === 400) {
        if (adaptOpenAICaps(caps, profile, e.body)) continue;
        if (useNative) { caps.nativeFail = true; continue; }
      }
      throw e;
    }
    const choice = (data.choices && data.choices[0]) || {};
    const usage = data.usage || {};
    const stats = data.stats || {};
    return {
      text: (choice.message && choice.message.content) || "",
      finish: choice.finish_reason || "",
      inTok: usage.prompt_tokens || 0,
      outTok: usage.completion_tokens || 0,
      tps: stats.tokens_per_second || null,
      ttft: stats.time_to_first_token || null
    };
  }
  throw new HttpError("ปรับพารามิเตอร์แล้วยังใช้ไม่ได้", 400);
}

async function completeAnthropic(profile, req, caps) {
  const key = keyCache[profile.id] || "";
  const base = profile.baseUrl.replace(/\/+$/, "");
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = {
      model: profile.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: "user", content: req.user }]
    };
    if (caps.temperature !== false) body.temperature = Number(profile.temperature) || 0;
    if ((caps.jsonMode || profile.jsonMode) === "structured") {
      body.tools = [{
        name: "report_errors",
        description: "รายงานจุดที่ผิด ถ้าไม่พบจุดผิดให้ส่ง errors เป็น array ว่าง",
        input_schema: RESPONSE_SCHEMA.json_schema.schema
      }];
      body.tool_choice = { type: "tool", name: "report_errors" };
    }
    let data;
    try {
      data = await httpJson(base + "/messages", { method: "POST", headers: anthropicHeaders(key), body: JSON.stringify(body) }, profile.timeoutSec);
    } catch (e) {
      if (e.status === 400 && adaptAnthropicCaps(caps, profile, e.body)) continue;
      throw e;
    }
    let text = "";
    for (const b of data.content || []) {
      if (b.type === "tool_use") { text = JSON.stringify(b.input); break; }
      if (b.type === "text") text += b.text || "";
    }
    const usage = data.usage || {};
    return { text, finish: data.stop_reason || "", inTok: usage.input_tokens || 0, outTok: usage.output_tokens || 0, tps: null, ttft: null };
  }
  throw new HttpError("ปรับพารามิเตอร์แล้วยังใช้ไม่ได้", 400);
}

// req = { system, user, maxTokens }  ->  { text, inTok, outTok, tps, ttft, ms, finish }
async function providerComplete(profile, req) {
  const caps = capsByProfile[profile.id] || (capsByProfile[profile.id] = {});
  const retries = Math.max(0, parseInt(profile.retries, 10) || 0);
  let attempt = 0;
  for (;;) {
    const t0 = Date.now();
    try {
      const r = providerType(profile) === "anthropic"
        ? await completeAnthropic(profile, req, caps)
        : await completeOpenAI(profile, req, caps);
      r.ms = Date.now() - t0;
      if (!r.tps && r.outTok) r.tps = r.outTok / (Math.max(r.ms, 1) / 1000);
      return r;
    } catch (e) {
      const retriable = e.timeout || e.network || e.status === 429 || e.status === 529 || (e.status >= 500 && e.status < 600);
      if (retriable && attempt < retries) {
        attempt++;
        Tele.add(`ลองใหม่ครั้งที่ ${attempt} (${friendlyError(e, profile)})`);
        await sleep(1000 * Math.pow(2, attempt - 1));
        continue;
      }
      throw e;
    }
  }
}

/* ---------------- บริการตรวจสะกดภายนอก (PyThaiNLP) ---------------- */
async function serviceCheck(url, text, langsObj, timeoutSec) {
  const data = await httpJson(url.replace(/\/+$/, "") + "/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, th: !!langsObj.th, en: !!langsObj.en })
  }, timeoutSec || 30);
  return Array.isArray(data.errors) ? data.errors : [];
}
async function serviceHealth(url) {
  return httpJson(url.replace(/\/+$/, "") + "/health", { method: "GET" }, 8);
}

/* ---------------- Telemetry ---------------- */
function pad2(n) { return (n < 10 ? "0" : "") + n; }
const Tele = {
  log: [],
  req: 0, fail: 0, inTok: 0, outTok: 0, ms: 0, tpsSum: 0, tpsN: 0, parseBad: 0,
  reset() {
    this.req = 0; this.fail = 0; this.inTok = 0; this.outTok = 0; this.ms = 0; this.tpsSum = 0; this.tpsN = 0; this.parseBad = 0;
  },
  add(line) {
    const d = new Date();
    this.log.push(`${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}  ${line}`);
    if (this.log.length > 80) this.log.shift();
    if (this.onChange) this.onChange();
  },
  ok(r, label) {
    this.req++;
    this.inTok += r.inTok || 0;
    this.outTok += r.outTok || 0;
    this.ms += r.ms || 0;
    if (r.tps) { this.tpsSum += r.tps; this.tpsN++; }
    this.add(`${label}  ${(r.ms / 1000).toFixed(1)}s  in ${r.inTok || "-"} / out ${r.outTok || "-"} tok` +
      (r.tps ? `  ${r.tps.toFixed(1)} tok/s` : "") + (r.ttft ? `  TTFT ${Number(r.ttft).toFixed(2)}s` : ""));
  },
  failed(label, msg) { this.fail++; this.add(`${label}  ล้มเหลว: ${msg}`); },
  summary() {
    if (!this.req && !this.fail) return "";
    const avgTps = this.tpsN ? (this.tpsSum / this.tpsN).toFixed(1) : "-";
    const avgS = this.req ? (this.ms / this.req / 1000).toFixed(1) : "-";
    return `${this.req} request · in ${this.inTok} / out ${this.outTok} tok · เฉลี่ย ${avgTps} tok/s · ${avgS} วิ/request` +
      (this.fail ? ` · ล้มเหลว ${this.fail}` : "") + (this.parseBad ? ` · ตอบผิดรูปแบบ ${this.parseBad}` : "");
  }
};
