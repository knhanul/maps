// 길담 지도 생성 워커 (OVH 컨테이너 gildam-map-worker / box 공용)
// generate 작업: Protomaps 빌드에서 bbox·maxzoom 추출 → SHA256SUMS → API 검증 요청. 게시는 관리자가 따로 누름.
// 환경: GILDAM_API_URL, GILDAM_WORKER_TOKEN, OUT_DIR(incoming), WORKER_ID, POLL_SEC(0=한 번만), PMTILES(바이너리 경로)
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const E = process.env;
const api = (E.GILDAM_API_URL || "http://gildam-api:8080").replace(/\/$/, ""), tok = E.GILDAM_WORKER_TOKEN;
const OUT = E.OUT_DIR || "/out", PM = E.PMTILES || "pmtiles", WID = E.WORKER_ID || "ovh", POLL = Number(E.POLL_SEC ?? 30);
const BUILDS = "https://build-metadata.protomaps.dev/builds.json", SRC = (k) => `https://build.protomaps.com/${k}`;
const VER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
if (!tok) { console.error("GILDAM_WORKER_TOKEN 없음"); process.exit(1); }

const call = async (p, body) => {
  const r = await fetch(api + "/v1/worker" + p, { method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", "x-worker-id": WID }, body: JSON.stringify(body || {}) });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${p} ${r.status} ${j.error_description || ""}`);
  return j;
};

// 실행: 셸 없이 인자 배열로만. 출력은 로그 버퍼에.
function run(args, onLine) {
  return new Promise((res, rej) => {
    const c = spawn(PM, args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const eat = (d) => { buf += d.toString(); const parts = buf.split(/[\r\n]+/); buf = parts.pop(); parts.filter(Boolean).forEach(onLine); };
    c.stdout.on("data", eat); c.stderr.on("data", eat);
    c.on("error", rej);
    c.on("close", (code) => { if (buf) onLine(buf); code === 0 ? res() : rej(new Error(`pmtiles 종료 코드 ${code}`)); });
  });
}

function checkParams(p) {
  const bbox = p.bbox ?? [124.5, 33.0, 132.0, 38.7];
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === "number" && isFinite(n)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3] || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -85 || bbox[3] > 85) throw new Error("bbox 형식 오류");
  const maxzoom = p.maxzoom ?? 15;
  if (!Number.isInteger(maxzoom) || maxzoom < 0 || maxzoom > 15) throw new Error("maxzoom 은 0–15");
  const build = String(p.build ?? "latest");
  if (build !== "latest" && !/^\d{8}$/.test(build)) throw new Error("build 는 latest 또는 YYYYMMDD");
  if (p.version != null && !VER_RE.test(String(p.version))) throw new Error("version 형식 오류");
  return { bbox, maxzoom, build, version: p.version ? String(p.version) : null, name: (p.region || "korea").replace(/[^a-z0-9-]/gi, "").slice(0, 20) || "map" };
}

async function resolveBuild(b) {
  const list = await (await fetch(BUILDS)).json();
  const keys = list.map((x) => x.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort();
  if (b === "latest") return keys.at(-1);
  if (!keys.includes(`${b}.pmtiles`)) throw new Error(`빌드 ${b} 없음 (최근: ${keys.slice(-3).join(", ")})`);
  return `${b}.pmtiles`;
}

async function sha256(f) { const h = crypto.createHash("sha256"); for await (const c of fs.createReadStream(f)) h.update(c); return h.digest("hex"); }

async function generate(job) {
  const log = []; let last = 0;
  const report = async (progress, message, force) => {
    if (message) { log.push(`${new Date().toISOString().slice(11, 19)} ${message}`); if (log.length > 40) log.shift(); }
    if (!force && Date.now() - last < 5000) return; last = Date.now();
    await call(`/jobs/${job.id}`, { status: "running", progress, message: log.join("\n").slice(-1900) }).catch(() => {});
  };
  const p = checkParams(job.params || {});
  const key = await resolveBuild(p.build);
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, ".");
  let version = p.version;
  if (!version) { for (let i = 1; i < 100; i++) { version = `${day}-${p.name}${i}`; if (!fs.existsSync(path.join(OUT, version))) break; } }
  const dir = path.join(OUT, version), tmp = path.join(OUT, `.tmp-${version}`);
  if (fs.existsSync(dir)) throw new Error(`이미 있는 버전 ${version}`);
  await report(0.01, `빌드 ${key}, bbox ${p.bbox.join(",")}, z0–${p.maxzoom}, 버전 ${version}`, true);

  // 1) 크기 추정 (dry-run) → 디스크 확인: 여유 < 크기×2 + 5GB 면 거부
  let est = 0;
  await run(["extract", SRC(key), "/dev/null", `--bbox=${p.bbox.join(",")}`, `--maxzoom=${p.maxzoom}`, "--dry-run"], (l) => { const m = /archive size of ([\d.]+) (\w+)/.exec(l); if (m) est = +m[1] * ({ B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9 }[m[2]] || 1e6); });
  const st = await fsp.statfs(OUT), free = st.bavail * st.bsize, need = est * 2 + 5e9;
  await report(0.05, `예상 크기 ${(est / 1e6).toFixed(0)} MB, 디스크 여유 ${(free / 1e9).toFixed(1)} GB (필요 ${(need / 1e9).toFixed(1)} GB)`, true);
  if (!est) throw new Error("크기 추정 실패");
  if (free < need) throw new Error(`디스크 부족: 여유 ${(free / 1e9).toFixed(1)} GB < 필요 ${(need / 1e9).toFixed(1)} GB`);

  // 2) 추출 (임시 폴더 → 완료 후 이름 바꿔서 incoming 에 나타나게)
  await fsp.rm(tmp, { recursive: true, force: true }); await fsp.mkdir(tmp, { recursive: true });
  try {
    await run(["extract", SRC(key), path.join(tmp, "gildam.pmtiles"), `--bbox=${p.bbox.join(",")}`, `--maxzoom=${p.maxzoom}`, "--download-threads=2"], (l) => {
      const m = /(\d{1,3})%/.exec(l);
      const pr = m ? 0.05 + 0.85 * (+m[1] / 100) : undefined;
      if (m) report(pr, null); else report(undefined, l.slice(0, 200));
    });
    await report(0.9, "추출 완료, SHA256 계산 중", true);
    await fsp.writeFile(path.join(tmp, "release.json"), JSON.stringify({ attribution: "© OpenStreetMap contributors · © Protomaps", source: SRC(key), bbox: p.bbox, maxzoom: p.maxzoom, job: job.id }) + "\n");
    const sums = [];
    for (const f of ["gildam.pmtiles", "release.json"]) sums.push(`${await sha256(path.join(tmp, f))}  ${f}`);
    await fsp.writeFile(path.join(tmp, "SHA256SUMS"), sums.join("\n") + "\n");
    await fsp.rename(tmp, dir);
  } catch (e) { await fsp.rm(tmp, { recursive: true, force: true }); throw e; }
  const size = (await fsp.stat(path.join(dir, "gildam.pmtiles"))).size;
  await report(0.95, `업로드 폴더에 저장 (${(size / 1e6).toFixed(0)} MB), 서버 검증 요청`, true);
  const v = await call(`/releases/${encodeURIComponent(version)}/verify`);
  return { version, size, build: key, bbox: p.bbox, maxzoom: p.maxzoom, verify: v?.status ?? v };
}

async function once() {
  const job = await call("/jobs/claim", { types: ["generate"] });
  if (!job) return false;
  console.log("claimed", job.id, JSON.stringify(job.params));
  try {
    const result = await generate(job);
    await call(`/jobs/${job.id}`, { status: "done", progress: 1, message: `완료: ${result.version} — 관리 화면에서 검증 결과 확인 후 게시하세요`, result });
    console.log("done", job.id, result.version);
  } catch (e) {
    console.error("failed", job.id, e.message);
    await call(`/jobs/${job.id}`, { status: "failed", message: String(e.message).slice(0, 1900) }).catch(() => {});
  }
  return true;
}

if (!POLL) { await once(); process.exit(0); }
for (;;) {
  try { while (await once()); } catch (e) { console.error("poll", e.message); }
  await new Promise((r) => setTimeout(r, POLL * 1000));
}
