import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../web/public/app.js", import.meta.url), "utf8");
const handler = source.slice(source.indexOf("async function selectStoredTrack("), source.indexOf("function renderTracks()"));

function setup({ editor, ready = Promise.resolve() } = {}) {
  const tracks = [
    { id: "first", name: "첫 기록", on: true, pts: [[126, 37], [127, 38]] },
    { id: "second", name: "두 번째", on: false, pts: [[128, 39], [129, 40]] },
  ];
  const picker = {};
  const saved = [], fitted = [];
  const context = {
    tracks, window: { __gpxEditor: editor }, mapInitialized: ready,
    map: { getSource: () => ({}) }, $: () => picker,
    renderTracks: () => {}, saveTracks: () => saved.push(tracks.map(t => t.on)),
    fit: pts => fitted.push(pts),
  };
  runInNewContext(handler, context);
  return { tracks, picker, saved, fitted };
}

test("choosing an imported GPX shows only that route and fits the map", async () => {
  const { tracks, picker, saved, fitted } = setup();
  await picker.onchange({ target: { value: "second" } });
  assert.deepEqual(tracks.map(t => t.on), [false, true]);
  assert.deepEqual(saved[0], [false, true]);
  assert.equal(fitted[0], tracks[1].pts);
});

test("selection waits for map readiness before fitting", async () => {
  let finish;
  const { picker, fitted } = setup({ ready: new Promise(resolve => { finish = resolve; }) });
  const pending = picker.onchange({ target: { value: "second" } });
  assert.equal(fitted.length, 0);
  finish();
  await pending;
  assert.equal(fitted.length, 1);
});

test("canceling an active edit preserves current track visibility", async () => {
  const { tracks, picker, saved, fitted } = setup({ editor: { active: true, leave: () => false } });
  await picker.onchange({ target: { value: "second" } });
  assert.deepEqual(tracks.map(t => t.on), [true, false]);
  assert.equal(saved.length, 0);
  assert.equal(fitted.length, 0);
});
