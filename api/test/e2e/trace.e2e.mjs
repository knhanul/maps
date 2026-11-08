// Browser E2E for 이미지로 GPX 만들기 with a synthetic route-map image (blue route with arrow icons/labels, pale river, green line).
// Routing is MOCKED. Run: PLAYWRIGHT_CORE_DIR=<dir> CHROME=<chrome.exe> node test/e2e/trace.e2e.mjs
import assert from "node:assert/strict";
import { launch, open, runner, shot, road, benign } from "./harness.mjs";

const { step, finish, setDiag } = runner();
const browser = await launch();
const { page, errors, calls, setImpl } = await open(browser, { width: 1366, height: 900 });
setDiag(() => page.evaluate(() => ({ status: document.getElementById("traceStatus").textContent, mode: __traceTest.state?.mode, T: __traceTest.state?.T })));

// Route in image pixels (900×560). Arrow icons (white squares) and a label sit on the line; a pale river and a green line cross it.
const ROUTE = [[80, 480], [140, 330], [120, 200], [260, 120], [420, 90], [520, 160], [640, 70], [780, 120], [820, 300], [700, 380], [760, 470]];
await page.evaluate(async route => {
  const c = document.createElement("canvas"); c.width = 900; c.height = 560; const g = c.getContext("2d");
  g.fillStyle = "#e8eee3"; g.fillRect(0, 0, 900, 560);
  g.strokeStyle = "#a9cde8"; g.lineWidth = 14; g.beginPath(); g.moveTo(0, 260); g.bezierCurveTo(300, 180, 500, 420, 900, 240); g.stroke();
  g.strokeStyle = "#c9c9c9"; g.lineWidth = 3; for (let i = 0; i < 12; i++) { g.beginPath(); g.moveTo(i * 80, 0); g.lineTo(i * 80 + 120, 560); g.stroke(); }
  g.strokeStyle = "#3aa64a"; g.lineWidth = 4; g.beginPath(); g.moveTo(200, 540); g.lineTo(330, 300); g.lineTo(140, 220); g.stroke();
  g.strokeStyle = "#2a5bd7"; g.lineWidth = 5; g.lineJoin = g.lineCap = "round"; g.beginPath(); route.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  for (const [x, y] of [[133, 260], [340, 105], [580, 115], [800, 210]]) { g.fillStyle = "#fff"; g.fillRect(x - 7, y - 7, 14, 14); g.fillStyle = "#2a5bd7"; g.fillRect(x - 3, y - 3, 6, 6); }
  g.font = "bold 18px sans-serif"; g.fillStyle = "#14366e"; g.fillText("청마대교", 735, 300);
  const blob = await new Promise(r => c.toBlob(r, "image/png")); window.__qaFile = new File([blob], "향수100리길.png", { type: "image/png" });
}, ROUTE);

// Ground truth: image placed over Okcheon area, ~30 km wide, rotated 0.08 rad.
const truth = await page.evaluate(() => { const tl = maplibregl.MercatorCoordinate.fromLngLat([127.55, 36.42]), tr = maplibregl.MercatorCoordinate.fromLngLat([127.88, 36.42]), s = (tr.x - tl.x) / 900, r = 0.08; return { a: s * Math.cos(r), b: s * Math.sin(r), tx: tl.x, ty: tl.y }; });
const pxToLL = (T, u, v) => page.evaluate(([T, u, v]) => { const l = new maplibregl.MercatorCoordinate(T.a * u - T.b * v + T.tx, T.b * u + T.a * v + T.ty).toLngLat(); return [l.lng, l.lat]; }, [T, u, v]);
async function clickLL(ll) { const box = await page.locator("#map").boundingBox(); const p = await page.evaluate(ll => { const q = __map.project(ll); return [q.x, q.y]; }, ll); await page.mouse.click(box.x + p[0], box.y + p[1]); await page.waitForTimeout(120); }
const truthLL = await Promise.all(ROUTE.map(([u, v]) => pxToLL(truth, u + 0.5, v + 0.5)));

await step("load image: overlay shown at current view, steps appear, nothing uploaded", async () => {
  const center = await pxToLL(truth, 450, 280); await page.evaluate(c => __map.jumpTo({ center: c, zoom: 10.5, padding: { left: 400, top: 40, right: 260, bottom: 40 } }), center);
  await page.click('.tab[data-tab="course"]');
  const before = calls.length; await page.evaluate(() => __traceTest.loadFile(window.__qaFile));
  assert.equal(await page.evaluate(() => !!__map.getLayer("trace-img")), true);
  assert.equal(await page.locator("#traceAlign").isVisible(), true); assert.equal(await page.locator(".trace-handle").count(), 2);
  assert.equal(calls.length, before);
  const left = await page.evaluate(() => { const c = __traceTest.state; const l = new maplibregl.MercatorCoordinate(c.T.tx, c.T.ty).toLngLat(); return __map.project(l).x; });
  assert.ok(left > 360, "new overlay starts right of the side panel: " + Math.round(left));
  await shot(page, "trace-1-loaded.png");
});
await step("align with two control-point pairs via real map clicks (scale + rotation solved)", async () => {
  for (const [u, v] of [[80, 480], [780, 120]]) {
    await page.click("#tracePair");
    const T = await page.evaluate(() => __traceTest.state.T); await clickLL(await pxToLL(T, u, v));
    assert.equal(await page.evaluate(() => __traceTest.state.mode), "pairMap");
    await clickLL(await pxToLL(truth, u, v));
  }
  const st = await page.evaluate(() => ({ T: __traceTest.state.T, n: __traceTest.state.pairs.length, txt: document.getElementById("traceStatus").textContent }));
  assert.equal(st.n, 2); assert.match(st.txt, /기준점 2곳으로 맞췄습니다/);
  const errM = await page.evaluate(([A, B]) => { let mx = 0; for (const [u, v] of [[0, 0], [900, 0], [900, 560], [0, 560]]) { const p = [A.a * u - A.b * v + A.tx, A.b * u + A.a * v + A.ty], q = [B.a * u - B.b * v + B.tx, B.b * u + B.a * v + B.ty]; mx = Math.max(mx, Math.hypot(p[0] - q[0], p[1] - q[1]) / maplibregl.MercatorCoordinate.fromLngLat([127.7, 36.4]).meterInMercatorCoordinateUnits()); } return mx; }, [st.T, truth]);
  assert.ok(errM < 250, "corner error " + Math.round(errM) + " m (screen-click rounding at zoom 10.6)");
  await page.evaluate(t => __traceTest.setTransform(t), truth); // exact for the rest of the run
  await shot(page, "trace-2-aligned.png");
});
await step("pick the blue line colour by clicking near it; mask excludes river and green line", async () => {
  await page.click("#tracePick"); await clickLL(await pxToLL(truth, 470, 128));
  const s = await page.evaluate(() => ({ c: __traceTest.state.color, n: __traceTest.state.maskInfo.count, m: __traceTest.state.maskInfo.mask, w: 900, mode: __traceTest.state.mode }));
  assert.ok(s.c[2] > 180 && s.c[0] < 90, "blue picked " + s.c);
  const at = await page.evaluate(() => { const M = __traceTest.state.maskInfo; return { river: M.mask[262 * 900 + 30], green: M.mask[300 * 900 + 330], line: M.mask[90 * 900 + 420] }; });
  assert.deepEqual(at, { river: 0, green: 0, line: 1 }); assert.equal(s.mode, "A", "next step asks for A");
});
await step("A/B by clicking, extract follows the blue line through icons/label gaps", async () => {
  await clickLL(truthLL[0]); await clickLL(truthLL.at(-1));
  await page.click("#traceExtract"); await page.waitForFunction(() => __traceTest.state.result, null, { timeout: 15000 });
  const r = await page.evaluate(() => __traceTest.state.result);
  const dev = await page.evaluate(([res, tr]) => GildamTraceModel.deviation(res, tr), [r.coords, truthLL]);
  const truthLen = await page.evaluate(tr => GildamTraceModel.length(tr), truthLL);
  assert.ok(dev < 120, "max distance from drawn route " + Math.round(dev) + " m (1px≈33m)");
  assert.ok(Math.abs(r.length - truthLen) / truthLen < 0.06, `length ${Math.round(r.length)} vs ${Math.round(truthLen)}`);
  assert.ok(r.bridgeMaxM > 0 && r.bridgeMaxM < 800, "icon gaps bridged " + Math.round(r.bridgeMaxM));
  assert.match(await page.textContent("#traceStatus"), /추출 완료/);
  await shot(page, "trace-3-extracted.png");
});
await step("via point re-extraction keeps the route on the line", async () => {
  await page.click("#traceAddVia"); await clickLL(await pxToLL(truth, 520, 160));
  assert.equal(await page.evaluate(() => __traceTest.state.vias.length), 1);
  await page.click("#traceExtract"); await page.waitForFunction(() => __traceTest.state.result);
  const r = await page.evaluate(() => __traceTest.state.result);
  assert.ok(await page.evaluate(([res, tr]) => GildamTraceModel.deviation(res, tr), [r.coords, truthLL]) < 120);
});
await step("optional road snap: bike mode, sampled waypoints only, sequential legs, deviation warning", async () => {
  // Mock "road" = the traced line between the two waypoints (+3 m offset), like a router following the drawn road.
  const trace = await page.evaluate(() => __traceTest.state.result.coords);
  const near = p => trace.reduce((bi, c, i) => Math.hypot(c[0] - p[0], c[1] - p[1]) < Math.hypot(trace[bi][0] - p[0], trace[bi][1] - p[1]) ? i : bi, 0);
  const follow = (b, off = 0.00003) => { const i = near(b.from), j = near(b.to); const mid = trace.slice(Math.min(i, j) + 1, Math.max(i, j)).map(c => [c[0] + off, c[1]]); return [b.from, ...(i < j ? mid : mid.reverse()), b.to]; };
  setImpl(async b => ({ status: 200, body: { coordinates: follow(b) } }));
  calls.length = 0; await page.selectOption("#traceMode", "bike"); await page.click("#traceSnap");
  await page.waitForFunction(() => __traceTest.state.snapped, null, { timeout: 20000 });
  const s = await page.evaluate(() => ({ parts: __traceTest.state.snapped.parts.length, warn: __traceTest.state.snapped.warn.length }));
  assert.ok(calls.length >= 15 && calls.every(c => c.body.mode === "bike" && Object.keys(c.body).sort().join() === "from,mode,to"), "legs " + calls.length);
  assert.ok(calls.every((c, i) => !i || (c.body.from[0] === calls[i - 1].body.to[0] && c.body.from[1] === calls[i - 1].body.to[1])), "chained waypoints");
  assert.deepEqual(s, { parts: 1, warn: 0 });
  await shot(page, "trace-4-snapped.png");
  let n = 0; setImpl(async b => ({ status: 200, body: { coordinates: ++n === 3 ? road(b.from, b.to, 0.02) : follow(b) } }));
  await page.selectOption("#traceMode", "walk"); await page.click("#traceSnap"); await page.waitForFunction(() => __traceTest.state.snapped?.mode === "walk", null, { timeout: 20000 });
  assert.equal(await page.evaluate(() => __traceTest.state.snapped.warn.length), 1); assert.match(await page.textContent("#traceStatus"), /150m 넘게 다른 길/);
  setImpl(async b => ({ status: 200, body: { coordinates: follow(b) } }));
  await page.selectOption("#traceMode", "bike"); await page.click("#traceSnap"); await page.waitForFunction(() => __traceTest.state.snapped?.mode === "bike");
});
await step("open in GPX editor: point editing works, overlay stays for comparison, close removes it", async () => {
  await page.fill("#traceName", "향수100리길 QA"); await page.click("#traceOpen");
  await page.waitForFunction(() => __gpxEditorTest.getState().active);
  const g = await page.evaluate(() => ({ segs: __gpxEditorTest.getState().segments.length, n: __gpxEditorTest.getState().segments[0].points.length, name: document.getElementById("cName").value, locked: __traceTest.state.locked }));
  assert.equal(g.segs, 1); assert.ok(g.n > 30); assert.equal(g.name, "향수100리길 QA"); assert.equal(g.locked, true);
  assert.equal(await page.locator(".trace-handle").count(), 0); assert.equal(await page.evaluate(() => !!__map.getLayer("trace-img")), true);
  assert.equal(await page.locator("#tracePoints").isVisible(), false, "trace steps collapsed after opening");
  await page.evaluate(() => { const p = __gpxEditorTest.getState().segments[0].points[10].c; __map.jumpTo({ center: p, zoom: 16 }); }); await page.waitForTimeout(300);
  await page.evaluate(() => __gpxEditorTest.chooseVertex(0, 10)); assert.match(await page.textContent("#gpxPointCard"), /11번 점/);
  await shot(page, "trace-5-editor.png");
  await page.click("#traceClose"); assert.equal(await page.evaluate(() => !!__map.getLayer("trace-img")), false);
  assert.equal(await page.evaluate(() => __gpxEditorTest.getState().active), true, "editor content kept");
});
await step("download produces a valid GPX", async () => {
  await page.evaluate(c => __map.jumpTo({ center: c, zoom: 10.5, padding: { left: 400, top: 40, right: 260, bottom: 40 } }), await pxToLL(truth, 450, 280));
  await page.evaluate(() => __traceTest.loadFile(window.__qaFile)); await page.evaluate(t => __traceTest.setTransform(t), truth);
  await page.click("#tracePick"); await clickLL(await pxToLL(truth, 470, 128)); await clickLL(truthLL[0]); await clickLL(truthLL.at(-1));
  await page.click("#traceExtract"); await page.waitForFunction(() => __traceTest.state.result);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#traceDownload")]);
  const text = await (await dl.createReadStream()).toArray().then(b => Buffer.concat(b).toString("utf8"));
  assert.match(dl.suggestedFilename(), /향수100리길 QA\.gpx$/, "uses the course name field"); assert.match(text, /<trkseg>/);
  assert.equal(await page.evaluate(t => GildamGpxModel.parse(t, "x.gpx").segments.length, text), 1);
});
await step("no page errors (desktop)", async () => assert.deepEqual(errors.filter(benign), []));

const m = await open(browser, { width: 390, height: 844 }, true);
await step("mobile: trace panel fits, no horizontal overflow", async () => {
  await m.page.tap('.tab[data-tab="course"]');
  await m.page.evaluate(async () => { const c = document.createElement("canvas"); c.width = 400; c.height = 300; const g = c.getContext("2d"); g.fillStyle = "#eee"; g.fillRect(0, 0, 400, 300); g.strokeStyle = "#2a5bd7"; g.lineWidth = 5; g.beginPath(); g.moveTo(20, 280); g.lineTo(380, 20); g.stroke(); await __traceTest.loadFile(new File([await new Promise(r => c.toBlob(r))], "m.png", { type: "image/png" })); });
  const ok = await m.page.evaluate(() => { const p = document.getElementById("panel"); return p.scrollWidth <= p.clientWidth + 1; }); assert.ok(ok);
  await m.page.locator("#traceAlign").scrollIntoViewIfNeeded(); await shot(m.page, "trace-mobile.png");
});
await step("no page errors (mobile)", async () => assert.deepEqual(m.errors.filter(benign), []));
await browser.close();
finish();
