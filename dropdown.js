const DD_MUTE_MS = 80;
const DD_HOLD_MS = 150;
const DD_DEBUG = false;

const DD = {};

function ddLog() {
  if (DD_DEBUG) console.log.apply(console, ["[dd]"].concat(Array.from(arguments)));
}

function ddTr(key) {
  return typeof tr === "function" ? tr(key) : key;
}

function ddState(id) {
  if (!DD[id]) DD[id] = { items: [], sel: "", handlers: [], muteUntil: 0, holdUntil: 0 };
  return DD[id];
}

function ddIndexOf(st, v) {
  if (v === undefined || v === null) return -1;
  for (let k = 0; k < st.items.length; k++) {
    if (st.items[k].value === String(v)) return k;
  }
  return -1;
}

function ddRead(id) {
  const st = ddState(id);
  if (Date.now() < st.holdUntil) return st.sel;
  const live = document.getElementById(id);
  const i = live ? live.selectedIndex : -1;
  if (typeof i === "number" && i >= 0 && i < st.items.length) return st.items[i].value;
  return st.sel;
}

function ddDecorate(el, id) {
  const st = ddState(id);

  Object.defineProperty(el, "value", {
    configurable: true,
    get() { return ddRead(id); },
    set(v) {
      ddLog("set value", id, v);
      if (ddIndexOf(st, v) < 0) return;
      ddRender(id, v);
    }
  });

  const orig = el.addEventListener.bind(el);
  const attach = (type, handler, opts) => {
    if (type !== "change") return orig(type, handler, opts);
    return orig(type, (e) => {
      if (Date.now() < st.muteUntil) return;
      handler.call(el, e);
    }, opts);
  };

  orig("change", () => {
    const i = el.selectedIndex;
    ddLog("change", id, i);
    if (typeof i === "number" && i >= 0 && i < st.items.length) {
      st.sel = st.items[i].value;
      st.holdUntil = 0;
    }
  });

  el.addEventListener = (type, handler, opts) => {
    st.handlers.push([type, handler, opts]);
    return attach(type, handler, opts);
  };

  st.handlers.forEach(([type, handler, opts]) => attach(type, handler, opts));
}

function ddRender(id, v) {
  const st = ddState(id);
  const old = document.getElementById(id);
  if (!old || !old.parentNode) return null;

  let idx = ddIndexOf(st, v);
  if (idx < 0) idx = st.items.length ? 0 : -1;
  st.sel = idx >= 0 ? st.items[idx].value : "";
  st.muteUntil = Date.now() + DD_MUTE_MS;
  st.holdUntil = Date.now() + DD_HOLD_MS;
  ddLog("render", id, v, "->", idx);

  const fresh = old.cloneNode(false);
  const menu = document.createElement("sp-menu");
  menu.setAttribute("slot", "options");
  st.items.forEach((it, k) => {
    const mi = document.createElement("sp-menu-item");
    mi.setAttribute("value", it.value);
    mi.textContent = it.key ? ddTr(it.key) : it.label;
    if (k === idx) mi.setAttribute("selected", "");
    menu.appendChild(mi);
  });
  fresh.appendChild(menu);
  ddDecorate(fresh, id);
  old.parentNode.replaceChild(fresh, old);
  try { if (idx >= 0) fresh.selectedIndex = idx; } catch (e) { /* ignore */ }
  return fresh;
}

function ddFill(dd, list, v) {
  const id = typeof dd === "string" ? dd : dd && dd.id;
  if (!id) return;
  const st = ddState(id);
  st.items = list.map((x) => ({
    value: String(x.value),
    label: x.label == null ? "" : String(x.label),
    key: x.key || ""
  }));
  ddRender(id, v);
}

function ddRelabelAll() {
  Object.keys(DD).forEach((id) => {
    const st = DD[id];
    if (!st.items.some((it) => it.key)) return;
    ddRender(id, ddRead(id));
  });
}

(function ddInitAll() {
  const nodes = Array.from(document.getElementsByTagName("sp-dropdown"));
  nodes.forEach((dd) => {
    if (!dd.id) return;
    const st = ddState(dd.id);
    let initial;
    const menu = dd.querySelector("sp-menu");
    st.items = [];
    if (menu) {
      Array.from(menu.children).forEach((mi) => {
        if (String(mi.tagName).toLowerCase() !== "sp-menu-item") return;
        const value = mi.getAttribute("value") || "";
        st.items.push({ value, label: (mi.textContent || "").trim(), key: mi.getAttribute("data-i18n") || "" });
        if (mi.hasAttribute("selected")) initial = value;
      });
    }
    ddRender(dd.id, initial);
  });
})();
