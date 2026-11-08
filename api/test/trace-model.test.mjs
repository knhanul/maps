// Image → route tracing model (web/public/trace-model.js) with synthetic images.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const ctx = {}; ctx.globalThis = ctx;
runInNewContext(readFileSync(new URL("../web/public/trace-model.js", import.meta.url), "utf8"), ctx);
const T = ctx.GildamTraceModel;
const plain = v => JSON.parse(JSON.stringify(v));

function image(w, h) { const data = new Uint8ClampedArray(w * h * 4).fill(255); return { width: w, height: h, data }; }
function paint(img, x, y, rgb, r = 1) { for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) { if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue; const i = (yy * img.width + xx) * 4; img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255; } }
function polyline(img, pts, rgb, r = 1) { for (let k = 1; k < pts.length; k++) { const [a, b] = [pts[k - 1], pts[k]], n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); for (let i = 0; i <= n; i++) paint(img, Math.round(a[0] + (b[0] - a[0]) * i / n), Math.round(a[1] + (b[1] - a[1]) * i / n), rgb, r); } }
const BLUE = [35, 75, 225], RIVER = [165, 205, 235];
// U-shaped route with a white "icon" gap on the top edge, plus a light-blue river crossing it.
function scene() {
  const img = image(220, 120);
  polyline(img, [[20, 20], [180, 20], [180, 90], [20, 90]], BLUE);
  for (let y = 14; y <= 26; y++) for (let x = 95; x <= 105; x++) paint(img, x, y, [255, 255, 255], 0);
  polyline(img, [[60, 0], [60, 119]], RIVER, 3);
  return img;
}

test("similarity fit recovers scale + rotation + translation and inverts exactly", () => {
  const truth = { a: 2e-6 * Math.cos(0.3), b: 2e-6 * Math.sin(0.3), tx: 0.85, ty: 0.39 };
  const pairs = [[10, 10], [700, 40], [300, 420]].map(([u, v]) => { const [x, y] = T.apply(truth, u, v); return { u, v, x, y }; });
  const fit = T.fitSimilarity(pairs);
  for (const k of ["a", "b", "tx", "ty"]) assert.ok(Math.abs(fit[k] - truth[k]) < 1e-12, k);
  assert.ok(Math.max(...T.residuals(fit, pairs)) < 1e-12);
  const [u, v] = T.invert(fit, ...T.apply(fit, 123.4, 56.7)); assert.ok(Math.abs(u - 123.4) < 1e-6 && Math.abs(v - 56.7) < 1e-6);
  const moved = T.fitSimilarity([{ u: 0, v: 0, x: 0.9, y: 0.4 }], truth);
  assert.deepEqual(plain(T.apply(moved, 0, 0)), [0.9, 0.4]); assert.equal(moved.a, truth.a);
  assert.throws(() => T.fitSimilarity([{ u: 5, v: 5, x: 0, y: 0 }, { u: 5, v: 5, x: 1, y: 1 }]), /너무 가깝/);
});

test("color pick prefers the saturated line pixel; mask excludes background and pale water", () => {
  const img = scene();
  assert.deepEqual(plain(T.pickColor(img, 140, 23)), BLUE, "click 3 px off the line still picks the line");
  const M = T.buildMask(img, BLUE, 60);
  assert.ok(M.mask[20 * 220 + 140] && M.mask[90 * 220 + 40]);
  assert.equal(M.mask[60 * 220 + 60], 0, "river not matched"); assert.equal(M.mask[50 * 220 + 100], 0, "white not matched");
  assert.deepEqual(plain(T.snapToMask(M, 140, 30)), [140, 21]);
  assert.equal(T.snapToMask(M, 100, 55, 10), null);
});

test("tracing follows the drawn line (no shortcut across the U), bridges the short icon gap", () => {
  const img = scene(), M = T.buildMask(img, BLUE, 60);
  const { path, bridged } = T.tracePath(M, T.snapToMask(M, 20, 20), T.snapToMask(M, 20, 90));
  assert.ok(path.some(([x, y]) => x >= 178 && y > 40 && y < 70), "goes around the far side");
  assert.ok(path.length > 350, "follows ~370 px of line instead of the 70 px shortcut");
  const runs = T.bridgedRuns(bridged); assert.ok(runs.max >= 9 && runs.max <= 13, "bridged only the icon gap: " + runs.max);
  assert.equal(bridged.filter(Boolean).length, runs.total);
  const simple = T.simplify(path, 0.8); assert.ok(simple.length <= 12 && simple.length >= 4, "corners kept: " + simple.length);
  assert.throws(() => T.tracePath({ mask: new Uint8Array(4), width: 2, height: 2 }, [0, 0], [1, 1], { maxNodes: 2 }), /너무 큽니다/);
});

test("high gap cost avoids long off-line shortcuts; low cost allows them", () => {
  const img = image(200, 60); polyline(img, [[10, 10], [190, 10], [190, 50], [10, 50]], BLUE);
  const M = T.buildMask(img, BLUE, 60);
  assert.ok(T.tracePath(M, [10, 10], [10, 50], { gapCost: 25 }).path.length > 300);
  assert.ok(T.tracePath(M, [10, 10], [10, 50], { gapCost: 2 }).path.length < 100);
});

test("waypoint sampling uses only existing trace vertices; deviation and GPX output", () => {
  const C = Array.from({ length: 101 }, (_, i) => [127 + i * 0.001, 37.5]); // ~88 m steps, ~8.8 km
  const S = T.sampleAlong(C, 1500);
  assert.deepEqual(plain(S[0]), C[0]); assert.deepEqual(plain(S.at(-1)), C[100]);
  assert.ok(S.every(p => C.some(c => c[0] === p[0] && c[1] === p[1])));
  assert.ok(S.length >= 6 && S.length <= 8, "len " + S.length);
  assert.ok(T.deviation([[127.05, 37.5]], C) < 1);
  const dev = T.deviation([[127.05, 37.502]], C); assert.ok(dev > 200 && dev < 240, "≈222 m: " + dev);
  const gpx = T.toGpx('A&B "코스"', [[[127, 37.5], [127.001, 37.5]], [[128, 38]]]);
  assert.match(gpx, /A&amp;B &quot;코스&quot;/); assert.equal((gpx.match(/<trkseg>/g) || []).length, 1, "1-point parts skipped");
  assert.match(gpx, /lat="37.5000000" lon="127.0010000"/);
});
