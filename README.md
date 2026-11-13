# 길담 스튜디오 WEB 소스

길담 앱은 길을 **기록**하는 앱이고, 길담 스튜디오(이 저장소)는 기록한 GPX를 **고치고 새 코스를 그리는** 웹입니다. 화면 개편 내용은 `api/editor-docs/README-editor.md`의 v13-studio 절을 보세요.

https://maps.nuni.co.kr 운영 서버와 맞춰 둔 소스입니다. Android 앱 저장소는 아닙니다. 운영에 반영하는 방법은 저장소 루트 `DEPLOY.md`를 보세요. 기존 PUBLIC 저장소의 공개 범위는 변경하지 않았습니다.

## 구성
- `api/web/public/`: 지도, POI, 길 따라 코스 생성, 브라우저 내 원본 보존 GPX 직접 편집
- `api/src/`, `api/test/`: Node 24 API·관리 UI·로컬 테스트
- `api/map-worker/`, `api/worker/`: 지도 생성 워커와 참조 구현
- `api/styles/`: 스타일 생성 소스와 생성된 JSON 5종
- `api/tourism-tools/`: 선택적 TourAPI 어댑터. 키가 없어 현재 보충 데이터 비활성
- `api/docker-compose.yml`, `api/tiles/nginx.conf`, `deployment/maps.caddy.example`: 해당 지도 서비스 배포 구성만
- `routing/`: 자체 BRouter 프록시·제한된 Compose·걷기/등산/자전거 프로필·MIT 라이선스
- `DEPLOY.md`: maps.nuni.co.kr 운영 반영·백업·확인·롤백
- `api/editor-docs/`, 각 서비스 README: 상세 동작·운영 참고

## 실행·검증
```sh
cd api
npm test                         # Node >=24, 별도 패키지 설치 불필요
cp .env.example .env
cp map-worker.env.example map-worker.env
```
API는 `node --experimental-sqlite src/server.mjs`로 실행할 수 있습니다. 운영 인증은 OIDC/JWKS 환경 설정이 필요하며 테스트는 자체 임시 인증 서버와 DB를 사용합니다. 실서비스 토큰은 포함하지 않았습니다. 워커를 사용할 때만 별도 토큰과 SHA256 해시를 로컬에서 설정하세요.

전체 WEB 실행은 데이터/라이브러리 준비 후 Docker Compose와 전용 프록시가 필요합니다. 설정에는 기존 `/srv/gildam-maps` 경로·uid/gid·외부 `web` Docker 네트워크·운영 도메인이 남아 있으므로 자신의 환경에 맞게 검토해야 합니다. 이 저장소만으로 완전한 재현 실행을 보장하지 않습니다. 운영 서버를 자동 수정하는 설치 스크립트는 없습니다.

## 별도 준비할 공개 데이터·라이브러리
- PMTiles 지도·지형, 폰트 glyph와 sprites, 지도 manifest/release 정보는 배포 데이터로 제외했습니다. OSM/Protomaps 기반 데이터를 직접 준비하고 API 지도 카탈로그에 등록해야 합니다.
- WEB의 `vendor/` 배포 번들은 제외했습니다. index.html이 참조하는 MapLibre GL JS/CSS, PMTiles, Protomaps basemaps, maplibre-contour의 호환 배포 파일을 해당 프로젝트에서 받아 배치하세요. 원본 번들 버전/취득 정보를 확인하지 못했으므로 임의 최신 버전을 보장하지 않습니다.
- 스타일 재생성은 `@protomaps/basemaps` 5 계열을 로컬 설치한 후 `api/styles/generated`에서 `node ../generate-styles.cjs`로 수행합니다. 운영 JSON은 함께 보존했습니다.
- BRouter 1.7.10 JAR: https://github.com/abrensch/brouter/releases/tag/v1.7.10
- RD5 그래프: https://brouter.de/brouter/segments4/ . 대한민국·제주/대상 도서 지역에 해당하는 타일을 `routing/segments4/`에 별도 준비하세요. 상세 범위·제약은 `routing/README-routing.md` 참고. JAR/RD5는 업로드하지 않았습니다.
- TourAPI 공식 안내: https://www.data.go.kr/data/15101578/openapi.do . 전용 승인 키는 서버 환경 변수로만 설정하며 파일·GPX·사용자 코스 좌표를 관광 API로 보내지 않습니다.

## 개인정보·라이선스
개인 GPX, 사용자 DB, 로그, 업로드, 백업, .env, 토큰·키 및 대용량 지도 자료는 제외했습니다. `tests/fixtures/qa-segments.gpx`만 실제 이동 기록이 아닌 합성 시험 자료입니다. GPX 편집 원본은 브라우저에 남고 길 따라를 명시적으로 선택할 때만 선택 앵커를 자체 라우터로 보냅니다.

OSM © OpenStreetMap contributors / ODbL: https://www.openstreetmap.org/copyright . BRouter MIT는 `routing/LICENSE.brouter`에 보존했습니다. Protomaps·MapLibre·PMTiles·contour·폰트 등 추가 배포물의 자체 라이선스/표시 의무도 준수해야 합니다. 프로젝트 자체의 신규 라이선스를 임의로 지정하지 않았습니다.

## 원본과의 차이
운영 IP를 문서/관리 UI 도움말/프록시 주석에서 `YOUR_SERVER_IP`로 치환했습니다. 스타일 생성기의 특정 작업 컴퓨터 절대 require 경로만 패키지 이름으로 바꿨습니다. 실제 운영 코드는 수정하지 않았습니다. 프로필 안내문의 줄 끝 공백도 정리했습니다. 기타 소스는 서버에서 직접 복사했으며 SHA256 비교 결과는 `SOURCE-SNAPSHOT.json`에 기록했습니다. 예제 환경 파일·이 README·gitignore·합성 fixture는 저장소용 추가 파일입니다.

구버전 브라우저 비교 기록은 구간 경계를 저장하지 않았으므로 원본 GPX 재불러오기가 필요합니다. 현재 버전은 구간별 렌더링·거리 계산 및 경계 저장을 지원합니다.
