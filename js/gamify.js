/* SlipFit progress engine: PRs, streaks, XP, levels and achievements.
 *
 * Everything here is DERIVED from the logged data on every call. Nothing is
 * kept as a running counter, so a deleted workout takes its XP with it, two
 * devices syncing the same log can never disagree about your level, and a bug
 * fix here re-scores your whole history correctly. The only stored output is
 * the date each badge was first earned (state.badges), so a badge you earned
 * stays earned. `today` is always passed in so tests can pin the clock.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Ex = node ? require('./exercises.js') : root.FitEx;
  const Calc = node ? require('./calc.js') : root.FitCalc;

  /* ---------- dates (calendar dates as YYYY-MM-DD, no timezone surprises) ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  function ymd(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  // Day number since the epoch for a calendar date. Using UTC means a DST
  // change can never make a day 23 or 25 hours long.
  function dayNum(s) { const p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDayNum(n) { const d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addDays(s, k) { return fromDayNum(dayNum(s) + k); }
  function weekday(s) { return (dayNum(s) + 4) % 7; }             // 1970-01-01 was a Thursday; Sunday = 0
  function weekStart(s) { return addDays(s, -((weekday(s) + 6) % 7)); } // Monday

  /* ---------- per-set helpers ---------- */

  function setsOf(w) { let n = 0; (w.ex || []).forEach((e) => { n += (e.s || []).length; }); return n; }

  function volumeKg(w) {
    let v = 0;
    (w.ex || []).forEach((e) => {
      const t = Ex.get(e.id).type;
      if (t === 'w' || t === 'b') (e.s || []).forEach((s) => { v += (s.w || 0) * (s.r || 0); });
    });
    return v;
  }

  function cardioKm(w) {
    let km = 0;
    (w.ex || []).forEach((e) => { (e.s || []).forEach((s) => { km += s.km || 0; }); });
    return km;
  }

  function cardioMin(w) {
    let m = 0;
    (w.ex || []).forEach((e) => { (e.s || []).forEach((s) => { m += s.min || 0; }); });
    return m;
  }

  function durationMin(w) { return w.st && w.en && w.en > w.st ? (w.en - w.st) / 60000 : 0; }

  function sortedWorkouts(state) {
    return (state.workouts || []).slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.st || 0) - (b.st || 0)));
  }

  /* ---------- personal records ----------
   * Walk the log in order keeping each exercise's bests. The first time an
   * exercise is done sets the baseline -- it is not a PR, otherwise every new
   * exercise would shower you with them. A set beating the baseline is.
   */
  const PR_KINDS = {
    w: [['e1rm', 'Est. 1RM'], ['w', 'Heaviest'], ['vol', 'Best set']],
    b: [['r', 'Most reps'], ['w', 'Heaviest added']],
    t: [['t', 'Longest hold']],
    c: [['km', 'Longest distance'], ['min', 'Longest time']],
    m: [],
  };

  function setValue(kind, s) {
    switch (kind) {
      case 'e1rm': return Calc.estimate1RM(s.w || 0, s.r || 0);
      case 'w': return s.w || 0;
      case 'vol': return (s.w || 0) * (s.r || 0);
      case 'r': return s.r || 0;
      case 't': return s.t || 0;
      case 'km': return s.km || 0;
      case 'min': return s.min || 0;
    }
    return 0;
  }

  function records(state) {
    const best = {};       // exId -> kind -> {v, d, wid}
    const events = [];     // PRs in the order they happened
    sortedWorkouts(state).forEach((w) => {
      (w.ex || []).forEach((e) => {
        const kinds = PR_KINDS[Ex.get(e.id).type] || [];
        const b = best[e.id] || (best[e.id] = {});
        kinds.forEach((k) => {
          let top = 0;
          (e.s || []).forEach((s) => { top = Math.max(top, setValue(k[0], s)); });
          if (!(top > 0)) return;
          const prev = b[k[0]];
          if (prev && top > prev.v + 1e-9) events.push({ wid: w.id, d: w.d, ex: e.id, kind: k[0], label: k[1], v: top, prev: prev.v });
          if (!prev || top > prev.v) b[k[0]] = { v: top, d: w.d, wid: w.id };
        });
      });
    });
    // One heavy set can beat the 1RM, heaviest and best-set records at once.
    // That is one PR moment, so XP and badges count (workout, exercise) pairs.
    const moments = new Set(events.map((e) => e.wid + '|' + e.ex));
    return { best: best, events: events, count: moments.size };
  }

  /* ---------- weeks and streaks ----------
   * A streak counts WEEKS in which you hit your weekly goal, so planned rest
   * days never break it. The week in progress can only extend a streak, never
   * end it: on Monday you have not missed anything yet.
   */
  function weekCounts(state) {
    const m = {};
    (state.workouts || []).forEach((w) => { const k = weekStart(w.d); m[k] = (m[k] || 0) + 1; });
    return m;
  }

  function streaks(state, today) {
    const goal = Math.max(1, (state.profile && state.profile.weeklyGoal) || 3);
    const counts = weekCounts(state);
    const thisWeek = weekStart(today);
    const hit = (wk) => (counts[wk] || 0) >= goal;
    let cur = 0;
    let wk = hit(thisWeek) ? thisWeek : addDays(thisWeek, -7);
    while (hit(wk)) { cur++; wk = addDays(wk, -7); }
    // Best ever: longest run of consecutive hit weeks.
    const hitWeeks = Object.keys(counts).filter(hit).sort();
    let best = 0, run = 0, last = null;
    hitWeeks.forEach((k) => { run = last && dayNum(k) - dayNum(last) === 7 ? run + 1 : 1; best = Math.max(best, run); last = k; });
    return {
      current: cur, best: Math.max(best, cur), goal: goal,
      thisWeek: counts[thisWeek] || 0, weeksHit: hitWeeks.length,
      hitThisWeek: hit(thisWeek), weekStart: thisWeek, hitWeeks: hitWeeks,
    };
  }

  /* ---------- XP ---------- */

  const XP = { workout: 50, set: 5, maxSets: 40, cardioMin: 2, maxCardio: 60, pr: 25, checkin: 5, weighIn: 5, weekHit: 100, streakStep: 10, streakCap: 100, goal: 250, badge: 50 };

  function workoutXp(w) {
    let x = XP.workout;
    let sets = 0, mins = 0;
    (w.ex || []).forEach((e) => {
      const t = Ex.get(e.id).type;
      (e.s || []).forEach((s) => { if (t === 'c' || t === 'm') mins += s.min || 0; else sets++; });
    });
    x += Math.min(sets, XP.maxSets) * XP.set;
    x += Math.min(Math.round(mins), XP.maxCardio) * XP.cardioMin;
    return x;
  }

  function checkinHits(state, day) {
    const c = (state.daily || {})[day];
    if (!c) return 0;
    const p = state.profile || {};
    let n = 0;
    if ((c.water || 0) >= (p.waterGoal || 8)) n++;
    if ((c.protein || 0) >= (p.proteinGoal || 120)) n++;
    if ((c.sleep || 0) >= (p.sleepGoal || 7.5)) n++;
    if ((c.steps || 0) >= (p.stepsGoal || 8000)) n++;
    return n;
  }

  function totalXp(state, today, recs, st) {
    recs = recs || records(state);
    st = st || streaks(state, today);
    const parts = { workouts: 0, prs: 0, checkins: 0, weighIns: 0, weeks: 0, goals: 0, badges: 0 };
    (state.workouts || []).forEach((w) => { parts.workouts += workoutXp(w); });
    parts.prs = recs.count * XP.pr;
    Object.keys(state.daily || {}).forEach((d) => { parts.checkins += checkinHits(state, d) * XP.checkin; });
    const weighDays = new Set((state.body || []).filter((b) => b.w).map((b) => b.d));
    parts.weighIns = weighDays.size * XP.weighIn;
    // Each hit week pays a base plus a bonus for how long the streak had run.
    let run = 0, last = null;
    st.hitWeeks.forEach((k) => {
      run = last && dayNum(k) - dayNum(last) === 7 ? run + 1 : 1; last = k;
      parts.weeks += XP.weekHit + Math.min((run - 1) * XP.streakStep, XP.streakCap);
    });
    parts.goals = (state.goals || []).filter((g) => g.done).length * XP.goal;
    parts.badges = Object.keys(state.badges || {}).length * XP.badge;
    let total = 0;
    Object.keys(parts).forEach((k) => { total += parts[k]; });
    return { total: total, parts: parts };
  }

  // Total XP needed to REACH level L: 50 * L * (L - 1). L2 = 100, L5 = 1000, L10 = 4500.
  function xpForLevel(L) { return 50 * L * (L - 1); }
  function levelFor(xp) {
    let L = 1;
    while (xpForLevel(L + 1) <= xp) L++;
    const lo = xpForLevel(L), hi = xpForLevel(L + 1);
    return { level: L, into: xp - lo, need: hi - lo, next: hi, title: titleFor(L) };
  }
  const TITLES = [[1, 'Rookie'], [3, 'Regular'], [5, 'Grinder'], [8, 'Iron Apprentice'], [12, 'Athlete'],
    [16, 'Iron Veteran'], [20, 'Beast'], [25, 'Titan'], [30, 'Legend'], [40, 'Mythic'], [50, 'Olympian']];
  function titleFor(L) { let t = TITLES[0][1]; TITLES.forEach((x) => { if (L >= x[0]) t = x[1]; }); return t; }

  /* ---------- achievements ---------- */

  function latestBodyweight(state) {
    const b = (state.body || []).filter((x) => x.w).sort((a, c) => (a.d < c.d ? -1 : 1));
    if (b.length) return b[b.length - 1].w;
    return (state.profile && state.profile.weightKg) || 0;
  }

  function summary(state, today) {
    const ws = state.workouts || [];
    const recs = records(state);
    const st = streaks(state, today);
    let volume = 0, km = 0, maxSets = 0, maxDur = 0, early = false, late = false, run5 = false, run10 = false;
    const exSeen = new Set();
    const groupsByWeek = {};
    const weekendWeeks = {};
    ws.forEach((w) => {
      volume += volumeKg(w);
      km += cardioKm(w);
      maxSets = Math.max(maxSets, setsOf(w));
      maxDur = Math.max(maxDur, durationMin(w));
      if (w.st) {
        const h = new Date(w.st).getHours();
        if (h < 7) early = true;
        if (h >= 21) late = true;
      }
      const wk = weekStart(w.d);
      const g = groupsByWeek[wk] || (groupsByWeek[wk] = new Set());
      const wd = weekday(w.d);
      if (wd === 6 || wd === 0) (weekendWeeks[wk] || (weekendWeeks[wk] = new Set())).add(wd);
      (w.ex || []).forEach((e) => {
        const info = Ex.get(e.id);
        exSeen.add(e.id); g.add(info.group);
        if (info.id === 'run' || info.id === 'treadmill' || info.id === 'run-intervals') {
          (e.s || []).forEach((s) => { if ((s.km || 0) >= 5) run5 = true; if ((s.km || 0) >= 10) run10 = true; });
        }
      });
    });
    const allGroups = Ex.GROUPS.length;
    const fullWeek = Object.keys(groupsByWeek).some((k) => groupsByWeek[k].size >= allGroups);
    const weekend = Object.keys(weekendWeeks).some((k) => weekendWeeks[k].size === 2);
    const bw = latestBodyweight(state);
    const e1 = (id) => (recs.best[id] && recs.best[id].e1rm ? recs.best[id].e1rm.v : 0);
    const daily = state.daily || {};
    const p = state.profile || {};
    let waterDays = 0;
    Object.keys(daily).forEach((d) => { if ((daily[d].water || 0) >= (p.waterGoal || 8)) waterDays++; });
    const seqDone = (state.finishedPlans || []).length;
    return {
      workouts: ws.length, prs: recs.count, volume: volume, km: km, maxSets: maxSets, maxDur: maxDur,
      early: early, late: late, run5: run5, run10: run10, exercises: exSeen.size, fullWeek: fullWeek, weekend: weekend,
      streak: st.current, bestStreak: st.best, bw: bw,
      bench: e1('bench'), squat: e1('squat'), dead: e1('deadlift'), ohp: e1('ohp'),
      checkinDays: Object.keys(daily).length, waterDays: waterDays,
      weighIns: new Set((state.body || []).filter((b) => b.w).map((b) => b.d)).size,
      goalsSet: (state.goals || []).length, goalsDone: (state.goals || []).filter((g) => g.done).length,
      plansFinished: seqDone,
      recs: recs, st: st,
    };
  }

  // [id, icon, name, description, test(summary)]
  const BADGES = [
    ['first-workout', '🎯', 'First Rep', 'Log your first workout.', (s) => s.workouts >= 1],
    ['w5', '🔥', 'Warming Up', 'Log 5 workouts.', (s) => s.workouts >= 5],
    ['w10', '💪', 'Habit Forming', 'Log 10 workouts.', (s) => s.workouts >= 10],
    ['w25', '🏋️', 'Committed', 'Log 25 workouts.', (s) => s.workouts >= 25],
    ['w50', '⚡', 'Half Century', 'Log 50 workouts.', (s) => s.workouts >= 50],
    ['w100', '💯', 'Centurion', 'Log 100 workouts.', (s) => s.workouts >= 100],
    ['w200', '🛡️', 'Iron Will', 'Log 200 workouts.', (s) => s.workouts >= 200],
    ['w365', '👑', 'A Year of Sweat', 'Log 365 workouts.', (s) => s.workouts >= 365],
    ['s2', '📅', 'Back Again', 'Hit your weekly goal 2 weeks running.', (s) => s.bestStreak >= 2],
    ['s4', '🗓️', 'One Month Strong', '4-week streak.', (s) => s.bestStreak >= 4],
    ['s8', '🚀', 'Two Months Strong', '8-week streak.', (s) => s.bestStreak >= 8],
    ['s12', '🌟', 'Quarter Year', '12-week streak.', (s) => s.bestStreak >= 12],
    ['s26', '🏔️', 'Half-Year Hero', '26-week streak.', (s) => s.bestStreak >= 26],
    ['s52', '🏆', 'Unbroken Year', '52-week streak.', (s) => s.bestStreak >= 52],
    ['pr1', '📈', 'New Best', 'Set your first personal record.', (s) => s.prs >= 1],
    ['pr10', '🥉', 'Record Breaker', 'Set 10 personal records.', (s) => s.prs >= 10],
    ['pr50', '🥈', 'Always Improving', 'Set 50 personal records.', (s) => s.prs >= 50],
    ['pr100', '🥇', 'PR Machine', 'Set 100 personal records.', (s) => s.prs >= 100],
    ['vol1t', '🧱', 'First Tonne', 'Lift 1,000 kg (2,205 lb) in total.', (s) => s.volume >= 1000],
    ['vol10t', '🚚', 'Ten Tonnes', 'Lift 10,000 kg (22,046 lb) in total.', (s) => s.volume >= 10000],
    ['vol100t', '🐋', 'Blue Whale', 'Lift 100,000 kg in total; about the weight of a blue whale.', (s) => s.volume >= 100000],
    ['vol1m', '🌋', 'Mountain Mover', 'Lift 1,000,000 kg in total.', (s) => s.volume >= 1000000],
    ['km5', '👟', 'First Steps', 'Cover 5 km of cardio in total.', (s) => s.km >= 5],
    ['km42', '🏅', 'Marathon Banked', 'Cover 42.2 km of cardio in total.', (s) => s.km >= 42.195],
    ['km100', '🛣️', 'Century Road', 'Cover 100 km of cardio in total.', (s) => s.km >= 100],
    ['km500', '🌍', 'Long Hauler', 'Cover 500 km of cardio in total.', (s) => s.km >= 500],
    ['run5k', '🏃', '5K Finisher', 'Run 5 km in one go.', (s) => s.run5],
    ['run10k', '🦌', '10K Runner', 'Run 10 km in one go.', (s) => s.run10],
    ['bench-bw', '🛋️', 'Bodyweight Bench', 'Estimated bench 1RM at least your bodyweight.', (s) => s.bw > 0 && s.bench >= s.bw],
    ['squat-15', '🦵', 'Squat 1.5× Bodyweight', 'Estimated squat 1RM at least 1.5× bodyweight.', (s) => s.bw > 0 && s.squat >= 1.5 * s.bw],
    ['dead-2', '🏗️', 'Double-Bodyweight Pull', 'Estimated deadlift 1RM at least 2× bodyweight.', (s) => s.bw > 0 && s.dead >= 2 * s.bw],
    ['ohp-bw', '🙌', 'Overhead Champion', 'Estimated overhead press 1RM at least your bodyweight.', (s) => s.bw > 0 && s.ohp >= s.bw],
    ['early', '🌅', 'Early Bird', 'Start a workout before 7 am.', (s) => s.early],
    ['late', '🌙', 'Night Owl', 'Start a workout after 9 pm.', (s) => s.late],
    ['weekend', '🎉', 'Weekend Warrior', 'Train on both Saturday and Sunday of the same weekend.', (s) => s.weekend],
    ['long', '⏳', 'Marathon Session', 'A workout lasting 90 minutes or more.', (s) => s.maxDur >= 90],
    ['big', '🧮', 'Volume Day', '25 or more sets in one workout.', (s) => s.maxSets >= 25],
    ['variety25', '🎨', 'Explorer', 'Try 25 different exercises.', (s) => s.exercises >= 25],
    ['allgroups', '🧩', 'Total Package', 'Train every muscle group in one week.', (s) => s.fullWeek],
    ['water7', '💧', 'Hydrated', 'Hit your water goal on 7 days.', (s) => s.waterDays >= 7],
    ['checkin30', '📝', 'Daily Tracker', 'Log check-ins on 30 days.', (s) => s.checkinDays >= 30],
    ['weigh10', '⚖️', 'On the Scale', 'Log your weight on 10 days.', (s) => s.weighIns >= 10],
    ['goal-set', '🎯', 'Eyes on the Prize', 'Set your first goal.', (s) => s.goalsSet >= 1],
    ['goal-done', '✅', 'Goal Getter', 'Complete a goal.', (s) => s.goalsDone >= 1],
    ['goal5', '🏁', 'Serial Achiever', 'Complete 5 goals.', (s) => s.goalsDone >= 5],
    ['plan-done', '🎓', 'Program Graduate', 'Finish a whole program like Couch to 5K.', (s) => s.plansFinished >= 1],
  ];

  /* Returns badges newly earned by this state, given the ones already stored.
   * The caller stores them (state.badges[id] = today) and celebrates. Level
   * badges are deliberately absent: XP already includes badge XP, and a badge
   * for reaching a level would feed back into the level it measures. */
  function newBadges(state, today, s) {
    s = s || summary(state, today);
    const have = state.badges || {};
    return BADGES.filter((b) => !have[b[0]] && b[4](s)).map((b) => b[0]);
  }

  /* Closest unearned badges, by a rough progress fraction, for the Today screen. */
  function nextBadges(state, s, n) {
    const have = state.badges || {};
    const frac = {
      w5: s.workouts / 5, w10: s.workouts / 10, w25: s.workouts / 25, w50: s.workouts / 50, w100: s.workouts / 100,
      w200: s.workouts / 200, w365: s.workouts / 365, s2: s.bestStreak / 2, s4: s.bestStreak / 4, s8: s.bestStreak / 8,
      s12: s.bestStreak / 12, s26: s.bestStreak / 26, s52: s.bestStreak / 52, pr1: s.prs, pr10: s.prs / 10, pr50: s.prs / 50,
      pr100: s.prs / 100, vol1t: s.volume / 1000, vol10t: s.volume / 10000, vol100t: s.volume / 100000, vol1m: s.volume / 1e6,
      km5: s.km / 5, km42: s.km / 42.195, km100: s.km / 100, km500: s.km / 500, variety25: s.exercises / 25,
      water7: s.waterDays / 7, checkin30: s.checkinDays / 30, weigh10: s.weighIns / 10,
      'bench-bw': s.bw ? s.bench / s.bw : 0, 'squat-15': s.bw ? s.squat / (1.5 * s.bw) : 0, 'dead-2': s.bw ? s.dead / (2 * s.bw) : 0,
    };
    return BADGES.filter((b) => !have[b[0]] && frac[b[0]] !== undefined && frac[b[0]] < 1)
      .map((b) => ({ id: b[0], icon: b[1], name: b[2], desc: b[3], p: Math.max(0, Math.min(1, frac[b[0]])) }))
      .sort((a, b) => b.p - a.p).slice(0, n || 3);
  }

  const api = {
    ymd, dayNum, fromDayNum, addDays, weekday, weekStart, setsOf, volumeKg, cardioKm, cardioMin, durationMin, sortedWorkouts,
    records, setValue, PR_KINDS, weekCounts, streaks, XP, workoutXp, checkinHits, totalXp, xpForLevel, levelFor, titleFor, TITLES,
    summary, BADGES, newBadges, nextBadges, latestBodyweight,
  };
  if (node) module.exports = api;
  else root.FitGame = api;
})(this);
