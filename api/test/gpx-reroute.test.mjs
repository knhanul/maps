// Road-following correction model tests (pure functions in web/public/gpx-model.js; routing responses are mocked).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const ctx = { setTimeout, clearTimeout, AbortController, console };
ctx.globalThis = ctx;
runInNewContext(readFileSync(new URL("../web/public/gpx-model.js", import.meta.url), "utf8"), ctx);
const M = ctx.GildamGpxModel;
const { REROUTE } = M;
const plain = v => JSON.parse(JSON.stringify(v)); // values created inside the vm realm

const STEP = 0.00009; // ~10 m of latitude
const line = (n, lon = 127, lat = 37.5, ref0 = 0) => Array.from({ length: n }, (_, i) => ({ c: [lon, lat + i * STEP, 40 + i], ref: ref0 + i }));
// Mock BRouter: snapped endpoints == request, detour via a point offset east, elevation included like the real proxy.
const roadBetween = (a, b, off = 0.0003) => [[a[0], a[1], 10], [(a[0] + b[0]) / 2 + off, (a[1] + b[1]) / 2, 11], [b[0], b[1], 12]];
const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function mockFetch(handler) {
  const calls = [];
  const f = async (url, init) => { const body = JSON.parse(init.body); calls.push({ url, body, signal: init.signal }); return handler(body, calls.length, init); };
  f.calls = calls; return f;
}
const ok = mockFetch(b => json(200, { coordinates: roadBetween(b.from, b.to) }));
const noSleep = async () => {};

test("anchors are chosen by along-path distance, not just P±1, and stay in the segment", () => {
  const pts = line(101);
  const plan = M.planReroute(pts, 50, { windowM: 180 });
  assert.ok(plan.left < 49 && plan.right > 51, "dense GPS points must not use only neighbours");
  assert.ok(plan.leftAlong >= 180 && plan.leftAlong < 200, `left along ${plan.leftAlong}`);
  assert.ok(plan.rightAlong >= 180 && plan.rightAlong < 200);
  assert.equal(plan.legs.length, 2);
  assert.deepEqual(plain(plan.legs[0].to), pts[50].c.slice(0, 2));
  assert.deepEqual(plain(plan.legs[1].from), pts[50].c.slice(0, 2));
  assert.equal(plan.replaced, plan.right - plan.left - 1);
  const wide = M.planReroute(pts, 50, { windowM: 300 });
  assert.ok(wide.left < plan.left && wide.right > plan.right, "window is adjustable");
  const bounded = M.planReroute(pts, 50, { windowM: 300, bounds: { min: 45, max: 60 } });
  assert.equal(bounded.left, 45); assert.equal(bounded.right, 60);
});

test("sparse points use the nearest point; start/end only route the existing side", () => {
  const sparse = [{ c: [127, 37.5] }, { c: [127, 37.51] }, { c: [127, 37.52] }]; // ~1.1 km spacing
  const p = M.planReroute(sparse, 1);
  assert.equal(p.left, 0); assert.equal(p.right, 2);
  const first = M.planReroute(line(30), 0);
  assert.equal(first.left, null); assert.equal(first.legs.length, 1); assert.equal(first.keepL, -1);
  const last = M.planReroute(line(30), 29);
  assert.equal(last.right, null); assert.equal(last.legs.length, 1);
});

test("duplicate points and out-and-back loops are skipped as anchors", () => {
  const pts = line(40);
  for (const i of [21, 22, 23]) pts[i] = { c: pts[20].c.slice(), ref: i }; // duplicates of P
  const plan = M.planReroute(pts, 20, { windowM: 50 });
  assert.ok(M.meters(pts[plan.right].c, pts[20].c) >= REROUTE.minAnchorM);
  // Loop: goes 100 m north and returns right next to P -> along-path is long but direct distance tiny.
  const loop = [...line(11), ...line(11).reverse().slice(1).map(p => ({ c: [p.c[0] + 0.00001, p.c[1]] }))];
  const lp = M.planReroute(loop, 0, { windowM: 150 });
  assert.ok(M.meters(loop[lp.right].c, loop[0].c) >= REROUTE.minAnchorM, "anchor next to P on a loop is rejected");
  assert.throws(() => M.planReroute([{ c: [127, 37.5] }, { c: [127, 37.50001] }], 0), /기준이 될 점/);
});

test("30 km leg limit is enforced without inventing intermediate waypoints", () => {
  assert.throws(() => M.planReroute([{ c: [127, 37] }, { c: [127, 37.4] }], 1), /30km/);
});

test("route responses are validated (shape, range, order, duplicates, length)", () => {
  const leg = { from: [127, 37.5], to: [127, 37.501] };
  assert.throws(() => M.validateRoute(null, leg), /올바른 경로/);
  assert.throws(() => M.validateRoute([[127, 37.5]], leg));
  assert.throws(() => M.validateRoute([[127, 37.5], [200, 37.5]], leg), /범위/);
  assert.throws(() => M.validateRoute([[127, 37.5], ["x", 1]], leg));
  assert.throws(() => M.validateRoute([[37.5, 127], [37.501, 127]], leg), /범위/, "lat/lon swap is rejected");
  assert.throws(() => M.validateRoute([[127.01, 37.5], [127.01, 37.501]], leg), /좌표 순서/, "route that does not start/end at the anchors is rejected");
  const out = M.validateRoute([[127, 37.5, 9], [127, 37.5, 9], [127, 37.501, 9]], leg);
  assert.deepEqual(plain(out), [[127, 37.5], [127, 37.501]], "dedupe and drop routed elevation");
  assert.throws(() => M.validateRoute([[127, 37], [127, 38], [127, 37]], null), /100km/);
});

test("legs that snap P to different roads are rejected instead of bridged", () => {
  const pts = line(60), plan = M.planReroute(pts, 30);
  const P = plan.pCoord;
  const a = roadBetween(plan.legs[0].from, P), b = roadBetween(P, plan.legs[1].to);
  assert.equal(M.mergeLegs([a, b], plan).coordinates.length, a.length + b.length - 1);
  const shifted = roadBetween([P[0] + 0.0002, P[1]], plan.legs[1].to); // ~18 m away, e.g. other side of a river
  assert.throws(() => M.mergeLegs([a, shifted], plan), e => e.code === "split" && /다른 도로에 연결/.test(e.message));
  const tiny = roadBetween([P[0] + 0.00002, P[1]], plan.legs[1].to); // ~1.8 m <= joinM
  assert.doesNotThrow(() => M.mergeLegs([a, tiny], plan));
  const farA = roadBetween(plan.legs[0].from, [P[0] + 0.001, P[1]]), farB = roadBetween([P[0] + 0.001, P[1]], plan.legs[1].to);
  assert.throws(() => M.mergeLegs([farA, farB], plan), e => e.code === "far");
});

test("apply replaces only the planned range; untouched points keep identity, refs and other segments", () => {
  const seg0 = { slot: 0, points: line(212) }, seg1 = { slot: 1, points: line(212, 126.5, 33.4, 212) }; // 424 points, 2 trkseg
  let segments = [seg0, seg1];
  const p = 106, moved = M.edit(segments, 0, p, p, "move", [127.0005, seg0.points[p].c[1]]);
  const plan = M.planReroute(moved[0].points, p);
  const P = plan.pCoord, legs = [roadBetween(plan.legs[0].from, P), roadBetween(P, plan.legs[1].to)];
  const merged = M.mergeLegs(legs, plan);
  const r = M.applyReroute(moved, 0, plan, merged.coordinates, merged.pIndex);
  assert.equal(r.segments.length, 2, "joined at both anchors -> no extra segment");
  assert.deepEqual(plain(r.joined), { left: true, right: true });
  assert.equal(r.segments[1], moved[1], "other trkseg untouched");
  const out = r.segments[0].points;
  for (let i = 0; i <= plan.left; i++) assert.equal(out[i], seg0.points[i]);
  const tail = seg0.points.slice(plan.right);
  assert.deepEqual(out.slice(-tail.length), tail);
  tail.forEach((pt, i) => assert.equal(out[out.length - tail.length + i], pt));
  const added = out.slice(plan.left + 1, out.length - tail.length);
  assert.ok(added.every(x => x.ref === undefined && x.c[2] === null), "new points have no ref/elevation/time");
  assert.deepEqual(plain(out[r.start].c.slice(0, 2)), plain(P), "selection follows the moved point");
  assert.equal(r.removedOriginal, plan.replaced - 1, "moved point already lost its ref");
  assert.equal(out.length, 212 - plan.replaced + merged.coordinates.length);
});

test("anchor snap beyond tolerance splits into a separate segment instead of a straight link", () => {
  const pts = line(60), plan = M.planReroute(pts, 30), P = plan.pCoord;
  const leftFrom = [plan.legs[0].from[0] + 0.0003, plan.legs[0].from[1]]; // ~26 m from anchor L
  const merged = M.mergeLegs([roadBetween(leftFrom, P), roadBetween(P, plan.legs[1].to)], plan);
  const r = M.applyReroute([{ slot: 0, points: pts }], 0, plan, merged.coordinates, merged.pIndex);
  assert.deepEqual(plain(r.joined), { left: false, right: true });
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].points.at(-1), pts[plan.left], "prefix still ends with the original anchor");
  assert.equal(r.selected, 1);
  assert.ok(r.gaps.left > REROUTE.anchorJoinM);
  assert.ok(r.segments.every(s => s.slot === 0));
});

test("router: mode and [lon,lat] payload, sequential legs, LRU cache", async () => {
  for (const mode of ["walk", "hike", "bike"]) {
    const f = mockFetch(b => json(200, { coordinates: roadBetween(b.from, b.to) }));
    const router = M.createRouter({ fetch: f, sleep: noSleep });
    const plan = M.planReroute(line(60), 30);
    await M.computeReroute(router, plan, mode, undefined);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(f.calls.map(c => c.body.mode), [mode, mode]);
    assert.equal(f.calls[0].url, "/routing/route");
    assert.deepEqual(f.calls[0].body.from, plain(plan.legs[0].from), "[longitude, latitude]");
    assert.deepEqual(Object.keys(f.calls[0].body).sort(), ["from", "mode", "to"], "only anchors + mode are sent");
    await M.computeReroute(router, plan, mode);
    assert.equal(f.calls.length, 2, "cached");
  }
  const f = mockFetch(b => json(200, { coordinates: roadBetween(b.from, b.to) }));
  const router = M.createRouter({ fetch: f, cacheSize: 2 });
  for (let i = 1; i <= 3; i++) await router.leg([127, 37.5], [127, 37.5 + i * 0.001], "walk");
  assert.equal(router.cache.size, 2);
  await assert.rejects(router.leg([127, 37.5], [127, 37.6], "car"), /활동 유형/);
  let inFlight = 0, maxInFlight = 0;
  const slow = mockFetch(async b => { maxInFlight = Math.max(maxInFlight, ++inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; return json(200, { coordinates: roadBetween(b.from, b.to) }); });
  await M.computeReroute(M.createRouter({ fetch: slow }), M.planReroute(line(60), 30), "walk");
  assert.equal(maxInFlight, 1, "legs are requested one at a time");
});

test("router: 503 retry, server errors, timeout, network failure and abort", async () => {
  const busy = mockFetch((b, n) => n < 3 ? json(503, { error: "다른 경로를 계산 중" }) : json(200, { coordinates: roadBetween(b.from, b.to) }));
  await M.createRouter({ fetch: busy, sleep: noSleep }).leg([127, 37.5], [127, 37.501], "walk");
  assert.equal(busy.calls.length, 3);
  const always = mockFetch(() => json(503, { error: "busy" }));
  await assert.rejects(M.createRouter({ fetch: always, sleep: noSleep }).leg([127, 37.5], [127, 37.501], "walk"), /busy/);
  assert.equal(always.calls.length, 4);
  for (const [status, msg] of [[400, "지점 간격은 30km 이내로 나누어 주세요."], [400, "국내 지도 범위와 이동 방식을 확인하세요."], [422, "연결된 길을 찾지 못했습니다."]]) {
    await assert.rejects(M.createRouter({ fetch: mockFetch(() => json(status, { error: msg })) }).leg([127, 37.5], [127, 37.501], "walk"), e => e.message === msg && e.code === "http" + status);
  }
  const bad = mockFetch(() => json(200, { coordinates: [[127.01, 37.5], [127.01, 37.501]] }));
  const badRouter = M.createRouter({ fetch: bad });
  await assert.rejects(badRouter.leg([127, 37.5], [127, 37.501], "walk"), /좌표 순서/);
  assert.equal(badRouter.cache.size, 0, "invalid responses are not cached");
  const hang = async (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(Error("aborted"), { name: "AbortError" }))));
  await assert.rejects(M.createRouter({ fetch: hang, timeout: 10 }).leg([127, 37.5], [127, 37.501], "walk"), e => e.code === "timeout");
  await assert.rejects(M.createRouter({ fetch: async () => { throw new TypeError("fetch failed"); } }).leg([127, 37.5], [127, 37.501], "walk"), e => e.code === "network");
  const ctl = new AbortController(), p = M.createRouter({ fetch: hang }).leg([127, 37.5], [127, 37.501], "walk", ctl.signal);
  ctl.abort();
  await assert.rejects(p, e => e.name === "AbortError");
});

test("existing selected-section route edit still keeps the routed part as its own segment", () => {
  const segs = [{ slot: 0, points: line(10) }];
  const out = M.edit(segs, 0, 2, 7, "route", [[127, 37.5002], [127.001, 37.5004], [127, 37.5006]]);
  assert.equal(out.length, 3);
  assert.equal(out[0].points.at(-1), segs[0].points[2]);
  assert.equal(out[2].points[0], segs[0].points[7]);
});
