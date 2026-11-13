/* 길담 스튜디오 웹 — GPX 파일은 브라우저 안에서만 처리. 길 따라 잇기를 쓸 때만 지점 좌표를 자체 경로 서버로 보냄. */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const COLORS = ["#e4572e", "#2e86de", "#17a673", "#a55eea", "#f39c12", "#e84393", "#00a8a8", "#6d4c41"];
const SPEED = { walk: 4, hike: 3, bike: 15 };
const LS_T = "gildam.tracks.v1", LS_C = "gildam.courses.v1", LS_D = "gildam.draft.v1";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2200); };

/* ---------- geo ---------- */
const R = 6371008.8, rad = d => d * Math.PI / 180;
function hav(a, b) { const dLa = rad(b[1] - a[1]), dLo = rad(b[0] - a[0]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
const fmtKm = m => m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
function fmtDur(s) { if (!isFinite(s) || s <= 0) return "–"; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}시간 ${m}분` : `${m}분`; }

/* GPX 파싱: trkpt / rtept / wpt 순으로 [lon,lat,ele|null,timeMs|null] */
function parseGpx(text, fname) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("GPX 형식이 아니에요");
  let groups = [...doc.getElementsByTagNameNS('*','trkseg')].map(n=>[...n.childNodes].filter(p=>p.nodeType===1&&p.localName==='trkpt'&&p.namespaceURI===n.namespaceURI));
  if(!groups.some(g=>g.length))groups=[...doc.getElementsByTagNameNS('*','rte')].map(n=>[...n.childNodes].filter(p=>p.nodeType===1&&p.localName==='rtept'&&p.namespaceURI===n.namespaceURI));
  const P=[],breaks=[];
  for(const group of groups){const part=group.map(p=>{
    const e=p.getElementsByTagNameNS('*','ele')[0],t=p.getElementsByTagNameNS('*','time')[0];
    const ele=e?parseFloat(e.textContent):NaN,tm=t?Date.parse(t.textContent):NaN;
    return [+p.getAttribute('lon'),+p.getAttribute('lat'),isFinite(ele)?ele:null,isFinite(tm)?tm:null];
  }).filter(p=>isFinite(p[0])&&isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90);
  if(part.length){if(P.length)breaks.push(P.length);P.push(...part);}}
  if(!P.length)throw new Error('경로 점이 없어요');
  const nmEl = doc.getElementsByTagNameNS("*", "name")[0];
  return { name: (nmEl && nmEl.textContent.trim()) || fname.replace(/\.gpx$/i, ""), pts: P, breaks };
}
function splitParts(P,breaks=[]){const offsets=[0,...breaks.filter(i=>Number.isInteger(i)&&i>0&&i<P.length)].sort((a,b)=>a-b);return offsets.map((i,k)=>P.slice(i,offsets[k+1]??P.length));}
function trackGeometry(t){return {type:"MultiLineString",coordinates:splitParts(t.pts,t.breaks).filter(p=>p.length>1).map(p=>p.map(c=>c.slice(0,2)))};}
function stats(P, breaks=[]) {
  const boundary=new Set(breaks);
  let dist = 0, moving = 0, gain = 0, loss = 0; const cum = [0];
  for (let i = 1; i < P.length; i++) {
    const d = boundary.has(i)?0:hav(P[i - 1], P[i]); dist += d; cum.push(dist);
    if(boundary.has(i))continue;
    const a = P[i - 1][3], b = P[i][3];
    if (a != null && b != null && b > a) { const dt = (b - a) / 1000; if (d / dt > 0.5 && dt < 600) moving += dt; }
  }
  // 고도 상승: 3m 임계값으로 잡음 제거
  const E = P.map(p => p[2]).filter(v => v != null); let hasEle = E.length > P.length * 0.5;
  if (hasEle) { for(const part of splitParts(P,breaks)){const values=part.map(p=>p[2]).filter(e=>e!=null);let ref = values[0]; for (const e of values) { if (e - ref >= 3) { gain += e - ref; ref = e; } else if (ref - e >= 3) { loss += ref - e; ref = e; } } } }
  const t0 = P.find(p => p[3] != null), t1 = [...P].reverse().find(p => p[3] != null);
  const total = t0 && t1 ? (t1[3] - t0[3]) / 1000 : 0;
  return { dist, total, moving, avg: moving ? dist / moving * 3.6 : 0, gain: hasEle ? gain : null, loss, hasEle, hasTime: total > 0, cum, start: t0 ? t0[3] : null };
}
function toGpx(name, P, { strip = true, kind = "trk", breaks=[] } = {}) {
  const pt = p => {
    let s = `<${kind === "trk" ? "trkpt" : "rtept"} lat="${p[1].toFixed(7)}" lon="${p[0].toFixed(7)}">`;
    if (p[2] != null) s += `<ele>${p[2].toFixed(1)}</ele>`;
    if (!strip && p[3] != null) s += `<time>${new Date(p[3]).toISOString()}</time>`;
    return s + `</${kind === "trk" ? "trkpt" : "rtept"}>`;
  };
  const body = kind === "trk" ? `<trk><name>${esc(name)}</name>${splitParts(P,breaks).map(part=>`<trkseg>\n${part.map(pt).join("\n")}\n</trkseg>`).join("\n")}</trk>` : `<rte><name>${esc(name)}</name>\n${P.map(pt).join("\n")}\n</rte>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="길담 maps.nuni.co.kr" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(name)}</name></metadata>\n${body}\n</gpx>\n`;
}
function download(name, text) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" }));
  a.download = name.replace(/[\\/:*?"<>|]+/g, "_") + ".gpx"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("브라우저 저장 공간이 부족해요"); return false; } } };

/* ---------- map ---------- */
const proto = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", proto.tile);
const FALLBACK = { tiles_url: "https://maps.nuni.co.kr/tiles/current/gildam.pmtiles", bounds: [126.95, 37.53, 127.02, 37.58], max_zoom: 12, attribution: "© OpenStreetMap contributors · © Protomaps" };
let map, manifest = FALLBACK, ready;
async function initMap() {
  try { const r = await fetch("/v1/map/manifest", { cache: "no-cache" }); if (r.ok) manifest = { ...FALLBACK, ...(await r.json()) }; } catch {}
  const b = manifest.bounds;
  const small = (b[2] - b[0]) * (b[3] - b[1]) < 1; // 시험판처럼 좁은 범위일 때만 안내·테두리
  if (!small) $("#notice")?.remove(); else $("#notice").hidden = false;
  styleId = store.get(LS_S, "light"); if (!STYLES().some(x => x.id === styleId)) styleId = "light";
  let style;
  try { style = await loadStyle(styleId); } catch { styleId = "light"; style = fallbackStyle(); }
  curMeta = style.metadata || {};
  map = new maplibregl.Map({ container: "map", style, center: small ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [126.978, 37.566], zoom: small ? 13 : 11, maxZoom: 18, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "top-right");
  ready = new Promise(res => map.on("load", res));
  await ready;
  if (small) {
  map.addSource("cover", { type: "geojson", data: { type: "Feature", geometry: { type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } } });
  map.addLayer({ id: "cover", type: "line", source: "cover", paint: { "line-color": "#2f5d50", "line-width": 1.5, "line-dasharray": [3, 2], "line-opacity": .6 } });
  }
  setupTerrain(); applyTerrainStyle(); renderStyleButtons(); $("#layers").hidden = false;
  map.addSource("tracks", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "tracks-casing", type: "line", source: "tracks", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 7, "line-opacity": .9 } });
  map.addLayer({ id: "tracks", type: "line", source: "tracks", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "color"], "line-width": 4 } });
  map.addSource("hover", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "hover", type: "circle", source: "hover", paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  map.addSource("course", { type: "geojson", data: fc([]) });
  map.addLayer({ id: "course-casing", type: "line", source: "course", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 8 } });
  map.addLayer({ id: "course", type: "line", source: "course", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#d2453b", "line-width": 4, "line-dasharray": [2, 1.2] } });
  map.on("click", e => { if(tab==="course"&&window.__trace?.mapClick(e))return; if(tab==="course"&&window.__gpxEditor?.active){window.__gpxEditor.mapClick(e);return;} if(window.__openPlace?.(e))return; if (tab !== "course" || courseStage() !== "new") return; const edge = lastPointer === "mouse" ? courseEdgeAt(e.point, 8) : null; if (edge) insertPt(edge.leg, [edge.at.lng, edge.at.lat]); else addPt([e.lngLat.lng, e.lngLat.lat]); });
  map.getCanvas().addEventListener("pointerdown", e => { lastPointer = e.pointerType || "mouse"; }, { passive: true });
  let hoverQueued = false, hoverEv = null;
  map.on("mousemove", e => { hoverEv = e; if (hoverQueued) return; hoverQueued = true; requestAnimationFrame(() => { hoverQueued = false; courseHover(hoverEv); }); });
  map.on("mouseout", hideCourseGhost);
  renderTracks(); renderCourse(); updateStage();
  window.__map = map; window.__switchStyle = switchStyle; window.__elevAt = elevAt; window.__gildamReady = true; window.__gildamManifest = manifest; window.__applyPlaces?.(true);
}
const fc = f => ({ type: "FeatureCollection", features: f });
function fit(coords) {
  if (!coords.length) return; const bb = coords.reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[0]), Math.max(a[3], c[1])], [180, 90, -180, -90]);
  const mob = innerWidth <= 720;
  map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: mob ? { top: 60, bottom: innerHeight * .55, left: 30, right: 30 } : { top: 70, bottom: 40, left: 400, right: 60 }, maxZoom: 16, duration: 400 });
}

/* ---------- 지도 스타일 (같은 타일, 다른 스타일) ---------- */
const LS_S = "gildam.style.v1";
const STYLE_FALLBACK = [["light", "기본"], ["dark", "야간"], ["grayscale", "흑백"], ["outdoor", "등산"], ["gildam", "길담"]].map(([id, name]) => ({ id, name, url: `/styles/${id}.json` }));
const STYLES = () => (Array.isArray(manifest.styles) && manifest.styles.length ? manifest.styles : STYLE_FALLBACK);
let styleId = "light", curMeta = {};
function fallbackStyle() {
  return { version: 8, glyphs: "/fonts/{fontstack}/{range}.pbf", sprite: location.origin + "/sprites/v4/light",
    sources: { protomaps: { type: "vector", url: "pmtiles://" + manifest.tiles_url, attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank">© Protomaps</a>' } },
    layers: basemaps.layers("protomaps", basemaps.namedFlavor("light"), { lang: "ko" }) };
}
async function loadStyle(id) {
  const it = STYLES().find(x => x.id === id); const u = new URL(it.url, location.href);
  const st = await (await fetch(u.pathname, { cache: "no-cache" })).json(); // 같은 출처로
  st.sources.protomaps.url = "pmtiles://" + manifest.tiles_url;
  return st;
}
const OVERLAY_FIRST = ["cover", "tracks-casing"];
async function switchStyle(id) {
  if (id === styleId || !map) return;
  let st; try { st = await loadStyle(id); } catch { return toast("스타일을 불러오지 못했어요"); }
  const all = map.getStyle().layers;
  all.filter(l => l.source === "protomaps" || l.type === "background").forEach(l => map.removeLayer(l.id));
  const ov = OVERLAY_FIRST.find(x => map.getLayer(x));
  const mid = map.getLayer("hillshade") ? "hillshade" : ov;
  try { map.setSprite(st.sprite); } catch {}
  try { map.setGlyphs(st.glyphs); } catch {}
  st.layers.filter(l => l.type !== "symbol").forEach(l => map.addLayer(l, mid));
  const symBefore = ov; st.layers.filter(l => l.type === "symbol").forEach(l => map.addLayer(l, symBefore));
  // 지형 레이어의 라벨 순서 유지: 등고선 라벨은 기본 라벨 아래
  styleId = id; curMeta = st.metadata || {}; store.set(LS_S, id); applyTerrainStyle(); renderStyleButtons(); window.__applyPlaces?.(true);
}
function renderStyleButtons() {
  const box = $("#styleSeg"); if (!box) return;
  box.innerHTML = STYLES().map(x => `<button data-s="${esc(x.id)}" class="${x.id === styleId ? "on" : ""}">${esc(x.name)}</button>`).join("");
  box.querySelectorAll("button").forEach(b => b.onclick = () => switchStyle(b.dataset.s));
}
function applyTerrainStyle() {
  if (!map || !map.getLayer("hillshade")) return;
  const m = curMeta;
  map.setPaintProperty("hillshade", "hillshade-exaggeration", m["gildam:hillshade"] ?? 0.35);
  map.setPaintProperty("hillshade", "hillshade-shadow-color", m["gildam:hillshade-shadow"] || "#5a5a4a");
  map.setPaintProperty("hillshade", "hillshade-highlight-color", m["gildam:hillshade-highlight"] || "#ffffff");
  const cc = m["gildam:contour-color"] || "#8a6d3b", emph = !!m["gildam:contour-emphasis"];
  map.setPaintProperty("contours", "line-color", cc);
  map.setPaintProperty("contours", "line-opacity", ["match", ["get", "level"], 1, emph ? 0.85 : 0.6, emph ? 0.5 : 0.3]);
  map.setPaintProperty("contours", "line-width", ["match", ["get", "level"], 1, emph ? 1.4 : 1, emph ? 0.7 : 0.5]);
  map.setPaintProperty("contour-labels", "text-color", cc);
}

/* ---------- terrain (DEM: terrarium PMTiles) ---------- */
let dem = null; // { pm, maxzoom, tileSize }
function setupTerrain() {
  const T = manifest.terrain; if (!T || !T.url) return;
  const pm = new pmtiles.PMTiles(T.url); proto.add(pm);
  dem = { pm, maxzoom: T.max_zoom || 12, tileSize: T.tile_size || 512 };
  const firstSym = map.getStyle().layers.find(l => l.type === "symbol")?.id;
  map.addSource("dem", { type: "raster-dem", url: "pmtiles://" + T.url, encoding: T.encoding || "terrarium", tileSize: dem.tileSize, attribution: T.attribution });
  map.addLayer({ id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#5a5a4a", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#5a5a4a" } }, firstSym);
  // 등고선: maplibre-contour 가 같은 PMTiles 에서 DEM 타일을 읽어 계산 (메인 스레드)
  const ds = new mlcontour.DemSource({ url: "gdem://{z}/{x}/{y}", encoding: T.encoding || "terrarium", maxzoom: dem.maxzoom, worker: false });
  ds.manager.getTile = async (url, ac) => { const [z, x, y] = url.slice(7).split("/").map(Number); const r = await pm.getZxy(z, x, y, ac.signal); if (!r) throw new Error("no dem tile"); return { data: new Blob([r.data], { type: "image/webp" }) }; };
  ds.setupMaplibre(maplibregl);
  map.addSource("contours", { type: "vector", tiles: [ds.contourProtocolUrl({ multiplier: 1, thresholds: { 11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [10, 50], 15: [10, 50] }, elevationKey: "ele", levelKey: "level", contourLayer: "contours" })], maxzoom: 15 });
  map.addLayer({ id: "contours", type: "line", source: "contours", "source-layer": "contours", minzoom: 11, layout: { visibility: "none" }, paint: { "line-color": "#8a6d3b", "line-opacity": ["match", ["get", "level"], 1, 0.6, 0.3], "line-width": ["match", ["get", "level"], 1, 1, 0.5] } }, firstSym);
  map.addLayer({ id: "contour-labels", type: "symbol", source: "contours", "source-layer": "contours", minzoom: 12, filter: [">", ["get", "level"], 0], layout: { visibility: "none", "symbol-placement": "line", "text-size": 10, "text-field": ["concat", ["number-format", ["get", "ele"], {}], "m"], "text-font": ["Noto Sans Regular"] }, paint: { "text-color": "#8a6d3b", "text-halo-color": "#fff", "text-halo-width": 1 } }, firstSym);
  $("#layers").hidden = false;
  const vis = (ids, on) => ids.forEach(id => map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
  const pref = store.get("gildam.layers.v1", { hill: true, cont: false });
  $("#lyHill").checked = pref.hill; $("#lyCont").checked = pref.cont; vis(["hillshade"], pref.hill); vis(["contours", "contour-labels"], pref.cont);
  $("#lyHill").onchange = e => { pref.hill = e.target.checked; vis(["hillshade"], pref.hill); store.set("gildam.layers.v1", pref); };
  $("#lyCont").onchange = e => { pref.cont = e.target.checked; vis(["contours", "contour-labels"], pref.cont); store.set("gildam.layers.v1", pref); if (pref.cont && map.getZoom() < 11) toast("등고선은 더 확대하면 보여요"); };
}
// DEM 표고 읽기: z(최대) 타일을 디코드해 캐시, 픽셀 값 terrarium → m
const demCache = new Map();
async function demTile(z, x, y) {
  const k = `${z}/${x}/${y}`; if (demCache.has(k)) return demCache.get(k);
  const pr = (async () => {
    const r = await dem.pm.getZxy(z, x, y); if (!r) return null;
    const bmp = await createImageBitmap(new Blob([r.data], { type: "image/webp" }));
    const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
    return { w: bmp.width, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
  })();
  demCache.set(k, pr); if (demCache.size > 64) demCache.delete(demCache.keys().next().value);
  return pr;
}
async function elevAt(lon, lat) {
  if (!dem) return null; const z = dem.maxzoom, n = 2 ** z;
  const fx = (lon + 180) / 360 * n, s = Math.sin(rad(lat)), fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  const t = await demTile(z, Math.floor(fx), Math.floor(fy)); if (!t) return null;
  const px = Math.min(t.w - 1, Math.floor((fx % 1) * t.w)), py = Math.min(t.w - 1, Math.floor((fy % 1) * t.w)), i = (py * t.w + px) * 4;
  return t.d[i] * 256 + t.d[i + 1] + t.d[i + 2] / 256 - 32768;
}
// 코스를 30m 간격(최대 600점)으로 나눠 표고 샘플
async function sampleCourse(P) {
  const out = []; let total = 0; for (let i = 1; i < P.length; i++) total += hav(P[i - 1], P[i]);
  const step = Math.max(30, total / 600); let acc = 0;
  for (let i = 0; i < P.length; i++) {
    if (i === 0) { out.push([0, P[0]]); continue; }
    const a = P[i - 1], b = P[i], d = hav(a, b);
    for (let s2 = step - (acc % step); s2 < d; s2 += step) { const f = s2 / d; out.push([acc + s2, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]]); }
    acc += d; out.push([acc, b]);
  }
  const E = await Promise.all(out.map(([, p]) => elevAt(p[0], p[1]).catch(() => null)));
  return out.map(([d, p], i) => [d, E[i], p]).filter(x => x[1] != null);
}

/* ---------- tabs / panel ---------- */
let tab = "course", drawing = false, lastPointer = "mouse";
$$(".tab").forEach(b => b.onclick = () => {
  tab = b.dataset.tab; $$(".tab").forEach(x => x.classList.toggle("active", x === b));
  $$("[data-pane]").forEach(s => s.hidden = s.dataset.pane !== tab);
  hideCourseGhost(); updateStage();
  markers.forEach(m => m.getElement().style.display = tab === "course" ? "" : "none");window.__gpxEditor?.setVisible(tab==="course");window.__trace?.setVisible(tab==="course");
  $("#panel").classList.remove("min");
});
$("#noticeX").onclick = () => $("#notice").remove();
$("#grip").onclick = () => $("#panel").classList.toggle("min");
$("#layersBtn").onclick = () => { const open = $("#layers").classList.toggle("open"); $("#layersBtn").setAttribute("aria-expanded", String(open)); };

/* ---------- tracks ---------- */
let tracks = store.get(LS_T, []);
const trackOriginals=new Map();
let chartMode = "ele";
function saveTracks() { store.set(LS_T, tracks.map(({ s, ...t }) => t)); }
async function addFiles(files) {
  let n = 0;
  for (const f of files) {
    if (f.size > 30 * 1024 * 1024) { toast(`${f.name}: 30MB 이하만 돼요`); continue; }
    try {
      const originalText=await f.text();const g = parseGpx(originalText, f.name);
      tracks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: g.name, pts: g.pts, breaks:g.breaks, color: COLORS[tracks.length % COLORS.length], on: true }); trackOriginals.set(tracks.at(-1).id,originalText); n++;
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  if (n) { saveTracks(); renderTracks(); fit(tracks.filter(t => t.on).flatMap(t => t.pts)); toast(`기록 ${n}개를 불러왔어요`); }
}
$("#gpxIn").onchange = e => { addFiles([...e.target.files]); e.target.value = ""; };
const drop = $("#drop");
let dragDepth = 0; const dragging = on => { drop.classList.toggle("over", on); document.body.classList.toggle("dragging", on); };
document.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; dragging(true); });
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("dragleave", e => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dragging(false); } });
document.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; dragging(false); const fs = [...(e.dataTransfer?.files || [])].filter(f => /\.gpx$/i.test(f.name)); if (!fs.length) return; if (fs.length > 1 || tab === "tracks") { if (tab !== "tracks") $('.tab[data-tab="tracks"]').click(); addFiles(fs); } else importCourse(fs[0]); });

async function selectStoredTrack(id) {
  const selected = tracks.find(t => t.id === id);
  if (!selected) return renderTracks();
  if (window.__gpxEditor?.active && !window.__gpxEditor.leave()) return renderTracks();
  tracks.forEach(t => { t.on = t === selected; });
  saveTracks();
  renderTracks();
  await mapInitialized;
  if (tracks.includes(selected) && selected.on && map?.getSource("tracks")) fit(selected.pts);
}
$("#storedTrack").onchange = e => selectStoredTrack(e.target.value);

function renderTracks() {
  const L = $("#trackList");
  const picker = $("#storedTrack");
  $("#storedTrackLabel").hidden = !tracks.length;
  picker.innerHTML = `<option value="">GPX를 선택하면 지도에 표시해요</option>` + tracks.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
  const visible = tracks.filter(t => t.on);
  picker.value = visible.length === 1 ? visible[0].id : "";
  L.innerHTML = tracks.length ? "" : `<div class="empty">아직 불러온 기록이 없어요.<br>두 개 이상 올리면 겹쳐서 비교할 수 있어요.</div>`;
  tracks.forEach(t => {
    const s = t.s || (t.s = stats(t.pts,t.breaks));
    const d = document.createElement("div"); d.className = "card" + (t.on ? "" : " off"); d.dataset.id = t.id;
    d.innerHTML = `<div class="hd"><span class="sw" style="background:${t.color}"></span><span class="nm" title="${esc(t.name)}">${esc(t.name)}</span>
      <button class="ib" data-a="vis">${t.on ? "숨기기" : "보이기"}</button><button class="ib" data-a="fit">맞춤</button><button class="ib" data-a="exp">GPX</button><button class="ib" data-a="course" title="원본 GPX로 지도에서 각 점 편집">지도에서 편집</button><button class="ib" data-a="del" aria-label="삭제">✕</button></div>
      ${!Array.isArray(t.breaks)?'<p class="hint small">이전 저장 기록은 구간 경계가 없습니다. 끊긴 구간이 있는 GPX는 원본을 다시 불러와 주세요.</p>':""}<div class="kv"><div><small>거리</small><b>${fmtKm(s.dist)}</b></div><div><small>전체 시간</small><b>${s.hasTime ? fmtDur(s.total) : "–"}</b></div><div><small>움직인 시간</small><b>${s.hasTime ? fmtDur(s.moving) : "–"}</b></div>
      <div><small>평균 속도</small><b>${s.avg ? s.avg.toFixed(1) + " km/h" : "–"}</b></div><div><small>오르막</small><b>${s.gain != null ? Math.round(s.gain) + " m" : "–"}</b></div><div><small>날짜</small><b>${s.start ? new Date(s.start).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }) : "–"}</b></div></div>`;
    d.onclick = e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === "vis") { t.on = !t.on; saveTracks(); renderTracks(); }
      if (a === "fit") fit(t.pts);
      if (a === "exp") download(t.name, toGpx(t.name, t.pts, { strip: $("#stripT").checked,breaks:t.breaks }));
      if (a === "course") { const original=trackOriginals.get(t.id);if(!original&&!confirm("이 저장 기록은 원본 GPX가 없어 구간·확장정보를 복구할 수 없습니다. 점 목록으로 편집할까요? 원본 GPX를 다시 불러오는 것을 권장합니다."))return;window.__gpxEditor?.importText(original||toGpx(t.name,t.pts,{strip:false,breaks:t.breaks}),t.name+".gpx"); }
      if (a === "del") { tracks = tracks.filter(x => x !== t); saveTracks(); renderTracks(); }
    };
    L.appendChild(d);
  });
  if (map && map.getSource("tracks")) map.getSource("tracks").setData(fc(window.__gpxEditor?.active?[]:tracks.filter(t => t.on).map(t => ({ type: "Feature", properties: { color: t.color }, geometry: trackGeometry(t) }))));
  drawChart();
}
function simplify(P, n) { const step = (P.length - 1) / (n - 1); return Array.from({ length: n }, (_, i) => { const p = P[Math.round(i * step)]; return [p[0], p[1], p[2]]; }); }

/* 차트: 거리(x) 대비 고도 또는 속도 */
$$("#chartBox .seg button").forEach(b => b.onclick = () => { chartMode = b.dataset.m; $$("#chartBox .seg button").forEach(x => x.classList.toggle("on", x === b)); drawChart(); });
let chartGeo = null;
function series(t) {
  const s = t.s, P = t.pts, out = [],boundary=new Set(t.breaks||[]);
  if (chartMode === "ele") { P.forEach((p, i) => { if (p[2] != null) out.push([s.cum[i], p[2], i]); }); }
  else { // 30초 창 이동평균 속도
    let j = 0; for (let i = 1; i < P.length; i++) { if(boundary.has(i))j=i;if (P[i][3] == null) continue; while (j < i && P[i][3] - P[j][3] > 30000) j++; const dt = (P[i][3] - P[j][3]) / 1000; if (dt > 0) out.push([s.cum[i], (s.cum[i] - s.cum[j]) / dt * 3.6, i]); }
  }
  return out;
}
function drawChart() {
  const box = $("#chartBox"), on = tracks.filter(t => t.on), S = on.map(t => ({ t, d: series(t) })).filter(x => x.d.length > 1);
  box.hidden = !on.length; if (!on.length) return;
  const c = $("#chart"), dpr = devicePixelRatio || 1, W = c.clientWidth || 320, H = 150; c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = "11px system-ui"; g.fillStyle = "#66706a";
  if (!S.length) { g.fillText(chartMode === "ele" ? "고도 정보가 있는 기록이 없어요" : "시각 정보가 있는 기록이 없어요", 10, H / 2); chartGeo = null; return; }
  const xs = S.flatMap(x => x.d.map(p => p[0])), ys = S.flatMap(x => x.d.map(p => p[1]));
  const x1 = Math.max(...xs) || 1; let y0 = Math.min(...ys), y1 = Math.max(...ys); if (chartMode === "spd") { y0 = 0; y1 = Math.min(y1, 60); } if (y1 - y0 < 5) { y1 += 2.5; y0 -= 2.5; }
  const L = 34, B = 18, T = 8, Rr = 8, X = v => L + v / x1 * (W - L - Rr), Y = v => H - B - (Math.min(v, y1) - y0) / (y1 - y0) * (H - B - T);
  g.strokeStyle = "#eee"; g.lineWidth = 1;
  for (let k = 0; k <= 3; k++) { const v = y0 + (y1 - y0) * k / 3, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - Rr, y); g.stroke(); g.fillText(Math.round(v) + "", 2, y + 4); }
  g.fillText(chartMode === "ele" ? "m" : "km/h", 2, T + 2); g.textAlign = "right"; g.fillText(fmtKm(x1), W - Rr, H - 4); g.textAlign = "left"; g.fillText("0", L, H - 4);
  S.forEach(({ t, d }) => { g.strokeStyle = t.color; g.lineWidth = 2; g.beginPath(); d.forEach((p,i)=>{const gap=i&&(t.breaks||[]).some(b=>b>d[i-1][2]&&b<=p[2]);if(i&&!gap)g.lineTo(X(p[0]),Y(p[1]));else g.moveTo(X(p[0]),Y(p[1]));}); g.stroke(); });
  chartGeo = { S, X, x1, L, W, Rr };
}
$("#chart").addEventListener("pointermove", e => {
  if (!chartGeo || !map) return; const r = e.target.getBoundingClientRect(), dist = (e.clientX - r.left - chartGeo.L) / (chartGeo.W - chartGeo.L - chartGeo.Rr) * chartGeo.x1;
  map.getSource("hover").setData(fc(chartGeo.S.map(({ t, d }) => { let best = d[0]; for (const p of d) if (Math.abs(p[0] - dist) < Math.abs(best[0] - dist)) best = p; const q = t.pts[best[2]]; return { type: "Feature", properties: { color: t.color }, geometry: { type: "Point", coordinates: [q[0], q[1]] } }; })));
});
$("#chart").addEventListener("pointerleave", () => map && map.getSource("hover").setData(fc([])));
addEventListener("resize", () => { drawChart(); drawProfile(); });

/* ---------- course ---------- */
const initialDraft = store.get(LS_D, []);
let course = Array.isArray(initialDraft) ? initialDraft : (initialDraft.waypoints || []), hist = [], markers = [], mode = initialDraft.mode || "walk";
let follow = Array.isArray(initialDraft) ? course.length === 0 : !!initialDraft.follow;
let geometry = [], legStart = [], routeState = "idle", routeSeq = 0, routeAbort = null, sel = -1, courseGhost = null;
/* 화면 단계: start(시작 화면) → new(새 코스 그리기) / gpx(불러온 GPX 편집) */
const coursePane = $('[data-pane="course"]');
function courseStage() { return window.__gpxEditor?.active ? "gpx" : (course.length || drawing || $("#traceTools").classList.contains("has-image")) ? "new" : "start"; }
function updateStage() {
  const s = courseStage(); coursePane.dataset.stage = s;
  if (map && !window.__gpxEditor?.active) map.getCanvas().style.cursor = tab === "course" && s === "new" ? "crosshair" : "";
}
new MutationObserver(() => updateStage()).observe($("#traceTools"), { attributes: true, attributeFilter: ["class"] });
$("#editNew").addEventListener("click", () => { drawing = true; });
$("#brand").onclick = () => { if (window.__gpxEditor?.active && !window.__gpxEditor.leave()) return; drawing = false; if (tab !== "course") $('.tab[data-tab="course"]').click(); renderCourse(); updateStage(); $("#panel").scrollTop = 0; };
const markSel = () => markers.forEach(m => m.getElement().classList.toggle("sel", m._i === sel));
function hideCourseGhost() { courseGhost?.remove(); courseGhost = null; }
// 코스 선 위의 가장 가까운 위치와 그 위치가 속한 경유점 사이(leg) 번호
function courseEdgeAt(point, limit) {
  if (window.__gpxEditor?.active || course.length < 2) return null;
  for (const p of course) { const q = map.project(p.slice(0, 2)); if (Math.hypot(q.x - point.x, q.y - point.y) < 14) return null; }
  const pts = usableCourse(), hits = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = map.project(pts[i].slice(0, 2)), b = map.project(pts[i + 1].slice(0, 2)), dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1))), v = Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    if (v < limit) hits.push({ si: 0, pi: i, d: v, x: a.x + t * dx, y: a.y + t * dy });
  }
  if (!hits.length) return null;
  const legOf = i => { let leg = i; if (follow) { leg = 0; while (leg + 1 < legStart.length && legStart[leg + 1] <= i) leg++; } return Math.min(leg, course.length - 2); };
  // 왕복처럼 선이 겹친 곳: 고른 지점과 이어진 쪽(leg)을 우선한다.
  const passes = window.GildamGpxModel.groupPasses(hits, follow ? 8 : 0), min = Math.min(...passes.map(h => h.d));
  const far = h => { const leg = legOf(h.pi); return sel < 0 ? 0 : Math.min(Math.abs(leg - sel), Math.abs(leg + 1 - sel)); };
  const best = passes.filter(h => h.d <= min + 6).reduce((a, h) => far(h) < far(a) || (far(h) === far(a) && h.d < a.d) ? h : a);
  return { leg: legOf(best.pi), at: map.unproject([best.x, best.y]) };
}
function courseHover(e) {
  const edge = e && tab === "course" && courseStage() === "new" && lastPointer === "mouse" ? courseEdgeAt(e.point, 8) : null;
  if (!edge) { if (courseGhost) { hideCourseGhost(); updateStage(); } return; }
  map.getCanvas().style.cursor = "copy";
  if (!courseGhost) { const el = document.createElement("div"); el.className = "gpx-ghost"; el.textContent = "+"; courseGhost = new maplibregl.Marker({ element: el }).setLngLat(edge.at).addTo(map); } else courseGhost.setLngLat(edge.at);
}
function insertPt(leg, c) { hideCourseGhost(); snap(); course.splice(leg + 1, 0, [c[0], c[1], null]); sel = leg + 1; renderCourse(); }
const routeCache = new Map();
const usableCourse = () => window.__gpxEditor?.active ? window.__gpxEditor.selectedGeometry() : !follow || routeState === "ready" ? (follow ? geometry : course) : [];
function routeUi(message) {
  $("#cRouteStatus").textContent = message;
  $("#cRouteStatus").style.color = routeState === "error" ? "#b42318" : "";
  $("#cExport").disabled = $("#cSave").disabled = follow && course.length > 1 && routeState !== "ready";
  $("#cRetry").hidden = routeState !== "error";
  $$("#connection button").forEach(b => b.classList.toggle("on", (b.dataset.v === "follow") === follow));
  $$("#mode button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
}
function drawCourseGeometry() {
  if(window.__gpxEditor?.active)return;
  const pts = usableCourse();
  if (map?.getSource("course")) map.getSource("course").setData(fc(pts.length > 1 ? [{type:"Feature",properties:{},geometry:{type:"LineString",coordinates:pts.map(p=>p.slice(0,2))}}] : []));
}
async function solveCourse() {
  const seq = ++routeSeq; routeAbort?.abort(); routeAbort = new AbortController();
  ++profSeq; clearTimeout(profT); prof = null; $("#cChartBox").hidden = true;
  if (!follow || course.length < 2) {
    geometry = []; routeState = "idle"; drawCourseGeometry();
    legStart = []; routeUi(course.length < 2 ? (course.length ? "다음 지점을 찍으면 선으로 이어집니다." : "지도를 눌러 출발 지점을 찍으세요.") : "");
    courseStats(); scheduleProfile(); return;
  }
  if (course.length > 100) { routeState="error"; geometry=[]; drawCourseGeometry(); routeUi("길 따라 잇기는 지점 100개까지 됩니다. 지점을 줄이거나 직선으로 이어 주세요."); courseStats(); return; }
  routeState = "pending"; geometry = []; drawCourseGeometry(); courseStats();
  routeUi("길을 찾는 중…");
  const points = course.map(p=>p.slice(0,2)), selectedMode = mode;
  try {
    const solved=[], starts=[];
    for (let i=1; i<points.length; i++) {
      const key=JSON.stringify([selectedMode,points[i-1],points[i]]);let part=routeCache.get(key);
      if (!part) {
        let res, data;
        for (let attempt=0; attempt<4; attempt++) {
          if(seq!==routeSeq)return;
          res=await fetch("/routing/route",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from:points[i-1],to:points[i],mode:selectedMode}),signal:routeAbort.signal});
          data=await res.json();
          if(res.status!==503||attempt===3)break;
          await new Promise(resolve=>setTimeout(resolve,600));
        }
        if (!res.ok) throw Error(`${i}–${i+1}번 구간: ${data.error || "경로 계산 실패"}`);
        part=data.coordinates;if(!Array.isArray(part)||part.length<2)throw Error("올바른 경로를 받지 못했습니다.");
        routeCache.set(key,part);if(routeCache.size>200)routeCache.delete(routeCache.keys().next().value);
      }
      if(seq!==routeSeq)return;
      if(solved.length) {
        // A snapped waypoint can differ by profile/direction; don't invent a connecting road.
        const a=solved.at(-1),b=part[0];
        if(Math.abs(a[0]-b[0])>0.00001||Math.abs(a[1]-b[1])>0.00001)throw Error("경유점이 서로 다른 길에 연결됐습니다. 경유점을 교차로나 길 위로 옮겨 주세요.");
      }
      starts.push(Math.max(0,solved.length-1));
      solved.push(...(solved.length?part.slice(1):part));
    }
    if(seq!==routeSeq)return;geometry=solved;legStart=starts;routeState="ready";
    routeUi("");
  } catch(e) {
    if(seq!==routeSeq||e.name==="AbortError")return;
    routeState="error";geometry=[];routeUi((e.message && !e.message.includes("fetch") ? e.message : "서버 연결에 실패했습니다. 다시 시도하세요.")+" · 지점을 옮기거나 다시 계산해 주세요.");
  }
  drawCourseGeometry();courseStats();scheduleProfile();
}
$("#connection").addEventListener("click", e => {const v=e.target.dataset.v;if(window.__gpxEditor?.active){toast("GPX는 선택한 부분만 길 따라로 바꿀 수 있습니다.");return;}if(!v||(v==="follow")===follow)return;snap();follow=v==="follow";renderCourse();});
$("#cRetry").onclick=()=>solveCourse();
$("#cDelete").onclick=()=>{if(!course.length)return;snap();if(sel>=0&&sel<course.length)course.splice(sel,1);else course.pop();sel=-1;renderCourse();};
const snap = () => { hist.push(JSON.stringify({course,follow,mode})); if (hist.length > 100) hist.shift(); };
function addPt(c) { if(window.__gpxEditor?.active)return; snap(); course.push([c[0], c[1], null]); sel = course.length - 1; renderCourse(); }
function renderCourse() {
  updateStage();
  if(window.__gpxEditor?.active){window.__gpxEditor.render();return;}
  if (sel >= course.length) sel = -1;
  store.set(LS_D, {waypoints:course, follow, mode});
  if (!map || !map.getSource("course")) return;
  drawCourseGeometry();
  markers.forEach(m => m.remove()); markers = [];
  const many = course.length > 60;
  course.forEach((p, i) => {
    if (many && i % Math.ceil(course.length / 60) && i !== course.length - 1) return;
    const el = document.createElement("div"); el.className = "cpt" + (i === 0 ? " first" : "") + (i === sel ? " sel" : ""); el.title = i === 0 ? "출발" : `${i + 1}번 지점`;
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p[0], p[1]]).addTo(map); m._i = i;
    m.on("dragstart", () => {sel = i; markSel(); hideCourseGhost(); snap(); ++routeSeq; routeAbort?.abort(); ++profSeq; prof=null; if(follow){routeState="pending";geometry=[];routeUi("지점 이동 중…");drawCourseGeometry();}}); m.on("drag", () => {const l=m.getLngLat();course[i]=[l.lng,l.lat,null];drawCourseGeometry();courseStats();});
    m.on("dragend", () => renderCourse());
    el.addEventListener("click", ev => { ev.stopPropagation(); sel = sel === i ? -1 : i; markSel(); });
    el.addEventListener("contextmenu", ev => { ev.preventDefault(); ev.stopPropagation(); snap(); course.splice(i,1); sel = -1; renderCourse(); });
    el.title += " · 눌러서 선택, 끌어서 이동, Delete로 삭제";
    if (tab !== "course") el.style.display = "none";
    markers.push(m);
  });
  solveCourse();
}
let prof = null, profSeq = 0;
function courseStats() {
  if(window.__gpxEditor?.active){window.__gpxEditor.renderStats();return;}
  const s = stats(usableCourse().map(p => [p[0], p[1], p[2], null]));
  const g = prof && prof.gain != null ? prof : (s.hasEle ? { gain: s.gain, loss: s.loss } : null);
  // 예상 시간: 거리/속도 + 오르막 100m 당 10분(걷기·등산), 자전거는 5분
  const h = s.dist / 1000 / SPEED[mode] * 3600 + (g ? g.gain / 100 * (mode === "bike" ? 300 : 600) : 0);
  $("#cStats").innerHTML = `<div><small>거리</small><b>${fmtKm(s.dist)}</b></div><div><small>예상 시간</small><b>${course.length > 1 ? fmtDur(h) : "–"}</b></div><div><small>오르막 / 내리막</small><b>${g ? `${Math.round(g.gain)} / ${Math.round(g.loss)} m` : "–"}</b></div>`;
}
let profT;
function scheduleProfile() { clearTimeout(profT); profT = setTimeout(updateProfile, 250); }
async function updateProfile() {
  const seq = ++profSeq, box = $("#cChartBox");
  if (!dem || usableCourse().length < 2) { prof = null; box.hidden = true; courseStats(); return; }
  const S = await sampleCourse(usableCourse()); if (seq !== profSeq) return;
  if (S.length < 2) { prof = null; box.hidden = true; courseStats(); return; }
  let gain = 0, loss = 0, ref = S[0][1]; for (const [, e] of S) { if (e - ref >= 3) { gain += e - ref; ref = e; } else if (ref - e >= 3) { loss += ref - e; ref = e; } }
  prof = { S, gain, loss, min: Math.min(...S.map(x => x[1])), max: Math.max(...S.map(x => x[1])) };
  box.hidden = false; drawProfile(); courseStats();
}
function drawProfile() {
  if (!prof) return; const c = $("#cChart"), dpr = devicePixelRatio || 1, W = c.clientWidth || 320, H = 130; c.width = W * dpr; c.height = H * dpr;
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = "11px system-ui";
  const { S } = prof, x1 = S.at(-1)[0] || 1; let y0 = prof.min, y1 = prof.max; if (y1 - y0 < 20) { y1 += 10; y0 -= 10; }
  const L = 38, B = 18, T = 8, Rr = 8, X = v => L + v / x1 * (W - L - Rr), Y = v => H - B - (v - y0) / (y1 - y0) * (H - B - T);
  g.strokeStyle = "#eee"; g.fillStyle = "#66706a";
  for (let k = 0; k <= 3; k++) { const v = y0 + (y1 - y0) * k / 3, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - Rr, y); g.stroke(); g.fillText(Math.round(v) + "m", 2, y + 4); }
  g.textAlign = "right"; g.fillText(fmtKm(x1), W - Rr, H - 4); g.textAlign = "left"; g.fillText("0", L, H - 4);
  const grd = g.createLinearGradient(0, T, 0, H - B); grd.addColorStop(0, "#d2453b55"); grd.addColorStop(1, "#d2453b08");
  g.beginPath(); g.moveTo(X(0), H - B); S.forEach(([d, e]) => g.lineTo(X(d), Y(e))); g.lineTo(X(x1), H - B); g.closePath(); g.fillStyle = grd; g.fill();
  g.beginPath(); S.forEach(([d, e], i) => i ? g.lineTo(X(d), Y(e)) : g.moveTo(X(d), Y(e))); g.strokeStyle = "#d2453b"; g.lineWidth = 2; g.stroke();
  g.fillStyle = "#1d2420"; g.fillText(`최고 ${Math.round(prof.max)}m · 최저 ${Math.round(prof.min)}m`, L + 4, T + 10);
}
$("#cChart").addEventListener("pointermove", e => {
  if (!prof || !map) return; const r = e.target.getBoundingClientRect(), x1 = prof.S.at(-1)[0], d = (e.clientX - r.left - 38) / (r.width - 46) * x1;
  let best = prof.S[0]; for (const p of prof.S) if (Math.abs(p[0] - d) < Math.abs(best[0] - d)) best = p;
  map.getSource("hover").setData(fc([{ type: "Feature", properties: { color: "#d2453b" }, geometry: { type: "Point", coordinates: best[2] } }]));
});
$("#cChart").addEventListener("click", e => {
  if (!prof || !window.__gpxEditor?.active) return; const r = e.target.getBoundingClientRect(), d = (e.clientX - r.left - 38) / (r.width - 46) * prof.S.at(-1)[0];
  let best = prof.S[0]; for (const p of prof.S) if (Math.abs(p[0] - d) < Math.abs(best[0] - d)) best = p;
  window.__gpxEditor.selectAt(best[0]);
});
$("#cChart").addEventListener("pointerleave", () => map && map.getSource("hover").setData(fc([])));
$$("#mode button").forEach(b => b.onclick = () => { if(mode===b.dataset.v)return;if(!window.__gpxEditor?.active)snap();mode = b.dataset.v; $$("#mode button").forEach(x => x.classList.toggle("on", x === b)); renderCourse(); });
$("#cUndo").onclick = () => { if (!hist.length) return toast("되돌릴 게 없어요"); const previous=JSON.parse(hist.pop());course=previous.course;follow=previous.follow;mode=previous.mode;sel=-1;renderCourse(); };
$("#cClear").onclick = () => { if (!course.length) return; snap(); course = []; sel = -1; drawing = true; renderCourse(); toast("코스를 지웠어요 (되돌리기 가능)"); };
$("#cLoop").onclick = () => { if (course.length < 2) return toast("지점이 2개 이상 필요해요"); const a = course[0], b = course[course.length - 1]; if (a[0] === b[0] && a[1] === b[1]) return toast("이미 닫힌 코스예요"); snap(); course.push([a[0], a[1], a[2]]); renderCourse(); };
const cname = () => $("#cName").value.trim() || `길담 코스 ${new Date().toLocaleDateString("ko-KR")}`;
$("#cExport").onclick = () => { if(follow&&routeState!=="ready")return toast("경로 연결을 먼저 완료하세요"); if (course.length < 2) return toast("지점이 2개 이상 필요해요"); download(cname(), toGpx(cname(), usableCourse().map(p => [p[0], p[1], p[2], null]), { strip: true })); toast("GPX를 내려받았어요"); };
async function importCourse(f) { if(!window.__gpxEditor){toast("GPX 편집기를 불러오지 못했습니다. 새로고침 후 다시 시도하세요. 기존 경로는 유지했습니다.");return;}return window.__gpxEditor.importFile(f); }
// 새 코스 단축키 (GPX 편집 중에는 gpx-editor.js가 처리)
document.addEventListener("keydown", e => {
  if (tab !== "course" || courseStage() !== "new" || e.defaultPrevented || e.altKey) return;
  const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && (e.key === "z" || e.key === "Z")) $("#cUndo").click();
  else if (!mod && (e.key === "Delete" || e.key === "Backspace") && sel >= 0) $("#cDelete").click();
  else if (!mod && e.key === "Escape" && sel >= 0) { sel = -1; markSel(); }
  else return;
  e.preventDefault();
});
let saved = store.get(LS_C, []);
function renderSaved() {
  const L = $("#saved"); L.innerHTML = ""; $("#savedTitle").hidden = !saved.length;
  saved.forEach((c, i) => {
    const d = document.createElement("div"); d.className = "card";
    d.innerHTML = `<div class="hd"><span class="nm">${esc(c.name)}</span><small style="color:#66706a">${fmtKm(c.gpxEdit ? c.distance : stats(c.pts.map(p => [p[0], p[1], p[2], null])).dist)}</small><button class="ib" data-a="open">열기</button><button class="ib" data-a="del">✕</button></div>`;
    d.onclick = e => { const a = e.target.dataset.a; if (a === "open") { if(c.gpxEdit){window.__gpxEditor?.restore(c);return;}if(window.__gpxEditor?.active){if(!window.__gpxEditor.leave())return;}else if(course.length&&!confirm("현재 코스가 저장되지 않았을 수 있습니다. 저장한 코스를 열까요?"))return; snap(); sel=-1; follow=!!c.follow;mode=c.mode||"walk";course=(c.waypoints||c.pts).map(p=>[...p]); $("#cName").value = c.name; renderCourse(); fit(course); } if (a === "del") { if (!confirm(`저장한 코스 "${c.name}"을(를) 지울까요?`)) return; saved.splice(i, 1); store.set(LS_C, saved); renderSaved(); } };
    L.appendChild(d);
  });
}
$("#cSave").onclick = () => { if(follow&&routeState!=="ready")return toast("경로 연결을 먼저 완료하세요"); if (course.length < 2) return toast("지점이 2개 이상 필요해요"); const n = cname(), k = saved.findIndex(c => c.name === n); const item = { name: n, pts: usableCourse(), waypoints: course, follow, mode, at: Date.now() }; if (k >= 0) saved[k] = item; else saved.unshift(item); if (store.set(LS_C, saved)) { renderSaved(); toast("이 브라우저에 저장했어요"); } };

window.__courseBridge={refreshTracks:renderTracks,map:()=>map,toast,fit,download,stats,fmtKm,mode:()=>mode,inCourse:()=>tab==="course",hasWork:()=>course.length>0,
  selectTab:()=> $('.tab[data-tab="course"]').click(), stage:()=>updateStage(),
  invalidate:()=>{++routeSeq;routeAbort?.abort();++profSeq;clearTimeout(profT);prof=null;$("#cChartBox").hidden=true;},
  removeMarkers:()=>{markers.forEach(m=>m.remove());markers=[];},
  profile:()=>{++profSeq;prof=null;$("#cChartBox").hidden=true;scheduleProfile();},
  newCourse:()=>{course=[];hist=[];sel=-1;follow=true;routeState="idle";geometry=[];$("#cName").value="";renderCourse();},
  resume:()=>renderCourse(),
  save:item=>{const k=saved.findIndex(c=>c.name===item.name);if(k>=0&&!confirm("같은 이름의 브라우저 저장본을 바꿀까요? 원본 파일은 바뀌지 않습니다."))return false;const next=saved.slice();if(k>=0)next[k]=item;else next.unshift(item);if(!store.set(LS_C,next))return false;saved=next;renderSaved();return true;}};
renderTracks(); renderSaved(); courseStats();
const mapInitialized = initMap();
})();
