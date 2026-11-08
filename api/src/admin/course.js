"use strict";
(async () => {
  const { $, km, toast } = G;
  let pts = [], undo = [], redo = [], markers = [], prof = null, seq = 0, speed = 3;
  const snap = () => { undo.push(JSON.stringify(pts)); if (undo.length > 200) undo.shift(); redo = []; };
  const map = await G.makeMap($("#map"), { center: [128.465, 38.12], zoom: 12, onOverlay: (m) => addOverlay(m) });
  function addOverlay(m) {
    if (m.getSource("course")) return;
    m.addSource("course", { type: "geojson", data: G.fc([]) });
    m.addLayer({ id: "course-casing", type: "line", source: "course", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": 8 } });
    m.addLayer({ id: "course", type: "line", source: "course", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#F2552C", "line-width": 4 } });
    m.addSource("hov", { type: "geojson", data: G.fc([]) });
    m.addLayer({ id: "hov", type: "circle", source: "hov", paint: { "circle-radius": 7, "circle-color": "#FFB400", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
    draw();
  }
  addOverlay(map);
  map.getCanvas().style.cursor = "crosshair";
  map.on("click", (e) => { snap(); pts.push([e.lngLat.lng, e.lngLat.lat, null]); render(); });

  const ch = G.chart($("#ch"), { onHover: (d) => {
    if (!prof || d == null) return map.getSource("hov")?.setData(G.fc([]));
    let b = prof.D[0]; for (const x of prof.D) if (Math.abs(x.d - d) < Math.abs(b.d - d)) b = x;
    map.getSource("hov")?.setData(G.fc([{ type: "Feature", geometry: { type: "Point", coordinates: b.p } }]));
  } });

  function line() { return pts.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: pts.map((p) => [p[0], p[1]]) } }] : []; }
  function draw() { map.getSource("course")?.setData(G.fc(line())); }
  function render() {
    draw();
    markers.forEach((m) => m.remove()); markers = [];
    pts.forEach((p, i) => {
      const el = document.createElement("div"); el.className = "pt" + (i === 0 ? " first" : i === pts.length - 1 ? " last" : ""); el.title = `${i + 1}번 점 — 누르면 삭제`;
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p[0], p[1]]).addTo(map);
      let moved = false, lp = null;
      m.on("dragstart", () => { moved = true; snap(); clearTimeout(lp); });
      m.on("drag", () => { const l = m.getLngLat(); pts[i] = [l.lng, l.lat, null]; draw(); });
      m.on("dragend", () => { setTimeout(() => (moved = false), 50); render(); });
      const del = () => { snap(); pts.splice(i, 1); render(); toast(`${i + 1}번 점을 지웠어요`); };
      el.addEventListener("click", (e) => { e.stopPropagation(); if (!moved && !(e.pointerType === "touch")) del(); });
      el.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); del(); });
      el.addEventListener("touchstart", () => { lp = setTimeout(() => { if (!moved) del(); }, 600); }, { passive: true });
      el.addEventListener("touchend", () => clearTimeout(lp));
      markers.push(m);
    });
    stats(); profile();
  }
  function stats() {
    const C = G.cum(pts), d = C.at(-1) || 0, gl = prof || { gain: null, loss: null };
    const t = d / 1000 / speed * 3600 + (gl.gain || 0) / 100 * (speed >= 15 ? 300 : 600);
    const hm = (s) => { s = Math.round(s / 60); return s >= 60 ? `${Math.floor(s / 60)}시간 ${s % 60}분` : `${s}분`; };
    $("#st").innerHTML = `<div><small>거리 · 점 ${pts.length}개</small><b>${km(d)}</b></div><div><small>오르막 / 내리막</small><b>${gl.gain != null ? `${Math.round(gl.gain)} / ${Math.round(gl.loss)} m` : "–"}</b></div><div><small>예상 시간</small><b>${pts.length > 1 ? hm(t) : "–"}</b></div>`;
    $("#undo").disabled = !undo.length; $("#redo").disabled = !redo.length;
  }
  let pt;
  function profile() { clearTimeout(pt); pt = setTimeout(async () => {
    const my = ++seq; if (pts.length < 2) { prof = null; ch.set([]); stats(); return; }
    const D = G.densify(pts); const E = await G.elevMany(D.map((x) => x.p)); if (my !== seq) return;
    D.forEach((x, i) => (x.e = E[i]));
    const VE = await G.elevMany(pts); if (my !== seq) return; pts.forEach((p, i) => (p[2] = VE[i]));
    const gl = G.gainLoss(E); prof = { D, ...gl };
    ch.set(D); stats();
    if (!G.dem) $("#demHint").textContent = "⚠️ 지형 데이터(terrain_url)가 없어 표고를 못 읽어요.";
  }, 200); }

  $("#undo").onclick = () => { if (!undo.length) return; redo.push(JSON.stringify(pts)); pts = JSON.parse(undo.pop()); render(); };
  $("#redo").onclick = () => { if (!redo.length) return; undo.push(JSON.stringify(pts)); pts = JSON.parse(redo.pop()); render(); };
  $("#clear").onclick = () => { if (!pts.length) return; snap(); pts = []; render(); };
  $("#loop").onclick = () => { if (pts.length < 2) return toast("점이 2개 이상 필요해요"); snap(); pts.push([...pts[0]]); render(); };
  $("#rev").onclick = () => { if (pts.length < 2) return; snap(); pts.reverse(); render(); };
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); (e.shiftKey ? $("#redo") : $("#undo")).click(); } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); $("#redo").click(); } });
  $("#spd").querySelectorAll("button").forEach((b) => b.onclick = () => { speed = +b.dataset.v; $("#spd").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); stats(); });
  $("#exp").onclick = async () => {
    if (pts.length < 2) return toast("점이 2개 이상 필요해요");
    await new Promise((r) => setTimeout(r, 260)); // 표고 계산 대기
    let out = $("#dense").checked && prof ? prof.D.map((x) => [x.p[0], x.p[1], x.e, null]) : pts.map((p) => [p[0], p[1], p[2], null]);
    if ($("#wt").checked) { const C = G.cum(out), t0 = Date.now(); out = out.map((p, i) => [p[0], p[1], p[2], t0 + C[i] / (speed / 3.6) * 1000]); }
    const name = $("#nm").value.trim() || `길담 코스 ${new Date().toLocaleDateString("ko-KR")}`;
    G.download(name, G.toGpx(name, [out], { withTime: $("#wt").checked })); toast("GPX를 내려받았어요");
  };
  $("#imp").onchange = async (e) => {
    const [g] = await G.readFiles([...e.target.files]); e.target.value = ""; if (!g) return;
    let all = g.segs.flat(); if (all.length > 500) { const st = (all.length - 1) / 499; all = Array.from({ length: 500 }, (_, i) => all[Math.round(i * st)]); }
    snap(); pts = all.map((p) => [p[0], p[1], null]); $("#nm").value = g.name; render();
    const b = pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.max(a[2], p[0]), Math.max(a[3], p[1])], [180, 90, -180, -90]);
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60 });
  };
  render();
  window.__course = { get pts() { return pts; }, get prof() { return prof; }, map };
})();
