// 카카오 로컬 키워드 검색. 키는 환경변수 또는 요청 헤더로만 받고, 로그에 남기지 않는다.
const KAKAO_URL = "https://dapi.kakao.com/v2/local/search/keyword.json";
const RECT_RE = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;
const hits = new Map();

export function clientIp(req) {
  const raw = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "");
  return raw.split(",")[0].trim().slice(0, 64) || "unknown";
}

export function allowSearch(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 30) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  if (hits.size > 5000) hits.clear();
  hits.set(ip, recent);
  return true;
}

export function cleanKey(value) {
  const key = String(value || "").trim();
  if (!key || key.length > 128 || /[\r\n]/.test(key)) return "";
  return key;
}

function validRect(rect) {
  if (!rect || !RECT_RE.test(rect)) return "";
  const [west, south, east, north] = rect.split(",").map(Number);
  if (!(west < east && south < north)) return "";
  if (west < -180 || east > 180 || south < -90 || north > 90) return "";
  return rect;
}

function fromDoc(doc, index) {
  const lon = Number(doc?.x);
  const lat = Number(doc?.y);
  const name = String(doc?.place_name || "").trim();
  if (!name || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const category = String(doc.category_group_name || doc.category_name || "장소").split(">").pop().trim() || "장소";
  return {
    id: String(doc.id || `kakao-${index}`),
    name,
    category,
    address: String(doc.road_address_name || doc.address_name || "").trim(),
    lon,
    lat,
  };
}

export async function queryKakao({ query, rect, key, fetchImpl = fetch }) {
  const q = String(query || "").trim().slice(0, 80);
  if (!q) return { status: 200, body: { items: [], source: "empty" } };
  const token = cleanKey(key);
  if (!token) {
    return { status: 200, body: { items: [], source: "empty", error: "카카오 REST 키가 없습니다. 검색창의 열쇠에서 넣거나 서버 환경변수 KAKAO_REST_API_KEY 로 설정해 주세요." } };
  }
  const api = new URL(KAKAO_URL);
  api.searchParams.set("query", q);
  api.searchParams.set("size", "10");
  const box = validRect(rect);
  if (box) api.searchParams.set("rect", box);
  let upstream;
  try {
    upstream = await fetchImpl(api, { headers: { Authorization: `KakaoAK ${token}` }, signal: AbortSignal.timeout(8000) });
  } catch {
    return { status: 502, body: { items: [], source: "kakao", error: "카카오 검색에 연결하지 못했습니다." } };
  }
  if (!upstream.ok) {
    const error = upstream.status === 401 || upstream.status === 403
      ? "카카오 REST 키를 확인해 주세요."
      : "카카오 검색이 거절되었습니다. 지도 범위를 좁혀 보세요.";
    return { status: upstream.status, body: { items: [], source: "kakao", error } };
  }
  const data = await upstream.json();
  const items = (Array.isArray(data.documents) ? data.documents : []).map(fromDoc).filter(Boolean);
  return { status: 200, body: { items, source: "kakao" } };
}

export async function handlePlacesSearch(req, res, url, send) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "x-kakao-key",
      "access-control-max-age": "600",
      "cache-control": "no-store",
    });
    res.end();
    return true;
  }
  if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" }), true;
  if (!allowSearch(clientIp(req))) return send(res, 429, { items: [], source: "kakao", error: "검색이 너무 빠릅니다. 잠시 뒤 다시 시도해 주세요." }), true;
  const key = cleanKey(process.env.KAKAO_REST_API_KEY) || cleanKey(req.headers["x-kakao-key"]);
  const result = await queryKakao({ query: url.searchParams.get("query"), rect: url.searchParams.get("rect"), key });
  send(res, result.status, result.body);
  return true;
}
