// OneforAll - synchro entre appareils (API : sync/worker.js). Profils, chaînes favorites, réglages, position dans le Direct.
// Chaque clé a sa date de modification ; en cas de conflit la plus récente gagne. Rien de secret n'est envoyé (ni IPTV, ni Trakt, ni addons).
const SYNC_PREFIX = 'ofa_';
const SYNC_CFG = ['subLang'];   // le reste de cfg dépend de l'appareil (lecteur, relais…) et diffère entre la TV et l'iPhone
const syncKeyOk = k => /^(profiles|kidpin|suboff|introl|live_last|livesrc|cfg|(livefav|cw|lib|hist|pos|recent)_[A-Za-z0-9_-]{1,40})$/.test(k);   // clé telle qu'elle voyage sur le serveur
// Données propres à chaque profil : « <nom>_<id du profil> » sur le serveur.
// L'iPhone n'a qu'un profil : il suit celui choisi dans Réglages (syncpid) et lit/écrit ses clés sans suffixe.
const SYNC_PER = ['cw', 'lib', 'hist', 'pos', 'recent', 'livefav'];
const syncRemote = k => (SYNC_PER.indexOf(k) < 0 ? k : (store.get('syncpid', null) ? k + '_' + store.get('syncpid', null) : null));
const syncLocal = r => {
  const m = r.match(/^(cw|lib|hist|pos|recent|livefav)_(.+)$/);
  return m ? (m[2] === store.get('syncpid', null) ? m[1] : null) : r;
};
const syncProj = (k, v) => {
  if (k !== 'cfg') return v;
  const o = {}; SYNC_CFG.forEach(n => { if (v && v[n] !== undefined) o[n] = v[n]; });
  return o;
};
const SYNC_URL_DEFAULT = 'https://oneforall-sync.galletjulien59-6fc.workers.dev';
const Sync = {
  // Adresse publique du Worker de sync/ (voir sync/LISEZMOI.md) ; vide = pas de synchro.
  url: () => (window.SYNC_URL || SYNC_URL_DEFAULT || '').replace(/\/+$/, ''),
  id: () => store.get('syncid', null),
  on() { return !!(this.url() && this.id()); },
  meta: store.get('syncmeta', {}),   // { clé: { t: date de modif, s: valeur synchronisée en texte } }
  busy: false, applying: false,
  async call(path, body) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(this.url() + path, { method: 'POST', body: JSON.stringify(body || {}), signal: ctl.signal });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('Erreur ' + r.status));
      return d;
    } finally { clearTimeout(to); }
  },
  // Appelé à chaque store.set : date la clé si sa partie synchronisée a vraiment changé.
  touch(k, v) {
    const rk = syncRemote(k);
    if (this.applying || !this.on() || !rk || !syncKeyOk(rk)) return;
    const s = JSON.stringify(syncProj(rk, v)), m = this.meta[rk];
    if (m && m.s === s) return;
    this.meta[rk] = { t: Date.now(), s };
    store.set('syncmeta', this.meta);
    this.push();
  },
  // Clés locales jamais encore synchronisées : date 1 (plus vieilles que tout), pour que l'autre appareil gagne s'il a des données.
  scan() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const n = localStorage.key(i);
        if (!n || n.indexOf(SYNC_PREFIX) !== 0) continue;
        const lk = n.slice(SYNC_PREFIX.length), k = syncRemote(lk);
        if (k && syncKeyOk(k) && !this.meta[k]) this.meta[k] = { t: 1, s: JSON.stringify(syncProj(k, store.get(lk, null))) };
      }
    } catch (e) {}
  },
  async run(quiet) {
    if (!this.on() || this.busy) return false;
    this.busy = true;
    try {
      this.scan();
      const keys = {};
      Object.keys(this.meta).forEach(k => { keys[k] = { v: JSON.parse(this.meta[k].s), t: this.meta[k].t }; });
      const d = await this.call('/sync/' + this.id(), { keys });
      let changed = 0;
      this.applying = true;
      try {
        Object.keys(d.keys || {}).forEach(k => {
          const r = d.keys[k], m = this.meta[k];
          const lk = syncLocal(k);
          if (!lk || !syncKeyOk(k) || (m && m.t >= r.t)) return;
          const s = JSON.stringify(r.v);
          if (!m || m.s !== s) {
            if (k === 'cfg') store.set('cfg', Object.assign({}, store.get('cfg', {}), r.v || {}));
            else store.set(lk, r.v);
            changed++;
          }
          this.meta[k] = { t: r.t, s };
        });
      } finally { this.applying = false; }
      // Premier échange : l'iPhone suit par défaut le premier profil reçu (modifiable dans Réglages).
      const ps = store.get('profiles', []);
      if (!store.get('syncpid', null) && ps.length) { store.set('syncpid', ps[0].id); this.push(); }
      store.set('syncmeta', this.meta);
      store.set('synclast', Date.now());
      // Les écrans gardent profils et favoris en mémoire : on recharge pour les relire, mais jamais pendant une lecture.
      if (changed) this.reload(quiet);
      return true;
    } catch (e) {
      if (!quiet) toast('Synchro : ' + (e.name === 'AbortError' ? 'pas de réponse' : e.message), true);
      return false;
    } finally { this.busy = false; }
  },
  reload(quiet) {
    if (window.SYNC_NO_RELOAD) return;
    const playing = (typeof cur !== 'undefined' && cur && cur.isPlayer) || (typeof curScreen === 'function' && (curScreen() || {}).cls === 'pl');
    if (playing) { this.pending = true; return; }
    this.pending = false;
    toast('Synchronisé, mise à jour…');
    setTimeout(() => location.reload(), 600);
  },
  push: debounce(() => Sync.run(true), 4000),
  async start() {
    const code = await this.call('/pair', { id: this.id() || undefined });
    store.set('syncid', code.id);
    this.meta = this.meta || {};
    this.scan(); store.set('syncmeta', this.meta);
    await this.run(true);
    return code.code;
  },
  async newCode() { return (await this.call('/pair', { id: this.id() })).code; },
  async join(code) {
    const d = await this.call('/join', { code });
    store.set('syncid', d.id);
    this.meta = {}; store.set('syncmeta', this.meta);
    await this.run(true);
    return true;
  },
  leave() { store.set('syncid', null); this.meta = {}; store.set('syncmeta', {}); }
};
// Toute écriture d'une clé synchronisée est datée au passage.
(function () {
  const raw = store.set.bind(store);
  store.set = (k, v) => { const r = raw(k, v); Sync.touch(k, v); return r; };
})();
