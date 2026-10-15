"use strict";
/* ============================================================
 *  settings.js : UI ตั้งค่าการเชื่อมต่อ AI / ทดสอบ / บันทึกการทำงาน / บริการตรวจสะกด
 *  ใช้ $, el, lsGet/lsSet, buildUserMessage, parseModelJson จาก index.js (เรียกตอนใช้งาน)
 * ============================================================ */

const K_SERVICE = "ai_proofread_service";
let connDeleteArmed = false;

function setHealth(state, tip) {
  const d = $("healthDot");
  d.className = "dot " + (state || "");
  d.title = tip || "";
}
function showConnResult(msg, kind) {
  const r = $("connResult");
  r.textContent = msg;
  r.className = kind || "";
}
function num(id, def, min, max) {
  let v = parseFloat($(id).value);
  if (isNaN(v)) v = def;
  return Math.min(max, Math.max(min, v));
}

/* ---------- ฟอร์ม <-> โปรไฟล์ ---------- */
function updateConnHints(presetId) {
  const pr = PROVIDER_PRESETS[presetId] || PROVIDER_PRESETS.custom;
  $("connLmNativeRow").style.display = presetId === "lmstudio" ? "flex" : "none";
  $("connCloudRow").style.display = pr.cloud ? "block" : "none";
  $("connKeyLabel").textContent = pr.needsKey ? "API KEY (จำเป็น)" : "API KEY (ถ้ามี)";
}

function updateKeyNote(profile) {
  const has = !!keyCache[profile.id];
  $("connKey").value = "";
  $("connKey").setAttribute("placeholder", has ? "(บันทึกไว้แล้ว พิมพ์ใหม่เพื่อเปลี่ยน)" : "วาง API key ที่นี่");
  const mode = KeyStore.mode === "secure" ? "เก็บในที่เก็บความลับของ UXP"
    : KeyStore.mode === "plain" ? "เก็บแบบไม่เข้ารหัสในเครื่องนี้ (UXP ไม่มี secure storage)" : "";
  $("connKeyNote").textContent = has && mode ? mode : "";
}

function fillForm(p) {
  $("connPreset").value = p.preset;
  $("connName").value = p.name;
  $("connUrl").value = p.baseUrl;
  $("connModel").value = p.model || "";
  $("connTemp").value = p.temperature;
  $("connTimeout").value = p.timeoutSec;
  $("connRetries").value = p.retries;
  $("connParallel").value = p.parallel;
  $("connChunk").value = p.chunkLimit;
  $("connJson").value = p.jsonMode;
  $("connLmNative").checked = p.lmNative !== false;
  $("connCloudAck").checked = !!p.cloudAck;
  updateConnHints(p.preset);
  updateKeyNote(p);
}

function readForm(p) {
  p.preset = $("connPreset").value;
  p.name = $("connName").value.trim() || presetOf(p).label;
  p.baseUrl = $("connUrl").value.trim();
  p.model = $("connModel").value.trim();
  p.temperature = num("connTemp", 0, 0, 2);
  p.timeoutSec = num("connTimeout", 120, 10, 900);
  p.retries = num("connRetries", 2, 0, 5);
  p.parallel = Math.round(num("connParallel", 1, 1, 8));
  p.chunkLimit = Math.round(num("connChunk", 800, 300, 12000));
  p.jsonMode = $("connJson").value;
  p.lmNative = $("connLmNative").checked;
  p.cloudAck = $("connCloudAck").checked;
  return p;
}

// โปรไฟล์ชั่วคราวจากค่าในฟอร์ม (ใช้ทดสอบโดยยังไม่ต้องกดบันทึก)
function getTestProfile() {
  const p = activeProfile();
  const tmp = readForm(Object.assign({}, p));
  tmp.id = "tmp";
  keyCache["tmp"] = $("connKey").value.trim() || keyCache[p.id] || "";
  delete capsByProfile["tmp"];
  if (!tmp.baseUrl) { showConnResult("กรอก Base URL ก่อน", "err"); return null; }
  if (presetOf(tmp).needsKey && !keyCache["tmp"]) { showConnResult("ผู้ให้บริการนี้ต้องใช้ API key", "err"); return null; }
  return tmp;
}

function refreshHeader() {
  $("accModelTitle").textContent = "โมเดล AI · " + activeProfile().name;
}

function renderProfileSelect() {
  const sel = $("profileSelect");
  sel.innerHTML = "";
  ProfileStore.list.forEach((p) => { const o = el("option", "", p.name); o.value = p.id; sel.appendChild(o); });
  sel.value = ProfileStore.active;
}

/* ---------- รายชื่อโมเดล ---------- */
async function refreshModels() {
  const p = activeProfile();
  const sel = $("modelSelect");
  const add = (v, t) => { const o = el("option", "", t); o.value = v; sel.appendChild(o); };
  sel.innerHTML = "";
  if (presetOf(p).needsKey && !keyCache[p.id]) {
    add(p.model || "", p.model ? p.model + " (พิมพ์เอง)" : "ยังไม่ได้ใส่ API key (กด ตั้งค่า)");
    setHealth("", "ยังไม่ได้ใส่ API key");
    return;
  }
  add("", "กำลังโหลดรายชื่อโมเดล...");
  try {
    const r = await providerListModels(p);
    sel.innerHTML = "";
    if (!r.ids.length) {
      add(p.model || "", p.model ? p.model + " (พิมพ์เอง)" : "ไม่พบโมเดล (Load โมเดลใน LM Studio / Ollama ก่อน)");
    } else {
      if (!p.model || r.ids.indexOf(p.model) < 0) add("", "- เลือกโมเดล -");
      r.ids.forEach((id) => add(id, id));
      if (p.model && r.ids.indexOf(p.model) < 0) add(p.model, p.model + " (พิมพ์เอง)");
      if (p.model) sel.value = p.model;
      else if (!presetOf(p).cloud) { sel.value = r.ids[0]; p.model = r.ids[0]; saveProfiles(); $("connModel").value = p.model; }
    }
    setHealth("ok", `เชื่อมต่อได้ (${r.ms} ms, ${r.ids.length} โมเดล)`);
  } catch (e) {
    sel.innerHTML = "";
    add(p.model || "", p.model ? p.model + " (พิมพ์เอง)" : "เชื่อมต่อไม่ได้ (ดูปุ่ม ตั้งค่า > ทดสอบการเชื่อมต่อ)");
    if (p.model) sel.value = p.model;
    setHealth("bad", friendlyError(e, p));
  }
}

/* ---------- ปุ่มต่าง ๆ ---------- */
async function saveConn() {
  const p = activeProfile();
  readForm(p);
  const keyIn = $("connKey").value.trim();
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
    showConnResult(`เชื่อมต่อได้ · ${r.ms} ms · พบ ${r.ids.length} โมเดล` + (tmp.model ? "" : " (ยังไม่ได้เลือกโมเดล)"), "ok");
    Tele.add(`ทดสอบการเชื่อมต่อ ${tmp.name}: OK ${r.ms} ms`);
  } catch (e) {
    const msg = friendlyError(e, tmp);
    setHealth("bad", msg);
    showConnResult(msg, "err");
    Tele.add(`ทดสอบการเชื่อมต่อ ${tmp.name}: ล้มเหลว`);
  }
}

// ประโยคทดสอบที่ฝังคำผิดไว้ 3 จุด : ดูว่าโมเดลตอบ JSON ถูกรูปแบบและจับได้หรือไม่
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
  showConnResult("กำลังทดสอบโมเดล (ส่งประโยคตัวอย่าง 1 ครั้ง)...", "");
  const req = {
    system: $("systemPrompt").value.trim(),
    user: buildUserMessage(SELFTEST_TEXT, false),
    maxTokens: parseInt($("maxTokensInput").value, 10) || 1500
  };
  try {
    const r = await providerComplete(tmp, req);
    Tele.ok(r, "self-test");
    const items = parseModelJson(r.text);
    const speed = ` · ${(r.ms / 1000).toFixed(1)} วิ` + (r.tps ? ` · ${r.tps.toFixed(1)} tok/s` : "") + (r.outTok ? ` · out ${r.outTok} tok` : "");
    if (items === null) {
      Tele.parseBad++;
      setHealth("bad", "โมเดลตอบไม่เป็น JSON");
      showConnResult("โมเดลตอบแต่ไม่เป็น JSON ตามรูปแบบ (ลองเปลี่ยนโหมด JSON / เพิ่ม MAX TOKENS / ใช้โมเดลที่ฉลาดกว่า)" + speed, "err");
      return;
    }
    const hits = SELFTEST_EXPECT.map((x) => ({ label: x[0], ok: items.some((it) => it && typeof it.original === "string" && x[1](it.original)) }));
    const got = hits.filter((h) => h.ok).length;
    const extra = Math.max(0, items.length - got);
    setHealth("ok", `ทดสอบโมเดลผ่าน (${got}/${hits.length})`);
    showConnResult(`จับได้ ${got}/${hits.length}: ` + hits.map((h) => h.label + (h.ok ? " (ได้)" : " (ไม่ได้)")).join(", ") +
      (extra ? ` · รายงานเกิน ${extra} จุด` : "") + speed, got === hits.length ? "ok" : "err");
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

/* ---------- บริการตรวจสะกด (PyThaiNLP) ---------- */
// ช่อง URL และปุ่มทดสอบใช้ได้เมื่อติ๊กใช้บริการเท่านั้น (ไม่ติ๊ก = สีจาง กดแก้ไม่ได้)
function syncServiceUI() {
  const on = $("chkService").checked;
  setDisabled($("serviceUrl"), !on);
  setDisabled($("btnServiceTest"), !on);
  $("serviceUrl").style.opacity = on ? "1" : "0.45";
  $("btnServiceTest").style.opacity = on ? "1" : "0.45";
  if (!on) { $("serviceResult").textContent = ""; $("serviceResult").className = ""; }
}
// โหมด AI ใช้ได้เมื่อติ๊ก "ตรวจด้วย AI" เท่านั้น
function syncAiModeUI() {
  const on = $("chkAI").checked;
  setDisabled($("aiMode"), !on);
  $("aiMode").style.opacity = on ? "1" : "0.45";
}

function loadServicePrefs() {
  const s = lsGet(K_SERVICE, { on: false, url: "http://127.0.0.1:8765" });
  $("chkService").checked = !!s.on;
  $("serviceUrl").value = s.url || "http://127.0.0.1:8765";
  syncServiceUI();
  syncAiModeUI();
}
function saveServicePrefs() {
  lsSet(K_SERVICE, { on: $("chkService").checked, url: $("serviceUrl").value.trim() });
}
async function testService() {
  const url = $("serviceUrl").value.trim();
  const out = $("serviceResult");
  out.className = "";
  out.textContent = "กำลังเชื่อมต่อ...";
  try {
    const t0 = Date.now();
    const h = await serviceHealth(url);
    out.className = "ok";
    out.textContent = `พร้อมใช้งาน · ${Date.now() - t0} ms` + (h && h.pythainlp ? ` · PyThaiNLP ${h.pythainlp}` : "") +
      (h && h.english === false ? " · ไม่มีตัวตรวจอังกฤษ (ไม่ได้ติดตั้ง pyspellchecker)" : "");
    Tele.add("ทดสอบบริการตรวจสะกด: OK");
  } catch (e) {
    out.className = "err";
    out.textContent = e && e.network ? "เชื่อมต่อไม่ได้ (รัน spellcheck_server.py หรือยัง?)" : friendlyError(e, { name: "บริการตรวจสะกด", baseUrl: url });
  }
}

/* ---------- log ---------- */
function renderLog() {
  const box = $("logBox");
  box.value = Tele.log.join("\n");
}

/* ---------- init ---------- */
async function initSettings() {
  Tele.onChange = renderLog;
  loadProfiles();

  const presetSel = $("connPreset");
  Object.keys(PROVIDER_PRESETS).forEach((k) => { const o = el("option", "", PROVIDER_PRESETS[k].label); o.value = k; presetSel.appendChild(o); });

  const p = activeProfile();
  await loadKeyFor(p);
  renderProfileSelect();
  fillForm(p);
  refreshHeader();
  loadServicePrefs();
  renderLog();

  $("btnConnSettings").addEventListener("click", () => {
    const panel = $("connPanel");
    const open = panel.style.display !== "block";
    panel.style.display = open ? "block" : "none";
    $("btnConnSettings").textContent = open ? "ซ่อนตั้งค่า" : "ตั้งค่า";
  });

  $("profileSelect").addEventListener("change", () => switchProfile($("profileSelect").value));

  presetSel.addEventListener("change", () => { // เปลี่ยนผู้ให้บริการ -> เติมค่าเริ่มต้นของเจ้านั้นลงฟอร์ม (ยังไม่บันทึกจนกว่าจะกด)
    const id = presetSel.value;
    const pr = PROVIDER_PRESETS[id];
    $("connName").value = pr.label;
    $("connUrl").value = pr.baseUrl;
    $("connModel").value = "";
    $("connTimeout").value = pr.timeoutSec;
    $("connParallel").value = pr.parallel;
    $("connChunk").value = pr.chunkLimit;
    $("connJson").value = pr.jsonMode;
    updateConnHints(id);
  });

  $("btnConnSave").addEventListener("click", saveConn);
  $("btnConnTest").addEventListener("click", testConn);
  $("btnSelfTest").addEventListener("click", selfTest);
  $("btnConnClearKey").addEventListener("click", async () => {
    const cur = activeProfile();
    await KeyStore.remove(cur.id);
    keyCache[cur.id] = "";
    updateKeyNote(cur);
    showConnResult("ลบ API key แล้ว", "ok");
    refreshModels();
  });
  $("btnConnNew").addEventListener("click", async () => {
    const np = makeProfile($("connPreset").value);
    np.name = np.name + " " + (ProfileStore.list.length + 1);
    ProfileStore.list.push(np);
    ProfileStore.active = np.id;
    saveProfiles();
    keyCache[np.id] = "";
    renderProfileSelect();
    fillForm(np);
    refreshHeader();
    showConnResult("สร้างโปรไฟล์ใหม่แล้ว ใส่ค่าแล้วกดบันทึก", "ok");
    await refreshModels();
  });
  $("btnConnDelete").addEventListener("click", async () => {
    if (ProfileStore.list.length <= 1) { showConnResult("ลบโปรไฟล์สุดท้ายไม่ได้", "err"); return; }
    if (!connDeleteArmed) {
      connDeleteArmed = true;
      $("btnConnDelete").textContent = "กดอีกครั้งเพื่อลบ";
      setTimeout(() => { connDeleteArmed = false; $("btnConnDelete").textContent = "ลบโปรไฟล์"; }, 3000);
      return;
    }
    connDeleteArmed = false;
    $("btnConnDelete").textContent = "ลบโปรไฟล์";
    const cur = activeProfile();
    await KeyStore.remove(cur.id);
    ProfileStore.list = ProfileStore.list.filter((x) => x.id !== cur.id);
    ProfileStore.active = ProfileStore.list[0].id;
    saveProfiles();
    renderProfileSelect();
    await switchProfile(ProfileStore.active);
    showConnResult("ลบโปรไฟล์แล้ว", "ok");
  });

  $("modelSelect").addEventListener("change", () => {
    const cur = activeProfile();
    cur.model = $("modelSelect").value;
    $("connModel").value = cur.model;
    saveProfiles();
  });
  $("btnRefreshModels").addEventListener("click", refreshModels);

  $("chkService").addEventListener("change", () => { saveServicePrefs(); syncServiceUI(); });
  $("chkAI").addEventListener("change", syncAiModeUI);
  $("btnServiceHelp").addEventListener("click", () => {
    const box = $("serviceHelp");
    box.style.display = box.style.display === "block" ? "none" : "block";
  });
  $("serviceUrl").addEventListener("change", saveServicePrefs);
  $("btnServiceTest").addEventListener("click", testService);
  $("btnClearLog").addEventListener("click", () => { Tele.log = []; renderLog(); });

  await refreshModels();
}
