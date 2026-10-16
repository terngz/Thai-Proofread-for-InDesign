"use strict";
/* ============================================================
 *  settings.js : UI ตั้งค่าการเชื่อมต่อ AI / ทดสอบ / บันทึกการทำงาน / บริการตรวจสะกด
 * ============================================================ */

const K_SERVICE = "ai_proofread_service";
const K_ENGINE_MODE = "ai_proofread_engine_mode";
let connDeleteArmed = false;
let modelMeta = {};

// 🟢 อ่านเลขเวอร์ชันจากไฟล์ manifest.json โดยตรงเป็น Single Source of Truth
async function getPluginVersion() {
  try {
    const { localFileSystem } = require("uxp").storage;
    const pluginFolder = await localFileSystem.getPluginFolder();
    const manifestFile = await pluginFolder.getEntry("manifest.json");
    const content = await manifestFile.read();
    const json = JSON.parse(content);
    if (json && json.version) {
      return json.version;
    }
  } catch (e) {
    console.warn("Error reading manifest.json version:", e);
  }
  return "1.0.0";
}

function setHealth(state, tip) {
  const d = $("healthDot");
  if (d) {
    d.className = "dot " + (state || "");
    d.title = tip || "";
  }
}

function showConnResult(msg, kind) {
  const r = $("connResult");
  if (r) {
    r.textContent = msg;
    r.className = kind || "";
  }
}

function num(id, def, min, max) {
  let v = parseFloat($(id).value);
  if (isNaN(v)) v = def;
  return Math.min(max, Math.max(min, v));
}

/* ---------- สลับโหมด PyThaiNLP / AI Engine ---------- */
function syncEngineModeUI() {
  const isPy = $("modePyThaiNLP").checked;
  const pyBox = $("pythainlpConfigBox");
  const aiBox = $("aiConfigBox");
  const candRow = $("chkCandPyRow");
  
  if (pyBox) pyBox.style.display = isPy ? "block" : "none";
  if (aiBox) aiBox.style.display = isPy ? "none" : "block";
  if (candRow) candRow.style.display = isPy ? "flex" : "none";
  
  lsSet(K_ENGINE_MODE, isPy ? "pythainlp" : "ai");
}

function loadEngineModePref() {
  const savedMode = lsGet(K_ENGINE_MODE, "pythainlp");
  if (savedMode === "ai" && $("modeAI")) {
    $("modeAI").checked = true;
  } else if ($("modePyThaiNLP")) {
    $("modePyThaiNLP").checked = true;
  }
  syncEngineModeUI();
}

/* ---------- ฟอร์ม <-> โปรไฟล์ ---------- */
function updateConnHints(presetId) {
  const pr = PROVIDER_PRESETS[presetId] || PROVIDER_PRESETS.custom;
  if ($("connLmNativeRow")) $("connLmNativeRow").style.display = presetId === "lmstudio" ? "flex" : "none";
  if ($("connCloudRow")) $("connCloudRow").style.display = pr.cloud ? "block" : "none";
  if ($("connKeyLabel")) $("connKeyLabel").textContent = pr.needsKey ? "API KEY (จำเป็น)" : "API KEY (ถ้ามี)";
  if ($("connThinkNote")) $("connThinkNote").textContent = thinkNote(presetId);
  if ($("connThinkBudgetBox")) $("connThinkBudgetBox").style.display = presetId === "anthropic" ? "block" : "none";
}

function updateKeyNote(profile) {
  const has = !!keyCache[profile.id];
  if ($("connKey")) {
    $("connKey").value = "";
    $("connKey").setAttribute("placeholder", has ? "(บันทึกไว้แล้ว พิมพ์ใหม่เพื่อเปลี่ยน)" : "วาง API key ที่นี่");
  }
  const mode = KeyStore.mode === "secure" ? "เก็บในที่เก็บความลับของ UXP"
    : KeyStore.mode === "plain" ? "เก็บแบบไม่เข้ารหัสในเครื่องนี้" : "";
  if ($("connKeyNote")) $("connKeyNote").textContent = has && mode ? mode : "";
}

function fillForm(p) {
  if (!$("connPreset")) return;
  $("connPreset").value = p.preset;
  $("connName").value = p.name;
  $("connUrl").value = p.baseUrl;
  $("connModel").value = p.model || "";
  $("connTemp").value = p.temperature;
  $("connTimeout").value = p.timeoutSec;
  $("connRetries").value = p.retries;
  $("connParallel").value = p.parallel;
  $("connChunk").value = p.chunkLimit;
  $("connMaxTokens").value = p.maxTokens || 1500;
  $("connThink").value = p.think || "off";
  $("connThinkBudget").value = p.thinkBudget || "";
  $("connLmNative").checked = p.lmNative !== false;
  $("connCloudAck").checked = !!p.cloudAck;
  updateConnHints(p.preset);
  updateKeyNote(p);
}

function readForm(p) {
  if (!$("connPreset")) return p;
  p.preset = $("connPreset").value;
  p.name = $("connName").value.trim() || presetOf(p).label;
  p.baseUrl = $("connUrl").value.trim();
  p.model = $("connModel").value.trim();
  p.temperature = num("connTemp", 0, 0, 2);
  p.timeoutSec = num("connTimeout", 120, 10, 900);
  p.retries = num("connRetries", 2, 0, 5);
  p.parallel = Math.round(num("connParallel", 1, 1, 8));
  p.chunkLimit = Math.round(num("connChunk", 800, 300, 12000));
  p.jsonMode = "structured"; // ล็อคค่าอัตโนมัติ ไม่ต้องมี UI เลือก
  p.maxTokens = Math.round(num("connMaxTokens", 1500, 100, 64000));
  p.think = $("connThink").value;
  p.thinkBudget = Math.round(num("connThinkBudget", 0, 0, 64000));
  p.lmNative = $("connLmNative").checked;
  p.cloudAck = $("connCloudAck").checked;
  return p;
}

function getTestProfile() {
  const p = activeProfile();
  const tmp = readForm(Object.assign({}, p));
  tmp.id = "tmp";
  keyCache["tmp"] = ($("connKey") && $("connKey").value.trim()) || keyCache[p.id] || "";
  delete capsByProfile["tmp"];
  if (!tmp.baseUrl) { showConnResult("กรอก Base URL ก่อน", "err"); return null; }
  if (presetOf(tmp).needsKey && !keyCache["tmp"]) { showConnResult("ผู้ให้บริการนี้ต้องใช้ API key", "err"); return null; }
  return tmp;
}

function refreshHeader() {
  if ($("accModelTitle")) $("accModelTitle").textContent = "โมเดล AI · " + activeProfile().name;
}

function renderProfileSelect() {
  const sel = $("profileSelect");
  if (!sel) return;
  sel.innerHTML = "";
  ProfileStore.list.forEach((p) => { const o = el("option", "", p.name); o.value = p.id; sel.appendChild(o); });
  sel.value = ProfileStore.active;
}

function updateModelInfo() {
  const box = $("modelInfo");
  if (!box) return;
  const p = activeProfile();
  const id = ($("modelSelect") && $("modelSelect").value) || p.model;
  const m = id ? modelMeta[id] : null;
  box.className = "";
  if (!m) { box.textContent = ""; return; }
  const parts = [];
  if (m.ctx) parts.push("context " + m.ctx + (m.maxCtx && m.maxCtx !== m.ctx ? " (สูงสุด " + m.maxCtx + ")" : ""));
  if (m.quant) parts.push(m.quant);
  if (m.loaded === true) parts.push("โหลดอยู่");
  if (m.reasoning === true) parts.push("รองรับ reasoning");
  if (m.reasoning === false) parts.push("ไม่รองรับ reasoning");
  box.textContent = parts.join(" · ");
}

async function refreshModels() {
  const p = activeProfile();
  const sel = $("modelSelect");
  if (!sel) return;
  const add = (v, t) => { const o = el("option", "", t); o.value = v; sel.appendChild(o); };
  sel.innerHTML = "";
  if (presetOf(p).needsKey && !keyCache[p.id]) {
    add(p.model || "", p.model ? p.model + " (พิมพ์เอง)" : "ยังไม่ได้ใส่ API key (กด ตั้งค่า)");
    setHealth("", "ยังไม่ได้ใส่ API key");
    modelMeta = {};
    updateModelInfo();
    return;
  }
  add("", "กำลังโหลดรายชื่อโมเดล...");
  try {
    const r = await providerListModels(p);
    modelMeta = r.meta || {};
    sel.innerHTML = "";
    if (!r.ids.length) {
      add(p.model || "", p.model ? p.model + " (พิมพ์เอง)" : "ไม่พบโมเดล (Load โมเดลใน LM Studio ก่อน)");
    } else {
      if (!p.model || r.ids.indexOf(p.model) < 0) add("", "- เลือกโมเดล -");
      r.ids.forEach((id) => add(id, id));
      if (p.model && r.ids.indexOf(p.model) < 0) add(p.model, p.model + " (พิมพ์เอง)");
      if (p.model) sel.value = p.model;
      else if (!presetOf(p).cloud) { sel.value = r.ids[0]; p.model = r.ids[0]; saveProfiles(); if ($("connModel")) $("connModel").value = p.model; }
    }
    setHealth("ok", `เชื่อมต่อได้ (${r.ms} ms, ${r.ids.length} โมเดล)`);
    updateModelInfo();
  } catch (e) {
    modelMeta = {};
    updateModelInfo();
    sel.innerHTML = "";
    add(p.model || "", p.model ? p.model + " (พิมพ์เอง)" : "เชื่อมต่อไม่ได้");
    if (p.model) sel.value = p.model;
    setHealth("bad", friendlyError(e, p));
  }
}

async function saveConn() {
  const p = activeProfile();
  readForm(p);
  const keyIn = $("connKey") ? $("connKey").value.trim() : "";
  if (keyIn) { await KeyStore.set(p.id, keyIn); keyCache[p.id] = keyIn; }
  delete capsByProfile[p.id];
  saveProfiles();
  renderProfileSelect();
  refreshHeader();
  updateKeyNote(p);
  showConnResult("บันทึกแล้ว", "ok");
  await refreshModels();
}

async function testConn() {
  const tmp = getTestProfile();
  if (!tmp) return;
  showConnResult("กำลังทดสอบการเชื่อมต่อ...", "");
  try {
    const r = await providerListModels(tmp);
    setHealth("ok", `เชื่อมต่อได้ (${r.ms} ms)`);
    showConnResult(`เชื่อมต่อได้ · ${r.ms} ms · พบ ${r.ids.length} โมเดล`, "ok");
    Tele.add(`ทดสอบการเชื่อมต่อ ${tmp.name}: OK ${r.ms} ms`);
  } catch (e) {
    const msg = friendlyError(e, tmp);
    setHealth("bad", msg);
    showConnResult(msg, "err");
    Tele.add(`ทดสอบการเชื่อมต่อ ${tmp.name}: ล้มเหลว`);
  }
}

const SELFTEST_TEXT = "ประเทสไทยมีความหลากหลาย ผมไปไป โรงเรียนทุกวัน Please recieve the package.";
const SELFTEST_EXPECT = [
  ["ประเทส", (o) => o.indexOf("ประเทส") >= 0],
  ["ไปไป", (o) => o.indexOf("ไปไป") >= 0 || o.replace(/\s+/g, "") === "ไปไป"],
  ["recieve", (o) => o.toLowerCase().indexOf("recieve") >= 0]
];

async function selfTest() {
  const tmp = getTestProfile();
  if (!tmp) return;
  if (!tmp.model && presetOf(tmp).cloud) { showConnResult("เลือกหรือพิมพ์ชื่อโมเดลก่อน", "err"); return; }
  showConnResult("กำลังทดสอบโมเดล...", "");
  const req = {
    system: $("systemPrompt") ? $("systemPrompt").value.trim() : "",
    user: buildUserMessage(SELFTEST_TEXT, false),
    maxTokens: parseInt(tmp.maxTokens, 10) || 1500
  };
  try {
    const r = await providerComplete(tmp, req);
    Tele.ok(r, "self-test");
    const items = parseModelJson(r.text);
    const speed = ` · ${(r.ms / 1000).toFixed(1)} วิ` + (r.tps ? ` · ${r.tps.toFixed(1)} tok/s` : "");
    if (items === null) {
      Tele.parseBad++;
      setHealth("bad", "โมเดลตอบไม่เป็น JSON");
      showConnResult("โมเดลตอบแต่ไม่เป็น JSON ตามรูปแบบ" + speed, "err");
      return;
    }
    const hits = SELFTEST_EXPECT.map((x) => ({ label: x[0], ok: items.some((it) => it && typeof it.original === "string" && x[1](it.original)) }));
    const got = hits.filter((h) => h.ok).length;
    setHealth("ok", `ทดสอบโมเดลผ่าน (${got}/${hits.length})`);
    showConnResult(`จับได้ ${got}/${hits.length}: ` + hits.map((h) => h.label + (h.ok ? " (ได้)" : " (ไม่ได้)")) .join(", ") + speed, got === hits.length ? "ok" : "err");
  } catch (e) {
    const msg = friendlyError(e, tmp);
    setHealth("bad", msg);
    showConnResult(msg, "err");
    Tele.failed("self-test", msg);
  }
}

async function switchProfile(id) {
  ProfileStore.active = id;
  saveProfiles();
  const p = activeProfile();
  await loadKeyFor(p);
  fillForm(p);
  refreshHeader();
  showConnResult("", "");
  setHealth("", "");
  await refreshModels();
}

function loadServicePrefs() {
  const s = lsGet(K_SERVICE, { url: "http://127.0.0.1:8765" });
  if ($("serviceUrl")) $("serviceUrl").value = s.url || "http://127.0.0.1:8765";
}

function saveServicePrefs() {
  if ($("serviceUrl")) lsSet(K_SERVICE, { url: $("serviceUrl").value.trim() });
}

async function testService() {
  const url = $("serviceUrl") ? $("serviceUrl").value.trim() : "";
  const out = $("serviceResult");
  if (!out) return;
  out.className = "";
  out.textContent = "กำลังเชื่อมต่อ...";
  try {
    const t0 = Date.now();
    const h = await serviceHealth(url);
    out.className = "ok";
    out.textContent = `พร้อมใช้งาน · ${Date.now() - t0} ms` + (h && h.pythainlp ? ` · PyThaiNLP ${h.pythainlp}` : "");
    Tele.add("ทดสอบบริการตรวจสะกด: OK");
  } catch (e) {
    out.className = "err";
    out.textContent = e && e.network ? "เชื่อมต่อไม่ได้ (รัน spellcheck_server.py หรือยัง?)" : friendlyError(e, { name: "บริการตรวจสะกด", baseUrl: url });
  }
}

function renderLog() {
  if ($("logBox")) $("logBox").value = Tele.log.join("\n");
}

async function initSettings() {
  Tele.onChange = renderLog;
  loadProfiles();

  // 🟢 แสดงเลขเวอร์ชันโดยอ่านสดจาก manifest.json ตอนเริ่มต้น
  if ($("aboutVersion")) {
    getPluginVersion().then((v) => {
      $("aboutVersion").textContent = v;
    });
  }

  // 🟢 ผูก Event Listener ปุ่ม #btnAbout ให้กดเปิด/ปิดกล่องเกี่ยวกับ + ซิงค์เลขเวอร์ชัน
  if ($("btnAbout")) {
    $("btnAbout").addEventListener("click", async () => {
      const box = $("aboutBox");
      if (box) {
        const open = box.style.display !== "block";
        box.style.display = open ? "block" : "none";
        if (open && $("aboutVersion")) {
          $("aboutVersion").textContent = await getPluginVersion();
        }
      }
    });
  }

  const presetSel = $("connPreset");
  if (presetSel) {
    Object.keys(PROVIDER_PRESETS).forEach((k) => { const o = el("option", "", PROVIDER_PRESETS[k].label); o.value = k; presetSel.appendChild(o); });
  }

  const p = activeProfile();
  await loadKeyFor(p);
  renderProfileSelect();
  fillForm(p);
  refreshHeader();
  loadServicePrefs();
  loadEngineModePref();
  renderLog();

  // Event Listeners สลับโหมด
  if ($("modePyThaiNLP")) $("modePyThaiNLP").addEventListener("change", syncEngineModeUI);
  if ($("modeAI")) $("modeAI").addEventListener("change", syncEngineModeUI);

  if ($("btnConnSettings")) {
    $("btnConnSettings").addEventListener("click", () => {
      const panel = $("connPanel");
      const open = panel.style.display !== "block";
      panel.style.display = open ? "block" : "none";
      $("btnConnSettings").textContent = open ? "ซ่อนตั้งค่า" : "ตั้งค่า";
    });
  }

  if ($("profileSelect")) $("profileSelect").addEventListener("change", () => switchProfile($("profileSelect").value));
  if ($("btnConnSave")) $("btnConnSave").addEventListener("click", saveConn);
  if ($("btnConnTest")) $("btnConnTest").addEventListener("click", testConn);
  if ($("btnSelfTest")) $("btnSelfTest").addEventListener("click", selfTest);
  
  if ($("btnRefreshModels")) $("btnRefreshModels").addEventListener("click", refreshModels);
  if ($("serviceUrl")) $("serviceUrl").addEventListener("change", saveServicePrefs);
  if ($("btnServiceTest")) $("btnServiceTest").addEventListener("click", testService);
  if ($("btnClearLog")) $("btnClearLog").addEventListener("click", () => { Tele.log = []; renderLog(); });

  if ($("btnServiceHelp")) {
    $("btnServiceHelp").addEventListener("click", () => {
      const box = $("serviceHelp");
      if (box) box.style.display = box.style.display === "block" ? "none" : "block";
    });
  }

  await refreshModels();
}