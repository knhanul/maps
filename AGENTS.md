# AGENTS.md

## Web (api/web/public)
- Plain browser JS, no build step. Cache-buster query `?v=...` in index.html must be bumped when JS/CSS change.
- `web/public/vendor/` (MapLibre GL 5, PMTiles 4, @protomaps/basemaps 5, maplibre-contour) is gitignored; not in repo.
- Image→GPX tracing: trace-model.js (pure) + trace.js (UI, `window.__trace`, hooked first in app.js map click).
- Product name is 길담 스튜디오. Course pane has stages `start`/`new`/`gpx` (`data-stage`, app.js `courseStage()`); the point toolbar `#gpxDock` lives on the map, not in the panel.
- Point move modes (`#gpxMoveMode`): soft (default, `M.softMove`), single, road (auto-applies unless suspicious). E2E harness pins single + confirm via localStorage `gildam.move.v1`.
- GPX editor: gpx-model.js (pure model, DOM only for parse/export) + gpx-editor.js (UI) + app.js bridge (`window.__courseBridge`). Docs: api/editor-docs/README-editor.md.

## Tests
- `cd api && npm test` (Node 24). On Windows `maps.test.mjs` verify/publish fails on symlink path separator (pre-existing, unrelated).
- Model-only: `node --test test/gpx-edit.test.mjs test/gpx-reroute.test.mjs test/trace-model.test.mjs` (load gpx-model.js in a vm; compare vm-realm values via JSON).
- Browser E2E (mocked routing, shared harness test/e2e/harness.mjs): `PLAYWRIGHT_CORE_DIR=<dir with playwright-core@1.55 + maplibre-gl@5 pmtiles@4 @protomaps/basemaps@5 maplibre-contour> CHROME=<chrome.exe> node test/e2e/gpx-roadsnap.e2e.mjs` and `node test/e2e/trace.e2e.mjs`. Map tiles/fonts come from maps.nuni.co.kr.

## Rules
- Do not modify production server configs (/srv/..., compose, nginx) or deploy automatically unless the user explicitly asked to deploy.
- Operator procedure for maps.nuni.co.kr (backup, frontend copy, verify, rollback) is in DEPLOY.md.
- GPX files stay in the browser; only anchor coordinates may go to the own /routing/route.
