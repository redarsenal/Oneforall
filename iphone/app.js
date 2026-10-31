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
(function () {
  'use strict';

  var VERSION = '1.0.1';
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
  const CFG = Object.assign({ player: 'auto', ext: 'vlc', subLang: 'fre', subAuto: false, theme: 'auto', liveQ: 'fhd' }, store.get('cfg', {}));
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
  let POS = store.get('pos', {}), CW = store.get('cw', []), LIB = store.get('lib', []);
  const savePos = debounce(() => store.set('pos', POS), 800);
  const cwGet = id => CW.find(e => e.id === id) || null;
  function saveProgress(item, meta, video, t, d) {
    if (!d || !isFinite(d) || t < 5) return;
    const vid = video ? video.id : (meta.id || item.id), done = t / d > 0.92;
    POS[vid] = { t, d, done, at: Date.now() };
    const keys = Object.keys(POS);
    if (keys.length > 3000) keys.sort((a, b) => POS[a].at - POS[b].at).slice(0, keys.length - 3000).forEach(k => { delete POS[k]; });
    savePos();
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

  // =====================================================================
  // Trakt
  // =====================================================================
  const TAPI = 'https://api.trakt.tv';
  const tr = () => (SETUP && SETUP.trakt) || {};
  const TRAKT_ID = () => String(tr().id || TRAKT_DEFAULT).trim();
  const TRAKT_SECRET = () => String(tr().secret || '').trim();
  const imdbOf = id => (/^tt\d+$/.test(String(id)) ? String(id) : null);
  async function pmap(list, n, fn) {
    const out = new Array(list.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) { const k = i++; try { out[k] = await fn(list[k], k); } catch (e) { out[k] = null; } }
    }));
    return out;
  }
  const Trakt = {
    syncing: false,
    tok: () => store.get('trakt', null),
    connected() { return !!this.tok(); },
    async post(path, body) {
      if (!TRAKT_SECRET()) delete body.client_secret;
      const r = await fetch(TAPI + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let d = null;
      try { d = await r.json(); } catch (e) {}
      return { status: r.status, d };
    },
    async req(method, path, body) {
      let t = this.tok();
      if (t && Date.now() / 1000 > t.created_at + t.expires_in - 3600) t = await this.refresh(t);
      const h = { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': TRAKT_ID() };
      if (t) h.Authorization = 'Bearer ' + t.access_token;
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 20000);
      let r;
      try { r = await fetch(TAPI + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
      catch (e) { throw new Error('Trakt injoignable'); }
      finally { clearTimeout(tm); }
      if (r.status === 401 && t) { store.set('trakt', null); throw new Error('Trakt : il faut se reconnecter (Réglages)'); }
      if (r.status === 204 || r.status === 409) return null;
      if (!r.ok) throw new Error('Trakt : erreur ' + r.status);
      return r.json().catch(() => null);
    },
    async refresh(t) {
      const r = await this.post('/oauth/token', {
        refresh_token: t.refresh_token, client_id: TRAKT_ID(), client_secret: TRAKT_SECRET(), redirect_uri: tr().redirect || 'http://localhost', grant_type: 'refresh_token'
      });
      if (r.status !== 200 || !r.d) { store.set('trakt', null); throw new Error('Trakt : il faut se reconnecter (Réglages)'); }
      store.set('trakt', r.d);
      return r.d;
    },
    disconnect() {
      const t = this.tok();
      store.set('trakt', null); store.set('treco', null); store.set('tsync', 0);
      if (t) this.post('/oauth/revoke', { token: t.access_token, client_id: TRAKT_ID(), client_secret: TRAKT_SECRET() }).catch(() => {});
      homeDirty = true;
    },
    ids(item, video) {
      const id = imdbOf(item.id);
      if (!id) return null;
      if (item.type === 'movie') return { movie: { ids: { imdb: id } } };
      if (!video || video.season == null || video.episode == null) return null;
      return { show: { ids: { imdb: id } }, episode: { season: video.season, number: video.episode } };
    },
    scrobble(action, item, video, pct) {
      if (!this.connected() || !isFinite(pct)) return;
      const b = this.ids(item, video);
      if (!b) return;
      b.progress = Math.round(clamp(pct, 0, 100) * 100) / 100;
      this.req('POST', '/scrobble/' + action, b).catch(() => {});
    },
    watchlist(item, add) {
      if (!this.connected()) return;
      const id = imdbOf(item.id);
      if (!id) return;
      const body = item.type === 'movie' ? { movies: [{ ids: { imdb: id } }] } : { shows: [{ ids: { imdb: id } }] };
      this.req('POST', '/sync/watchlist' + (add ? '' : '/remove'), body).catch(() => {});
    },
    async sync(force) {
      if (!this.connected() || this.syncing) return false;
      if (!force && Date.now() - store.get('tsync', 0) < 10 * 60e3) return false;
      this.syncing = true;
      try {
        const pb = ((await this.req('GET', '/sync/playback?limit=30')) || []).filter(p => (p.type === 'movie' ? p.movie : p.show));
        const add = (await pmap(pb.slice(0, 20), 4, async p => {
          const isM = p.type === 'movie', o = isM ? p.movie : p.show, id = o.ids && o.ids.imdb;
          if (!id) return null;
          const at = Date.parse(p.paused_at) || Date.now(), ex = CW.find(e => e.id === id);
          if (ex && (ex.at || 0) >= at) return null;
          const vid = isM ? id : id + ':' + p.episode.season + ':' + p.episode.number;
          const meta = await metaFor({ type: isM ? 'movie' : 'series', id });
          const e = {
            id, type: isM ? 'movie' : 'series', name: (meta && meta.name) || o.title, poster: meta && meta.poster, background: meta && meta.background,
            logo: meta && meta.logo, releaseInfo: String(o.year || ''), vid, pct: Math.round(p.progress), at
          };
          if (!isM) {
            e.label = epLabel({ season: p.episode.season, episode: p.episode.number });
            e.ept = p.episode.title || '';
            const v = meta && (meta.videos || []).find(x => x.id === vid);
            if (v) e.thumb = v.thumbnail;
          }
          if (!POS[vid] || (!POS[vid].t && !POS[vid].done)) POS[vid] = { t: 0, d: 0, p: p.progress, done: false, at };
          return e;
        })).filter(Boolean);
        if (add.length) {
          CW = add.concat(CW.filter(e => !add.some(a => a.id === e.id))).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 20);
          store.set('cw', CW);
        }
        const wm = (await this.req('GET', '/sync/watched/movies')) || [];
        wm.forEach(w => { const id = w.movie && w.movie.ids.imdb; if (id && !(POS[id] && POS[id].done)) POS[id] = { t: 0, d: 0, done: true, at: Date.parse(w.last_watched_at) || 0 }; });
        const ws = (await this.req('GET', '/sync/watched/shows')) || [];
        ws.forEach(w => {
          const id = w.show && w.show.ids.imdb;
          if (!id) return;
          (w.seasons || []).forEach(s => (s.episodes || []).forEach(ep => {
            const k = id + ':' + s.number + ':' + ep.number;
            if (!(POS[k] && POS[k].done)) POS[k] = { t: 0, d: 0, done: true, at: Date.parse(ep.last_watched_at) || 0 };
          }));
        });
        savePos();
        const wl = ((await this.req('GET', '/sync/watchlist?limit=80')) || []).filter(w => (w.type === 'movie' || w.type === 'show') && w[w.type].ids.imdb && !libHas(w[w.type].ids.imdb));
        const newLib = (await pmap(wl.slice(0, 60), 4, async w => {
          const o = w[w.type], type = w.type === 'movie' ? 'movie' : 'series', meta = await metaFor({ type, id: o.ids.imdb });
          return { id: o.ids.imdb, type, name: (meta && meta.name) || o.title, poster: meta && meta.poster, background: meta && meta.background, releaseInfo: String(o.year || '') };
        })).filter(Boolean);
        if (newLib.length) { LIB = LIB.concat(newLib); store.set('lib', LIB); }
        const rec = { movie: [], series: [] };
        for (const k of ['movie', 'series']) {
          const l = (await this.req('GET', '/recommendations/' + (k === 'movie' ? 'movies' : 'shows') + '?limit=12&ignore_collected=true')) || [];
          const ms = await pmap(l.filter(o => o.ids && o.ids.imdb), 4, o => metaFor({ type: k, id: o.ids.imdb }));
          ms.forEach(m => { if (m && m.poster) rec[k].push(slim(m, '', k)); });
        }
        store.set('treco', rec);
        store.set('tsync', Date.now());
        homeDirty = true;
        refreshVisible();
        return true;
      } catch (e) { toast(e.message, true); return false; }
      finally { this.syncing = false; }
    }
  };

  // =====================================================================
  // IPTV (Xtream) : chaînes françaises, ordre Canal+, favoris en premier (comme la TV 4.4.1)
  // =====================================================================
  const XT = () => (SETUP && SETUP.iptv && SETUP.iptv.username ? SETUP.iptv : null);
  const XT_SERVERS = () => { const x = XT(); return x ? [].concat(x.servers || x.server || []).map(s => String(s).replace(/\/?$/, '/')) : []; };
  const LIVE = Object.assign({ ch: [], at: 0, srv: 0 }, store.get('live', {}), { loading: false, err: '' });
  const CANAL = [
    [1, 'TF1', 'TF1'], [2, 'France 2', 'FRANCE2'], [3, 'France 3', 'FRANCE3'], [4, 'CANAL+', 'CANAL+'], [5, 'France 5', 'FRANCE5'],
    [6, 'M6', 'M6'], [7, 'Arte', 'ARTE'], [10, 'CANAL+ Sport 360', 'CANAL+360', 'CANAL+SPORT360'], [11, 'CANAL+ Foot', 'CANAL+FOOT'],
    [12, 'CANAL+ Sport', 'CANAL+SPORT'], [13, 'CANAL+ Box Office', 'CANAL+BOXOFFICE'], [14, 'CANAL+ Grand Écran', 'CANAL+GRANDECRAN'],
    [15, 'CANAL+ Cinéma(s)', 'CANAL+CINEMA', 'CANAL+CINEMAS'], [17, 'CANAL+ Docs', 'CANAL+DOCS'], [18, 'CANAL+ Kids', 'CANAL+KIDS'],
    [29, 'CANAL+ Événement', 'CANAL+EVENEMENT'], [33, 'OCS', 'CINE+OCS', 'OCS'], [34, 'Ciné+ Frisson', 'CINE+FRISSON'],
    [35, 'Ciné+ Émotion', 'CINE+EMOTION'], [36, 'Ciné+ Family', 'CINE+FAMILY', 'CINE+FAMIZ'],
    [37, 'Ciné+ Festival', 'CINE+FESTIVAL', 'CINE+PREMIER'], [38, 'Ciné+ Classic', 'CINE+CLASSIC'], [44, 'Action', 'ACTION'],
    [45, 'TCM Cinéma', 'TCMCINEMA'], [51, 'Polar+', 'POLAR+'], [52, 'Série Club', 'SERIECLUB'], [53, 'Warner TV', 'WARNERTV'],
    [55, 'RTL9', 'RTL9'], [56, 'AB1', 'AB1'], [57, 'Novelas+', 'NOVELAS+', 'NOVELASTV'], [59, 'TF1 Séries Films', 'TF1SERIESFILMS', 'TF1SERIESFILM'],
    [63, 'Infosport+', 'INFOSPORT+'], [66, 'beIN Sports 1', 'BEINSPORTS1'], [67, 'beIN Sports 2', 'BEINSPORTS2'], [68, 'beIN Sports 3', 'BEINSPORTS3'],
    [69, 'Eurosport 1', 'EUROSPORT1'], [70, 'Eurosport 2', 'EUROSPORT2'], [72, 'Golf+', 'GOLF+'], [73, 'Automoto', 'AUTOMOTO', 'AUTOMOTOLACHAINE'],
    [74, 'Cheval TV', 'CHEVALTV'], [75, 'Equidia', 'EQUIDIA', 'EQUIDIALIVE'], [76, 'Sport en France', 'SPORTENFRANCE'], [79, 'L’Équipe', 'LEQUIPE'],
    [80, 'Comédie+', 'COMEDIE+'], [83, 'Paris Première', 'PARISPREMIERE'], [84, 'Téva', 'TEVA'], [86, 'TLC', 'TLC'], [89, 'W9', 'W9'],
    [90, 'TMC', 'TMC'], [91, 'TFX', 'TFX'], [92, 'CStar', 'CSTAR'], [93, 'T18', 'T18'], [94, 'NOVO19', 'NOVO19'], [95, '6ter', '6TER'],
    [96, 'RMC Story', 'RMCSTORY'], [97, 'RMC Life', 'RMCLIFE'], [98, 'TV5 Monde', 'TV5MONDE'], [111, 'Planète+', 'PLANETE+'],
    [112, 'Planète+ Crime', 'PLANETE+CRIME', 'PLANETE+CI'], [113, 'Planète+ Aventure', 'PLANETE+AVENTURE', 'PLANETE+AE'],
    [114, 'Museum TV', 'MUSEUMTV', 'MUSEUM'], [118, 'Toute l’Histoire', 'TOUTELHISTOIRE'], [119, 'Discovery Channel', 'DISCOVERYCHANNEL'],
    [120, 'Discovery Investigation', 'DISCOVERYID'], [121, 'Dog & Cat TV', 'DOGCATTV'], [122, 'Seasons', 'SEASONS'],
    [123, 'Chasse et Pêche', 'CHASSEETPECHE'], [124, 'Animaux', 'ANIMAUX'], [125, 'TV Monaco', 'TVMONACO'], [126, 'Le Figaro TV', 'LEFIGAROTV'],
    [127, '8 Mont-Blanc', 'TV8MONTBLANC', '8MONTBLANC'], [129, 'RMC Découverte', 'RMCDECOUVERTE'], [131, 'Piwi+', 'PIWI+'],
    [133, 'Nickelodeon Junior', 'NICKELODEONJUNIOR'], [134, 'Tiji', 'TIJI'], [135, 'Cartoonito', 'CARTOONITO'], [136, 'Boomerang', 'BOOMERANG'],
    [137, 'Télétoon+', 'TELETOON+'], [138, 'Télétoon+1', 'TELETOON+1'], [141, 'Cartoon Network', 'CARTOONNETWORK'], [142, 'Nickelodeon', 'NICKELODEON'],
    [143, 'Nickelodeon +1', 'NICKELODEON+1'], [144, 'Canal J', 'CANALJ'], [147, 'France 4', 'FRANCE4'], [148, 'Gulli', 'GULLI'],
    [152, 'MTV', 'MTV', 'MTVFRANCE'], [154, 'Comedy Central', 'COMEDYCENTRAL'], [156, 'Mangas', 'MANGAS'], [158, 'MGG TV', 'MGGTV'],
    [159, 'Warner TV Next', 'WARNERTVNEXT'], [160, 'La Chaîne Météo', 'LACHAINEMETEO'], [161, 'CNews', 'CNEWS'], [162, 'BFM TV', 'BFMTV'],
    [163, 'LCI', 'LCI'], [164, 'franceinfo', 'FRANCEINFO'], [165, 'LCP', 'LCP', 'LCP100'], [168, 'France 24', 'FRANCE24'],
    [169, 'Euronews', 'EURONEWS', 'EURONEWSFRENCH'], [171, 'CNN', 'CNN'], [172, 'BFM Business', 'BFMBUSINESS'], [175, 'i24 News', 'I24NEWS'],
    [176, 'KTO', 'KTO'], [180, 'Europe 2 Pop TV', 'EUROPE2POPTV'], [181, 'M6 Music', 'M6MUSIC'], [183, 'NRJ Hits', 'NRJHITS'],
    [184, 'Trace Urban', 'TRACEURBAN'], [186, 'RFM TV', 'RFMTV'], [188, 'Melody', 'MELODY'], [200, 'Mezzo', 'MEZZO'], [201, 'Mezzo Live', 'MEZZOLIVE']
  ];
  for (let i = 1; i <= 19; i++) CANAL.push([230 + i, 'CANAL+ Live ' + i, 'CANAL+LIVE' + i]);
  CANAL.push([250, 'CANAL+ Premier League', 'CANAL+PREMIERLEAGUE', 'CANAL+PREMIERELEAGUE']);
  for (let i = 1; i <= 32; i++) CANAL.push([251 + i, 'Eurosport 360 ' + i, 'EUROSPORT360' + i]);
  for (let i = 4; i <= 10; i++) CANAL.push([280 + i, 'beIN Sports Max ' + i, 'BEINSPORTSMAX' + i]);
  CANAL.push([350, '', /^(F3|FRANCE3[A-Z])/], [378, 'A+', 'A+'], [381, 'Nollywood TV', 'NOLLYWOOD', 'NOLLYWOODTV'], [382, 'Nollywood TV Epic', 'NOLLYWOODEPIC']);
  const CANAL_KEY = {};
  CANAL.forEach((c, i) => c.slice(2).forEach(k => { if (typeof k === 'string' && !CANAL_KEY[k]) CANAL_KEY[k] = i; }));
  const CANAL_RX = CANAL.map((c, i) => [c[2], i]).filter(x => x[0] instanceof RegExp);
  const LIVE_CATS = [['gen', /FRANCE GENERALE$/], ['info', /FRANCE INFORMATION$/], ['sport', /FRANCE SPORTS$/], ['cine', /FRANCE CINEMA$/],
    ['div', /FRANCE DIVERTISSEMENT$/], ['docu', /FRANCE DOCUMENTARY$/], ['kids', /FRANCE ENFANTS$/], ['music', /FRANCE MUSIC$/],
    ['domtom', /FRANCE DOM TOM/], ['event', /^EU \| FRANCE|^VIP \| (UFC|F1)/]];
  const LIVE_TILES = [['gen', 'Généralistes', ['gen', 'domtom']], ['info', 'Info', ['info']], ['sport', 'Sport', ['sport', 'event']],
    ['cine', 'Cinéma', ['cine']], ['div', 'Divertissement', ['div']], ['docu', 'Documentaires', ['docu']], ['kids', 'Jeunesse', ['kids']],
    ['music', 'Musique', ['music']], ['event', 'Événements', ['event']]];
  const LIVE_BASE = ['gen', 'info', 'sport', 'cine', 'div', 'docu', 'kids', 'music'];
  const DOM_REG = { CAR: 'Caraïbes', REU: 'Réunion' };
  const LIVE_Q = {
    fhd: ['FHD', 'HD', '', 'HEVC', 'UHD', 'SD'], hevc: ['HEVC', 'FHD', 'HD', '', 'UHD', 'SD'],
    uhd: ['UHD', 'FHD', 'HEVC', 'HD', '', 'SD'], hd: ['HD', 'FHD', '', 'HEVC', 'SD', 'UHD']
  };
  const LIVE_QL = { fhd: 'Full HD (conseillé)', hevc: 'HEVC (moins de débit)', uhd: '4K quand elle existe', hd: 'HD (réseau mobile)' };
  const chKey = s => String(s || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9+]/g, '');
  const CH_LOW = /^(de|du|des|la|le|les|et|and|of|the|sur|en|au|aux|d'.*|l'.*)$/, CH_CAP = /^(sud|via|top|wow|one|men's|max|ile|art|gong)$/;
  const chTitle = s => /[a-z]/.test(s) ? s : s.toLowerCase().split(/\s+/).map((w, i) => {
    if (i && CH_LOW.test(w)) return w.replace(/^([dl]')(.)/, (m, a, b) => a + b.toUpperCase());
    if (/\d/.test(w) || (w.length <= 3 && !CH_CAP.test(w) && !CH_LOW.test(w))) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
  function liveApi(srv, action) {
    const x = XT();
    return srv + 'player_api.php?username=' + encodeURIComponent(x.username) + '&password=' + encodeURIComponent(x.password) + (action ? '&action=' + action : '');
  }
  const liveSrv = () => { const l = XT_SERVERS(); return l[LIVE.srv % l.length]; };
  function liveUrl(sid, ext) { const x = XT(); return liveSrv() + 'live/' + encodeURIComponent(x.username) + '/' + encodeURIComponent(x.password) + '/' + sid + '.' + ext; }
  function buildChannels(cats, streams) {
    const catOf = {};
    (cats || []).forEach(c => {
      const n = String(c.category_name || '').replace(/\s+/g, ' ').trim().toUpperCase();
      const lc = LIVE_CATS.find(x => x[1].test(n));
      if (lc) catOf[c.category_id] = { name: n, c: lc[0], rank: /^VIP/.test(n) ? 2 : lc[0] === 'domtom' ? 1 : 0 };
    });
    const groups = {}, order = [];
    (streams || []).forEach((s, pos) => {
      const cat = catOf[s.category_id], raw = String(s.name || '');
      const pre = /^\s*(FR|FR-CAR|FR-REU|PPV)\s*\|\s*/i.exec(raw);
      if (!cat || !pre) return;
      const reg = DOM_REG[pre[1].toUpperCase().slice(3)] || '';
      let n = raw.slice(pre[0].length).replace(/\(noepg\)/ig, ''), ev = '', bk = false, q = '';
      n = n.replace(/\[([^\]]*)\]/g, (m, x) => {
        x = x.trim();
        if (/^BK\d*$/i.test(x)) bk = true;
        else if (/^[A-Z]{2,4}$/.test(x)) return ' ' + x + ' ';
        else if (!/EVENT ONLY/i.test(x)) ev = x.replace(/\s*\((\d{4})-(\d\d)-(\d\d) (\d\d:\d\d):\d\d\)\s*$/, ' · $3/$2 $4');
        return ' ';
      }).replace(/-?\s*\(EVENT ONLY\)/ig, ' ').replace(/\s+/g, ' ').trim();
      n = n.replace(/\s+(UHD|4K|FHD|HD|HEVC|SD)$/i, (m, x) => { q = x.toUpperCase() === '4K' ? 'UHD' : x.toUpperCase(); return ''; }).trim();
      if (!n) return;
      const k = chKey(n), id = (LIVE_BASE.indexOf(cat.c) > -1 ? cat.c : chKey(cat.name.replace(/^(EU \| FRANCE|VIP \|)/, ''))) + ':' + (reg ? chKey(reg) : '') + k;
      let g = groups[id];
      if (!g) { g = groups[id] = { id, k: reg ? '' : k, n, reg, c: cat.c, logo: '', ep: 0, ev: '', v: [], pos: cat.rank * 1e6 + pos }; order.push(g); }
      g.v.push([s.stream_id, q, bk ? 1 : 0]);
      if (!g.logo && s.stream_icon) g.logo = String(s.stream_icon);
      if (!g.ep && s.epg_channel_id) g.ep = s.stream_id;
      if (ev && !g.ev) g.ev = ev;
    });
    order.forEach(g => {
      let ci = g.k ? CANAL_KEY[g.k] : null;
      if (ci == null && g.k) { const r = CANAL_RX.find(x => x[0].test(g.k)); if (r) ci = r[1]; }
      g.ci = ci == null ? 1e6 : ci;
      g.name = ci != null && CANAL[ci][1] ? CANAL[ci][1] : chTitle(g.n) + (g.reg ? ' · ' + g.reg : '');
    });
    const seen = {};
    const list = order.filter(g => {
      if (g.ci === 1e6 || CANAL[g.ci][2] instanceof RegExp) return true;
      if (seen[g.ci]) { seen[g.ci].v = seen[g.ci].v.concat(g.v); return false; }
      seen[g.ci] = g;
      return true;
    }).sort((a, b) => a.ci - b.ci || a.pos - b.pos);
    let last = 0;
    return list.map(g => {
      const num = Math.max(g.ci === 1e6 ? 0 : CANAL[g.ci][0], last + 1);
      last = num;
      return { id: g.id, name: g.name, num, c: g.c, logo: g.logo, ep: g.ep, ev: g.ev, v: g.v };
    });
  }
  function liveSave(ch, at) {
    Object.assign(LIVE, { ch, at });
    store.set('live', { ch: LIVE.ch, at: LIVE.at, srv: LIVE.srv });
    homeDirty = true;
    if (roots.live) roots.live.render();
  }
  // En ligne seulement si l'app est servie en http (Wi-Fi de la maison) : le fournisseur n'a pas de https,
  // et une page https n'a pas le droit de l'appeler. Sinon, la liste vient du code de configuration du Mac.
  async function liveLoad(force) {
    if (!XT() || LIVE.loading || HTTPS) return;
    if (!force && LIVE.ch.length && Date.now() - LIVE.at < 12 * 3600e3) return;
    LIVE.loading = true; LIVE.err = '';
    const servers = XT_SERVERS();
    try {
      let res = null, err = null;
      for (let i = 0; i < servers.length && !res; i++) {
        const k = (LIVE.srv + i) % servers.length, s = servers[k];
        try {
          const info = await request(liveApi(s, ''), 20000);
          if (!info.user_info || +info.user_info.auth !== 1) throw new Error('identifiants IPTV refusés');
          const cats = await request(liveApi(s, 'get_live_categories'), 30000);
          const streams = await request(liveApi(s, 'get_live_streams'), 120000);
          res = { k, ch: buildChannels(cats, streams) };
        } catch (e) { err = e; }
      }
      if (!res) throw err || new Error('injoignable');
      LIVE.srv = res.k;
      liveSave(res.ch, Date.now());
      if (force) toast(plural(LIVE.ch.length, 'chaîne') + ' française' + (LIVE.ch.length > 1 ? 's' : ''));
    } catch (e) {
      LIVE.err = e.message;
      if (force) toast('IPTV : ' + e.message, true);
    } finally { LIVE.loading = false; }
  }
  function favIds() { const f = store.get('livefav', null); return f || LIVE.ch.slice(0, 8).map(c => c.id); }
  const isFav = ch => favIds().indexOf(ch.id) > -1;
  function liveFavs() { const f = favIds(); return LIVE.ch.filter(c => f.indexOf(c.id) > -1); }
  function toggleFav(ch) {
    const f = favIds(), on = f.indexOf(ch.id) < 0;
    store.set('livefav', on ? f.concat([ch.id]) : f.filter(x => x !== ch.id));
    toast(on ? '« ' + ch.name + ' » ajoutée aux favoris' : '« ' + ch.name + ' » retirée des favoris');
    homeDirty = true;
    return on;
  }
  function liveVariants(ch) {
    const pref = LIVE_Q[CFG.liveQ] || LIVE_Q.fhd, r = q => { const i = pref.indexOf(q); return i < 0 ? 9 : i; };
    return ch.v.slice().sort((a, b) => r(a[1]) - r(b[1]) || a[2] - b[2]);
  }
  // Programme en cours (http seulement, même raison que la liste).
  const EPG = {};
  function b64(s) { try { return decodeURIComponent(escape(atob(s || ''))); } catch (e) { try { return atob(s || ''); } catch (e2) { return String(s || ''); } } }
  function epgOf(ch) {
    const e = ch && ch.ep && EPG[ch.ep];
    if (!e || !e.list) return null;
    const now = Date.now() / 1000, p = e.list.find(x => x.s <= now && x.e > now);
    return p ? { t: p.t, s: p.s, e: p.e, pct: Math.round(100 * (now - p.s) / Math.max(1, p.e - p.s)) } : null;
  }
  function epgWant(ch, done) {
    if (HTTPS || !ch || !ch.ep || EPG[ch.ep]) return;
    EPG[ch.ep] = { list: null };
    request(liveApi(liveSrv(), 'get_short_epg&limit=4&stream_id=' + ch.ep), 15000).then(d => {
      EPG[ch.ep].list = ((d && d.epg_listings) || []).map(p => ({ t: b64(p.title), s: +p.start_timestamp, e: +p.stop_timestamp })).filter(p => p.s && p.e);
      if (done) done();
    }, () => {});
  }
  const hm = s => clock(new Date(s * 1000));
  const LV_GEN = [['#F2E14C', '#7FD6E8', '#6B4FA0', '#1C1530'], ['#E8E4DA', '#C8341F', '#3A3F52', '#12141C'], ['#7FD6E8', '#F2E14C', '#3A2F52', '#0E0C18'],
    ['#F4EEE2', '#4F6F8F', '#9FB4C8', '#1E2A36'], ['#E2A04A', '#2A3440', '#6E5A44', '#0E1116'], ['#D9D4C7', '#6E7355', '#9AA07A', '#22261A'],
    ['#F0D9B5', '#8F5A2B', '#C98A4B', '#3A2210'], ['#8C918E', '#121416', '#3A3F3C', '#050606']];
  function lvArt(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const c = LV_GEN[h % LV_GEN.length];
    return 'radial-gradient(120% 90% at 78% 22%,' + c[0] + ' 0%,rgba(0,0,0,0) 55%),radial-gradient(90% 80% at 18% 88%,' + c[1] + ' 0%,rgba(0,0,0,0) 60%),linear-gradient(150deg,' + c[2] + ' 0%,' + c[3] + ' 100%)';
  }

  // =====================================================================
  // Code de configuration (préparé sur le Mac par iphone/build.sh)
  // =====================================================================
  async function importCode(txt) {
    const m = /OFA1[:.]([A-Za-z0-9_\-]+)/.exec(String(txt || ''));
    if (!m) throw new Error('Ce n’est pas un code OneforAll (il commence par OFA1:).');
    if (!window.DecompressionStream) throw new Error('Mets l’iPhone à jour (iOS 16.4 ou plus récent).');
    const s = m[1].replace(/-/g, '+').replace(/_/g, '/'), bin = atob(s + '==='.slice((s.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    let d;
    try {
      const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      d = JSON.parse(await new Response(out).text());
    } catch (e) { throw new Error('Code incomplet : recopie-le en entier.'); }
    SETUP = store.set('setup', { trakt: d.trakt || null, iptv: d.iptv || null, at: d.at || Date.now() });
    if (d.addons && d.addons.length) setAddons(d.addons.map(normUrl));
    if (d.live && d.live.streams) liveSave(buildChannels(d.live.cats, d.live.streams), d.live.at || Date.now());
    streamCache.clear(); metaMemo.clear();
    await refreshManifests(true).catch(() => {});
    homeDirty = true;
    Object.keys(roots).forEach(k => { if (roots[k].render) roots[k].render(); });
    return { addons: addons.length, ch: LIVE.ch.length };
  }

  // =====================================================================
  // Icônes
  // =====================================================================
  const svgi = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  const IC = {
    home: svgi('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
    search: svgi('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    live: svgi('<rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M8.5 21.5h7M8.5 2.5L12 6l3.5-3.5"/>'),
    lib: svgi('<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>'),
    gear: svgi('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8c.6-.4.6-1.4 0-1.8L9.6 4.3C8.9 3.9 8 4.4 8 5.2z" fill="currentColor"/></svg>',
    plus: svgi('<path d="M12 5.5v13M5.5 12h13"/>'),
    check: svgi('<path d="M5.5 12.5l4.2 4.2L18.5 8"/>'),
    back: svgi('<path d="M15 5l-7 7 7 7"/>'),
    x: svgi('<path d="M7 7l10 10M17 7L7 17"/>'),
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
    trailer: svgi('<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M10.5 9.8v4.4l3.8-2.2z" fill="currentColor"/>'),
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>',
    staro: svgi('<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>'),
    up: svgi('<path d="M6 15l6-6 6 6"/>'),
    down: svgi('<path d="M6 9l6 6 6-6"/>'),
    trash: svgi('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>'),
    refresh: svgi('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>'),
    chev: svgi('<path d="M9 6l6 6-6 6"/>'),
    ext: svgi('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    paste: svgi('<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5V3h5v1.5M9.5 10h5M9.5 14h5"/>')
  };
  const LOGO = '<svg class="lg" viewBox="0 0 30 30"><path d="M6 4.6 Q6 2.6 7.8 3.6 L25.4 13.4 Q27.4 15 25.4 16.6 L7.8 26.4 Q6 27.4 6 25.4 Z" fill="currentColor"/></svg>';

  // =====================================================================
  // Interface : onglets, pile d'écrans, feuilles, toasts
  // =====================================================================
  const APP = $('#app'), TABBAR = $('#tabbar'), SHEET = $('#sheet'), TOAST = $('#toast');
  const roots = {}, stack = [];
  let tab = 'home', homeDirty = false;
  let toastT = 0;
  function toast(msg, err) {
    TOAST.textContent = msg;
    TOAST.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { TOAST.className = ''; }, 3200);
  }
  const TABS = [['home', 'Accueil', IC.home], ['search', 'Recherche', IC.search], ['live', 'Direct', IC.live], ['lib', 'Ma liste', IC.lib], ['set', 'Réglages', IC.gear]];
  function drawTabbar() {
    TABBAR.innerHTML = TABS.map(t => '<button data-tab="' + t[0] + '" class="' + (t[0] === tab ? 'on' : '') + '"><i>' + t[2] + '</i><span>' + t[1] + '</span></button>').join('');
  }
  function makeEl(S, cls) {
    const el = document.createElement('section');
    el.className = 'scr ' + cls;
    el._S = S;
    S.el = el;
    APP.appendChild(el);
    return el;
  }
  function showTab(t) {
    if (t === tab && !stack.length && roots[t]) { const r = roots[t]; r.el.scrollTo({ top: 0, behavior: 'smooth' }); if (r.focus) r.focus(); return; }
    while (stack.length) pop(true);
    tab = t;
    if (!roots[t]) { const S = ROOTS[t](); roots[t] = S; makeEl(S, 'root ' + S.cls); S.build(); }
    Object.keys(roots).forEach(k => roots[k].el.classList.toggle('hid', k !== t));
    const S = roots[t];
    if (S.show) S.show();
    drawTabbar();
    document.body.classList.remove('full');
  }
  function push(S) {
    makeEl(S, 'push ' + S.cls);
    S.build();
    stack.push(S);
    document.body.classList.toggle('full', !!S.full);
    requestAnimationFrame(() => requestAnimationFrame(() => S.el.classList.add('in')));
  }
  function pop(instant) {
    const S = stack.pop();
    if (!S) return;
    const el = S.el;
    if (S.destroy) S.destroy();
    el.classList.remove('in');
    el.style.transform = '';
    if (instant) el.remove(); else setTimeout(() => el.remove(), 340);
    const top = stack[stack.length - 1] || roots[tab];
    document.body.classList.toggle('full', !!(top && top.full));
    if (top && top.show) top.show();
  }
  function back() { if (SHEET.classList.contains('on')) return closeSheet(); if (stack.length) pop(); }
  const curScreen = () => stack[stack.length - 1] || roots[tab];
  function refreshVisible() {
    const S = curScreen();
    if (S && S.show) S.show();
  }

  // Feuille d'actions (en bas, comme iOS).
  let sheetDone = null;
  function sheet(o) {
    const items = o.items || [];
    SHEET.innerHTML = '<div class="shbg" data-close="1"></div><div class="shp">' + (o.title ? '<div class="sht"><b>' + esc(o.title) + '</b>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '') + '</div>' : '') +
      (o.html || '') + (items.length ? '<div class="shl">' + items.map((it, i) => '<button class="shi' + (it.on ? ' on' : '') + (it.cls ? ' ' + it.cls : '') + '" data-i="' + i + '"><span>' + esc(it.l) +
        (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span>' + (it.on ? '<i>' + IC.check + '</i>' : '') + '</button>').join('') + '</div>' : '') +
      '<button class="shc" data-close="1">' + (o.cancel || 'Annuler') + '</button></div>';
    SHEET.className = 'on';
    sheetDone = i => { const it = items[i]; closeSheet(); if (it && it.f) it.f(); };
    if (o.mount) o.mount(SHEET.querySelector('.shp'));
  }
  function closeSheet() { SHEET.className = ''; sheetDone = null; setTimeout(() => { if (!SHEET.className) SHEET.innerHTML = ''; }, 300); }
  SHEET.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeSheet();
    const b = e.target.closest('[data-i]');
    if (b && sheetDone) sheetDone(+b.dataset.i);
  });
  function choose(title, opts, cur, f, sub) {
    sheet({ title, sub, items: opts.map(o => ({ l: o[1], sub: o[2], on: o[0] === cur, f: () => f(o[0]) })) });
  }

  // Un seul gestionnaire de touches pour toute l'app : data-a="action" sur l'élément, l'écran le traite.
  APP.addEventListener('click', e => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const scr = a.closest('.scr'), S = scr && scr._S;
    if (a.dataset.a === 'back') return back();
    if (a.dataset.a === 'open') return openItem(REG.get(a.dataset.k));
    if (S && S.act) S.act(a.dataset.a, a, e);
  });
  TABBAR.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

  // Balayage depuis le bord gauche : retour, comme dans les apps iOS.
  (function swipeBack() {
    let sx = 0, sy = 0, el = null, dx = 0, on = false;
    document.addEventListener('touchstart', e => {
      const t = e.touches[0], S = stack[stack.length - 1];
      if (!S || S.noSwipe || t.clientX > 24 || SHEET.className) return;
      sx = t.clientX; sy = t.clientY; el = S.el; dx = 0; on = false;
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!el) return;
      const t = e.touches[0];
      dx = t.clientX - sx;
      if (!on && Math.abs(t.clientY - sy) > Math.abs(dx)) { el = null; return; }
      if (dx > 8) { on = true; el.style.transition = 'none'; el.style.transform = 'translate3d(' + Math.max(0, dx) + 'px,0,0)'; }
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (!el) return;
      const e2 = el; el = null;
      e2.style.transition = '';
      if (on && dx > 90) pop(); else e2.style.transform = '';
    });
  })();

  // ---------- cartes ----------
  const REG = new Map();
  function reg(m) {
    const k = m.type + '/' + m.id, o = REG.get(k);
    if (!o || (!o.poster && m.poster)) REG.set(k, m);
    return k;
  }
  function posterCard(m, extra) {
    const L = loc(m), done = POS[m.id] && POS[m.id].done;
    return '<div class="po" data-a="open" data-k="' + esc(reg(m)) + '"><div class="pi">' + (m.poster ? '<img loading="lazy" decoding="async" src="' + esc(img(m.poster, 342)) + '" alt="">' : '') +
      '<span class="pn">' + esc(L.name || '') + '</span>' + (done ? '<span class="pdone">' + IC.check + '</span>' : '') + '</div>' +
      '<div class="pt">' + esc(L.name || '') + '</div><div class="ps">' + esc(extra != null ? extra : [year(m), kindLabel(m.type)].filter(Boolean).join(' · ')) + '</div></div>';
  }
  function cwCard(e) {
    const L = loc(e), still = e.thumb || e.background || e.poster;
    return '<div class="cw" data-a="cw" data-id="' + esc(e.id) + '"><div class="cwi">' + (still ? '<img loading="lazy" decoding="async" src="' + esc(img(still, 500)) + '" alt="">' : '') +
      '<span class="cwp">' + IC.play + '</span><i class="bar"><u style="width:' + clamp(e.pct || 0, 2, 100) + '%"></u></i></div>' +
      '<div class="pt">' + esc(L.name) + '</div><div class="ps">' + esc(e.label ? e.label + (e.ept ? ' · ' + e.ept : '') : (e.pct ? 'Reste ' + (100 - e.pct) + ' %' : year(e))) + '</div></div>';
  }
  function liveMini(ch) {
    return '<div class="lvm" data-a="live" data-id="' + esc(ch.id) + '"><div class="lvt" style="background:' + lvArt(ch.id) + '">' +
      (ch.logo ? '<img loading="lazy" src="' + esc(img(ch.logo)) + '" alt="" onerror="this.remove()">' : '') + '<b>' + pad(ch.num) + '</b></div><div class="pt">' + esc(ch.name) + '</div></div>';
  }
  function row(title, inner, cls, sub) {
    return '<section class="row' + (cls ? ' ' + cls : '') + '"><h2>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h2><div class="rs">' + inner + '</div></section>';
  }
  function skel(n, cls) { let h = ''; for (let i = 0; i < n; i++) h += '<div class="' + (cls || 'po') + ' sk"><div class="' + (cls === 'cw' ? 'cwi' : 'pi') + '"></div><div class="pt"></div></div>'; return h; }
  function metaDots(m, extra) {
    const parts = [], y = year(m);
    if (y) parts.push(y);
    genreList(m).slice(0, 3).forEach(g => parts.push(g));
    (extra || []).forEach(x => { if (x) parts.push(x); });
    return parts.map(esc).join('<span class="sep">·</span>');
  }

  function openItem(m) { if (m) push(Details(m)); }
  function resumeCw(id) {
    const e = cwGet(id);
    if (!e) return;
    const item = e;
    metaFor(item).then(meta => {
      meta = meta || item;
      const v = item.type === 'series' ? (meta.videos || []).find(x => x.id === e.vid) : null;
      if (item.type === 'series' && !v) return openItem(item);
      push(Sources(item, meta, v));
    });
  }

  // =====================================================================
  // Écran : Accueil
  // =====================================================================
  const homeCache = store.get('home', {});
  const saveHome = debounce(() => store.set('home', homeCache), 1500);
  function cachedCatalog(j) {
    const key = j.a.base + '|' + j.cat.type + '|' + j.cat.id, c = homeCache[key];
    const fresh = c && Date.now() - c.at < HOME_TTL;
    const p = fresh ? Promise.resolve(c.items) : fetchCatalog(j, '', 60e3).then(items => {
      homeCache[key] = { at: Date.now(), items: items.slice(0, 24) };
      const ks = Object.keys(homeCache);
      if (ks.length > 60) ks.sort((a, b) => homeCache[a].at - homeCache[b].at).slice(0, ks.length - 60).forEach(k => { delete homeCache[k]; });
      saveHome();
      return items;
    });
    return { now: c ? c.items : null, p };
  }
  function trending() {
    const out = [];
    ['movie', 'series'].forEach(t => {
      const all = catalogs(c => c.type === t && !needsExtra(c));
      const j = all.find(x => isCinemeta(x.a) && x.cat.id === 'top') || all.find(x => isCinemeta(x.a)) || all[0];
      if (j) out.push(j);
    });
    return out;
  }
  function Home() {
    const S = { cls: 'home', kind: store.get('homeKind', 'all'), heroItems: [] };
    S.build = function () {
      S.el.innerHTML = '<header class="hd"><div class="brand">' + LOGO + '<b>OneforAll</b></div><button class="ib" data-a="refresh">' + IC.refresh + '</button></header>' +
        '<div class="seg" role="tablist">' + [['all', 'Tout'], ['movie', 'Films'], ['series', 'Séries']].map(k => '<button data-a="kind" data-k="' + k[0] + '" class="' + (S.kind === k[0] ? 'on' : '') + '">' + k[1] + '</button>').join('') + '</div>' +
        '<div class="hero"></div><div class="rows"></div><div class="foot">OneforAll iPhone ' + VERSION + ' · ' + plural(addons.filter(a => !a.err).length, 'addon') + '</div>';
      S.render();
    };
    S.show = function () { if (homeDirty) S.render(); };
    S.render = function () {
      homeDirty = false;
      S.el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.k === S.kind));
      const k = S.kind, ok = m => k === 'all' || m.type === k;
      let h = '';
      const cw = CW.filter(ok);
      if (cw.length) h += row('Reprendre la lecture', cw.map(cwCard).join(''), 'cwr');
      const lib = LIB.filter(ok);
      if (lib.length) h += row('Ma liste', lib.slice(0, 20).map(m => posterCard(m)).join(''));
      const r = store.get('treco', null);
      if (r) { const l = (k === 'all' ? r.movie.slice(0, 8).concat(r.series.slice(0, 8)) : r[k] || []); if (l.length) h += row('Pour toi', l.map(m => posterCard(m)).join(''), '', 'selon Trakt'); }
      if (k === 'all' && LIVE.ch.length) h += row('En direct', liveFavs().slice(0, 12).map(liveMini).join(''), 'lvr');
      const jobs = catalogs(c => !needsExtra(c) && (k === 'all' ? true : c.type === k));
      S.jobs = jobs;
      jobs.forEach((j, i) => { h += '<section class="row cat" data-j="' + i + '"><h2>' + esc(catName(j)) + '<small>' + esc(typeLabel(j.cat.type) + ' · ' + (j.a.m.name || '')) + '</small></h2><div class="rs">' + skel(4) + '</div></section>'; });
      if (!jobs.length) h += '<p class="empty">' + (addons.some(a => a.loading) ? 'Chargement des addons…' : 'Aucun catalogue. Ajoute des addons dans Réglages.') + '</p>';
      S.el.querySelector('.rows').innerHTML = h;
      S.el.querySelector('.foot').textContent = 'OneforAll iPhone ' + VERSION + ' (TV ' + TV_VERSION + ') · ' + plural(addons.filter(a => !a.err).length, 'addon');
      if (S.io) S.io.disconnect();
      S.io = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) { S.io.unobserve(en.target); S.loadRow(en.target); } }), { root: S.el, rootMargin: '600px 0px' });
      S.el.querySelectorAll('.row.cat').forEach(el => S.io.observe(el));
      S.hero();
    };
    S.loadRow = function (el) {
      const j = S.jobs[+el.dataset.j];
      if (!j) return;
      const box = el.querySelector('.rs'), fill = items => {
        items = (items || []).filter(m => m && m.id && m.poster);
        if (!items.length) { el.remove(); return; }
        box.innerHTML = items.slice(0, 24).map(m => posterCard(m)).join('');
      };
      const c = cachedCatalog(j);
      if (c.now) fill(c.now);
      c.p.then(items => { if (!c.now || !same(c.now, items.slice(0, 24))) fill(items); }, () => { if (!c.now) el.remove(); });
    };
    S.hero = function () {
      const box = S.el.querySelector('.hero');
      const jobs = trending().filter(j => S.kind === 'all' || j.cat.type === S.kind);
      Promise.all(jobs.map(j => { const c = cachedCatalog(j); return c.now || c.p.catch(() => []); })).then(lists => {
        const out = [], ids = new Set();
        for (let i = 0; i < 12; i++) lists.forEach(l => { const m = l && l[i]; if (m && m.background && !ids.has(m.id)) { ids.add(m.id); out.push(m); } });
        const items = out.slice(0, 8);
        if (!items.length) { box.innerHTML = ''; return; }
        box.innerHTML = '<div class="hs">' + items.map(m => {
          const L = loc(m);
          return '<div class="hc" data-a="open" data-k="' + esc(reg(m)) + '"><img src="' + esc(img(m.background, 780)) + '" alt="" decoding="async"><div class="hg"></div><div class="hx">' +
            '<span class="kick">' + esc(kindLabel(m.type)) + (m.imdbRating ? ' · IMDb ' + esc(String(m.imdbRating).replace('.', ',')) : '') + '</span>' +
            (L.logo ? '<img class="hl" src="' + esc(img(L.logo, 500)) + '" alt="' + esc(L.name) + '" onerror="this.outerHTML=\'<h1>\'+this.alt+\'</h1>\'">' : '<h1>' + esc(L.name) + '</h1>') +
            '<div class="hm">' + metaDots(L) + '</div></div></div>';
        }).join('') + '</div><div class="hdots">' + items.map((x, i) => '<i class="' + (i ? '' : 'on') + '"></i>').join('') + '</div>';
        const hs = box.querySelector('.hs'), dots = box.querySelectorAll('.hdots i');
        hs.addEventListener('scroll', () => { const i = Math.round(hs.scrollLeft / hs.clientWidth); dots.forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
      });
    };
    S.act = function (a, el) {
      if (a === 'kind') { S.kind = el.dataset.k; store.set('homeKind', S.kind); S.render(); S.el.scrollTo({ top: 0 }); }
      else if (a === 'cw') resumeCw(el.dataset.id);
      else if (a === 'live') playLive(LIVE.ch.find(c => c.id === el.dataset.id));
      else if (a === 'refresh') {
        Object.keys(homeCache).forEach(k => { delete homeCache[k]; });
        memo.clear();
        toast('Mise à jour…');
        refreshManifests(true).then(() => { S.render(); Trakt.sync(true); });
      }
    };
    return S;
  }

  // =====================================================================
  // Écran : Fiche
  // =====================================================================
  function trailerOf(m) {
    const t = (m.trailers || []).find(x => x.source) || (m.trailerStreams || []).find(x => x.ytId);
    return t ? (t.source || t.ytId) : '';
  }
  function Details(item) {
    const S = { cls: 'det', meta: null, season: null };
    S.build = function () {
      S.el.innerHTML = '<div class="dbar"><button class="ib glass" data-a="back">' + IC.back + '</button><span class="dbt"></span><button class="ib glass" data-a="lib">' + (libHas(item.id) ? IC.check : IC.plus) + '</button></div>' +
        '<div class="dh"><img class="dbg" alt=""><div class="dg"></div><div class="dlogo"></div></div><div class="db"><p class="dmut">Chargement…</p></div>';
      S.paint(loc(item));
      metaFor(item).then(m => { S.meta = m || item; if (S.el) S.paint(loc(Object.assign({}, item, S.meta))); });
      // Barre du haut : le titre apparaît quand l'image est passée.
      S.el.addEventListener('scroll', () => S.el.classList.toggle('scrolled', S.el.scrollTop > 220), { passive: true });
    };
    S.show = function () { if (S.meta) S.paint(loc(Object.assign({}, item, S.meta))); };
    S.paint = function (m) {
      const q = s => S.el.querySelector(s), bg = m.background || m.poster;
      if (bg && q('.dbg').dataset.u !== bg) { q('.dbg').src = img(bg, 780); q('.dbg').dataset.u = bg; }
      q('.dbt').textContent = m.name || '';
      q('.dlogo').innerHTML = m.logo ? '<img src="' + esc(img(m.logo, 500)) + '" alt="' + esc(m.name) + '" onerror="this.outerHTML=\'<h1>\'+this.alt+\'</h1>\'">' : '<h1>' + esc(m.name || '') + '</h1>';
      q('[data-a="lib"]').innerHTML = libHas(item.id) ? IC.check : IC.plus;
      const full = !!S.meta, isS = item.type === 'series';
      const run = m.runtime ? String(m.runtime).replace(/\s*min$/, ' min') : '';
      let h = '<div class="dm">' + metaDots(m, [run]) + (m.imdbRating ? '<span class="imdb">IMDb</span><b>' + esc(String(m.imdbRating).replace('.', ',')) + '</b>' : '') + '</div>';
      const e = cwGet(item.id), pos = POS[item.id];
      let label = 'Lecture';
      if (isS) { const v = S.resumeVideo(); if (v) label = (e && e.vid === v.id && e.pct ? 'Reprendre ' : 'Lire ') + epLabel(v).replace(' · ', ''); }
      else if (pos && pos.t > 30 && !pos.done) label = 'Reprendre · ' + fmt(pos.d - pos.t) + ' restantes';
      h += '<div class="dact"><button class="btn pri" data-a="play"' + (full ? '' : ' disabled') + '>' + IC.play + '<span>' + esc(label) + '</span></button>' +
        '<div class="dsec"><button class="btn" data-a="lib">' + (libHas(item.id) ? IC.check + 'Dans ma liste' : IC.plus + 'Ma liste') + '</button>' +
        (trailerOf(m) ? '<button class="btn" data-a="trailer">' + IC.trailer + 'Bande-annonce</button>' : '') + '</div></div>';
      if (m.description) h += '<p class="dd">' + esc(m.description) + '</p>';
      const cast = (m.cast || (m.links || []).filter(l => l.category === 'Cast').map(l => l.name) || []).slice(0, 6);
      const dir = [].concat(m.director || (m.links || []).filter(l => l.category === 'Directors').map(l => l.name) || []).slice(0, 2);
      if (cast.length) h += '<p class="dx"><b>Avec</b> ' + esc(cast.join(', ')) + '</p>';
      if (dir.length) h += '<p class="dx"><b>Réalisation</b> ' + esc(dir.join(', ')) + '</p>';
      if (isS && full) h += S.episodes();
      q('.db').innerHTML = h;
      const sel = q('.seasons .on');
      if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
    };
    S.videos = () => sortVideos((S.meta && S.meta.videos) || []);
    S.resumeVideo = function () {
      const vs = S.videos();
      if (!vs.length) return null;
      const e = cwGet(item.id);
      if (e && e.vid) { const v = vs.find(x => x.id === e.vid); if (v) return v; }
      return vs.find(v => v.season && !(POS[v.id] && POS[v.id].done)) || vs[0];
    };
    S.episodes = function () {
      const vs = S.videos(), seasons = [];
      vs.forEach(v => { const s = v.season || 0; if (seasons.indexOf(s) < 0) seasons.push(s); });
      if (!seasons.length) return '<p class="dmut">Aucun épisode.</p>';
      if (S.season == null || seasons.indexOf(S.season) < 0) { const r = S.resumeVideo(); S.season = r ? (r.season || 0) : seasons[0]; }
      const now = Date.now();
      return '<div class="seasons">' + seasons.map(s => '<button class="chip' + (s === S.season ? ' on' : '') + '" data-a="season" data-s="' + s + '">' + (s ? 'Saison ' + s : 'Bonus') + '</button>').join('') + '</div>' +
        '<div class="eps">' + vs.filter(v => (v.season || 0) === S.season).map(v => {
          const p = POS[v.id], pct = p && p.d ? Math.round(100 * p.t / p.d) : p && p.p ? p.p : 0, rel = v.released && Date.parse(v.released) > now;
          return '<div class="ep' + (rel ? ' fut' : '') + '" data-a="ep" data-id="' + esc(v.id) + '"><div class="ept">' + (v.thumbnail ? '<img loading="lazy" src="' + esc(img(v.thumbnail, 300)) + '" alt="">' : '') +
            (p && p.done ? '<span class="pdone">' + IC.check + '</span>' : pct ? '<i class="bar"><u style="width:' + pct + '%"></u></i>' : '') + '</div>' +
            '<div class="epx"><b>' + (v.episode || '') + '. ' + esc(v.title || v.name || 'Épisode ' + v.episode) + '</b><small>' + esc([frDate(v.released), v.runtime].filter(Boolean).join(' · ')) + '</small>' +
            (v.overview || v.description ? '<p>' + esc(v.overview || v.description) + '</p>' : '') + '</div></div>';
        }).join('') + '</div>';
    };
    S.act = function (a, el) {
      const meta = S.meta || item;
      if (a === 'lib') { libToggle(item, meta); S.paint(loc(Object.assign({}, item, meta))); }
      else if (a === 'play') {
        if (item.type === 'series') { const v = S.resumeVideo(); if (v) push(Sources(item, meta, v)); }
        else push(Sources(item, meta, null));
      }
      else if (a === 'season') { S.season = +el.dataset.s; S.paint(loc(Object.assign({}, item, meta))); }
      else if (a === 'ep') { const v = S.videos().find(x => x.id === el.dataset.id); if (v) push(Sources(item, meta, v)); }
      else if (a === 'trailer') location.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(trailerOf(meta));
    };
    return S;
  }

  // =====================================================================
  // Écran : Sources
  // =====================================================================
  const EXT = {
    vlc: ['VLC', u => 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(u)],
    infuse: ['Infuse', u => 'infuse://x-callback-url/play?url=' + encodeURIComponent(u)],
    outplayer: ['Outplayer', u => 'outplayer://' + u],
    senplayer: ['SenPlayer', u => 'senplayer://x-callback-url/play?url=' + encodeURIComponent(u)]
  };
  function openExt(url, app) {
    const e = EXT[app || CFG.ext] || EXT.vlc;
    toast('Ouverture dans ' + e[0] + '… (installe-le depuis l’App Store s’il ne s’ouvre pas)');
    location.href = e[1](url);
  }
  function copy(t, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast(msg || 'Copié'), () => toast('Copie impossible', true));
  }
  function Sources(item, meta, video) {
    const vid = video ? video.id : (meta.id || item.id), type = item.type;
    const S = { cls: 'src', f: 0, list: [] };
    let E = streamsFor(type, vid);
    const upd = () => { if (S.el) S.fill(); };
    S.build = function () {
      const m = loc(Object.assign({}, item, meta)), still = video ? (video.thumbnail || m.background) : (m.background || m.poster);
      S.el.innerHTML = '<div class="nav"><button class="ib" data-a="back">' + IC.back + '</button><div class="nt"><b>' + esc(video ? (video.title || video.name || epLabel(video)) : m.name) + '</b>' +
        '<small>' + esc(video ? m.name + ' · ' + epLabel(video) : [year(m), kindLabel(type)].filter(Boolean).join(' · ')) + '</small></div><button class="ib" data-a="reload">' + IC.refresh + '</button></div>' +
        (still ? '<div class="sst"><img src="' + esc(img(still, 780)) + '" alt=""></div>' : '') +
        '<div class="sfl"></div><div class="sls"></div>';
      E.subs.add(upd);
      S.fill();
    };
    S.destroy = () => E.subs.delete(upd);
    S.filters = function () {
      const names = [];
      E.list.forEach(x => { if (names.indexOf(x.a) < 0) names.push(x.a); });
      const f = [{ l: 'Tout', t: () => true }];
      if (E.list.some(x => x.p.native)) f.push({ l: 'Lisible ici', t: x => x.p.native });
      ['2160p', '1080p', '720p'].forEach(q => { if (E.list.some(x => x.p.q === q)) f.push({ l: q === '2160p' ? '4K' : q, t: x => x.p.q === q }); });
      if (E.list.some(x => x.p.langs.some(l => /^(VF|VFF|VFQ|VFI|VF2|MULTI|FR)$/.test(l)))) f.push({ l: 'VF', t: x => x.p.langs.some(l => /^(VF|VFF|VFQ|VFI|VF2|MULTI|FR)$/.test(l)) });
      if (E.list.some(x => x.p.gb > 0 && x.p.gb < 4)) f.push({ l: '< 4 Go', t: x => x.p.gb > 0 && x.p.gb < 4 });
      if (names.length > 1) names.forEach(n => f.push({ l: n, t: x => x.a === n }));
      return f;
    };
    S.fill = function () {
      E.list.forEach(x => { if (!x.p) x.p = parseSrc(x); });
      const fs = S.fs = S.filters();
      S.f = clamp(S.f, 0, fs.length - 1);
      const list = S.list = E.list.filter(fs[S.f].t);
      S.el.querySelector('.sfl').innerHTML = fs.map((f, i) => '<button class="chip' + (i === S.f ? ' on' : '') + '" data-a="filter" data-i="' + i + '">' + esc(f.l) + '</button>').join('');
      let h = '<div class="scount">' + (E.pending ? '<i class="spin"></i>Recherche dans ' + plural(E.pending, 'addon') + '… · ' : '') + plural(list.length, 'source') + '</div>', prev = '';
      list.forEach((x, i) => {
        const p = x.p;
        if (x.a !== prev) { h += '<div class="sgh">' + esc(x.a) + '</div>'; prev = x.a; }
        h += '<div class="sc" data-a="play" data-i="' + i + '"><div class="scq' + (p.q === '2160p' ? ' k4' : '') + '"><b>' + esc(p.q === '2160p' ? '4K' : p.q) + '</b><small>' + esc(p.kind || '') + '</small></div>' +
          '<div class="scm"><div class="s1">' + esc([p.src || srcName(x), p.codec, p.audio].filter(Boolean).join(' · ')) + '</div>' +
          '<div class="s2">' + (p.langs.length ? '<span class="lgs">' + esc(p.langs.join(' ')) + '</span>' : '') + (p.size ? '<span>' + esc(p.size) + '</span>' : '') +
          '<span class="' + (p.native ? 'nat' : 'extl') + '">' + (p.native ? 'iPhone' : EXT[CFG.ext][0]) + '</span></div>' +
          (p.file ? '<div class="s3">' + esc(p.file) + '</div>' : '') + '</div><button class="ib sm" data-a="more" data-i="' + i + '">' + IC.more + '</button></div>';
      });
      if (!list.length) h += '<p class="empty">' + (!E.srcs.length ? 'Aucun addon de sources installé (Réglages → Addons).' : E.pending ? 'Recherche des sources…' : E.list.length ? 'Aucune source pour ce filtre.' : 'Aucune source trouvée.') + '</p>';
      if (E.skipped && !E.pending) h += '<p class="note">' + plural(E.skipped, 'torrent') + ' sans lien direct ignoré' + (E.skipped > 1 ? 's' : '') + ' (il faut un service debrid).</p>';
      S.el.querySelector('.sls').innerHTML = h;
    };
    const title = () => (meta.name || item.name) + (video ? ' — ' + epTitle(video) : '');
    S.play = function (i, how) {
      const x = S.list[i];
      if (!x) return;
      if (x.st.yt) { location.href = x.st.url; return; }
      how = how || (CFG.player === 'native' ? 'native' : CFG.player === 'ext' ? CFG.ext : x.p.native ? 'native' : CFG.ext);
      if (how === 'native') return push(Player({ item, meta, video, list: S.list.slice(), idx: i }));
      // Lecteur externe : l'app note quand même la lecture dans « Reprendre ».
      const p = POS[vid];
      cwPut(item, meta, video, p && p.d ? Math.round(100 * p.t / p.d) : 1, false);
      Trakt.scrobble('start', item, video, 1);
      openExt(x.st.url, how);
    };
    S.act = function (a, el) {
      if (a === 'filter') { S.f = +el.dataset.i; S.fill(); }
      else if (a === 'reload') {
        E.subs.delete(upd);
        streamCache.delete(type + '/' + vid);
        memo.forEach((v, k) => { if (k.indexOf('/stream/' + type + '/' + encodeURIComponent(vid)) > -1) memo.delete(k); });
        E = streamsFor(type, vid); E.subs.add(upd); S.fill();
      }
      else if (a === 'play') S.play(+el.dataset.i);
      else if (a === 'more') {
        const i = +el.dataset.i, x = S.list[i];
        if (!x) return;
        const items = [{ l: 'Lire dans l’iPhone', sub: x.p.native ? 'Format compatible' : 'Peut échouer (' + (x.p.ext || 'format').toUpperCase() + ')', f: () => S.play(i, 'native') }];
        Object.keys(EXT).forEach(k => items.push({ l: 'Ouvrir dans ' + EXT[k][0], f: () => S.play(i, k) }));
        items.push({ l: 'Copier le lien', f: () => copy(x.st.url, 'Lien copié') });
        sheet({ title: x.p.file || srcName(x), sub: [x.a, x.p.size].filter(Boolean).join(' · '), items });
      }
    };
    return S;
  }

  // =====================================================================
  // Écran : Lecteur (lecteur natif de l'iPhone : AirPlay, image dans l'image, pistes audio)
  // =====================================================================
  function Player(o) {
    const S = { cls: 'pl', full: true, noSwipe: true, idx: o.idx };
    const item = o.item, meta = o.meta, video = o.video;
    const vid = video ? video.id : (meta.id || item.id);
    let V = null, saveT = 0, hideT = 0, blobs = [], started = false;
    S.build = function () {
      S.el.innerHTML = '<video playsinline webkit-playsinline autoplay controls preload="auto" x-webkit-airplay="allow"></video>' +
        '<div class="ptop"><button class="ib glass" data-a="back">' + IC.back + '</button><div class="ptt"><b>' + esc(loc(Object.assign({}, item, meta)).name) + '</b><small>' +
        esc(video ? epTitle(video) : '') + '</small></div><button class="ib glass" data-a="menu">' + IC.more + '</button></div>' +
        '<div class="pmsg"></div><button class="pnext btn pri" data-a="next">' + IC.play + '<span>Épisode suivant</span></button>';
      V = S.el.querySelector('video');
      V.addEventListener('loadedmetadata', () => {
        const p = POS[vid];
        if (p && p.t > 30 && !p.done && p.t < V.duration - 30) V.currentTime = p.t;
        else if (p && p.p && !p.t && V.duration) V.currentTime = V.duration * p.p / 100;
      });
      V.addEventListener('playing', () => { started = true; S.msg(''); Trakt.scrobble('start', item, video, S.pct()); S.peek(); });
      V.addEventListener('pause', () => { S.save(); if (!V.ended) Trakt.scrobble('pause', item, video, S.pct()); S.peek(true); });
      V.addEventListener('timeupdate', () => {
        if (Date.now() - saveT > 5000) { saveT = Date.now(); S.save(); }
        const nx = video && nextVideo(meta, video);
        S.el.classList.toggle('near', !!nx && V.duration > 0 && V.duration - V.currentTime < 45);
      });
      V.addEventListener('ended', () => { S.save(true); Trakt.scrobble('stop', item, video, 100); if (video && nextVideo(meta, video)) S.next(); });
      V.addEventListener('waiting', () => S.msg(started ? '' : 'Chargement…'));
      V.addEventListener('error', () => S.fail());
      S.el.addEventListener('touchstart', () => S.peek(), { passive: true });
      S.load();
    };
    S.pct = () => (V && V.duration ? 100 * V.currentTime / V.duration : 0);
    S.peek = function (stay) {
      S.el.classList.add('ui');
      clearTimeout(hideT);
      if (!stay) hideT = setTimeout(() => { if (V && !V.paused) S.el.classList.remove('ui'); }, 3500);
    };
    S.msg = t => { const m = S.el && S.el.querySelector('.pmsg'); if (m) { m.textContent = t; m.classList.toggle('on', !!t); } };
    S.save = function (end) {
      if (!V || !V.duration || !isFinite(V.duration)) return;
      saveProgress(item, meta, video, end ? V.duration : V.currentTime, V.duration);
    };
    S.cur = () => o.list[S.idx];
    S.load = function () {
      const x = S.cur();
      started = false;
      S.msg('Chargement…');
      blobs.forEach(u => URL.revokeObjectURL(u)); blobs = [];
      V.querySelectorAll('track').forEach(t => t.remove());
      V.src = x.st.url;
      V.load();
      const p = V.play();
      if (p && p.catch) p.catch(() => { S.msg('Touche ▶ pour lancer la lecture'); S.peek(true); });
      S.subs(x);
    };
    // Sous-titres : jusqu'à 3 dans la langue choisie et 1 en anglais, dans le menu du lecteur.
    S.subs = function (x) {
      subtitlesFor(item.type, vid, x.st).then(list => {
        const want = langKey(CFG.subLang), pick = list.filter(s => langKey(s.lang) === want).slice(0, 3).concat(want === 'eng' ? [] : list.filter(s => langKey(s.lang) === 'eng').slice(0, 1));
        pick.forEach((s, i) => fetchText(s.url).then(txt => {
          if (!S.el || S.cur() !== x) return;
          const u = URL.createObjectURL(new Blob([toVtt(txt)], { type: 'text/vtt' }));
          blobs.push(u);
          const t = document.createElement('track');
          t.kind = 'subtitles'; t.label = langLabel(s.lang) + (i ? ' ' + (i + 1) : '') + (s.src && s.src !== 'source' ? ' · ' + s.src : ''); t.srclang = ISO2[langKey(s.lang)] || 'und'; t.src = u;
          V.appendChild(t);
          if (CFG.subAuto && langKey(s.lang) === want && ![].some.call(V.textTracks, tt => tt.mode === 'showing')) setTimeout(() => { if (t.track) t.track.mode = 'showing'; }, 100);
          else setTimeout(() => { if (t.track && t.track.mode === 'showing' && !CFG.subAuto) t.track.mode = 'disabled'; }, 100);
        }).catch(() => {}));
      });
    };
    S.fail = function () {
      if (!S.el) return;
      const x = S.cur();
      S.msg('Ce fichier ne se lit pas dans l’iPhone' + (x.p && x.p.ext ? ' (' + x.p.ext.toUpperCase() + ')' : ''));
      S.peek(true);
      const items = [];
      Object.keys(EXT).forEach(k => items.push({ l: 'Ouvrir dans ' + EXT[k][0], cls: k === CFG.ext ? 'pri' : '', f: () => { pop(); openExt(x.st.url, k); } }));
      const nxt = o.list.findIndex((y, i) => i > S.idx && y.p && y.p.native);
      if (nxt > -1) items.unshift({ l: 'Essayer la source suivante', sub: o.list[nxt].p.file || srcName(o.list[nxt]), f: () => { S.idx = nxt; S.load(); } });
      sheet({ title: 'Lecture impossible ici', sub: 'Les MKV, AVI et certains codecs audio se lisent dans une app vidéo.', items });
    };
    S.next = function () {
      const nx = video && nextVideo(meta, video);
      if (!nx) return;
      pop(true);
      push(Sources(item, meta, nx));
    };
    S.act = function (a) {
      if (a === 'next') S.next();
      else if (a === 'menu') {
        const x = S.cur(), items = [];
        if (V.webkitSupportsFullscreen) items.push({ l: 'Plein écran', f: () => V.webkitEnterFullscreen() });
        Object.keys(EXT).forEach(k => items.push({ l: 'Continuer dans ' + EXT[k][0], f: () => { S.save(); pop(); openExt(x.st.url, k); } }));
        items.push({ l: 'Copier le lien', f: () => copy(x.st.url, 'Lien copié') });
        sheet({ title: x.p ? x.p.file || srcName(x) : '', items });
      }
    };
    S.destroy = function () {
      clearTimeout(hideT);
      if (V) { S.save(); Trakt.scrobble('pause', item, video, S.pct()); V.pause(); V.removeAttribute('src'); V.load(); }
      blobs.forEach(u => URL.revokeObjectURL(u));
      homeDirty = true;
    };
    return S;
  }

  // =====================================================================
  // Direct
  // =====================================================================
  function playLive(ch) {
    if (!ch || !XT()) return;
    store.set('live_last', ch.id);
    const v = liveVariants(ch)[0];
    if (!v) return;
    if (HTTPS) return openExt(liveUrl(v[0], 'm3u8'));
    push(LivePlayer(ch));
  }
  function LivePlayer(ch0) {
    const S = { cls: 'pl live', full: true, noSwipe: true, ch: ch0, vi: 0 };
    let V = null, hideT = 0;
    S.build = function () {
      S.el.innerHTML = '<video playsinline autoplay controls></video><div class="ptop"><button class="ib glass" data-a="back">' + IC.back + '</button><div class="ptt"><b></b><small></small></div>' +
        '<button class="ib glass" data-a="prev">' + IC.up + '</button><button class="ib glass" data-a="nextch">' + IC.down + '</button></div><div class="pmsg"></div>';
      V = S.el.querySelector('video');
      V.addEventListener('playing', () => { S.msg(''); S.peek(); });
      V.addEventListener('error', () => {
        const vs = liveVariants(S.ch);
        if (++S.vi < vs.length) return S.tune();
        S.msg('Chaîne indisponible');
      });
      S.el.addEventListener('touchstart', () => S.peek(), { passive: true });
      S.tune();
    };
    S.msg = t => { const m = S.el.querySelector('.pmsg'); m.textContent = t; m.classList.toggle('on', !!t); };
    S.peek = function () { S.el.classList.add('ui'); clearTimeout(hideT); hideT = setTimeout(() => S.el.classList.remove('ui'), 3500); };
    S.tune = function () {
      const vs = liveVariants(S.ch), v = vs[S.vi] || vs[0];
      S.el.querySelector('.ptt b').textContent = pad(S.ch.num) + '  ' + S.ch.name;
      const p = epgOf(S.ch);
      S.el.querySelector('.ptt small').textContent = p ? p.t + ' · ' + hm(p.s) + ' – ' + hm(p.e) : S.ch.ev || '';
      epgWant(S.ch, () => { if (S.el) { const q = epgOf(S.ch); if (q) S.el.querySelector('.ptt small').textContent = q.t + ' · ' + hm(q.s) + ' – ' + hm(q.e); } });
      S.msg('Chargement…');
      V.pause(); V.removeAttribute('src'); V.load();   // une seule connexion IPTV : on coupe l'ancien flux d'abord
      V.src = liveUrl(v[0], 'm3u8');
      V.play().catch(() => {});
    };
    S.zap = function (d) {
      const list = LIVE.ch, i = list.indexOf(S.ch);
      S.ch = list[(i + d + list.length) % list.length]; S.vi = 0;
      store.set('live_last', S.ch.id);
      S.tune();
    };
    S.act = a => { if (a === 'prev') S.zap(-1); else if (a === 'nextch') S.zap(1); };
    S.destroy = () => { clearTimeout(hideT); V.pause(); V.removeAttribute('src'); V.load(); };
    return S;
  }
  function Live() {
    const S = { cls: 'live', f: 'fav', q: '' };
    S.build = function () {
      S.el.innerHTML = '<header class="hd"><h1>Direct</h1></header><div class="sbox"><i>' + IC.search + '</i><input type="search" placeholder="Chaîne ou numéro" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></div>' +
        '<div class="lvf"></div><div class="lvl"></div>';
      const inp = S.el.querySelector('input');
      inp.addEventListener('input', debounce(() => { S.q = inp.value.trim(); S.list(); }, 150));
      S.render();
    };
    S.show = () => S.list();
    S.render = function () {
      if (!S.el) return;
      const has = LIVE.ch.length;
      const fs = [['fav', 'Favoris'], ['all', 'Toutes']].concat(LIVE_TILES.filter(t => LIVE.ch.some(c => t[2].indexOf(c.c) > -1)).map(t => [t[0], t[1]]));
      S.el.querySelector('.lvf').innerHTML = has ? fs.map(f => '<button class="chip' + (f[0] === S.f ? ' on' : '') + '" data-a="f" data-f="' + f[0] + '">' + esc(f[1]) + '</button>').join('') : '';
      S.el.querySelector('.sbox').style.display = has ? '' : 'none';
      S.list();
    };
    S.list = function () {
      const box = S.el && S.el.querySelector('.lvl');
      if (!box) return;
      if (!XT()) { box.innerHTML = '<p class="empty">L’IPTV n’est pas configurée. Colle le code de configuration du Mac (Réglages).</p>'; return; }
      if (!LIVE.ch.length) {
        box.innerHTML = '<p class="empty">' + (LIVE.loading ? 'Chargement des chaînes…' : HTTPS ? 'Aucune liste de chaînes. Sur le Mac, relance iphone/build.sh puis recolle le code (Réglages → Code de configuration).' : 'Aucune chaîne. ' + esc(LIVE.err)) + '</p>';
        return;
      }
      const tile = LIVE_TILES.find(t => t[0] === S.f), q = chKey(S.q), n = parseInt(S.q, 10);
      let list = S.q ? LIVE.ch.filter(c => (n && c.num === n) || chKey(c.name).indexOf(q) > -1) : S.f === 'fav' ? liveFavs() : S.f === 'all' ? LIVE.ch : LIVE.ch.filter(c => tile && tile[2].indexOf(c.c) > -1);
      const shown = list.slice(0, 300);
      box.innerHTML = (shown.length ? shown.map(ch => {
        const p = epgOf(ch);
        return '<div class="ch" data-a="play" data-id="' + esc(ch.id) + '"><div class="lvt" style="background:' + lvArt(ch.id) + '">' + (ch.logo ? '<img loading="lazy" src="' + esc(img(ch.logo)) + '" alt="" onerror="this.remove()">' : '') +
          '</div><div class="chx"><b><em>' + pad(ch.num) + '</em>' + esc(ch.name) + '</b><small>' + esc(p ? p.t + ' · ' + hm(p.s) + ' – ' + hm(p.e) : ch.ev || '') + '</small>' +
          (p ? '<i class="bar"><u style="width:' + p.pct + '%"></u></i>' : '') + '</div><button class="ib sm fav' + (isFav(ch) ? ' on' : '') + '" data-a="fav" data-id="' + esc(ch.id) + '">' + (isFav(ch) ? IC.star : IC.staro) + '</button></div>';
      }).join('') : '<p class="empty">Aucune chaîne.</p>') +
        '<p class="note">' + plural(LIVE.ch.length, 'chaîne') + ' · liste du ' + esc(frDate(LIVE.at)) + (HTTPS ? ' · lecture dans ' + EXT[CFG.ext][0] : '') + '</p>';
      if (!HTTPS) shown.slice(0, 40).forEach(ch => epgWant(ch, () => S.list()));
    };
    S.act = function (a, el, e) {
      const ch = LIVE.ch.find(c => c.id === el.dataset.id);
      if (a === 'f') { S.f = el.dataset.f; S.render(); S.el.scrollTo({ top: 0 }); }
      else if (a === 'fav') { e.stopPropagation(); if (ch) { toggleFav(ch); S.list(); } }
      else if (a === 'play') playLive(ch);
    };
    return S;
  }

  // =====================================================================
  // Recherche
  // =====================================================================
  function Search() {
    const S = { cls: 'search', q: '', seq: 0 };
    S.build = function () {
      S.el.innerHTML = '<header class="hd"><h1>Recherche</h1></header><div class="sbox"><i>' + IC.search + '</i><input type="search" placeholder="Films, séries…" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"></div><div class="sres"></div>';
      const inp = S.inp = S.el.querySelector('input');
      inp.addEventListener('input', debounce(() => S.run(inp.value.trim()), 380));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { inp.blur(); S.run(inp.value.trim(), true); } });
      S.el.addEventListener('touchstart', e => { if (!e.target.closest('.sbox')) inp.blur(); }, { passive: true });
      S.recent();
    };
    S.focus = () => S.inp.focus();
    S.recent = function () {
      const r = store.get('recent', []);
      S.el.querySelector('.sres').innerHTML = r.length ? '<h3>Recherches récentes</h3><div class="rec">' + r.map(q => '<button class="chip" data-a="q" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' : '<p class="empty">Cherche dans tous tes addons à la fois.</p>';
    };
    S.run = function (q, keep) {
      const seq = ++S.seq;
      S.q = q;
      if (q.length < 2) return S.recent();
      if (keep) store.set('recent', [q].concat(store.get('recent', []).filter(x => x.toLowerCase() !== q.toLowerCase())).slice(0, 10));
      const jobs = catalogs(c => canSearch(c) && (c.type === 'movie' || c.type === 'series'));
      const box = S.el.querySelector('.sres');
      box.innerHTML = '<p class="empty"><i class="spin"></i>Recherche…</p>';
      const res = { movie: [], series: [] }, ids = new Set();
      let left = jobs.length, failed = 0;
      const draw = () => {
        if (seq !== S.seq) return;
        let h = '';
        [['movie', 'Films'], ['series', 'Séries']].forEach(t => { if (res[t[0]].length) h += '<h3>' + t[1] + '</h3><div class="grid">' + res[t[0]].slice(0, 30).map(m => posterCard(m)).join('') + '</div>'; });
        box.innerHTML = h || '<p class="empty">' + (left ? '<i class="spin"></i>Recherche…' : failed === jobs.length ? 'Les addons de recherche ne répondent pas. Réessaie dans un moment.' : 'Aucun résultat pour « ' + esc(q) + ' ».') + '</p>';
      };
      if (!jobs.length) { box.innerHTML = '<p class="empty">Aucun addon ne permet la recherche.</p>'; return; }
      jobs.forEach(j => fetchCatalog(j, 'search=' + encodeURIComponent(q), 600e3).then(items => {
        items.forEach(m => { if (m.poster && !ids.has(m.id) && res[m.type]) { ids.add(m.id); res[m.type].push(m); } });
      }, () => { failed++; }).then(() => { left--; draw(); }));
    };
    S.act = function (a, el) {
      if (a === 'q') { S.inp.value = el.dataset.q; S.run(el.dataset.q, true); }
    };
    return S;
  }

  // =====================================================================
  // Ma liste
  // =====================================================================
  function Library() {
    const S = { cls: 'lib', k: 'all' };
    S.build = function () {
      S.el.innerHTML = '<header class="hd"><h1>Ma liste</h1></header><div class="seg">' + [['all', 'Tout'], ['movie', 'Films'], ['series', 'Séries']].map(k => '<button data-a="k" data-k="' + k[0] + '">' + k[1] + '</button>').join('') + '</div><div class="lbx"></div>';
      S.render();
    };
    S.show = () => S.render();
    S.render = function () {
      if (!S.el) return;
      S.el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.k === S.k));
      const l = LIB.filter(m => S.k === 'all' || m.type === S.k);
      S.el.querySelector('.lbx').innerHTML = l.length ? '<div class="grid">' + l.map(m => posterCard(m)).join('') + '</div>' :
        '<p class="empty">Rien pour l’instant. Touche « + Ma liste » sur une fiche' + (Trakt.connected() ? ' (synchronisé avec Trakt).' : ', ou connecte Trakt dans Réglages.') + '</p>';
    };
    S.act = (a, el) => { if (a === 'k') { S.k = el.dataset.k; S.render(); } };
    return S;
  }

  // =====================================================================
  // Réglages, Addons, Trakt, configuration
  // =====================================================================
  const PLAYER_OPTS = [['auto', 'Automatique', 'iPhone si le format le permet, sinon l’app vidéo'], ['native', 'Toujours l’iPhone'], ['ext', 'Toujours l’app vidéo']];
  const EXT_OPTS = Object.keys(EXT).map(k => [k, EXT[k][0], k === 'vlc' ? 'Gratuit, lit tout' : k === 'infuse' ? 'Le plus joli, Dolby Vision' : '']);
  const SUB_OPTS = Object.keys(LANGS).map(k => [k, LANGS[k]]);
  const THEME_OPTS = [['auto', 'Automatique', 'Suit le réglage de l’iPhone'], ['day', 'Jour'], ['night', 'Nuit']];
  function applyTheme() {
    const night = CFG.theme === 'night' || (CFG.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('night', night);
    document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', night ? '#000000' : '#ECEAE5'));
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  function Settings() {
    const S = { cls: 'set' };
    S.build = () => S.render();
    S.show = () => S.render();
    const line = (a, l, v, cls) => '<button class="li' + (cls ? ' ' + cls : '') + '" data-a="' + a + '"><span>' + esc(l) + '</span><em>' + esc(v || '') + '</em><i>' + IC.chev + '</i></button>';
    const tog = (a, l, on, sub) => '<button class="li tg" data-a="' + a + '"><span>' + esc(l) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><b class="sw' + (on ? ' on' : '') + '"></b></button>';
    S.render = function () {
      const lab = (opts, v) => (opts.find(o => o[0] === v) || [0, ''])[1];
      const tk = Trakt.connected(), last = store.get('tsync', 0);
      S.el.innerHTML = '<header class="hd"><h1>Réglages</h1></header>' +
        '<h3>Trakt</h3><div class="grp">' + (tk ? line('tsync', 'Synchroniser maintenant', last ? 'Fait à ' + clock(new Date(last)) : '') + line('tout', 'Déconnecter Trakt', '', 'red') : line('tlink', 'Connecter Trakt', 'Reprise, vus, Ma liste')) + '</div>' +
        '<h3>Lecture</h3><div class="grp">' + line('player', 'Lecteur', lab(PLAYER_OPTS, CFG.player)) + line('ext', 'App vidéo (MKV, chaînes)', lab(EXT_OPTS, CFG.ext)) +
        line('sub', 'Langue des sous-titres', LANGS[CFG.subLang]) + tog('subauto', 'Sous-titres automatiques', CFG.subAuto, 'Sinon, choisis-les dans le lecteur') + '</div>' +
        '<h3>Direct</h3><div class="grp">' + line('liveq', 'Qualité des chaînes', LIVE_QL[CFG.liveQ]) +
        (XT() ? line('livere', HTTPS ? 'Liste des chaînes' : 'Recharger les chaînes', LIVE.ch.length ? plural(LIVE.ch.length, 'chaîne') : 'aucune') : line('code', 'IPTV', 'non configurée')) + '</div>' +
        '<h3>Addons</h3><div class="grp">' + line('addons', 'Gérer les addons', plural(addons.length, 'addon')) + line('code', 'Code de configuration', SETUP ? 'importé le ' + frDate(SETUP.at) : 'à coller') + '</div>' +
        '<h3>Apparence</h3><div class="grp">' + line('theme', 'Thème', lab(THEME_OPTS, CFG.theme)) + '</div>' +
        '<h3>Données</h3><div class="grp">' + line('clearcache', 'Vider le cache', 'catalogues, fiches') + line('clearhist', 'Vider « Reprendre la lecture »', '', 'red') + '</div>' +
        '<p class="foot">OneforAll iPhone ' + VERSION + ' · base TV ' + TV_VERSION + '<br>' + (navigator.standalone ? 'Installée sur l’écran d’accueil' : 'Astuce : Partager → « Sur l’écran d’accueil » pour l’installer') + '</p>';
    };
    S.act = function (a) {
      const set = (k, v) => { CFG[k] = v; saveCfg(); S.render(); };
      if (a === 'tlink') push(TraktLink());
      else if (a === 'tsync') { toast('Synchronisation…'); Trakt.sync(true).then(ok => { if (ok) toast('Trakt synchronisé'); S.render(); }); }
      else if (a === 'tout') sheet({ title: 'Déconnecter Trakt ?', items: [{ l: 'Déconnecter', cls: 'red', f: () => { Trakt.disconnect(); S.render(); } }] });
      else if (a === 'player') choose('Lecteur', PLAYER_OPTS, CFG.player, v => set('player', v), 'L’iPhone lit les MP4 et HLS ; VLC ou Infuse lisent aussi les MKV.');
      else if (a === 'ext') choose('App vidéo', EXT_OPTS, CFG.ext, v => set('ext', v), 'À installer depuis l’App Store.');
      else if (a === 'sub') choose('Sous-titres', SUB_OPTS, CFG.subLang, v => set('subLang', v));
      else if (a === 'subauto') set('subAuto', !CFG.subAuto);
      else if (a === 'liveq') choose('Qualité des chaînes', Object.keys(LIVE_QL).map(k => [k, LIVE_QL[k]]), CFG.liveQ, v => set('liveQ', v));
      else if (a === 'livere') { if (HTTPS) toast('La liste vient du Mac : relance iphone/build.sh puis recolle le code.'); else liveLoad(true).then(() => S.render()); }
      else if (a === 'theme') choose('Thème', THEME_OPTS, CFG.theme, v => { set('theme', v); applyTheme(); });
      else if (a === 'addons') push(Addons());
      else if (a === 'code') codeSheet();
      else if (a === 'clearcache') {
        Object.keys(homeCache).forEach(k => { delete homeCache[k]; }); store.set('home', {}); memo.clear(); streamCache.clear(); metaMemo.clear();
        homeDirty = true; toast('Cache vidé');
      }
      else if (a === 'clearhist') sheet({ title: 'Vider l’historique ?', sub: 'Reprise et épisodes vus sur cet iPhone.', items: [{ l: 'Vider', cls: 'red', f: () => { CW = []; POS = {}; store.set('cw', CW); store.set('pos', POS); homeDirty = true; toast('Historique vidé'); } }] });
    };
    return S;
  }
  function codeSheet(first) {
    sheet({
      title: first ? 'Bienvenue dans OneforAll' : 'Code de configuration',
      sub: 'Sur le Mac : ouvre « config-iphone.html » (dossier PRIVE_ne_pas_mettre_en_ligne), touche « Copier le code », puis colle-le ici. Il contient tes addons, l’IPTV et Trakt.',
      html: '<div class="code"><textarea placeholder="OFA1:…" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea><div class="cbt"><button class="btn" data-x="paste">' + IC.paste + 'Coller</button>' +
        '<button class="btn pri" data-x="ok">Importer</button></div><p class="cmsg"></p></div>',
      cancel: first ? 'Plus tard' : 'Fermer',
      mount(p) {
        const ta = p.querySelector('textarea'), msg = p.querySelector('.cmsg');
        const go = async () => {
          msg.textContent = 'Import…'; msg.className = 'cmsg';
          try {
            const r = await importCode(ta.value);
            closeSheet();
            toast(plural(r.addons, 'addon') + (r.ch ? ' · ' + plural(r.ch, 'chaîne') : '') + ' importés');
            if (Trakt.connected()) Trakt.sync(true);
          } catch (e) { msg.textContent = e.message; msg.className = 'cmsg err'; }
        };
        p.querySelector('[data-x=paste]').onclick = () => {
          if (!navigator.clipboard || !navigator.clipboard.readText) { ta.focus(); return; }
          navigator.clipboard.readText().then(t => { ta.value = t; if (/OFA1/.test(t)) go(); }, () => { ta.focus(); msg.textContent = 'Touche le champ puis « Coller ».'; });
        };
        p.querySelector('[data-x=ok]').onclick = go;
      }
    });
  }
  function Addons() {
    const S = { cls: 'addons' };
    S.build = function () {
      S.el.innerHTML = '<div class="nav"><button class="ib" data-a="back">' + IC.back + '</button><div class="nt"><b>Addons</b></div><button class="ib" data-a="reload">' + IC.refresh + '</button></div>' +
        '<div class="adadd"><textarea placeholder="https://…/manifest.json" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea><button class="btn pri" data-a="add">Installer</button></div><div class="adl"></div>' +
        '<p class="note">Les adresses d’addons configurés contiennent souvent une clé personnelle (debrid) : ne les partage pas.</p>';
      S.render();
    };
    S.render = function () {
      S.el.querySelector('.adl').innerHTML = addons.map((a, i) => {
        const m = a.m || {}, res = (m.resources || []).map(r => typeof r === 'string' ? r : r.name);
        const what = [res.indexOf('catalog') > -1 || (m.catalogs || []).length ? 'Catalogues' : '', res.indexOf('meta') > -1 ? 'Fiches' : '', res.indexOf('stream') > -1 ? 'Sources' : '', res.indexOf('subtitles') > -1 ? 'Sous-titres' : ''].filter(Boolean).join(' · ');
        return '<div class="ad"><div class="adi">' + (m.logo ? '<img src="' + esc(img(m.logo)) + '" alt="" onerror="this.remove()">' : '') + '</div><div class="adx"><b>' + esc(m.name || hostOf(a.url)) + (m.version ? ' <small>' + esc(m.version) + '</small>' : '') + '</b>' +
          '<small>' + esc(a.err ? '⚠ ' + a.err : what || hostOf(a.url)) + '</small></div>' +
          '<button class="ib sm" data-a="up" data-i="' + i + '"' + (i ? '' : ' disabled') + '>' + IC.up + '</button><button class="ib sm" data-a="rm" data-i="' + i + '">' + IC.trash + '</button></div>';
      }).join('');
    };
    const changed = () => { streamCache.clear(); metaMemo.clear(); homeDirty = true; S.render(); };
    S.act = async function (a, el) {
      const i = +el.dataset.i, l = addonUrls();
      if (a === 'add') {
        const ta = S.el.querySelector('textarea'), url = normUrl(ta.value);
        if (!ta.value.trim()) return;
        if (l.indexOf(url) > -1) return toast('Déjà installé', true);
        el.disabled = true;
        try {
          const m = await getJSON(url, 0, 15000);
          if (!m || !m.id || !m.resources) throw new Error('pas un manifest Stremio');
          manifests[url] = m; saveManifests();
          setAddons(l.concat([url]));
          ta.value = '';
          toast('« ' + m.name + ' » installé');
          changed();
        } catch (e) { toast('Addon introuvable : ' + e.message, true); }
        el.disabled = false;
      }
      else if (a === 'up' && i > 0) { l.splice(i - 1, 0, l.splice(i, 1)[0]); setAddons(l); changed(); }
      else if (a === 'rm') {
        const name = (addons[i].m && addons[i].m.name) || hostOf(l[i]);
        sheet({ title: 'Supprimer « ' + name + ' » ?', items: [{ l: 'Supprimer', cls: 'red', f: () => { l.splice(i, 1); setAddons(l); changed(); } }] });
      }
      else if (a === 'reload') { toast('Mise à jour des addons…'); refreshManifests(true).then(changed); }
    };
    return S;
  }
  function TraktLink() {
    const S = { cls: 'tlink', t: 0 };
    S.build = function () {
      S.el.innerHTML = '<div class="nav"><button class="ib" data-a="back">' + IC.back + '</button><div class="nt"><b>Connecter Trakt</b></div><span class="ib"></span></div><div class="tlb"><p class="empty"><i class="spin"></i>Préparation du code…</p></div>';
      const box = S.el.querySelector('.tlb');
      Trakt.post('/oauth/device/code', { client_id: TRAKT_ID() }).then(r => {
        if (!S.el) return;
        if (r.status !== 200 || !r.d) { box.innerHTML = '<p class="empty">Trakt refuse la demande (' + r.status + ').</p>'; return; }
        const d = S.d = r.d, until = Date.now() + d.expires_in * 1000;
        box.innerHTML = '<p>1. Touche le bouton : le code est copié et Trakt s’ouvre.</p><div class="tcode">' + esc(d.user_code) + '</div>' +
          '<button class="btn pri wide" data-a="open">' + IC.ext + 'Copier et ouvrir trakt.tv</button><p>2. Connecte-toi, colle le code, valide, puis reviens ici.</p><p class="empty"><i class="spin"></i>En attente de validation…</p>';
        let every = (d.interval || 5) * 1000;
        const poll = () => {
          if (!S.el) return;
          if (Date.now() > until) { box.innerHTML = '<p class="empty">Le code a expiré. Reviens en arrière et recommence.</p>'; return; }
          Trakt.post('/oauth/device/token', { code: d.device_code, client_id: TRAKT_ID(), client_secret: TRAKT_SECRET() }).then(t => {
            if (!S.el) return;
            if (t.status === 200 && t.d) {
              store.set('trakt', t.d);
              toast('Trakt connecté ! Synchronisation…');
              Trakt.sync(true).then(ok => { if (ok) toast('Trakt synchronisé'); });
              if (curScreen() === S) pop();
              return;
            }
            if (t.status === 418) { box.innerHTML = '<p class="empty">Connexion refusée sur Trakt.</p>'; return; }
            if (t.status === 410 || t.status === 404) { box.innerHTML = '<p class="empty">Le code n’est plus valable. Recommence.</p>'; return; }
            if (t.status === 429) every += 1000;
            S.t = setTimeout(poll, every);
          }, () => { S.t = setTimeout(poll, every); });
        };
        S.poll = () => { clearTimeout(S.t); poll(); };
        S.t = setTimeout(poll, every);
      }, () => { if (S.el) box.innerHTML = '<p class="empty">Trakt est injoignable.</p>'; });
    };
    S.show = () => { if (S.poll) S.poll(); };
    S.act = function (a) {
      if (a === 'open' && S.d) {
        (navigator.clipboard ? navigator.clipboard.writeText(S.d.user_code) : Promise.resolve()).catch(() => {}).then(() => { window.open(S.d.verification_url + '/' + encodeURIComponent(S.d.user_code), '_blank'); });
      }
    };
    S.destroy = () => { clearTimeout(S.t); S.el = null; };
    return S;
  }

  const ROOTS = { home: Home, search: Search, live: Live, lib: Library, set: Settings };

  // =====================================================================
  // Démarrage
  // =====================================================================
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { savePos.flush(); return; }
    const S = curScreen();
    if (S && S.show) S.show();
    Trakt.sync();
  });
  if ('serviceWorker' in navigator && HTTPS) navigator.serviceWorker.register('sw.js').catch(() => {});
  applyTheme();
  APP.innerHTML = '';
  showTab('home');
  refreshManifests().then(ch => { if (ch) { homeDirty = true; refreshVisible(); } });
  const hash = decodeURIComponent(location.hash || '');
  if (/OFA1/.test(hash)) {
    history.replaceState(null, '', location.pathname);   // le code ne reste pas dans l'adresse
    importCode(hash).then(r => toast(plural(r.addons, 'addon') + ' importés'), e => toast(e.message, true));
  } else if (!SETUP && !store.get('welcomed', false)) {
    store.set('welcomed', true);
    setTimeout(() => codeSheet(true), 400);
  }
  setTimeout(() => { Trakt.sync(); liveLoad(); }, 1500);
})();
