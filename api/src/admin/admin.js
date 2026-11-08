const $ = (h) => { const d = document.createElement("div"); d.innerHTML = h; return d; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const api = async (p, opt = {}) => {
  const r = await fetch("/v1/admin" + p, { ...opt, headers: { "content-type": "application/json", "x-gildam-admin": "1" }, credentials: "same-origin" });
  if (r.status === 401) { location.href = "/admin/login"; throw new Error("login"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || r.status);
  return j;
};
const mb = (n) => (n == null ? "" : (n / 1048576).toFixed(1) + " MB");
const STATUS = { incoming: "업로드됨", verifying: "검증 중", verified: "검증 완료", failed: "검증 실패", current: "게시 중", previous: "직전 버전", pending_archive: "NAS 보관 대기", archived: "NAS 보관됨" };
let msg = "", builds = null;
async function act(fn, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try { await fn(); msg = ""; } catch (e) { msg = "⚠️ " + e.message; }
  render();
}
async function render() {
  const app = document.getElementById("app");
  let rel, jobs;
  if (!builds) fetch("https://build-metadata.protomaps.dev/builds.json").then((r) => r.json()).then((l) => { builds = l.map((x) => x.key.replace(".pmtiles", "")).filter((k) => /^\d{8}$/.test(k)).sort().reverse().slice(0, 10); render(); }).catch(() => { builds = []; });
  try { [rel, jobs] = await Promise.all([api("/releases"), api("/jobs")]); } catch (e) { app.textContent = "불러오기 실패: " + e.message; return; }
  const hasPrev = rel.items.some((r) => r.status === "previous");
  const rows = rel.items.map((r) => {
    const h = r.info && Object.values(r.info.pmtiles || {})[0];
    const btns = [];
    if (["incoming", "failed", "verified"].includes(r.status) && r.location === "incoming") btns.push(`<button data-a="verify" data-v="${esc(r.version)}" class="sec">검증</button>`);
    if (r.status === "verified" && r.location === "incoming") btns.push(`<button data-a="publish" data-v="${esc(r.version)}">게시</button>`);
    if (["incoming", "failed", "verified"].includes(r.status) && r.location === "incoming") btns.push(`<button data-a="remove" data-v="${esc(r.version)}" class="sec">삭제</button>`);
    if (r.status === "archived" && r.location === "releases") btns.push(`<button data-a="remove" data-v="${esc(r.version)}" class="sec">서버에서 삭제</button>`);
    return `<tr><td><b>${esc(r.version)}</b><br><small>${esc(r.created_at?.slice(0, 16).replace("T", " "))}</small></td>
      <td class="st st-${r.status}">${esc(STATUS[r.status] || r.status)}${r.error ? `<div class="err">${esc(r.error)}</div>` : ""}</td>
      <td>${mb(r.size_bytes)}${h ? `<br><small>z${h.min_zoom}–${h.max_zoom} · ${esc(h.tile_type)}</small>` : ""}</td>
      <td><small>${esc(r.published_at?.slice(0, 16).replace("T", " ") || "")}</small></td><td>${btns.join(" ")}</td></tr>`;
  }).join("");
  const jrows = jobs.items.map((j) => `<tr><td>#${j.id}</td><td>${esc(j.type)}</td><td>${esc(j.status)}${j.progress != null ? ` ${Math.round(j.progress * 100)}%` : ""}</td><td><pre class="log">${esc(j.message || "")}</pre>${j.result?.version ? `<small>→ ${esc(j.result.version)}</small>` : ""}</td><td><small>${esc(j.created_at.slice(0, 16).replace("T", " "))}</small></td></tr>`).join("");
  app.replaceChildren($(`${msg ? `<div class="msg">${esc(msg)}</div>` : ""}
    <h2>버전 <small>(게시 중: ${esc(rel.current || "없음")})</small> <button id="rb" class="sec" ${hasPrev ? "" : "disabled"}>직전 버전으로 되돌리기</button> <button id="rf" class="sec">새로고침</button></h2>
    <table><tr><th>버전</th><th>상태</th><th>크기·줌</th><th>게시</th><th></th></tr>${rows || `<tr><td colspan=5>업로드된 버전이 없어요</td></tr>`}</table>
    <h2>새 지도 만들기</h2>
    <div class="gen">
      <label>Protomaps 빌드 <select id="g_build"><option value="latest">최신 (자동)</option>${(builds || []).map((b) => `<option>${esc(b)}</option>`).join("")}</select></label>
      <label>범위 <select id="g_bbox"><option value="124.5,33.0,132.0,38.7">대한민국 전체 (제주·울릉·독도 포함)</option><option value="126.76,37.42,127.19,37.70">서울 (시험용)</option><option value="custom">직접 입력</option></select>
        <input id="g_custom" placeholder="서경,남위,동경,북위 예) 128.9,35.0,129.3,35.3" hidden></label>
      <label>최대 줌 <select id="g_z"><option>15</option><option>14</option><option>13</option><option>12</option></select></label>
      <button id="gen">새 지도 만들기</button>
    </div>
    <p><small>OVH의 지도 생성 워커(gildam-map-worker)가 가져가서 추출 → SHA256SUMS → 검증까지 해요. 디스크 여유가 (예상 크기×2 + 5GB)보다 적으면 시작하지 않아요. 끝나면 위 표에 <b>검증 완료</b>로 나타나고, <b>게시</b>는 직접 눌러야 해요. 대한민국 z15는 약 750MB, 10~20분 걸려요.</small></p>
    <table><tr><th>ID</th><th>종류</th><th>상태</th><th>메시지</th><th>요청</th></tr>${jrows || `<tr><td colspan=5>작업 없음</td></tr>`}</table>`));
  app.querySelectorAll("button[data-a]").forEach((b) => b.onclick = () => {
    const v = b.dataset.v, a = b.dataset.a;
    act(() => api(`/releases/${encodeURIComponent(v)}/${a}`, { method: "POST", body: "{}" }), a === "publish" ? `${v} 를 게시할까요?` : a === "remove" ? `${v} 를 서버에서 삭제할까요?` : null);
  });
  document.getElementById("rb").onclick = () => act(() => api("/rollback", { method: "POST", body: "{}" }), "직전 버전으로 되돌릴까요?");
  document.getElementById("rf").onclick = () => render();
  const sel = document.getElementById("g_bbox"), cus = document.getElementById("g_custom");
  sel.onchange = () => { cus.hidden = sel.value !== "custom"; };
  document.getElementById("gen").onclick = () => {
    const raw = sel.value === "custom" ? cus.value : sel.value, bbox = raw.split(",").map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !isFinite(n))) { msg = "⚠️ 범위는 숫자 4개(서경,남위,동경,북위)"; return render(); }
    const params = { build: document.getElementById("g_build").value, bbox, maxzoom: Number(document.getElementById("g_z").value), region: sel.selectedIndex === 0 ? "korea" : sel.selectedIndex === 1 ? "seoul" : "custom" };
    act(() => api("/jobs", { method: "POST", body: JSON.stringify({ type: "generate", params }) }), `새 지도를 만들까요?\n빌드 ${params.build}, 범위 ${bbox.join(",")}, 최대 줌 ${params.maxzoom}`);
  };
  app.appendChild($(HELP));
  if (rel.items.some((r) => r.status === "verifying") || jobs.items.some((j) => ["queued", "running"].includes(j.status))) { clearTimeout(render.t); render.t = setTimeout(render, 5000); }
}
const HELP = `<h2>직접 만드는 법</h2><details><summary>워커 없이 손으로 지도를 만들어 올리기</summary>
<ol><li>pmtiles CLI 받기: <a href="https://github.com/protomaps/go-pmtiles/releases" target="_blank">github.com/protomaps/go-pmtiles/releases</a></li>
<li>최신 빌드 날짜 확인: <a href="https://build.protomaps.com/" target="_blank">build.protomaps.com</a> (예: 20261024.pmtiles)</li>
<li>추출 (2GB 이상 메모리 있는 PC 권장):<pre>pmtiles extract https://build.protomaps.com/20261024.pmtiles 2026.10.26-korea1/gildam.pmtiles --bbox=124.5,33.0,132.0,38.7 --maxzoom=15</pre></li>
<li>체크섬: <pre>cd 2026.10.26-korea1 && sha256sum * > SHA256SUMS</pre></li>
<li>업로드 (gildam-upload 키 필요, incoming 에만 쓸 수 있음):<pre>rsync -rt --chmod=Dg+rwx,Fg+rw,Fo+r,Do+rx --partial-dir=.rsync-partial -e "ssh -i 키파일 -o IdentitiesOnly=yes" 2026.10.26-korea1 gildam-upload@YOUR_SERVER_IP:/</pre></li>
<li>이 화면 새로고침 → 버전 표에서 <b>검증</b> → <b>게시</b></li></ol>
<p><small>폴더 이름이 버전이에요 (영문·숫자·.-_ 64자 이내). 게시 전 NAS 보관 대기 버전이 있으면 게시가 막혀요.</small></p></details>`;
render();
