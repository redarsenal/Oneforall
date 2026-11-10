// OneforAll - écrans Accueil, Fiche et Sources.
// Fichier 5/7, chargé par index.html après interface.js (voir l'en-tête de js/base.js).
'use strict';

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
function genreJob(type) {
  for (const a of addons) {
    if (a.err || !isCinemeta(a)) continue;
    for (const cat of a.m.catalogs || []) {
      if (cat.type !== type) continue;
      const ex = (cat.extra || []).find(e => e.name === 'genre');
      if (ex && !ex.isRequired && ex.options && ex.options.indexOf('Action') > -1) return { a, cat, options: ex.options };
    }
  }
  return null;
}
const todayKey = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
function traktReco(kind) {
  const r = store.get('treco', null);
  if (!r) return [];
  return kind === 'all' ? r.movie.slice(0, 8).concat(r.series.slice(0, 8)) : (r[kind] || []);
}
// « Pour toi » : profil de goûts local (genres de l'historique, plus récent = plus de poids, titres terminés ou dans « Ma liste » = plus),
// candidats = catalogues des genres préférés + suggestions TMDB « similaires » aux 5 derniers visionnages + Trakt (un signal parmi d'autres).
// Profil enfant : seulement Animation / Famille, jamais d'horreur, de thriller, de crime ni de guerre. Calculé une fois par jour et par profil.
const TMDB_G = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror',
  10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action', 10765: 'Sci-Fi', 10762: 'Family', 10768: 'War' };
const KID_YES = ['Animation', 'Family'], KID_NO = ['Horror', 'Thriller', 'Crime', 'War', 'Mystery', 'Romance', 'Adult'];
const recoKidOk = g => g.some(x => KID_YES.indexOf(x) > -1) && !g.some(x => KID_NO.indexOf(x) > -1);
// La clé TMDB vient du code de configuration (jamais dans le dépôt) ; sans clé, « Pour toi » fonctionne sans les suggestions TMDB.
const TMDB_KEY = () => String((SETUP && SETUP.tmdb) || '').trim();
function tmdb(path) {
  const k = TMDB_KEY();
  if (!k) return Promise.reject(new Error('Pas de clé TMDB'));
  return getJSON('https://api.tmdb.org/3' + path + (path.indexOf('?') > -1 ? '&' : '?') + 'api_key=' + encodeURIComponent(k), 86400e3, 12000);
}
// Poids des genres : { 'movie|Action': 3.1, … }.
function tasteProfile(hist) {
  const t = {};
  hist.forEach((h, i) => {
    let w = 1 / (1 + i * 0.15);
    if (POS[h.id] && POS[h.id].done) w *= 1.5;
    if (libHas(h.id)) w *= 1.5;
    (h.g || []).forEach(g => { const k = h.type + '|' + g; t[k] = (t[k] || 0) + w; });
  });
  return t;
}
// Suggestions TMDB « similaires » à un titre de l'historique (aucune si pas de clé TMDB).
async function tmdbSimilar(h) {
  const media = h.type === 'movie' ? 'movie' : 'tv', f = await tmdb('/find/' + encodeURIComponent(h.id) + '?external_source=imdb_id');
  const hit = ((media === 'movie' ? f.movie_results : f.tv_results) || [])[0];
  if (!hit) return [];
  const r = await tmdb('/' + media + '/' + hit.id + '/recommendations?language=fr-FR');
  return (r.results || []).filter(x => x.poster_path && (x.vote_average || 0) >= 6).slice(0, 10).map(x => ({
    tmdb: x.id, media, type: h.type, name: x.title || x.name, poster: 'https://image.tmdb.org/t/p/w342' + x.poster_path, rating: x.vote_average,
    releaseInfo: String(x.release_date || x.first_air_date || '').slice(0, 4), genres: (x.genre_ids || []).map(g => TMDB_G[g]).filter(Boolean), src: h.n || ''
  }));
}
async function recommendCompute(kind) {
  const kid = KID(), hist = kind === 'all' ? HIST : HIST.filter(h => h.type === kind);
  const seen = new Set(HIST.map(h => h.id).concat(CW.map(e => e.id), LIB.map(e => e.id))), cand = new Map();
  const taste = tasteProfile(hist);
  const add = (m, f) => {
    if (!m || seen.has(m.id)) return;
    let c = cand.get(m.id);
    if (!c) cand.set(m.id, c = { m, sim: 0, src: '', trakt: 0 });
    if (f) f(c);
  };
  const picks = Object.keys(taste).sort((a, b) => taste[b] - taste[a]).map(k => {
    const p = k.split('|'), j = genreJob(p[0]);
    return j && j.options.indexOf(p[1]) > -1 ? { j, g: p[1] } : null;
  }).filter(Boolean).slice(0, 4);
  const lists = await Promise.all(picks.map(x => fetchCatalog(x.j, 'genre=' + encodeURIComponent(x.g), 3600e3).catch(() => [])));
  lists.forEach(l => l.forEach(m => add(m)));
  if (!kid) traktReco(kind).forEach(m => add(m, c => { c.trakt = 1; }));
  if (TMDB_KEY()) {
    const sims = (await Promise.all(hist.filter(h => imdbOf(h.id)).slice(0, 5).map(h => tmdbSimilar(h).catch(() => [])))).reduce((a, l) => a.concat(l), []);
    const by = new Map();
    sims.forEach(x => { const k = x.media + x.tmdb, e = by.get(k); if (e) { e.n++; if (!e.src) e.src = x.src; } else by.set(k, Object.assign({ n: 1 }, x)); });
    const top = Array.from(by.values()).filter(x => !kid || recoKidOk(x.genres)).sort((a, b) => b.n - a.n || b.rating - a.rating).slice(0, 14);
    const ids = await pmap(top, 4, x => tmdb('/' + x.media + '/' + x.tmdb + '/external_ids').then(e => (e && imdbOf(e.imdb_id)) || null));
    top.forEach((x, i) => {
      if (!ids[i]) return;
      add({ id: ids[i], type: x.type, name: x.name, poster: x.poster, releaseInfo: x.releaseInfo, genres: x.genres, imdbRating: x.rating }, c => { c.sim += x.n; c.src = c.src || x.src; });
    });
  }
  const scored = Array.from(cand.values()).map(c => {
    const g = c.m.genres || [], r = parseFloat(c.m.imdbRating);
    if (kid && !recoKidOk(g)) return null;
    if (r && r < 6) return null;
    let s = c.sim * 2.5 + c.trakt * 1.5 + (r ? (r - 6) * 0.3 : 0);
    g.forEach(x => { s += (taste[c.m.type + '|' + x] || 0) / Math.max(1, g.length); });
    return { c, s };
  }).filter(x => x && x.s > 0).sort((a, b) => b.s - a.s);
  const lead = scored.find(x => x.c.sim && x.c.src), names = [];
  picks.forEach(x => { const n = GENRES_FR[x.g] || x.g; if (names.indexOf(n) < 0) names.push(n); });
  const why = lead ? 'parce que tu as regardé ' + lead.c.src : names.length ? 'parce que tu aimes ' + names.slice(0, 2).join(' et ').toLowerCase() : (!kid && traktReco(kind).length ? 'selon Trakt' : '');
  return { items: scored.slice(0, 30).map(x => x.c.m), why };
}
function recommend(kind) {
  const key = 'lreco_' + (store.get('syncpid', null) || '') + '_' + kind, head = HIST[0] ? HIST[0].id : '', c = store.get(key, null);
  if (c && c.day === todayKey() && c.h === head && c.res && c.res.items.length) return Promise.resolve(c.res);
  return recommendCompute(kind).then(res => { if (res.items.length) store.set(key, { day: todayKey(), h: head, res }); return res; });
}
function Home() {
  const S = { cls: 'home', kind: store.get('homeKind', 'all'), heroItems: [] };
  S.build = function () {
    S.el.innerHTML = '<header class="hd"><div class="brand">' + LOGO + '<b>OneforAll</b></div><span class="hbt"><button class="ib" data-a="night">' + IC.moon + '</button><button class="ib" data-a="refresh">' + IC.refresh + '</button></span></header>' +
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
    const reco = HIST.some(x => k === 'all' || x.type === k) || traktReco(k).length > 0;
    if (reco) h += '<section class="row reco"><h2>Pour toi</h2><div class="rs">' + skel(4) + '</div></section>';
    if (k === 'all' && liveList().length) h += row('En direct', liveFavs().slice(0, 12).map(liveMini).join(''), 'lvr');
    const jobs = catalogs(c => !needsExtra(c) && (k === 'all' ? true : c.type === k));
    S.jobs = jobs;
    jobs.forEach((j, i) => { h += '<section class="row cat" data-j="' + i + '"><h2>' + esc(catName(j)) + '<small>' + esc(typeLabel(j.cat.type) + ' · ' + (j.a.m.name || '')) + '</small></h2><div class="rs">' + skel(4) + '</div></section>'; });
    if (!jobs.length) h += '<p class="empty">' + (addons.some(a => a.loading) ? 'Chargement des addons…' : 'Aucun catalogue. Ajoute des addons dans Réglages.') + '</p>';
    const rowsEl = S.el.querySelector('.rows');
    rowsEl.innerHTML = h;
    if (!S.shown) { S.shown = true; rowsEl.classList.add('rise'); setTimeout(() => rowsEl.classList.remove('rise'), 1200); }   // rangées qui montent en cascade, au premier affichage seulement
    S.el.querySelector('.foot').textContent = 'OneforAll iPhone ' + VERSION + ' (TV ' + TV_VERSION + ') · ' + plural(addons.filter(a => !a.err).length, 'addon');
    if (S.io) S.io.disconnect();
    S.io = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) { S.io.unobserve(en.target); S.loadRow(en.target); } }), { root: S.el, rootMargin: '600px 0px' });
    S.el.querySelectorAll('.row.cat').forEach(el => S.io.observe(el));
    if (reco) recommend(k).then(res => {
      const el = S.el.querySelector('.row.reco');
      if (!el) return;
      if (!res.items.length) return el.remove();
      el.querySelector('h2').innerHTML = 'Pour toi' + (res.why ? '<small>' + esc(res.why) + '</small>' : '');
      el.querySelector('.rs').innerHTML = res.items.map(m => posterCard(m)).join('');
    }, () => { const el = S.el.querySelector('.row.reco'); if (el) el.remove(); });
    S.hero();
  };
  S.loadRow = function (el) {
    const j = S.jobs[+el.dataset.j];
    if (!j) return;
    const box = el.querySelector('.rs'), fill = items => {
      items = kidList((items || []).filter(m => m && m.id && m.poster));
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
      for (let i = 0; i < 12; i++) lists.forEach(l => { const m = l && l[i]; if (m && m.background && !ids.has(m.id) && (!KID() || kidOk(m))) { ids.add(m.id); out.push(m); } });
      const items = out.slice(0, 8);
      if (!items.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="hs">' + items.map(m => {
        const L = loc(m);
        return '<div class="hc" data-a="open" data-k="' + esc(reg(m)) + '"><img src="' + esc(img(m.background, 780)) + '" alt="" decoding="async"><div class="hg"></div><div class="hx">' +
          '<span class="kick">' + esc(kindLabel(m.type)) + (m.imdbRating ? ' · IMDb ' + esc(String(m.imdbRating).replace('.', ',')) : '') + '</span>' +
          (L.logo ? '<img class="hl" src="' + esc(img(L.logo, 500)) + '" alt="' + esc(L.name) + '" onerror="var h=document.createElement(\'h1\');h.textContent=this.alt;this.replaceWith(h)">' : '<h1>' + esc(L.name) + '</h1>') +
          '<div class="hm">' + metaDots(L) + '</div></div></div>';
      }).join('') + '</div><div class="hdots">' + items.map((x, i) => '<i class="' + (i ? '' : 'on') + '"></i>').join('') + '</div>';
      const hs = box.querySelector('.hs'), dots = box.querySelectorAll('.hdots i');
      hs.addEventListener('scroll', () => { const i = Math.round(hs.scrollLeft / hs.clientWidth); dots.forEach((d, k) => d.classList.toggle('on', k === i)); }, { passive: true });
    });
  };
  S.act = function (a, el) {
    if (a === 'kind') { S.kind = el.dataset.k; store.set('homeKind', S.kind); S.render(); S.el.scrollTo({ top: 0 }); }
    else if (a === 'cw') resumeCw(el.dataset.id);
    else if (a === 'cwmore') cwMenu(el.dataset.id);
    else if (a === 'live') playLive(LIVE.ch.find(c => c.id === el.dataset.id));
    else if (a === 'night') { CFG.theme = document.body.classList.contains('night') ? 'day' : 'night'; saveCfg(); applyTheme(); toast(document.body.classList.contains('night') ? 'Mode nuit' : 'Mode jour'); }
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
// « À voir aussi » : titres liés selon Trakt (si connecté ou clé fournie), sinon le même genre chez Cinemeta.
function relatedFor(item, meta) {
  const id = imdbOf(item.id), self = item.id;
  const viaGenre = () => {
    const j = genreJob(item.type), g = rawGenres(meta).find(x => j && j.options.indexOf(x) > -1);
    if (!j || !g) return Promise.resolve({ items: [], trakt: false });
    return fetchCatalog(j, 'genre=' + encodeURIComponent(g), 3600e3).then(l => ({ items: l.filter(m => m.id !== self).slice(0, 14), trakt: false }), () => ({ items: [], trakt: false }));
  };
  if (!TRAKT_ID() || !id) return viaGenre();
  return fetch(TAPI + '/' + (item.type === 'movie' ? 'movies' : 'shows') + '/' + id + '/related?limit=14', { headers: { 'trakt-api-version': '2', 'trakt-api-key': TRAKT_ID() } }).then(r => (r.ok ? r.json() : []), () => [])
    .then(l => pmap((l || []).filter(o => o.ids && o.ids.imdb), 4, o => metaFor({ type: item.type, id: o.ids.imdb })))
    .then(ms => {
      const items = ms.filter(m => m && m.poster).map(m => slim(m, '', item.type));
      return items.length ? { items, trakt: true } : viaGenre();
    }, viaGenre);
}
// Filmographie d'un acteur (TMDB) : ses films et séries, les plus connus d'abord. Touche un titre : sa fiche (via son numéro IMDb).
function Person(name) {
  const S = { cls: 'person', f: 'all', all: [], loading: true, err: '' };
  const NOT_ACTING = /\b(self|himself|herself|lui-même|elle-même|narrat)/i;
  S.build = function () {
    S.el.innerHTML = '<div class="nav"><button class="ib" data-a="back">' + IC.back + '</button><div class="nt"><b>' + esc(name) + '</b><small>Filmographie</small></div></div>' +
      '<div class="seg">' + [['all', 'Tout'], ['movie', 'Films'], ['series', 'Séries']].map(k => '<button data-a="k" data-k="' + k[0] + '">' + k[1] + '</button>').join('') + '</div><div class="pbx"></div>';
    S.render();
    tmdb('/search/person?language=fr-FR&query=' + encodeURIComponent(name)).then(r => {
      const res = r.results || [], hit = res.find(x => x.known_for_department === 'Acting') || res[0];
      if (!hit) throw new Error('Acteur introuvable sur TMDB');
      return tmdb('/person/' + hit.id + '/combined_credits?language=fr-FR');
    }).then(c => {
      const seen = new Set();
      S.all = (c.cast || []).filter(x => (x.media_type === 'movie' || x.media_type === 'tv') && x.poster_path && !NOT_ACTING.test(x.character || '')
        && !(x.genre_ids || []).some(g => g === 10767 || g === 10763 || g === 10764)   // ni talk-show, ni info, ni télé-réalité
        && (!KID() || recoKidOk((x.genre_ids || []).map(g => TMDB_G[g]).filter(Boolean))))
        .filter(x => { const k = x.media_type + x.id; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
        .map(x => ({ tmdb: x.id, media: x.media_type, type: x.media_type === 'tv' ? 'series' : 'movie', name: x.title || x.name,
          poster: 'https://image.tmdb.org/t/p/w342' + x.poster_path, releaseInfo: String(x.release_date || x.first_air_date || '').slice(0, 4) }));
    }).catch(e => { S.err = e.message === 'Pas de clé TMDB' ? 'La filmographie a besoin de la clé TMDB : relance iphone/build.sh puis recolle le code (Réglages).' : 'Filmographie indisponible pour le moment.'; })
      .then(() => { S.loading = false; if (S.el) S.render(); });
  };
  S.render = function () {
    S.el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.k === S.f));
    const l = S.all.filter(x => S.f === 'all' || x.type === S.f);
    S.el.querySelector('.pbx').innerHTML = S.loading ? '<p class="empty"><i class="spin"></i>Chargement…</p>' : S.err ? '<p class="empty">' + esc(S.err) + '</p>' : !l.length ? '<p class="empty">Aucun titre trouvé.</p>' :
      '<div class="grid">' + l.map((m, i) => '<div class="po" data-a="pt" data-i="' + S.all.indexOf(m) + '"><div class="pi"><img loading="lazy" decoding="async" src="' + esc(m.poster) + '" alt=""><span class="pn">' + esc(m.name) + '</span></div><div class="pt">' + esc(m.name) +
        '</div><div class="ps">' + esc([m.releaseInfo, kindLabel(m.type)].filter(Boolean).join(' · ')) + '</div></div>').join('') + '</div>';
  };
  S.act = function (a, el) {
    if (a === 'k') { S.f = el.dataset.k; S.render(); }
    else if (a === 'pt') {
      const m = S.all[+el.dataset.i];
      if (!m) return;
      tmdb('/' + m.media + '/' + m.tmdb + '/external_ids').then(x => {
        if (!x || !/^tt\d+$/.test(x.imdb_id || '')) return toast('Fiche introuvable pour « ' + m.name + ' »', true);
        push(Details({ id: x.imdb_id, type: m.type, name: m.name, poster: m.poster, releaseInfo: m.releaseInfo }));
      }, () => toast('Fiche indisponible pour le moment', true));
    }
  };
  return S;
}
function Details(item) {
  const S = { cls: 'det', meta: null, season: null, rel: [], relTrakt: false };
  S.build = function () {
    S.el.innerHTML = '<div class="dbar"><button class="ib glass" data-a="back">' + IC.back + '</button><span class="dbt"></span><button class="ib glass" data-a="lib">' + (libHas(item.id) ? IC.check : IC.plus) + '</button></div>' +
      '<div class="dh"><img class="dbg" alt=""><div class="dg"></div><div class="dlogo"></div></div><div class="db"><p class="dmut">Chargement…</p></div>';
    S.paint(loc(item));
    metaFor(item).then(m => {
      S.meta = m || item;
      if (S.el) S.paint(loc(Object.assign({}, item, S.meta)));
      relatedFor(item, S.meta).then(r => { S.rel = kidList(r.items); S.relTrakt = r.trakt; if (S.el) S.paint(loc(Object.assign({}, item, S.meta))); });
    });
    // Barre du haut : le titre apparaît quand l'image est passée.
    S.el.addEventListener('scroll', () => S.el.classList.toggle('scrolled', S.el.scrollTop > 220), { passive: true });
  };
  S.show = function () { if (S.meta) S.paint(loc(Object.assign({}, item, S.meta))); };
  S.paint = function (m) {
    const q = s => S.el.querySelector(s), bg = m.background || m.poster;
    if (bg && q('.dbg').dataset.u !== bg) { q('.dbg').src = img(bg, 780); q('.dbg').dataset.u = bg; }
    q('.dbt').textContent = m.name || '';
    q('.dlogo').innerHTML = m.logo ? '<img src="' + esc(img(m.logo, 500)) + '" alt="' + esc(m.name) + '" onerror="var h=document.createElement(\'h1\');h.textContent=this.alt;this.replaceWith(h)">' : '<h1>' + esc(m.name || '') + '</h1>';
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
    if (cast.length) h += '<p class="dx"><b>Avec</b> ' + cast.map(n => '<a class="dp" data-a="person" data-n="' + esc(n) + '">' + esc(n) + '</a>').join(', ') + '</p>';
    if (dir.length) h += '<p class="dx"><b>Réalisation</b> ' + esc(dir.join(', ')) + '</p>';
    if (isS && full) h += S.episodes();
    if (full && S.rel && S.rel.length) h += '<div class="dre">' + row('À voir aussi', S.rel.map(x => posterCard(x)).join(''), '', S.relTrakt ? 'selon Trakt' : 'même genre') + '</div>';
    q('.db').innerHTML = h;
    if (full && !S.risen) { S.risen = true; const db = q('.db'); db.classList.add('rise'); setTimeout(() => db.classList.remove('rise'), 1200); }
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
    else if (a === 'person') push(Person(el.dataset.n));
    else if (a === 'trailer') location.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(trailerOf(meta));
  };
  return S;
}

// =====================================================================
// Écran : Sources
// =====================================================================
const EXT = {
  vlc: ['VLC', u => 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(u)],
  infuse: ['Infuse', u => 'infuse://x-callback-url/play?url=' + encodeURIComponent(u)],   // format officiel Firecore
  outplayer: ['Outplayer', u => 'outplayer://' + u],
  senplayer: ['SenPlayer', u => 'senplayer://x-callback-url/play?url=' + encodeURIComponent(u)]
};
function openExt(url, app) {
  const e = EXT[app || CFG.ext] || EXT.vlc;
  toast('Ouverture dans ' + e[0] + '…');
  const a = document.createElement('a');
  a.href = e[1](url);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Rien n'a pris la main au bout de 3 s (ni l'app vidéo, ni la question d'iOS) : elle n'est sans doute pas installée.
  let left = false;
  const away = () => { left = true; };
  window.addEventListener('blur', away, { once: true });
  document.addEventListener('visibilitychange', away, { once: true });
  setTimeout(() => {
    window.removeEventListener('blur', away);
    document.removeEventListener('visibilitychange', away);
    if (!left) toast(e[0] + ' ne s’ouvre pas : installe-le depuis l’App Store, ou choisis une autre app (Réglages)', true);
  }, 3000);
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
