// Browser E2E for GPX point editing + road-following correction. Routing is MOCKED (no BRouter graph/JAR); see harness.mjs.
// Not part of `npm test`. Run:  PLAYWRIGHT_CORE_DIR=<dir> CHROME=<chrome.exe> node test/e2e/gpx-roadsnap.e2e.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { launch, open as openPage, road, runner, shots } from "./harness.mjs";

const STEP = 0.00009;
function gpx(n0 = 212, n1 = 212) {
  const seg = (n, lon, lat, t0) => Array.from({ length: n }, (_, i) => `<trkpt lat="${(lat + i * STEP).toFixed(6)}" lon="${lon}"><ele>${30 + i}</ele><time>${new Date(Date.UTC(2026, 10, 8, 0, 0, t0 + i * 5)).toISOString()}</time>${i % 50 === 0 ? `<extensions><qa:n>${i}</qa:n></extensions>` : ""}</trkpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="QA synthetic" xmlns="http://www.topografix.com/GPX/1/1" xmlns:qa="urn:qa"><metadata><name>QA 합성 경로</name></metadata><trk><name>QA</name><trkseg>${seg(n0, 126.97, 37.55, 0)}</trkseg><trkseg>${seg(n1, 126.99, 37.56, 5000)}</trkseg></trk></gpx>`;
}
const { step, results, finish, setDiag } = runner();
const browser = await launch();
const open = (viewport, mobile) => openPage(browser, viewport, mobile);
const S = page => page.evaluate(() => ({ ...__gpxEditorTest.snap.state(), plan: undefined, result: undefined, st: (({ segments, selected, start, history }) => ({ lens: segments.map(s => s.points.length), selected, start, history }))(__gpxEditorTest.getState()) }));
const waitState = (page, s) => page.waitForFunction(s => __gpxEditorTest.snap.state().state === s, s, { timeout: 20000 });
async function focusPoint(page, si, pi) {
  await page.evaluate(([si, pi]) => { const p = __gpxEditorTest.getState().segments[si].points[pi].c; __map.jumpTo({ center: p, zoom: 17 }); }, [si, pi]);
  await page.waitForTimeout(250);
  await page.evaluate(([si, pi]) => __gpxEditorTest.chooseVertex(si, pi), [si, pi]);
  await page.waitForTimeout(100);
}
async function drag(page, dx, dy, touch) {
  const handle = page.locator(".gpx-vertex.selected"); await handle.waitFor({ state: "visible", timeout: 5000 }); await page.waitForTimeout(50);
  let box = null; for (let i = 0; i < 20 && !box; i++) { box = await handle.boundingBox().catch(() => null); if (!box) await page.waitForTimeout(50); } // handles are re-created on render
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    const t = (type, px, py) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: px, y: py }] });
    await t("touchStart", x, y); for (let i = 1; i <= 8; i++) await t("touchMove", x + dx * i / 8, y + dy * i / 8); await t("touchEnd");
  } else { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); return { up: () => page.mouse.up() }; }
  return { up: async () => {} };
}

const { page, errors, calls, setImpl } = await open({ width: 1280, height: 860 });
const text = gpx();
await page.evaluate(t => __gpxEditor.importText(t, "qa-424.gpx"), text);
setDiag(() => S(page).then(async x => ({ ...x, status: await page.textContent("#gpxSnapStatus"), msg: await page.textContent("#gpxStatus"), calls: calls.length })));
const original = await page.evaluate(() => __gpxEditorTest.getState().segments.map(s => s.points.map(p => [...p.c, p.ref])));

await step("snap default OFF for imported GPX; plain move makes no routing request", async () => {
  assert.equal((await S(page)).on, false);
  await focusPoint(page, 0, 100); const d = await drag(page, 50, 0); await d.up(); await page.waitForTimeout(300);
  assert.equal(calls.length, 0); assert.equal((await S(page)).state, "idle");
  await page.click("#gpxUndo");
});
await step("toggle ON asks consent once; activity selector is the single visible one", async () => {
  await page.click("#gpxSnapToggle");
  const s = await S(page); assert.equal(s.on, true); assert.equal(s.consent, true);
  assert.equal(await page.locator("#mode").isHidden(), true); assert.equal(await page.locator("#gpxSnapMode").isVisible(), true);
});
await step("drag middle point: no request during drag, 2 legs on dragend, preview, only anchors sent", async () => {
  await focusPoint(page, 0, 106);
  const d = await drag(page, 60, 0); await page.waitForTimeout(200); assert.equal(calls.length, 0, "no request while dragging"); await d.up();
  await waitState(page, "preview");
  assert.equal(calls.length, 2);
  for (const c of calls) { assert.deepEqual(Object.keys(c.body).sort(), ["from", "mode", "to"]); assert.equal(c.body.mode, "walk"); assert.ok(c.body.from[0] > 120 && c.body.from[1] < 40, "[lon,lat]"); }
  assert.equal(await page.locator("#gpxSnapApply").isEnabled(), true);
  assert.equal(await page.locator("#cExport").isDisabled(), true, "export blocked while preview pending");
  const status = await page.textContent("#gpxSnapStatus"); assert.match(status, /미리보기/);
  const layers = await page.evaluate(() => ["gpx-snap-route", "gpx-snap-replaced", "gpx-snap-points"].map(id => __map.getSource(id)._data.features.length));
  assert.deepEqual(layers, [1, 1, 3]);
  if (shots) await page.screenshot({ path: path.join(shots, "desktop-preview.png") });
});
await step("apply replaces only the range; other trkseg and outside points identical; one undo restores", async () => {
  const plan = await page.evaluate(() => __gpxEditorTest.snap.state().plan);
  await page.click("#gpxSnapApply"); await waitState(page, "applied");
  const now = await page.evaluate(() => __gpxEditorTest.getState().segments.map(s => s.points.map(p => [...p.c, p.ref])));
  assert.equal(now.length, 2); assert.deepEqual(now[1], original[1]);
  assert.deepEqual(now[0].slice(0, plan.left + 1), original[0].slice(0, plan.left + 1));
  const tail = original[0].slice(plan.right); assert.deepEqual(now[0].slice(-tail.length), tail);
  if (shots) await page.screenshot({ path: path.join(shots, "desktop-applied.png") });
  await page.click("#gpxUndo");
  const back = await page.evaluate(() => __gpxEditorTest.getState().segments.map(s => s.points.map(p => [...p.c, p.ref])));
  assert.deepEqual(back, original, "single undo restores move + correction");
});
await step("activity change re-routes only the pending range with the new mode; cancel keeps the move", async () => {
  calls.length = 0; await focusPoint(page, 0, 60); await (await drag(page, 40, 10)).up(); await waitState(page, "preview");
  await page.click('#gpxSnapMode button[data-v="bike"]'); await waitState(page, "preview");
  assert.deepEqual(calls.map(c => c.body.mode), ["walk", "walk", "bike", "bike"]);
  const hist = (await S(page)).st.history;
  await page.click("#gpxSnapCancel"); assert.equal((await S(page)).state, "idle"); assert.equal((await S(page)).st.history, hist, "move kept");
  await page.click("#gpxUndo"); await page.click('#gpxSnapMode button[data-v="walk"]');
});
await step("P snapped to different roads -> error, no fake link, inline retry", async () => {
  setImpl(async (b, n) => ({ status: 200, body: { coordinates: n % 2 === 0 ? road([b.from[0] + 0.0003, b.from[1]], b.to) : road(b.from, b.to) } }));
  calls.length = 0; await focusPoint(page, 0, 150); await (await drag(page, 30, 0)).up(); await waitState(page, "error");
  assert.match(await page.textContent("#gpxSnapStatus"), /다른 도로에 연결/);
  assert.equal(await page.locator("#gpxSnapRetry").isEnabled(), true);
  const lens = (await S(page)).st.lens; assert.deepEqual(lens, [212, 212], "model unchanged except the move");
  setImpl(async b => ({ status: 200, body: { coordinates: road(b.from, b.to) } }));
  const before = calls.length; await page.click("#gpxSnapRetry"); await waitState(page, "error");
  assert.equal(calls.length, before, "valid legs are cached; same anchors give the same (deterministic) result");
  await page.selectOption("#gpxSnapWindow", "100"); await waitState(page, "preview"); assert.ok(calls.length > before, "other anchors are requested again");
  await page.selectOption("#gpxSnapWindow", "180"); await page.click("#gpxUndo");
  assert.equal((await S(page)).state, "idle");
});
await step("503 retried; network failure ends in error state (no endless spinner)", async () => {
  let n503 = 0; setImpl(async (b) => (n503++ < 1 ? { status: 503, body: { error: "busy" } } : { status: 200, body: { coordinates: road(b.from, b.to, 0.0004) } }));
  await focusPoint(page, 0, 40); await (await drag(page, 25, 0)).up(); await waitState(page, "preview"); await page.click("#gpxUndo");
  setImpl(async () => "abort"); await focusPoint(page, 0, 40); await (await drag(page, 35, 5)).up(); await waitState(page, "error");
  assert.match(await page.textContent("#gpxSnapStatus"), /연결하지 못했습니다/); await page.click("#gpxUndo");
  setImpl(async () => ({ status: 400, body: { error: "지점 간격은 30km 이내로 나누어 주세요." } }));
  await focusPoint(page, 0, 40); await (await drag(page, 45, -5)).up(); await waitState(page, "error");
  assert.match(await page.textContent("#gpxSnapStatus"), /30km/); await page.click("#gpxUndo");
  setImpl(async b => ({ status: 200, body: { coordinates: road(b.from, b.to) } }));
});
await step("rapid consecutive drags: stale response never overwrites the latest edit", async () => {
  let second = false; setImpl(async b => { const stale = !second; if (stale) await new Promise(r => setTimeout(r, 700)); return { status: 200, body: { coordinates: road(b.from, b.to, stale ? 0.002 : 0.0003) } }; });
  await focusPoint(page, 0, 120); await (await drag(page, 30, 0)).up(); await page.waitForTimeout(80); second = true;
  await focusPoint(page, 0, 120); await (await drag(page, 60, 0)).up(); await waitState(page, "preview"); await page.waitForTimeout(900);
  const r = await page.evaluate(() => __gpxEditorTest.snap.state().result.coordinates);
  assert.ok(r.every(c => Math.abs(c[0] - 126.97) < 0.0015), "result from the latest drag only");
  assert.equal((await S(page)).state, "preview");
  await page.click("#gpxUndo"); await page.click("#gpxUndo");
  setImpl(async b => ({ status: 200, body: { coordinates: road(b.from, b.to) } }));
});
await step("add point with snap ON routes around the inserted point; delete makes no request", async () => {
  calls.length = 0; await focusPoint(page, 0, 30);
  await page.evaluate(() => __map.jumpTo({ zoom: 19.5 })); await page.waitForTimeout(400);
  await page.locator(".gpx-midpoint").last().click(); await waitState(page, "preview"); assert.equal(calls.length, 2);
  await page.click("#gpxSnapApply"); await page.click("#gpxUndo");
  calls.length = 0; await focusPoint(page, 0, 10); await page.click("#gpxDeletePoint"); assert.equal(calls.length, 0);
  assert.equal((await S(page)).st.lens[0], 211); await page.click("#gpxUndo");
});
await step("export -> re-import keeps trkseg count, untouched time/extensions, no fake time on new points; save/restore", async () => {
  await focusPoint(page, 0, 106); await (await drag(page, 60, 0)).up(); await waitState(page, "preview"); await page.click("#gpxSnapApply");
  const info = await page.evaluate(t => {
    const M = GildamGpxModel, st = __gpxEditorTest.getState(), source = M.parse(t, "qa.gpx");
    const xml = M.exportGpx(source, st.segments, { stripTimes: false }), re = M.parse(xml, "re.gpx"), doc = re.doc;
    const pts = [...doc.getElementsByTagNameNS("*", "trkpt")];
    return { segs: re.segments.length, lens: re.segments.map(s => s.points.length), withTime: pts.filter(p => p.getElementsByTagNameNS("*", "time").length).length, ext: doc.getElementsByTagNameNS("urn:qa", "n").length, orig: st.segments.flatMap(s => s.points).filter(p => p.ref !== undefined).length, total: st.segments.reduce((n, s) => n + s.points.length, 0), stripped: M.exportGpx(source, st.segments, { stripTimes: true }).includes("<time>") };
  }, text);
  assert.equal(info.segs, 2); assert.equal(info.withTime, info.orig, "only original points carry time"); assert.ok(info.ext >= 8); assert.equal(info.lens.reduce((a, b) => a + b), info.total); assert.equal(info.stripped, false);
  await page.fill("#cName", "QA 보정본"); await page.click("#cSave");
  const restored = await page.evaluate(async () => { const before = __gpxEditorTest.getState().segments.map(s => s.points.map(p => p.c.slice(0, 2))); const item = JSON.parse(localStorage.getItem("gildam.courses.v1"))[0]; __gpxEditor.restore(item); const after = __gpxEditorTest.getState().segments.map(s => s.points.map(p => p.c.slice(0, 2))); return JSON.stringify(before) === JSON.stringify(after); });
  assert.equal(restored, true);
  assert.equal((await S(page)).on, false, "restore starts with snap OFF again");
});
await step("existing selected-section route preview still splits into its own segment", async () => {
  calls.length = 0;
  await page.evaluate(() => { document.getElementById("gpxAdvanced").open = true; }); await page.fill("#gpxStart", "10"); await page.dispatchEvent("#gpxStart", "change"); await page.fill("#gpxEnd", "30"); await page.dispatchEvent("#gpxEnd", "change");
  const segsBefore = (await S(page)).st.lens.length; await page.click("#gpxRoute"); await page.waitForFunction(() => __gpxEditorTest.getState().preview);
  await page.click("#gpxApply"); assert.equal((await S(page)).st.lens.length, segsBefore + 2); assert.equal(calls.length, 1);
});
await step("point editing: card, keyboard nav, Shift range, Delete, undo/redo, context menu, line-click insert, split", async () => {
  await page.evaluate(t => __gpxEditor.importText(t, "qa-424.gpx"), text);
  assert.equal((await S(page)).on, false, "snap OFF for a newly opened GPX");
  const lens0 = (await S(page)).st.lens;
  await focusPoint(page, 0, 50);
  assert.match(await page.textContent("#gpxPointCard"), /51번 점/); assert.match(await page.textContent("#gpxPointLabel"), /51 \//);
  await page.locator("#map canvas").first().focus().catch(() => {}); await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight"); assert.equal((await S(page)).st.start, 52);
  await page.keyboard.press("ArrowLeft"); assert.equal((await S(page)).st.start, 51);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  let g = await page.evaluate(() => __gpxEditorTest.getState()); assert.equal(g.rangeReady, true); assert.equal(g.end - g.start, 4);
  assert.match(await page.textContent("#gpxPointCard"), /52~56번 점/);
  await page.keyboard.press("Delete"); assert.equal((await S(page)).st.lens.length, lens0.length + 1, "range delete splits");
  await page.keyboard.press("Control+z"); assert.deepEqual((await S(page)).st.lens, lens0);
  await page.keyboard.press("Control+Shift+Z"); assert.equal((await S(page)).st.lens.length, lens0.length + 1, "redo");
  await page.click("#gpxUndo"); assert.equal(await page.locator("#gpxRedo").isEnabled(), true);
  await focusPoint(page, 0, 80);
  const v = await page.locator(".gpx-vertex.selected").boundingBox(); await page.mouse.click(v.x + 12, v.y + 12, { button: "right" });
  await page.locator('.gpx-menu button[data-a="delete"]').click(); assert.equal((await S(page)).st.lens[0], lens0[0] - 1); await page.click("#gpxUndo");
  await page.evaluate(() => __map.jumpTo({ center: __gpxEditorTest.getState().segments[0].points[90].c, zoom: 20 })); await page.waitForTimeout(400);
  const mid = await page.evaluate(() => { const P = __gpxEditorTest.getState().segments[0].points, a = __map.project(P[90].c), b = __map.project(P[91].c); return [(a.x + b.x) / 2, (a.y + b.y) / 2]; });
  const mb = await page.locator("#map").boundingBox(); await page.mouse.move(mb.x + mid[0] + 2, mb.y + mid[1] + 1); await page.waitForTimeout(250);
  assert.equal(await page.locator(".gpx-ghost").count(), 1, "hover shows insert ghost");
  await page.mouse.click(mb.x + mid[0] + 2, mb.y + mid[1] + 1);
  g = await page.evaluate(() => __gpxEditorTest.getState()); assert.equal(g.segments[0].points.length, lens0[0] + 1); assert.equal(g.start, 91); assert.equal(g.segments[0].points[91].ref, undefined);
  await page.click("#gpxUndo");
  await focusPoint(page, 0, 120); await page.click('#gpxPointCard button[data-a="split"]');
  g = await page.evaluate(() => __gpxEditorTest.getState()); assert.equal(g.segments.length, lens0.length + 1); assert.equal(g.selected, 1); assert.equal(g.segments[0].points.at(-1), g.segments[1].points[0]);
  await page.click("#gpxUndo"); await page.click("#gpxAddPoint"); assert.equal((await S(page)).st.lens[0], lens0[0] + 1); await page.click("#gpxUndo");
  if (shots) await page.screenshot({ path: path.join(shots, "desktop-pointedit.png") });
});
await step("viewport handle cap on a 20,000-point GPX", async () => {
  const t0 = Date.now(); await page.evaluate(t => __gpxEditor.importText(t, "big.gpx"), gpx(10000, 10000));
  await page.evaluate(() => __map.jumpTo({ center: __gpxEditorTest.getState().segments[0].points[5000].c, zoom: 15 })); await page.waitForTimeout(400);
  const n = await page.locator(".gpx-vertex").count(); assert.ok(n > 0 && n <= 240, "handles " + n);
  results.push(["INFO", "20k import+render ms", String(Date.now() - t0)]);
});
await step("new course (route mode) still works", async () => {
  calls.length = 0; await page.click("#editNew");
  const box = await page.locator("#map").boundingBox();
  await page.evaluate(() => __map.jumpTo({ center: [126.97, 37.55], zoom: 15 })); await page.waitForTimeout(200);
  await page.mouse.click(box.x + 700, box.y + 400); await page.mouse.click(box.x + 800, box.y + 450); await page.waitForTimeout(800);
  assert.equal(calls.length, 1); assert.equal(await page.locator("#mode").isVisible(), true);
});
await step("no page errors (desktop)", async () => { assert.deepEqual(errors.filter(e => !/pmtiles|Failed to fetch|NetworkError|sprite|glyph/i.test(e)), []); });

const m = await open({ width: 390, height: 844 }, true);
setDiag(() => S(m.page).then(async x => ({ ...x, calls: m.calls.length, toggle: await m.page.getAttribute("#gpxSnapToggle", "aria-checked"), sel: await m.page.locator(".gpx-vertex.selected").count(), at: await m.page.evaluate(() => { const b = document.querySelector(".gpx-vertex.selected")?.getBoundingClientRect(); if (!b) return null; const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e.className + "#" + e.id; }) })));
await step("mobile: touch drag + toggle/mode tap", async () => {
  await m.page.evaluate(t => __gpxEditor.importText(t, "qa-424.gpx"), text);
  await focusPoint(m.page, 0, 60); await m.page.tap("#gpxRangeArm"); await m.page.evaluate(() => __gpxEditorTest.chooseVertex(0, 66));
  const g = await m.page.evaluate(() => __gpxEditorTest.getState()); assert.equal(g.rangeReady, true); assert.equal(g.end - g.start, 6);
  await m.page.tap('#gpxPointCard button[data-a="clear"]');
  assert.equal(await m.page.locator("#layers").isVisible(), false, "map settings collapsed on mobile"); await m.page.tap("#layersBtn"); assert.equal(await m.page.locator("#layers").isVisible(), true); await m.page.tap("#layersBtn");
  await m.page.tap("#gpxSnapToggle"); await m.page.tap('#gpxSnapMode button[data-v="hike"]');
  await focusPoint(m.page, 0, 106);
  await m.page.evaluate(() => document.getElementById("panel").classList.add("min"));
  await drag(m.page, 40, 0, true); await waitState(m.page, "preview");
  assert.deepEqual(m.calls.map(c => c.body.mode), ["hike", "hike"]);
  await m.page.evaluate(() => document.getElementById("panel").classList.remove("min"));
  await m.page.locator("#gpxSnapBox").scrollIntoViewIfNeeded();
  if (shots) await m.page.screenshot({ path: path.join(shots, "mobile-preview.png") });
  const w = await m.page.evaluate(() => { const b = document.getElementById("gpxSnapBox"); return b.scrollWidth <= b.clientWidth + 1; }); assert.ok(w, "snap box has no horizontal overflow");
});
await step("no page errors (mobile)", async () => { assert.deepEqual(m.errors.filter(e => !/pmtiles|Failed to fetch|NetworkError|sprite|glyph/i.test(e)), []); });
await browser.close();
finish();
