import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const sign = (p, h = {}) => { const e = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const si = e({ alg: "RS256", typ: "at+jwt", kid: "k1", ...h }) + "." + e(p); return si + "." + crypto.sign("RSA-SHA256", Buffer.from(si), privateKey).toString("base64url"); };
const now = () => Math.floor(Date.now() / 1000);
const tok = (o = {}) => sign({ iss: "https://id.test", sub: "u1", aud: "gildam-android", brand_id: "gildam", exp: now() + 600, iat: now(), ...o });
let jw, api, dir; const PORT = 18099, base = `http://127.0.0.1:${PORT}/gildam-api`;
before(async () => {
  jw = http.createServer((q, s) => {
    if (q.url === "/userinfo") { const sub = JSON.parse(Buffer.from(String(q.headers.authorization).split(".")[1], "base64url")).sub; return s.end(JSON.stringify(sub === "u1" ? { sub, nickname: "산책왕", preferred_username: "산책왕" } : { sub })); }
    s.end(JSON.stringify({ keys: [jwk] }));
  }).listen(18098);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd"));
  api = spawn(process.execPath, ["--experimental-sqlite", "src/server.mjs"], { env: { ...process.env, PORT, BASE_PATH: "/gildam-api", OIDC_ISSUER: "https://id.test", JWKS_URL: "http://127.0.0.1:18098/", DB_PATH: dir + "/t.sqlite", USERINFO_URL: "http://127.0.0.1:18098/userinfo" }, stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 800));
});
after(() => { api.kill(); jw.close(); });
const call = (m, p, t, b) => fetch(base + p, { method: m, headers: { ...(t && { authorization: "Bearer " + t }), "content-type": "application/json" }, body: b && JSON.stringify(b) });
const track = (ua) => ({ updated_at: ua, title: "산책", points: [{ lat: 37.5, lon: 127, t: 1 }, { lat: 37.51, lon: 127.01, t: 2, ele: 30 }], waypoints: [{ id: "wp-000001", lat: 37.5, lon: 127, memo: "벚꽃", photo_local_only: true, photo_count: 2 }] });
test("auth negatives", async () => {
  assert.equal((await call("GET", "/v1/me")).status, 401);
  assert.equal((await call("GET", "/v1/me", tok({ aud: "other" }))).status, 401);
  assert.equal((await call("GET", "/v1/me", tok({ iss: "https://evil" }))).status, 401);
  assert.equal((await call("GET", "/v1/me", tok({ exp: now() - 100 }))).status, 401);
  assert.equal((await call("GET", "/v1/me", tok().slice(0, -4) + "AAAA")).status, 401);
  assert.equal((await call("GET", "/v1/me", tok({}, ))).status, 200);
});
test("me nickname (optional, userinfo or claim)", async () => {
  const a = await (await call("GET", "/v1/me", tok())).json();
  assert.equal(a.nickname, "산책왕"); assert.equal(a.display_name, "산책왕"); assert.equal(a.sub, "u1");
  const b = await (await call("GET", "/v1/me", tok({ sub: "u9" }))).json();
  assert.equal(b.nickname, null); assert.equal(b.display_name, "누니 회원"); assert.ok("track_count" in b);
  const c = await (await call("GET", "/v1/me", tok({ sub: "u8", nickname: "토큰닉" }))).json();
  assert.equal(c.nickname, "토큰닉");
});
test("crud + sync", async () => {
  const t = tok();
  assert.equal((await call("PUT", "/v1/tracks/trk-000001", t, track(1000))).status, 201);
  assert.equal((await call("PUT", "/v1/tracks/trk-000001", t, track(500))).status, 409);
  assert.equal((await call("PUT", "/v1/tracks/trk-000002", t, { ...track(1), waypoints: [{ id: "wp-000002", lat: 1, lon: 1, photo_uri: "content://x" }] })).status, 400);
  const g = await (await call("GET", "/v1/tracks/trk-000001", t)).json();
  assert.equal(g.waypoints[0].photo_local_only, true);
  assert.equal((await call("GET", "/v1/tracks/trk-000001", tok({ sub: "u2" }))).status, 404);
  const l = await (await call("GET", "/v1/tracks", t)).json();
  assert.equal(l.items.length, 1);
  assert.equal((await call("DELETE", "/v1/tracks/trk-000001", t)).status, 200);
  const s = await (await call("GET", "/v1/tracks?since=" + l.cursor, t)).json();
  assert.equal(s.items[0].deleted, true);
  assert.equal((await (await call("GET", "/v1/tracks", t)).json()).items.length, 0);
});

test("activity_type: store, keep on omit, validate, list", async () => {
  const t = tok({ sub: "u3" }); const id = "trk-act00001";
  assert.equal((await (await call("GET", "/v1/tracks/trk-000001", tok())).status), 404);
  let r = await call("PUT", "/v1/tracks/" + id, t, track(1000));
  assert.equal(r.status, 201); assert.equal((await r.json()).activity_type, null);
  r = await call("PUT", "/v1/tracks/" + id, t, { ...track(2000), activity_type: "HIKE" });
  assert.equal(r.status, 200); assert.equal((await r.json()).activity_type, "HIKE");
  r = await call("PUT", "/v1/tracks/" + id, t, track(3000));
  assert.equal((await r.json()).activity_type, "HIKE");
  assert.equal((await call("PUT", "/v1/tracks/" + id, t, { ...track(4000), activity_type: "SKI" })).status, 400);
  assert.equal((await call("PUT", "/v1/tracks/" + id, t, { ...track(4000), activity_type: 3 })).status, 400);
  r = await call("PUT", "/v1/tracks/" + id, t, { ...track(5000), activity_type: "bike" });
  assert.equal((await r.json()).activity_type, "BIKE");
  assert.equal((await (await call("GET", "/v1/tracks/" + id, t)).json()).activity_type, "BIKE");
  const l = await (await call("GET", "/v1/tracks", t)).json();
  assert.equal(l.items[0].activity_type, "BIKE");
  r = await call("PUT", "/v1/tracks/" + id, t, { ...track(6000), activity_type: null });
  assert.equal((await r.json()).activity_type, null);
});
