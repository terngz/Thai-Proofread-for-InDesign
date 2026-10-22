"use strict";

const K_SERVICE = "ai_proofread_service";
const K_ENGINE_MODE = "ai_proofread_engine_mode";
let connDeleteArmed = false;
let modelMeta = {};

async function getPluginVersion() {
  try {
    const { localFileSystem } = require("uxp").storage;
    const pluginFolder = await localFileSystem.getPluginFolder();
    const manifestFile = await pluginFolder.getEntry("manifest.json");
    const content = await manifestFile.read();
    const json = JSON.parse(content);
    if (json && json.version) return json.version;
  } catch (e) {
    console.warn("Error reading manifest.json version:", e);
  }
  return "";
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

function getSelectedEngineMode() {
  if ($("modePyThaiNLP") && $("modePyThaiNLP").checked) return "pythainlp";
  return "ai";
}

function syncEngineModeUI() {
  const mode = getSelectedEngineMode();
  if ($("engineDesc")) $("engineDesc").textContent = tr(mode === "ai" ? "eng.ai" : "eng.pythainlp");
  const pyBox = $("pythainlpConfigBox");
  const aiBox = $("aiConfigBox");

  const boxPy = $("boxPyThaiNLP");
  const boxAI = $("boxAI");

  if (boxPy) boxPy.classList.toggle("active", mode === "pythainlp");
  if (boxAI) boxAI.classList.toggle("active", mode === "ai");

  if (pyBox) pyBox.style.display = mode === "pythainlp" ? "block" : "none";
  if (aiBox) aiBox.style.display = mode === "ai" ? "block" : "none";

  lsSet(K_ENGINE_MODE, mode);
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

function updateConnHints(presetId) {
  const pr = PROVIDER_PRESETS[presetId] || PROVIDER_PRESETS.custom;
  if ($("connLmNativeRow")) $("connLmNativeRow").style.display = presetId === "lmstudio" ? "flex" : "none";
  if ($("connCloudRow")) $("connCloudRow").style.display = pr.cloud ? "block" : "none";
  if ($("connKeyLabel")) $("connKeyLabel").textContent = pr.needsKey ? tr("key.required") : tr("key.optional");
  if ($("connThinkNote")) $("connThinkNote").textContent = thinkNote(presetId);
  if ($("connThinkBudgetBox")) $("connThinkBudgetBox").style.display = presetId === "anthropic" ? "block" : "none";
}

function updateKeyNote(profile, keepValue) {
  const has = !!keyCache[profile.id];
  if ($("connKey")) {
    if (!keepValue) $("connKey").value = "";
    $("connKey").setAttribute("placeholder", has ? tr("key.phSaved") : tr("conn.keyPh"));
  }
  const mode = KeyStore.mode === "secure" ? tr("key.secure")
    : KeyStore.mode === "plain" ? tr("key.plain") : "";
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
  p.jsonMode = "structured";
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
  if (!tmp.baseUrl) { showConnResult(tr("val.noUrl"), "err"); return null; }
  if (presetOf(tmp).needsKey && !keyCache["tmp"]) { showConnResult(tr("val.needKey"), "err"); return null; }
  return tmp;
}

function refreshHeader() {
  if ($("accModelTitle")) $("accModelTitle").textContent = tr("mdl.title", { name: activeProfile().name });
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
  if (m.ctx) parts.push("context " + m.ctx + (m.maxCtx && m.maxCtx !== m.ctx ? tr("info.max", { max: m.maxCtx }) : ""));
  if (m.quant) parts.push(m.quant);
  if (m.loaded === true) parts.push(tr("info.loaded"));
  if (m.reasoning === true) parts.push(tr("info.reasoning"));
  if (m.reasoning === false) parts.push(tr("info.noReasoning"));
  box.textContent = parts.join(" · ");
}

async function refreshModels() {
  const p = activeProfile();
  const sel = $("modelSelect");
  if (!sel) return;
  const add = (v, t) => { const o = el("option", "", t); o.value = v; sel.appendChild(o); };
  sel.innerHTML = "";
  if (presetOf(p).needsKey && !keyCache[p.id]) {
    add(p.model || "", p.model ? p.model + " " + tr("list.custom") : tr("list.needKey"));
    setHealth("", tr("health.noKey"));
    modelMeta = {};
    updateModelInfo();
    return;
  }
  add("", tr("list.loading"));
  try {
    const r = await providerListModels(p);
    modelMeta = r.meta || {};
    sel.innerHTML = "";
    if (!r.ids.length) {
      add(p.model || "", p.model ? p.model + " " + tr("list.custom") : tr("list.none"));
    } else {
      if (!p.model || r.ids.indexOf(p.model) < 0) add("", tr("list.pick"));
      r.ids.forEach((id) => add(id, id));
      if (p.model && r.ids.indexOf(p.model) < 0) add(p.model, p.model + " " + tr("list.custom"));
      if (p.model) sel.value = p.model;
      else if (!presetOf(p).cloud) { sel.value = r.ids[0]; p.model = r.ids[0]; saveProfiles(); if ($("connModel")) $("connModel").value = p.model; }
    }
    setHealth("ok", tr("health.ok", { ms: r.ms, n: r.ids.length }));
    updateModelInfo();
  } catch (e) {
    modelMeta = {};
    updateModelInfo();
    sel.innerHTML = "";
    add(p.model || "", p.model ? p.model + " " + tr("list.custom") : tr("list.fail"));
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
  showConnResult(tr("conn.saved"), "ok");
  await refreshModels();
}

async function testConn() {
  const tmp = getTestProfile();
  if (!tmp) return;
  showConnResult(tr("conn.testing"), "");
  try {
    const r = await providerListModels(tmp);
    setHealth("ok", tr("health.okMs", { ms: r.ms }));
    showConnResult(tr("conn.okFull", { ms: r.ms, n: r.ids.length }), "ok");
    Tele.add(tr("tele.connOk", { name: tmp.name, ms: r.ms }));
  } catch (e) {
    const msg = friendlyError(e, tmp);
    setHealth("bad", msg);
    showConnResult(msg, "err");
    Tele.add(tr("tele.connFail", { name: tmp.name }));
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
  if (!tmp.model && presetOf(tmp).cloud) { showConnResult(tr("st.pickModel"), "err"); return; }
  showConnResult(tr("st.running"), "");
  const req = {
    system: $("systemPrompt") ? $("systemPrompt").value.trim() : "",
    user: buildUserMessage(SELFTEST_TEXT, false),
    maxTokens: parseInt(tmp.maxTokens, 10) || 1500
  };
  try {
    const r = await providerComplete(tmp, req);
    Tele.ok(r, "self-test");
    const items = parseModelJson(r.text);
    const speed = tr("st.sec", { s: (r.ms / 1000).toFixed(1) }) + (r.tps ? ` · ${r.tps.toFixed(1)} tok/s` : "");
    if (items === null) {
      Tele.parseBad++;
      setHealth("bad", tr("st.notJson"));
      showConnResult(tr("st.notJsonLong") + speed, "err");
      return;
    }
    const hits = SELFTEST_EXPECT.map((x) => ({ label: x[0], ok: items.some((it) => it && typeof it.original === "string" && x[1](it.original)) }));
    const got = hits.filter((h) => h.ok).length;
    setHealth("ok", tr("st.pass", { got, n: hits.length }));
    showConnResult(tr("st.caught", { got, n: hits.length }) + hits.map((h) => h.label + (h.ok ? tr("st.yes") : tr("st.no"))) .join(", ") + speed, got === hits.length ? "ok" : "err");
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
  out.textContent = tr("svc.connecting");
  try {
    const t0 = Date.now();
    const h = await serviceHealth(url);
    out.className = "ok";
    out.textContent = tr("svc.ready", { ms: Date.now() - t0 }) + (h && h.pythainlp ? ` · PyThaiNLP ${h.pythainlp}` : "");
    Tele.add(tr("tele.svcOk"));
  } catch (e) {
    out.className = "err";
    out.textContent = e && e.network ? tr("svc.cannot") : friendlyError(e, { name: tr("svc.name"), baseUrl: url });
  }
}

function renderLog() {
  if ($("logBox")) $("logBox").value = Tele.log.join("\n");
}

function applyModelChoice() {
  const sel = $("modelSelect");
  if (!sel || !sel.value) return;
  const p = activeProfile();
  p.model = sel.value;
  if ($("connModel")) $("connModel").value = p.model;
  saveProfiles();
  updateModelInfo();
}

function onPresetChange() {
  const id = $("connPreset").value;
  const pr = PROVIDER_PRESETS[id] || PROVIDER_PRESETS.custom;
  const name = $("connName").value.trim();
  const isDefaultName = !name || isNewProfileName(name) || name === I18N.th["prov.custom"] || name === I18N.en["prov.custom"] ||
    Object.keys(PROVIDER_PRESETS).some((k) => PROVIDER_PRESETS[k].label === name);
  if (isDefaultName) $("connName").value = pr.label;
  $("connUrl").value = pr.baseUrl;
  $("connTimeout").value = pr.timeoutSec;
  $("connParallel").value = pr.parallel;
  $("connChunk").value = pr.chunkLimit;
  updateConnHints(id);
}

const isNewProfileName = (n) => n === I18N.th["prof.newName"] || n === I18N.en["prof.newName"];

async function newProfile() {
  const p = makeProfile("custom", tr("prof.newName"));
  ProfileStore.list.push(p);
  ProfileStore.active = p.id;
  saveProfiles();
  renderProfileSelect();
  await switchProfile(p.id);
  showConnResult(tr("prof.pickProvider"), "");
}

async function deleteProfile() {
  const btn = $("btnConnDelete");
  if (ProfileStore.list.length <= 1) return showConnResult(tr("prof.min"), "err");
  if (!connDeleteArmed) {
    connDeleteArmed = true;
    btn.textContent = tr("conn.confirmDelete");
    setTimeout(() => { connDeleteArmed = false; btn.textContent = tr("conn.delete"); }, 3000);
    return;
  }
  connDeleteArmed = false;
  btn.textContent = tr("conn.delete");
  const p = activeProfile();
  await KeyStore.remove(p.id);
  delete keyCache[p.id];
  delete capsByProfile[p.id];
  ProfileStore.list = ProfileStore.list.filter((x) => x.id !== p.id);
  ProfileStore.active = ProfileStore.list[0].id;
  saveProfiles();
  renderProfileSelect();
  await switchProfile(ProfileStore.active);
}

async function clearKey() {
  const p = activeProfile();
  await KeyStore.remove(p.id);
  delete keyCache[p.id];
  updateKeyNote(p);
  showConnResult(tr("key.removed"), "ok");
  await refreshModels();
}

function refreshLangUI() {
  const ps = $("connPreset");
  if (ps) {
    const cur = ps.value;
    ps.innerHTML = "";
    Object.keys(PROVIDER_PRESETS).forEach((k) => {
      const o = el("option", "", PROVIDER_PRESETS[k].label);
      o.value = k;
      ps.appendChild(o);
    });
    ps.value = cur;
    updateConnHints(cur);
  }
  syncEngineModeUI();
  refreshHeader();
  updateModelInfo();
  updateKeyNote(activeProfile(), true);
  const panel = $("connPanel");
  if ($("btnConnSettings")) $("btnConnSettings").textContent = panel && panel.style.display === "block" ? tr("mdl.hide") : tr("mdl.settings");
  connDeleteArmed = false;
  refreshModels();
}

async function initSettings() {
  Tele.onChange = renderLog;
  loadProfiles();

  if ($("aboutVersion")) {
    getPluginVersion().then((v) => {
      if (!v) return;
      appVersion = v;
      $("aboutVersion").textContent = v;
      const link = $("btnOpenChangelog");
      if (link) {
        link.textContent = tr("about.new");
        link.style.display = "";
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

  if ($("boxPyThaiNLP")) {
    $("boxPyThaiNLP").addEventListener("click", () => {
      if ($("modePyThaiNLP")) $("modePyThaiNLP").checked = true;
      syncEngineModeUI();
    });
  }
  if ($("boxAI")) {
    $("boxAI").addEventListener("click", () => {
      if ($("modeAI")) $("modeAI").checked = true;
      syncEngineModeUI();
    });
  }

  if ($("btnConnSettings")) {
    $("btnConnSettings").addEventListener("click", () => {
      const panel = $("connPanel");
      const open = panel.style.display !== "block";
      panel.style.display = open ? "block" : "none";
      $("btnConnSettings").textContent = open ? tr("mdl.hide") : tr("mdl.settings");
    });
  }

  if ($("profileSelect")) $("profileSelect").addEventListener("change", () => switchProfile($("profileSelect").value));
  if ($("modelSelect")) $("modelSelect").addEventListener("change", applyModelChoice);
  if ($("connPreset")) $("connPreset").addEventListener("change", onPresetChange);
  if ($("btnConnNew")) $("btnConnNew").addEventListener("click", newProfile);
  if ($("btnConnDelete")) $("btnConnDelete").addEventListener("click", deleteProfile);
  if ($("btnConnClearKey")) $("btnConnClearKey").addEventListener("click", clearKey);
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