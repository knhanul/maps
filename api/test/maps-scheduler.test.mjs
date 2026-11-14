import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { inSchedulerWindow, hasRecentSchedulerGenerate, runScheduledGenerate, SCHEDULER_GENERATE_PARAMS } from "../src/maps.mjs";

const mon0300 = Date.parse("2026-11-15T18:00:00Z"); // Monday 03:00 KST
const mon0329 = Date.parse("2026-11-15T18:29:59Z");
const mon0330 = Date.parse("2026-11-15T18:30:00Z");
const mon0259 = Date.parse("2026-11-15T17:59:59Z");
const sun0300 = Date.parse("2026-11-14T18:00:00Z"); // Sunday 03:00 KST
const tue0300 = Date.parse("2026-11-16T18:00:00Z");

test("KST window is Monday 03:00–03:29 inclusive, independent of process TZ", () => {
  const prev = process.env.TZ;
  process.env.TZ = "UTC";
  assert.equal(inSchedulerWindow(mon0300), true);
  assert.equal(inSchedulerWindow(mon0329), true);
  assert.equal(inSchedulerWindow(mon0259), false);
  assert.equal(inSchedulerWindow(mon0330), false);
  assert.equal(inSchedulerWindow(sun0300), false);
  assert.equal(inSchedulerWindow(tue0300), false);
  process.env.TZ = "Pacific/Honolulu";
  assert.equal(inSchedulerWindow(mon0300), true);
  assert.equal(inSchedulerWindow(mon0330), false);
  if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
});

test("scheduler enqueues once in the window and skips 6-day duplicates", () => {
  const jobs = [];
  const enqueue = (params) => { jobs.push(params); return { id: jobs.length, params }; };
  assert.deepEqual(runScheduledGenerate({ now: sun0300, enqueue, hasRecent: () => false }), { action: "skip", reason: "outside_window" });
  assert.equal(jobs.length, 0);
  const first = runScheduledGenerate({ now: mon0300, enqueue, hasRecent: () => false });
  assert.equal(first.action, "enqueued");
  assert.deepEqual(first.job.params, SCHEDULER_GENERATE_PARAMS);
  assert.equal(first.job.params.build, "latest");
  assert.deepEqual(first.job.params.bbox, [124.5, 33.0, 132.0, 38.7]);
  assert.equal(first.job.params.maxzoom, 15);
  assert.equal(first.job.params.region, "korea");
  assert.deepEqual(runScheduledGenerate({ now: mon0329, enqueue, hasRecent: () => true }), { action: "skip", reason: "recent_job" });
  assert.equal(jobs.length, 1);
});

test("dedupe query uses generate + created_by=scheduler within 6 days", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE map_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued', created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );`);
  const now = mon0300;
  db.prepare("INSERT INTO map_jobs (type, params, created_by, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("generate", "{}", "scheduler", now - (6 * 24 * 3600e3) + 1000, now);
  assert.equal(hasRecentSchedulerGenerate(db, now), true);
  db.exec("DELETE FROM map_jobs");
  db.prepare("INSERT INTO map_jobs (type, params, created_by, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("generate", "{}", "scheduler", now - (6 * 24 * 3600e3) - 1000, now);
  assert.equal(hasRecentSchedulerGenerate(db, now), false);
  db.prepare("INSERT INTO map_jobs (type, params, created_by, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("generate", "{}", "admin:someone", now - 60e3, now);
  db.prepare("INSERT INTO map_jobs (type, params, created_by, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("archive", "{}", "scheduler", now - 60e3, now);
  assert.equal(hasRecentSchedulerGenerate(db, now), false);
  db.close();
});
