// OneforAll - code de configuration, icônes, onglets, feuilles et toasts.
// Fichier 4/7, chargé par index.html après iptv.js (voir l'en-tête de js/base.js).
'use strict';

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
  SETUP = store.set('setup', { trakt: d.trakt || null, iptv: d.iptv || null, tmdb: d.tmdb || null, at: d.at || Date.now() });
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
  moon: svgi('<path d="M20 14.5A8 8 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>'),
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
  // Profil enfant : le code parental (le même que sur la TV et le Mac) garde l'accès aux réglages, où se change de profil.
  if (t === 'set' && KID() && tab !== 'set') {
    const pin = store.get('kidpin', '');
    if (pin && prompt('Code parental') !== pin) return toast('Code incorrect', true);
  }
  if (t === tab && !stack.length && roots[t]) { const r = roots[t]; r.el.scrollTo({ top: 0, behavior: 'smooth' }); if (r.focus) r.focus(); return; }
  while (stack.length) pop(true);
  tab = t;
  if (!roots[t]) { const S = ROOTS[t](); roots[t] = S; makeEl(S, 'root ' + S.cls); S.build(); }
  Object.keys(roots).forEach(k => roots[k].el.classList.toggle('hid', k !== t));
  reveal(roots[t].el);
  const S = roots[t];
  if (S.show) S.show();
  drawTabbar();
  document.body.classList.remove('full');
}
// Rejoue l'animation d'apparition d'un écran (changement d'onglet).
function reveal(el) { el.classList.remove('fadein'); void el.offsetWidth; el.classList.add('fadein'); }
function push(S) {
  const under = curScreen();
  makeEl(S, 'push ' + S.cls);
  if (under && under.el && !S.full) under.el.classList.add('under');   // l'écran du dessous glisse un peu, comme sur iOS
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
  if (top && top.el) top.el.classList.remove('under');
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
function closeSheet() { SHEET.className = ''; sheetDone = null; setTimeout(() => { if (!SHEET.className) SHEET.innerHTML = ''; }, 1300); }   // après la descente de la feuille
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
    '<span class="cwp">' + IC.play + '</span><button class="cwx" data-a="cwmore" data-id="' + esc(e.id) + '">' + IC.more + '</button><i class="bar"><u style="width:' + clamp(e.pct || 0, 2, 100) + '%"></u></i></div>' +
    '<div class="pt">' + esc(L.name) + '</div><div class="ps">' + esc(e.label ? e.label + (e.ept ? ' · ' + e.ept : '') : (e.pct ? 'Reste ' + (100 - e.pct) + ' %' : year(e))) + '</div></div>';
}
// Menu d'une carte « Reprendre la lecture » : retirer, marquer comme vu, ouvrir la fiche.
function cwMenu(id) {
  const e = cwGet(id);
  if (!e) return;
  const drop = () => {
    CW = CW.filter(x => x.id !== id);
    store.set('cw', CW);
    if (e.traktPid) Trakt.delPlayback(e.traktPid);
    homeDirty = true; refreshVisible();
  };
  sheet({ title: loc(e).name, sub: e.label ? e.label + (e.ept ? ' · ' + e.ept : '') : '', items: [
    { l: 'Retirer de « Reprendre la lecture »', cls: 'red', f: () => { drop(); toast('Retiré'); } },
    { l: 'Marquer comme vu', f: () => { const k = e.vid || e.id; POS[k] = Object.assign({}, POS[k], { done: true, at: Date.now() }); savePos(); drop(); toast('Marqué comme vu'); } },
    { l: 'Ouvrir la fiche', f: () => openItem(e) }
  ] });
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
