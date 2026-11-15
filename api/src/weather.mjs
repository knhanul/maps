// 길담 현재 날씨 — GET /v1/weather/now?lat=..&lon=..
//   국내: 위경도 → 기상청 단기예보 격자(nx, ny) → 초단기실황(getUltraSrtNcst) 요청 시 호출 (미리 수집하지 않음)
//   해외 또는 기상청 실패: Open-Meteo current 로 대체
//   위치는 격자 단위로만 쓰고 저장·로그하지 않는다. 같은 격자는 약 30분 메모리 캐시.
//   인증키: 서버 .env 의 KMA_SERVICE_KEY (없으면 KMA_API_KEY). 키가 없으면 Open-Meteo 만 쓴다.

const KMA_URL = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst";
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 30 * 60e3;          // 같은 격자 캐시 (요구: 약 30분)
const KMA_FAIL_TTL_MS = 5 * 60e3;  // 기상청 실패 격자는 5분 동안 바로 대체 경로로
const CACHE_MAX = 5000;
const OM_GRID_DEG = 0.05;          // Open-Meteo 로 보낼 좌표 격자 (약 5 km)
const KMA_READY_MIN = 40;          // 정시 관측은 약 40분 뒤 제공 (KST)

// 국내 판정 범위 (기상청 격자 영역 안쪽, 대한민국 + 주변 해역)
const KOREA = { latMin: 32.8, latMax: 39.0, lonMin: 124.0, lonMax: 132.0 };
export const inKorea = (lat, lon) => lat >= KOREA.latMin && lat <= KOREA.latMax && lon >= KOREA.lonMin && lon <= KOREA.lonMax;

// ---------- 기상청 LCC DFS 격자 변환 (기상청 단기예보 조회서비스 활용가이드의 표준 상수)
const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
const D = Math.PI / 180;
const re = RE / GRID, s1 = SLAT1 * D, s2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
const sn = Math.log(Math.cos(s1) / Math.cos(s2)) / Math.log(Math.tan(Math.PI * 0.25 + s2 * 0.5) / Math.tan(Math.PI * 0.25 + s1 * 0.5));
const sf = (Math.pow(Math.tan(Math.PI * 0.25 + s1 * 0.5), sn) * Math.cos(s1)) / sn;
const ro = (re * sf) / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
export function latLonToGrid(lat, lon) {
  const ra = (re * sf) / Math.pow(Math.tan(Math.PI * 0.25 + lat * D * 0.5), sn);
  let theta = lon * D - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}

// ---------- 기상청 기준 시각 (KST). 정시+40분 전이면 이전 정시.
const kstParts = (ms) => {
  const d = new Date(ms + 9 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`, hh: p(d.getUTCHours()), mm: d.getUTCMinutes() };
};
export function kmaBaseTime(nowMs, hoursBack = 0) {
  const { mm } = kstParts(nowMs);
  const lag = (mm < KMA_READY_MIN ? 1 : 0) + hoursBack;
  const t = kstParts(nowMs - lag * 3600e3);
  return { base_date: t.date, base_time: t.hh + "00" };
}
const kmaObservedAt = (bd, bt) => `${bd.slice(0, 4)}-${bd.slice(4, 6)}-${bd.slice(6, 8)}T${bt.slice(0, 2)}:${bt.slice(2, 4)}:00+09:00`;

// ---------- 변환
export const PTY = { 0: "NONE", 1: "RAIN", 2: "SLEET", 3: "SNOW", 5: "RAIN", 6: "SLEET", 7: "SNOW" };
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= -900 || n >= 900) return null; // 기상청 결측(-999, 999 등)
  return n;
};
const rn1 = (v) => {
  if (typeof v === "string" && /강수없음/.test(v)) return 0;
  if (typeof v === "string" && /미만/.test(v)) return 0.5; // "1mm 미만"
  const n = numOrNull(typeof v === "string" ? v.replace(/mm$/, "") : v);
  return n === null ? null : Math.max(0, n);
};
class WeatherError extends Error {}

// 기상청 items → 응답. 풍속·풍향은 필수 (없으면 실패로 보고 대체 경로).
export function parseKma(items, base_date, base_time) {
  const by = {};
  for (const it of items || []) by[it.category] = it.obsrValue;
  const windSpeedMs = numOrNull(by.WSD), windDirDeg = numOrNull(by.VEC), tempC = numOrNull(by.T1H);
  if (windSpeedMs === null || windDirDeg === null || tempC === null) throw new WeatherError("kma incomplete");
  const pty = numOrNull(by.PTY);
  return {
    source: "KMA",
    observedAt: kmaObservedAt(base_date, base_time),
    tempC,
    humidity: numOrNull(by.REH),
    precipType: PTY[pty] ?? "NONE",
    precip1hMm: rn1(by.RN1) ?? 0,
    windSpeedMs,
    windDirDeg: ((windDirDeg % 360) + 360) % 360,
    windGustMs: null,   // 초단기실황에는 돌풍 없음
    sky: null,          // 초단기실황에는 하늘상태 없음
  };
}

// Open-Meteo weather_code(WMO) → 강수형태
export function omPrecipType(code, rain = 0, snow = 0) {
  if ([56, 57, 66, 67].includes(code)) return "SLEET";      // 어는 이슬비·어는 비
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "SNOW";
  if ((code >= 51 && code <= 65) || (code >= 80 && code <= 82) || code >= 95) return "RAIN";
  if (rain > 0 && snow > 0) return "SLEET";
  if (snow > 0) return "SNOW";
  if (rain > 0) return "RAIN";
  return "NONE";
}
// 운량(%) → 하늘상태 (기상청 기준: 맑음 0~5할, 구름많음 6~8할, 흐림 9~10할)
export const omSky = (cc) => (cc === null || cc === undefined ? null : cc <= 50 ? "CLEAR" : cc <= 80 ? "CLOUDY" : "OVERCAST");
const isoWithOffset = (local, offSec) => {
  const s = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local) ? local + ":00" : local;
  const sign = offSec < 0 ? "-" : "+", a = Math.abs(offSec);
  return `${s}${sign}${String(Math.floor(a / 3600)).padStart(2, "0")}:${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}`;
};
export function parseOpenMeteo(j) {
  const c = j?.current;
  if (!c || typeof c.time !== "string") throw new WeatherError("open-meteo malformed");
  const windSpeedMs = numOrNull(c.wind_speed_10m), windDirDeg = numOrNull(c.wind_direction_10m), tempC = numOrNull(c.temperature_2m);
  if (windSpeedMs === null || windDirDeg === null || tempC === null) throw new WeatherError("open-meteo incomplete");
  // 지난 1시간 강수: hourly.precipitation 중 현재 시각 이하 가장 최근 값(그 시각까지 1시간 합). 없으면 current 값.
  let p1h = null;
  const ht = j.hourly?.time, hp = j.hourly?.precipitation;
  if (Array.isArray(ht) && Array.isArray(hp)) for (let i = 0; i < ht.length; i++) if (ht[i] <= c.time && numOrNull(hp[i]) !== null) p1h = numOrNull(hp[i]);
  if (p1h === null) p1h = numOrNull(c.precipitation) ?? 0;
  return {
    source: "OPEN_METEO",
    observedAt: isoWithOffset(c.time, Number(j.utc_offset_seconds) || 0),
    tempC,
    humidity: numOrNull(c.relative_humidity_2m),
    precipType: omPrecipType(Number(c.weather_code), Number(c.rain) || 0, Number(c.snowfall) || 0),
    precip1hMm: Math.max(0, p1h),
    windSpeedMs,
    windDirDeg: ((windDirDeg % 360) + 360) % 360,
    windGustMs: numOrNull(c.wind_gusts_10m),
    sky: omSky(numOrNull(c.cloud_cover)),
  };
}

const snap = (v) => Math.round(Math.round(v / OM_GRID_DEG) * OM_GRID_DEG * 1000) / 1000;

export function createWeather({
  env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console,
  kmaUrl = env.KMA_ULTRA_NCST_URL || KMA_URL, openMeteoUrl = env.OPEN_METEO_URL || OPEN_METEO_URL, ttlMs = TTL_MS,
} = {}) {
  const key = String(env.KMA_SERVICE_KEY || env.KMA_API_KEY || "").trim();
  const cache = new Map();     // key -> { at, ttl, value | promise }
  const kmaFail = new Map();   // "nx,ny" -> at
  const get = (k) => { const h = cache.get(k); if (h && now() - h.at < h.ttl) return h; if (h) cache.delete(k); return null; };
  const put = (k, v, ttl = ttlMs) => { if (cache.size >= CACHE_MAX) cache.clear(); cache.set(k, { at: now(), ttl, ...v }); };
  const cached = async (k, fn) => {
    const h = get(k);
    if (h) return h.value !== undefined ? h.value : h.promise;
    const promise = fn();
    put(k, { promise }, ttlMs);
    try { const value = await promise; put(k, { value }); return value; } catch (e) { cache.delete(k); throw e; }
  };

  async function fetchJson(url, ms = 5000) {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
    if (!r.ok) throw new WeatherError("http " + r.status);
    const text = await r.text();
    try { return JSON.parse(text); } catch { throw new WeatherError("not json"); } // 인증 오류는 XML 로 옴
  }

  async function kmaOnce(nx, ny, hoursBack) {
    const { base_date, base_time } = kmaBaseTime(now(), hoursBack);
    // 공공데이터포털: Decoding 키는 인코딩해서, Encoding 키(이미 % 포함)는 그대로 보낸다.
    const sk = key.includes("%") ? key : encodeURIComponent(key);
    const qs = new URLSearchParams({ pageNo: "1", numOfRows: "20", dataType: "JSON", base_date, base_time, nx: String(nx), ny: String(ny) });
    const j = await fetchJson(`${kmaUrl}?serviceKey=${sk}&${qs}`);
    const code = j?.response?.header?.resultCode;
    if (code !== "00") throw Object.assign(new WeatherError("kma result " + code), { noData: code === "03" });
    return parseKma(j?.response?.body?.items?.item, base_date, base_time);
  }
  async function kma(nx, ny) {
    try { return await kmaOnce(nx, ny, 0); } catch (e) {
      if (!(e instanceof WeatherError)) throw e;
      return kmaOnce(nx, ny, 1); // 아직 안 올라왔거나 결측이면 한 시간 전 관측
    }
  }
  async function openMeteo(glat, glon) {
    const qs = new URLSearchParams({
      latitude: String(glat), longitude: String(glon),
      current: "temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "precipitation", past_hours: "2", forecast_hours: "1",
      wind_speed_unit: "ms", timezone: "auto",
    });
    return parseOpenMeteo(await fetchJson(`${openMeteoUrl}?${qs}`));
  }

  // lat/lon 은 여기서만 쓰고, 이후로는 격자(nx,ny 또는 0.05° 격자)만 남긴다.
  async function now_(lat, lon) {
    if (inKorea(lat, lon) && key) {
      const { nx, ny } = latLonToGrid(lat, lon);
      const g = `${nx},${ny}`, failAt = kmaFail.get(g);
      if (!failAt || now() - failAt >= KMA_FAIL_TTL_MS) {
        try { return await cached("kma:" + g, () => kma(nx, ny)); } catch (e) {
          if (kmaFail.size >= CACHE_MAX) kmaFail.clear();
          kmaFail.set(g, now());
          log.warn?.(`weather: kma failed grid=${g} (${e instanceof WeatherError ? e.message : "network"}) → open-meteo`);
        }
      }
    }
    const glat = snap(lat), glon = snap(lon);
    return cached(`om:${glat},${glon}`, () => openMeteo(glat, glon));
  }

  // 라우터에서 호출: 인증은 server.mjs 가 이미 끝냄
  async function handle(req, res, u, send) {
    const lat = parseCoord(u.searchParams.get("lat"), 90), lon = parseCoord(u.searchParams.get("lon"), 180);
    if (lat === null || lon === null) return send(res, 400, { error: "invalid_request", error_description: "lat (-90..90) and lon (-180..180) required" });
    try { return send(res, 200, await now_(lat, lon)); } catch (e) {
      log.warn?.(`weather: unavailable (${e instanceof WeatherError ? e.message : "network"})`);
      return send(res, 502, { error: "weather_unavailable" });
    }
  }
  return { handle, now: now_, hasKmaKey: !!key, _cache: cache };
}
function parseCoord(s, lim) {
  if (s === null || !/^-?\d{1,3}(\.\d+)?$/.test(s.trim())) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= -lim && n <= lim ? n : null;
}
