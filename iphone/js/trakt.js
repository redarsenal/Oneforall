// OneforAll - synchronisation Trakt.
// Fichier 2/7, chargé par index.html après base.js (voir l'en-tête de js/base.js).
'use strict';

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
  delPlayback(id) { if (this.connected()) this.req('DELETE', '/sync/playback/' + id).catch(() => {}); },
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
          e.traktPid = p.id;
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
      const wl = ((await this.req('GET', '/sync/watchlist?limit=1000')) || []).filter(w => (w.type === 'movie' || w.type === 'show') && w[w.type].ids.imdb && !libHas(w[w.type].ids.imdb));
      const newLib = (await pmap(wl, 6, async w => {
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
