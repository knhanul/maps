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
