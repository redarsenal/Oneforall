// OneforAll - recherche, Ma liste, réglages et démarrage (charge en dernier).
// Fichier 7/7, chargé par index.html après lecteur.js (voir l'en-tête de js/base.js).
'use strict';

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
      kidList(items).forEach(m => { if (m.poster && !ids.has(m.id) && res[m.type]) { ids.add(m.id); res[m.type].push(m); } });
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
const ANIM_OPTS = [['soft', 'Douces', 'Par défaut, sans se presser'], ['slow', 'Lentes', 'Pour bien les voir'], ['fast', 'Rapides'], ['off', 'Aucune']];
const ANIM_SPD = { fast: 1, soft: 1.35, slow: 1.8, off: 0 };
function applyAnim() {
  document.documentElement.style.setProperty('--spd', ANIM_SPD[CFG.anim] || 1.35);
  document.body.classList.toggle('noanim', CFG.anim === 'off');
}
function applyTheme() {
  const night = CFG.theme === 'night' || (CFG.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('night', night);
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', night ? '#000000' : '#ECEAE5'));
}
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
function Settings() {
  const S = { cls: 'set' };
  S.build = () => S.render();
  // À chaque ouverture de l'onglet, les groupes de réglages montent en cascade.
  S.show = function () {
    S.render();
    S.el.classList.add('rise');
    clearTimeout(S.riseT);
    S.riseT = setTimeout(() => S.el.classList.remove('rise'), 1800);
  };
  const line = (a, l, v, cls) => '<button class="li' + (cls ? ' ' + cls : '') + '" data-a="' + a + '"><span>' + esc(l) + '</span><em>' + esc(v || '') + '</em><i>' + IC.chev + '</i></button>';
  const tog = (a, l, on, sub) => '<button class="li tg" data-a="' + a + '"><span>' + esc(l) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span><b class="sw' + (on ? ' on' : '') + '"></b></button>';
  S.render = function () {
    const lab = (opts, v) => (opts.find(o => o[0] === v) || [0, ''])[1];
    const tk = Trakt.connected(), last = store.get('tsync', 0);
    S.el.innerHTML = '<header class="hd"><h1>Réglages</h1></header>' +
      '<h3>Trakt</h3><div class="grp">' + (tk ? line('tsync', 'Synchroniser maintenant', last ? 'Fait à ' + clock(new Date(last)) : '') + line('tout', 'Déconnecter Trakt', '', 'red') : line('tlink', 'Connecter Trakt', 'Reprise, vus, Ma liste')) + '</div>' +
      '<h3>Synchro entre appareils</h3><div class="grp">' + (Sync.on() ? line('sync', 'Nouveau code pour un autre appareil', 'active') + line('syncpid', 'Profil synchronisé', (store.get('syncpid', null) && (store.get('profiles', []).find(x => x.id === store.get('syncpid', null)) || {}).name) || 'à choisir') + line('syncnow', 'Synchroniser maintenant', '') + line('syncoff', 'Arrêter la synchro', '', 'red') : line('sync', 'Activer la synchro', Sync.url() ? 'désactivée' : 'adresse manquante') + line('syncjoin', 'Entrer un code', '')) + '</div>' +
      '<h3>Lecture</h3><div class="grp">' + line('player', 'Lecteur', lab(PLAYER_OPTS, CFG.player)) + line('ext', 'App vidéo (MKV, chaînes)', lab(EXT_OPTS, CFG.ext)) +
      line('sub', 'Langue des sous-titres', LANGS[CFG.subLang]) + tog('subauto', 'Sous-titres automatiques', CFG.subAuto, 'Jamais quand l’audio est en français ; sinon, choisis-les dans le lecteur') + '</div>' +
      '<h3>Direct</h3><div class="grp">' + line('liveq', 'Qualité des chaînes', LIVE_QL[CFG.liveQ]) +
      (XT() ? line('livere', HTTPS ? 'Liste des chaînes' : 'Recharger les chaînes', LIVE.ch.length ? plural(LIVE.ch.length, 'chaîne') : 'aucune') : line('code', 'IPTV', 'non configurée')) + '</div>' +
      '<h3>Addons</h3><div class="grp">' + line('addons', 'Gérer les addons', plural(addons.length, 'addon')) + line('code', 'Code de configuration', SETUP ? 'importé le ' + frDate(SETUP.at) : 'à coller') + '</div>' +
      '<h3>Apparence</h3><div class="grp">' + line('theme', 'Thème', lab(THEME_OPTS, CFG.theme)) + line('anim', 'Animations', lab(ANIM_OPTS, CFG.anim)) + '</div>' +
      '<h3>Données</h3><div class="grp">' + line('clearcache', 'Vider le cache', 'catalogues, fiches') + line('clearhist', 'Vider « Reprendre la lecture »', '', 'red') + '</div>' +
      '<p class="foot">OneforAll iPhone ' + VERSION + ' · base TV ' + TV_VERSION + '<br>' + (navigator.standalone ? 'Installée sur l’écran d’accueil' : 'Astuce : Partager → « Sur l’écran d’accueil » pour l’installer') + '</p>';
  };
  const lab2 = (opts, v) => (opts.find(o => o[0] === v) || [0, ''])[1];
  S.act = function (a) {
    const set = (k, v) => { CFG[k] = v; saveCfg(); S.render(); };
    if (a === 'sync') {
      if (!Sync.url()) return toast('Adresse de synchro absente (voir sync/LISEZMOI.md).', true);
      (Sync.on() ? Sync.newCode() : Sync.start()).then(c => { sheet({ title: 'Code (10 min) : ' + c, items: [{ l: 'OK', f: () => {} }] }); S.render(); }, e => toast('Synchro : ' + e.message, true));
    }
    else if (a === 'syncjoin') {
      if (!Sync.url()) return toast('Adresse de synchro absente (voir sync/LISEZMOI.md).', true);
      const c = prompt('Code à 6 chiffres affiché sur l’autre appareil');
      if (c) Sync.join(c).then(() => { toast('Appareil associé'); S.render(); }, e => toast('Synchro : ' + e.message, true));
    }
    else if (a === 'syncpid') {
      const ps = store.get('profiles', []);
      if (!ps.length) return toast('Aucun profil reçu : synchronise d’abord (le profil vient de la TV ou du Mac).', true);
      choose('Profil synchronisé', ps.map(x => [x.id, x.name]), store.get('syncpid', null), v => {
        store.set('syncpid', v);
        Object.keys(Sync.meta).forEach(k => { if (/^(cw|lib|hist|pos|recent|livefav)_/.test(k)) delete Sync.meta[k]; });
        store.set('syncmeta', Sync.meta);
        Sync.run(false).then(() => { toast('Profil changé'); setTimeout(() => location.reload(), 500); });   // l'accueil, Ma liste et le mode enfant dépendent du profil : on recharge
      }, 'Ma liste, reprise de lecture, historique et favoris de ce profil seront partagés avec ce profil sur la TV et le Mac.');
    }
    else if (a === 'syncnow') Sync.run(false).then(ok => { if (ok) toast('Synchronisé'); });
    else if (a === 'syncoff') { Sync.leave(); toast('Synchro arrêtée'); S.render(); }
    else if (a === 'tlink') push(TraktLink());
    else if (a === 'tsync') { toast('Synchronisation…'); Trakt.sync(true).then(ok => { if (ok) toast('Trakt synchronisé'); S.render(); }); }
    else if (a === 'tout') sheet({ title: 'Déconnecter Trakt ?', items: [{ l: 'Déconnecter', cls: 'red', f: () => { Trakt.disconnect(); S.render(); } }] });
    else if (a === 'player') choose('Lecteur', PLAYER_OPTS, CFG.player, v => set('player', v), 'L’iPhone lit les MP4 et HLS ; VLC ou Infuse lisent aussi les MKV.');
    else if (a === 'ext') choose('App vidéo', EXT_OPTS, CFG.ext, v => set('ext', v), 'À installer depuis l’App Store.');
    else if (a === 'sub') choose('Sous-titres', SUB_OPTS, CFG.subLang, v => set('subLang', v));
    else if (a === 'subauto') set('subAuto', !CFG.subAuto);
    else if (a === 'liveq') choose('Qualité des chaînes', Object.keys(LIVE_QL).map(k => [k, LIVE_QL[k]]), CFG.liveQ, v => set('liveQ', v));
    else if (a === 'livere') { if (HTTPS) toast('La liste vient du Mac : relance iphone/build.sh puis recolle le code.'); else liveLoad(true).then(() => S.render()); }
    else if (a === 'anim') choose('Animations', ANIM_OPTS, CFG.anim, v => { set('anim', v); applyAnim(); toast('Animations : ' + lab2(ANIM_OPTS, v).toLowerCase()); });
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
// iOS (app installée, barre d'état translucide) donne une fenêtre plus courte que l'écran de la hauteur de la
// barre d'état : la page s'arrêtait avant le bas. On prend la vraie hauteur de l'écran quand l'écart est celui-là.
function fitScreen() {
  const land = window.matchMedia('(orientation: landscape)').matches;
  const full = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
  const gap = full - window.innerHeight;
  const h = navigator.standalone && gap > 0 && gap <= 80 ? full : window.innerHeight;
  document.documentElement.style.setProperty('--appH', h + 'px');
}
fitScreen();
window.addEventListener('resize', fitScreen);
window.addEventListener('orientationchange', () => setTimeout(fitScreen, 300));
// Images : fondu à l'arrivée au lieu d'apparaître d'un coup.
document.addEventListener('load', e => { if (e.target.tagName === 'IMG') e.target.classList.add('ld'); }, true);
// Sans ça, Safari n'applique pas :active au toucher (effet d'appui sur les cartes et boutons).
document.addEventListener('touchstart', () => {}, { passive: true });
applyTheme();
applyAnim();
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
setTimeout(() => { Sync.run(true); Trakt.sync(); liveLoad(); }, 1500);
setInterval(() => { if (!document.hidden) Sync.run(true); }, 5 * 60e3);
