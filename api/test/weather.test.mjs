import { test } from "node:test";
import assert from "node:assert/strict";
import { latLonToGrid, kmaBaseTime, parseKma, parseOpenMeteo, omPrecipType, omSky, inKorea, createWeather } from "../src/weather.mjs";

const kst = (s) => Date.parse(s + "+09:00");
const ncst = (o = {}) => ({ response: { header: { resultCode: "00" }, body: { items: { item: Object.entries({ T1H: "3.4", REH: "61", PTY: "0", RN1: "0", WSD: "2.7", VEC: "315", UUU: "1.9", VVV: "-1.9", ...o }).map(([category, obsrValue]) => ({ category, obsrValue })) } } } });
const om = { utc_offset_seconds: 3600, current: { time: "2026-11-15T03:15", temperature_2m: 8.1, relative_humidity_2m: 80, precipitation: 0.2, rain: 0.2, snowfall: 0, weather_code: 61, cloud_cover: 95, wind_speed_10m: 4.2, wind_direction_10m: 200, wind_gusts_10m: 9.8 }, hourly: { time: ["2026-11-15T01:00", "2026-11-15T02:00", "2026-11-15T03:00", "2026-11-15T04:00"], precipitation: [0, 0.4, 1.1, 2] } };
const res = (body, status = 200) => ({ ok: status < 400, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

test("LCC DFS grid: known points", () => {
  assert.deepEqual(latLonToGrid(37.5665, 126.978), { nx: 60, ny: 127 });  // 서울시청
  assert.deepEqual(latLonToGrid(35.1796, 129.0756), { nx: 98, ny: 76 });  // 부산시청
  assert.deepEqual(latLonToGrid(33.4996, 126.5312), { nx: 53, ny: 38 });  // 제주시
  assert.deepEqual(latLonToGrid(35.1595, 126.8526), { nx: 58, ny: 74 });  // 광주시청
  assert.ok(inKorea(37.5, 127)); assert.ok(!inKorea(35.68, 139.69)); assert.ok(!inKorea(48.85, 2.35));
});

test("KMA base time: +40 min rule (KST), previous hour fallback", () => {
  assert.deepEqual(kmaBaseTime(kst("2026-11-15T10:39:00")), { base_date: "20261115", base_time: "0900" });
  assert.deepEqual(kmaBaseTime(kst("2026-11-15T10:40:00")), { base_date: "20261115", base_time: "1000" });
  assert.deepEqual(kmaBaseTime(kst("2026-11-15T00:10:00")), { base_date: "20261114", base_time: "2300" });
  assert.deepEqual(kmaBaseTime(kst("2026-11-15T10:45:00"), 1), { base_date: "20261115", base_time: "0900" });
});

test("KMA mapping: PTY, RN1, wind required", () => {
  const items = (o) => ncst(o).response.body.items.item;
  const r = parseKma(items(), "20261115", "1000");
  assert.deepEqual(r, { source: "KMA", observedAt: "2026-11-15T10:00:00+09:00", tempC: 3.4, humidity: 61, precipType: "NONE", precip1hMm: 0, windSpeedMs: 2.7, windDirDeg: 315, windGustMs: null, sky: null });
  for (const [pty, want] of [["1", "RAIN"], ["5", "RAIN"], ["2", "SLEET"], ["6", "SLEET"], ["3", "SNOW"], ["7", "SNOW"], ["0", "NONE"]]) assert.equal(parseKma(items({ PTY: pty }), "20261115", "1000").precipType, want);
  assert.equal(parseKma(items({ RN1: "1.5" }), "20261115", "1000").precip1hMm, 1.5);
  assert.equal(parseKma(items({ RN1: "강수없음" }), "20261115", "1000").precip1hMm, 0);
  assert.throws(() => parseKma(items({ WSD: "-999" }), "20261115", "1000"));
  assert.throws(() => parseKma(items({ VEC: undefined }).filter((i) => i.obsrValue !== undefined), "20261115", "1000"));
});

test("Open-Meteo mapping", () => {
  assert.deepEqual(parseOpenMeteo(om), { source: "OPEN_METEO", observedAt: "2026-11-15T03:15:00+01:00", tempC: 8.1, humidity: 80, precipType: "RAIN", precip1hMm: 1.1, windSpeedMs: 4.2, windDirDeg: 200, windGustMs: 9.8, sky: "OVERCAST" });
  assert.equal(omPrecipType(73), "SNOW"); assert.equal(omPrecipType(66), "SLEET"); assert.equal(omPrecipType(0), "NONE"); assert.equal(omPrecipType(3, 0.1, 0.2), "SLEET");
  assert.equal(omSky(10), "CLEAR"); assert.equal(omSky(70), "CLOUDY"); assert.equal(omSky(90), "OVERCAST"); assert.equal(omSky(null), null);
});

function harness({ key = "abc+def/==", kma = () => res(ncst()), omr = () => res(om), t = kst("2026-11-15T10:50:00") } = {}) {
  const calls = []; let clock = t;
  const w = createWeather({
    env: { KMA_SERVICE_KEY: key }, now: () => clock, log: { warn: () => {} },
    kmaUrl: "http://kma.test/ncst", openMeteoUrl: "http://om.test/forecast",
    fetchImpl: async (url) => { calls.push(url); return url.startsWith("http://kma.test") ? kma(url) : omr(url); },
  });
  return { w, calls, tick: (ms) => { clock += ms; } };
}

test("KMA path: grid, key encoding, 30 min cache per grid", async () => {
  const h = harness();
  const a = await h.w.now(37.5665, 126.978);
  assert.equal(a.source, "KMA"); assert.equal(a.observedAt, "2026-11-15T10:00:00+09:00");
  const u = new URL(h.calls[0]);
  assert.equal(u.searchParams.get("nx"), "60"); assert.equal(u.searchParams.get("ny"), "127");
  assert.equal(u.searchParams.get("base_time"), "1000"); assert.equal(u.searchParams.get("serviceKey"), "abc+def/==");
  assert.ok(h.calls[0].includes("serviceKey=abc%2Bdef%2F%3D%3D"));
  assert.ok(!h.calls[0].includes("37.5665") && !h.calls[0].includes("126.978"));
  await h.w.now(37.5670, 126.9785);            // 같은 격자 → 캐시
  assert.equal(h.calls.length, 1);
  h.tick(29 * 60e3); await h.w.now(37.5665, 126.978); assert.equal(h.calls.length, 1);
  h.tick(2 * 60e3); await h.w.now(37.5665, 126.978); assert.equal(h.calls.length, 2);
  await h.w.now(35.1796, 129.0756); assert.equal(h.calls.length, 3); // 다른 격자
});

test("KMA no data → previous hour; concurrent requests share one call", async () => {
  let n = 0;
  const h = harness({ kma: (url) => (n++ === 0 ? res({ response: { header: { resultCode: "03" } } }) : res(ncst())) });
  const [a, b] = await Promise.all([h.w.now(37.5665, 126.978), h.w.now(37.5665, 126.978)]);
  assert.equal(a.observedAt, "2026-11-15T09:00:00+09:00"); assert.deepEqual(a, b);
  assert.equal(h.calls.length, 2);
  assert.equal(new URL(h.calls[1]).searchParams.get("base_time"), "0900");
});

test("KMA failure → Open-Meteo on snapped grid; missing key → Open-Meteo; overseas → Open-Meteo", async () => {
  const h = harness({ kma: () => res("<OpenAPI_ServiceResponse>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</OpenAPI_ServiceResponse>") });
  const a = await h.w.now(37.5665, 126.978);
  assert.equal(a.source, "OPEN_METEO");
  const omUrl = new URL(h.calls.at(-1));
  assert.equal(omUrl.searchParams.get("latitude"), "37.55"); assert.equal(omUrl.searchParams.get("longitude"), "127");
  assert.equal(omUrl.searchParams.get("wind_speed_unit"), "ms");
  const before = h.calls.length; await h.w.now(37.5665, 126.978);
  assert.equal(h.calls.length, before, "KMA 실패 격자는 잠시 건너뛰고 Open-Meteo 캐시 사용");

  const nk = harness({ key: "" });
  assert.equal((await nk.w.now(37.5665, 126.978)).source, "OPEN_METEO");
  assert.ok(nk.calls.every((u) => u.startsWith("http://om.test")));

  const os = harness();
  assert.equal((await os.w.now(35.6812, 139.7671)).source, "OPEN_METEO");
  assert.ok(os.calls.every((u) => u.startsWith("http://om.test")));
});

test("both down → throws (route answers 502); Encoding key passed as-is", async () => {
  const h = harness({ kma: () => res("x", 500), omr: () => res("x", 503) });
  await assert.rejects(h.w.now(37.5665, 126.978));
  const e = harness({ key: "abc%2Bdef%3D%3D" });
  await e.w.now(37.5665, 126.978);
  assert.ok(e.calls[0].includes("serviceKey=abc%2Bdef%3D%3D&"));
});
