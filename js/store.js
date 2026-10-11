/* SlipFit state: the one gateway to everything you have logged.
 *
 * Local-first. Everything lives in localStorage under KEY and the app works
 * fully signed out. Signing in to a slippylabs account and switching sync on
 * mirrors it to two per-account blobs at admin.slippylabs.com/api/saves:
 *   fit      profile, plan, goals, body, check-ins, badges, settings
 *   fit-log  the workout log, in a compact array encoding (the bulk of the data)
 * Two slugs because each blob is capped at 256 KB; the log gets one to itself.
 * Sync is whole-state last-write-wins on `updated`. Per-record merging could
 * resurrect a workout you deleted on another device, so it is not done.
 *
 * Every change goes through save(). A change to the in-progress workout passes
 * {local: true}: it is saved instantly but does not count as a synced edit.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Ex = node ? require('./exercises.js') : root.FitEx;

  const KEY = 'slipfit-v1';
  const SCHEMA = 1;
  const SLUG = 'fit', LOG_SLUG = 'fit-log';
  const SYNC_PREF = 'slipfit-sync';
  const MAX_BYTES = 256 * 1024;
  const DEBOUNCE_MS = 2500;

  function defaults() {
    return {
      schema: SCHEMA,
      updated: '',
      profile: {
        name: '', sex: 'm', birthYear: 1995, heightCm: 175, weightKg: 80, units: 'imperial',
        activity: 1.55, goal: 'general', experience: 'beginner', equip: 'gym', minutes: 45,
        weeklyGoal: 3, waterGoal: 8, proteinGoal: 140, sleepGoal: 7.5, stepsGoal: 8000, onboarded: false,
      },
      settings: { sound: true, vibrate: true, remind: false, remindTime: '18:00', rest: 90, theme: 'auto' },
      plan: null,          // the active plan (a copy, so editing a built-in never changes the library)
      planStarted: '',     // YYYY-MM-DD the active plan began
      planOffset: 0,       // sessions done on this plan before planStarted counted (for "skip ahead")
      templates: [],
      workouts: [],
      body: [],            // [{ d, w?, bf?, waist?, chest?, hips?, arm?, thigh?, neck? }] metric
      daily: {},           // { 'YYYY-MM-DD': { water, protein, sleep, steps } }
      goals: [],
      badges: {},          // { badgeId: 'YYYY-MM-DD' first earned }
      custom: [],          // user-made exercises
      finishedPlans: [],   // [{ name, d }]
      notes: '',
      active: null,        // the workout being logged right now; never synced
      seenVersion: '',
    };
  }

  // Schema migrations: MIGRATIONS[n] upgrades a state at schema n-1 to n.
  // Never edit an old entry; add a new one and bump SCHEMA.
  const MIGRATIONS = {};

  function migrate(s) {
    const base = defaults();
    s = s && typeof s === 'object' ? s : base;
    let v = s.schema || 1;
    while (v < SCHEMA) { v++; if (MIGRATIONS[v]) s = MIGRATIONS[v](s); s.schema = v; }
    // Fill any field a newer version added, without touching what is there.
    Object.keys(base).forEach((k) => { if (s[k] === undefined) s[k] = base[k]; });
    s.profile = Object.assign({}, base.profile, s.profile || {});
    s.settings = Object.assign({}, base.settings, s.settings || {});
    return s;
  }

  /* ---------- compact log encoding ----------
   * A workout:  [id, d, st, en, name, plan, pday, note, [[exId, sets], ...]]
   * A set by exercise type:  w/b [w, r, rpe]   t [t, w]   c [min, km]   m [min]
   * Trailing empty slots are dropped. ~6x smaller than the object form.
   */
  const SET_FIELDS = { w: ['w', 'r', 'rpe'], b: ['w', 'r', 'rpe'], t: ['t', 'w'], c: ['min', 'km'], m: ['min'] };

  function trimTail(a) { while (a.length && (a[a.length - 1] === undefined || a[a.length - 1] === null || a[a.length - 1] === '')) a.pop(); return a; }
  const num = (x) => (typeof x === 'number' && isFinite(x) ? Math.round(x * 1000) / 1000 : undefined);

  function encodeWorkout(w) {
    return trimTail([w.id, w.d, w.st || 0, w.en || 0, w.name || '', w.plan || '', w.pday === undefined || w.pday === null ? '' : w.pday, w.note || '',
      (w.ex || []).map((e) => {
        const f = SET_FIELDS[Ex.get(e.id).type] || SET_FIELDS.w;
        return [e.id, (e.s || []).map((s) => trimTail(f.map((k) => num(s[k])).map((x) => (x === undefined ? null : x))))];
      })]);
  }

  function decodeWorkout(a) {
    const w = { id: a[0], d: a[1], st: a[2] || 0, en: a[3] || 0, name: a[4] || '', ex: [] };
    if (a[5]) w.plan = a[5];
    if (a[6] !== '' && a[6] !== undefined && a[6] !== null) w.pday = a[6];
    if (a[7]) w.note = a[7];
    (a[8] || []).forEach((pair) => {
      const f = SET_FIELDS[Ex.get(pair[0]).type] || SET_FIELDS.w;
      w.ex.push({ id: pair[0], s: (pair[1] || []).map((arr) => {
        const s = {};
        f.forEach((k, i) => { if (arr[i] !== undefined && arr[i] !== null) s[k] = arr[i]; });
        return s;
      }) });
    });
    return w;
  }

  function splitForSync(state) {
    const meta = {};
    Object.keys(state).forEach((k) => { if (k !== 'workouts' && k !== 'active' && k !== 'seenVersion') meta[k] = state[k]; });
    return {
      main: { v: 1, updated: state.updated, data: meta },
      log: { v: 1, updated: state.updated, w: (state.workouts || []).map(encodeWorkout) },
    };
  }

  function joinFromSync(main, log, local) {
    const s = Object.assign({}, main.data);
    s.workouts = ((log && log.w) || []).map(decodeWorkout);
    s.active = local ? local.active : null;
    s.seenVersion = local ? local.seenVersion : '';
    s.updated = main.updated;
    return migrate(s);
  }

  /* ---------- the store ---------- */

  function nowStamp() { return new Date().toISOString(); }

  function createStore(storage, account) {
    let state = null;
    let syncOn = false, syncUser = null, timer = null, busy = false;
    const listeners = [];
    let onStatus = function () {};

    function read() {
      try { return JSON.parse(storage.getItem(KEY) || 'null'); } catch (e) { return null; }
    }

    function load() {
      state = migrate(read());
      Ex.addCustom(state.custom);
      try { syncOn = storage.getItem(SYNC_PREF) === 'on'; } catch (e) { syncOn = false; }
      return state;
    }

    function write() {
      try { storage.setItem(KEY, JSON.stringify(state)); return true; }
      catch (e) { onStatus('Could not save: this browser\'s storage is full or blocked.', true); return false; }
    }

    function save(opts) {
      if (!(opts && opts.local)) { state.updated = nowStamp(); queueSync(); }
      write();
      listeners.forEach((fn) => fn(state));
    }

    function replace(next) {
      state = migrate(next);
      Ex.addCustom(state.custom);
      save();
    }

    function sizes() {
      const parts = splitForSync(state);
      return { main: JSON.stringify(parts.main).length, log: JSON.stringify(parts.log).length, max: MAX_BYTES };
    }

    async function push(quiet) {
      if (!syncOn || !syncUser || !account || busy) return;
      const parts = splitForSync(state);
      const big = [JSON.stringify(parts.main).length, JSON.stringify(parts.log).length];
      if (big[0] > MAX_BYTES || big[1] > MAX_BYTES) {
        onStatus('Your data is too big to sync (' + Math.round(Math.max(big[0], big[1]) / 1024) + ' KB of ' + MAX_BYTES / 1024
          + ' KB). It is still safe here; export a backup from Me.', true);
        return;
      }
      busy = true;
      try {
        const a = await account.saveGameData(LOG_SLUG, parts.log);
        const b = a && a.ok ? await account.saveGameData(SLUG, parts.main) : a;
        if (b && b.ok) { if (!quiet) onStatus('Synced to ' + syncUser + '.'); }
        else onStatus('Could not sync: ' + ((b && b.error) || 'the account service did not answer') + '. Your data is safe in this browser.', true);
      } catch (e) {
        onStatus('Could not reach the account service. Your data is safe in this browser.', true);
      } finally { busy = false; }
    }

    function queueSync() {
      if (!syncOn || !syncUser) return;
      clearTimeout(timer);
      timer = setTimeout(() => push(true), DEBOUNCE_MS);
    }

    async function pull() {
      if (!syncOn || !syncUser || !account) return 'off';
      let main = null, log = null;
      try {
        main = await account.loadGameSave(SLUG);
        log = await account.loadGameSave(LOG_SLUG);
      } catch (e) { onStatus('Could not reach the account service; using this browser\'s copy.', true); return 'error'; }
      if (!main || !main.data) {
        if (state.workouts.length || state.profile.onboarded) await push(false);
        else onStatus('Sync is on. Nothing stored for ' + syncUser + ' yet.');
        return 'pushed';
      }
      if (state.updated && main.updated && state.updated > main.updated) {
        onStatus('This browser had newer changes, so they were kept and uploaded.');
        await push(true);
        return 'pushed';
      }
      if (main.updated === state.updated) { onStatus('In sync with ' + syncUser + '.'); return 'same'; }
      state = joinFromSync(main, log, state);
      Ex.addCustom(state.custom);
      write();
      listeners.forEach((fn) => fn(state));
      onStatus('Loaded your data from ' + syncUser + '.');
      return 'pulled';
    }

    async function setSync(on) {
      syncOn = !!on;
      try { storage.setItem(SYNC_PREF, on ? 'on' : 'off'); } catch (e) { /* private window */ }
      if (on) return pull();
      // Off means withdrawn, not orphaned: blank the stored copies.
      if (account && syncUser) {
        try {
          await account.saveGameData(LOG_SLUG, { v: 1, updated: nowStamp(), w: [] });
          await account.saveGameData(SLUG, { v: 1, updated: nowStamp(), data: null });
        } catch (e) { /* nothing more to do from here */ }
      }
      onStatus('Sync is off. Your account copy was cleared; this browser keeps everything.');
      return 'off';
    }

    async function initSync() {
      if (!account) return null;
      let user = null;
      try { user = await account.getUser(); } catch (e) { user = null; }
      syncUser = user && user.authenticated ? user.username : null;
      if (syncUser && syncOn) await pull();
      return syncUser;
    }

    return {
      load, save, replace, sizes, push, pull, setSync, initSync,
      get state() { return state; },
      get syncOn() { return syncOn; },
      get syncUser() { return syncUser; },
      onChange(fn) { listeners.push(fn); },
      onStatus(fn) { onStatus = fn; },
    };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  const api = { KEY, SCHEMA, SLUG, LOG_SLUG, MAX_BYTES, defaults, migrate, MIGRATIONS, encodeWorkout, decodeWorkout, splitForSync, joinFromSync, createStore, uid };
  if (node) module.exports = api;
  else root.FitStore = api;
})(this);
