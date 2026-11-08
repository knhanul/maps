// 길담 지도 관리 (stage 1): 릴리스 검증·게시·롤백, 생성 작업 큐, 공개 manifest, 관리 웹 (NUNI ID BFF 로그인)
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const E = process.env;
const M = {
  root: E.MAPS_ROOT || "/srv/gildam-maps",
  publicUrl: (E.MAPS_PUBLIC_URL || "https://maps.nuni.co.kr").replace(/\/$/, ""),
  adminClientId: E.ADMIN_CLIENT_ID || "gildam-admin-web",
  workerTokenSha256: (E.WORKER_TOKEN_SHA256 || "").toLowerCase(),
  attribution: E.MAPS_ATTRIBUTION || "© OpenStreetMap contributors · © Protomaps",
  styleName: E.MAPS_STYLE || "gildam.json",
  sessionHours: 8,
  keepOnDisk: 2, // current + previous. 그보다 오래된 것은 NAS 보관 전까지 pending_archive 로 남김
};
const VER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const err = (status, msg) => Object.assign(new Error(msg), { status });

export function createMaps({ db, tx, send, readBody, verifyJwt, AuthError, issuer }) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS map_releases (
    version TEXT PRIMARY KEY,
    status TEXT NOT NULL,            -- incoming|verifying|verified|failed|current|previous|pending_archive|archived|deleted
    files TEXT, info TEXT, error TEXT,
    size_bytes INTEGER,
    created_at INTEGER NOT NULL, verified_at INTEGER, published_at INTEGER,
    archive_ref TEXT, archived_at INTEGER, deleted_at INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS map_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,              -- generate|archive|restore
    params TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'queued', -- queued|running|done|failed|cancelled
    progress REAL, message TEXT, result TEXT,
    created_by TEXT, worker_id TEXT,
    created_at INTEGER NOT NULL, claimed_at INTEGER, heartbeat_at INTEGER, finished_at INTEGER, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS map_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT, action TEXT NOT NULL, version TEXT, detail TEXT);
  CREATE TABLE IF NOT EXISTS admin_sessions (id_hash TEXT PRIMARY KEY, sub TEXT NOT NULL, role TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS admin_login_states (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, created_at INTEGER NOT NULL);
  `);
  if (!db.prepare("PRAGMA table_info(admin_sessions)").all().some((c) => c.name === "nickname")) db.exec("ALTER TABLE admin_sessions ADD COLUMN nickname TEXT");
  const ev = (actor, action, version, detail) => db.prepare("INSERT INTO map_events (at, actor, action, version, detail) VALUES (?,?,?,?,?)").run(Date.now(), actor, action, version ?? null, detail ? JSON.stringify(detail) : null);
  const getRel = (v) => db.prepare("SELECT * FROM map_releases WHERE version=?").get(v);
  const setRel = (v, fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE map_releases SET ${keys.map((k) => `${k}=?`).join(",")}, updated_at=? WHERE version=?`).run(...keys.map((k) => fields[k]), Date.now(), v);
  };
  const P = {
    incoming: (v) => path.join(M.root, "incoming", v),
    release: (v) => path.join(M.root, "releases", v),
    current: path.join(M.root, "current"),
  };
  const currentVersion = () => { try { return path.basename(fs.readlinkSync(P.current)); } catch { return null; } };

  // 디스크와 DB 를 맞춘다 (업로드된 incoming 을 등록, 사라진 것은 표시)
  function scan() {
    const now = Date.now();
    for (const [dir, st] of [["incoming", "incoming"], ["releases", "verified"]]) {
      let names = [];
      try { names = fs.readdirSync(path.join(M.root, dir), { withFileTypes: true }).filter((d) => d.isDirectory() && VER_RE.test(d.name)).map((d) => d.name); } catch {}
      for (const v of names) if (!getRel(v)) db.prepare("INSERT INTO map_releases (version,status,created_at,updated_at) VALUES (?,?,?,?)").run(v, st, now, now);
    }
    const cur = currentVersion();
    if (cur && getRel(cur) && getRel(cur).status !== "current") {
      db.prepare("UPDATE map_releases SET status='previous', updated_at=? WHERE status='current'").run(now);
      setRel(cur, { status: "current" });
    }
  }
  const listReleases = () => { scan(); return db.prepare("SELECT * FROM map_releases WHERE status!='deleted' ORDER BY created_at DESC").all().map(relOut); };
  const relOut = (r) => ({
    version: r.version, status: r.status, size_bytes: r.size_bytes, error: r.error,
    files: r.files ? JSON.parse(r.files) : null, info: r.info ? JSON.parse(r.info) : null,
    created_at: iso(r.created_at), verified_at: iso(r.verified_at), published_at: iso(r.published_at),
    archive_ref: r.archive_ref, archived_at: iso(r.archived_at),
    location: r.status === "incoming" || r.status === "verifying" || r.status === "failed" || (r.status === "verified" && fs.existsSync(P.incoming(r.version))) ? "incoming" : r.status === "archived" && !fs.existsSync(P.release(r.version)) ? "nas" : "releases",
  });

  // PMTiles v3 헤더 (127 바이트)
  async function pmtilesHeader(file) {
    const fh = await fsp.open(file, "r");
    try {
      const b = Buffer.alloc(127);
      const { bytesRead } = await fh.read(b, 0, 127, 0);
      if (bytesRead < 127 || b.toString("latin1", 0, 7) !== "PMTiles") throw new Error("PMTiles 매직 없음");
      if (b[7] !== 3) throw new Error(`PMTiles 버전 ${b[7]} (3 필요)`);
      const types = ["unknown", "mvt", "png", "jpeg", "webp", "avif"];
      return {
        spec_version: 3, tile_type: types[b[99]] || String(b[99]), min_zoom: b[100], max_zoom: b[101],
        bounds: [b.readInt32LE(102) / 1e7, b.readInt32LE(106) / 1e7, b.readInt32LE(110) / 1e7, b.readInt32LE(114) / 1e7],
        center: [b.readInt32LE(119) / 1e7, b.readInt32LE(123) / 1e7, b[118]],
        addressed_tiles: Number(b.readBigUInt64LE(72)),
      };
    } finally { await fh.close(); }
  }
  const hashFile = (file) => new Promise((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file, { highWaterMark: 1 << 20 }).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });

  const verifying = new Set();
  async function verify(v, actor) {
    const r = getRel(v);
    if (!r) throw err(404, "release not found");
    if (!["incoming", "failed", "verified"].includes(r.status) || !fs.existsSync(P.incoming(v))) throw err(409, `incoming 상태만 검증할 수 있습니다 (현재 ${r.status})`);
    if (verifying.has(v)) throw err(409, "이미 검증 중");
    verifying.add(v);
    setRel(v, { status: "verifying", error: null });
    ev(actor, "verify_start", v);
    (async () => {
      const dir = P.incoming(v);
      try {
        const sums = await fsp.readFile(path.join(dir, "SHA256SUMS"), "utf8").catch(() => { throw new Error("SHA256SUMS 없음"); });
        const listed = new Map();
        for (const line of sums.split(/\r?\n/).filter((l) => l.trim())) {
          const m = /^([0-9a-fA-F]{64}) [ *]?(.+)$/.exec(line.trim());
          if (!m) throw new Error(`SHA256SUMS 형식 오류: ${line.slice(0, 80)}`);
          const name = m[2].replace(/^\.\//, "");
          if (name.includes("/") || name.startsWith(".")) throw new Error(`허용되지 않는 파일명: ${name}`);
          listed.set(name, m[1].toLowerCase());
        }
        const present = (await fsp.readdir(dir, { withFileTypes: true })).filter((d) => !d.name.startsWith("."));
        for (const d of present) {
          if (!d.isFile()) throw new Error(`파일이 아닌 항목: ${d.name}`);
          if (d.name !== "SHA256SUMS" && !listed.has(d.name)) throw new Error(`SHA256SUMS 에 없는 파일: ${d.name}`);
        }
        const pm = [...listed.keys()].filter((n) => n.endsWith(".pmtiles"));
        if (!pm.length) throw new Error(".pmtiles 파일이 없습니다");
        const files = []; let total = 0;
        for (const [name, want] of listed) {
          const f = path.join(dir, name);
          const st = await fsp.stat(f).catch(() => { throw new Error(`파일 없음: ${name}`); });
          const got = await hashFile(f);
          if (got !== want) throw new Error(`SHA256 불일치: ${name}`);
          files.push({ name, size: st.size, sha256: got }); total += st.size;
        }
        const info = { pmtiles: {} };
        for (const n of pm) info.pmtiles[n] = await pmtilesHeader(path.join(dir, n));
        try { const rj = JSON.parse(await fsp.readFile(path.join(dir, "release.json"), "utf8")); if (rj && typeof rj === "object") info.release = rj; } catch {}
        setRel(v, { status: "verified", files: JSON.stringify(files), info: JSON.stringify(info), size_bytes: total, verified_at: Date.now(), error: null });
        ev(actor, "verify_ok", v, { size: total });
      } catch (e) {
        setRel(v, { status: "failed", error: String(e.message).slice(0, 500) });
        ev(actor, "verify_failed", v, { error: e.message });
      } finally { verifying.delete(v); }
    })();
    return relOut(getRel(v));
  }

  function swapCurrent(v) {
    const tmp = path.join(M.root, `.current.tmp-${crypto.randomBytes(4).toString("hex")}`);
    fs.symlinkSync(path.join("releases", v), tmp);
    fs.renameSync(tmp, P.current); // 원자적 교체
  }
  function publish(v, actor) {
    scan();
    const r = getRel(v);
    if (!r) throw err(404, "release not found");
    if (r.status !== "verified" || !fs.existsSync(P.incoming(v))) throw err(409, `검증 완료(incoming) 릴리스만 게시할 수 있습니다 (현재 ${r.status})`);
    if (fs.existsSync(P.release(v))) throw err(409, "releases 에 같은 버전이 이미 있습니다");
    const pending = db.prepare("SELECT version FROM map_releases WHERE status='pending_archive'").all();
    if (pending.length) throw err(409, `NAS 보관 대기 중인 버전이 있어 게시를 막았습니다: ${pending.map((p) => p.version).join(", ")} — 보관(archive) 후 다시 시도`);
    const cur = db.prepare("SELECT version FROM map_releases WHERE status='current'").get();
    const prev = db.prepare("SELECT version FROM map_releases WHERE status='previous'").get();
    fs.renameSync(P.incoming(v), P.release(v));
    try { swapCurrent(v); } catch (e) { fs.renameSync(P.release(v), P.incoming(v)); throw e; }
    tx(() => {
      if (prev) setRel(prev.version, { status: "pending_archive" });
      if (cur) setRel(cur.version, { status: "previous" });
      setRel(v, { status: "current", published_at: Date.now() });
    });
    ev(actor, "publish", v, { previous: cur?.version ?? null, pending_archive: prev?.version ?? null });
    if (prev) enqueue("archive", { version: prev.version, path: P.release(prev.version) }, "system");
    return relOut(getRel(v));
  }
  function rollback(actor) {
    scan();
    const cur = db.prepare("SELECT version FROM map_releases WHERE status='current'").get();
    const prev = db.prepare("SELECT version FROM map_releases WHERE status='previous'").get();
    if (!prev || !fs.existsSync(P.release(prev.version))) throw err(409, "되돌릴 이전 버전이 없습니다");
    swapCurrent(prev.version);
    tx(() => { setRel(prev.version, { status: "current" }); if (cur) setRel(cur.version, { status: "previous" }); });
    ev(actor, "rollback", prev.version, { from: cur?.version ?? null });
    return { current: prev.version, previous: cur?.version ?? null };
  }
  // NAS 보관 훅: 워커가 NAS 복사·검증을 마친 뒤 호출 → 그때부터 디스크 삭제 가능
  function markArchived(v, ref, actor) {
    const r = getRel(v);
    if (!r) throw err(404, "release not found");
    if (!["pending_archive", "archived", "previous", "current", "verified"].includes(r.status)) throw err(409, `보관 표시 불가 상태: ${r.status}`);
    if (typeof ref !== "string" || !ref || ref.length > 500) throw err(400, "archive_ref 필요");
    setRel(v, { archive_ref: ref, archived_at: Date.now(), ...(r.status === "pending_archive" && { status: "archived" }) });
    ev(actor, "archived", v, { archive_ref: ref });
    return relOut(getRel(v));
  }
  function removeFromDisk(v, actor) {
    const r = getRel(v);
    if (!r) throw err(404, "release not found");
    if (["current", "previous"].includes(r.status)) throw err(409, "current/previous 는 삭제할 수 없습니다");
    if (["pending_archive"].includes(r.status) || (r.status === "archived" && !r.archived_at)) throw err(409, "NAS 보관 완료 전에는 삭제할 수 없습니다");
    if (r.status === "archived") fs.rmSync(P.release(v), { recursive: true, force: true });
    else if (["incoming", "failed", "verified"].includes(r.status)) fs.rmSync(P.incoming(v), { recursive: true, force: true });
    else throw err(409, `삭제 불가 상태: ${r.status}`);
    if (r.status !== "archived") setRel(v, { status: "deleted", deleted_at: Date.now() });
    ev(actor, "remove_disk", v);
    return relOut(getRel(v));
  }

  function checkGenerate(p) {
    const bbox = p.bbox ?? [124.5, 33.0, 132.0, 38.7];
    if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === "number" && isFinite(n)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -85 || bbox[3] > 85) throw err(400, "bbox 는 [서경,남위,동경,북위] 숫자 4개");
    const maxzoom = p.maxzoom ?? 15;
    if (!Number.isInteger(maxzoom) || maxzoom < 0 || maxzoom > 15) throw err(400, "maxzoom 은 0–15 정수");
    const build = String(p.build ?? "latest");
    if (build !== "latest" && !/^\d{8}$/.test(build)) throw err(400, "build 는 latest 또는 YYYYMMDD");
    if (p.version != null && !VER_RE.test(String(p.version))) throw err(400, "version 형식");
    const region = String(p.region || "korea").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "map";
    return { build, bbox, maxzoom, region, ...(p.version != null && { version: String(p.version) }) };
  }
  function enqueue(type, params, by) {
    if (!["generate", "archive", "restore"].includes(type)) throw err(400, "type 은 generate|archive|restore");
    if (type === "generate") params = checkGenerate(params || {});
    const now = Date.now();
    const r = db.prepare("INSERT INTO map_jobs (type, params, created_by, created_at, updated_at) VALUES (?,?,?,?,?)").run(type, JSON.stringify(params || {}), by, now, now);
    return jobOut(db.prepare("SELECT * FROM map_jobs WHERE id=?").get(r.lastInsertRowid));
  }
  const jobOut = (j) => j && ({ ...j, params: JSON.parse(j.params || "{}"), result: j.result ? JSON.parse(j.result) : null,
    created_at: iso(j.created_at), claimed_at: iso(j.claimed_at), heartbeat_at: iso(j.heartbeat_at), finished_at: iso(j.finished_at), updated_at: iso(j.updated_at) });

  // 지형(DEM) — 지도 릴리스와 별도: /srv/gildam-maps/terrain/terrain.json {version,file,encoding,tile_size,max_zoom,bounds,attribution}
  let terrainCache = { at: 0, v: null };
  function terrain() {
    if (Date.now() - terrainCache.at > 60e3) {
      let v = null;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(M.root, "terrain", "terrain.json"), "utf8"));
        if (VER_RE.test(t.version) && /^[A-Za-z0-9._-]+\.pmtiles$/.test(t.file) && fs.existsSync(path.join(M.root, "terrain", t.version, t.file)))
          v = { url: `${M.publicUrl}/tiles/terrain/${encodeURIComponent(t.version)}/${encodeURIComponent(t.file)}`, version: t.version, encoding: t.encoding || "terrarium", tile_size: t.tile_size || 512, max_zoom: t.max_zoom ?? 12, bounds: t.bounds ?? null, attribution: t.attribution || "" };
      } catch {}
      terrainCache = { at: Date.now(), v };
    }
    return terrainCache.v ? { terrain_url: terrainCache.v.url, terrain: terrainCache.v } : {};
  }
  let stylesCache = { at: 0, v: null };
  function styleList() {
    if (Date.now() - stylesCache.at > 60e3) {
      let v = null;
      try { const j = JSON.parse(fs.readFileSync(path.join(M.root, "styles", "index.json"), "utf8")); v = (j.items || []).filter((x) => /^[a-z0-9-]{1,32}$/.test(x.id)).map((x) => ({ id: x.id, name: String(x.name).slice(0, 20), url: `${M.publicUrl}/styles/${x.id}.json` })); v = v.length ? { styles: v, default_style: j.default || v[0].id } : null; } catch {}
      stylesCache = { at: Date.now(), v };
    }
    return stylesCache.v || {};
  }
  function manifest() {
    scan();
    const r = db.prepare("SELECT * FROM map_releases WHERE status='current'").get();
    if (!r) return null;
    const info = r.info ? JSON.parse(r.info) : {};
    const files = r.files ? JSON.parse(r.files) : [];
    const pm = files.find((f) => f.name.endsWith(".pmtiles"));
    const h = pm ? info.pmtiles?.[pm.name] : null;
    return {
      version: r.version,
      style_url: `${M.publicUrl}/styles/${M.styleName}`,
      tiles_url: pm ? `${M.publicUrl}/tiles/${encodeURIComponent(r.version)}/${encodeURIComponent(pm.name)}` : null,
      tiles_sha256: pm?.sha256 ?? null, tiles_size: pm?.size ?? null,
      attribution: info.release?.attribution || M.attribution,
      updated_at: iso(r.published_at),
      bounds: h?.bounds ?? null, min_zoom: h?.min_zoom ?? null, max_zoom: h?.max_zoom ?? null,
      ...terrain(), ...styleList(),
    };
  }

  // ---------- 인증
  const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf("="); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
  const COOKIE = "__Host-gildam_admin";
  function adminSession(req) {
    const sid = cookies(req)[COOKIE];
    if (!sid) return null;
    const s = db.prepare("SELECT * FROM admin_sessions WHERE id_hash=?").get(sha256(sid));
    if (!s || s.expires_at < Date.now()) return null;
    return s;
  }
  function workerAuth(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
    if (!m || !M.workerTokenSha256) return false;
    const a = Buffer.from(sha256(m[1])), b = Buffer.from(M.workerTokenSha256);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const redirectUri = () => `${M.publicUrl}/admin/callback`;
  const redirect = (res, loc, extra = {}) => { res.writeHead(302, { location: loc, "cache-control": "no-store", ...extra }); res.end(); };
  const html = (res, status, body) => { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://build-metadata.protomaps.dev; frame-ancestors 'none'", "x-frame-options": "DENY" }); res.end(body); };

  async function login(res) {
    const state = crypto.randomBytes(24).toString("base64url"), nonce = crypto.randomBytes(24).toString("base64url"), verifier = crypto.randomBytes(48).toString("base64url");
    db.prepare("DELETE FROM admin_login_states WHERE created_at < ?").run(Date.now() - 15 * 60e3);
    db.prepare("INSERT INTO admin_login_states (state, verifier, nonce, created_at) VALUES (?,?,?,?)").run(state, verifier, nonce, Date.now());
    const q = new URLSearchParams({ response_type: "code", client_id: M.adminClientId, redirect_uri: redirectUri(), scope: "openid", state, nonce,
      code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", idp_hint: "kakao" });
    redirect(res, `${issuer}/oauth/authorize?${q}`);
  }
  async function callback(res, u) {
    if (u.searchParams.get("error")) return html(res, 403, page("로그인 취소", `<p>로그인이 취소됐어요 (${esc(u.searchParams.get("error"))}). <a href="/admin/login">다시 로그인</a></p>`));
    const st = db.prepare("SELECT * FROM admin_login_states WHERE state=?").get(u.searchParams.get("state") || "");
    if (!st || st.created_at < Date.now() - 10 * 60e3) return html(res, 400, page("오류", `<p>로그인 요청이 만료됐어요. <a href="/admin/login">다시 로그인</a></p>`));
    db.prepare("DELETE FROM admin_login_states WHERE state=?").run(st.state);
    const r = await fetch(`${issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ grant_type: "authorization_code", code: u.searchParams.get("code") || "", redirect_uri: redirectUri(), client_id: M.adminClientId, code_verifier: st.verifier }) });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) return html(res, 502, page("오류", `<p>토큰 교환 실패 (${esc(tok.error || r.status)})</p>`));
    let c;
    try { c = await verifyJwt(tok.id_token, { audience: [M.adminClientId], typ: "JWT", nonce: st.nonce }); } catch (e) { return html(res, 401, page("오류", `<p>ID 토큰 검증 실패</p>`)); }
    const role = c.platform_admin ? "platform_admin" : c.brand_role === "brand_admin" ? "brand_admin" : null;
    if (!role) { ev(c.sub, "admin_login_denied", null); return html(res, 403, page("권한 없음", `<p>길담 지도 관리 권한이 없는 계정이에요.</p>`)); }
    const sid = crypto.randomBytes(32).toString("base64url");
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(Date.now());
    const nick = typeof c.nickname === "string" && c.nickname.trim() ? c.nickname.trim().slice(0, 40) : null;
    db.prepare("INSERT INTO admin_sessions (id_hash, sub, role, nickname, created_at, expires_at) VALUES (?,?,?,?,?,?)").run(sha256(sid), c.sub, role, nick, Date.now(), Date.now() + M.sessionHours * 3600e3);
    ev(c.sub, "admin_login", null, { role });
    redirect(res, "/admin/", { "set-cookie": `${COOKIE}=${sid}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${M.sessionHours * 3600}` });
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const page = (title, body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · 길담 지도</title><link rel="stylesheet" href="/admin/admin.css"></head><body><main><h1>길담 지도 관리</h1>${body}</main></body></html>`;

  const STATIC = path.join(path.dirname(new URL(import.meta.url).pathname), "admin");
  const CORS = { "access-control-allow-origin": "*" };

  // ---------- 라우터
  return {
    async handle(req, res, p, u) {
      const m = req.method;
      // 공개
      if (p === "/v1/map/manifest") {
        if (m === "OPTIONS") { res.writeHead(204, { ...CORS, "access-control-allow-methods": "GET", "access-control-max-age": "86400" }); return res.end(), true; }
        const mf = manifest();
        send(res, mf ? 200 : 404, mf || { error: "no_release" }, { ...CORS, "cache-control": "public, max-age=60" });
        return true;
      }
      // 관리 웹
      if (p === "/admin") return redirect(res, "/admin/"), true;
      if (p === "/admin/login") return await login(res), true;
      if (p === "/admin/callback") return await callback(res, u), true;
      if (p === "/admin/logout") {
        const sid = cookies(req)[COOKIE];
        if (sid) db.prepare("DELETE FROM admin_sessions WHERE id_hash=?").run(sha256(sid));
        redirect(res, `${issuer}/oauth/end_session?client_id=${encodeURIComponent(M.adminClientId)}&post_logout_redirect_uri=${encodeURIComponent(M.publicUrl + "/admin/")}`, { "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` });
        return true;
      }
      // 코스 도구 (관리자 전용 페이지, GPX 는 브라우저 안에서만 처리)
      if (p === "/admin/course" || p === "/admin/merge") {
        if (!adminSession(req)) return redirect(res, "/admin/"), true;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; child-src blob:; frame-ancestors 'none'" });
        res.end(fs.readFileSync(path.join(STATIC, p === "/admin/course" ? "course.html" : "merge.html")));
        return true;
      }
      if (["/admin/tools.css", "/admin/gpxlib.js", "/admin/course.js", "/admin/merge.js"].includes(p)) {
        res.writeHead(200, { "content-type": p.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "cache-control": "no-cache" });
        res.end(fs.readFileSync(path.join(STATIC, path.basename(p))));
        return true;
      }
      if (p === "/admin/" || p === "/admin/admin.js" || p === "/admin/admin.css") {
        if (p === "/admin/") {
          const s = adminSession(req);
          if (!s) return html(res, 200, page("로그인", `<p>관리자만 쓸 수 있어요.</p><p><a class="btn" href="/admin/login">카카오로 로그인</a></p>`)), true;
          return html(res, 200, page("관리", `<p class="who">로그인: <b>${esc(s.nickname || "누니 회원")}</b> (${s.role === "platform_admin" ? "전체 관리자" : "길담 관리자"}) · <a href="/admin/course">코스 만들기</a> · <a href="/admin/merge">이어 붙이기·자르기</a> · <a href="/admin/logout">로그아웃</a></p><div id="app">불러오는 중…</div><script src="/admin/admin.js"></script>`)), true;
        }
        const f = path.join(STATIC, path.basename(p));
        res.writeHead(200, { "content-type": p.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "cache-control": "no-cache" });
        res.end(fs.readFileSync(f));
        return true;
      }
      // 관리 API (세션 쿠키 + 변경 요청은 X-Gildam-Admin 헤더로 CSRF 방지)
      if (p.startsWith("/v1/admin/")) {
        const s = adminSession(req);
        if (!s) return send(res, 401, { error: "login_required" }), true;
        if (m !== "GET" && req.headers["x-gildam-admin"] !== "1") return send(res, 403, { error: "csrf" }), true;
        const actor = `admin:${s.sub}`;
        await route(req, res, p.slice("/v1/admin".length), m, u, actor, true);
        return true;
      }
      // 워커 API (box 워커 토큰)
      if (p.startsWith("/v1/worker/")) {
        if (!workerAuth(req)) return send(res, 401, { error: "invalid_worker_token" }, { "www-authenticate": 'Bearer realm="gildam-worker"' }), true;
        await route(req, res, p.slice("/v1/worker".length), m, u, `worker:${String(req.headers["x-worker-id"] || "box").slice(0, 40)}`, false);
        return true;
      }
      return false;
    },
  };

  async function route(req, res, p, m, u, actor, isAdmin) {
    try {
      let mm;
      if (p === "/releases" && m === "GET") return send(res, 200, { current: currentVersion(), items: listReleases(), keep_on_disk: M.keepOnDisk });
      if ((mm = /^\/releases\/([^/]+)\/(verify|publish|archived|remove)$/.exec(p)) && m === "POST") {
        const v = decodeURIComponent(mm[1]);
        if (!VER_RE.test(v)) throw err(400, "version 형식");
        scan();
        if (mm[2] === "verify") return send(res, 202, await verify(v, actor));
        if (!isAdmin && mm[2] !== "archived") throw err(403, "관리자 전용");
        if (mm[2] === "publish") return send(res, 200, publish(v, actor));
        if (mm[2] === "archived") { const b = (await readBody(req)) || {}; return send(res, 200, markArchived(v, b.archive_ref, actor)); }
        if (mm[2] === "remove") return send(res, 200, removeFromDisk(v, actor));
      }
      if (p === "/rollback" && m === "POST") { if (!isAdmin) throw err(403, "관리자 전용"); return send(res, 200, rollback(actor)); }
      if ((mm = /^\/releases\/([^/]+)\/restore$/.exec(p)) && m === "POST") {
        if (!isAdmin) throw err(403, "관리자 전용");
        const r = getRel(decodeURIComponent(mm[1]));
        if (!r || !r.archive_ref) throw err(409, "NAS 보관 기록이 없습니다");
        return send(res, 202, enqueue("restore", { version: r.version, archive_ref: r.archive_ref }, actor));
      }
      if (p === "/jobs" && m === "GET") return send(res, 200, { items: db.prepare("SELECT * FROM map_jobs ORDER BY id DESC LIMIT 100").all().map(jobOut) });
      if (p === "/jobs" && m === "POST") {
        if (!isAdmin) throw err(403, "관리자 전용");
        const b = (await readBody(req)) || {};
        if (b.params && (typeof b.params !== "object" || JSON.stringify(b.params).length > 20000)) throw err(400, "params");
        const j = enqueue(b.type || "generate", b.params || {}, actor); ev(actor, "job_create", null, { id: j.id, type: j.type });
        return send(res, 201, j);
      }
      if ((mm = /^\/jobs\/(\d+)\/cancel$/.exec(p)) && m === "POST" && isAdmin) {
        db.prepare("UPDATE map_jobs SET status='cancelled', finished_at=?, updated_at=? WHERE id=? AND status IN ('queued','running')").run(Date.now(), Date.now(), Number(mm[1]));
        return send(res, 200, jobOut(db.prepare("SELECT * FROM map_jobs WHERE id=?").get(Number(mm[1]))));
      }
      if (p === "/events" && m === "GET") return send(res, 200, { items: db.prepare("SELECT * FROM map_events ORDER BY id DESC LIMIT 100").all().map((e) => ({ ...e, at: iso(e.at), detail: e.detail ? JSON.parse(e.detail) : null })) });
      // 워커 전용: 작업 가져가기·상태 보고
      if (!isAdmin && p === "/jobs/claim" && m === "POST") {
        const b = (await readBody(req)) || {};
        const types = Array.isArray(b.types) && b.types.length ? b.types.filter((t) => typeof t === "string") : ["generate"];
        const now = Date.now();
        const j = tx(() => {
          const row = db.prepare(`SELECT * FROM map_jobs WHERE status='queued' AND type IN (${types.map(() => "?").join(",")}) ORDER BY id LIMIT 1`).get(...types);
          if (!row) return null;
          db.prepare("UPDATE map_jobs SET status='running', worker_id=?, claimed_at=?, heartbeat_at=?, updated_at=? WHERE id=?").run(actor, now, now, now, row.id);
          return db.prepare("SELECT * FROM map_jobs WHERE id=?").get(row.id);
        });
        if (!j) { res.writeHead(204); res.end(); return; }
        ev(actor, "job_claim", null, { id: j.id });
        return send(res, 200, jobOut(j));
      }
      if (!isAdmin && (mm = /^\/jobs\/(\d+)$/.exec(p)) && m === "POST") {
        const b = (await readBody(req)) || {};
        const id = Number(mm[1]);
        const j = db.prepare("SELECT * FROM map_jobs WHERE id=?").get(id);
        if (!j) throw err(404, "job not found");
        if (j.status !== "running") throw err(409, `job 상태 ${j.status}`);
        const status = ["running", "done", "failed"].includes(b.status) ? b.status : "running";
        const now = Date.now();
        db.prepare("UPDATE map_jobs SET status=?, progress=?, message=?, result=?, heartbeat_at=?, finished_at=?, updated_at=? WHERE id=?").run(
          status, typeof b.progress === "number" ? b.progress : j.progress, typeof b.message === "string" ? b.message.slice(0, 2000) : j.message,
          b.result !== undefined ? JSON.stringify(b.result).slice(0, 20000) : j.result, now, status === "running" ? null : now, now, id);
        if (status !== "running") ev(actor, `job_${status}`, null, { id });
        return send(res, 200, jobOut(db.prepare("SELECT * FROM map_jobs WHERE id=?").get(id)));
      }
      return send(res, 404, { error: "not_found" });
    } catch (e) {
      if (e.status) return send(res, e.status, { error: "request_failed", error_description: e.message });
      console.error("maps error", e?.message);
      return send(res, 500, { error: "server_error", error_description: e?.code || "internal" });
    }
  }
}
