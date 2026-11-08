# 길담 웹 길 따라 연결 — 2026-11-08

Service /srv/gildam-routing, separate from non-Git web deployment /srv/gildam-api.
Engine: BRouter 1.7.10, MIT (LICENSE.brouter); graph data © OpenStreetMap contributors, ODbL.
Official release https://github.com/abrensch/brouter/releases/tag/v1.7.10
Graph source https://brouter.de/brouter/segments4/ (downloaded 2026-11-08 KST).
Six 5-degree tiles E120/E125/E130 x N30/N35 cover South Korea including Jeju/Ulleung/Dokdo; actual routes require connected OSM paths. No ferry or fabricated sea connections.
Profiles derive from release profiles2/hiking-mountain.brf and trekking-noferries.brf:
- gildam-walk: hiking preference 0, SAC limit 1, ferries off; ordinary pedestrian paths preferred, not a wheelchair/accessibility guarantee.
- gildam-hike: original mountain hiking preference, SAC limit 3, ferries off. Can include challenging mountain paths; field safety is user's responsibility.
- gildam-bike: original trekking-noferries (touring bicycle, not car or racing).
OSM access/restriction data may be incomplete/outdated; do not treat as navigation safety advice.

Only POST /routing/route with {from:[lon,lat],to:[lon,lat],mode:walk|hike|bike} is exposed by nginx. Max 2KB, domestic bbox, 30km direct point spacing; 100km calculated route cap, 15s proxy engine timeout. One route computed at a time. Explicit errors; no straight-line fallback. Memory-only bounded route cache, no payload logging; Java logs discarded to prevent persisted waypoint coordinates. Engine network internal, no ports exposed. API no public port, shared web network only. Limits: engine 384MiB/0.75 CPU, API 128MiB/0.25 CPU. No paid/public routing service is called.

User imported GPX remains local. Old saved/draft data is loaded as original straight/GPX geometry without network routing. Opting into route mode on existing points requires browser confirmation; only waypoints are sent to this server. New drafts default to route mode. Failed/pending geometry cannot be saved or exported as a completed route. Current version does not persist server cache or auto-update graph data.

Manage: cd /srv/gildam-routing && sudo docker compose -f compose.yml up -d
Health: docker exec gildam-routing-api node -e "fetch('http://127.0.0.1:17778/healthz').then(r=>r.text()).then(console.log)"
Data updates: stage new tiles separately, validate compatible lookups/profiles, back up current files, then replace/restart during maintenance; never mix tile generations. No recurring update task configured.

Rollback: Restore backed-up /srv/gildam-api/web/public/{app.js,index.html} and /srv/gildam-api/tiles/nginx.conf, nginx -t then nginx -s reload in gildam-tiles. Stop only the two gildam-routing containers. Do not affect existing API/map-worker services.
