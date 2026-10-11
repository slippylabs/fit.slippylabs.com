#!/usr/bin/env node
/* Streaks, PRs, XP, badges, the plan generator and the store. Run: node tools/test_logic.js
 * Every date is passed in, so nothing here depends on when it runs. */
'use strict';
const path = require('path');
const js = (f) => require(path.join(__dirname, '..', 'js', f));
const G = js('gamify.js'), P = js('programs.js'), S = js('store.js'), Ex = js('exercises.js'), C = js('calc.js');

let pass = 0, fail = 0;
// Key order is not meaningful, so compare a canonical (sorted-key) form.
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
function eq(name, got, want) {
  const ok = canon(got) === canon(want);
  if (ok) pass++; else { fail++; console.log('FAIL', name, '\n  got ', JSON.stringify(got), '\n  want', JSON.stringify(want)); }
}
function ok(name, cond) { eq(name, !!cond, true); }

/* ---------- dates ---------- */
eq('weekday 2026-10-11 is Sunday', G.weekday('2026-10-11'), 0);
eq('weekday 1970-01-01 Thursday', G.weekday('1970-01-01'), 4);
eq('weekStart of Sunday is the Monday before', G.weekStart('2026-10-11'), '2026-10-05');
eq('weekStart of Monday is itself', G.weekStart('2026-10-05'), '2026-10-05');
// DST: US clocks change 2026-03-08 and 2026-11-01; EU 2026-03-29 / 2026-10-25.
eq('addDays across spring DST', G.addDays('2026-03-07', 2), '2026-03-09');
eq('addDays across fall DST', G.addDays('2026-10-31', 2), '2026-11-02');
eq('weekStart across fall DST', G.weekStart('2026-11-01'), '2026-10-26');
eq('leap day', G.addDays('2028-02-28', 1), '2028-02-29');
eq('year end', G.addDays('2026-12-31', 1), '2027-01-01');
// Every day of 3 years: dayNum is strictly +1 per day and weekStart is a Monday <= the day.
let d = '2025-01-01', prev = G.dayNum(d), bad = 0;
for (let i = 0; i < 1100; i++) {
  const n = G.addDays(d, 1);
  if (G.dayNum(n) !== prev + 1) bad++;
  const ws = G.weekStart(n);
  if (G.weekday(ws) !== 1 || ws > n || G.dayNum(n) - G.dayNum(ws) > 6) bad++;
  d = n; prev = G.dayNum(n);
}
eq('1100-day calendar walk', bad, 0);

/* ---------- helpers to build logs ---------- */
let seq = 0;
const W = (date, ex, extra) => Object.assign({ id: 'w' + (++seq), d: date, st: Date.parse(date + 'T18:00:00'), en: Date.parse(date + 'T19:00:00'), name: 'W', ex: ex }, extra || {});
const lift = (id, sets) => ({ id: id, s: sets.map((x) => ({ w: x[0], r: x[1] })) });
const base = () => { const s = S.defaults(); s.profile.weeklyGoal = 3; return s; };

/* ---------- streaks ---------- */
{
  const s = base();
  // 3 workouts in each of the weeks of Sep 14, Sep 21, Sep 28; only 2 in Oct 5 week so far.
  ['2026-09-14', '2026-09-16', '2026-09-18', '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02', '2026-10-06', '2026-10-08']
    .forEach((x) => s.workouts.push(W(x, [lift('bench', [[60, 8]])])));
  const st = G.streaks(s, '2026-10-11');
  eq('in-progress week does not break streak', st.current, 3);
  eq('this week count', st.thisWeek, 2);
  eq('best', st.best, 3);
  s.workouts.push(W('2026-10-10', [lift('bench', [[60, 8]])]));
  eq('hitting this week extends', G.streaks(s, '2026-10-11').current, 4);
  // Next Monday, with the Oct 5 week hit: still 4 (new week in progress).
  eq('new week still 4', G.streaks(s, '2026-10-12').current, 4);
  // The Monday after a MISSED week: streak gone.
  eq('missed week resets', G.streaks(s, '2026-10-19').current, 0);
  eq('best survives reset', G.streaks(s, '2026-10-19').best, 4);
  // Rest days inside a week never matter: the week count is all that counts.
  s.profile.weeklyGoal = 2;
  eq('goal change rescored', G.streaks(s, '2026-10-11').current, 4);
}

/* ---------- PRs ---------- */
{
  const s = base();
  s.workouts.push(W('2026-09-01', [lift('bench', [[60, 8], [60, 8]])]));
  eq('first session is a baseline, not a PR', G.records(s).events.length, 0);
  s.workouts.push(W('2026-09-03', [lift('bench', [[60, 8], [60, 7]])]));
  eq('equal is not a PR', G.records(s).events.length, 0);
  s.workouts.push(W('2026-09-05', [lift('bench', [[62.5, 8]])]));
  const r = G.records(s);
  eq('heavier set beats e1rm, heaviest and best set', r.events.map((e) => e.kind).sort(), ['e1rm', 'vol', 'w']);
  eq('one set = one PR moment', r.count, 1);
  ok('prev recorded', Math.abs(r.events.find((e) => e.kind === 'w').prev - 60) < 1e-9);
  s.workouts.push(W('2026-09-07', [lift('bench', [[50, 15]])]));
  // 15 reps: past the 12-rep limit, so no e1RM PR; best set vol 750 > 500 is.
  eq('high reps: volume PR only', G.records(s).events.filter((e) => e.d === '2026-09-07').map((e) => e.kind), ['vol']);
  // Bodyweight: reps
  s.workouts.push(W('2026-09-08', [{ id: 'pullup', s: [{ r: 5 }] }]));
  s.workouts.push(W('2026-09-10', [{ id: 'pullup', s: [{ r: 7 }] }]));
  eq('bodyweight rep PR', G.records(s).events.filter((e) => e.ex === 'pullup').map((e) => [e.kind, e.v]), [['r', 7]]);
  // Out-of-order logging (a back-filled older workout) is scored in date order.
  const s2 = base();
  s2.workouts.push(W('2026-09-10', [lift('squat', [[100, 5]])]));
  s2.workouts.push(W('2026-09-01', [lift('squat', [[90, 5]])]));
  eq('sorted by date', G.records(s2).events.map((e) => e.d + ':' + e.kind).sort(), ['2026-09-10:e1rm', '2026-09-10:vol', '2026-09-10:w']);
}

/* ---------- XP + levels ---------- */
{
  eq('level curve', [0, 99, 100, 299, 300, 1000, 4500].map((x) => G.levelFor(x).level), [1, 1, 2, 2, 3, 5, 10]);
  ok('level monotone', (() => { let L = 0; for (let x = 0; x < 200000; x += 37) { const l = G.levelFor(x).level; if (l < L) return false; L = l; } return true; })());
  const w = W('2026-09-01', [lift('bench', [[60, 8], [60, 8], [60, 8]]), { id: 'run', s: [{ min: 30, km: 5 }] }]);
  eq('workout xp = 50 + 3 sets*5 + 30 min*2', G.workoutXp(w), 50 + 15 + 60);
  const big = W('2026-09-01', [lift('bench', Array(60).fill([20, 10]))]);
  eq('set xp capped at 40 sets', G.workoutXp(big), 50 + 40 * 5);
  const s = base();
  s.workouts.push(W('2026-09-14', [lift('bench', [[60, 8]])]), W('2026-09-16', [lift('bench', [[65, 8]])]), W('2026-09-18', [lift('bench', [[60, 8]])]));
  s.daily['2026-09-14'] = { water: 8, protein: 200, sleep: 8, steps: 9000 };
  s.daily['2026-09-15'] = { water: 2 };
  s.body.push({ d: '2026-09-14', w: 80 }, { d: '2026-09-15', w: 79.8 });
  const x = G.totalXp(s, '2026-09-20');
  eq('xp parts', x.parts, { workouts: 3 * 55, prs: 25, checkins: 20, weighIns: 10, weeks: 100, goals: 0, badges: 0 });
  // Deleting a workout takes its XP with it (nothing is a running counter).
  s.workouts.splice(1, 1);
  eq('xp derived, not stored', G.totalXp(s, '2026-09-20').parts, { workouts: 2 * 55, prs: 0, checkins: 20, weighIns: 10, weeks: 0, goals: 0, badges: 0 });
  // Streak bonus grows +10 per consecutive week, capped at +100.
  const s3 = base(); s3.profile.weeklyGoal = 1;
  for (let i = 0; i < 15; i++) s3.workouts.push(W(G.addDays('2026-01-05', 7 * i), []));
  const weeks = G.totalXp(s3, '2026-06-01').parts.weeks;
  let want = 0; for (let i = 0; i < 15; i++) want += 100 + Math.min(i * 10, 100);
  eq('streak bonus schedule', weeks, want);
}

/* ---------- badges ---------- */
{
  const s = base();
  eq('no badges on empty', G.newBadges(s, '2026-10-11'), []);
  s.workouts.push(W('2026-10-10', [lift('bench', [[100, 1]])], { st: Date.parse('2026-10-10T06:15:00') }));
  s.body.push({ d: '2026-10-01', w: 95 });
  const nb = G.newBadges(s, '2026-10-11');
  ok('first workout', nb.indexOf('first-workout') >= 0);
  ok('early bird', nb.indexOf('early') >= 0);
  ok('bodyweight bench (100 >= 95)', nb.indexOf('bench-bw') >= 0);
  ok('no late', nb.indexOf('late') < 0);
  nb.forEach((id) => { s.badges[id] = '2026-10-11'; });
  eq('already-earned badges are not re-awarded', G.newBadges(s, '2026-10-11'), []);
  ok('badge ids unique', new Set(G.BADGES.map((b) => b[0])).size === G.BADGES.length);
  eq('46 badges', G.BADGES.length, 46);
  // A 5 km run and the weekend badge.
  s.workouts.push(W('2026-10-03', [{ id: 'run', s: [{ min: 30, km: 5.02 }] }]), W('2026-10-04', [{ id: 'walk', s: [{ min: 30, km: 3 }] }]));
  const nb2 = G.newBadges(s, '2026-10-11');
  ok('5K finisher', nb2.indexOf('run5k') >= 0);
  ok('weekend warrior (Sat 3rd + Sun 4th)', nb2.indexOf('weekend') >= 0);
  ok('walking 3 km is not a 10K', nb2.indexOf('run10k') < 0);
  const next = G.nextBadges(s, G.summary(s, '2026-10-11'), 3);
  ok('next badges are unearned and sorted', next.length === 3 && next[0].p >= next[1].p && next.every((b) => !s.badges[b.id]));
}

/* ---------- plan generator invariants ---------- */
{
  let checked = 0, problems = [];
  ['lose', 'muscle', 'strength', 'general', 'run'].forEach((goal) => [1, 2, 3, 4, 5, 6, 7].forEach((days) => [30, 45, 60, 75].forEach((minutes) =>
    ['gym', 'home', 'bodyweight'].forEach((equip) => ['beginner', 'intermediate', 'advanced'].forEach((experience) => {
      const p = P.generate({ goal, days, minutes, equip, experience });
      checked++;
      const tag = [goal, days, minutes, equip, experience].join('/');
      if (p.perWeek !== days) problems.push(tag + ' perWeek ' + p.perWeek);
      if (p.schedule.length !== days || new Set(p.schedule).size !== days) problems.push(tag + ' schedule ' + p.schedule);
      if (p.mode === 'cycle' && goal !== 'run' && p.days.length !== days) problems.push(tag + ' days ' + p.days.length);
      const allowed = P.EQUIP_SETS[equip];
      p.days.forEach((day) => {
        if (!day.items.length) problems.push(tag + ' empty day ' + day.name);
        const ids = day.items.map((i) => i.ex);
        if (new Set(ids).size !== ids.length) problems.push(tag + ' duplicate exercise in ' + day.name);
        day.items.forEach((it) => {
          const e = Ex.byId[it.ex];
          if (!e) problems.push(tag + ' unknown ' + it.ex);
          else if (allowed.indexOf(e.equip) < 0) problems.push(tag + ' equipment ' + it.ex + ' (' + e.equip + ')');
          if ((e.type === 'w' || e.type === 'b' || e.type === 't') && !(it.sets >= 1 && it.lo >= 1 && it.hi >= it.lo)) problems.push(tag + ' bad rx ' + JSON.stringify(it));
        });
      });
      if (goal !== 'run') {
        // Each week of a lifting plan trains legs, a push and a pull.
        const pats = new Set();
        p.days.forEach((day) => day.items.forEach((it) => pats.add(Ex.byId[it.ex].pattern)));
        if (days >= 2 && !(pats.has('squat') || pats.has('lunge'))) problems.push(tag + ' no legs');
        if (days >= 2 && !(pats.has('hpush') || pats.has('vpush'))) problems.push(tag + ' no push');
        if (days >= 2 && !(pats.has('hpull') || pats.has('vpull'))) problems.push(tag + ' no pull');
        const n = P.itemCount(minutes);
        p.days.forEach((day) => { if (day.items.length > n) problems.push(tag + ' too many items ' + day.items.length); });
      }
    })))));
  eq('generator problems (' + checked + ' combinations)', problems.slice(0, 10), []);
  const lib = P.library();
  eq('library size', lib.length, 10);
  eq('library keys unique', new Set(lib.map((p) => p.key)).size, 10);
  const c = P.c25k();
  eq('c25k 27 sessions', c.days.length, 27);
  eq('c25k last run is continuous', c.days[26].items[0].ex, 'run');
  eq('c25k first is intervals', c.days[0].items[0].ex, 'run-intervals');
}

/* ---------- exercise library ---------- */
{
  eq('exercise ids unique', new Set(Ex.LIST.map((e) => e.id)).size, Ex.LIST.length);
  ok('120 exercises', Ex.LIST.length >= 120);
  const groups = new Set(Ex.GROUPS.map((g) => g[0]));
  eq('every exercise has a known group and type', Ex.LIST.filter((e) => !groups.has(e.group) || !Ex.TYPE_LABEL[e.type]).map((e) => e.id), []);
  eq('every exercise has cues', Ex.LIST.filter((e) => !e.cues).map((e) => e.id), []);
}

/* ---------- store: encoding, migration, sync ---------- */
{
  const w = { id: 'abc', d: '2026-10-11', st: 1760200000000, en: 1760203600000, name: 'Upper A', plan: 'p1', pday: 0, note: 'felt good',
    ex: [lift('bench', [[102.058, 8], [102.058, 7]]), { id: 'pullup', s: [{ r: 8 }, { r: 6, w: 10 }] }, { id: 'plank', s: [{ t: 60 }] }, { id: 'run', s: [{ min: 31.5, km: 5.012 }] }, { id: 'yoga', s: [{ min: 20 }] }] };
  w.ex[0].s[0].rpe = 8;
  const back = S.decodeWorkout(JSON.parse(JSON.stringify(S.encodeWorkout(w))));
  eq('encode/decode round trip', back, w);
  const plain = { id: 'x', d: '2026-10-11', st: 0, en: 0, name: '', ex: [] };
  eq('round trip with empty fields', S.decodeWorkout(S.encodeWorkout(plain)), plain);
  ok('compact encoding is much smaller', JSON.stringify(S.encodeWorkout(w)).length < JSON.stringify(w).length * 0.7);
  // Size budget: 3 workouts a week for 4 years of 6x3-set sessions fits one blob.
  const s = S.defaults();
  for (let i = 0; i < 624; i++) s.workouts.push({ id: 'k' + i.toString(36) + 'abcdefgh', d: G.addDays('2026-01-01', i * 2), st: 1760200000000 + i, en: 1760203600000 + i, name: 'Full Body A', plan: 'mg8x2k1z', pday: i % 3,
    ex: ['squat', 'bench', 'row', 'lateral-raise', 'plank', 'curl'].map((id) => (id === 'plank' ? { id: id, s: [{ t: 45 }, { t: 50 }, { t: 60 }] } : lift(id, [[102.058, 8], [102.058, 8], [102.058, 7]]))) });
  const parts = S.splitForSync(s);
  const logKB = JSON.stringify(parts.log).length / 1024;
  ok('4 years of training fits the 256 KB log blob (' + logKB.toFixed(0) + ' KB)', logKB < 256);
  // Split + join returns the same state, minus the local-only fields.
  s.active = { id: 'live' }; s.seenVersion = '1.0.0'; s.updated = '2026-10-11T00:00:00.000Z';
  const joined = S.joinFromSync(JSON.parse(JSON.stringify(parts.main)), JSON.parse(JSON.stringify(parts.log)), { active: s.active, seenVersion: 'local' });
  eq('join keeps workouts', joined.workouts.length, 624);
  eq('join keeps local active workout', joined.active, { id: 'live' });
  ok('active never leaves the device', !('active' in parts.main.data));
  eq('migrate fills new fields', Object.keys(S.migrate({ schema: 1, workouts: [] })).sort(), Object.keys(S.defaults()).sort());
  eq('migrate keeps profile values', S.migrate({ profile: { name: 'Sam', units: 'metric' } }).profile.name, 'Sam');
}

/* ---------- store + fake account: last-write-wins, sync-off withdraws ---------- */
async function syncTests() {
  const mem = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
  const server = {};
  const posts = [];
  const account = {
    getUser: async () => ({ authenticated: true, username: 'tester' }),
    loadGameSave: async (slug) => (server[slug] ? JSON.parse(server[slug]) : null),
    saveGameData: async (slug, data) => { posts.push(slug); server[slug] = JSON.stringify(data); return { ok: true }; },
  };
  // Device A logs a workout with sync on.
  const lsA = mem();
  const A = S.createStore(lsA, account); A.load();
  await A.initSync();
  await A.setSync(true);
  A.state.profile.onboarded = true;
  A.state.workouts.push(W('2026-10-11', [lift('bench', [[60, 8]])]));
  A.save();
  await A.push(true);
  eq('both slugs written', Object.keys(server).sort(), ['fit', 'fit-log']);
  // Device B starts empty, turns sync on, gets A's data.
  const B = S.createStore(mem(), account); B.load();
  await B.initSync();
  eq('B pulls', await B.setSync(true), 'pulled');
  eq('B has the workout', B.state.workouts.length, 1);
  // B edits later -> wins over A's older copy.
  await new Promise((r) => setTimeout(r, 5));
  B.state.workouts.push(W('2026-10-12', [lift('squat', [[80, 5]])]));
  B.save(); await B.push(true);
  eq('A pulls newer', await A.pull(), 'pulled');
  eq('A sees 2', A.state.workouts.length, 2);
  // A local-only change (the in-progress workout) does not bump `updated`.
  const before = A.state.updated;
  A.state.active = { id: 'live', ex: [] }; A.save({ local: true });
  eq('local save keeps stamp', A.state.updated, before);
  eq('in sync after local-only change', await A.pull(), 'same');
  // Turning sync off blanks the account copy.
  posts.length = 0;
  await A.setSync(false);
  eq('off posts both', posts.sort(), ['fit', 'fit-log']);
  eq('off empties the log', JSON.parse(server['fit-log']).w, []);
  eq('off empties the data', JSON.parse(server.fit).data, null);
  eq('A keeps its data locally', A.state.workouts.length, 2);
  // The bug the live test caught: a device that only finished onboarding (so its
  // stamp is NEWER than the account's) must adopt the account, not overwrite it.
  for (const k of Object.keys(server)) delete server[k];
  const D1 = S.createStore(mem(), account); D1.load(); await D1.initSync(); await D1.setSync(true);
  D1.state.workouts.push(W('2026-10-01', [lift('bench', [[70, 5]])])); D1.save(); await D1.push(true);
  await new Promise((r) => setTimeout(r, 5));
  const asked = [];
  const D2 = S.createStore(mem(), account, { resolve: async (c) => { asked.push(c); return 'local'; } }); D2.load();
  D2.state.profile.onboarded = true; D2.save();          // newer stamp, no data of its own
  await D2.initSync();
  eq('fresh onboarded device adopts the account', await D2.setSync(true), 'pulled');
  eq('...without asking', asked.length, 0);
  eq('...and gets the workout', D2.state.workouts.length, 1);
  // A device with its own log linking for the first time is asked.
  const D3 = S.createStore(mem(), account, { resolve: async (c) => { asked.push(c); return 'remote'; } }); D3.load();
  D3.state.workouts.push(W('2026-09-01', [])); D3.save();
  await D3.initSync(); await D3.setSync(true);
  eq('first link with own data asks', asked.length === 1 && asked[0].firstLink && asked[0].local.workouts === 1 && asked[0].remote.workouts === 1, true);
  eq('chose remote', D3.state.workouts[0].d, '2026-10-01');
  // Both sides edited since they last agreed: asked again, not silently resolved.
  await new Promise((r) => setTimeout(r, 5));
  D1.state.workouts.push(W('2026-10-02', [])); D1.save(); await D1.push(true);
  await new Promise((r) => setTimeout(r, 5));
  D3.state.workouts.push(W('2026-10-03', [])); D3.save({ local: false });
  await new Promise((r) => setTimeout(r, 5));
  asked.length = 0;
  await D3.pull();
  eq('both changed -> asked', asked.length === 1 && !asked[0].firstLink, true);
  // Only this device changed -> plain upload, no question.
  asked.length = 0;
  D3.state.workouts.push(W('2026-10-04', [])); D3.save(); 
  eq('only local changed -> pushed', await D3.pull(), 'pushed');
  eq('no question', asked.length, 0);

  // An automatic upload from a device that missed another device's write asks
  // instead of overwriting it.
  asked.length = 0;
  D2.state.workouts.push(W('2026-10-05', [])); D2.save();
  await D2.push(true);
  eq('stale auto-push becomes a merge question', asked.length, 1);

  // Signed out: nothing is ever posted.
  posts.length = 0;
  const anon = { getUser: async () => ({ authenticated: false }), loadGameSave: account.loadGameSave, saveGameData: account.saveGameData };
  const Cst = S.createStore(mem(), anon); Cst.load();
  await Cst.initSync(); await Cst.setSync(true);
  Cst.state.workouts.push(W('2026-10-11', [])); Cst.save(); await Cst.push(false);
  eq('signed out uploads nothing', posts, []);
}

syncTests().then(() => {
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.log('CRASH', e); process.exit(1); });
