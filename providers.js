"use strict";
/* ============================================================
 *  providers.js
 *  - ผู้ให้บริการ AI (LM Studio / Ollama / OpenAI / Claude / Gemini / อื่น ๆ)
 *  - โปรไฟล์การเชื่อมต่อ + เก็บ API key
 *  - ตัวเรียกโมเดลแบบรวมศูนย์ (retry / timeout / ปรับพารามิเตอร์อัตโนมัติเมื่อโมเดลไม่รองรับ)
 *  - Telemetry (จำนวน token, ความเร็ว, บันทึกการทำงาน)
 *  - ตัวเรียกบริการตรวจสะกดภายนอก (PyThaiNLP)
 * ============================================================ */

const K_PROFILES = "ai_proofread_profiles_v2";
const K_KEY_PREFIX = "ai_proofread_key_";

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
  custom: { get label() { return tr("prov.custom"); }, type: "openai", baseUrl: "http://127.0.0.1:8000/v1", needsKey: false, cloud: true, tokenParam: "max_tokens", jsonMode: "object", parallel: 1, chunkLimit: 1200, timeoutSec: 120 }
};

/* ---------------- storage ---------------- */
function pLsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}
function pLsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn(e); }
}

let ProfileStore = { active: "", list: [] };
const keyCache = {};
const capsByProfile = {};

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
    cloudAck: false,
    maxTokens: 1500,
    think: "off",
    thinkBudget: 0
  };
}

function migrateProfile(p) {
  if (p.maxTokens === undefined) p.maxTokens = 1500;
  if (p.think === undefined) p.think = "off";
  if (p.thinkBudget === undefined) p.thinkBudget = 0;
  return p;
}

function loadProfiles() {
  const saved = pLsGet(K_PROFILES, null);
  if (saved && Array.isArray(saved.list) && saved.list.length) {
    ProfileStore = saved;
    ProfileStore.list.forEach(migrateProfile);
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

const KeyStore = {
  mode: "unknown",
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
  const name = profile ? profile.name : tr("err.provider");
  if (e && e.timeout) return tr("err.timeout", { name });
  if (e && e.network) return tr("err.network", { name, url: profile ? profile.baseUrl : "" });
  const hints = {};
  [400, 401, 403, 404, 429, 529].forEach((c) => { hints[c] = tr("http." + c); });
  const status = e && e.status;
  const hint = hints[status] || (status ? "HTTP " + status : String((e && e.message) || e));
  const snip = e && e.body ? extractErrMsg(e.body) : "";
  return `${name}: ${hint}${snip ? " — " + snip : ""}`;
}

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
  const meta = {};
  const cleanId = (id) => String(id || "").replace(/^models\//, "");
  const ctxOf = (m) => m.context_length || m.context_window || m.max_context_length || m.max_input_tokens || m.inputTokenLimit || 0;
  if (providerType(profile) === "anthropic") {
    const data = await httpJson(base + "/models?limit=100", { method: "GET", headers: anthropicHeaders(key) }, 20);
    const raw = data.data || [];
    ids = raw.map((m) => String(m.id));
    raw.forEach((m) => { meta[m.id] = { ctx: ctxOf(m) }; });
  } else {
    const headers = {};
    if (key) headers["Authorization"] = "Bearer " + key;
    const data = await httpJson(base + "/models", { method: "GET", headers }, 20);
    const raw = data.data || data.models || [];
    raw.forEach((m) => {
      const id = cleanId(m.id || m.name);
      const sp = Array.isArray(m.supported_parameters) ? m.supported_parameters : null;
      meta[id] = { ctx: ctxOf(m), reasoning: sp ? (sp.indexOf("reasoning") >= 0 || sp.indexOf("include_reasoning") >= 0) : undefined };
    });
    ids = raw.map((m) => cleanId(m.id || m.name)).filter((id) => id && !/embed|whisper|tts|dall-e|moderation|rerank|transcribe|realtime|audio|image/i.test(id));
    if (profile.preset === "lmstudio") {
      try {
        const nat = await httpJson(base.replace(/\/v1$/, "") + "/api/v0/models", { method: "GET", headers }, 10);
        (nat.data || []).forEach((m) => {
          meta[m.id] = Object.assign(meta[m.id] || {}, {
            ctx: m.loaded_context_length || m.max_context_length || 0,
            maxCtx: m.max_context_length || 0,
            loaded: m.state === "loaded",
            quant: m.quantization || ""
          });
        });
      } catch (e) {}
    }
  }
  ids.sort();
  return { ids, ms: Date.now() - t0, meta };
}

/* ---------------- Thinking / Reasoning ---------------- */
const LOCAL_PRESETS = ["lmstudio", "ollama", "custom"];
const THINK_OFF_MAP = { openai: "minimal", gemini: "none", groq: "none", xai: "low" };
const THINK_EFFORT_PRESETS = ["openai", "gemini", "groq", "xai", "lmstudio", "ollama", "custom"];
const THINK_BUDGET_DEFAULT = { low: 2048, medium: 6000, high: 12000 };

function thinkNote(preset) {
  const base = tr("tn.base");
  if (preset === "anthropic") return tr("tn.anthropic") + base;
  if (preset === "openai") return tr("tn.openai") + base;
  if (preset === "gemini") return tr("tn.gemini") + base;
  if (preset === "openrouter") return tr("tn.openrouter") + base;
  if (preset === "groq" || preset === "xai") return tr("tn.groqxai") + base;
  if (LOCAL_PRESETS.indexOf(preset) >= 0) return tr("tn.local") + base;
  return tr("tn.none");
}

function applyThinkOpenAI(profile, caps, body) {
  const th = profile.think || "off";
  if (th === "auto" || caps.think === false) return;
  const pid = profile.preset;
  const isOff = th === "off" || th === "disabled" || th === "ปิด";

  if (isOff) {
    // 🟢 ส่งสวิตช์ปิด Thinking ทุกรูปแบบที่ LM Studio / llama.cpp / OpenAI ดักอ่าน
    body.reasoning_effort = "none";
    body.reasoning = "none";
    body.chat_template_config = { enable_thinking: false };
    body.thinking = { type: "disabled" };
  } else {
    if (pid === "openrouter") { body.reasoning = { effort: th }; return; }
    body.reasoning_effort = th;
    body.chat_template_config = { enable_thinking: true };
    body.thinking = { type: "enabled" };
  }
}

/* ---------------- เรียกโมเดล ---------------- */
function adaptOpenAICaps(caps, profile, errText) {
  const t = String(errText || "").toLowerCase();
  const mode = caps.jsonMode || profile.jsonMode;
  if (/reasoning|thinking/.test(t) && caps.think !== false && (profile.think || "auto") !== "auto") { caps.think = false; return true; }
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
  if (/thinking|budget_tokens/.test(t) && caps.think !== false && (profile.think || "auto") !== "auto") { caps.think = false; return true; }
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
    
    // 🟢 จัดการ Payload ส่งไปที่ API ให้สอดคล้องกับค่าที่ผู้ใช้กำหนดใน UXP
    const body = {
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      stream: false
    };

    if (profile.model) body.model = profile.model;
    
    // 🟢 ส่ง Temperature จาก Profile / Request
    const tempVal = req.temperature !== undefined ? req.temperature : profile.temperature;
    if (caps.temperature !== false) body.temperature = Number(tempVal) || 0;

    // 🟢 ส่ง Thinking Mode
    applyThinkOpenAI(profile, caps, body);

    // 🟢 ส่ง Max Tokens
    const tokenKey = caps.tokenParam || presetOf(profile).tokenParam || "max_tokens";
    body[tokenKey] = req.maxTokens || profile.maxTokens || 1500;

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
  throw new HttpError(tr("err.adapt"), 400);
}

async function completeAnthropic(profile, req, caps) {
  const key = keyCache[profile.id] || "";
  const base = profile.baseUrl.replace(/\/+$/, "");
  for (let attempt = 0; attempt < 4; attempt++) {
    const th = profile.think || "auto";
    const useThinking = (th === "low" || th === "medium" || th === "high") && caps.think !== false;
    const body = {
      model: profile.model,
      max_tokens: req.maxTokens || profile.maxTokens || 1500,
      system: req.system,
      messages: [{ role: "user", content: req.user }]
    };
    if (useThinking) {
      const budget = Math.max(1024, parseInt(profile.thinkBudget, 10) || THINK_BUDGET_DEFAULT[th]);
      body.thinking = { type: "enabled", budget_tokens: budget };
      body.max_tokens = (req.maxTokens || profile.maxTokens || 1500) + budget;
    } else if (caps.temperature !== false) {
      body.temperature = Number(profile.temperature) || 0;
    }
    if (!useThinking && (caps.jsonMode || profile.jsonMode) === "structured") {
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
  throw new HttpError(tr("err.adapt"), 400);
}

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
        Tele.add(tr("tele.retry", { n: attempt, msg: friendlyError(e, profile) }));
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
  failed(label, msg) { this.fail++; this.add(tr("tele.failed", { label, msg })); },
  summary() {
    if (!this.req && !this.fail) return "";
    const avgTps = this.tpsN ? (this.tpsSum / this.tpsN).toFixed(1) : "-";
    const avgS = this.req ? (this.ms / this.req / 1000).toFixed(1) : "-";
    return tr("sum.main", { req: this.req, inTok: this.inTok, outTok: this.outTok, tps: avgTps, s: avgS }) +
      (this.fail ? tr("sum.fail", { n: this.fail }) : "") + (this.parseBad ? tr("sum.parse", { n: this.parseBad }) : "");
  }
};