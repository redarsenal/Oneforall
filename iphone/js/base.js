/*
 * OneforAll pour iPhone : client d'addons Stremio en application web (à ajouter à l'écran d'accueil).
 *
 * Même logique que l'app TV (web/app.js, 4.4.1) : addons, fiches en français, sources triées,
 * Trakt, IPTV en ordre Canal+ ; mais une interface faite pour le doigt et l'écran vertical
 * (iPhone 14 Pro : 393 x 852 points, Dynamic Island et barre d'accueil respectées).
 *
 * Aucune clé n'est dans les fichiers en ligne : addons, IPTV et Trakt arrivent par le
 * « code de configuration » préparé sur le Mac (iphone/build.sh) et collé dans l'app.
 */
//
// Le code est réparti en plusieurs fichiers js/*.js, chargés dans l'ordre par index.html.
// Ce sont des scripts classiques (pas de modules, aucune étape de build) : ils partagent
// la même portée, donc une fonction ou une constante d'un fichier est visible dans les autres.
// Le code qui s'exécute au chargement ne doit utiliser que ce qui est défini dans un fichier
// précédent ; tout le reste (fonctions, écrans) peut se référencer librement.
// Ne pas nommer une variable globale comme une propriété du navigateur (top, name, status…).
'use strict';

var VERSION = '1.0.9';
var TV_VERSION = '4.4.1';
var CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
var TRAKT_DEFAULT = 'EQpDUWqtRawg2T1wY0v9IwqyaqM50diU9gBkIbHgb1k';
var HOME_TTL = 20 * 60e3;
var STREAM_TTL = 10 * 60e3;

// =====================================================================
// Utilitaires
// =====================================================================
const $ = s => document.querySelector(s);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const pad = n => (n < 10 ? '0' : '') + n;
const plural = (n, s, p) => n + ' ' + (n > 1 ? (p || s + 's') : s);
const hostOf = u => { const m = /^\w+:\/\/([^\/?#]+)/.exec(u || ''); return m ? m[1] : ''; };
const baseOf = u => u.replace(/\/manifest\.json(\?.*)?$/, '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clock = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const HTTPS = location.protocol === 'https:';
function fmt(t) {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return (h ? h + ':' + pad(m) : m) + ':' + pad(s);
}
function debounce(fn, ms) {
  let t = 0, args = null;
  const f = function () { args = arguments; clearTimeout(t); t = setTimeout(() => { t = 0; fn.apply(null, args); }, ms); };
  f.flush = () => { if (t) { clearTimeout(t); t = 0; fn.apply(null, args); } };
  return f;
}
const store = {
  get(k, d) { try { const x = localStorage.getItem('ofa_' + k); return x == null ? d : JSON.parse(x); } catch (e) { return d; } },
  set(k, v) {
    try { localStorage.setItem('ofa_' + k, JSON.stringify(v)); } catch (e) {
      try { localStorage.removeItem('ofa_home'); localStorage.setItem('ofa_' + k, JSON.stringify(v)); } catch (e2) {}
    }
    return v;
  }
};
// Gros caches (chaînes IPTV) : IndexedDB, sans le plafond de ~5 Mo de localStorage ; null / false si indisponible.
const idb = (() => {
  let db = null;
  const open = () => db || (db = new Promise(res => {
    try {
      const r = indexedDB.open('oneforall', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = r.onblocked = () => res(null);
    } catch (e) { res(null); }
  }));
  const run = (mode, fn) => open().then(d => d && new Promise(res => {
    try {
      const t = d.transaction('kv', mode), q = fn(t.objectStore('kv'));
      t.oncomplete = () => res(q && q.result !== undefined ? q.result : true);
      t.onerror = t.onabort = () => res(null);
    } catch (e) { res(null); }
  }), () => null);
  return {
    get: k => run('readonly', s => s.get(k)).then(v => (v === true ? null : v), () => null),
    set: (k, v) => run('readwrite', s => s.put(v, k)).then(x => !!x, () => false),
    del: k => run('readwrite', s => s.delete(k)).then(x => !!x, () => false)
  };
})();
const CFG = Object.assign({ player: 'auto', ext: 'vlc', subLang: 'fre', subAuto: false, theme: 'auto', liveQ: 'fhd', anim: 'soft' }, store.get('cfg', {}));
const saveCfg = () => store.set('cfg', CFG);
let SETUP = store.get('setup', null);   // { trakt: { id, secret, redirect }, iptv: { servers, username, password } }

// ---------- métadonnées ----------
function year(m) { return String(m.releaseInfo || m.year || '').slice(0, 4); }
function typeLabel(t) { return { movie: 'Films', series: 'Séries', anime: 'Animés', channel: 'Chaînes', tv: 'TV' }[t] || t; }
const kindLabel = t => (t === 'series' ? 'Série' : t === 'movie' ? 'Film' : typeLabel(t));
const GENRES_FR = {
  Action: 'Action', Adventure: 'Aventure', Animation: 'Animation', Biography: 'Biographie', Comedy: 'Comédie', Crime: 'Policier',
  Documentary: 'Documentaire', Drama: 'Drame', Family: 'Famille', Fantasy: 'Fantastique', History: 'Histoire', Horror: 'Horreur',
  Music: 'Musique', Musical: 'Comédie musicale', Mystery: 'Mystère', Romance: 'Romance', 'Sci-Fi': 'Science-fiction',
  'Science Fiction': 'Science-fiction', Sport: 'Sport', Thriller: 'Thriller', War: 'Guerre', Western: 'Western',
  'Reality-TV': 'Téléréalité', 'Game-Show': 'Jeu télévisé', 'Talk-Show': 'Talk-show', News: 'Actualités',
  'Action & Adventure': 'Action & aventure', 'Sci-Fi & Fantasy': 'Science-fiction & fantastique', Kids: 'Enfants', Soap: 'Feuilleton', 'War & Politics': 'Guerre & politique',
  'Mini-Series': 'Mini-série', Suspense: 'Suspense', 'Talk Show': 'Talk-show', Reality: 'Téléréalité', 'Game Show': 'Jeu télévisé',
  Food: 'Cuisine', Travel: 'Voyage', 'Home and Garden': 'Maison & jardin', Children: 'Enfants', Anime: 'Animé', 'Martial Arts': 'Arts martiaux',
  'Awards Show': 'Cérémonie', Podcast: 'Podcast', Indie: 'Indépendant'
};
function rawGenres(m) {
  let g = m.genres || m.genre;
  if (!g && m.links) g = m.links.filter(l => l.category === 'Genres').map(l => l.name);
  return Array.isArray(g) ? g : (g ? [String(g)] : []);
}
const genreList = m => rawGenres(m).map(x => GENRES_FR[x] || x);
function epLabel(v) { return 'S' + (v.season || 0) + ' · É' + (v.episode || 0); }
function epTitle(v) { const t = v.title || v.name; return epLabel(v) + (t ? ' · ' + t : ''); }
function sortVideos(list) {
  return (list || []).map((v, i) => ({ v, i })).sort((a, b) => {
    const sa = a.v.season || 0, sb = b.v.season || 0;
    if ((sa === 0) !== (sb === 0)) return sa === 0 ? 1 : -1;
    return (sa - sb) || ((a.v.episode || 0) - (b.v.episode || 0)) || (a.i - b.i);
  }).map(x => x.v);
}
function nextVideo(meta, v) {
  const l = sortVideos(meta.videos);
  for (let i = 0; i < l.length - 1; i++) if (l[i].id === v.id) return l[i + 1].season ? l[i + 1] : null;
  return null;
}
function slim(m, base, type) {
  return {
    id: m.id, type: m.type || type, name: m.name, poster: m.poster, background: m.background, logo: m.logo,
    description: m.description ? String(m.description).slice(0, 420) : '', releaseInfo: year(m),
    imdbRating: m.imdbRating, genres: rawGenres(m).slice(0, 3), _base: base
  };
}
function itemOf(m) { return { id: m.id, type: m.type, name: m.name, poster: m.poster, background: m.background, logo: m.logo, releaseInfo: year(m), _base: m._base }; }
function frDate(s) {
  const d = s ? new Date(s) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
function img(u, w) {
  if (!u) return '';
  u = String(u).replace('image.tmdb.org/t/p/original/', 'image.tmdb.org/t/p/w' + (w || 780) + '/');
  return u.replace(/^http:\/\//i, 'https://');
}

// =====================================================================
// Réseau
// =====================================================================
function netErr(e) { return new Error(e && e.name === 'AbortError' ? 'délai dépassé' : 'injoignable'); }
async function request(url, timeout, asBuffer) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout || 15000);
  try {
    let r;
    try { r = await fetch(url, { signal: ctl.signal, credentials: 'omit' }); } catch (e) { throw netErr(e); }
    if (asBuffer) { if (!r.ok) throw new Error('erreur ' + r.status); return await r.arrayBuffer(); }
    let d = null;
    try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error((d && d.error) || 'erreur ' + r.status);
    if (!d || typeof d !== 'object') throw new Error('réponse illisible');
    return d;
  } finally { clearTimeout(t); }
}
const memo = new Map();
function getJSON(url, ttl, timeout) {
  const e = memo.get(url), now = Date.now();
  if (e && e.p) return e.p;
  if (e && now - e.at < (ttl == null ? 600e3 : ttl)) return Promise.resolve(e.d);
  const p = request(url, timeout).then(d => {
    memo.delete(url); memo.set(url, { at: Date.now(), d });
    if (memo.size > 400) memo.delete(memo.keys().next().value);
    return d;
  }, err => { memo.delete(url); throw err; });
  memo.set(url, { p });
  return p;
}
async function fetchText(url) {
  const buf = await request(url, 15000, true);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}

// =====================================================================
// Addons
// =====================================================================
let addons = [];
const manifests = store.get('manifests', {});
const saveManifests = debounce(() => store.set('manifests', manifests), 400);
function normUrl(u) {
  u = String(u || '').replace(/\s+/g, '').replace(/^stremio:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!/\/manifest\.json(\?.*)?$/.test(u)) u = u.replace(/\/+$/, '') + '/manifest.json';
  return u;
}
const addonUrls = () => addons.map(a => a.url);
function makeAddon(url) {
  const m = manifests[url];
  return m ? { url, base: baseOf(url), m } : { url, base: baseOf(url), m: { name: hostOf(url), resources: [] }, err: 'chargement…', loading: true };
}
function setAddons(urls) { addons = urls.map(makeAddon); store.set('addonUrls', urls); }
setAddons(store.get('addonUrls', [CINEMETA]));
let manGen = 0;
function refreshManifests(force) {
  const gen = ++manGen, list = addons.slice();
  return Promise.all(list.map(a => getJSON(a.url, force ? 0 : 3 * 3600e3, 12000).then(m => {
    if (!m || !m.id || !m.resources) throw new Error('manifest invalide');
    return { a, m };
  }, e => ({ a, e })))).then(res => {
    if (gen !== manGen) return false;
    let changed = false;
    res.forEach(x => {
      const a = x.a;
      if (x.m) {
        if (!same(manifests[a.url], x.m)) { manifests[a.url] = x.m; changed = true; }
        if (a.err || !same(a.m, x.m)) changed = true;
        a.m = x.m; delete a.err; delete a.loading;
      } else if (!manifests[a.url]) { a.err = x.e.message; delete a.loading; changed = true; }
    });
    Object.keys(manifests).forEach(u => { if (!list.some(a => a.url === u)) delete manifests[u]; });
    saveManifests();
    return changed;
  });
}
function supports(a, res, type, id) {
  const m = a.m, rs = (m && m.resources) || [];
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i], name = typeof r === 'string' ? r : r.name;
    if (name !== res) continue;
    const types = (typeof r === 'object' && r.types) || m.types || [];
    const pre = (typeof r === 'object' && r.idPrefixes) || m.idPrefixes;
    if (type && types.length && types.indexOf(type) < 0) continue;
    if (id && pre && pre.length && !pre.some(p => String(id).indexOf(p) === 0)) continue;
    return true;
  }
  return false;
}
const isCinemeta = a => a.url === CINEMETA || (a.m && a.m.id === 'com.linvo.cinemeta');
const needsExtra = cat => (cat.extra || []).some(e => e.isRequired) || (cat.extraRequired || []).length > 0;
const canSearch = cat => (cat.extra || []).some(e => e.name === 'search') || (cat.extraSupported || []).indexOf('search') > -1;
function catalogs(filter) {
  const jobs = [];
  addons.forEach(a => { if (!a.err) (a.m.catalogs || []).forEach(cat => { if (filter(cat)) jobs.push({ a, cat }); }); });
  return jobs;
}
const CAT_FR = {
  Popular: 'Populaires', New: 'Nouveautés', Featured: 'Mieux notés sur IMDb', Top: 'Top',
  'TMDB Popular': 'Populaires sur TMDB', 'TMDB Trending': 'Tendances sur TMDB', 'TMDB Top Rated': 'Mieux notés sur TMDB',
  'TMDB Airing Today': 'Diffusées aujourd’hui', 'TVDB Tendances': 'Tendances TVDB', 'TVmaze Programme Quotidien': 'Au programme aujourd’hui'
};
const catName = j => CAT_FR[j.cat.name] || j.cat.name || j.cat.id;
function fetchCatalog(j, extra, ttl) {
  const u = j.a.base + '/catalog/' + j.cat.type + '/' + encodeURIComponent(j.cat.id) + (extra ? '/' + extra : '') + '.json';
  return getJSON(u, ttl, 15000).then(d => (d.metas || []).slice(0, 40).map(m => slim(m, j.a.base, j.cat.type)));
}

// ---------- fiches ----------
const FR = store.get('fr', {});
const saveFr = debounce(() => {
  const k = Object.keys(FR);
  if (k.length > 400) k.sort((a, b) => FR[a].at - FR[b].at).slice(0, k.length - 400).forEach(x => { delete FR[x]; });
  store.set('fr', FR);
}, 2000);
const loc = m => { const f = m && FR[m.type + '/' + m.id]; return f ? Object.assign({}, m, f.d) : m; };
const metaMemo = new Map();
function metaFor(item) {
  const k = item.type + '/' + item.id;
  if (metaMemo.has(k)) return metaMemo.get(k);
  const own = addons.find(a => a.base === item._base);
  const rank = a => (a === own && !isCinemeta(a) ? 0 : isCinemeta(a) ? 2 : 1);
  const list = addons.filter(a => !a.err && supports(a, 'meta', item.type, item.id)).sort((a, b) => rank(a) - rank(b));
  const p = (async () => {
    for (const a of list) {
      try {
        const d = await getJSON(a.base + '/meta/' + item.type + '/' + encodeURIComponent(item.id) + '.json', 3600e3, 15000);
        if (d && d.meta) return d.meta;
      } catch (e) {}
    }
    return null;
  })();
  p.then(m => {
    if (!m) return metaMemo.delete(k);
    if (m.description) {
      const d = { name: m.name, description: String(m.description).slice(0, 420) };
      if (m.logo) d.logo = m.logo;
      const g = rawGenres(m).slice(0, 3);
      if (g.length) d.genres = g;
      FR[k] = { at: Date.now(), d };
      saveFr();
    }
  });
  metaMemo.set(k, p);
  if (metaMemo.size > 80) metaMemo.delete(metaMemo.keys().next().value);
  return p;
}

// ---------- sources ----------
const streamCache = new Map();
function quality(st) {
  const s = (st.name || '') + ' ' + (st.title || '') + ' ' + (st.description || ''), q = [];
  const bh = st.behaviorHints || {};
  if (bh.videoSize) q.push((bh.videoSize / 1073741824).toFixed(1).replace('.', ',') + ' Go');
  else { const m = /(\d+(?:[.,]\d+)?)\s?(GB|Go|MB|Mo)\b/i.exec(s); if (m) q.push(m[1].replace('.', ',') + ' ' + (/^g/i.test(m[2]) ? 'Go' : 'Mo')); }
  return q;
}
function streamsFor(type, vid) {
  const key = type + '/' + vid;
  let e = streamCache.get(key);
  if (e && Date.now() - e.at < STREAM_TTL && (e.pending || e.list.length)) return e;
  e = { at: Date.now(), list: [], pending: 0, skipped: 0, srcs: [], subs: new Set() };
  addons.forEach((a, ai) => { if (!a.err && supports(a, 'stream', type, vid)) e.srcs.push({ a, ai }); });
  e.pending = e.srcs.length;
  let seq = 0;
  e.srcs.forEach(x => {
    getJSON(x.a.base + '/stream/' + type + '/' + encodeURIComponent(vid) + '.json', STREAM_TTL, 25000).then(d => {
      (d.streams || []).forEach(st => {
        if (st.url && /^https?:/i.test(st.url)) e.list.push({ a: x.a.m.name || hostOf(x.a.url), ai: x.ai, st, n: seq++, q: quality(st) });
        else if (st.ytId) e.list.push({ a: x.a.m.name || hostOf(x.a.url), ai: x.ai, st: Object.assign({}, st, { url: 'https://www.youtube.com/watch?v=' + st.ytId, yt: true }), n: seq++, q: [] });
        else e.skipped++;
      });
    }).catch(() => { x.failed = true; }).then(() => {
      e.pending--;
      e.list.sort((p, q) => (p.ai - q.ai) || (p.n - q.n));
      e.subs.forEach(f => f());
    });
  });
  streamCache.set(key, e);
  if (streamCache.size > 40) streamCache.delete(streamCache.keys().next().value);
  return e;
}
const RX = {
  res: [[/2160p|\b4k\b|\buhd\b/i, '2160p'], [/1080p/i, '1080p'], [/720p/i, '720p'], [/576p|480p|\bsd\b/i, '480p']],
  kind: [[/remux/i, 'REMUX'], [/blu-?ray|bdrip|brrip/i, 'BLURAY'], [/web-?dl/i, 'WEB-DL'], [/web-?rip/i, 'WEBRIP'], [/\bweb\b/i, 'WEB'], [/hdtv/i, 'HDTV'], [/dvd/i, 'DVD'], [/\bcam\b|\bts\b|telesync/i, 'CAM']],
  codec: [[/av1/i, 'AV1'], [/hevc|x265|h\.?265/i, 'HEVC'], [/avc|x264|h\.?264/i, 'H264'], [/xvid/i, 'XviD']],
  audio: [[/truehd/i, 'TrueHD'], [/dts-?hd(\.| )?ma/i, 'DTS-HD MA'], [/dts-?x/i, 'DTS:X'], [/\bdts\b/i, 'DTS'], [/e-?ac-?3|ddp|dd\+|eac3/i, 'EAC3'], [/\bac-?3\b|\bdd\b/i, 'AC3'], [/\baac\b/i, 'AAC'], [/opus/i, 'Opus']]
};
const FLAGS = { '🇫🇷': 'FR', '🇬🇧': 'EN', '🇺🇸': 'EN', '🇪🇸': 'ES', '🇩🇪': 'DE', '🇮🇹': 'IT', '🇯🇵': 'JA', '🇰🇷': 'KO', '🇨🇦': 'VFQ', '🇧🇪': 'BE', '🇵🇹': 'PT', '🇧🇷': 'PT-BR', '🇷🇺': 'RU', '🇨🇳': 'ZH', '🇮🇳': 'HI' };
const first = (list, s) => { const m = list.find(r => r[0].test(s)); return m ? m[1] : ''; };
function parseSrc(x) {
  const st = x.st, bh = st.behaviorHints || {}, desc = String(st.description || st.title || '');
  const lines = desc.split('\n').map(t => t.trim()).filter(Boolean);
  const file = bh.filename || lines.find(l => /\.(mkv|mp4|avi|m4v|webm|ts|mov)$/i.test(l)) || '';
  const all = (st.name || '') + ' ' + desc + ' ' + file;
  const kind = first(RX.kind, all), hdr = /dolby.?vision|\bdv\b|\bdovi\b/i.test(all) ? 'Dolby Vision' : /hdr10\+/i.test(all) ? 'HDR10+' : /hdr/i.test(all) ? 'HDR' : '';
  const ch = (/\b([257])[ .]([01])\b/.exec(all) || [])[0];
  let codec = first(RX.codec, all);
  if (codec === 'HEVC' && /10.?bit/i.test(all)) codec = 'HEVC 10 bits';
  let audio = first(RX.audio, all);
  if (/atmos/i.test(all)) audio = (audio ? audio + ' ' : '') + 'Atmos';
  if (audio && ch) audio += ' ' + ch.replace(' ', '.');
  const langs = [];
  const addL = l => { if (langs.indexOf(l) < 0) langs.push(l); };
  Object.keys(FLAGS).forEach(f => { if (all.indexOf(f) > -1) addL(FLAGS[f]); });
  (all.match(/\b(MULTI|VFF|VFQ|VFI|VF2|VOSTFR|TRUEFRENCH|FRENCH|VF)\b/gi) || []).forEach(l => addL(l.toUpperCase().replace('TRUEFRENCH', 'VFF').replace('FRENCH', 'VF')));
  const group = (/-([A-Za-z0-9]{2,})(?:\.[a-z0-9]{2,4})?$/.exec(file) || [])[1] || '';
  const size = x.q.find(t => / (Go|Mo)$/.test(t)) || '', n = parseFloat(size.replace(',', '.'));
  const ext = ((/\.([a-z0-9]{2,4})$/i.exec(file) || /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(st.url.split('#')[0]) || [])[1] || '').toLowerCase();
  return {
    q: first(RX.res, all) || 'SD', kind, src: [kind === 'BLURAY' ? 'BluRay' : kind === 'REMUX' ? 'BluRay REMUX' : kind, hdr].filter(Boolean).join(' · '),
    codec, audio, langs, group, file, size, gb: !n ? 0 : / Mo$/.test(size) ? n / 1024 : n, ext,
    // Lecteur de l'iPhone : MP4/MOV/HLS en H.264 ou HEVC. MKV, AVI, AV1… partent vers VLC / Infuse.
    native: !st.yt && (['mp4', 'm4v', 'mov', 'm3u8'].indexOf(ext) > -1 || (!ext && !/mkv|avi/i.test(all))) && codec !== 'AV1' && codec !== 'XviD'
  };
}
function srcName(x) { return String(x.st.name || x.a).split('\n').map(s => s.trim()).filter(Boolean).join(' ') || x.a; }

// ---------- sous-titres ----------
const LANGS = {
  fre: 'Français', eng: 'Anglais', spa: 'Espagnol', ger: 'Allemand', ita: 'Italien', por: 'Portugais', pob: 'Portugais (BR)',
  dut: 'Néerlandais', ara: 'Arabe', jpn: 'Japonais', rus: 'Russe', tur: 'Turc', pol: 'Polonais', chi: 'Chinois', kor: 'Coréen'
};
function langKey(l) {
  l = String(l || '').toLowerCase();
  return { fra: 'fre', fr: 'fre', 'fr-fr': 'fre', en: 'eng', 'en-us': 'eng', 'en-gb': 'eng', es: 'spa', de: 'ger', deu: 'ger', it: 'ita', pt: 'por', 'pt-br': 'pob', nl: 'dut', nld: 'dut', ja: 'jpn', ru: 'rus', zh: 'chi', zho: 'chi', ko: 'kor' }[l] || l;
}
const langLabel = l => LANGS[langKey(l)] || (l ? String(l).toUpperCase() : 'Inconnue');
const ISO2 = { fre: 'fr', eng: 'en', spa: 'es', ger: 'de', ita: 'it', por: 'pt', pob: 'pt', dut: 'nl', ara: 'ar', jpn: 'ja', rus: 'ru', tur: 'tr', pol: 'pl', chi: 'zh', kor: 'ko' };
function subtitlesFor(type, vid, st) {
  const own = (st.subtitles || []).filter(s => s.url).map(s => ({ url: s.url, lang: s.lang, src: 'source' }));
  const bh = st.behaviorHints || {}, ex = [];
  if (bh.videoHash) ex.push('videoHash=' + encodeURIComponent(bh.videoHash));
  if (bh.videoSize) ex.push('videoSize=' + encodeURIComponent(bh.videoSize));
  if (bh.filename) ex.push('filename=' + encodeURIComponent(bh.filename));
  const jobs = addons.filter(a => !a.err && supports(a, 'subtitles', type, vid)).map(a => {
    const base = a.base + '/subtitles/' + type + '/' + encodeURIComponent(vid), plain = () => getJSON(base + '.json', 3600e3, 12000);
    return (ex.length ? getJSON(base + '/' + ex.join('&') + '.json', 3600e3, 12000).catch(plain) : plain())
      .then(d => (d.subtitles || []).filter(s => s.url).map(s => ({ url: s.url, lang: s.lang, src: a.m.name })), () => []);
  });
  return Promise.all(jobs).then(r => own.concat.apply(own, r));
}
// SRT → WebVTT, le format que le lecteur de l'iPhone comprend.
function toVtt(txt) {
  txt = txt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(txt)) return txt;
  return 'WEBVTT\n\n' + txt.replace(/^\d+\n(?=\d+:\d+)/gm, '').replace(/(\d+:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2').replace(/\{\\[^}]*\}/g, '');
}

// =====================================================================
// Progression, « Continuer à regarder », Ma liste
// =====================================================================
let POS = store.get('pos', {}), CW = store.get('cw', []), LIB = store.get('lib', []), HIST = store.get('hist', []);
// Profil enfant : l'iPhone suit un profil de la synchro (syncpid). Si ce profil est « enfant » sur la TV ou le Mac, l'iPhone le respecte aussi :
// seulement des titres Animation / Famille, seulement les chaînes jeunesse, et le code parental (kidpin, synchronisé) pour ouvrir les réglages.
const prof = () => store.get('profiles', []).find(p => p.id === store.get('syncpid', null)) || null;
const KID = () => !!(prof() && prof().kid);
const KID_RX = /anim|family|famil|kids|enfant|children|jeunesse/i;
const kidOk = m => rawGenres(m).some(g => KID_RX.test(g));
const kidList = l => (KID() ? (l || []).filter(kidOk) : l);
const savePos = debounce(() => store.set('pos', POS), 800);
const cwGet = id => CW.find(e => e.id === id) || null;
function saveProgress(item, meta, video, t, d) {
  if (!d || !isFinite(d) || t < 5) return;
  const vid = video ? video.id : (meta.id || item.id), done = t / d > 0.92;
  POS[vid] = { t, d, done, at: Date.now() };
  const keys = Object.keys(POS);
  if (keys.length > 3000) keys.sort((a, b) => POS[a].at - POS[b].at).slice(0, keys.length - 3000).forEach(k => { delete POS[k]; });
  savePos();
  // Ce qu'on a regardé (avec ses genres) sert aux recommandations « Pour toi ».
  if (!HIST.length || HIST[0].id !== item.id) {
    HIST = [{ id: item.id, type: item.type, n: item.name || (meta && meta.name) || '', g: rawGenres(meta).slice(0, 4) }].concat(HIST.filter(h => h.id !== item.id)).slice(0, 60);
    store.set('hist', HIST);
  }
  cwPut(item, meta, video, done ? 100 : Math.round(100 * t / d), done);
}
function cwPut(item, meta, video, pct, done) {
  CW = CW.filter(e => e.id !== item.id);
  const e = itemOf(item);
  e.background = meta.background || item.background;
  e.logo = meta.logo || item.logo;
  e.poster = meta.poster || item.poster;
  e.at = Date.now();
  const vid = video ? video.id : (meta.id || item.id);
  if (done) {
    const nx = video && nextVideo(meta, video);
    if (nx) { e.vid = nx.id; e.label = epLabel(nx); e.ept = nx.title || nx.name || ''; e.thumb = nx.thumbnail; e.pct = 0; CW.unshift(e); }
  } else {
    e.vid = vid;
    if (video) { e.label = epLabel(video); e.ept = video.title || video.name || ''; e.thumb = video.thumbnail; }
    e.pct = pct || 0;
    CW.unshift(e);
  }
  CW = CW.slice(0, 20);
  store.set('cw', CW);
  homeDirty = true;
}
const libHas = id => LIB.some(x => x.id === id);
function libToggle(item, meta) {
  const on = !libHas(item.id);
  if (on) LIB.unshift(Object.assign(itemOf(item), { poster: (meta && meta.poster) || item.poster, at: Date.now() }));
  else LIB = LIB.filter(x => x.id !== item.id);
  store.set('lib', LIB);
  Trakt.watchlist(item, on);
  homeDirty = true;
  if (roots.lib) roots.lib.render();
  toast(on ? 'Ajouté à Ma liste' : 'Retiré de Ma liste');
  return on;
}
