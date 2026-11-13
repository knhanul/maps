// Shared browser harness: serves web/public from a fake origin, MOCKS /routing/route, reads public tiles/fonts from maps.nuni.co.kr.
// Env: PLAYWRIGHT_CORE_DIR (dir with node_modules/playwright-core [+ vendor npm pkgs]), CHROME (browser executable), SHOTS_DIR (optional).
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.PLAYWRIGHT_CORE_DIR || process.cwd();
const { chromium } = createRequire(path.join(base, "x.js"))("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url)), pub = path.join(here, "../../web/public");
export const shots = process.env.SHOTS_DIR; if (shots) mkdirSync(shots, { recursive: true });
export const shot = (page, name) => shots ? page.screenshot({ path: path.join(shots, name) }) : null;
const ORIGIN = "http://gildam.test";
// web/public/vendor is not in Git: use the deployed bundle if present, else npm packages under PLAYWRIGHT_CORE_DIR/node_modules.
const nm = path.join(base, "node_modules");
const pick = (name, rel) => existsSync(path.join(pub, "vendor", name)) ? path.join(pub, "vendor", name) : path.join(nm, rel);
const vendor = { "maplibre-gl.js": pick("maplibre-gl.js", "maplibre-gl/dist/maplibre-gl.js"), "maplibre-gl.css": pick("maplibre-gl.css", "maplibre-gl/dist/maplibre-gl.css"), "pmtiles.js": pick("pmtiles.js", "pmtiles/dist/pmtiles.js"), "basemaps.js": pick("basemaps.js", "@protomaps/basemaps/dist/basemaps.js"), "maplibre-contour.js": pick("maplibre-contour.js", "maplibre-contour/dist/index.min.js") };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
export const road = (a, b, off = 0.0003) => [[a[0], a[1], 1], [(a[0] + b[0]) / 2 + off, (a[1] + b[1]) / 2, 1], [b[0], b[1], 1]];

export async function launch() { return chromium.launch({ executablePath: process.env.CHROME, headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }); }
export async function open(browser, viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, acceptDownloads: true });
  // These suites assert the single-point move and the preview-then-apply flow; the app default is now soft move + auto-apply.
  await ctx.addInitScript(() => { try { localStorage.setItem("gildam.move.v1", '{"mode":"single","confirm":true}'); } catch {} });
  const page = await ctx.newPage(), errors = [], calls = [];
  page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
  let impl = async body => ({ status: 200, body: { coordinates: road(body.from, body.to) } });
  await page.route("**/*", async route => {
    const u = new URL(route.request().url());
    if (u.origin === "https://maps.nuni.co.kr" && !u.pathname.startsWith("/routing")) return route.continue(); // public tiles/fonts/sprites only
    if (u.origin !== ORIGIN) return route.abort();
    if (u.pathname === "/routing/route") { const body = JSON.parse(route.request().postData()); calls.push({ body, at: Date.now() }); const r = await impl(body, calls.length); if (r === "abort") return route.abort("failed"); return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) }); }
    if (/^\/styles\/\w+\.json$/.test(u.pathname)) return route.fulfill({ contentType: "application/json", body: readFileSync(path.join(here, "../../styles/generated", path.basename(u.pathname))) });
    const v = u.pathname.startsWith("/vendor/") && vendor[u.pathname.slice(8)];
    if (v) return route.fulfill({ contentType: types[path.extname(v)], body: readFileSync(v) });
    const f = path.join(pub, u.pathname === "/" ? "index.html" : u.pathname);
    if (!f.startsWith(pub) || !existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ contentType: types[path.extname(f)] || "application/octet-stream", body: readFileSync(f) });
  });
  await page.goto(ORIGIN + "/");
  await page.waitForFunction(() => window.__gildamReady && window.__gpxEditor, null, { timeout: 40000 });
  return { ctx, page, errors, calls, setImpl: f => { impl = f; } };
}
export function runner() {
  const results = []; let diag = null;
  const step = async (name, fn) => { try { await fn(); results.push(["PASS", name]); } catch (e) { const at = (e.stack || "").split("\n").find(l => l.includes("e2e.mjs")) || ""; results.push(["FAIL", name, e.message.split("\n").slice(0, 3).join(" ") + " @" + at.trim().slice(-12), diag ? JSON.stringify(await diag().catch(x => x.message)).slice(0, 500) : ""]); } };
  const finish = () => { for (const r of results) console.log(r.join(" | ")); process.exitCode = results.some(r => r[0] === "FAIL") ? 1 : 0; };
  return { step, results, finish, setDiag: f => { diag = f; } };
}
export const benign = e => !/pmtiles|Failed to fetch|NetworkError|sprite|glyph/i.test(e);
