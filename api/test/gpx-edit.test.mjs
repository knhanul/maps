// Point-editing model actions in web/public/gpx-model.js (pure, no DOM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const ctx = { setTimeout, clearTimeout, AbortController };
ctx.globalThis = ctx;
runInNewContext(readFileSync(new URL("../web/public/gpx-model.js", import.meta.url), "utf8"), ctx);
const M = ctx.GildamGpxModel;
const plain = v => JSON.parse(JSON.stringify(v));
const seg = (n, slot = 0) => ({ slot, points: Array.from({ length: n }, (_, i) => ({ c: [127, 37.5 + i * 0.0001, i], ref: i })) });

test("split keeps the split point (same record) at the end of the first and start of the second part", () => {
  const s = [seg(10), seg(3, 1)];
  const out = M.edit(s, 0, 4, 4, "split");
  assert.equal(out.length, 3);
  assert.equal(out[0].points.length, 5); assert.equal(out[1].points.length, 6);
  assert.equal(out[0].points[4], s[0].points[4]); assert.equal(out[1].points[0], s[0].points[4]);
  assert.equal(out[0].slot, 0); assert.equal(out[1].slot, 0); assert.equal(out[2], s[1]);
  assert.throws(() => M.edit(s, 0, 0, 0, "split"), /처음·끝/);
  assert.throws(() => M.edit(s, 0, 9, 9, "split"), /처음·끝/);
});

test("clearInterior removes only the points strictly between the range ends", () => {
  const s = [seg(10)];
  const out = M.edit(s, 0, 2, 6, "clearInterior");
  assert.deepEqual(plain(out[0].points.map(p => p.ref)), [0, 1, 2, 6, 7, 8, 9]);
  assert.throws(() => M.edit(s, 0, 2, 3, "clearInterior"), /지울 점/);
});

test("insert/delete/removeRange/trim keep untouched point records shared", () => {
  const s = [seg(6)];
  const ins = M.edit(s, 0, 2, 2, "insert", [127.001, 37.5002]);
  assert.equal(ins[0].points.length, 7); assert.equal(ins[0].points[3].ref, undefined); assert.equal(ins[0].points[3].c[2], null);
  assert.equal(ins[0].points[4], s[0].points[3]);
  const del = M.edit(s, 0, 2, 2, "delete");
  assert.deepEqual(plain(del[0].points.map(p => p.ref)), [0, 1, 3, 4, 5]);
  const rr = M.edit(s, 0, 1, 3, "removeRange");
  assert.equal(rr.length, 2); assert.deepEqual(plain(rr.map(x => x.points.map(p => p.ref))), [[0], [4, 5]]);
  const tr = M.edit(s, 0, 1, 3, "trim");
  assert.deepEqual(plain(tr[0].points.map(p => p.ref)), [1, 2, 3]);
});

test("softMove drags neighbours inside the radius by a falling share and shares every other record", () => {
  const s = [seg(41), seg(3, 1)]; // points about 11.1 m apart
  const p = s[0].points[20].c, out = M.softMove(s, 0, 20, [p[0] + 0.0004, p[1]], 60), P = out.segments[0].points;
  assert.equal(P[20].c[0], p[0] + 0.0004); assert.equal(P[20].ref, undefined); assert.equal(P[20].c[2], null);
  assert.equal(out.lo, 15); assert.equal(out.hi, 25); assert.equal(out.moved, 11);
  const dx = i => P[i].c[0] - 127;
  assert.ok(dx(20) > dx(19) && dx(19) > dx(18) && dx(18) > dx(17) && dx(17) > dx(16) && dx(16) > dx(15) && dx(15) > 0);
  assert.ok(Math.abs(dx(19) - dx(21)) < 1e-12, "both sides move alike");
  assert.equal(P[19].c[1], s[0].points[19].c[1], "only the dragged offset is applied");
  assert.equal(P[14], s[0].points[14]); assert.equal(P[26], s[0].points[26]); assert.equal(out.segments[1], s[1]);
  assert.equal(s[0].points[20].ref, 20, "input untouched");
});

test("softMove with no radius moves one point, clips at segment ends and rejects bad input", () => {
  const s = [seg(41)], lat = i => s[0].points[i].c[1];
  const one = M.softMove(s, 0, 20, [127.0004, lat(20)], 0);
  assert.equal(one.moved, 1); assert.equal(one.segments[0].points[19], s[0].points[19]); assert.equal(one.segments[0].points[21], s[0].points[21]);
  const edge = M.softMove(s, 0, 1, [127.0004, lat(1)], 60);
  assert.equal(edge.lo, 0); assert.equal(edge.hi, 6); assert.equal(edge.segments[0].points.length, 41);
  assert.throws(() => M.softMove(s, 0, 99, [127, 37.5], 60), /범위/);
  assert.throws(() => M.softMove(s, 0, 2, [999, 37.5], 60), /좌표/);
  assert.throws(() => M.softMove(s, 3, 2, [127, 37.5], 60), /구간/);
});

test("groupPasses splits hits into passes by index gap or segment and keeps the nearest hit of each", () => {
  const hits = [{ si: 0, pi: 10, d: 9 }, { si: 0, pi: 11, d: 3 }, { si: 0, pi: 12, d: 7 }, { si: 0, pi: 90, d: 4 }, { si: 0, pi: 91, d: 2 }, { si: 1, pi: 91, d: 5 }];
  assert.deepEqual(plain(M.groupPasses(hits)), [{ si: 0, pi: 11, d: 3 }, { si: 0, pi: 91, d: 2 }, { si: 1, pi: 91, d: 5 }]);
  assert.deepEqual(plain(M.groupPasses([{ si: 0, pi: 1, d: 1 }, { si: 0, pi: 9, d: 2 }, { si: 0, pi: 18, d: 3 }])), [{ si: 0, pi: 1, d: 1 }, { si: 0, pi: 18, d: 3 }]);
  assert.equal(M.groupPasses([{ si: 0, pi: 0, d: 1 }, { si: 0, pi: 1, d: 1 }], 0).length, 2);
  assert.equal(M.groupPasses([]).length, 0);
});

test("pickPass prefers the pass continuing from the selection, unless another pass is clearly nearer", () => {
  const passes = [{ si: 0, pi: 11, d: 3 }, { si: 0, pi: 91, d: 2 }];
  assert.equal(M.pickPass(passes, 0, 15).hit.pi, 11, "editing the way out keeps the way out");
  assert.equal(M.pickPass(passes, 0, 80).hit.pi, 91, "editing the way back keeps the way back");
  assert.equal(M.pickPass(passes, 0, 15).passes.length, 2);
  const clear = [{ si: 0, pi: 11, d: 12 }, { si: 0, pi: 91, d: 2 }];
  assert.equal(M.pickPass(clear, 0, 15).hit.pi, 91); assert.equal(M.pickPass(clear, 0, 15).passes.length, 1);
  assert.equal(M.pickPass([{ si: 0, pi: 5, d: 2 }, { si: 2, pi: 5, d: 2 }], 2, 300).hit.si, 2, "same segment first");
  assert.equal(M.pickPass([], 0, 0), null);
});
