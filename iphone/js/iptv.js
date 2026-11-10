// OneforAll - télé en direct (Xtream).
// Fichier 3/7, chargé par index.html après trakt.js (voir l'en-tête de js/base.js).
'use strict';

// =====================================================================
// IPTV (Xtream) : chaînes françaises, ordre Canal+, favoris en premier (comme la TV 4.4.1)
// =====================================================================
const XT = () => (SETUP && SETUP.iptv && SETUP.iptv.username ? SETUP.iptv : null);
const XT_SERVERS = () => { const x = XT(); return x ? [].concat(x.servers || x.server || []).map(s => String(s).replace(/\/?$/, '/')) : []; };
const LIVE = Object.assign({ ch: [], at: 0, srv: 0 }, store.get('live', {}), { loading: false, err: '' });
// Cache des chaînes dans IndexedDB ; l'ancien cache localStorage sert tout de suite puis est déplacé. liveLoad attend cette lecture.
const liveReady = idb.get('live').then(c => {
  if (c && c.ch && c.ch.length && (c.at || 0) > (LIVE.ch.length ? LIVE.at : -1)) {
    Object.assign(LIVE, { ch: c.ch, at: c.at, srv: c.srv || 0 });
    homeDirty = true;
    if (roots.live) roots.live.render();
    return true;
  }
  if (!c && LIVE.ch.length) return idb.set('live', { ch: LIVE.ch, at: LIVE.at, srv: LIVE.srv });
}).then(ok => { if (ok) try { localStorage.removeItem('ofa_live'); } catch (e) {} }, () => {});
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
  idb.set('live', { ch: LIVE.ch, at: LIVE.at, srv: LIVE.srv });
  homeDirty = true;
  if (roots.live) roots.live.render();
}
// En ligne seulement si l'app est servie en http (Wi-Fi de la maison) : le fournisseur n'a pas de https,
// et une page https n'a pas le droit de l'appeler. Sinon, la liste vient du code de configuration du Mac.
// Flux : une requête par catégorie française ; si l'une échoue ou qu'aucune n'est reconnue, la liste complète.
async function liveStreams(srv, cats) {
  const ids = (cats || []).filter(c => {
    const n = String(c.category_name || '').replace(/\s+/g, ' ').trim().toUpperCase();
    return LIVE_CATS.some(x => x[1].test(n));
  }).map(c => c.category_id);
  if (ids.length) {
    try {
      const parts = await Promise.all(ids.map(id => request(liveApi(srv, 'get_live_streams&category_id=' + encodeURIComponent(id)), 40000)));
      if (parts.every(Array.isArray)) return [].concat.apply([], parts);
    } catch (e) {}
  }
  return request(liveApi(srv, 'get_live_streams'), 120000);
}
async function liveLoad(force) {
  if (!XT() || LIVE.loading || HTTPS) return;
  await liveReady;
  if (LIVE.loading) return;
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
        const streams = await liveStreams(s, cats);
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
const liveList = () => (KID() ? LIVE.ch.filter(c => c.c === 'kids') : LIVE.ch);   // profil enfant : chaînes jeunesse seulement
function favIds() { const f = store.get('livefav', null); return f || liveList().slice(0, 8).map(c => c.id); }
const isFav = ch => favIds().indexOf(ch.id) > -1;
function liveFavs() { const f = favIds(); return liveList().filter(c => f.indexOf(c.id) > -1); }
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
