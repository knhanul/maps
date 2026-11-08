"use strict";
(async () => {
  const { $, esc, km, toast } = G;
  const COLORS = ["#F2552C", "#1FA65A", "#FFB400", "#4A6B82", "#D95D39", "#8AB89E", "#D9822B", "#90B4CE"];
  let items = [], mode = "one", picking = null, range = null, M = null; // M: 합친 결과 {segs, flat, C, E}
  const map = await G.makeMap($("#map"), { center: [127.8, 36.2], zoom: 7, onOverlay: (m) => overlay(m) });
  function overlay(m) {
    if (m.getSource("src")) return;
    m.addSource("src", { type: "geojson", data: G.fc([]) });
    m.addLayer({ id: "src", type: "line", source: "src", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": 4, "line-opacity": 0.55 } });
    m.addSource("gaps", { type: "geojson", data: G.fc([]) });
    m.addLayer({ id: "gaps", type: "line", source: "gaps", paint: { "line-color": "#c0392b", "line-width": 2, "line-dasharray": [1, 1.5] } });
    m.addSource("sel", { type: "geojson", data: G.fc([]) });
    m.addLayer({ id: "sel-casing", type: "line", source: "sel", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 8 } });
    m.addLayer({ id: "sel", type: "line", source: "sel", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#F2552C", "line-width": 4 } });
    m.addSource("pts", { type: "geojson", data: G.fc([]) });
    m.addLayer({ id: "pts", type: "circle", source: "pts", paint: { "circle-radius": 8, "circle-color": ["get", "c"], "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
    if (M) paint();
  }
  overlay(map);
  const ch = G.chart($("#ch"), {
    onHover: (d) => { if (!M || d == null) return paint(); const i = idxAtDist(d); paint(i); },
    onPick: (d) => { if (picking && M) setPick(idxAtDist(d)); },
  });
  const idxAtDist = (d) => { let lo = 0, hi = M.C.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (M.C[mid] < d) lo = mid + 1; else hi = mid; } return lo; };

  const files = async (fs) => { const gs = await G.readFiles(fs); gs.forEach((g) => items.push({ id: Math.random().toString(36).slice(2), name: g.name, segs: g.segs, rev: false, color: COLORS[items.length % COLORS.length] })); if (gs.length) { range = null; rebuild(true); toast(`${gs.length}개를 불러왔어요`); } };
  $("#files").onchange = (e) => { files([...e.target.files]); e.target.value = ""; };
  G.dropZone($("#drop"), files);

  const ordered = (it) => it.rev ? [...it.segs].reverse().map((s) => [...s].reverse()) : it.segs;
  const first = (it) => ordered(it)[0][0], last = (it) => ordered(it).at(-1).at(-1);
  function renderList() {
    const L = $("#list"); L.innerHTML = "";
    items.forEach((it, i) => {
      const n = it.segs.reduce((a, s) => a + s.length, 0), d = it.segs.reduce((a, s) => a + (G.cum(s).at(-1) || 0), 0);
      const el = document.createElement("div"); el.className = "item"; el.draggable = true; el.dataset.i = i;
      el.innerHTML = `<span class="h" title="끌어서 순서 바꾸기">⠿</span><span class="sw" style="background:${it.color}"></span><span class="nm" title="${esc(it.name)}"><b>${i + 1}.</b> ${esc(it.name)}<br><small>${km(d)} · 점 ${n} · 구간 ${it.segs.length}${it.rev ? " · ⇄ 뒤집음" : ""}</small></span>
        <button data-a="up" title="위로" ${i ? "" : "disabled"}>↑</button><button data-a="down" title="아래로" ${i < items.length - 1 ? "" : "disabled"}>↓</button><button data-a="rev" title="방향 뒤집기">⇄</button><button data-a="del" title="빼기">✕</button>`;
      el.onclick = (e) => { const a = e.target.dataset.a; if (!a) return;
        if (a === "up") [items[i - 1], items[i]] = [items[i], items[i - 1]];
        if (a === "down") [items[i + 1], items[i]] = [items[i], items[i + 1]];
        if (a === "rev") it.rev = !it.rev;
        if (a === "del") items.splice(i, 1);
        range = null; rebuild(); };
      el.addEventListener("dragstart", (e) => { el.classList.add("drag"); e.dataTransfer.setData("text/plain", String(i)); });
      el.addEventListener("dragend", () => el.classList.remove("drag"));
      el.addEventListener("dragover", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); const from = +e.dataTransfer.getData("text/plain"); if (isNaN(from) || from === i) return; const [x] = items.splice(from, 1); items.splice(i, 0, x); range = null; rebuild(); });
      L.appendChild(el);
      if (i < items.length - 1) { const g = G.hav(last(it), first(items[i + 1])); const gp = document.createElement("div"); gp.className = "gap" + (g > 200 ? " big" : ""); gp.textContent = `↕ 다음 파일 시작까지 ${km(g)}${g > 200 ? " — 멀어요, 순서·방향을 확인하세요" : ""}`; L.appendChild(gp); }
    });
  }
  async function rebuild(fit) {
    renderList();
    if (!items.length) { M = null; paint(); ch.set([]); stats(); return; }
    const segs = mode === "one" ? [items.flatMap((it) => ordered(it).flat())] : items.flatMap((it) => ordered(it));
    const flat = segs.flat(), C = [0]; let gapSum = 0;
    // 구간 사이(파일 사이 포함) 간격은 거리 그래프에서 이어 계산하되, 합계 거리에는 실제 이동으로 치지 않음
    const breaks = new Set(); { let k = 0; for (const s of segs.slice(0, -1)) { k += s.length; breaks.add(k); } }
    const fileBreaks = new Set(); { let k = 0; for (const it of items.slice(0, -1)) { k += ordered(it).flat().length; fileBreaks.add(k); } }
    for (let i = 1; i < flat.length; i++) { const d = G.hav(flat[i - 1], flat[i]); if (fileBreaks.has(i) || breaks.has(i)) gapSum += d; C.push(C[i - 1] + d); }
    M = { segs, flat, C, gapSum, fileBreaks, E: flat.map((p) => p[2]) };
    if (M.E.some((e) => e == null) && G.dem) { const miss = flat.map((p, i) => [p, i]).filter(([p]) => p[2] == null); const step = Math.max(1, Math.floor(miss.length / 1500)); const sample = miss.filter((_, k) => k % step === 0); const E = await G.elevMany(sample.map(([p]) => p)); sample.forEach(([, i], k) => (M.E[i] = E[k])); M.demFilled = true; }
    if (fit) { const b = flat.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [180, 90, -180, -90]); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 50, maxZoom: 15 }); }
    ch.set(flat.map((p, i) => ({ d: C[i], e: M.E[i] })));
    paint(); stats();
  }
  const R = () => range || [0, M.flat.length - 1];
  function paint(hover) {
    if (!map.getSource("src")) return;
    map.getSource("src").setData(G.fc(items.flatMap((it) => ordered(it).map((s) => ({ type: "Feature", properties: { c: it.color }, geometry: { type: "LineString", coordinates: s.map((p) => [p[0], p[1]]) } })))));
    const gaps = []; for (let i = 0; i < items.length - 1; i++) gaps.push({ type: "Feature", geometry: { type: "LineString", coordinates: [last(items[i]).slice(0, 2), first(items[i + 1]).slice(0, 2)] } });
    map.getSource("gaps").setData(G.fc(gaps));
    if (!M) { ["sel", "pts"].forEach((s) => map.getSource(s).setData(G.fc([]))); return; }
    const [a, b] = R(), sub = M.flat.slice(a, b + 1);
    map.getSource("sel").setData(G.fc(sub.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: sub.map((p) => [p[0], p[1]]) } }] : []));
    const P = [{ type: "Feature", properties: { c: "#1FA65A" }, geometry: { type: "Point", coordinates: M.flat[a].slice(0, 2) } }, { type: "Feature", properties: { c: "#FFB400" }, geometry: { type: "Point", coordinates: M.flat[b].slice(0, 2) } }];
    if (hover != null) P.push({ type: "Feature", properties: { c: "#4A6B82" }, geometry: { type: "Point", coordinates: M.flat[hover].slice(0, 2) } });
    map.getSource("pts").setData(G.fc(P));
    ch.select(range ? [M.C[a], M.C[b]] : null);
  }
  function stats() {
    if (!M) { $("#st").innerHTML = `<div><small>파일</small><b>0</b></div><div><small>거리</small><b>–</b></div><div><small>오르막/내리막</small><b>–</b></div>`; return; }
    const [a, b] = R(); let d = 0; for (let i = a + 1; i <= b; i++) if (!M.fileBreaks.has(i) && !(mode === "keep" && isSegBreak(i))) d += M.C[i] - M.C[i - 1];
    const gl = G.gainLoss(M.E.slice(a, b + 1));
    $("#st").innerHTML = `<div><small>${range ? "선택 구간" : "합친 코스"} · 점 ${b - a + 1}</small><b>${km(d)}</b></div><div><small>오르막 / 내리막</small><b>${Math.round(gl.gain)} / ${Math.round(gl.loss)} m</b></div><div><small>파일 사이 빈틈 합계</small><b>${km(M.gapSum)}</b></div>`;
  }
  function isSegBreak(i) { let k = 0; for (const s of M.segs.slice(0, -1)) { k += s.length; if (k === i) return true; } return false; }
  function setPick(i) {
    let [a, b] = R();
    if (picking === "start") a = Math.min(i, b - 1); else b = Math.max(i, a + 1);
    range = [a, b]; picking = null; $("#pick").querySelectorAll("button").forEach((x) => x.classList.remove("on")); map.getCanvas().style.cursor = "";
    paint(); stats(); toast(`구간: ${km(M.C[a])} ~ ${km(M.C[b])}`);
  }
  $("#pick").querySelectorAll("button").forEach((btn) => btn.onclick = () => {
    if (!M) return toast("먼저 GPX를 불러오세요");
    if (btn.dataset.v === "reset") { range = null; picking = null; paint(); stats(); return; }
    picking = btn.dataset.v; $("#pick").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === btn)); map.getCanvas().style.cursor = "crosshair";
  });
  map.on("click", (e) => {
    if (!picking || !M) return;
    const q = [e.lngLat.lng, e.lngLat.lat]; let bi = 0, bd = Infinity;
    for (let i = 0; i < M.flat.length; i++) { const d = G.hav(q, M.flat[i]); if (d < bd) { bd = d; bi = i; } }
    const px = map.project(M.flat[bi].slice(0, 2)), dd = Math.hypot(px.x - e.point.x, px.y - e.point.y);
    if (dd > 40) return toast("경로 가까이를 눌러 주세요");
    setPick(bi);
  });
  $("#mode").querySelectorAll("button").forEach((b) => b.onclick = () => { mode = b.dataset.v; $("#mode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); range = null; rebuild(); });
  $("#exp").onclick = () => {
    if (!M) return toast("먼저 GPX를 불러오세요");
    const [a, b] = R(), wt = $("#wt").checked, fill = $("#fill").checked;
    // 선택 범위를 구간 구조대로 자르기
    const out = []; let k = 0;
    for (const s of M.segs) { const s0 = k, s1 = k + s.length - 1; k += s.length; const lo = Math.max(a, s0), hi = Math.min(b, s1); if (lo > hi) continue; out.push(s.slice(lo - s0, hi - s0 + 1).map((p, j) => [p[0], p[1], p[2] ?? (fill ? M.E[lo + j] : null), p[3]])); }
    const name = $("#nm").value.trim() || items.map((i) => i.name).join(" + ").slice(0, 80);
    G.download(name, G.toGpx(name, out.filter((s) => s.length), { withTime: wt })); toast("GPX를 내려받았어요");
  };
  rebuild();
  window.__merge = { get items() { return items; }, get M() { return M; }, get range() { return range; }, map, setPick: (k, i) => { picking = k; setPick(i); } };
})();
