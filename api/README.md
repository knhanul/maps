# gildam-api — 길담 동기화 API

- 운영: `https://www.nuni.co.kr/gildam-api` (OVH `/srv/gildam-api`, 컨테이너 `gildam-api`, SQLite `/srv/gildam-api/data/gildam.sqlite`)
- 인증: NUNI ID access token (RS256, JWKS `https://id.nuni.co.kr/.well-known/jwks.json`, iss `https://id.nuni.co.kr`, aud `gildam-android`, typ `at+jwt`, brand_id `gildam`)
- 사진·미디어는 서버에 없음. 웨이포인트는 `photo_local_only`, `photo_count` 만.

## 엔드포인트 (모두 `Authorization: Bearer <access_token>`)
| | |
|---|---|
| `GET /v1/me` | `{sub, brand_id, brand_role, created_at, track_count, cursor}` |
| `GET /v1/tracks?since=<cursor>&limit=50` | `{items:[Track|Tombstone], cursor, has_more}`. since=0(기본)은 살아있는 트랙만, since>0 은 삭제 표시 포함 |
| `GET /v1/tracks/{id}` | Track / 404 |
| `PUT /v1/tracks/{id}` | 생성 201 / 갱신 200 / `updated_at` 이 서버보다 오래되면 409 `{current}` |
| | `activity_type`: `WALK`/`HIKE`/`RUN`/`BIKE`/`CAR`/`null` (대소문자 무시, 대문자로 저장). 생략하면 기존 값 유지, 그 밖의 값은 400. 예전 기록은 `null`. |
| `DELETE /v1/tracks/{id}[?updated_at=ms]` | 200 Tombstone / 없으면 204 |

id: `[A-Za-z0-9_-]{8,64}` (클라이언트 UUID 권장). 시각은 모두 epoch ms.

```jsonc
// Track (PUT 본문; 응답에는 deleted:false, server_seq 추가)
{ "updated_at": 1761350000000, "title": "산책", "memo": null,
  "started_at": 1761340000000, "ended_at": 1761349000000,
  "distance_m": 4210.5, "duration_s": 3600, "elevation_gain_m": 52,
  "points": [ { "lat": 37.5, "lon": 127.0, "t": 1761340000000, "ele": 31.2, "acc": 5, "spd": 1.3 } ],
  "waypoints": [ { "id": "wp-uuid", "lat": 37.5, "lon": 127.0, "t": 1761341000000,
                   "title": "벚꽃", "memo": "…", "photo_local_only": true, "photo_count": 2 } ] }
// Tombstone
{ "id": "…", "deleted": true, "updated_at": 1761350000000, "server_seq": 42 }
```
웨이포인트에 `*uri*`, `*url*`, `*path*`, `*image*`, `base64` 같은 필드가 있으면 400. 본문 최대 8MB, points 최대 200000.

동기화: 앱은 마지막 `cursor` 를 저장하고 `GET /v1/tracks?since=cursor` 를 has_more=false 까지 반복 → 로컬 반영 → 로컬 변경분 PUT/DELETE.

## 배포
```bash
rsync -a --exclude data --exclude .git ./ ubuntu@ovh:/tmp/gildam-api/ && sudo rsync -a /tmp/gildam-api/ /srv/gildam-api/
cd /srv/gildam-api && sudo APP_REV=$(git rev-parse --short HEAD) docker compose up -d --build
```
테스트: `npm test`

## 지도 관리 (stage 1) — maps.nuni.co.kr

- 저장소: `/srv/gildam-maps/{releases/<ver>, current -> releases/<ver>, incoming/, fonts, sprites, styles}` (그룹 `gildam-maps`, gid 982)
- 디스크 보관: current + previous 만. 게시하면 그 전의 previous 는 `pending_archive` 가 되고 디스크에 남음 + `archive` 작업이 큐에 들어감.
  `pending_archive` 가 하나라도 있으면 다음 게시는 409 로 거부. NAS 보관 후 `POST /v1/worker/releases/<v>/archived {archive_ref}` → `archived` → 관리자 `remove` 로 디스크 삭제.
  복원: 관리자 `POST /v1/admin/releases/<v>/restore` → `restore` 작업 (NAS 단계에서 구현).
- 업로드: SSH 사용자 `gildam-upload` (rrsync `-wo -no-del`, 쓰기 전용, incoming 밖 접근 불가, 셸·포워딩·TTY 불가)
  ```bash
  rsync -rt --chmod=Dg+rwx,Fg+rw,Fo+r,Do+rx --partial-dir=.rsync-partial -e "ssh -i <key> -o IdentitiesOnly=yes" <ver> gildam-upload@YOUR_SERVER_IP:/
  ```
  `<ver>/` 안: `*.pmtiles` + `SHA256SUMS` (`sha256sum * > SHA256SUMS`), 선택 `release.json` (`{"attribution": "..."}`)
- 검증: SHA256SUMS 의 모든 파일 해시 일치, 목록 밖 파일 없음, `.pmtiles` 헤더(매직 `PMTiles`, v3) → bounds/zoom 기록
- 게시: `incoming/<v>` → `releases/<v>` 이동 후 `current` 심볼릭 링크 원자 교체 (임시 링크 + rename). 롤백: previous 로 링크 교체 (current/previous 맞바꿈)

### 엔드포인트
| 공개 | |
|---|---|
| `GET /v1/map/manifest` | `{version, style_url, tiles_url, tiles_sha256, tiles_size, attribution, updated_at, bounds, min_zoom, max_zoom}` (CORS *, 없으면 404) |
| `GET /tiles/<ver>/<file>.pmtiles` | nginx `gildam-tiles`, Range·CORS, immutable 캐시 |
| `GET /tiles/current/<file>.pmtiles`, `/styles/*`, `/fonts/*`, `/sprites/*` | 짧은 캐시 |

| 관리 (`/admin` 웹 로그인 세션 쿠키, 변경은 `X-Gildam-Admin: 1` 헤더 필수) | |
|---|---|
| `GET /v1/admin/releases` | 목록·상태 |
| `POST /v1/admin/releases/<v>/verify` · `/publish` · `/remove` · `/restore` | |
| `POST /v1/admin/rollback` | |
| `GET/POST /v1/admin/jobs` (`{type:"generate", params}`), `POST /v1/admin/jobs/<id>/cancel`, `GET /v1/admin/events` | |

관리 웹 로그인: NUNI ID 클라이언트 `gildam-admin-web` (공개, PKCE, 서버 측 코드 교환), ID 토큰의 `platform_admin` 또는 길담 `brand_role=brand_admin` 만 허용. 세션 8시간 (`__Host-gildam_admin`, HttpOnly, Secure, SameSite=Lax).

| 워커 (`Authorization: Bearer <worker token>`, 서버에는 SHA-256 해시만 `/srv/gildam-api/.env`) | |
|---|---|
| `POST /v1/worker/jobs/claim {types:[...]}` | 200 job / 204 없음 |
| `POST /v1/worker/jobs/<id> {status: running|done|failed, progress, message, result}` | |
| `POST /v1/worker/releases/<v>/verify` | 업로드 후 검증 시작 |
| `POST /v1/worker/releases/<v>/archived {archive_ref}` | NAS 보관 완료 훅 |

box 쪽: `/home/box/agent-data/gildam-upload/{id_ed25519, id_ed25519.pub, worker.env}` (600). 예시 워커 `worker/gildam-worker.mjs`.

Caddy: `/srv/caddy/conf/pending/gildam-maps.caddy` (DNS 생기면 Caddyfile 에 `import pending/gildam-maps.caddy` 추가 → validate → reload).

## 공개 지도 웹 (maps.nuni.co.kr/)
- `web/public/` 정적 SPA — gildam-tiles(nginx)가 `/srv/gildam-web`(ro 마운트)로 서빙, 미일치 경로는 index.html.
- 기존 경로(/v1 /admin /healthz → gildam-api, /tiles /styles /fonts /sprites → nginx) 그대로.
- GPX는 브라우저 안에서만 처리, 저장은 localStorage. JS 라이브러리는 `web/public/vendor/`에 자체 호스팅(maplibre-gl 5, pmtiles 4, @protomaps/basemaps 5). 글꼴·스프라이트는 아직 protomaps.github.io.
- 배포: rsync 후 `docker compose up -d gildam-tiles` (API 이미지 재빌드 불필요).

## 지도 생성 (stage 2) — 관리 화면 「새 지도 만들기」
- 관리 화면(maps.nuni.co.kr/admin)에서 빌드(최신/날짜)·범위(대한민국 프리셋/서울/직접)·최대 줌 선택 → `generate` 작업이 큐에 들어감. 작업 표에서 진행률·로그(최근 40줄) 확인, 5초마다 자동 새로고침.
- API 는 `generate` params 를 검사만 함: `{build:"latest"|"YYYYMMDD", bbox:[w,s,e,n], maxzoom:0–15, region, version?}`. API 는 셸을 실행하지 않음.
- 워커 컨테이너 `gildam-map-worker` (`map-worker/`, node 24 + pmtiles CLI): 30초마다 `/v1/worker/jobs/claim` →
  1. `pmtiles extract --dry-run` 으로 크기 추정, **디스크 여유 < 크기×2 + 5GB 면 실패 처리**
  2. `incoming/.tmp-<ver>/` 에 추출 → `release.json`, `SHA256SUMS` → `incoming/<ver>` 로 이름 변경
  3. `/v1/worker/releases/<ver>/verify` 호출 → 작업 `done` (result.version). **게시는 관리자가 따로 누름.**
  - 마운트는 `/srv/gildam-maps/incoming` 만(rw), uid 999:982, read_only rootfs, cap_drop ALL, mem 256m, cpu 1, docker 소켓 없음. 명령은 인자 배열로만 실행(셸 없음).
  - 토큰: `/srv/gildam-api/map-worker.env` (`GILDAM_WORKER_TOKEN=…`, root 600, git 제외). API 쪽은 해시만 보관.
  - 버전 이름 자동: `YYYY.MM.DD-<region><n>` (KST).
- box 워커: 같은 스크립트 `worker/gildam-worker.mjs` 를 `OUT_DIR=<로컬폴더> POLL_SEC=0` 으로 돌린 뒤 결과 폴더를 gildam-upload 로 rsync (verify 호출은 업로드 후 다시). 또는 관리 화면의 「직접 만드는 법」대로 손으로.
- 롤백: `docker compose stop gildam-map-worker` (생성만 멈춤, 서빙 영향 없음).

## 지도 스타일 (기본·야간·흑백·등산·길담)
- `styles/generate-styles.cjs` (@protomaps/basemaps 5, lang ko) → `styles/generated/*.json` + `index.json` → `/srv/gildam-maps/styles/` 에 복사.
- 글꼴·스프라이트 자체 호스팅: `/fonts/<fontstack>/<range>.pbf`, `/sprites/v4/<light|dark|grayscale|...>` (protomaps/basemaps-assets, OFL).
- manifest 에 `styles: [{id,name,url}]`, `default_style`. 등산·야간 등은 metadata `gildam:hillshade`, `gildam:contour-color` 로 지형 표현 힌트.
- 웹은 바탕 레이어만 바꿔 끼워서 트랙·코스·음영·등고선·시점 유지, 선택은 localStorage `gildam.style.v1`.

## 관리 코스 도구 (/admin/course, /admin/merge) — feature/admin-course-tools
- 관리자 세션 필요(없으면 /admin/ 로). GPX 는 브라우저 안에서만 읽고 만듦 — 서버 전송·저장 없음.
- `/admin/course`: 클릭 추가·끌어 이동·점 클릭(폰은 길게 누르기·우클릭) 삭제·되돌리기/다시(Ctrl+Z/Y)·출발점으로·방향 바꾸기, 거리·예상 시간, DEM(manifest.terrain) 표고 그래프·오르막/내리막, GPX 1.1 내보내기(20m 채움, 시간 기본 끔), GPX로 시작.
- `/admin/merge`: GPX 여러 개, 끌어서/↑↓ 순서, ⇄ 뒤집기, 파일 사이 빈틈 거리, 하나의 trkseg/구간 유지, 지도·그래프에서 시작/끝 골라 자르기, 고도 없는 점은 DEM 으로 채움, GPX 1.1 내보내기(시간 기본 지움).
- 바탕지도: OpenFreeMap liberty/bright(라벨 name:ko 우선) + 길담 스타일 5종. CSP 는 이 두 페이지만 tiles.openfreemap.org 허용.
- 팔레트: 길담 앱 '햇살 산책'(Theme.kt SunnyLight: #F2552C / #1FA65A / #FFB400 / #FFF8F3).
- 로컬 시험: `test/local-admin-tools/` (gildam-api :18080 + 프록시 :18090, 시험 세션 쿠키 주입). 출력 GPX 는 GPX 1.1 XSD 와 길담 앱 GpxTrackParser 로 확인.
