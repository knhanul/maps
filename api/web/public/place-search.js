/* 장소 검색. GPX는 전송하지 않고, 검색어(와 선택 시 화면 범위)만 /places/search 로 보낸다. */
(() => {
"use strict";
const RECENT = "gildam.recentPlaces.v1", KEY = "gildam.kakaoRestKey.v1";
const $ = (s) => document.querySelector(s);
const q = $("#placeQ"), menu = $("#placeMenu"), form = $("#placeForm");
if (!q || !menu || !form) return;
let timer = 0, seq = 0, pin = null, items = [];

const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT) || "[]"); return Array.isArray(v) ? v.slice(0, 5) : []; } catch { return []; } };
const remember = (place) => { const next = [place, ...readRecent().filter((p) => p.id !== place.id)].slice(0, 5); try { localStorage.setItem(RECENT, JSON.stringify(next)); } catch {} return next; };
const key = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };

function setOpen(on) {
  menu.hidden = !on;
  q.setAttribute("aria-expanded", String(on));
}
function rectOfView() {
  const b = window.__map?.getBounds();
  if (!b) return "";
  return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(6)).join(",");
}
function row(place, recent) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "place-hit"; b.setAttribute("role", "option");
  const name = document.createElement("b"); name.textContent = place.name;
  const meta = document.createElement("span");
  meta.textContent = [place.category, place.address].filter(Boolean).join(" · ");
  b.append(name, meta);
  b.onmousedown = (e) => e.preventDefault();
  b.onclick = () => choose(place, recent);
  return b;
}
function showRecent() {
  const recent = readRecent();
  menu.replaceChildren();
  if (!recent.length) return setOpen(false);
  const label = document.createElement("div"); label.className = "menu-label"; label.textContent = "최근 검색";
  menu.append(label, ...recent.map((p) => row(p, true)));
  setOpen(true);
}
function note(text) {
  const p = document.createElement("p"); p.textContent = text; menu.replaceChildren(p); setOpen(true);
}
async function run() {
  const query = q.value.trim();
  $("#placeClear").hidden = !query;
  if (!query) { items = []; return showRecent(); }
  const id = ++seq;
  note("찾는 중…");
  const url = new URL("/places/search", location.origin);
  url.searchParams.set("query", query);
  if ($("#placeInView").checked) url.searchParams.set("rect", rectOfView());
  const headers = {};
  if (key()) headers["x-kakao-key"] = key();
  let data;
  try {
    const r = await fetch(url, { headers });
    data = await r.json();
    if (!r.ok && !data.error) data = { items: [], error: "검색에 실패했습니다." };
  } catch { if (id === seq) note("검색에 실패했습니다."); return; }
  if (id !== seq) return;
  items = data.items || [];
  menu.replaceChildren();
  if (data.error) note(data.error);
  else if (!items.length) note("결과가 없습니다.");
  else { items.forEach((p) => menu.append(row(p, false))); setOpen(true); }
}
function focusPlace(place) {
  const map = window.__map;
  if (!map) return;
  const wide = innerWidth > 720;
  map.flyTo({ center: [place.lon, place.lat], zoom: 15.5, duration: 900, essential: true, padding: wide ? { left: 390, top: 90, right: 40, bottom: 40 } : { top: 130, bottom: 280, left: 16, right: 16 } });
  pin?.remove();
  const wrap = document.createElement("div"); wrap.className = "place-pin";
  wrap.addEventListener("pointerdown", (e) => e.stopPropagation());
  const card = document.createElement("div");
  const title = document.createElement("b"); title.textContent = place.name;
  const meta = document.createElement("small"); meta.textContent = [place.category, place.address].filter(Boolean).join(" · ");
  const add = document.createElement("button"); add.type = "button"; add.className = "add"; add.textContent = "코스에 지점 추가";
  add.onclick = (e) => { e.preventDefault(); e.stopPropagation(); window.__courseBridge?.addPlacePoint(place.lon, place.lat, place.name); pin?.remove(); pin = null; };
  const close = document.createElement("button"); close.type = "button"; close.className = "close"; close.textContent = "닫기 · 주변만 보기";
  close.onclick = (e) => { e.preventDefault(); e.stopPropagation(); pin?.remove(); pin = null; };
  const dot = document.createElement("i");
  card.append(title, meta, add, close); wrap.append(dot, card);
  pin = new maplibregl.Marker({ element: wrap, anchor: "top" }).setLngLat([place.lon, place.lat]).addTo(map);
}
function choose(place) {
  remember(place); setOpen(false); $("#placeKeyBox").hidden = true; q.blur(); focusPlace(place);
}
form.onsubmit = (e) => { e.preventDefault(); clearTimeout(timer); run(); };
q.addEventListener("input", () => { $("#placeClear").hidden = !q.value; setOpen(true); clearTimeout(timer); timer = setTimeout(run, 300); });
q.addEventListener("focus", () => { if (!q.value.trim()) showRecent(); else if (items.length || !menu.hidden) setOpen(true); });
q.addEventListener("keydown", (e) => { if (e.key === "Escape") { setOpen(false); $("#placeKeyBox").hidden = true; q.blur(); } });
$("#placeClear").onclick = () => { q.value = ""; items = []; $("#placeClear").hidden = true; q.focus(); showRecent(); };
$("#placeInView").onchange = () => { $("#placeInView").parentElement.classList.toggle("on", $("#placeInView").checked); if (q.value.trim()) run(); };
$("#placeKey").onclick = () => {
  const box = $("#placeKeyBox");
  box.hidden = !box.hidden;
  $("#placeKey").classList.toggle("on", !box.hidden || !!key());
  $("#placeKeyInput").value = key();
  if (!box.hidden) setOpen(false);
};
$("#placeKey").classList.toggle("on", !!key());
$("#placeKeySave").onclick = () => {
  const next = $("#placeKeyInput").value.trim();
  try { if (next) localStorage.setItem(KEY, next); else localStorage.removeItem(KEY); } catch {}
  $("#placeKeyBox").hidden = true; $("#placeKey").classList.toggle("on", !!next);
  if (q.value.trim()) run();
};
$("#placeKeyClear").onclick = () => {
  try { localStorage.removeItem(KEY); } catch {}
  $("#placeKeyInput").value = ""; $("#placeKeyBox").hidden = true; $("#placeKey").classList.remove("on");
  if (q.value.trim()) run();
};
window.addEventListener("keydown", (e) => {
  const t = e.target;
  const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  if (e.key === "Escape" && !menu.hidden) { setOpen(false); $("#placeKeyBox").hidden = true; e.preventDefault(); e.stopPropagation(); return; }
  const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
  const chord = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
  if ((slash || chord) && !typing) { e.preventDefault(); e.stopPropagation(); q.focus(); q.select(); setOpen(true); if (!q.value.trim()) showRecent(); }
}, true);
document.addEventListener("pointerdown", (e) => { if (!$("#placeSearch").contains(e.target)) setOpen(false); });
})();
