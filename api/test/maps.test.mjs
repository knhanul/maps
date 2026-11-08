import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = 18097, base = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gm")), root = path.join(dir, "maps");
const WT = "worker-test-token", SID = "sess-test";
let api;
const PM = process.env.TEST_PMTILES; // 실제 pmtiles 파일 (없으면 가짜 헤더)
function mkRelease(v) {
  const d = path.join(root, "incoming", v); fs.mkdirSync(d, { recursive: true });
  if (PM) fs.copyFileSync(PM, path.join(d, "gildam.pmtiles"));
  else { const b = Buffer.alloc(200); b.write("PMTiles", 0, "latin1"); b[7] = 3; b[99] = 1; b[100] = 0; b[101] = 12; fs.writeFileSync(path.join(d, "gildam.pmtiles"), b); }
  const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(d, "gildam.pmtiles"))).digest("hex");
  fs.writeFileSync(path.join(d, "SHA256SUMS"), `${h}  gildam.pmtiles\n`);
}
before(async () => {
  for (const s of ["incoming", "releases"]) fs.mkdirSync(path.join(root, s), { recursive: true });
  api = spawn(process.execPath, ["--experimental-sqlite", "src/server.mjs"], { env: { ...process.env, PORT, DB_PATH: dir + "/t.sqlite", MAPS_ROOT: root, WORKER_TOKEN_SHA256: crypto.createHash("sha256").update(WT).digest("hex") }, stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 800));
  const db = new DatabaseSync(dir + "/t.sqlite");
  db.prepare("INSERT INTO admin_sessions (id_hash, sub, role, nickname, created_at, expires_at) VALUES (?,?,?,?,?,?)").run(crypto.createHash("sha256").update(SID).digest("hex"), "admin1", "platform_admin", "길담지기", Date.now(), Date.now() + 3600e3);
  db.close();
});
after(() => api.kill());
const A = (p, m = "GET", body, h = {}) => fetch(base + "/v1/admin" + p, { method: m, headers: { cookie: `__Host-gildam_admin=${SID}`, "x-gildam-admin": "1", "content-type": "application/json", ...h }, body: body && JSON.stringify(body) });
test("admin page shows nickname, not sub", async () => {
  const h = await (await fetch(base + "/admin/", { headers: { cookie: `__Host-gildam_admin=${SID}` } })).text();
  assert.match(h, /길담지기/); assert.doesNotMatch(h, /admin1/);
});
const W = (p, m = "GET", body, tok = WT) => fetch(base + "/v1/worker" + p, { method: m, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
const wait = async (v, st) => { for (let i = 0; i < 50; i++) { const r = (await (await A("/releases")).json()).items.find((x) => x.version === v); if (r.status !== "verifying") return r; await new Promise((r) => setTimeout(r, 100)); } };
const cur = () => fs.readlinkSync(path.join(root, "current"));

test("auth", async () => {
  assert.equal((await fetch(base + "/v1/admin/releases")).status, 401);
  assert.equal((await A("/rollback", "POST", {}, { "x-gildam-admin": "" })).status, 403);
  assert.equal((await W("/jobs/claim", "POST", {}, "wrong")).status, 401);
  assert.equal((await fetch(base + "/v1/map/manifest")).status, 404);
  assert.equal((await W("/releases/x1/publish", "POST")).status, 403);
});
test("verify/publish/rollback/retention", async () => {
  for (const v of ["v1", "v2", "v3", "v4"]) mkRelease(v);
  fs.appendFileSync(path.join(root, "incoming/v4/gildam.pmtiles"), "x"); // 해시 깨짐
  assert.equal((await W("/releases/v1/verify", "POST")).status, 202);
  assert.equal((await wait("v1")).status, "verified");
  assert.equal((await A("/releases/v4/verify", "POST")).status, 202);
  const f = await wait("v4"); assert.equal(f.status, "failed"); assert.match(f.error, /SHA256/);
  assert.equal((await A("/releases/v4/publish", "POST")).status, 409);
  assert.equal((await A("/releases/v1/publish", "POST")).status, 200); assert.equal(cur(), "releases/v1");
  const mf = await (await fetch(base + "/v1/map/manifest")).json();
  assert.equal(mf.version, "v1"); assert.match(mf.tiles_url, /\/tiles\/v1\/gildam\.pmtiles$/);
  for (const v of ["v2", "v3"]) { await A(`/releases/${v}/verify`, "POST"); await wait(v); }
  assert.equal((await A("/releases/v2/publish", "POST")).status, 200); assert.equal(cur(), "releases/v2");
  assert.equal((await A("/rollback", "POST")).status, 200); assert.equal(cur(), "releases/v1");
  assert.equal((await A("/rollback", "POST")).status, 200); assert.equal(cur(), "releases/v2");
  assert.equal((await A("/releases/v3/publish", "POST")).status, 200);  // v1 → pending_archive (디스크에 남음)
  let l = (await (await A("/releases")).json()).items;
  assert.equal(l.find((x) => x.version === "v1").status, "pending_archive");
  assert.ok(fs.existsSync(path.join(root, "releases/v1")));
  assert.equal((await A("/releases/v1/remove", "POST")).status, 409);
  mkRelease("v5"); await A("/releases/v5/verify", "POST"); await wait("v5");
  assert.equal((await A("/releases/v5/publish", "POST")).status, 409); // 보관 대기 있음
  const jobs = (await (await A("/jobs")).json()).items; assert.ok(jobs.some((j) => j.type === "archive" && j.params.version === "v1"));
  assert.equal((await W("/releases/v1/archived", "POST", { archive_ref: "nas://gildam-maps/v1" })).status, 200);
  assert.equal((await A("/releases/v1/remove", "POST")).status, 200); assert.ok(!fs.existsSync(path.join(root, "releases/v1")));
  assert.equal((await A("/releases/v5/publish", "POST")).status, 200);
});
test("jobs", async () => {
  const j = await (await A("/jobs", "POST", { type: "generate", params: { region: "test" } })).json();
  assert.equal(j.status, "queued");
  const c = await (await W("/jobs/claim", "POST", { types: ["generate"] })).json(); assert.equal(c.id, j.id);
  assert.equal((await W("/jobs/claim", "POST", { types: ["generate"] })).status, 204);
  assert.equal((await (await W(`/jobs/${j.id}`, "POST", { status: "done", result: { version: "v9" } })).json()).status, "done");
  assert.equal((await W("/jobs", "POST", { type: "generate" })).status, 403);
});
