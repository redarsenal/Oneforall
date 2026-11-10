// OneforAll - lecteur et direct.
// Fichier 6/7, chargé par index.html après ecrans.js (voir l'en-tête de js/base.js).
'use strict';

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
  // Pas de sous-titres automatiques quand l'audio est en français (comme sur la TV et le Mac) : langue de la piste jouée
  // si Safari la connaît, sinon le nom de la source (VFF, VF, TRUEFRENCH, MULTI, 🇫🇷 ; VOSTFR = VO, donc non).
  const audioFr = x => {
    const at = V.audioTracks;
    if (at) for (let i = 0; i < at.length; i++) if (at[i].enabled && at[i].language && at[i].language !== 'und') return /^fr/i.test(at[i].language);
    const L = (x.p || parseSrc(x)).langs || [];
    return L.some(l => /^(VFF|VFQ|VFI|VF2|VF|MULTI)$/.test(l)) || L.indexOf('FR') > -1 && L.indexOf('VOSTFR') < 0;
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
        const auto = CFG.subAuto && !audioFr(x);
        if (auto && langKey(s.lang) === want && ![].some.call(V.textTracks, tt => tt.mode === 'showing')) setTimeout(() => { if (t.track) t.track.mode = 'showing'; }, 100);
        else setTimeout(() => { if (t.track && t.track.mode === 'showing' && !auto) t.track.mode = 'disabled'; }, 100);
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
    const list = liveList(), i = list.indexOf(S.ch);
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
    const has = liveList().length;
    const fs = [['fav', 'Favoris'], ['all', 'Toutes']].concat(LIVE_TILES.filter(t => liveList().some(c => t[2].indexOf(c.c) > -1)).map(t => [t[0], t[1]]));
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
    let list = S.q ? liveList().filter(c => (n && c.num === n) || chKey(c.name).indexOf(q) > -1) : S.f === 'fav' ? liveFavs() : S.f === 'all' ? liveList() : liveList().filter(c => tile && tile[2].indexOf(c.c) > -1);
    const shown = list.slice(0, 300);
    box.innerHTML = (shown.length ? shown.map(ch => {
      const p = epgOf(ch);
      return '<div class="ch" data-a="play" data-id="' + esc(ch.id) + '"><div class="lvt" style="background:' + lvArt(ch.id) + '">' + (ch.logo ? '<img loading="lazy" src="' + esc(img(ch.logo)) + '" alt="" onerror="this.remove()">' : '') +
        '</div><div class="chx"><b><em>' + pad(ch.num) + '</em>' + esc(ch.name) + '</b><small>' + esc(p ? p.t + ' · ' + hm(p.s) + ' – ' + hm(p.e) : ch.ev || '') + '</small>' +
        (p ? '<i class="bar"><u style="width:' + p.pct + '%"></u></i>' : '') + '</div><button class="ib sm fav' + (isFav(ch) ? ' on' : '') + '" data-a="fav" data-id="' + esc(ch.id) + '">' + (isFav(ch) ? IC.star : IC.staro) + '</button></div>';
    }).join('') : '<p class="empty">Aucune chaîne.</p>') +
      '<p class="note">' + plural(liveList().length, 'chaîne') + ' · liste du ' + esc(frDate(LIVE.at)) + (HTTPS ? ' · lecture dans ' + EXT[CFG.ext][0] : '') + '</p>';
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
