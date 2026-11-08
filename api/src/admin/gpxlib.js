/* 길담 관리 도구 공통: GPX 파싱·쓰기, 거리, DEM 표고, 바탕지도, 고도 차트. 모든 처리는 브라우저 안. 서버로 GPX 를 보내지 않음. */
"use strict";
const G = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const xmlEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const R = 6371008.8, rad = (d) => d * Math.PI / 180;
  const hav = (a, b) => { const dLa = rad(b[1] - a[1]), dLo = rad(b[0] - a[0]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
  const km = (m) => m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";
  const toast = (m) => { let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); } t.textContent = m; t.classList.add("show"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2200); };

  // 점: [lon, lat, ele|null, timeMs|null]. 세그먼트 배열을 돌려줌.
  function parseGpx(text, fname = "") {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("GPX 형식이 아니에요");
    const read = (p) => { const e = p.getElementsByTagNameNS("*", "ele")[0], t = p.getElementsByTagNameNS("*", "time")[0]; const ele = e ? parseFloat(e.textContent) : NaN, tm = t ? Date.parse(t.textContent) : NaN; return [+p.getAttribute("lon"), +p.getAttribute("lat"), isFinite(ele) ? ele : null, isFinite(tm) ? tm : null]; };
    const ok = (p) => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180;
    let segs = [...doc.getElementsByTagNameNS("*", "trkseg")].map((s) => [...s.getElementsByTagNameNS("*", "trkpt")].map(read).filter(ok)).filter((s) => s.length);
    if (!segs.length) segs = [...doc.getElementsByTagNameNS("*", "rte")].map((r) => [...r.getElementsByTagNameNS("*", "rtept")].map(read).filter(ok)).filter((s) => s.length);
    const n = segs.reduce((a, s) => a + s.length, 0);
    if (n < 2) throw new Error("경로 점이 2개 미만이에요");
    const nm = doc.getElementsByTagNameNS("*", "name")[0];
    return { name: (nm && nm.textContent.trim()) || fname.replace(/\.gpx$/i, ""), segs };
  }
  // GPX 1.1: <trk><name/><trkseg><trkpt lat lon><ele/><time/></trkpt>…  (길담 앱 GpxTrackParser 호환)
  function toGpx(name, segs, { withTime = false } = {}) {
    const pt = (p) => `<trkpt lat="${p[1].toFixed(7)}" lon="${p[0].toFixed(7)}">${p[2] != null && isFinite(p[2]) ? `<ele>${p[2].toFixed(1)}</ele>` : ""}${withTime && p[3] != null ? `<time>${new Date(p[3]).toISOString()}</time>` : ""}</trkpt>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="길담 maps.nuni.co.kr admin" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
<metadata><name>${xmlEsc(name)}</name><time>${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</time></metadata>
<trk><name>${xmlEsc(name)}</name>
${segs.filter((s) => s.length).map((s) => `<trkseg>\n${s.map(pt).join("\n")}\n</trkseg>`).join("\n")}
</trk>
</gpx>
`;
  }
  function download(name, text) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" }));
    a.download = (name || "gildam").replace(/[\\/:*?"<>|]+/g, "_") + ".gpx"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const cum = (P) => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + hav(P[i - 1], P[i])); return c; };
  function gainLoss(E) { let g = 0, l = 0, ref = null; for (const e of E) { if (e == null) continue; if (ref == null) { ref = e; continue; } if (e - ref >= 3) { g += e - ref; ref = e; } else if (ref - e >= 3) { l += ref - e; ref = e; } } return { gain: g, loss: l }; }

  // ---- manifest / DEM
  let manifest = null, dem = null;
  async function loadManifest() { if (manifest) return manifest; try { manifest = await (await fetch("/v1/map/manifest", { cache: "no-cache" })).json(); } catch { manifest = {}; } return manifest; }
  const proto = new pmtiles.Protocol(); maplibregl.addProtocol("pmtiles", proto.tile);
  function initDem() {
    const T = manifest?.terrain; if (!T?.url || dem) return dem;
    const pm = new pmtiles.PMTiles(T.url); proto.add(pm); dem = { pm, z: T.max_zoom || 12, cache: new Map(), attribution: T.attribution }; return dem;
  }
  async function demTile(z, x, y) {
    const k = `${z}/${x}/${y}`; if (dem.cache.has(k)) return dem.cache.get(k);
    const pr = (async () => { const r = await dem.pm.getZxy(z, x, y); if (!r) return null; const bmp = await createImageBitmap(new Blob([r.data], { type: "image/webp" })); const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0); return { w: bmp.width, d: g.getImageData(0, 0, bmp.width, bmp.height).data }; })();
    dem.cache.set(k, pr); if (dem.cache.size > 96) dem.cache.delete(dem.cache.keys().next().value); return pr;
  }
  // 쌍선형 보간 표고 (m)
  async function elevAt(lon, lat) {
    if (!dem) return null; const n = 2 ** dem.z, s = Math.sin(rad(lat));
    const fx = (lon + 180) / 360 * n, fy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    const tx = Math.floor(fx), ty = Math.floor(fy), t = await demTile(dem.z, tx, ty); if (!t) return null;
    const px = (fx - tx) * t.w - 0.5, py = (fy - ty) * t.w - 0.5, x0 = Math.max(0, Math.min(t.w - 1, Math.floor(px))), y0 = Math.max(0, Math.min(t.w - 1, Math.floor(py))), x1 = Math.min(t.w - 1, x0 + 1), y1 = Math.min(t.w - 1, y0 + 1), ax = Math.max(0, Math.min(1, px - x0)), ay = Math.max(0, Math.min(1, py - y0));
    const v = (x, y) => { const i = (y * t.w + x) * 4; return t.d[i] * 256 + t.d[i + 1] + t.d[i + 2] / 256 - 32768; };
    return (v(x0, y0) * (1 - ax) + v(x1, y0) * ax) * (1 - ay) + (v(x0, y1) * (1 - ax) + v(x1, y1) * ax) * ay;
  }
  async function elevMany(pts) { return Promise.all(pts.map((p) => elevAt(p[0], p[1]).catch(() => null))); }
  // 선을 step m 간격으로 촘촘히 (차트·표고용)
  function densify(P, maxPts = 800) {
    const C = cum(P), total = C.at(-1) || 0, step = Math.max(20, total / maxPts), out = [];
    for (let i = 0; i < P.length; i++) {
      if (i) { const a = P[i - 1], d = C[i] - C[i - 1]; for (let s = Math.ceil(C[i - 1] / step) * step; s < C[i]; s += step) { if (s <= C[i - 1]) continue; const f = (s - C[i - 1]) / d; out.push({ d: s, p: [a[0] + (P[i][0] - a[0]) * f, a[1] + (P[i][1] - a[1]) * f], src: i - 1 + f }); } }
      out.push({ d: C[i], p: P[i], src: i });
    }
    return out;
  }

  // ---- 바탕지도
  const BASES = [
    { id: "ofm-liberty", name: "OpenFreeMap (한국어)", url: "https://tiles.openfreemap.org/styles/liberty", ko: true },
    { id: "ofm-bright", name: "OpenFreeMap Bright", url: "https://tiles.openfreemap.org/styles/bright", ko: true },
  ];
  function koLabels(st) {
    for (const l of st.layers) {
      const tf = l.layout?.["text-field"]; if (!tf) continue;
      const s = JSON.stringify(tf); if (!/name/.test(s) || /housenumber|ref/.test(s)) continue;
      l.layout["text-field"] = ["coalesce", ["get", "name:ko"], ["get", "name"]];
    }
    return st;
  }
  async function loadBase(id) {
    const own = (manifest?.styles || []).find((s) => "gildam-" + s.id === id);
    if (own) { const st = await (await fetch(new URL(own.url).pathname, { cache: "no-cache" })).json(); if (manifest.tiles_url) st.sources.protomaps.url = "pmtiles://" + manifest.tiles_url; return st; }
    const b = BASES.find((x) => x.id === id) || BASES[0];
    return koLabels(await (await fetch(b.url)).json());
  }
  const baseList = () => [...BASES, ...(manifest?.styles || []).map((s) => ({ id: "gildam-" + s.id, name: "길담 · " + s.name }))];
  // 스타일 교체 후 오버레이(사용자 레이어) 다시 붙이기
  async function makeMap(container, { center = [127.8, 36.2], zoom = 7, onOverlay }) {
    await loadManifest(); initDem();
    let baseId = localStorage.getItem("gildam.admin.base") || "ofm-liberty"; if (!baseList().some((b) => b.id === baseId)) baseId = "ofm-liberty";
    let style; try { style = await loadBase(baseId); } catch { baseId = "gildam-gildam"; style = await loadBase(baseId); }
    const map = new maplibregl.Map({ container, style, center, zoom, maxZoom: 18, attributionControl: { compact: true }, doubleClickZoom: false });
    map.addControl(new maplibregl.NavigationControl(), "top-right"); map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    const addHill = () => { if (!dem || map.getSource("dem")) return; map.addSource("dem", { type: "raster-dem", url: "pmtiles://" + manifest.terrain.url, encoding: manifest.terrain.encoding || "terrarium", tileSize: manifest.terrain.tile_size || 512, attribution: dem.attribution }); const sym = map.getStyle().layers.find((l) => l.type === "symbol")?.id; map.addLayer({ id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-exaggeration": 0.3 } }, sym); };
    map.on("style.load", () => { addHill(); onOverlay && onOverlay(map); });
    const sel = document.createElement("div"); sel.className = "base";
    sel.innerHTML = `<select aria-label="바탕지도">${baseList().map((b) => `<option value="${esc(b.id)}" ${b.id === baseId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>`;
    container.parentElement.appendChild(sel);
    sel.querySelector("select").onchange = async (e) => { try { const st = await loadBase(e.target.value); localStorage.setItem("gildam.admin.base", e.target.value); map.setStyle(st); } catch { toast("바탕지도를 불러오지 못했어요"); } };
    await new Promise((r) => map.once("load", r));
    if (innerWidth < 760) setTimeout(() => map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"), 300);
    return map;
  }
  const fc = (f) => ({ type: "FeatureCollection", features: f });

  // ---- 고도 차트: data=[{d, e}], 범위 선택 지원(onPick(dist), sel=[a,b])
  function chart(canvas, { onHover, onPick } = {}) {
    let data = [], sel = null, geo = null; const H0 = +canvas.getAttribute("height") || 140; canvas.style.height = H0 + "px";
    function draw() {
      const dpr = devicePixelRatio || 1, W = canvas.clientWidth || 320, H = H0; canvas.width = W * dpr; canvas.height = H * dpr;
      const g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = "11px system-ui"; g.fillStyle = "#6B5A52";
      const E = data.filter((x) => x.e != null); if (E.length < 2) { g.fillText(data.length ? "표고 정보가 없어요" : "점을 2개 이상 찍으면 고도 그래프가 나와요", 8, H / 2); geo = null; return; }
      const x1 = data.at(-1).d || 1; let y0 = Math.min(...E.map((x) => x.e)), y1 = Math.max(...E.map((x) => x.e)); if (y1 - y0 < 20) { y1 += 10; y0 -= 10; }
      const L = 40, B = 18, T = 8, Rr = 8, X = (v) => L + v / x1 * (W - L - Rr), Y = (v) => H - B - (v - y0) / (y1 - y0) * (H - B - T);
      geo = { L, W, Rr, x1 };
      if (sel) { g.fillStyle = "#FFE9B0"; g.fillRect(X(sel[0]), T, X(sel[1]) - X(sel[0]), H - B - T); g.fillStyle = "#6B5A52"; }
      g.strokeStyle = "#EBD6CC"; for (let k = 0; k <= 3; k++) { const v = y0 + (y1 - y0) * k / 3, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - Rr, y); g.stroke(); g.fillText(Math.round(v) + "m", 2, y + 4); }
      g.textAlign = "right"; g.fillText(km(x1), W - Rr, H - 4); g.textAlign = "left"; g.fillText("0", L, H - 4);
      const grd = g.createLinearGradient(0, T, 0, H - B); grd.addColorStop(0, "#F2552C55"); grd.addColorStop(1, "#F2552C08");
      g.beginPath(); g.moveTo(X(E[0].d), H - B); E.forEach((x) => g.lineTo(X(x.d), Y(x.e))); g.lineTo(X(E.at(-1).d), H - B); g.closePath(); g.fillStyle = grd; g.fill();
      g.beginPath(); E.forEach((x, i) => (i ? g.lineTo : g.moveTo).call(g, X(x.d), Y(x.e))); g.strokeStyle = "#F2552C"; g.lineWidth = 2; g.stroke();
      if (sel) { g.strokeStyle = "#1FA65A"; g.lineWidth = 2; for (const s of sel) { g.beginPath(); g.moveTo(X(s), T); g.lineTo(X(s), H - B); g.stroke(); } }
    }
    const distAt = (e) => { if (!geo) return null; const r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(geo.x1, (e.clientX - r.left - geo.L) / (r.width - geo.L - geo.Rr) * geo.x1)); };
    canvas.addEventListener("pointermove", (e) => { const d = distAt(e); if (d != null && onHover) onHover(d); });
    canvas.addEventListener("pointerleave", () => onHover && onHover(null));
    canvas.addEventListener("click", (e) => { const d = distAt(e); if (d != null && onPick) onPick(d); });
    addEventListener("resize", draw);
    return { set(d) { data = d; draw(); }, select(s) { sel = s; draw(); }, draw };
  }
  async function readFiles(files) {
    const out = [];
    for (const f of files) { if (f.size > 30 * 1024 * 1024) { toast(`${f.name}: 30MB 이하만`); continue; } try { out.push(parseGpx(await f.text(), f.name)); } catch (e) { toast(`${f.name}: ${e.message}`); } }
    return out;
  }
  function dropZone(el, onFiles) {
    ["dragenter", "dragover"].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove("over"); }));
    el.addEventListener("drop", (e) => onFiles([...(e.dataTransfer?.files || [])].filter((f) => /\.gpx$/i.test(f.name))));
  }
  return { $, esc, hav, km, toast, parseGpx, toGpx, download, cum, gainLoss, elevAt, elevMany, densify, makeMap, fc, chart, readFiles, dropZone, get dem() { return dem; }, get manifest() { return manifest; } };
})();
