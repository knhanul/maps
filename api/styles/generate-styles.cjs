const b = require('@protomaps/basemaps');
const fs = require('fs');
const BASE = 'https://maps.nuni.co.kr';
const ATTR = '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank">© Protomaps</a>';
const mk = (id, name, flavorName, flavor, sprite, tweak, meta) => {
  let layers = b.layers('protomaps', flavor, { lang: 'ko' });
  if (tweak) layers = tweak(layers);
  const st = { version: 8, name: `gildam-${id}`, metadata: { 'gildam:id': id, 'gildam:name': name, 'gildam:tiles': 'sources.protomaps.url 을 manifest.tiles_url 로 바꿔 써도 됨', ...meta },
    glyphs: `${BASE}/fonts/{fontstack}/{range}.pbf`, sprite: `${BASE}/sprites/v4/${sprite}`,
    sources: { protomaps: { type: 'vector', url: `pmtiles://${BASE}/tiles/current/gildam.pmtiles`, attribution: ATTR } }, layers };
  fs.writeFileSync(`${id}.json`, JSON.stringify(st));
  return { id, name, url: `${BASE}/styles/${id}.json` };
};
const L = b.namedFlavor('light');
// 등산: 길·산책로 강조, POI 줄임, 음영 강하게(메타데이터로 앱에 전달)
const outdoorFlavor = { ...L, other: '#b5562d', minor_service: '#ffffff', park_a: '#cfe3c2', park_b: '#c3dbb4', wood_a: '#cde0c0', wood_b: '#bfd6af', earth: '#f1efe6' };
const outdoor = (ls) => ls.map((l) => {
  if (l.id === 'other') return { ...l, minzoom: 12, paint: { ...l.paint, 'line-color': '#b5562d', 'line-dasharray': [2, 1], 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.8, 15, 2.2, 18, 5] } };
  if (l.id === 'pois') return { ...l, filter: ['all', l.filter || true, ['in', ['get', 'kind'], ['literal', ['peak', 'park', 'national_park', 'nature_reserve', 'water', 'camp_site', 'alpine_hut', 'shelter', 'viewpoint', 'toilets', 'drinking_water', 'parking', 'bus_stop', 'station']]]] };
  return l;
});
// 길담: 브랜드 녹색 계열, 차분하게, 라벨 전부
const brand = { ...L, background: '#f4f2ec', earth: '#f4f2ec', park_a: '#d9e8d8', park_b: '#cfe2cd', wood_a: '#d6e6d3', wood_b: '#cbdec7', scrub_a: '#e0eadb', scrub_b: '#d8e4d2', water: '#bcd6d4', buildings: '#e6e2d8', highway: '#ffffff', highway_casing_early: '#c9c4b5', highway_casing_late: '#c9c4b5', major: '#ffffff', major_casing_early: '#d6d1c4', major_casing_late: '#d6d1c4', minor_a: '#ffffff', minor_b: '#ffffff', other: '#7a8f6f', city_label: '#2f3d36', city_label_halo: '#f4f2ec', subplace_label: '#5d6b63', subplace_label_halo: '#f4f2ec', roads_label_major: '#5d6b63', roads_label_minor: '#6f7a72', ocean_label: '#5f8f8c', state_label: '#7b867f', country_label: '#56645c' };
const list = [
  mk('light', '기본', 'light', L, 'light', null, { 'gildam:hillshade': 0.35 }),
  mk('dark', '야간', 'dark', b.namedFlavor('dark'), 'dark', null, { 'gildam:hillshade': 0.25, 'gildam:hillshade-shadow': '#000000', 'gildam:hillshade-highlight': '#555555', 'gildam:contour-color': '#c9b27a' }),
  mk('grayscale', '흑백', 'grayscale', b.namedFlavor('grayscale'), 'grayscale', null, { 'gildam:hillshade': 0.35 }),
  mk('outdoor', '등산', 'light', outdoorFlavor, 'light', outdoor, { 'gildam:hillshade': 0.6, 'gildam:contour-color': '#9a6b2f', 'gildam:contour-emphasis': true }),
  mk('gildam', '길담', 'light', brand, 'light', null, { 'gildam:hillshade': 0.35, 'gildam:contour-color': '#7a8f6f' }),
];
fs.writeFileSync('index.json', JSON.stringify({ default: 'light', items: list }, null, 1));
console.log(list.map((x) => x.id + ' ' + fs.statSync(x.id + '.json').size).join('\n'));
