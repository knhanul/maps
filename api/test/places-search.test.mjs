import test from "node:test";
import assert from "node:assert/strict";
import { queryKakao, cleanKey, allowSearch } from "../src/places-search.mjs";

test("카카오 문서를 장소 목록으로 바꿉니다", async () => {
  const fetchImpl = async (url, opts) => {
    assert.match(opts.headers.Authorization, /^KakaoAK test-key$/);
    assert.match(String(url), /query=%EB%B6%81%ED%95%9C%EC%82%B0/);
    return new Response(JSON.stringify({
      documents: [{ id: "1", place_name: "북한산", category_group_name: "관광명소", address_name: "서울", x: "126.993", y: "37.658" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const out = await queryKakao({ query: "북한산", rect: null, key: "test-key", fetchImpl });
  assert.equal(out.status, 200);
  assert.equal(out.body.source, "kakao");
  assert.deepEqual(out.body.items[0], { id: "1", name: "북한산", category: "관광명소", address: "서울", lon: 126.993, lat: 37.658 });
});

test("키가 없으면 카카오를 호출하지 않습니다", async () => {
  let called = false;
  const out = await queryKakao({ query: "춘천역", key: "", fetchImpl: async () => { called = true; return new Response("{}"); } });
  assert.equal(called, false);
  assert.equal(out.body.items.length, 0);
  assert.match(out.body.error, /키/);
});

test("지도 범위는 올바른 rect만 전달합니다", async () => {
  const seen = [];
  const fetchImpl = async (url) => { seen.push(String(url)); return Response.json({ documents: [] }); };
  await queryKakao({ query: "편의점", rect: "126.9,37.4,127.1,37.6", key: "k", fetchImpl });
  await queryKakao({ query: "편의점", rect: "bad", key: "k", fetchImpl });
  assert.match(seen[0], /rect=126\.9%2C37\.4%2C127\.1%2C37\.6|rect=126\.9,37\.4,127\.1,37\.6/);
  assert.equal(seen[1].includes("rect="), false);
});

test("거절된 키는 안내 문구를 돌려줍니다", async () => {
  const out = await queryKakao({ query: "남산", key: "bad", fetchImpl: async () => new Response("no", { status: 401 }) });
  assert.equal(out.status, 401);
  assert.match(out.body.error, /키/);
});

test("키에 줄바꿈이 있으면 버립니다", () => {
  assert.equal(cleanKey("ab\nc"), "");
  assert.equal(cleanKey("  kakao  "), "kakao");
});

test("같은 주소는 분당 30회를 넘기면 막습니다", () => {
  const ip = "test-" + Math.random();
  for (let i = 0; i < 30; i++) assert.equal(allowSearch(ip, 1_000 + i), true);
  assert.equal(allowSearch(ip, 1_030), false);
});
