# Unified web course editor — v9-editor3 (2026-11-08 KST)

Public menu 코스 편집, choices 새 코스 만들기 / GPX 불러와 수정하기. Same map, walk/hike/bicycle profiles, course name, undo, local save, GPX export. Existing new-course routing, five styles, terrain, POI module and disabled TourAPI status preserved.

Imported GPX is processed ONLY in browser DOM/arrays. No document/trace/point list upload. Full input points are retained (no simplification to 100 waypoints). Multiple trkseg/rte containers, different tracks, and gaps remain separate LineString features; distance sums within segments only. Waypoints and metadata are kept in the immutable source XML, not editable in this UI.

Workflow: choose segment dropdown; choose start/end point numbers or map buttons, zoom and click near actual points. Drag A, move A to a clicked position, add after A by map click, delete A, or trim selected source segment to the selected range. Other segments remain untouched. Undo up to 20 structural snapshots; unmodified point records are shared, not deep-copied per edit.

Selected-section routing: select same-segment range, choose walk/hike/bicycle, click preview; explicit confirmation sends ONLY two anchor coordinates and mode to OWN /routing/route. No full GPX or intermediate trace points. Max direct anchor spacing 30km (existing API). Orange preview doesn't change document. Must Apply or Cancel before saving/exporting. Failures keep old model unchanged and block save/export until canceled. Request version/AbortController ignores stale route responses. Changing profile/selection cancels stale preview.

Conservative route apply: preserve original boundary anchors, replace only interior selected path with a NEW separate segment between retained prefix/suffix segments. Even snapped coordinates slightly off the original anchors are NEVER joined by invented straight links. This can create additional trkseg/rte containers/gaps; inspect preview. Does not promise a seamless snapped connection. Untouched original nodes outside selected interior are preserved exactly semantically, including original time/extensions.

Moved/inserted/routed points contain only new coordinates: no copied old timestamp/elevation/extensions. Elevation profile uses terrain data for the currently selected segment and is not written as fake original elevation. Optional export checkbox strips all time elements (default OFF, preserving original untouched timestamps). Edited export removes stale bounds. XML DOM serialization escapes values, rejects DTD/entities/malformed coords, removes root processing instructions and emits one XML declaration. Original source text/file unchanged. Filename *_수정본.gpx. Original XML retained with saved editable model; localStorage quota failure is explicit and current in-memory edits remain available for export.

Limits: input 30MB, 200k points, 1000 source segments; edited max 250k points/1000 segments. No GPX autosave; explicit browser save supports reopen through existing saved list. beforeunload warns on unsaved geometry/preview. Switching new/import/open prompts before replacing current content. A newly imported comparison record can transfer its original XML to editor in the same session; legacy comparison records without XML explicitly warn before using only their old point list.

Files: web/public/gpx-model.js, gpx-editor.js, editor.css; app.js bridge, import/save/tab hooks; index.html UI/load order. places.js and backend/routing configs untouched. Non-Git deployment. Working/test files /workspace/maps-editor.

Tests: 10k dense points, multiple segments/gaps, source/time/extensions unchanged, move/insert/delete/trim, route split/undo/export, local save/reopen, malformed file keeps current state, 2-anchor-only outgoing payload, pending/failure block, stale suppression; existing new-route UI, POI five-style/toggle and API regressions. Browser rendering QA is a separate final check by parent.

Rollback: restore dated backup app.js/index.html; new unused model/editor/css files may remain without being loaded. No service restart or backend changes are needed. Clear/reload browser page to restore old script version. Never delete users' browser-local saved data during rollback.

# v12-pointedit — 점 단위 편집 개편 + 길 따라 보정 (2026-11-08, 운영 반영)

## 점 편집 (도구 모드 없음)
- 지도: 점 클릭 = 선택, 끌기 = 이동, 선 위 클릭 = 그 위치에 점 추가(PC, 마우스를 올리면 + 표시), Shift+클릭 = 같은 구간 범위 선택, 우클릭 = 메뉴(삭제·앞/뒤 추가·구간 나누기·확대 / 범위 작업).
- 선택 점 양옆 선분에 + 핸들 표시(모바일 포함) → 누르면 중간에 점 추가.
- 상단 고정 도구 막대(#gpxDock): 되돌리기 / 다시 실행 / 이전·다음 점 / 선택 번호(누르면 확대) / + 추가 / 삭제 / 범위(모바일용 범위 선택).
- 선택 점 카드: 원본/수정 점 구분, 좌표, 고도, 원본 시각, 시작부터 거리, 앞뒤 간격. 범위 카드: 점 수·길이, 범위 삭제(앞뒤 분리), 중간 점 지우기(직선), 길 따라 다시 그리기, 이 범위만 남기기.
- 단축키: ←/→, PgUp/PgDn(10점), Home/End, Shift+←/→ 범위, Delete, +, F, Ctrl+Z, Ctrl+Shift+Z/Ctrl+Y, Enter(미리보기 적용), Esc.
- 모델 추가 동작: split(나눈 점 레코드를 양쪽 구간이 공유, 새 좌표 생성 없음), clearInterior. 되돌리기 50단계 + 다시 실행.
- 코스 고도 그래프 클릭 시 가장 가까운 점 선택. 모바일은 지도 설정을 버튼으로 접고, 시험판 안내가 있을 때 패널이 하단 시트로 표시되도록 CSS 수정.
- GPX 모드에서는 새 코스 전용 버튼 줄·안내문을 숨기고, 활동 유형은 길 따라 보정 상자 한 곳에서만 선택.

## 길 따라 보정 (점 이동·추가 후 부분 재탐색)
- 기본 OFF, 첫 ON 시 GPX마다 1회 동의. 동의 후 이동/추가한 점 P와 앞뒤 기준점 L/R 좌표 + 활동 유형만 자체 /routing/route로 전송.
- 기준점: 같은 구간 안에서 경로 거리 약 100/180/300/500m(선택) 이상이면서 P와 직선 15m 이상인 첫 점. 중복점·왕복 루프는 건너뜀. 구간 경계를 넘지 않음. 시작/끝 점은 있는 쪽만 계산.
- L→P, P→R 순차 요청(엔진 동시 1건), 503 3회 재시도, 25초 클라이언트 타임아웃, AbortController + 요청 번호로 이전 결과 무시, LRU 100건 캐시(새 코스 캐시와 별개, 유효 응답만 저장).
- 응답 검증: 좌표 형식/범위, 중복 제거, 요청 지점과 끝점 250m 이내(좌표 순서 오류 탐지), 100km 이하. 고도는 버림.
- 연결 무결성 기준: 두 다리의 P 스냅 차이 3m 초과 → 오류("다른 도로에 연결…"), P 스냅이 이동 위치에서 50m 초과 → 오류. 기준점과 경로 끝 10m 이하 → 같은 구간으로 이음, 초과 → 별도 구간(같은 원본 slot)으로 분리해 직선 연결을 만들지 않음.
- 상태: idle → computing → preview(회색 교체 범위 / 주황 새 경로 / L·R·P 원) → applied 또는 error. 적용은 이동과 같은 히스토리 단계(되돌리기 1번 = 이동+보정 취소). 취소는 이동만 유지. 계산/미리보기/오류 중 저장·내보내기 차단.
- 자동차 모드 없음(서버 프로필 없음). 추가하려면 별도 BRouter 프로필·통행 제한 검증·테스트 필요. "보정 결과 자동 적용" 옵션은 구현하지 않음.

## 테스트
- 단위: `cd api && node --test test/gpx-edit.test.mjs test/gpx-reroute.test.mjs` (Windows에서는 `npm test`의 maps.test.mjs 심볼릭 링크 경로 1건이 기존부터 실패).
- 브라우저 E2E(라우팅 모의, BRouter 실엔진 미사용): `PLAYWRIGHT_CORE_DIR=<playwright-core·maplibre-gl@5·pmtiles@4·@protomaps/basemaps@5·maplibre-contour 설치 폴더> CHROME=<chrome 경로> node test/e2e/gpx-roadsnap.e2e.mjs`. web/public/vendor가 있으면 그 번들을 우선 사용. 지도 타일·글꼴은 maps.nuni.co.kr 공개 자원을 읽음.

## 배포/롤백
- 변경 파일: web/public/{index.html, app.js, app.css, editor.css, gpx-model.js, gpx-editor.js}. 백엔드·라우팅·nginx 변경 없음. 캐시 버스터 `v12-pointedit`.
- 롤백: 위 6개 파일을 이전 백업으로 되돌림. 브라우저 저장 데이터 형식은 그대로(새 split 결과도 기존 segments 배열 형식).
- 운영 반영 절차의 자세한 내용은 저장소 루트 `DEPLOY.md`를 본다.

## 이미지로 GPX 만들기 (trace-model.js + trace.js)
- 코스 편집 탭 → [이미지로 GPX 만들기]. PNG/JPG/WEBP ≤25MB, 처리용 최대 1600px로 축소. 이미지는 브라우저 밖으로 나가지 않음.
- 1 위치 맞추기: 사이드 패널·지도 설정 상자를 피해 지도 위에 반투명 표시. ✥ 끌기 = 이동, ◢ 끌기 = 크기·회전. [기준점 추가] → 이미지의 지점 클릭 → (이미지 자동 흐림) 바탕 지도의 같은 지점 클릭. 2곳 이상이면 최소제곱 유사변환(확대·회전·이동, Web Mercator 기준이라 지도 캡처에 정확), 평균/최대 오차(m) 표시. 손으로 옮기면 기준점 초기화.
- 2 선 색: 선 근처 클릭 → 반경 4px에서 채도 가장 높은 픽셀 선택, RGB 가중 거리 ≤ 허용 범위로 마스크(분홍 표시). 인식 비율이 너무 크거나 작으면 안내.
- 3 출발 A / 도착 B / 경유점(가는 순서): 클릭 위치를 15px 안의 선 픽셀에 붙임.
- 4 추출: 픽셀 격자 A*. 선 픽셀 비용 1(가장자리 1.5), 선 밖 픽셀 비용 = "끊긴 곳 건너뛰기 비용"(기본 25) → 아이콘·글자로 끊긴 짧은 틈은 건너고 긴 지름길은 피함. Douglas–Peucker(0.8px) 단순화 후 좌표 변환. 건너뛴 최대 길이 표시(500m 넘으면 경고).
- 길 따라 보정(선택): 추출 선 위의 기존 점을 0.8/1.5/3km 간격으로 골라(새 점 생성 없음) 걷기·등산·자전거로 순차 요청(최대 80구간, 동의 1회). 이어지지 않는 다리(>3m)는 직선 대신 구간 분리. 이미지 선과 150m 넘게 다른 다리는 빨간색 표시 + 경고.
- 출력: [GPX 편집기로 열기](이미지는 고정된 채 남겨 비교, 추출선·마스크는 숨김) 또는 [GPX 내려받기]. 새 점에는 시각·고도 없음.
- 한계: 정확도는 이미지 해상도에 좌우(예: 770px에 30km면 1px≈40m). 같은 색 선이 겹치거나 갈라지면 경유점이 필요. 기준점을 잘못 찍으면 전체가 어긋남.
- 테스트: `node --test test/trace-model.test.mjs`, 브라우저 `node test/e2e/trace.e2e.mjs`(합성 지도 이미지, 라우팅 모의). 변경 파일에 web/public/trace-model.js, trace.js 추가.

# v13-studio — 길담 스튜디오 리모델링 (2026-11-13, 운영 반영)

## 화면 구조
- 이름을 **길담 스튜디오**로 바꾸고 기본 탭을 `코스 편집`으로 했다(`기록 비교`는 둘째 탭). 왼쪽 위 이름을 누르면 처음 화면으로 간다.
- 코스 편집 패널은 `data-stage`로 세 단계를 가진다(app.js `courseStage()`): `start`(GPX 파일 열기 / 새 코스 그리기 두 버튼만), `new`(새 코스), `gpx`(불러온 GPX 편집). `.work`는 start에서 숨기고 `.at-start`는 start에서만 보인다. 그리던 코스가 남아 있으면 start 대신 new로 열린다.
- start 단계에서는 지도 클릭으로 점이 찍히지 않는다(새 코스 그리기를 눌러야 시작).
- GPX 파일을 지도에 놓으면 1개는 편집기로, 2개 이상은 기록 비교로 연다.
- 점 도구 막대(#gpxDock)는 패널 안이 아니라 지도 위에 뜬다. 휴대폰에서는 맨 윗줄을 쓰고 지도 버튼이 그 아래로 내려간다.
- 지도 설정은 모든 화면 크기에서 버튼 뒤에 접는다. 저장/내려받기 줄은 패널 아래에 붙어 있다.
- 안내 문구는 패널 맨 아래 "파일과 개인정보는 어떻게 다루나요?" 한 곳으로 모았다. 구간 선택·번호 입력·시각 제거는 "상세 편집 · 내보내기 옵션"에 접었다.

## 점 이동 방식 (#gpxMoveMode)
- **주변 함께(soft, 기본)**: 끈 점 주변의 점이 코사인 가중치로 함께 움직인다(gpx-model.js `softShift`/`softMove`). 범위는 화면 기준 약 40/80/160px(좁게/보통/넓게)를 미터로 환산하므로 확대할수록 좁아진다. 경로 거리 기준이라 구간을 넘지 않고, 점 간격이 범위보다 넓으면 한 점만 움직인다. 함께 움직인 점도 수정한 점이 되어 원래 시각·고도가 없다.
- **이 점만(single)**: 이전과 같은 한 점 이동.
- **길 따라(road)**: 기존 길 따라 보정. 결과가 정상이면 **바로 적용**하고 1.8초 강조한 뒤 토스트로 알린다(되돌리기 한 번으로 이동+보정 취소). 다음 경우에만 미리보기에서 멈춘다: 기준점과 10m 넘게 떨어져 구간이 나뉘는 경우, 길이가 교체 구간의 3배+200m를 넘는 경우. 오류 처리는 그대로다. "항상 미리 보고 적용"을 켜면 이전 흐름과 같다.
- 선택은 localStorage `gildam.move.v1`({mode, softPx, confirm})에 남는다. road는 GPX를 열 때마다 꺼진 상태로 시작한다.
- 좌표 전송 동의는 GPX마다가 아니라 브라우저당 한 번 묻는다(`gildam.routeConsent.v1`). 구간 "길 따라 다시 그리기"도 같은 동의를 쓴다.
- 선택 점 카드는 번호 대신 "출발에서 N km"를 먼저 보여 주고 좌표·고도·시각은 "점 정보"에 접는다.

## 겹친 구간(왕복·반복 코스)
- 같은 자리를 두 번 지나는 곳에서는 **지금 고른 점과 이어진 쪽이 우선**이다. gpx-model.js `groupPasses`(화면 근처 점/선을 인덱스 간격 8 초과 또는 구간 변경으로 "지나감" 단위로 묶음) + `pickPass`(가장 가까운 것보다 6px 이내인 후보 중 같은 구간·인덱스 차가 작은 쪽). 6px 넘게 떨어져 보이면 가까운 쪽이 그대로 잡힌다.
- 점 클릭, 선 클릭 점 추가, 마우스 올림 + 표시가 모두 이 규칙을 쓴다. 화면 점(핸들)도 선택 점에서 바깥으로 퍼지는 순서로 그려, 겹친 칸은 편집 중인 쪽이 차지한다.
- 이미 선택된 겹친 점을 한 번 더 누르면 다른 쪽으로 넘어간다(`switchPass`, 토스트로 "먼저/나중에 지나는 쪽 · 출발에서 N km" 안내). 점 카드의 "겹친 다른 쪽 고르기" 버튼과 우클릭 메뉴도 같다. 겹침 판정은 선택 점 화면 위치 14px 안, 확대 14 이상에서만 한다.
- 고도 그래프 클릭은 좌표가 아니라 거리 위치로 점을 고른다(`__gpxEditor.selectAt`). 왕복 코스에서 오는 길을 바로 고를 수 있다.
- 새 코스의 선 클릭 추가도 고른 지점과 이어진 사이(leg)에 넣는다.
- 겹친 반대쪽 선을 옅게 표시하는 것은 하지 않았다.

## 새 코스 (app.js)
- GPX 편집과 같은 조작: 점 클릭 = 선택, 끌기 = 이동, 선 클릭 = 사이에 지점 추가(마우스, + 표시), Delete = 선택 지점 삭제(선택이 없으면 "점 삭제"는 마지막 지점), Ctrl+Z, Esc. 우클릭 삭제도 남아 있다.
- 길 따라 모드에서 선 클릭 위치가 어느 지점 사이인지는 `legStart`(leg별 geometry 시작 인덱스)로 찾는다.

## 테스트
- `test/gpx-edit.test.mjs`에 softMove 2건, groupPasses/pickPass 2건 추가. E2E 하네스는 `gildam.move.v1`을 `{mode:"single",confirm:true}`로 넣어 기존 단일 점 이동·미리보기 흐름을 그대로 검증한다. **v13 변경 뒤 E2E는 실행하지 못했다**(playwright-core 미설치). 주변 함께 끌기, 길 따라 자동 적용/미리보기 멈춤, 새 코스 선 클릭 추가·Delete, 휴대폰 배치는 로컬 미리보기에서 손으로 확인했다.

## 배포/롤백
- 변경 파일: web/public/{index.html, app.js, app.css, editor.css, gpx-model.js, gpx-editor.js}. 백엔드·라우팅 변경 없음. 캐시 버스터 `v13-studio`. 브라우저 저장 데이터 형식은 그대로다.
- 운영 반영·백업·확인·롤백 절차는 저장소 루트 `DEPLOY.md`를 따른다.
