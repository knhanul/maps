// 길담 동기화 API — 의존성 없음 (Node 24: node:http, node:crypto, node:sqlite)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createMaps } from "./maps.mjs";
import { handlePlacesSearch } from "./places-search.mjs";

const CFG = {
  port: Number(process.env.PORT || 8080),
  issuer: process.env.OIDC_ISSUER || "https://id.nuni.co.kr",
  jwksUrl: process.env.JWKS_URL || "https://id.nuni.co.kr/.well-known/jwks.json",
  audience: (process.env.OIDC_AUDIENCE || "gildam-android").split(",").map((s) => s.trim()).filter(Boolean),
  brand: process.env.BRAND_ID || "gildam",
  dbPath: process.env.DB_PATH || "/data/gildam.sqlite",
  basePath: (process.env.BASE_PATH || "").replace(/\/$/, ""),
  maxBody: Number(process.env.MAX_BODY || 8 * 1024 * 1024),
  skew: 30,
};

// ---------- DB
fs.mkdirSync(CFG.dbPath.replace(/\/[^/]*$/, "") || ".", { recursive: true });
const db = new DatabaseSync(CFG.dbPath);
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (sub TEXT PRIMARY KEY, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tracks (
  user_sub TEXT NOT NULL REFERENCES users(sub),
  id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,          -- 클라이언트 수정 시각 (ms)
  server_seq INTEGER NOT NULL,          -- 서버 변경 순번 (since 커서)
  deleted INTEGER NOT NULL DEFAULT 0,
  body TEXT,                            -- 트랙 JSON (deleted 면 NULL)
  PRIMARY KEY (user_sub, id)
);
CREATE INDEX IF NOT EXISTS tracks_user_seq ON tracks(user_sub, server_seq);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', 0);
`);
const nextSeq = () => { db.prepare("UPDATE meta SET v = v + 1 WHERE k='seq'").run(); return db.prepare("SELECT v FROM meta WHERE k='seq'").get().v; };
const tx = (fn) => { db.exec("BEGIN IMMEDIATE"); try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; } };

// ---------- JWT (RS256, JWKS)
let jwks = { at: 0, keys: new Map() };
let lastFetch = 0;
async function loadJwks(force) {
  const now = Date.now();
  if (!force && now - jwks.at < 10 * 60e3 && jwks.keys.size) return;
  if (force && now - lastFetch < 30e3) return;
  lastFetch = now;
  const r = await fetch(CFG.jwksUrl, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error("jwks " + r.status);
  const j = await r.json();
  const keys = new Map();
  for (const k of j.keys || []) if (k.kty === "RSA" && k.kid && (!k.use || k.use === "sig")) keys.set(k.kid, crypto.createPublicKey({ key: k, format: "jwk" }));
  jwks = { at: now, keys };
}
const b64json = (s) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
class AuthError extends Error {}
export async function verifyJwt(tok, { audience, typ = "at+jwt", brand = CFG.brand, nonce } = {}) {
  const parts = tok.split(".");
  if (parts.length !== 3) throw new AuthError("malformed");
  let h, p;
  try { h = b64json(parts[0]); p = b64json(parts[1]); } catch { throw new AuthError("malformed"); }
  if (h.alg !== "RS256") throw new AuthError("alg");
  if (typ && h.typ && h.typ !== typ) throw new AuthError("typ");
  await loadJwks(false);
  let key = jwks.keys.get(h.kid);
  if (!key) { await loadJwks(true); key = jwks.keys.get(h.kid); }
  if (!key) throw new AuthError("kid");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, Buffer.from(parts[2], "base64url"));
  if (!ok) throw new AuthError("signature");
  const now = Math.floor(Date.now() / 1000);
  if (p.iss !== CFG.issuer) throw new AuthError("iss");
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.some((a) => audience.includes(a))) throw new AuthError("aud");
  if (nonce !== undefined && p.nonce !== nonce) throw new AuthError("nonce");
  if (typeof p.exp !== "number" || p.exp + CFG.skew < now) throw new AuthError("expired");
  if (typeof p.nbf === "number" && p.nbf - CFG.skew > now) throw new AuthError("nbf");
  if (brand && p.brand_id && p.brand_id !== brand) throw new AuthError("brand");
  if (typeof p.sub !== "string" || !p.sub) throw new AuthError("sub");
  return p;
}
const verifyAccessToken = (tok) => verifyJwt(tok, { audience: CFG.audience });

// ---------- 닉네임 (누니 ID). 액세스 토큰에 claim 이 있으면 그대로, 없으면 userinfo 로 받아 짧게 메모리 캐시(저장 안 함)
const USERINFO_URL = process.env.USERINFO_URL || `${CFG.issuer}/oauth/userinfo`;
const NICK_TTL = Number(process.env.NICKNAME_CACHE_MS || 5 * 60e3);
const nickCache = new Map(); // sub -> { at, nick }
const cleanNick = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null);
async function nicknameFor(claims, token) {
  const fromClaim = cleanNick(claims.nickname) || cleanNick(claims.preferred_username);
  if (fromClaim) return fromClaim;
  const hit = nickCache.get(claims.sub);
  if (hit && Date.now() - hit.at < NICK_TTL) return hit.nick;
  try {
    const r = await fetch(USERINFO_URL, { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return hit ? hit.nick : null;
    const j = await r.json();
    if (j.sub !== claims.sub) return null;
    const nick = cleanNick(j.nickname) || cleanNick(j.preferred_username);
    if (nickCache.size > 5000) nickCache.clear();
    nickCache.set(claims.sub, { at: Date.now(), nick });
    return nick;
  } catch { return hit ? hit.nick : null; }
}

// ---------- 검증
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const optNum = (v, lo, hi) => v === undefined || v === null || num(v, lo, hi);
const optStr = (v, max) => v === undefined || v === null || (typeof v === "string" && v.length <= max);
const ACTIVITY_TYPES = ["WALK", "HIKE", "RUN", "BIKE", "CAR"];
function validateTrack(t, id, prev = null) {
  const e = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
  if (!t || typeof t !== "object" || Array.isArray(t)) e("body must be object");
  if (t.id !== undefined && t.id !== id) e("id mismatch");
  if (!num(t.updated_at, 0, 4102444800000)) e("updated_at (epoch ms) required");
  if (!optStr(t.title, 200) || !optStr(t.memo, 10000)) e("title/memo");
  for (const k of ["started_at", "ended_at"]) if (!optNum(t[k], 0, 4102444800000)) e(k);
  for (const k of ["distance_m", "duration_s", "elevation_gain_m"]) if (!optNum(t[k], 0, 1e9)) e(k);
  let activity_type = prev?.activity_type ?? null; // 생략하면 기존 값 유지
  if (t.activity_type !== undefined) {
    if (t.activity_type === null) activity_type = null;
    else if (typeof t.activity_type === "string" && ACTIVITY_TYPES.includes(t.activity_type.trim().toUpperCase())) activity_type = t.activity_type.trim().toUpperCase();
    else e("activity_type must be one of " + ACTIVITY_TYPES.join("/") + " or null");
  }
  if (!Array.isArray(t.points) || t.points.length > 200000) e("points[] required (max 200000)");
  for (const pt of t.points) {
    if (!pt || !num(pt.lat, -90, 90) || !num(pt.lon, -180, 180) || !num(pt.t, 0, 4102444800000)) e("point needs lat, lon, t");
    if (!optNum(pt.ele, -1000, 10000) || !optNum(pt.acc, 0, 1e5) || !optNum(pt.spd, 0, 1e4)) e("point ele/acc/spd");
  }
  const wps = t.waypoints ?? [];
  if (!Array.isArray(wps) || wps.length > 5000) e("waypoints[] (max 5000)");
  for (const w of wps) {
    if (!w || typeof w.id !== "string" || !ID_RE.test(w.id) || !num(w.lat, -90, 90) || !num(w.lon, -180, 180) || !optNum(w.t, 0, 4102444800000)) e("waypoint needs id, lat, lon");
    if (!optStr(w.title, 200) || !optStr(w.memo, 10000)) e("waypoint title/memo");
    if (w.photo_local_only !== undefined && typeof w.photo_local_only !== "boolean") e("photo_local_only boolean");
    if (!optNum(w.photo_count, 0, 1000)) e("photo_count");
    for (const k of Object.keys(w)) if (/uri|url|path|base64|image|photo_data/i.test(k)) e(`media field not allowed: ${k}`);
  }
  return {
    id, title: t.title ?? null, memo: t.memo ?? null, activity_type, started_at: t.started_at ?? null, ended_at: t.ended_at ?? null,
    distance_m: t.distance_m ?? null, duration_s: t.duration_s ?? null, elevation_gain_m: t.elevation_gain_m ?? null,
    updated_at: t.updated_at,
    points: t.points.map((p) => ({ lat: p.lat, lon: p.lon, t: p.t, ...(p.ele != null && { ele: p.ele }), ...(p.acc != null && { acc: p.acc }), ...(p.spd != null && { spd: p.spd }) })),
    waypoints: wps.map((w) => ({ id: w.id, lat: w.lat, lon: w.lon, t: w.t ?? null, title: w.title ?? null, memo: w.memo ?? null, photo_local_only: w.photo_local_only ?? false, photo_count: w.photo_count ?? 0 })),
  };
}
const out = (row) => row.deleted
  ? { id: row.id, deleted: true, updated_at: row.updated_at, server_seq: row.server_seq }
  : { activity_type: null, ...JSON.parse(row.body), deleted: false, server_seq: row.server_seq };

// ---------- HTTP
const send = (res, status, obj, extra = {}) => {
  const b = obj === undefined ? "" : JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
  res.end(b);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let n = 0; const chunks = [];
  req.on("data", (c) => { n += c.length; if (n > CFG.maxBody) { reject(Object.assign(new Error("body too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
  req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null")); } catch { reject(Object.assign(new Error("invalid json"), { status: 400 })); } });
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    let path = u.pathname;
    if (CFG.basePath && path.startsWith(CFG.basePath)) path = path.slice(CFG.basePath.length) || "/";
    if (path === "/healthz") return send(res, 200, { ok: true });
    if (path === "/places/search") return handlePlacesSearch(req, res, u, send);
    if (await maps.handle(req, res, path, u)) return;
    if (!path.startsWith("/v1/")) return send(res, 404, { error: "not_found" });

    const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.authorization || "");
    if (!m) return send(res, 401, { error: "invalid_token", error_description: "bearer token required" }, { "www-authenticate": 'Bearer realm="gildam"' });
    let claims;
    try { claims = await verifyAccessToken(m[1]); } catch (e) {
      if (e instanceof AuthError) return send(res, 401, { error: "invalid_token", error_description: e.message }, { "www-authenticate": 'Bearer realm="gildam", error="invalid_token"' });
      throw e;
    }
    const sub = claims.sub, now = Date.now();
    db.prepare("INSERT INTO users (sub, created_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(sub) DO UPDATE SET last_seen_at = excluded.last_seen_at").run(sub, now, now);

    if (path === "/v1/me" && req.method === "GET") {
      const c = db.prepare("SELECT COUNT(*) n, COALESCE(MAX(server_seq),0) s FROM tracks WHERE user_sub=? AND deleted=0").get(sub);
      const user = db.prepare("SELECT created_at FROM users WHERE sub=?").get(sub);
      const nickname = await nicknameFor(claims, m[1]);
      return send(res, 200, { sub, nickname, display_name: nickname || "누니 회원", brand_id: claims.brand_id ?? null, brand_role: claims.brand_role ?? null, created_at: user.created_at, track_count: c.n, cursor: c.s });
    }
    if (path === "/v1/tracks" && req.method === "GET") {
      const since = Number(u.searchParams.get("since") || 0);
      const limit = Math.min(Math.max(Number(u.searchParams.get("limit") || 50), 1), 200);
      if (!Number.isInteger(since) || since < 0) return send(res, 400, { error: "invalid_request", error_description: "since" });
      const rows = db.prepare("SELECT * FROM tracks WHERE user_sub=? AND server_seq>? " + (since === 0 ? "AND deleted=0 " : "") + "ORDER BY server_seq LIMIT ?").all(sub, since, limit + 1);
      const more = rows.length > limit; if (more) rows.pop();
      const cursor = rows.length ? rows[rows.length - 1].server_seq : since;
      return send(res, 200, { items: rows.map(out), cursor, has_more: more });
    }
    const tm = /^\/v1\/tracks\/([^/]+)$/.exec(path);
    if (tm) {
      const id = decodeURIComponent(tm[1]);
      if (!ID_RE.test(id)) return send(res, 400, { error: "invalid_request", error_description: "id must match [A-Za-z0-9_-]{8,64}" });
      const cur = db.prepare("SELECT * FROM tracks WHERE user_sub=? AND id=?").get(sub, id);
      if (req.method === "GET") return cur && !cur.deleted ? send(res, 200, out(cur)) : send(res, 404, { error: "not_found" });
      if (req.method === "PUT") {
        const t = validateTrack(await readBody(req), id, cur && !cur.deleted ? JSON.parse(cur.body) : null);
        if (cur && t.updated_at < cur.updated_at) return send(res, 409, { error: "conflict", error_description: "server has newer version", current: out(cur) });
        const row = tx(() => {
          const seq = nextSeq();
          db.prepare("INSERT INTO tracks (user_sub,id,updated_at,server_seq,deleted,body) VALUES (?,?,?,?,0,?) ON CONFLICT(user_sub,id) DO UPDATE SET updated_at=excluded.updated_at, server_seq=excluded.server_seq, deleted=0, body=excluded.body")
            .run(sub, id, t.updated_at, seq, JSON.stringify(t));
          return db.prepare("SELECT * FROM tracks WHERE user_sub=? AND id=?").get(sub, id);
        });
        return send(res, cur ? 200 : 201, out(row));
      }
      if (req.method === "DELETE") {
        if (!cur || cur.deleted) return send(res, 204);
        const ua = Number(u.searchParams.get("updated_at") || now);
        const row = tx(() => {
          db.prepare("UPDATE tracks SET deleted=1, body=NULL, updated_at=?, server_seq=? WHERE user_sub=? AND id=?").run(Math.max(ua, cur.updated_at), nextSeq(), sub, id);
          return db.prepare("SELECT * FROM tracks WHERE user_sub=? AND id=?").get(sub, id);
        });
        return send(res, 200, out(row));
      }
      return send(res, 405, { error: "method_not_allowed" });
    }
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    if (e.status) return send(res, e.status, { error: "invalid_request", error_description: e.message });
    console.error("error", e?.message);
    return send(res, 500, { error: "server_error" });
  }
});
const maps = createMaps({ db, tx, send, readBody, verifyJwt, AuthError, issuer: CFG.issuer });
server.listen(CFG.port, () => console.log(`gildam-api :${CFG.port} base=${CFG.basePath || "/"} aud=${CFG.audience.join(",")}`));
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => server.close(() => { db.close(); process.exit(0); }));
