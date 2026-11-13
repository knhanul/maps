# maps.nuni.co.kr 운영 반영 방법

길담 스튜디오 웹(https://maps.nuni.co.kr)을 이 저장소의 소스로 운영 서버에 반영하는 절차입니다. 2026-11-13 `v13-studio` 프론트엔드 반영과 같은 방식입니다.

보통은 `api/web/public/`의 정적 파일만 바꿉니다. API 이미지, 경로 안내, 지도 타일, Caddy, 환경 파일은 해당 파일이 실제로 바뀐 경우에만 손댑니다. 같은 서버의 weather·inal 등 다른 서비스는 건드리지 마세요.

화면 개편 내용·그때그때 바뀌는 파일 목록은 `api/editor-docs/README-editor.md`를, API·지도 게시·워커는 `api/README.md`를, 경로 엔진은 `routing/README-routing.md`를 보세요.

## 차례

1. [서버·구성](#1-서버구성)
2. [사전 준비](#2-사전-준비)
3. [커밋 확인과 테스트](#3-커밋-확인과-테스트)
4. [백업](#4-백업)
5. [프론트엔드 반영](#5-프론트엔드-반영)
6. [API·경로·타일을 다시 만들 때](#6-api경로타일을-다시-만들-때)
7. [반영 후 확인](#7-반영-후-확인)
8. [롤백](#8-롤백)
9. [주의사항](#9-주의사항)

## 1. 서버·구성

공개 DNS에서 `maps.nuni.co.kr` A 레코드가 가리키는 호스트(운영 OVH VPS)입니다. SSH 계정은 `ubuntu`입니다. 아래 명령의 `YOUR_SERVER_IP`는 그 A 레코드 값으로 바꾸세요. 비밀값이나 개인 키 경로는 적지 않습니다.

```sh
HOST=ubuntu@YOUR_SERVER_IP
SSH_OPTS='-o BatchMode=yes -o IdentitiesOnly=yes'
# 필요하면: -i ~/.ssh/<운영서버용_키>
```

### 요청 흐름

Caddy(`caddy:2`, 80/443)가 TLS를 종료합니다. 설정은 `/srv/caddy/conf/pending/gildam-maps.caddy`이고, `/srv/caddy/Caddyfile`에서 `import pending/gildam-maps.caddy`로 불러옵니다. 저장소 예시는 `deployment/maps.caddy.example`입니다.

| 경로 | 대상 |
|---|---|
| `/v1/*`, `/admin`, `/admin/*`, `/healthz` | `gildam-api:8080` |
| 나머지(`/`, `/tiles`, `/styles`, `/fonts`, `/sprites`, `/routing/route` 등) | `gildam-tiles:8080` |

`gildam-tiles`(nginx)는 웹을 `/srv/gildam-web`에서, 지도 자료를 `/srv/gildam-maps`에서 읽고, `/routing/route`만 `gildam-routing-api:17778`로 넘깁니다. `index.html`은 `Cache-Control: no-cache`, 그 밖의 웹 정적 파일은 `public, max-age=3600`이라 JS/CSS를 바꾸면 `index.html`의 `?v=` 캐시 버스터를 함께 올려야 합니다.

### 경로

| 경로 | 역할 |
|---|---|
| `/srv/gildam-api` | API·웹 소스, compose, 타일 nginx 설정 |
| `/srv/gildam-api/web/public` | 공개 웹 정적 파일. `gildam-tiles`에 읽기 전용으로 `/srv/gildam-web`에 마운트 |
| `/srv/gildam-api/editor-docs` | 운영 서버에 두는 편집 문서(공개 웹에 직접 서빙되지 않음) |
| `/srv/gildam-api/data` | SQLite. 배포 시 덮어쓰지 않음 |
| `/srv/gildam-maps` | PMTiles·폰트·스프라이트·스타일. `current` → `releases/<버전>` |
| `/srv/gildam-routing` | BRouter 엔진·프록시·프로필·그래프 |
| `/srv/caddy` | Caddy 설정과 인증서 |

### 컨테이너

| 이름 | 역할 | 비고 |
|---|---|---|
| `caddy` | TLS·호스트 라우팅 | 다른 도메인도 함께 처리 |
| `gildam-api` | 동기화 API, `/v1/map/manifest`, `/admin`, `/healthz` | 이미지 `local/gildam-api:<APP_REV>` |
| `gildam-tiles` | 정적 웹·타일·경로 프록시 | `nginx:1-alpine`. 웹 파일은 바인드 마운트 |
| `gildam-map-worker` | 지도 생성 워커 | 이미지 `local/gildam-map-worker:<APP_REV>` |
| `gildam-routing-api` | `/routing/route` 프록시 | `node:24` 계열, `routing-proxy.mjs` 마운트 |
| `gildam-routing-engine` | BRouter | 로그 드라이버가 `none`이라 `docker logs` 불가 |

같은 호스트에 `weather-hub`, `inal` 등이 있습니다. 이 서비스의 compose·이미지·환경·볼륨은 변경하지 마세요.

## 2. 사전 준비

- `ubuntu`로 SSH 키 인증이 되고, `/srv/gildam-api/web/public`에 쓸 수 있으며, `/var/backups/maps` 작성에는 `sudo`가 필요합니다.
- 로컬에 Node 24 이상이 있어야 `npm test`를 돌릴 수 있습니다.
- 운영 환경 파일은 이미 서버에 있습니다. **값을 출력하거나 커밋하거나 로그에 남기지 마세요.** 이름과 위치만 확인합니다.

| 파일 | 권한 | 들어가는 키 이름 | 용도 |
|---|---|---|---|
| `/srv/gildam-api/.env` | root, 600 | `WORKER_TOKEN_SHA256` | API가 워커 토큰의 SHA-256만 보관 |
| `/srv/gildam-api/map-worker.env` | root, 600 | `GILDAM_WORKER_TOKEN` | 워커가 쓰는 원문 토큰. git 제외 |

프론트엔드만 바꿀 때는 이 파일을 열 필요도 없습니다. 백업할 때는 `sudo cp`로 복사만 하고 `cat`·`echo`로 내용을 보지 마세요. compose의 `OIDC_ISSUER`, `JWKS_URL`, `ADMIN_CLIENT_ID` 같은 공개 설정은 `docker-compose.yml`에 있고, 비밀값은 아닙니다.

`web/public/vendor/`와 지도 PMTiles는 이 저장소에 없습니다. 운영 서버의 기존 파일을 지우거나 덮어쓰지 마세요.

## 3. 커밋 확인과 테스트

반영할 커밋을 로컬에서 확인하고, 운영에 올라간 현재 파일과 대조합니다.

```sh
git fetch origin
git checkout main
git pull --ff-only origin main
git log -1 --oneline
REV=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short=7 HEAD)

# 이번에 바뀐 파일
git diff --name-status <현재_운영_커밋> "$REV"
```

프론트엔드 JS/CSS를 바꿨다면 `api/web/public/index.html`의 캐시 버스터(`?v=...`)가 새 값인지 확인합니다. 예: `v13-studio`.

```sh
grep -E '\?v=' api/web/public/index.html
```

테스트(Node 24, 패키지 설치 불필요):

```sh
cd api
npm test    # node --experimental-sqlite --test test/*.test.mjs
```

브라우저 Playwright E2E는 표준 반영 절차에 넣지 않습니다. `playwright-core`와 vendor 번들이 로컬에 있어야 하고, v13 반영 때도 실행하지 못했습니다. 자세한 실행 방법은 `AGENTS.md`를 보세요.

운영 파일이 지금 어느 커밋인지 서버에서 해시를 확인합니다.

```sh
ssh $SSH_OPTS "$HOST" 'sha256sum /srv/gildam-api/web/public/{index.html,app.js,app.css,editor.css,gpx-editor.js,gpx-model.js,trace.js,trace-model.js}'
# 로컬의 현재 운영 커밋과 비교
git show <현재_운영_커밋>:api/web/public/index.html | sha256sum
```

해시를 모르면 반영을 멈추고 먼저 현재 파일을 백업하세요. 운영 파일이 저장소와 다르면 덮어쓰기 전에 차이를 확인합니다.

## 4. 백업

반영 전에 날짜가 있는 디렉터리에 현재 운영본을 복사합니다. 이름 예: `/var/backups/maps/20261113-remodel`. 프론트엔드만 바꿔도 설정·환경·이미지 태그를 함께 남겨 두면 롤백이 쉽습니다.

```sh
STAMP=$(date +%Y%m%d)-<짧은이름>   # 예: 20261113-remodel
# 아래는 서버에서 실행
ssh $SSH_OPTS "$HOST" "bash -s" -- <<EOS
set -euo pipefail
B=/var/backups/maps/$STAMP
WEB=/srv/gildam-api/web/public
[ ! -e "\$B" ]
sudo mkdir -p -m 700 "\$B/web-public" "\$B/editor-docs" "\$B/config" "\$B/env"
sudo cp -a "\$WEB"/index.html "\$WEB"/app.js "\$WEB"/app.css "\$WEB"/editor.css \
  "\$WEB"/gpx-editor.js "\$WEB"/gpx-model.js "\$WEB"/trace.js "\$WEB"/trace-model.js \
  "\$WEB"/places.js "\$B/web-public/"
sudo bash -c "ls -la '\$WEB' '\$WEB/vendor' '\$WEB/places' > '\$B/web-public-listing.txt'"
sudo bash -c "cd '\$B/web-public' && sha256sum * > '\$B/web-public.SHA256SUMS'"
[ -f /srv/gildam-api/editor-docs/README-editor.md ] && \
  sudo cp -a /srv/gildam-api/editor-docs/README-editor.md "\$B/editor-docs/"
sudo cp -a /srv/gildam-api/docker-compose.yml /srv/gildam-api/Dockerfile \
  /srv/gildam-api/package.json /srv/gildam-api/tiles/nginx.conf \
  /srv/caddy/conf/pending/gildam-maps.caddy /srv/gildam-routing/compose.yml \
  /srv/gildam-routing/routing-proxy.mjs "\$B/config/"
# 환경 파일은 복사만. 내용을 출력하지 말 것
sudo cp -a /srv/gildam-api/.env /srv/gildam-api/map-worker.env "\$B/env/"
sudo chmod 700 "\$B/env"
sudo chmod 600 "\$B/env/.env" "\$B/env/map-worker.env"
sudo docker inspect --format '{{.Name}} {{.Config.Image}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}' \
  gildam-api gildam-tiles gildam-map-worker gildam-routing-api gildam-routing-engine caddy weather-hub inal \
  | sudo tee "\$B/container-images.txt" >/dev/null
sudo chmod 600 "\$B/container-images.txt" "\$B/web-public.SHA256SUMS" "\$B/web-public-listing.txt"
sudo bash -c 'echo BACKUP_COMPLETE > '"\$B"'/COMPLETE'
sudo chmod 600 "\$B/COMPLETE"
# 앱 트리에도 프론트엔드 사본을 남김($SHORT 는 로컬에서 전개)
LOCALB=/srv/gildam-api/backups/deploy-${SHORT}-\$STAMP
mkdir -p "\$LOCALB"
cp -a "\$WEB"/index.html "\$WEB"/app.js "\$WEB"/app.css "\$WEB"/editor.css \
  "\$WEB"/gpx-editor.js "\$WEB"/gpx-model.js "\$LOCALB/"
echo BACKUP_DONE "\$B"
EOS
```

백업에 넣을 것:

- 현재 웹 파일(위 목록). `vendor/` 전체는 용량이 커서 목록만 남깁니다. 지우지 마세요.
- `editor-docs`, compose, Dockerfile, `tiles/nginx.conf`, Caddy 스니펫, 경로 `compose.yml`·`routing-proxy.mjs`
- `.env`, `map-worker.env`(디렉터리 700, 파일 600)
- 컨테이너 이미지 태그와 시작 시각·재시작 횟수(환경 변수는 검사하지 않음)
- `COMPLETE` 표시

BRouter JAR와 RD5 그래프, PMTiles 원본은 용량 때문에 이 백업에 넣지 않습니다. 타일·경로 엔진을 바꿀 때는 해당 경로를 따로 백업하세요.

같은 시점의 롤백 스크립트 예시는 [롤백](#8-롤백)을 백업 직후 `$B/rollback.sh`로 만들어 두면 됩니다.

## 5. 프론트엔드 반영

대상 파일이 `api/web/public/`의 HTML/JS/CSS뿐이고, `api/src`, Dockerfile, compose, nginx, 경로, 타일 데이터가 그대로면 이미지를 다시 만들지 말고 컨테이너도 재시작하지 마세요. 바인드 마운트된 파일을 교체하면 nginx가 바로 새 내용을 줍니다.

`vendor/`, `places/`, 바뀌지 않은 `trace.js`·`trace-model.js`는 복사하지 않습니다. 문서만 갱신하려면 `/srv/gildam-api/editor-docs/README-editor.md`도 함께 복사할 수 있습니다.

순서: JS/CSS를 먼저 넣고, `index.html`은 마지막에 넣습니다. 롤백할 때는 반대로 `index.html`을 먼저 되돌립니다.

```sh
# 로컬에서 반영할 파일만 묶어 업로드
mkdir -p /tmp/maps-release/frontend
for f in index.html app.js app.css editor.css gpx-editor.js gpx-model.js; do
  # 실제로 바뀐 파일만 넣어도 됩니다
  cp -a api/web/public/"$f" /tmp/maps-release/frontend/
done
(cd /tmp/maps-release/frontend && sha256sum * > ../SHA256SUMS)
scp $SSH_OPTS -r /tmp/maps-release "$HOST:/tmp/maps-release-$SHORT"

ssh $SSH_OPTS "$HOST" "bash -s" -- <<EOS
set -euo pipefail
WEB=/srv/gildam-api/web/public
STAGE=/tmp/maps-release-$SHORT
cd "\$STAGE/frontend"
sha256sum -c "\$STAGE/SHA256SUMS"
# 스테이징 사본
mkdir -p /srv/gildam-api/deploy-staging/$SHORT
cp -a "\$STAGE/frontend/." /srv/gildam-api/deploy-staging/$SHORT/
# JS/CSS 먼저, HTML 마지막
for f in app.css app.js editor.css gpx-editor.js gpx-model.js; do
  [ -f "\$STAGE/frontend/\$f" ] && install -m 644 -o ubuntu -g ubuntu "\$STAGE/frontend/\$f" "\$WEB/\$f"
done
install -m 644 -o ubuntu -g ubuntu "\$STAGE/frontend/index.html" "\$WEB/index.html"
# 디스크 해시가 SHA256SUMS와 같은지 다시 확인
cd "\$WEB"
sha256sum -c "\$STAGE/SHA256SUMS"
# 컨테이너가 재시작되지 않았는지 확인(백업의 StartedAt과 비교)
sudo docker inspect --format '{{.Name}} {{.Config.Image}} {{.State.Status}} {{.State.StartedAt}} {{.RestartCount}}' \
  gildam-api gildam-tiles gildam-routing-api weather-hub inal
echo DEPLOY_OK $REV
EOS
```

`nginx.conf`를 바꾸지 않는 한 `docker compose up`이나 nginx reload는 필요 없습니다.

## 6. API·경로·타일을 다시 만들 때

프론트엔드만 바꾼 반영(예: 2026-11-13 `v13-studio`)에서는 아래를 하지 않습니다.

| 바뀐 것 | 할 일 | 하지 말 것 |
|---|---|---|
| `api/web/public/` HTML·JS·CSS만 | 5절대로 파일 교체. 캐시 버스터 갱신 | API/워커 이미지 빌드, 컨테이너 재시작, `.env` 수정 |
| `api/tiles/nginx.conf` | 백업 후 파일 교체, `gildam-tiles` 안에서 `nginx -t` 다음 reload 또는 해당 서비스만 재생성 | 다른 compose 프로젝트 재시작 |
| `api/src/`, `api/Dockerfile`, `api/package.json` | 데이터·`.env`를 제외하고 코드만 올린 뒤, `/srv/gildam-api`에서 `sudo APP_REV=<짧은커밋> docker compose up -d --build gildam-api`처럼 **해당 서비스만**. 절차의 큰 틀은 `api/README.md` | `data/`, `.env`, weather/inal 볼륨 덮어쓰기 |
| `api/map-worker/` | `gildam-map-worker`만 재빌드 | 지도 서빙을 위해 워커를 재시작할 필요는 없음 |
| `routing/` 프록시·프로필·compose | `/srv/gildam-routing`만 백업·교체. 필요하면 그 디렉터리의 compose로 라우팅 컨테이너 두 개만 재기동 | `gildam-api` 재빌드, JAR/RD5를 실수로 삭제 |
| `/srv/gildam-maps` 타일·스타일·폰트 | `api/README.md`의 지도 게시/롤백 흐름 | 웹 정적 파일 배포와 섞지 말 것 |
| Caddy 스니펫 | 다른 사이트 import를 확인한 뒤 validate, reload | DNS·인증서가 아닌데 함부로 다시 발급 |

새 비밀값, DB 마이그레이션, 포트·도메인 변경이 필요하면 운영을 바꾸기 전에 멈추고 그 내용을 먼저 정리하세요.

## 7. 반영 후 확인

실제 서버 IP로 붙으려면 `--resolve`를 씁니다. 로컬 DNS가 다른 주소로 가로채는 경우가 있습니다.

```sh
IP=YOUR_SERVER_IP
V=<캐시버스터>          # 예: 13-studio
R="--resolve maps.nuni.co.kr:443:${IP}"

# 문서와 새 자산. index.html은 no-cache, 제목·?v= 확인, SHA는 로컬 파일과 비교
curl -sI $R "https://maps.nuni.co.kr/"
curl -fsS $R "https://maps.nuni.co.kr/index.html?v=${V}" | sha256sum
curl -fsS $R "https://maps.nuni.co.kr/app.js?v=${V}" | sha256sum

# API 건강 검사(Caddy가 /healthz 를 gildam-api로 보냄)
curl -fsS $R "https://maps.nuni.co.kr/healthz"
# 기대: {"ok":true}

# 지도 manifest와 스타일 5종
curl -fsS $R "https://maps.nuni.co.kr/v1/map/manifest"
# styles 배열의 각 url을 받아 version == 8 인지 확인

# 타일·지형 Range(처음 32바이트가 PMTiles 매직)
curl -fsS $R -D - -o /tmp/head.bin -H 'Range: bytes=0-31' \
  "https://maps.nuni.co.kr/tiles/current/gildam.pmtiles"
# HTTP 206, 파일 시작이 PMTiles 인지 확인
# manifest의 terrain.url 이 있으면 같은 방식으로 한 번 더

# 경로 계산(서울 시청 근처 짧은 구간)
for mode in walk hike bike; do
  curl -fsS $R "https://maps.nuni.co.kr/routing/route" \
    -H 'Content-Type: application/json' \
    --data "{\"from\":[126.978,37.566],\"to\":[126.981,37.566],\"mode\":\"$mode\"}"
done
# 각 응답의 coordinates 길이가 2보다 커야 함

# 다른 서비스가 살아 있는지(응답만 확인, 설정은 변경하지 않음)
curl -sI --resolve weather.nuni.co.kr:443:${IP} "https://weather.nuni.co.kr/"
curl -sI --resolve inal.nuni.co.kr:443:${IP} "https://inal.nuni.co.kr/"
```

로그(환경 변수·토큰이 보이면 복사하지 마세요):

```sh
ssh $SSH_OPTS "$HOST" 'sudo docker logs --since 30m gildam-tiles 2>&1 | tail'
ssh $SSH_OPTS "$HOST" 'sudo docker logs --since 30m gildam-api 2>&1 | tail'
ssh $SSH_OPTS "$HOST" 'sudo docker logs --since 30m caddy 2>&1 | tail'
```

`gildam-routing-api`와 `gildam-routing-engine`은 로그 드라이버가 `none`이라 `docker logs`를 쓸 수 없습니다. 경로 확인은 위의 `/routing/route` 요청으로 합니다.

컨테이너 시작 시각이 백업 때와 같은지(프론트엔드만 바꾼 경우 재시작되면 안 됨)도 봅니다.

curl로 화면 배치나 점 편집 동작을 대신할 수는 없습니다. 반영 후 브라우저나 휴대폰으로 한 번 확인하는 것이 좋습니다.

## 8. 롤백

백업 디렉터리의 웹 파일을 그대로 되돌립니다. `index.html`을 먼저, JS/CSS는 그다음에 넣습니다. 컨테이너 재시작은 보통 필요 없습니다.

```sh
# 서버에서. STAMP는 백업 때 쓴 이름
B=/var/backups/maps/<STAMP>
WEB=/srv/gildam-api/web/public
sudo install -m 644 -o ubuntu -g ubuntu "$B/web-public/index.html" "$WEB/index.html"
for f in app.css app.js editor.css gpx-editor.js gpx-model.js; do
  sudo install -m 644 -o ubuntu -g ubuntu "$B/web-public/$f" "$WEB/$f"
done
# editor-docs를 바꿨다면
sudo install -m 644 -o ubuntu -g ubuntu "$B/editor-docs/README-editor.md" \
  /srv/gildam-api/editor-docs/README-editor.md
```

백업 때 아래 스크립트를 `$B/rollback.sh`로 저장해 두면 한 번에 되돌릴 수 있습니다. 권한은 700, 내용에 비밀값을 넣지 마세요.

```sh
sudo bash /var/backups/maps/<STAMP>/rollback.sh
```

되돌린 뒤 [7. 반영 후 확인](#7-반영-후-확인)을 다시 하고, 이전 캐시 버스터로 자산 SHA가 백업과 같은지 봅니다.

API 이미지나 경로 컨테이너를 바꿨다면, 백업해 둔 이전 이미지 태그와 `container-images.txt`의 시작 전 상태로 해당 서비스만 되돌리세요. 프론트엔드 롤백 스크립트만으로는 이미지가 돌아가지 않습니다.

## 9. 주의사항

- `weather-hub`, `inal`, `nuni-id`, `homepage`, `n8n` 등 다른 서비스의 파일·compose·네트워크를 수정하거나 재시작하지 마세요.
- 운영 `.env` 값을 출력·커밋·채팅에 붙이지 마세요. 백업 디렉터리 권한(700/600)을 유지하세요.
- `vendor/`, PMTiles, BRouter JAR, RD5 그래프는 저장소에 없고 운영에만 있습니다. 배포 복사 범위에 넣지 마세요.
- 경로 컨테이너는 로그를 남기지 않도록 설정되어 있습니다.
- Playwright E2E와 브라우저 스크린샷 확인은 이 절차의 필수 통과 조건이 아닙니다. curl·해시·경로 요청으로 서비스를 확인하고, 화면은 별도로 보세요.
- `main`에 올릴 때는 fast-forward만 하고 force push는 하지 마세요.
- 이 저장소에는 운영을 자동으로 수정하는 설치 스크립트를 두지 않았습니다. 2026-11-13 반영 때 쓴 일회성 헬퍼는 저장소 밖 작업 디렉터리에만 있었고, 비밀값은 들어 있지 않았지만 특정 커밋 해시에 묶여 있어 여기 넣지 않았습니다. 운영 서버의 롤백 스크립트는 `/var/backups/maps/<STAMP>/rollback.sh`입니다.
