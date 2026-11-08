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

# v12-pointedit — 점 단위 편집 개편 + 길 따라 보정 (2026-11-08, 미배포)

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
