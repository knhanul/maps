// 로컬 시험용 프록시: /vendor → web/public, /v1/map/manifest·/tiles·/styles·/fonts·/sprites → 실서버(읽기), 나머지 → 로컬 gildam-api
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const WEB = "/workspace/gildam-api/web/public", ORIGIN = "http://localhost:18090", REAL = "https://maps.nuni.co.kr";
http.createServer(async (req, res) => {
  const u = new URL(req.url, ORIGIN);
  try {
    if (u.pathname.startsWith("/vendor/")) { const f = path.join(WEB, path.normalize(u.pathname)); res.writeHead(200, { "content-type": f.endsWith(".css") ? "text/css" : "text/javascript" }); return res.end(fs.readFileSync(f)); }
    if (/^\/(v1\/map\/manifest|tiles\/|styles\/|fonts\/|sprites\/)/.test(u.pathname)) {
      const r = await fetch(REAL + u.pathname, { headers: req.headers.range ? { range: req.headers.range } : {} });
      const h = { "content-type": r.headers.get("content-type") || "application/octet-stream" }; for (const k of ["content-range", "accept-ranges", "etag"]) if (r.headers.get(k)) h[k] = r.headers.get(k);
      let body = Buffer.from(await r.arrayBuffer());
      if (u.pathname === "/v1/map/manifest" || u.pathname.startsWith("/styles/")) body = Buffer.from(body.toString().replaceAll(REAL, ORIGIN));
      res.writeHead(r.status, h); return res.end(body);
    }
    const r = await fetch("http://127.0.0.1:18080" + req.url, { headers: { cookie: req.headers.cookie || "" }, redirect: "manual" });
    const h = {}; r.headers.forEach((v, k) => { if (k !== "content-encoding" && k !== "content-length") h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(18090, () => console.log("proxy :18090"));
