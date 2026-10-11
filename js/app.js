/* SlipFit app: routing and every screen. Data rules live in store.js, scoring
 * in gamify.js, maths in calc.js, plans in programs.js -- this file only draws
 * them and turns taps into store.save() calls. */
(function () {
  'use strict';
  const { h, clear, modal, confirmBox, toast, U, fmtInt, fmtDate, relDay, beep, buzz, stepper, field, select, seg, progressBar, ring, download } = window.FitUI;
  const Ex = window.FitEx, Calc = window.FitCalc, P = window.FitPrograms, G = window.FitGame, S = window.FitStore, Charts = window.FitCharts;
  const VERSION = window.FIT_VERSION;

  const store = S.createStore(window.localStorage, window.LabAccount || null, { resolve: syncConflict });

  /* Both this browser and the account changed since they last matched. Never
   * guess with someone's training log: show both and let them choose. */
  function syncConflict(c) {
    return new Promise((resolve) => {
      let done = false;
      const when = (iso) => (iso ? new Date(iso.split('~')[0]).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never');
      const pick = (v) => { done = true; m.close(); resolve(v); };
      const m = modal(c.firstLink ? 'Your account already has SlipFit data' : 'Changes on two devices', h('div',
        h('p', c.firstLink ? 'This browser and your account both hold a training log. Which one should SlipFit keep? The other is replaced.'
          : 'This browser and another device both changed your data since they last synced. Which one should SlipFit keep?'),
        h('div.stat-row', stat(c.remote.workouts, 'workouts in your account (' + when(c.remote.updated) + ')'), stat(c.local.workouts, 'workouts in this browser (' + when(c.local.updated) + ')')),
        h('p.muted.small', 'Not sure? Choose your account copy, then export a backup from this browser first if it matters.')),
      { sticky: true, onClose: () => { if (!done) resolve('cancel'); }, actions: [
        h('button.btn.ghost', { type: 'button', onclick: exportBackup }, '⬇ Back up this browser'),
        h('button.btn.ghost', { type: 'button', onclick: () => pick('local') }, 'Keep this browser\'s'),
        h('button.btn', { type: 'button', onclick: () => pick('remote') }, 'Use my account\'s'),
      ] });
    });
  }
  let state = store.load();
  U.set(state.profile.units);

  const $ = (id) => document.getElementById(id);
  const main = $('main');
  const today = () => G.ymd(new Date());
  let route = 'today';
  let restTick = null;

  function save(opts) { store.save(opts); state = store.state; }

  /* ===================================================================
     Shared derived numbers (recomputed per render -- they are cheap)
     =================================================================== */
  function derived() {
    const t = today();
    const sum = G.summary(state, t);
    const xp = G.totalXp(state, t, sum.recs, sum.st);
    return { t: t, sum: sum, st: sum.st, recs: sum.recs, xp: xp, lvl: G.levelFor(xp.total) };
  }

  /* Award any newly earned badges and finished goals. Called after every save
   * that can change them; returns what was new so the caller can celebrate. */
  function settleRewards(quiet) {
    const t = today();
    const fresh = { badges: [], goals: [] };
    (state.goals || []).forEach((g) => {
      if (g.done) return;
      const pr = goalProgress(g);
      if (pr.frac >= 1) { g.done = t; fresh.goals.push(g); }
    });
    const nb = G.newBadges(state, t);
    nb.forEach((id) => { state.badges[id] = t; fresh.badges.push(id); });
    if (fresh.badges.length || fresh.goals.length) save();
    if (!quiet) {
      fresh.goals.forEach((g) => toast('🎯 Goal complete: ' + goalLabel(g) + ' (+' + G.XP.goal + ' XP)', 'gold', 5000));
      fresh.badges.forEach((id) => { const b = G.BADGES.find((x) => x[0] === id); toast(b[1] + ' Badge earned: ' + b[2], 'gold', 5000); });
    }
    return fresh;
  }

  /* ===================================================================
     Header, nav, router
     =================================================================== */
  const TABS = [['today', 'Today', '🏠'], ['train', 'Train', '🏋️'], ['plans', 'Plans', '🗺️'], ['tools', 'Tools', '🧮'], ['progress', 'Progress', '📈']];

  function renderChrome() {
    const nav = clear($('nav'));
    TABS.forEach((t) => {
      nav.appendChild(h('a.nav-item' + (route === t[0] ? '.on' : ''), { href: '#/' + t[0], 'aria-current': route === t[0] ? 'page' : null },
        h('span.nav-icon', { 'aria-hidden': 'true' }, t[2]), h('span.nav-label', t[1])));
    });
    const d = derived();
    const chip = clear($('level-chip'));
    chip.appendChild(h('span.lvl', 'Lv ' + d.lvl.level));
    chip.appendChild(h('span.lvl-bar', h('span', { style: { width: Math.round(d.lvl.into / d.lvl.need * 100) + '%' } })));
    chip.appendChild(h('span.streak', { title: 'Weekly streak' }, '🔥 ' + d.st.current));
    chip.title = d.lvl.title + ' · ' + fmtInt(d.xp.total) + ' XP';
    $('active-pill').hidden = !state.active || route === 'train';
  }

  function go(r) { if (location.hash !== '#/' + r) location.hash = '#/' + r; else render(); }

  function render() {
    const r = (location.hash.replace(/^#\/?/, '') || 'today').split('/')[0];
    route = ['today', 'train', 'plans', 'tools', 'progress', 'me'].indexOf(r) >= 0 ? r : 'today';
    if (!state.profile.onboarded && route !== 'me') { renderChrome(); return onboarding(); }
    clear(main);
    ({ today: screenToday, train: screenTrain, plans: screenPlans, tools: screenTools, progress: screenProgress, me: screenMe })[route]();
    renderChrome();
    document.title = (route === 'today' ? '' : TABS.concat([['me', 'Me']]).find((t) => t[0] === route)[1] + ' · ') + 'SlipFit';
    main.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  /* ===================================================================
     Onboarding
     =================================================================== */
  function onboarding() {
    clear(main);
    const p = Object.assign({}, state.profile);
    const age0 = new Date().getFullYear() - p.birthYear;
    const draft = { units: p.units, name: p.name, sex: p.sex, age: age0, heightCm: p.heightCm, weightKg: p.weightKg,
      goal: p.goal, experience: p.experience, equip: p.equip, days: p.weeklyGoal, minutes: p.minutes };
    let step = 0;
    const box = h('div.onboard');
    main.appendChild(box);

    const steps = [
      () => [
        h('div.hero-emoji', '💪'),
        h('h1', 'Welcome to SlipFit'),
        h('p.lead', 'Your plan, your log, your progress, and a reason to show up. Answer a few questions and SlipFit builds a plan around you.'),
        field('What should we call you?', h('input', { type: 'text', value: draft.name, maxlength: 40, placeholder: 'Name (optional)', oninput: (e) => { draft.name = e.target.value; } })),
        field('Units', seg([['imperial', 'lb / mi / in'], ['metric', 'kg / km / cm']], draft.units, (v) => { draft.units = v; U.set(v); }, 'Units')),
      ],
      () => {
        const metricH = U.metric;
        const hIn = Math.round(Calc.cmToIn(draft.heightCm));
        return [
          h('h1', 'About you'),
          h('p.lead', 'Used for calorie targets and calculators. It stays on your device.'),
          field('Sex (for the formulas)', seg([['m', 'Male'], ['f', 'Female']], draft.sex, (v) => { draft.sex = v; }, 'Sex')),
          field('Age', stepper(draft.age, 1, (v) => { draft.age = parseInt(v, 10) || draft.age; }, { label: 'Age', min: 13 })),
          metricH ? field('Height (cm)', stepper(Math.round(draft.heightCm), 1, (v) => { draft.heightCm = parseFloat(v) || draft.heightCm; }, { label: 'Height cm' }))
            : h('div.row2',
              field('Height (ft)', stepper(Math.floor(hIn / 12), 1, (v) => { const ft = parseInt(v, 10) || 0; const inch = Math.round(Calc.cmToIn(draft.heightCm)) % 12; draft.heightCm = Calc.inToCm(ft * 12 + inch); }, { label: 'Feet' })),
              field('(in)', stepper(hIn % 12, 1, (v) => { const ft = Math.floor(Math.round(Calc.cmToIn(draft.heightCm)) / 12); draft.heightCm = Calc.inToCm(ft * 12 + Math.min(11, parseInt(v, 10) || 0)); }, { label: 'Inches' }))),
          field('Weight (' + U.wUnit() + ')', stepper(U.w(draft.weightKg, 0), 1, (v) => { const k = U.wIn(v); if (k) draft.weightKg = k; }, { label: 'Weight' })),
        ];
      },
      () => [
        h('h1', 'Your goal'),
        h('div.choice-grid', [['lose', '🔥', 'Lose fat'], ['muscle', '💪', 'Build muscle'], ['strength', '🏋️', 'Get stronger'], ['general', '❤️', 'Get fit & healthy'], ['run', '🏃', 'Start running']].map((g) =>
          h('button.choice' + (draft.goal === g[0] ? '.on' : ''), { type: 'button', onclick: (e) => { draft.goal = g[0]; box.querySelectorAll('.choice').forEach((c) => c.classList.remove('on')); e.currentTarget.classList.add('on'); } },
            h('span.choice-icon', g[1]), g[2]))),
        field('Experience', seg([['beginner', 'New'], ['intermediate', 'Some'], ['advanced', 'Lots']], draft.experience, (v) => { draft.experience = v; }, 'Experience')),
      ],
      () => [
        h('h1', 'Your week'),
        field('Where do you train?', seg([['gym', 'Gym'], ['home', 'Home (weights)'], ['bodyweight', 'No equipment']], draft.equip, (v) => { draft.equip = v; }, 'Equipment')),
        field('Days per week', seg([[2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], draft.days, (v) => { draft.days = +v; }, 'Days per week')),
        field('Minutes per session', seg([[30, '30'], [45, '45'], [60, '60'], [75, '75+']], draft.minutes, (v) => { draft.minutes = +v; }, 'Minutes')),
      ],
      () => {
        const plan = P.generate({ goal: draft.goal, days: draft.days, minutes: draft.minutes, equip: draft.equip, experience: draft.experience });
        draft.plan = plan;
        return [
          h('h1', 'Your plan is ready'),
          planPreview(plan),
          h('p.hint', 'You can change it any time in Plans, or pick one of the built-in programs instead.'),
        ];
      },
    ];

    function draw() {
      clear(box);
      box.appendChild(h('div.dots', steps.map((_, i) => h('span' + (i === step ? '.on' : '')))));
      box.appendChild(h('div.card.onboard-card', steps[step]()));
      const last = step === steps.length - 1;
      box.appendChild(h('div.onboard-actions',
        step ? h('button.btn.ghost', { type: 'button', onclick: () => { step--; draw(); } }, 'Back') : h('button.btn.ghost', { type: 'button', onclick: finish.bind(null, false) }, 'Skip'),
        h('button.btn.big', { type: 'button', onclick: () => { if (last) finish(true); else { step++; draw(); window.scrollTo(0, 0); } } }, last ? 'Start my plan' : 'Next')));
    }

    function finish(withPlan) {
      const pr = state.profile;
      Object.assign(pr, { name: draft.name.trim(), units: draft.units, sex: draft.sex, birthYear: new Date().getFullYear() - draft.age,
        heightCm: draft.heightCm, weightKg: draft.weightKg, goal: draft.goal, experience: draft.experience, equip: draft.equip,
        weeklyGoal: draft.days, minutes: draft.minutes, onboarded: true });
      pr.proteinGoal = Math.round(Calc.GOAL_PROTEIN[draft.goal === 'lose' ? 'lose' : draft.goal === 'muscle' || draft.goal === 'strength' ? 'gain' : 'keep'] * draft.weightKg / 5) * 5;
      if (!state.body.some((b) => b.w)) state.body.push({ d: today(), w: Math.round(draft.weightKg * 1000) / 1000 });
      if (withPlan && draft.plan) startPlan(draft.plan, true);
      state.seenVersion = VERSION;
      save();
      settleRewards(true);
      toast('Welcome' + (pr.name ? ', ' + pr.name : '') + '! Let\'s get to work.', 'good');
      go('today');
    }
    draw();
  }

  function planPreview(plan, compact) {
    return h('div.plan-preview',
      h('div.plan-title', h('strong', plan.name), h('span.muted', plan.mode === 'sequence' ? plan.days.length + ' sessions' : plan.perWeek + ' days / week')),
      h('p', plan.desc),
      compact ? null : h('div.plan-days', plan.days.slice(0, plan.mode === 'sequence' ? 3 : 7).map((d) =>
        h('details.plan-day', h('summary', d.name, h('span.muted', ' · ' + d.items.length + ' exercise' + (d.items.length === 1 ? '' : 's'))),
          h('ul', d.items.map((it) => h('li', Ex.get(it.ex).name, h('span.muted', ' ' + rxText(it)))))))),
      plan.mode === 'sequence' && !compact ? h('p.muted', '…and ' + (plan.days.length - 3) + ' more sessions.') : null);
  }

  function rxText(it) {
    const t = Ex.get(it.ex).type;
    if (t === 'c' || t === 'm' || it.min) return (it.min ? it.min + ' min' : '') + (it.note ? ' · ' + it.note : '');
    const reps = it.lo === it.hi ? it.lo : it.lo + '–' + it.hi;
    return it.sets + ' × ' + reps + (t === 't' ? ' s' : '') + (it.note ? ' · ' + it.note : '');
  }

  /* ===================================================================
     Plan pointer
     =================================================================== */
  function startPlan(plan, quiet) {
    const p = JSON.parse(JSON.stringify(plan));
    p.id = S.uid();
    p.started = today();
    state.plan = p;
    state.planOffset = 0;
    state.profile.weeklyGoal = Math.min(7, Math.max(1, p.perWeek || state.profile.weeklyGoal));
    if (!quiet) toast('Plan started: ' + p.name, 'good');
  }

  function planDone() {
    if (!state.plan) return 0;
    return state.workouts.filter((w) => w.plan === state.plan.id).length + (state.planOffset || 0);
  }

  function nextPlanDay() {
    const p = state.plan;
    if (!p || !p.days.length) return null;
    const n = planDone();
    if (p.mode === 'sequence') return n < p.days.length ? { idx: n, day: p.days[n] } : null;
    return { idx: n % p.days.length, day: p.days[n % p.days.length] };
  }

  function nextScheduledDate(fromDay) {
    const p = state.plan;
    if (!p || !p.schedule || !p.schedule.length) return null;
    for (let k = 0; k < 8; k++) { const d = G.addDays(fromDay, k); if (p.schedule.indexOf(G.weekday(d)) >= 0) return d; }
    return null;
  }

  /* ===================================================================
     TODAY
     =================================================================== */
  function screenToday() {
    const d = derived();
    const t = d.t;
    const name = state.profile.name;
    const hr = new Date().getHours();
    const greet = (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + (name ? ', ' + name : '');
    main.appendChild(h('header.page-head', h('h1', greet), h('p.muted', fmtDate(t, { weekday: 'long', month: 'long', day: 'numeric' }))));

    // ---- hero: what to do today ----
    const doneToday = state.workouts.filter((w) => w.d === t);
    const next = nextPlanDay();
    const scheduled = state.plan && state.plan.schedule.indexOf(G.weekday(t)) >= 0;
    let hero;
    if (state.active) {
      hero = h('div.card.hero.live', h('div.hero-kicker', 'In progress'), h('h2', state.active.name),
        h('p', setsDone(state.active) + ' sets done · started ' + new Date(state.active.st).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })),
        h('button.btn.big', { type: 'button', onclick: () => go('train') }, 'Resume workout'));
    } else if (doneToday.length) {
      const w = doneToday[doneToday.length - 1];
      hero = h('div.card.hero.done', h('div.hero-kicker', '✓ Done for today'), h('h2', w.name),
        h('p', G.setsOf(w) + ' sets · ' + Math.round(G.durationMin(w)) + ' min · +' + G.workoutXp(w) + ' XP'),
        h('p.muted', motivation(d, 'done')),
        h('div.btn-row', h('button.btn.ghost', { type: 'button', onclick: () => showWorkout(w) }, 'View'),
          h('button.btn.ghost', { type: 'button', onclick: () => pickWorkout() }, 'Train again')));
    } else if (state.plan && !next) {
      hero = h('div.card.hero', h('div.hero-kicker', '🎓 Program complete'), h('h2', state.plan.name),
        h('p', 'You finished every session. Pick your next challenge.'),
        h('button.btn.big', { type: 'button', onclick: () => go('plans') }, 'Choose a new plan'));
    } else if (next && scheduled) {
      hero = h('div.card.hero', h('div.hero-kicker', 'Today\'s session' + (state.plan.mode === 'sequence' ? ' · ' + (next.idx + 1) + ' of ' + state.plan.days.length : '')),
        h('h2', next.day.name),
        h('ul.hero-list', next.day.items.slice(0, 6).map((it) => h('li', Ex.get(it.ex).name, h('span.muted', ' ' + rxText(it).split(' · ')[0])))),
        h('p.muted', motivation(d, 'go')),
        h('button.btn.big', { type: 'button', onclick: () => startWorkout(fromPlanDay(next)) }, 'Start workout'),
        h('button.link-btn', { type: 'button', onclick: () => pickWorkout() }, 'Do something else'));
    } else if (next) {
      const nd = nextScheduledDate(G.addDays(t, 1));
      hero = h('div.card.hero.rest', h('div.hero-kicker', '😌 Rest day'),
        h('h2', 'Recover and come back stronger'),
        h('p', 'Next up: ', h('strong', next.day.name), nd ? ' on ' + fmtDate(nd, { weekday: 'long' }) : ''),
        h('p.muted', 'Rest days never break your streak. A walk or the mobility routine still earns XP.'),
        h('div.btn-row', h('button.btn', { type: 'button', onclick: () => startWorkout(fromPlanDay(next)) }, 'Train anyway'),
          h('button.btn.ghost', { type: 'button', onclick: () => pickWorkout() }, 'Something lighter')));
    } else {
      hero = h('div.card.hero', h('div.hero-kicker', 'No plan yet'), h('h2', 'Pick a plan and SlipFit tells you what to do each day'),
        h('div.btn-row', h('button.btn.big', { type: 'button', onclick: () => go('plans') }, 'Choose a plan'),
          h('button.btn.ghost', { type: 'button', onclick: () => startWorkout(emptyWorkout()) }, 'Quick workout')));
    }
    main.appendChild(hero);

    // ---- week + level ----
    const goal = d.st.goal;
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const day = G.addDays(d.st.weekStart, i);
      const did = state.workouts.some((w) => w.d === day);
      const plan = state.plan && state.plan.schedule.indexOf(G.weekday(day)) >= 0;
      weekDays.push(h('div.wk-day' + (did ? '.did' : '') + (day === t ? '.today' : '') + (plan ? '.planned' : ''), { title: fmtDate(day) },
        h('span', 'MTWTFSS'[i]), h('i', did ? '✓' : plan ? '•' : '')));
    }
    main.appendChild(h('div.grid2',
      h('div.card.week-card',
        h('div.card-title', 'This week'),
        h('div.week-row', ring(d.st.thisWeek / goal, d.st.thisWeek + '/' + goal, 'workouts'),
          h('div.week-meta',
            h('div.big-stat', '🔥 ' + d.st.current, h('small', ' week streak')),
            h('div.muted', d.st.hitThisWeek ? 'Goal hit. Streak safe for this week.' : (goal - d.st.thisWeek) + ' more to keep the streak alive.'),
            h('div.muted', 'Best: ' + d.st.best + ' weeks'))),
        h('div.week-days', weekDays)),
      h('div.card.level-card',
        h('div.card-title', 'Level ' + d.lvl.level + ' · ' + d.lvl.title),
        h('div.big-stat', fmtInt(d.xp.total), h('small', ' XP')),
        progressBar(d.lvl.into / d.lvl.need, 'xp'),
        h('div.muted', fmtInt(d.lvl.need - d.lvl.into) + ' XP to level ' + (d.lvl.level + 1) + ' (' + G.titleFor(d.lvl.level + 1) + ')'),
        h('div.xp-legend', 'Workout +50 · each set +5 · PR +25 · weekly goal +100 · check-ins +5'))));

    // ---- daily check-in ----
    main.appendChild(checkinCard(t));

    // ---- goals + badges ----
    const activeGoals = state.goals.filter((g) => !g.done);
    main.appendChild(h('div.grid2',
      h('div.card',
        h('div.card-title', 'Goals', h('button.link-btn', { type: 'button', onclick: () => goalEditor() }, '+ Add')),
        activeGoals.length ? activeGoals.slice(0, 4).map(goalRow) : h('p.muted', 'Set a target with a date (a weight, a lift, a 5K) and SlipFit projects when you\'ll hit it.')),
      h('div.card',
        h('div.card-title', 'Next badges', h('a.link-btn', { href: '#/progress' }, 'All')),
        G.nextBadges(state, d.sum, 3).map((b) => h('div.badge-next', h('span.badge-icon', b.icon),
          h('div.grow', h('strong', b.name), h('div.muted', b.desc), progressBar(b.p)))))));

    // ---- recent PRs ----
    const prs = d.recs.events.slice(-5).reverse();
    if (prs.length) {
      main.appendChild(h('div.card', h('div.card-title', 'Recent personal records'),
        h('ul.pr-list', prs.map((e) => h('li', h('span.pr-tag', 'PR'), h('strong', Ex.get(e.ex).name), ' ' + e.label + ': ' + prValue(e.ex, e.kind, e.v), h('span.muted', ' · ' + relDay(e.d, t)))))));
    }
  }

  function motivation(d, kind) {
    const lines = kind === 'done'
      ? ['That\'s the work. Recovery is where it turns into progress.', 'Another brick in the wall.', 'Future you says thanks.', 'Consistency beats intensity, and you just proved it.']
      : ['Show up, do the work, go home. That\'s the whole secret.', 'The hardest rep is walking in the door.', 'You don\'t need motivation, you need a plan. Here it is.',
        'Small sessions add up to big changes.', 'Beat last time by one rep. That\'s all.'];
    if (kind === 'go' && d.st.goal - d.st.thisWeek === 1 && !d.st.hitThisWeek) return 'This one hits your weekly goal and keeps your 🔥 streak alive.';
    return lines[(G.dayNum(d.t) + (kind === 'done' ? 1 : 0)) % lines.length];
  }

  function prValue(exId, kind, v) {
    if (kind === 'e1rm' || kind === 'w' || kind === 'vol') return U.wFmt(v, kind === 'vol' ? 0 : 1);
    if (kind === 'r') return v + ' reps';
    if (kind === 't') return v + ' s';
    if (kind === 'km') return U.dFmt(v);
    if (kind === 'min') return Math.round(v) + ' min';
    return String(v);
  }

  /* ---------- check-ins ---------- */
  function checkinCard(day) {
    const c = state.daily[day] || {};
    const p = state.profile;
    const set = (k, v) => {
      const cur = state.daily[day] || (state.daily[day] = {});
      if (v === '' || v === null || !isFinite(v)) delete cur[k]; else cur[k] = Math.max(0, v);
      if (!Object.keys(cur).length) delete state.daily[day];
      save(); settleRewards(); renderChrome();
      redraw();
    };
    const card = h('div.card.checkin');
    function redraw() {
      const cc = state.daily[day] || {};
      clear(card);
      card.appendChild(h('div.card-title', 'Daily check-in', h('span.muted', G.checkinHits(state, day) + '/4 targets · +5 XP each')));
      const tile = (icon, label, key, value, goal, unit, stepAmt, fmt) => h('div.ci' + ((value || 0) >= goal ? '.hit' : ''),
        h('div.ci-top', h('span.ci-icon', icon), h('span', label), (value || 0) >= goal ? h('span.ci-check', '✓') : null),
        h('div.ci-val', fmt ? fmt(value || 0) : (value || 0), h('small', ' / ' + (fmt ? fmt(goal) : goal) + ' ' + unit)),
        progressBar((value || 0) / goal),
        h('div.ci-btns', h('button.step', { type: 'button', 'aria-label': 'less ' + label, onclick: () => set(key, Math.max(0, (value || 0) - stepAmt)) }, '−'),
          h('button.step.plus', { type: 'button', 'aria-label': 'more ' + label, onclick: () => set(key, (value || 0) + stepAmt) }, '+' + (key === 'water' ? '' : stepAmt))));
      card.appendChild(h('div.ci-grid',
        tile('💧', 'Water', 'water', cc.water, p.waterGoal, 'glasses', 1),
        tile('🍗', 'Protein', 'protein', cc.protein, p.proteinGoal, 'g', 10),
        tile('😴', 'Sleep', 'sleep', cc.sleep, p.sleepGoal, 'h', 0.5),
        h('div.ci' + ((cc.steps || 0) >= p.stepsGoal ? '.hit' : ''),
          h('div.ci-top', h('span.ci-icon', '👟'), h('span', 'Steps'), (cc.steps || 0) >= p.stepsGoal ? h('span.ci-check', '✓') : null),
          h('div.ci-val', fmtInt(cc.steps || 0), h('small', ' / ' + fmtInt(p.stepsGoal))),
          progressBar((cc.steps || 0) / p.stepsGoal),
          h('div.ci-btns', h('input.num.steps-in', { type: 'number', inputmode: 'numeric', placeholder: 'Steps', 'aria-label': 'Steps today', value: cc.steps || '',
            onchange: (e) => set('steps', parseInt(e.target.value, 10)) })))));
    }
    redraw();
    return card;
  }

  /* ===================================================================
     TRAIN: starting, logging and finishing workouts
     =================================================================== */
  function emptyWorkout(name) { return { id: S.uid(), d: today(), st: Date.now(), name: name || 'Workout', ex: [] }; }

  function lastSetsFor(exId, beforeId) {
    for (let i = state.workouts.length - 1; i >= 0; i--) {
      const w = state.workouts[i];
      if (w.id === beforeId) continue;
      const e = (w.ex || []).find((x) => x.id === exId);
      if (e && e.s && e.s.length) return { sets: e.s, d: w.d };
    }
    return null;
  }

  /* Double progression: keep the weight and add reps until every set reaches
   * the top of the range, then add weight and drop back to the bottom. */
  function suggest(it) {
    const info = Ex.get(it.ex);
    const last = lastSetsFor(it.ex);
    const n = it.sets || 3;
    const rows = [];
    if (info.type === 'c' || info.type === 'm') {
      const prev = last && last.sets[0];
      rows.push({ min: it.min || (prev && prev.min) || 20, km: info.type === 'c' && prev ? prev.km : undefined });
      return { rows: rows, tip: it.note || '' };
    }
    if (info.type === 't') {
      const best = last ? Math.max.apply(null, last.sets.map((s) => s.t || 0)) : 0;
      for (let i = 0; i < n; i++) rows.push({ t: best ? Math.min((it.hi || 60), best + 5) : (it.lo || 30) });
      return { rows: rows, tip: best ? 'Last time: ' + best + ' s. Try ' + rows[0].t + ' s.' : '' };
    }
    const lo = it.lo || 8, hi = it.hi || 12;
    if (!last) {
      for (let i = 0; i < n; i++) rows.push({ w: undefined, r: lo });
      return { rows: rows, tip: info.type === 'w' ? 'First time: pick a weight you could lift ' + (hi + 2) + ' times, and log what you do.' : '' };
    }
    const work = last.sets;
    const lastW = Math.max.apply(null, work.map((s) => s.w || 0));
    const topSets = work.filter((s) => (s.w || 0) >= lastW - 1e-9);
    const allTop = topSets.length >= Math.min(n, work.length) && topSets.every((s) => (s.r || 0) >= hi);
    let w = lastW || undefined, r, tip;
    if (allTop && info.type === 'w') {
      const lower = ['squat', 'hinge', 'lunge', 'glute'].indexOf(info.pattern) >= 0;
      const incD = U.inc(lower, info.equip);
      w = U.wIn(parseFloat(U.w(lastW)) + incD);
      r = lo;
      tip = '⬆️ You hit ' + hi + ' reps on every set last time. Add ' + incD + ' ' + U.wUnit() + '.';
    } else if (allTop) {
      r = hi + 1;
      tip = '⬆️ Top of the range last time. Go for ' + r + ', or add weight or a harder variation.';
    } else {
      const minR = Math.min.apply(null, topSets.map((s) => s.r || 0));
      r = Math.max(lo, Math.min(hi, minR + 1));
      tip = 'Beat last time: aim for ' + r + ' reps' + (w ? ' at ' + U.wFmt(w) : '') + '.';
    }
    for (let i = 0; i < n; i++) rows.push({ w: w, r: r });
    return { rows: rows, tip: tip };
  }

  function fromPlanDay(next) {
    const w = emptyWorkout(next.day.name);
    w.plan = state.plan.id; w.pday = next.idx;
    w.ex = next.day.items.map((it) => {
      const sg = suggest(it);
      return { id: it.ex, s: sg.rows, target: { sets: it.sets, lo: it.lo, hi: it.hi, rest: it.rest, min: it.min, note: it.note }, tip: sg.tip };
    });
    return w;
  }

  function fromTemplate(tpl) {
    const w = emptyWorkout(tpl.name);
    w.ex = tpl.items.map((it) => { const sg = suggest(it); return { id: it.ex, s: sg.rows, target: it, tip: sg.tip }; });
    return w;
  }

  function startWorkout(w) {
    if (state.active) { toast('Finish or discard the workout in progress first.', 'warn'); go('train'); return; }
    state.active = w;
    save({ local: true });
    go('train');
  }

  function setsDone(w) { let n = 0; (w.ex || []).forEach((e) => (e.s || []).forEach((s) => { if (s.done) n++; })); return n; }

  function pickWorkout() {
    const body = h('div.pick-list');
    const m = modal('Start a workout', body);
    const add = (title, sub, fn) => body.appendChild(h('button.pick', { type: 'button', onclick: () => { m.close(); fn(); } }, h('strong', title), sub ? h('span.muted', sub) : null));
    add('Empty workout', 'Add exercises as you go', () => startWorkout(emptyWorkout()));
    if (state.plan) {
      const nx = nextPlanDay();
      state.plan.days.forEach((d, i) => {
        if (state.plan.mode === 'sequence' && nx && Math.abs(i - nx.idx) > 2) return;
        add(d.name + (nx && nx.idx === i ? ' (next up)' : ''), state.plan.name, () => startWorkout(fromPlanDay({ idx: i, day: d })));
      });
    }
    state.templates.forEach((tpl) => add(tpl.name, 'Template · ' + tpl.items.length + ' exercises', () => startWorkout(fromTemplate(tpl))));
    add('Mobility & stretch', '15 min, recovery day favourite', () => startWorkout(fromTemplate({ name: 'Mobility', items: [{ ex: 'foam-roll', sets: 1, min: 5 }, { ex: 'stretch', sets: 1, min: 10 }] })));
    add('Walk or run', 'Log some cardio', () => startWorkout(fromTemplate({ name: 'Cardio', items: [{ ex: 'walk', sets: 1, min: 30 }] })));
  }

  function screenTrain() {
    if (state.active) return activeWorkout();
    main.appendChild(h('header.page-head', h('h1', 'Train'), h('p.muted', 'Start a session, or look back at what you\'ve done.')));
    const nx = nextPlanDay();
    main.appendChild(h('div.card.hero',
      h('div.hero-kicker', nx ? 'Next in your plan' : 'Ready when you are'),
      h('h2', nx ? nx.day.name : 'Start a workout'),
      h('div.btn-row',
        nx ? h('button.btn.big', { type: 'button', onclick: () => startWorkout(fromPlanDay(nx)) }, 'Start ' + nx.day.name) : null,
        h('button.btn' + (nx ? '.ghost' : '.big'), { type: 'button', onclick: pickWorkout }, nx ? 'Other workout' : 'Choose workout'))));

    if (state.templates.length) {
      main.appendChild(h('div.card', h('div.card-title', 'Your templates'),
        state.templates.map((tpl, i) => h('div.list-row',
          h('div.grow', h('strong', tpl.name), h('div.muted', tpl.items.map((it) => Ex.get(it.ex).name).join(', '))),
          h('button.btn.small', { type: 'button', onclick: () => startWorkout(fromTemplate(tpl)) }, 'Start'),
          h('button.icon-btn', { type: 'button', 'aria-label': 'Delete template', onclick: async () => {
            if (await confirmBox('Delete template?', 'Delete "' + tpl.name + '"? Your logged workouts are not affected.', 'Delete', true)) { state.templates.splice(i, 1); save(); render(); }
          } }, '🗑')))));
    }

    const hist = G.sortedWorkouts(state).reverse();
    const t = today();
    const list = h('div.card', h('div.card-title', 'History', h('span.muted', hist.length + ' workout' + (hist.length === 1 ? '' : 's'))));
    if (!hist.length) list.appendChild(h('p.muted', 'Nothing logged yet. Your first workout earns the 🎯 First Rep badge.'));
    let shown = 0;
    const more = h('button.btn.ghost.small', { type: 'button' }, 'Show more');
    const addRows = () => {
      hist.slice(shown, shown + 20).forEach((w) => {
        list.insertBefore(h('button.hist-row', { type: 'button', onclick: () => showWorkout(w) },
          h('div.grow', h('strong', w.name), h('div.muted', relDay(w.d, t) + ' · ' + w.ex.map((e) => Ex.get(e.id).name).slice(0, 3).join(', ') + (w.ex.length > 3 ? '…' : ''))),
          h('div.hist-stats', h('span', G.setsOf(w) + ' sets'), w.st && w.en ? h('span.muted', Math.round(G.durationMin(w)) + ' min') : null)), more);
      });
      shown += 20;
      more.hidden = shown >= hist.length;
    };
    list.appendChild(more);
    more.addEventListener('click', addRows);
    addRows();
    main.appendChild(list);
    main.appendChild(h('div.card', h('div.card-title', 'Exercise library'), h('p.muted', Ex.LIST.length + ' exercises with how-to cues.'),
      h('button.btn.ghost', { type: 'button', onclick: () => exercisePicker(null, true) }, 'Browse exercises')));
  }

  function showWorkout(w) {
    const recs = G.records(state);
    const prs = recs.events.filter((e) => e.wid === w.id);
    const body = h('div',
      h('p.muted', fmtDate(w.d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (w.st && w.en ? ' · ' + Math.round(G.durationMin(w)) + ' min' : '')),
      h('div.stat-row', stat(G.setsOf(w), 'sets'), stat(U.w(G.volumeKg(w), 0), U.wUnit() + ' volume'), stat('+' + G.workoutXp(w), 'XP')),
      w.ex.map((e) => {
        const info = Ex.get(e.id);
        return h('div.hist-ex', h('strong', info.name), h('ol.set-list', e.s.map((s) => h('li', setText(info, s)))),
          prs.filter((p) => p.ex === e.id).map((p) => h('div.pr-line', h('span.pr-tag', 'PR'), p.label + ': ' + prValue(e.id, p.kind, p.v))));
      }),
      w.note ? h('p.note', w.note) : null);
    const m = modal(w.name, body, { actions: [
      h('button.btn.ghost.danger', { type: 'button', onclick: async () => {
        if (await confirmBox('Delete workout?', 'This removes the workout and any XP, PRs and streak weeks it earned.', 'Delete', true)) {
          state.workouts = state.workouts.filter((x) => x.id !== w.id); save(); m.close(); render(); toast('Workout deleted.');
        }
      } }, 'Delete'),
      h('button.btn.ghost', { type: 'button', onclick: () => { m.close(); saveTemplate(w); } }, 'Save as template'),
      h('button.btn', { type: 'button', onclick: () => {
        if (state.active) { toast('Finish the workout in progress first.', 'warn'); return; }
        m.close();
        const copy = JSON.parse(JSON.stringify(w));
        copy.editing = true;
        copy.ex.forEach((e) => e.s.forEach((s) => { s.done = true; }));
        state.active = copy; save({ local: true }); go('train');
      } }, 'Edit'),
    ] });
  }

  function setText(info, s) {
    if (info.type === 'c') return (s.min ? s.min + ' min' : '') + (s.km ? ' · ' + U.dFmt(s.km) : '') + (s.min && s.km ? ' · ' + Calc.fmtDuration(s.min * 60 / parseFloat(U.d(s.km, 4))) + '/' + U.dUnit() : '');
    if (info.type === 'm') return (s.min || 0) + ' min';
    if (info.type === 't') return (s.t || 0) + ' s' + (s.w ? ' @ ' + U.wFmt(s.w) : '');
    if (info.type === 'b') return (s.r || 0) + ' reps' + (s.w ? ' + ' + U.wFmt(s.w) : '') + (s.rpe ? ' · RPE ' + s.rpe : '');
    return U.wFmt(s.w || 0) + ' × ' + (s.r || 0) + (s.rpe ? ' · RPE ' + s.rpe : '');
  }

  function stat(v, label) { return h('div.stat', h('strong', String(v)), h('span', label)); }

  function saveTemplate(w) {
    const input = h('input', { type: 'text', value: w.name, maxlength: 40 });
    const m = modal('Save as template', field('Template name', input), { actions: [
      h('button.btn', { type: 'button', onclick: () => {
        const items = w.ex.map((e) => {
          const t = e.target || {};
          const info = Ex.get(e.id);
          const reps = e.s.map((s) => s.r || 0).filter((r) => r > 0);
          return { ex: e.id, sets: Math.max(1, e.s.length), lo: t.lo || (reps.length ? Math.min.apply(null, reps) : 8), hi: t.hi || (reps.length ? Math.max.apply(null, reps) : 12),
            rest: t.rest || state.settings.rest, min: info.type === 'c' || info.type === 'm' ? (e.s[0] && e.s[0].min) || t.min : undefined };
        });
        state.templates.push({ id: S.uid(), name: input.value.trim() || w.name, items: items });
        save(); m.close(); toast('Template saved.', 'good'); if (route === 'train') render();
      } }, 'Save'),
    ] });
  }

  /* ---------- the live logger ---------- */
  function activeWorkout() {
    const w = state.active;
    const head = h('div.live-head',
      h('input.title-in', { type: 'text', value: w.name, maxlength: 40, 'aria-label': 'Workout name', onchange: (e) => { w.name = e.target.value || 'Workout'; save({ local: true }); } }),
      h('div.live-meta', h('span#elapsed.muted', ''), h('span.muted', ' · '), h('span#live-sets.muted', setsDone(w) + ' sets')));
    main.appendChild(head);
    if (w.editing) main.appendChild(h('p.banner', 'Editing a past workout (' + fmtDate(w.d) + '). Save to keep your changes.'));
    const list = h('div.ex-list');
    main.appendChild(list);
    w.ex.forEach((e, i) => list.appendChild(exerciseCard(w, e, i)));
    main.appendChild(h('button.btn.ghost.wide', { type: 'button', onclick: () => exercisePicker((id) => {
      const info = Ex.get(id);
      const it = { ex: id, sets: info.type === 'c' || info.type === 'm' ? 1 : 3, lo: info.type === 't' ? 30 : 8, hi: info.type === 't' ? 60 : 12, rest: state.settings.rest, min: info.type === 'c' ? 20 : info.type === 'm' ? 10 : undefined };
      const sg = suggest(it);
      w.ex.push({ id: id, s: sg.rows, target: it, tip: sg.tip });
      save({ local: true }); render();
      setTimeout(() => { const cards = document.querySelectorAll('.ex-card'); const c = cards[cards.length - 1]; if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 50);
    }) }, '+ Add exercise'));
    main.appendChild(field('Notes', h('textarea', { rows: 2, maxlength: 500, placeholder: 'How did it feel?', value: w.note || '', oninput: (e) => { w.note = e.target.value; save({ local: true }); } })));
    main.appendChild(h('div.btn-row.finish-row',
      h('button.btn.ghost.danger', { type: 'button', onclick: async () => {
        if (await confirmBox(w.editing ? 'Discard changes?' : 'Discard workout?', w.editing ? 'The original workout stays as it was.' : 'Nothing from this session will be saved.', 'Discard', true)) {
          state.active = null; save({ local: true }); stopRest(); go(w.editing ? 'train' : 'today');
        }
      } }, 'Discard'),
      h('button.btn.big', { type: 'button', onclick: finishWorkout }, w.editing ? 'Save changes' : 'Finish workout')));
    tickElapsed();
    renderRest();
  }

  function exerciseCard(w, e, idx) {
    const info = Ex.get(e.id);
    const last = lastSetsFor(e.id, w.id);
    const card = h('div.ex-card');
    const t = info.type;
    const cols = t === 'w' ? ['Set', 'Last', U.wUnit(), 'Reps', ''] : t === 'b' ? ['Set', 'Last', '+' + U.wUnit(), 'Reps', ''] : t === 't' ? ['Set', 'Last', 'Seconds', ''] : t === 'c' ? ['', 'Last', 'Min', U.dUnit(), ''] : ['', 'Last', 'Min', ''];
    const menu = h('details.ex-menu', h('summary', { 'aria-label': 'Exercise options' }, '⋯'),
      h('div.menu-pop',
        h('button', { type: 'button', onclick: () => showExercise(info) }, 'How to'),
        idx > 0 ? h('button', { type: 'button', onclick: () => { w.ex.splice(idx - 1, 0, w.ex.splice(idx, 1)[0]); save({ local: true }); render(); } }, 'Move up') : null,
        h('button', { type: 'button', onclick: () => exercisePicker((id) => { e.id = id; const sg = suggest(Object.assign({}, e.target || {}, { ex: id })); e.s = sg.rows; e.tip = sg.tip; save({ local: true }); render(); }, false, info.group) }, 'Swap exercise'),
        h('button.danger', { type: 'button', onclick: () => { w.ex.splice(idx, 1); save({ local: true }); render(); } }, 'Remove')));
    card.appendChild(h('div.ex-head', h('button.ex-name', { type: 'button', onclick: () => showExercise(info) }, info.name), menu));
    const target = e.target || {};
    const sub = [];
    if (target.lo || target.min) sub.push('Target ' + rxText(Object.assign({ ex: e.id }, target)).split(' · ')[0]);
    if (target.rest) sub.push('rest ' + Calc.fmtDuration(target.rest));
    if (sub.length) card.appendChild(h('div.ex-sub.muted', sub.join(' · ')));
    if (e.tip) card.appendChild(h('div.ex-tip', e.tip));
    if (target.note && target.note !== e.tip) card.appendChild(h('div.ex-note', target.note));
    const table = h('div.sets.t-' + t, h('div.set-row.head', cols.map((c) => h('span', c))));
    e.s.forEach((s, si) => table.appendChild(setRow(w, e, info, s, si, last)));
    card.appendChild(table);
    card.appendChild(h('div.ex-foot',
      h('button.link-btn', { type: 'button', onclick: () => { const prev = e.s[e.s.length - 1] || {}; const n = Object.assign({}, prev); delete n.done; e.s.push(n); save({ local: true }); render(); } }, '+ Add set'),
      e.s.length > 1 ? h('button.link-btn.muted', { type: 'button', onclick: () => { e.s.pop(); save({ local: true }); render(); } }, '− Remove set') : null));
    return card;
  }

  function setRow(w, e, info, s, si, last) {
    const t = info.type;
    const prev = last && last.sets[Math.min(si, last.sets.length - 1)];
    const prevTxt = prev ? (t === 'w' ? U.w(prev.w) + '×' + (prev.r || 0) : t === 'b' ? (prev.r || 0) + (prev.w ? '+' + U.w(prev.w) : '') : t === 't' ? (prev.t || 0) + 's' : t === 'c' ? (prev.min || 0) + 'm' + (prev.km ? ' ' + U.d(prev.km) : '') : (prev.min || 0) + 'm') : '—';
    const num = (key, val, label, conv) => h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: val === undefined || val === null ? '' : val, 'aria-label': label,
      oninput: (ev) => { const v = ev.target.value; s[key] = v === '' ? undefined : conv ? conv(v) : parseFloat(v); save({ local: true }); } });
    const check = h('button.check' + (s.done ? '.on' : ''), { type: 'button', 'aria-label': 'Set ' + (si + 1) + ' done', 'aria-pressed': s.done ? 'true' : 'false', onclick: () => {
      s.done = !s.done;
      if (s.done) {
        if ((t === 'w' || t === 'b') && !(s.r > 0)) { s.done = false; toast('Enter your reps first.', 'warn'); return; }
        const rest = (e.target && e.target.rest) || state.settings.rest;
        if (t !== 'c' && t !== 'm' && rest > 0) startRest(rest);
        checkLivePr(e, info, s);
      }
      save({ local: true });
      check.classList.toggle('on', s.done); check.setAttribute('aria-pressed', s.done ? 'true' : 'false');
      row.classList.toggle('done', !!s.done);
      const ls = $('live-sets'); if (ls) ls.textContent = setsDone(w) + ' sets';
    } }, '✓');
    let cells;
    if (t === 'w') cells = [num('w', U.w(s.w), 'Weight', U.wIn), num('r', s.r, 'Reps')];
    else if (t === 'b') cells = [num('w', s.w ? U.w(s.w) : '', 'Added weight', U.wIn), num('r', s.r, 'Reps')];
    else if (t === 't') cells = [num('t', s.t, 'Seconds')];
    else if (t === 'c') cells = [num('min', s.min, 'Minutes'), num('km', s.km ? U.d(s.km) : '', 'Distance', U.dIn)];
    else cells = [num('min', s.min, 'Minutes')];
    const row = h('div.set-row' + (s.done ? '.done' : ''), h('span.set-n', t === 'c' || t === 'm' ? '' : String(si + 1)), h('span.prev.muted', prevTxt), cells, check);
    return row;
  }

  /* A PR shown the moment the set is ticked, before the workout is saved. */
  function checkLivePr(e, info, s) {
    const recs = G.records(state).best[e.id];
    if (!recs) return;
    const kinds = G.PR_KINDS[info.type] || [];
    for (let k = 0; k < kinds.length; k++) {
      const prev = recs[kinds[k][0]];
      const v = G.setValue(kinds[k][0], s);
      if (prev && v > prev.v + 1e-9) { toast('🏆 New PR! ' + info.name + ' ' + kinds[k][1].toLowerCase() + ': ' + prValue(e.id, kinds[k][0], v), 'gold', 4000); buzz([60, 40, 60]); return; }
    }
  }

  function tickElapsed() {
    const el = $('elapsed');
    if (!el || !state.active) return;
    if (!state.active.editing) el.textContent = Calc.fmtDuration((Date.now() - state.active.st) / 1000);
    else el.textContent = fmtDate(state.active.d);
  }
  setInterval(tickElapsed, 1000);

  /* ---------- rest timer ----------
   * Stores the END time, not a countdown, so a locked phone or a throttled
   * background tab still finishes on time. */
  function startRest(sec) {
    if (!state.active) return;
    state.active.restEnd = Date.now() + sec * 1000;
    state.active.restLen = sec;
    state.active.restRang = false;
    save({ local: true });
    renderRest();
  }
  function stopRest() { if (state.active) { state.active.restEnd = 0; save({ local: true }); } renderRest(); }

  function renderRest() {
    const bar = $('rest-bar');
    clearInterval(restTick);
    const a = state.active;
    if (!a || !a.restEnd) { bar.hidden = true; document.body.classList.remove('resting'); return; }
    bar.hidden = false;
    document.body.classList.add('resting');
    clear(bar);
    const txt = h('strong.rest-time', '');
    const fill = h('div.rest-fill');
    bar.appendChild(h('div.rest-track', fill));
    bar.appendChild(h('div.rest-inner',
      h('span.muted', 'Rest'), txt,
      h('button.btn.small.ghost', { type: 'button', onclick: () => { a.restEnd = Math.max(Date.now(), a.restEnd - 15000); save({ local: true }); upd(); } }, '−15'),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { a.restEnd += 15000; a.restLen += 15; a.restRang = false; save({ local: true }); upd(); } }, '+15'),
      h('button.btn.small', { type: 'button', onclick: stopRest }, 'Skip')));
    function upd() {
      const left = (a.restEnd - Date.now()) / 1000;
      if (left <= 0) {
        txt.textContent = 'Go!';
        fill.style.width = '100%';
        if (!a.restRang) {
          a.restRang = true; save({ local: true });
          if (state.settings.sound) beep(3);
          if (state.settings.vibrate) buzz();
          if (document.hidden) notify('Rest is over', 'Time for your next set.');
        }
        if (left < -8) { a.restEnd = 0; save({ local: true }); renderRest(); }
        return;
      }
      txt.textContent = Calc.fmtDuration(Math.ceil(left));
      fill.style.width = Math.round((1 - left / (a.restLen || 90)) * 100) + '%';
    }
    upd();
    restTick = setInterval(upd, 250);
  }

  async function finishWorkout() {
    const w = state.active;
    const done = [];
    w.ex.forEach((e) => {
      const info = Ex.get(e.id);
      const sets = e.s.filter((s) => s.done).map((s) => {
        const o = {};
        ['w', 'r', 'rpe', 't', 'min', 'km'].forEach((k) => { if (typeof s[k] === 'number' && isFinite(s[k]) && s[k] > 0) o[k] = s[k]; });
        return o;
      }).filter((o) => info.type === 'c' || info.type === 'm' ? o.min > 0 || o.km > 0 : info.type === 't' ? o.t > 0 : o.r > 0);
      if (sets.length) done.push({ id: e.id, s: sets });
    });
    if (!done.length) {
      if (await confirmBox('Nothing ticked yet', 'Tick ✓ on each set you completed. Discard this workout instead?', 'Discard', true)) { state.active = null; save({ local: true }); stopRest(); go('today'); }
      return;
    }
    const undone = w.ex.reduce((n, e) => n + e.s.filter((s) => !s.done).length, 0);
    if (undone && !w.editing && !(await confirmBox('Finish workout?', undone + ' set' + (undone === 1 ? ' is' : 's are') + ' not ticked and won\'t be saved.', 'Finish'))) return;

    const before = derived();
    const rec = { id: w.id, d: w.d, st: w.st, en: w.editing ? w.en : Date.now(), name: w.name || 'Workout', ex: done };
    if (w.plan) rec.plan = w.plan;
    if (w.pday !== undefined && w.pday !== null) rec.pday = w.pday;
    if (w.note) rec.note = w.note.trim();
    if (w.editing) state.workouts = state.workouts.map((x) => (x.id === w.id ? rec : x));
    else state.workouts.push(rec);
    state.active = null;
    // Finishing the last session of a one-way programme.
    let graduated = false;
    if (state.plan && state.plan.mode === 'sequence' && rec.plan === state.plan.id && planDone() >= state.plan.days.length
      && !state.finishedPlans.some((f) => f.id === state.plan.id)) {
      state.finishedPlans.push({ id: state.plan.id, name: state.plan.name, d: today() });
      graduated = true;
    }
    stopRest();
    save();
    const fresh = settleRewards(true);
    const after = derived();
    go(w.editing ? 'train' : 'today');
    if (w.editing) { toast('Workout updated.', 'good'); return; }
    celebrate(rec, before, after, fresh, graduated);
  }

  function celebrate(rec, before, after, fresh, graduated) {
    const prs = after.recs.events.filter((e) => e.wid === rec.id);
    const gained = after.xp.total - before.xp.total;
    const leveled = after.lvl.level > before.lvl.level;
    const streakUp = after.st.current > before.st.current;
    if (state.settings.sound) beep(leveled || prs.length ? 4 : 2);
    buzz([80, 60, 80, 60, 160]);
    modal('Workout complete', h('div.celebrate',
      h('div.confetti', { 'aria-hidden': 'true' }, '🎉'),
      h('h3', rec.name),
      h('div.stat-row', stat('+' + fmtInt(gained), 'XP'), stat(G.setsOf(rec), 'sets'), stat(Math.round(G.durationMin(rec)) + 'm', 'time'), G.volumeKg(rec) ? stat(U.w(G.volumeKg(rec), 0), U.wUnit()) : null),
      leveled ? h('div.levelup', '⭐ Level up! You\'re now level ' + after.lvl.level + ' · ' + after.lvl.title) : null,
      graduated ? h('div.levelup', '🎓 Program complete! You finished ' + state.plan.name + '.') : null,
      after.st.hitThisWeek && !before.st.hitThisWeek ? h('div.levelup', '🔥 Weekly goal hit! Streak: ' + after.st.current + ' week' + (after.st.current === 1 ? '' : 's') + (streakUp ? '' : '')) : null,
      prs.length ? h('div.card.inset', h('div.card-title', '🏆 Personal records'), h('ul.pr-list', prs.map((e) => h('li', h('strong', Ex.get(e.ex).name), ' ' + e.label + ': ' + prValue(e.ex, e.kind, e.v) + ' (was ' + prValue(e.ex, e.kind, e.prev) + ')')))) : null,
      fresh.badges.length ? h('div.card.inset', h('div.card-title', 'Badges earned'), fresh.badges.map((id) => { const b = G.BADGES.find((x) => x[0] === id); return h('div.badge-next', h('span.badge-icon', b[1]), h('div', h('strong', b[2]), h('div.muted', b[3]))); })) : null,
      fresh.goals.map((g) => h('div.levelup', '🎯 Goal complete: ' + goalLabel(g))),
      progressBar(after.lvl.into / after.lvl.need, 'xp'),
      h('p.muted', fmtInt(after.lvl.need - after.lvl.into) + ' XP to level ' + (after.lvl.level + 1))),
    { actions: [h('button.btn.ghost', { type: 'button', onclick: (ev) => { ev.target.closest('.backdrop').close(); saveTemplate(rec); } }, 'Save as template'),
      h('button.btn', { type: 'button', onclick: (ev) => ev.target.closest('.backdrop').close() }, 'Done')] });
  }

  /* ---------- exercise picker + how-to ---------- */
  function exercisePicker(onPick, browse, group) {
    let q = '', g = group || '';
    const listEl = h('div.ex-pick-list');
    const search = h('input', { type: 'search', placeholder: 'Search ' + Ex.LIST.length + ' exercises', 'aria-label': 'Search exercises', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
    const chips = h('div.chips', [['', 'All']].concat(Ex.GROUPS).map((x) => h('button.chip' + (x[0] === g ? '.on' : ''), { type: 'button', onclick: (e) => {
      g = x[0]; chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); e.currentTarget.classList.add('on'); draw();
    } }, x[1])));
    const m = modal(browse ? 'Exercise library' : 'Add exercise', h('div', search, chips, listEl,
      h('button.link-btn', { type: 'button', onclick: () => customExercise((id) => { m.close(); if (onPick) onPick(id); else exercisePicker(null, true); }) }, '+ Create your own exercise')));
    function draw() {
      clear(listEl);
      const rows = Ex.LIST.filter((e) => (!g || e.group === g) && (!q || e.name.toLowerCase().indexOf(q) >= 0 || e.equip.indexOf(q) >= 0));
      rows.slice(0, 150).forEach((e) => listEl.appendChild(h('button.pick', { type: 'button', onclick: () => { if (browse) showExercise(e); else { m.close(); onPick(e.id); } } },
        h('strong', e.name), h('span.muted', cap(e.group) + ' · ' + e.equip + (e.custom ? ' · custom' : '')))));
      if (!rows.length) listEl.appendChild(h('p.muted', 'No match. Create it as a custom exercise below.'));
    }
    draw();
  }

  function customExercise(done) {
    const d = { name: '', group: 'chest', type: 'w', equip: 'barbell' };
    const m = modal('Custom exercise', h('div',
      field('Name', h('input', { type: 'text', maxlength: 40, oninput: (e) => { d.name = e.target.value; } })),
      field('Muscle group', select(Ex.GROUPS, d.group, (v) => { d.group = v; })),
      field('Logged as', select(Object.keys(Ex.TYPE_LABEL).map((k) => [k, Ex.TYPE_LABEL[k]]), d.type, (v) => { d.type = v; })),
      field('Equipment', select(['barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'band', 'bodyweight', 'cardio'].map((x) => [x, cap(x)]), d.equip, (v) => { d.equip = v; }))),
    { actions: [h('button.btn', { type: 'button', onclick: () => {
      if (!d.name.trim()) { toast('Give it a name.', 'warn'); return; }
      const e = { id: 'c-' + S.uid(), name: d.name.trim(), group: d.group, pattern: 'custom', equip: d.equip, type: d.type, cues: '' };
      state.custom.push(e); Ex.addCustom([e]); save(); m.close(); toast('Exercise added.', 'good'); done(e.id);
    } }, 'Create')] });
  }

  function showExercise(info) {
    const b = G.records(state).best[info.id] || {};
    const kinds = G.PR_KINDS[info.type] || [];
    const hist = [];
    G.sortedWorkouts(state).forEach((w) => (w.ex || []).forEach((e) => { if (e.id === info.id) hist.push([w.d, e.s]); }));
    modal(info.name, h('div',
      h('p.muted', cap(info.group) + ' · ' + cap(info.equip) + ' · ' + Ex.TYPE_LABEL[info.type]),
      info.cues ? h('p.cues', info.cues) : null,
      kinds.some((k) => b[k[0]]) ? h('div.stat-row', kinds.filter((k) => b[k[0]]).map((k) => stat(prValue(info.id, k[0], b[k[0]].v), k[1]))) : h('p.muted', 'No history yet.'),
      hist.length ? h('div', h('div.card-title', 'Recent'), hist.slice(-5).reverse().map((x) => h('div.list-row', h('span.muted', fmtDate(x[0])), h('span.grow', x[1].map((s) => setText(info, s)).join(', '))))) : null));
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ===================================================================
     PLANS + GOALS
     =================================================================== */
  function screenPlans() {
    main.appendChild(h('header.page-head', h('h1', 'Plans & Goals'), h('p.muted', 'Pick a program, build your own, and set targets worth chasing.')));
    const p = state.plan;
    if (p) {
      const done = planDone();
      const nx = nextPlanDay();
      main.appendChild(h('div.card',
        h('div.card-title', 'Your plan', h('span.muted', 'since ' + fmtDate(p.started))),
        planPreview(p, true),
        p.mode === 'sequence' ? h('div', progressBar(done / p.days.length), h('p.muted', done + ' of ' + p.days.length + ' sessions done')) : h('p.muted', done + ' sessions done · next: ' + (nx ? nx.day.name : '—')),
        h('div.field', h('span.field-label', 'Training days'), scheduleEditor(p)),
        h('div.plan-days', p.days.map((d, i) => (p.mode === 'sequence' && Math.abs(i - done) > 3) ? null : planDayEditor(p, d, i, nx))),
        h('div.btn-row',
          h('button.btn.ghost', { type: 'button', onclick: () => {
            const m = modal('Skip ahead', h('div', h('p', 'Jump to a different session in this plan, e.g. if you are repeating or skipping a week.'),
              h('div.pick-list', p.days.map((d, i) => h('button.pick', { type: 'button', onclick: () => {
                state.planOffset = (state.planOffset || 0) + (i - (p.mode === 'sequence' ? done : done % p.days.length)); save(); m.close(); render();
              } }, h('strong', d.name), nx && nx.idx === i ? h('span.muted', 'next up') : null)))));
          } }, 'Change next session'),
          h('button.btn.ghost.danger', { type: 'button', onclick: async () => {
            if (await confirmBox('End this plan?', 'Your logged workouts stay. You can start any plan again later.', 'End plan', true)) { state.plan = null; save(); render(); }
          } }, 'End plan'))));
    }

    // ---- goals ----
    const goalsCard = h('div.card', h('div.card-title', 'Goals', h('button.btn.small', { type: 'button', onclick: () => goalEditor() }, '+ New goal')));
    if (!state.goals.length) goalsCard.appendChild(h('p.muted', 'Goals with a deadline give every workout a purpose. Try "weigh 180 lb by March" or "bench 225".'));
    state.goals.filter((g) => !g.done).forEach((g) => goalsCard.appendChild(goalRow(g, true)));
    const doneGoals = state.goals.filter((g) => g.done);
    if (doneGoals.length) goalsCard.appendChild(h('details', h('summary', 'Completed (' + doneGoals.length + ')'), doneGoals.map((g) => goalRow(g, true))));
    main.appendChild(goalsCard);

    // ---- generator ----
    const gen = Object.assign({ goal: state.profile.goal, days: state.profile.weeklyGoal, minutes: state.profile.minutes, equip: state.profile.equip, experience: state.profile.experience });
    const out = h('div');
    const redraw = () => { clear(out); const plan = P.generate(gen); out.appendChild(planPreview(plan)); out.appendChild(h('button.btn', { type: 'button', onclick: () => usePlan(plan) }, 'Use this plan')); };
    main.appendChild(h('div.card', h('div.card-title', 'Build a plan for me'),
      field('Goal', select([['lose', 'Lose fat'], ['muscle', 'Build muscle'], ['strength', 'Get stronger'], ['general', 'General fitness'], ['run', 'Running']], gen.goal, (v) => { gen.goal = v; redraw(); })),
      h('div.row2', field('Days / week', select([2, 3, 4, 5, 6].map((n) => [n, n + ' days']), gen.days, (v) => { gen.days = +v; redraw(); })),
        field('Minutes', select([[30, '30 min'], [45, '45 min'], [60, '60 min'], [75, '75+ min']], gen.minutes, (v) => { gen.minutes = +v; redraw(); }))),
      h('div.row2', field('Equipment', select([['gym', 'Full gym'], ['home', 'Home: dumbbells/bands'], ['bodyweight', 'None']], gen.equip, (v) => { gen.equip = v; redraw(); })),
        field('Experience', select([['beginner', 'Beginner'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']], gen.experience, (v) => { gen.experience = v; redraw(); }))),
      out));
    redraw();

    // ---- library ----
    main.appendChild(h('div.card', h('div.card-title', 'Program library'),
      h('div.lib-grid', P.library().map((pl) => h('button.lib-card', { type: 'button', onclick: () => {
        const m = modal(pl.name, planPreview(pl), { actions: [h('button.btn', { type: 'button', onclick: () => { m.close(); usePlan(pl); } }, 'Use this plan')] });
      } }, h('strong', pl.name), h('span.muted', pl.mode === 'sequence' ? pl.days.length + ' sessions' : pl.perWeek + '×/week'), h('span.lib-desc', pl.desc.split('. ')[0] + '.'))))));
  }

  async function usePlan(plan) {
    if (state.plan && !(await confirmBox('Switch plans?', 'Your current plan ends; every logged workout stays.', 'Switch'))) return;
    startPlan(plan); save(); settleRewards(); go('today');
  }

  function scheduleEditor(p) {
    return h('div.chips.days', [1, 2, 3, 4, 5, 6, 0].map((wd) => h('button.chip' + (p.schedule.indexOf(wd) >= 0 ? '.on' : ''), { type: 'button', 'aria-pressed': p.schedule.indexOf(wd) >= 0 ? 'true' : 'false', onclick: (e) => {
      const i = p.schedule.indexOf(wd);
      if (i >= 0) p.schedule.splice(i, 1); else p.schedule.push(wd);
      e.currentTarget.classList.toggle('on');
      e.currentTarget.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
      save();
    } }, P.WEEKDAYS[wd])));
  }

  function planDayEditor(p, d, i, nx) {
    return h('details.plan-day', h('summary', d.name, nx && nx.idx === i ? h('span.tag', 'next') : null, h('span.muted', ' · ' + d.items.length + ' exercises')),
      d.items.map((it, k) => h('div.list-row',
        h('div.grow', h('strong', Ex.get(it.ex).name), h('div.muted', rxText(it))),
        Ex.get(it.ex).type === 'c' || Ex.get(it.ex).type === 'm' ? null : h('button.icon-btn', { type: 'button', 'aria-label': 'Edit sets and reps', onclick: () => editItem(it) }, '✎'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Swap exercise', onclick: () => exercisePicker((id) => { it.ex = id; save(); render(); }, false, Ex.get(it.ex).group) }, '⇄'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Remove', onclick: () => { d.items.splice(k, 1); save(); render(); } }, '✕'))),
      h('button.link-btn', { type: 'button', onclick: () => exercisePicker((id) => { const info = Ex.get(id); d.items.push({ ex: id, sets: info.type === 'c' || info.type === 'm' ? 1 : 3, lo: 8, hi: 12, rest: 90, min: info.type === 'c' ? 20 : info.type === 'm' ? 10 : undefined }); save(); render(); }) }, '+ Add exercise'));
  }

  function editItem(it) {
    const d = { sets: it.sets, lo: it.lo, hi: it.hi, rest: it.rest || 90 };
    const m = modal('Sets & reps: ' + Ex.get(it.ex).name, h('div',
      field('Sets', stepper(d.sets, 1, (v) => { d.sets = parseInt(v, 10) || 1; }, { min: 1 })),
      h('div.row2', field('Reps from', stepper(d.lo, 1, (v) => { d.lo = parseInt(v, 10) || 1; }, { min: 1 })), field('to', stepper(d.hi, 1, (v) => { d.hi = parseInt(v, 10) || 1; }, { min: 1 }))),
      field('Rest (seconds)', stepper(d.rest, 15, (v) => { d.rest = parseInt(v, 10) || 0; }))),
    { actions: [h('button.btn', { type: 'button', onclick: () => { Object.assign(it, { sets: d.sets, lo: Math.min(d.lo, d.hi), hi: Math.max(d.lo, d.hi), rest: d.rest }); save(); m.close(); render(); } }, 'Save')] });
  }

  /* ---------- goals ----------
   * { id, type: weight|lift|run|workouts|habit, target (metric), ex?, start, created, by?, done?, text? } */
  function currentWeight() { return G.latestBodyweight(state); }

  function goalCurrent(g) {
    if (g.type === 'weight') return currentWeight();
    if (g.type === 'lift') { const b = G.records(state).best[g.ex]; return b && b.e1rm ? b.e1rm.v : 0; }
    if (g.type === 'run') { let m = 0; state.workouts.forEach((w) => w.ex.forEach((e) => { if (Ex.get(e.id).type === 'c') e.s.forEach((s) => { m = Math.max(m, s.km || 0); }); })); return m; }
    if (g.type === 'workouts') return state.workouts.filter((w) => w.d >= g.created).length;
    return g.checked ? 1 : 0;
  }

  function goalProgress(g) {
    const cur = goalCurrent(g);
    let frac;
    if (g.type === 'weight') {
      const span = g.target - g.start;
      frac = Math.abs(span) < 0.05 ? (Math.abs(cur - g.target) < 0.25 ? 1 : 0) : (cur - g.start) / span;
      if (span < 0 ? cur <= g.target : cur >= g.target) frac = 1;
    } else if (g.type === 'habit') frac = cur;
    else frac = g.target > 0 ? cur / g.target : 0;
    frac = Math.max(0, Math.min(1, frac));
    let onTrack = null, eta = null;
    if (g.by && frac < 1) {
      const total = G.dayNum(g.by) - G.dayNum(g.created), el = G.dayNum(today()) - G.dayNum(g.created);
      if (total > 0) onTrack = frac >= Math.min(1, el / total) - 0.05;
    }
    // Projection from the trend of the underlying measurements.
    if (frac < 1 && (g.type === 'weight' || g.type === 'lift')) {
      const pts = [];
      if (g.type === 'weight') state.body.filter((b) => b.w && b.d >= G.addDays(today(), -42)).forEach((b) => pts.push([G.dayNum(b.d), b.w]));
      else G.sortedWorkouts(state).forEach((w) => w.ex.forEach((e) => { if (e.id === g.ex && w.d >= G.addDays(today(), -84)) pts.push([G.dayNum(w.d), Math.max.apply(null, e.s.map((s) => Calc.estimate1RM(s.w || 0, s.r || 0)))]); }));
      const tr = Calc.trend(pts);
      if (tr && pts.length >= 3) {
        const need = g.target - cur;
        if (tr.slope !== 0 && Math.sign(tr.slope) === Math.sign(need)) {
          const days = Math.ceil(need / tr.slope);
          if (days < 3650) eta = G.addDays(today(), days);
        }
      }
    }
    return { cur: cur, frac: frac, onTrack: onTrack, eta: eta };
  }

  function goalLabel(g) {
    if (g.type === 'weight') return 'Reach ' + U.wFmt(g.target) + ' bodyweight';
    if (g.type === 'lift') return Ex.get(g.ex).name + ' ' + U.wFmt(g.target) + ' (est. 1RM)';
    if (g.type === 'run') return 'Run ' + U.dFmt(g.target) + ' in one go';
    if (g.type === 'workouts') return g.target + ' workouts';
    return g.text || 'Goal';
  }

  function goalRow(g, full) {
    const pr = goalProgress(g);
    const curTxt = g.type === 'weight' ? U.wFmt(pr.cur) : g.type === 'lift' ? U.wFmt(pr.cur) : g.type === 'run' ? U.dFmt(pr.cur) : g.type === 'workouts' ? String(pr.cur) : '';
    return h('div.goal-row',
      h('div.goal-top', h('strong', goalLabel(g)),
        g.done ? h('span.tag.good', '✓ ' + fmtDate(g.done)) : pr.onTrack === true ? h('span.tag.good', 'On track') : pr.onTrack === false ? h('span.tag.warn', 'Behind') : null),
      progressBar(pr.frac, g.done ? 'good' : ''),
      h('div.muted.small',
        g.type !== 'habit' ? 'Now ' + curTxt + ' · ' + Math.round(pr.frac * 100) + '%' : '',
        g.by ? ' · by ' + fmtDate(g.by) : '',
        pr.eta && !g.done ? ' · on pace for ' + fmtDate(pr.eta, { month: 'short', day: 'numeric', year: 'numeric' }) : ''),
      full ? h('div.btn-row.small',
        g.type === 'habit' && !g.done ? h('button.btn.small', { type: 'button', onclick: () => { g.checked = true; save(); settleRewards(); render(); } }, 'Mark done') : null,
        g.type === 'weight' && !g.done ? h('button.btn.small.ghost', { type: 'button', onclick: weighIn }, 'Log weight') : null,
        h('button.link-btn.muted', { type: 'button', onclick: async () => { if (await confirmBox('Delete goal?', goalLabel(g), 'Delete', true)) { state.goals = state.goals.filter((x) => x.id !== g.id); save(); render(); } } }, 'Delete')) : null);
  }

  function goalEditor() {
    const d = { type: 'weight', target: '', ex: 'bench', by: '', text: '' };
    const box = h('div');
    const m = modal('New goal', box, { actions: [h('button.btn', { type: 'button', onclick: create }, 'Set goal')] });
    function draw() {
      clear(box);
      box.appendChild(field('Type', seg([['weight', 'Weight'], ['lift', 'Lift'], ['run', 'Run'], ['workouts', 'Workouts'], ['habit', 'Other']], d.type, (v) => { d.type = v; d.target = ''; draw(); }, 'Goal type')));
      if (d.type === 'weight') box.appendChild(field('Target weight (' + U.wUnit() + ')', h('input.num', { type: 'number', inputmode: 'decimal', placeholder: 'Now ' + U.w(currentWeight()), oninput: (e) => { d.target = e.target.value; } })));
      if (d.type === 'lift') {
        box.appendChild(field('Exercise', select(Ex.LIST.filter((e) => e.type === 'w').map((e) => [e.id, e.name]), d.ex, (v) => { d.ex = v; draw(); })));
        const b = G.records(state).best[d.ex];
        box.appendChild(field('Target 1-rep max (' + U.wUnit() + ')', h('input.num', { type: 'number', inputmode: 'decimal', placeholder: b && b.e1rm ? 'Now ~' + U.w(b.e1rm.v, 0) : '', oninput: (e) => { d.target = e.target.value; } }),
          'Estimated from your sets, so you never have to max out to hit it.'));
      }
      if (d.type === 'run') box.appendChild(field('Distance in one run (' + U.dUnit() + ')', h('input.num', { type: 'number', inputmode: 'decimal', placeholder: U.metric ? '5' : '3.1', oninput: (e) => { d.target = e.target.value; } })));
      if (d.type === 'workouts') box.appendChild(field('Number of workouts', h('input.num', { type: 'number', inputmode: 'numeric', placeholder: '20', oninput: (e) => { d.target = e.target.value; } })));
      if (d.type === 'habit') box.appendChild(field('Your goal', h('input', { type: 'text', maxlength: 80, placeholder: 'e.g. Do a full pull-up', oninput: (e) => { d.text = e.target.value; } })));
      box.appendChild(field('Deadline (optional)', h('input', { type: 'date', min: today(), oninput: (e) => { d.by = e.target.value; } })));
    }
    function create() {
      const g = { id: S.uid(), type: d.type, created: today() };
      if (d.type === 'habit') { if (!d.text.trim()) { toast('Describe the goal.', 'warn'); return; } g.text = d.text.trim(); }
      else {
        const v = parseFloat(d.target);
        if (!(v > 0)) { toast('Enter a target.', 'warn'); return; }
        g.target = d.type === 'weight' || d.type === 'lift' ? U.wIn(v) : d.type === 'run' ? U.dIn(v) : Math.round(v);
      }
      if (d.type === 'lift') g.ex = d.ex;
      if (d.by) g.by = d.by;
      g.start = goalCurrent(g);
      state.goals.push(g); save(); settleRewards(); m.close(); render(); toast('Goal set. Go get it!', 'good');
    }
    draw();
  }

  /* ===================================================================
     TOOLS: calculators
     =================================================================== */
  const CALCS = [
    ['calories', '🔥', 'Calories & macros', 'BMR, TDEE and a target for your goal'],
    ['bmi', '⚖️', 'BMI', 'Body-mass index and healthy range'],
    ['bodyfat', '📏', 'Body fat', 'U.S. Navy tape-measure method'],
    ['onerm', '🏋️', 'One-rep max', '7 formulas plus a percentage chart'],
    ['plates', '🧲', 'Plate loader', 'What to put on each side of the bar'],
    ['hr', '❤️', 'Heart-rate zones', 'Karvonen zones from age and resting HR'],
    ['pace', '⏱️', 'Pace & race times', 'Pace, time, distance and race predictions'],
    ['burn', '⚡', 'Calories burned', 'By activity, weight and time'],
    ['ideal', '🎯', 'Ideal weight', 'Four formulas and the BMI range'],
    ['water', '💧', 'Water intake', 'Daily water target'],
    ['protein', '🍗', 'Protein', 'How much protein for your goal'],
    ['whtr', '📐', 'Waist-to-height', 'A simple health-risk ratio'],
  ];

  function screenTools() {
    main.appendChild(h('header.page-head', h('h1', 'Tools'), h('p.muted', 'Calculators pre-filled from your profile.')));
    const panel = h('div#calc-panel');
    const grid = h('div.calc-grid', CALCS.map((c) => h('button.calc-card', { type: 'button', 'data-calc': c[0], onclick: () => openCalc(c[0]) },
      h('span.calc-icon', c[1]), h('strong', c[2]), h('span.muted', c[3]))));
    main.appendChild(grid);
    main.appendChild(panel);
    function openCalc(key) {
      grid.querySelectorAll('.calc-card').forEach((b) => b.classList.toggle('on', b.dataset.calc === key));
      clear(panel);
      const c = CALCS.find((x) => x[0] === key);
      panel.appendChild(h('div.card', h('div.card-title', c[1] + ' ' + c[2]), CALC_UI[key]()));
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function age() { return new Date().getFullYear() - state.profile.birthYear; }

  // A live calculator: inputs on top, result box that recomputes on every change.
  function calcBox(inputs, compute) {
    const out = h('div.calc-out');
    const run = () => { clear(out); try { const r = compute(); if (r) out.appendChild(r); } catch (e) { out.appendChild(h('p.muted', 'Check the numbers.')); } };
    const wrap = h('div', inputs, out);
    wrap.addEventListener('input', run);
    wrap.addEventListener('change', run);
    wrap.addEventListener('click', (e) => { if (e.target.closest('.seg,.step')) setTimeout(run, 0); });
    setTimeout(run, 0);
    return wrap;
  }

  function numIn(val, label) { return h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', value: val, 'aria-label': label }); }
  function big(v, label, sub) { return h('div.result', h('div.result-val', v), h('div.result-label', label), sub ? h('div.muted', sub) : null); }

  function heightInputs(d) {
    if (U.metric) { const i = numIn(Math.round(d.cm), 'Height cm'); i.addEventListener('input', () => { d.cm = parseFloat(i.value); }); return field('Height (cm)', i); }
    const tot = Calc.cmToIn(d.cm);
    const ft = numIn(Math.floor(Math.round(tot) / 12), 'Feet'), inch = numIn(Math.round(tot) % 12, 'Inches');
    const upd = () => { d.cm = Calc.inToCm((parseFloat(ft.value) || 0) * 12 + (parseFloat(inch.value) || 0)); };
    ft.addEventListener('input', upd); inch.addEventListener('input', upd);
    return h('div.row2', field('Height (ft)', ft), field('(in)', inch));
  }

  function weightInput(d, key, label) {
    const i = numIn(U.w(d[key]), label || 'Weight');
    i.addEventListener('input', () => { d[key] = U.wIn(i.value); });
    return field((label || 'Weight') + ' (' + U.wUnit() + ')', i);
  }

  function lengthInput(d, key, label) {
    const i = numIn(d[key] ? U.l(d[key]) : '', label);
    i.addEventListener('input', () => { d[key] = U.lIn(i.value); });
    return field(label + ' (' + U.lUnit() + ')', i);
  }

  const CALC_UI = {
    calories() {
      const p = state.profile;
      const d = { sex: p.sex, age: age(), cm: p.heightCm, kg: currentWeight() || p.weightKg, act: p.activity, goal: p.goal === 'lose' ? 'lose' : p.goal === 'muscle' || p.goal === 'strength' ? 'gain' : 'keep', bf: '' };
      const ageIn = numIn(d.age, 'Age'); ageIn.addEventListener('input', () => { d.age = parseFloat(ageIn.value); });
      const bfIn = numIn('', 'Body fat'); bfIn.placeholder = 'optional'; bfIn.addEventListener('input', () => { d.bf = bfIn.value; });
      return calcBox(h('div',
        h('div.row2', field('Sex', seg([['m', 'Male'], ['f', 'Female']], d.sex, (v) => { d.sex = v; })), field('Age', ageIn)),
        heightInputs(d), h('div.row2', weightInput(d, 'kg'), field('Body fat % (optional)', bfIn)),
        field('Activity', select(Calc.ACTIVITY.map((a) => [a[0], a[1]]), d.act, (v) => { d.act = parseFloat(v); })),
        field('Goal', seg([['lose', 'Lose fat'], ['keep', 'Maintain'], ['gain', 'Gain muscle']], d.goal, (v) => { d.goal = v; }))),
      () => {
        const bmr = d.bf ? Calc.bmrKatch(d.kg, parseFloat(d.bf)) : Calc.bmrMifflin(d.sex, d.kg, d.cm, d.age);
        const td = Calc.tdee(bmr, d.act);
        const mc = Calc.macros(td, d.goal, d.kg);
        return h('div',
          h('div.stat-row', stat(fmtInt(bmr), 'BMR kcal'), stat(fmtInt(td), 'maintenance'), stat(fmtInt(mc.kcal), 'your target')),
          h('div.macro-row', h('div.macro.p', h('strong', Math.round(mc.protein) + ' g'), 'protein'), h('div.macro.c', h('strong', Math.round(mc.carbs) + ' g'), 'carbs'), h('div.macro.f', h('strong', Math.round(mc.fat) + ' g'), 'fat')),
          h('p.muted.small', (d.bf ? 'Katch-McArdle' : 'Mifflin-St Jeor') + ' BMR × activity. ' + (d.goal === 'lose' ? '20% deficit: about 0.5-1% of bodyweight a week.' : d.goal === 'gain' ? '10% surplus for lean gains.' : 'Maintenance calories.')),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { state.profile.proteinGoal = Math.round(mc.protein / 5) * 5; state.profile.kcalTarget = Math.round(mc.kcal); state.profile.activity = d.act; save(); toast('Protein goal set to ' + state.profile.proteinGoal + ' g.', 'good'); } }, 'Use for my daily protein goal'));
      });
    },
    bmi() {
      const d = { cm: state.profile.heightCm, kg: currentWeight() || state.profile.weightKg };
      return calcBox(h('div', heightInputs(d), weightInput(d, 'kg')), () => {
        const v = Calc.bmi(d.kg, d.cm), iw = Calc.idealWeights('m', d.cm);
        return h('div', big(v.toFixed(1), Calc.bmiCategory(v)),
          h('div.scale', h('div.scale-mark', { style: { left: Math.max(0, Math.min(100, (v - 15) / 25 * 100)) + '%' } })),
          h('div.scale-labels', h('span', '18.5'), h('span', '25'), h('span', '30')),
          h('p.muted.small', 'Healthy range for your height: ' + U.w(iw.bmiLow, 0) + '–' + U.w(iw.bmiHigh, 0) + ' ' + U.wUnit() + '. BMI ignores muscle, so lifters often read "overweight"; body fat and waist-to-height are better guides.'));
      });
    },
    bodyfat() {
      const d = { sex: state.profile.sex, cm: state.profile.heightCm, neck: lastMeasure('neck'), waist: lastMeasure('waist'), hip: lastMeasure('hips') };
      const box = h('div');
      const draw = () => { clear(box); box.appendChild(h('div', field('Sex', seg([['m', 'Male'], ['f', 'Female']], d.sex, (v) => { d.sex = v; draw(); })), heightInputs(d),
        h('div.row2', lengthInput(d, 'neck', 'Neck'), lengthInput(d, 'waist', 'Waist (at navel)')), d.sex === 'f' ? lengthInput(d, 'hip', 'Hips (widest)') : null)); };
      draw();
      return calcBox(box, () => {
        if (!(d.neck && d.waist && (d.sex !== 'f' || d.hip))) return h('p.muted', 'Measure with a soft tape, relaxed, not sucking in.');
        const bf = Calc.navyBodyFat(d.sex, d.cm, d.neck, d.waist, d.hip || 0);
        if (!isFinite(bf)) return h('p.muted', 'Waist must be larger than neck.');
        const kg = currentWeight() || state.profile.weightKg;
        return h('div', big(bf.toFixed(1) + '%', Calc.bodyFatCategory(d.sex, bf), 'Lean mass ≈ ' + U.wFmt(kg * (1 - bf / 100), 0) + ' · fat ≈ ' + U.wFmt(kg * bf / 100, 0)),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { addBody({ bf: Math.round(bf * 10) / 10, neck: d.neck, waist: d.waist, hips: d.hip }); toast('Saved to your body log.', 'good'); } }, 'Save to body log'));
      });
    },
    onerm() {
      const d = { w: '', r: 5 };
      const w = numIn('', 'Weight'), r = numIn(5, 'Reps');
      w.addEventListener('input', () => { d.w = U.wIn(w.value); }); r.addEventListener('input', () => { d.r = parseInt(r.value, 10); });
      return calcBox(h('div.row2', field('Weight (' + U.wUnit() + ')', w), field('Reps', r)), () => {
        if (!(d.w > 0 && d.r >= 1)) return h('p.muted', 'Enter a set you did: weight and reps (best accuracy under 10 reps).');
        const all = Calc.oneRepMaxAll(d.w, d.r);
        const one = all.epley;
        return h('div', big(U.wFmt(one, 0), 'Estimated 1RM (Epley)'),
          h('table.tbl', h('tbody', Object.keys(Calc.ONE_RM).map((k) => h('tr', h('td', cap(k === 'oconner' ? "O'Conner" : k)), h('td', U.wFmt(all[k], 1)))), h('tr.em', h('td', 'Average'), h('td', U.wFmt(all.average, 1))))),
          h('div.card-title', 'Training percentages'),
          h('table.tbl', h('tbody', [95, 90, 85, 80, 75, 70, 65, 60].map((pc) => h('tr', h('td', pc + '%'), h('td', U.wFmt(one * pc / 100, 0)), h('td.muted', '≈ ' + Math.max(1, Math.round(30 * (100 / pc - 1))) + ' reps'))))));
      });
    },
    plates() {
      const unit = U.wUnit();
      const set = Calc.PLATE_SETS[unit];
      const d = { target: unit === 'kg' ? 100 : 225, bar: set.bar, have: set.plates.slice() };
      const t = numIn(d.target, 'Target'); t.addEventListener('input', () => { d.target = parseFloat(t.value); });
      const b = numIn(d.bar, 'Bar'); b.addEventListener('input', () => { d.bar = parseFloat(b.value); });
      const chips = h('div.chips', set.plates.map((p) => h('button.chip.on', { type: 'button', 'aria-pressed': 'true', onclick: (e) => {
        const i = d.have.indexOf(p); if (i >= 0) d.have.splice(i, 1); else d.have.push(p);
        e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
      } }, p + '')));
      return calcBox(h('div', h('div.row2', field('Target (' + unit + ')', t), field('Bar (' + unit + ')', b)), field('Plates you have', chips)), () => {
        if (!(d.target > 0)) return null;
        if (d.target < d.bar) return h('p.muted', 'That is less than the bar.');
        const r = Calc.plates(d.target, d.bar, d.have);
        return h('div', h('div.bar-viz', h('span.bar-end'), r.perSide.slice().reverse().map((p) => h('span.plate', { style: { height: (34 + p / set.plates[0] * 60) + 'px' } }, String(p))), h('span.bar-shaft')),
          big(r.perSide.length ? r.perSide.join(' + ') : 'Just the bar', 'per side', 'Total ' + r.total + ' ' + unit + (r.short > 0 ? ' (' + r.short + ' ' + unit + ' short of target; nearest you can load)' : '')));
      });
    },
    hr() {
      const d = { age: age(), rest: 60, method: 'fox' };
      const a = numIn(d.age, 'Age'), r = numIn(d.rest, 'Resting HR');
      a.addEventListener('input', () => { d.age = parseFloat(a.value); }); r.addEventListener('input', () => { d.rest = parseFloat(r.value); });
      return calcBox(h('div', h('div.row2', field('Age', a), field('Resting heart rate', r, 'Count your pulse for 60 s on waking.')),
        field('Max HR formula', seg([['fox', '220 − age'], ['tanaka', 'Tanaka']], d.method, (v) => { d.method = v; }))), () => {
        const mx = Calc.maxHeartRate(d.age, d.method);
        return h('div', big(Math.round(mx) + ' bpm', 'Estimated max heart rate'),
          h('div.zones', Calc.karvonen(mx, d.rest).map((z, i) => h('div.zone.z' + (i + 1), h('strong', z.name), h('span', Math.round(z.lo) + '–' + Math.round(z.hi) + ' bpm'), h('span.muted', z.label)))));
      });
    },
    pace() {
      const du = U.dUnit();
      const d = { dist: U.metric ? 5 : 3.1, time: '28:00' };
      const di = numIn(d.dist, 'Distance'), ti = h('input', { type: 'text', value: d.time, inputmode: 'numeric', 'aria-label': 'Time', placeholder: 'mm:ss or h:mm:ss' });
      di.addEventListener('input', () => { d.dist = parseFloat(di.value); }); ti.addEventListener('input', () => { d.time = ti.value; });
      const preset = h('div.chips', [['5K', 5], ['10K', 10], ['Half', 21.0975], ['Marathon', 42.195]].map((x) => h('button.chip', { type: 'button', onclick: () => { di.value = U.d(x[1], 2); d.dist = parseFloat(di.value); di.dispatchEvent(new Event('input', { bubbles: true })); } }, x[0])));
      return calcBox(h('div', h('div.row2', field('Distance (' + du + ')', di), field('Time', ti)), preset), () => {
        const sec = Calc.parseDuration(d.time);
        if (!(sec > 0 && d.dist > 0)) return h('p.muted', 'Enter a distance and a time like 28:00.');
        const km = U.dIn(d.dist);
        const pk = sec / km, pm = sec / Calc.kmToMi(km);
        return h('div', big(Calc.fmtDuration(U.metric ? pk : pm) + ' /' + du, 'Pace', (U.metric ? Calc.fmtDuration(pm) + ' /mi' : Calc.fmtDuration(pk) + ' /km') + ' · ' + (km / (sec / 3600) * (U.metric ? 1 : 1 / Calc.KM_PER_MI)).toFixed(1) + (U.metric ? ' km/h' : ' mph')),
          h('div.card-title', 'Predicted race times (Riegel)'),
          h('table.tbl', h('tbody', [['5K', 5], ['10K', 10], ['Half marathon', 21.0975], ['Marathon', 42.195]].map((x) => h('tr', h('td', x[0]), h('td', Calc.fmtDuration(Calc.riegel(sec, km, x[1]))), h('td.muted', Calc.fmtDuration(Calc.riegel(sec, km, x[1]) / (U.metric ? x[1] : Calc.kmToMi(x[1]))) + ' /' + du))))),
          h('p.muted.small', 'Predictions assume you have trained for the distance.'));
      });
    },
    burn() {
      const d = { met: Calc.METS[4][1], min: 30, kg: currentWeight() || state.profile.weightKg };
      const mi = numIn(30, 'Minutes'); mi.addEventListener('input', () => { d.min = parseFloat(mi.value); });
      return calcBox(h('div', field('Activity', select(Calc.METS.map((m) => [m[1], m[0] + ' (' + m[1] + ' MET)']), d.met, (v) => { d.met = parseFloat(v); })),
        h('div.row2', field('Minutes', mi), weightInput(d, 'kg'))), () => big(fmtInt(Calc.caloriesBurned(d.met, d.kg, d.min)) + ' kcal', 'Calories burned', 'MET × body weight × hours. Values from the Compendium of Physical Activities.'));
    },
    ideal() {
      const d = { sex: state.profile.sex, cm: state.profile.heightCm };
      return calcBox(h('div', field('Sex', seg([['m', 'Male'], ['f', 'Female']], d.sex, (v) => { d.sex = v; })), heightInputs(d)), () => {
        const r = Calc.idealWeights(d.sex, d.cm);
        return h('div', h('table.tbl', h('tbody', [['Devine (1974)', r.devine], ['Robinson (1983)', r.robinson], ['Miller (1983)', r.miller], ['Hamwi (1964)', r.hamwi]].map((x) => h('tr', h('td', x[0]), h('td', U.wFmt(x[1], 0)))),
          h('tr.em', h('td', 'Healthy BMI range'), h('td', U.w(r.bmiLow, 0) + '–' + U.w(r.bmiHigh, 0) + ' ' + U.wUnit())))),
          h('p.muted.small', 'These are rough population formulas. Muscle, frame and age all move the right number; use them as a sanity check, not a target.'));
      });
    },
    water() {
      const d = { kg: currentWeight() || state.profile.weightKg, min: 45 };
      const mi = numIn(45, 'Exercise minutes'); mi.addEventListener('input', () => { d.min = parseFloat(mi.value); });
      return calcBox(h('div.row2', weightInput(d, 'kg'), field('Exercise today (min)', mi)), () => {
        const ml = Calc.waterMl(d.kg, d.min);
        const glasses = Math.round(ml / 250);
        return h('div', big(U.metric ? (ml / 1000).toFixed(1) + ' L' : Math.round(ml / 29.5735) + ' fl oz', 'Daily water', '≈ ' + glasses + ' glasses of 250 ml. Food provides some of this too.'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { state.profile.waterGoal = glasses; save(); toast('Water goal set to ' + glasses + ' glasses.', 'good'); } }, 'Use as my water goal'));
      });
    },
    protein() {
      const d = { kg: currentWeight() || state.profile.weightKg, kind: state.profile.goal === 'lose' ? 'lose' : state.profile.goal === 'run' ? 'endurance' : state.profile.goal === 'general' ? 'general' : 'muscle' };
      return calcBox(h('div', weightInput(d, 'kg'), field('Goal', select([['sedentary', 'Sedentary / minimum'], ['general', 'Active, general fitness'], ['endurance', 'Endurance training'], ['muscle', 'Building muscle'], ['lose', 'Losing fat, keeping muscle']], d.kind, (v) => { d.kind = v; }))), () => {
        const r = Calc.proteinRange(d.kg, d.kind);
        const mid = Math.round((r[0] + r[1]) / 2 / 5) * 5;
        return h('div', big(Math.round(r[0]) + '–' + Math.round(r[1]) + ' g', 'Protein per day', Calc.PROTEIN_RANGES[d.kind].join('–') + ' g per kg of bodyweight, spread over 3-5 meals.'),
          h('button.btn.small.ghost', { type: 'button', onclick: () => { state.profile.proteinGoal = mid; save(); toast('Protein goal set to ' + mid + ' g.', 'good'); } }, 'Use ' + mid + ' g as my goal'));
      });
    },
    whtr() {
      const d = { cm: state.profile.heightCm, waist: lastMeasure('waist') };
      return calcBox(h('div', heightInputs(d), lengthInput(d, 'waist', 'Waist (at navel)')), () => {
        if (!(d.waist > 0)) return h('p.muted', 'Enter your waist measurement.');
        const r = Calc.waistToHeight(d.waist, d.cm);
        return h('div', big(r.toFixed(2), r < 0.4 ? 'Low' : r < 0.5 ? 'Healthy' : r < 0.6 ? 'Increased risk' : 'High risk', 'Keep your waist under half your height: under ' + U.l(d.cm / 2, 0) + ' ' + U.lUnit() + '.'));
      });
    },
  };

  /* ===================================================================
     PROGRESS
     =================================================================== */
  function screenProgress() {
    const d = derived();
    const t = d.t;
    main.appendChild(h('header.page-head', h('h1', 'Progress'), h('p.muted', 'Proof the work is working.')));
    const month = t.slice(0, 7);
    main.appendChild(h('div.tiles',
      tile('🏋️', state.workouts.length, 'workouts'), tile('📅', state.workouts.filter((w) => w.d.slice(0, 7) === month).length, 'this month'),
      tile('🏆', d.recs.count, 'PRs'), tile('🔥', d.st.best, 'best streak'),
      tile('🧱', U.w(d.sum.volume, 0), U.wUnit() + ' lifted'), tile('👟', U.d(d.sum.km, 1), U.dUnit() + ' cardio')));

    main.appendChild(heatmap(t));

    // ---- exercise chart ----
    const used = {};
    state.workouts.forEach((w) => w.ex.forEach((e) => { used[e.id] = (used[e.id] || 0) + 1; }));
    const exIds = Object.keys(used).sort((a, b) => used[b] - used[a]);
    if (exIds.length) {
      let cur = exIds[0];
      const canvas = h('canvas.chart', { 'aria-label': 'Exercise progress chart', role: 'img' });
      const note = h('p.muted.small');
      const draw = () => {
        const info = Ex.get(cur);
        const kind = info.type === 'w' ? 'e1rm' : info.type === 'b' ? 'r' : info.type === 't' ? 't' : info.type === 'c' ? 'km' : 'min';
        const pts = [];
        G.sortedWorkouts(state).forEach((w) => w.ex.forEach((e) => {
          if (e.id !== cur) return;
          let top = 0; e.s.forEach((s) => { top = Math.max(top, G.setValue(kind, s)); });
          if (top > 0) pts.push([G.dayNum(w.d), kind === 'e1rm' ? parseFloat(U.w(top)) : kind === 'km' ? parseFloat(U.d(top)) : top]);
        }));
        const goal = state.goals.find((g) => g.type === 'lift' && g.ex === cur && !g.done);
        Charts.line(canvas, [{ points: pts }], { fmtX: (n) => fmtDate(G.fromDayNum(n), { month: 'short', day: 'numeric' }), target: goal ? parseFloat(U.w(goal.target)) : undefined, empty: 'Log this exercise to see a trend' });
        note.textContent = { e1rm: 'Best estimated 1-rep max per session (' + U.wUnit() + ').', r: 'Most reps in a set.', t: 'Longest hold (seconds).', km: 'Longest distance (' + U.dUnit() + ').', min: 'Minutes.' }[kind] + (goal ? ' Dashed line: your goal.' : '');
      };
      main.appendChild(h('div.card', h('div.card-title', 'Exercise progress'),
        select(exIds.map((id) => [id, Ex.get(id).name + ' (' + used[id] + ')']), cur, (v) => { cur = v; draw(); }, 'Exercise'), canvas, note));
      requestAnimationFrame(draw);
      onResize(draw);
    }

    // ---- bodyweight ----
    const bw = state.body.filter((b) => b.w).sort((a, b) => (a.d < b.d ? -1 : 1));
    const bwCanvas = h('canvas.chart', { 'aria-label': 'Bodyweight chart', role: 'img' });
    const drawBw = () => {
      const pts = bw.map((b) => [G.dayNum(b.d), parseFloat(U.w(b.w))]);
      const avg = Calc.movingAverage(pts.map((p) => p[1]), 7).map((v, i) => [pts[i][0], v]);
      const goal = state.goals.find((g) => g.type === 'weight' && !g.done);
      Charts.line(bwCanvas, [{ points: pts, color: '--muted', width: 1, dots: true }, { points: pts.length > 2 ? avg : [], color: '--accent', width: 3, dots: false }],
        { fmtX: (n) => fmtDate(G.fromDayNum(n), { month: 'short', day: 'numeric' }), target: goal ? parseFloat(U.w(goal.target)) : undefined, empty: 'Log your weight to see the trend' });
    };
    const latest = bw[bw.length - 1];
    const weekAgo = bw.filter((b) => b.d <= G.addDays(t, -7)).pop();
    main.appendChild(h('div.card', h('div.card-title', 'Bodyweight', h('button.btn.small', { type: 'button', onclick: weighIn }, '+ Log')),
      latest ? h('div.big-stat', U.wFmt(latest.w), weekAgo ? h('small', ' ' + (latest.w - weekAgo.w >= 0 ? '+' : '') + U.w(latest.w - weekAgo.w) + ' vs last week') : null) : null,
      bwCanvas, h('p.muted.small', 'Dots are weigh-ins; the line is the 7-entry average, which hides day-to-day water swings.'),
      h('button.link-btn', { type: 'button', onclick: bodyLog }, 'Measurements & body log')));
    requestAnimationFrame(drawBw);
    onResize(drawBw);

    // ---- weekly workouts ----
    const wkCanvas = h('canvas.chart.short', { 'aria-label': 'Workouts per week', role: 'img' });
    const counts = G.weekCounts(state);
    const drawWk = () => {
      const list = [];
      for (let i = 11; i >= 0; i--) { const wk = G.addDays(d.st.weekStart, -7 * i); list.push({ label: fmtDate(wk, { month: 'numeric', day: 'numeric' }), value: counts[wk] || 0, color: (counts[wk] || 0) >= d.st.goal ? '--accent' : '--muted' }); }
      Charts.bars(wkCanvas, list, { goal: d.st.goal, min: d.st.goal });
    };
    main.appendChild(h('div.card', h('div.card-title', 'Workouts per week'), wkCanvas, h('p.muted.small', 'Dashed line: your weekly goal of ' + d.st.goal + '. Green weeks count toward your streak.')));
    requestAnimationFrame(drawWk);
    onResize(drawWk);

    // ---- muscle groups this week ----
    const gCanvas = h('canvas.chart.short', { 'aria-label': 'Sets per muscle group', role: 'img' });
    const drawG = () => {
      const from = G.addDays(t, -6);
      const sets = {};
      state.workouts.filter((w) => w.d >= from).forEach((w) => w.ex.forEach((e) => { const g = Ex.get(e.id).group; sets[g] = (sets[g] || 0) + e.s.length; }));
      Charts.bars(gCanvas, Ex.GROUPS.filter((g) => g[0] !== 'cardio' && g[0] !== 'mobility').map((g) => ({ label: g[1].slice(0, 4), value: sets[g[0]] || 0, color: (sets[g[0]] || 0) >= 10 ? '--accent' : '--accent2' })), { min: 10, goal: 10 });
    };
    main.appendChild(h('div.card', h('div.card-title', 'Sets per muscle, last 7 days'), gCanvas, h('p.muted.small', '10+ hard sets per muscle per week is a well-supported target for growth.')));
    requestAnimationFrame(drawG);
    onResize(drawG);

    // ---- PR board ----
    const board = Object.keys(d.recs.best).filter((id) => used[id]).sort((a, b) => used[b] - used[a]).slice(0, 30);
    if (board.length) {
      main.appendChild(h('div.card', h('div.card-title', 'Personal records'), h('div.pr-board', board.map((id) => {
        const info = Ex.get(id), b = d.recs.best[id];
        const kinds = (G.PR_KINDS[info.type] || []).filter((k) => b[k[0]]);
        return h('div.pr-cell', h('strong', info.name), kinds.map((k) => h('div', h('span.muted', k[1] + ': '), prValue(id, k[0], b[k[0]].v))));
      }))));
    }

    // ---- achievements ----
    const earned = state.badges;
    main.appendChild(h('div.card', h('div.card-title', 'Achievements', h('span.muted', Object.keys(earned).length + ' / ' + G.BADGES.length)),
      h('div.badges', G.BADGES.map((b) => h('div.badge' + (earned[b[0]] ? '.got' : ''), { title: b[3] + (earned[b[0]] ? ' Earned ' + fmtDate(earned[b[0]]) : '') },
        h('span.badge-icon', earned[b[0]] ? b[1] : '🔒'), h('strong', b[2]), h('span.muted', earned[b[0]] ? fmtDate(earned[b[0]], { month: 'short', day: 'numeric' }) : b[3]))))));
  }

  function tile(icon, v, label) { return h('div.tile', h('span.tile-icon', icon), h('strong', String(v)), h('span.muted', label)); }

  let resizeFns = [];
  function onResize(fn) { resizeFns.push(fn); }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => resizeFns.forEach((f) => f()), 150); });
  window.addEventListener('hashchange', () => { resizeFns = []; });

  function heatmap(t) {
    const weeks = 26;
    const start = G.addDays(G.weekStart(t), -7 * (weeks - 1));
    const byDay = {};
    state.workouts.forEach((w) => { byDay[w.d] = (byDay[w.d] || 0) + Math.max(1, G.setsOf(w)); });
    const grid = h('div.heat', { role: 'img', 'aria-label': 'Training calendar for the last 26 weeks' });
    for (let wk = 0; wk < weeks; wk++) {
      const col = h('div.heat-col');
      for (let i = 0; i < 7; i++) {
        const day = G.addDays(start, wk * 7 + i);
        const v = byDay[day] || 0;
        const lvl = !v ? 0 : v < 8 ? 1 : v < 16 ? 2 : v < 24 ? 3 : 4;
        col.appendChild(h('span.hc.l' + lvl + (day > t ? '.future' : ''), { title: fmtDate(day) + (v ? ': ' + v + ' sets' : '') }));
      }
      grid.appendChild(col);
    }
    return h('div.card', h('div.card-title', 'Last 6 months'), h('div.heat-wrap', grid), h('div.heat-legend.muted', 'Less ', [0, 1, 2, 3, 4].map((l) => h('span.hc.l' + l)), ' More'));
  }

  /* ---------- body log ---------- */
  function addBody(entry) {
    const t = today();
    let row = state.body.find((b) => b.d === t);
    if (!row) { row = { d: t }; state.body.push(row); }
    Object.keys(entry).forEach((k) => { if (entry[k] !== undefined && entry[k] !== '' && isFinite(entry[k])) row[k] = Math.round(entry[k] * 1000) / 1000; });
    if (entry.w) state.profile.weightKg = entry.w;
    save(); settleRewards();
  }

  function weighIn() {
    const i = numIn(U.w(currentWeight() || state.profile.weightKg), 'Weight');
    const dIn = h('input', { type: 'date', value: today(), max: today() });
    const m = modal('Log weight', h('div', field('Weight (' + U.wUnit() + ')', i), field('Date', dIn), h('p.muted.small', 'Weigh at the same time each day, ideally after waking. Trends matter, single days do not.')),
      { actions: [h('button.btn', { type: 'button', onclick: () => {
        const kg = U.wIn(i.value);
        if (!(kg > 20 && kg < 400)) { toast('Check that weight.', 'warn'); return; }
        const dd = dIn.value || today();
        let row = state.body.find((b) => b.d === dd);
        if (!row) { row = { d: dd }; state.body.push(row); }
        row.w = Math.round(kg * 1000) / 1000;
        // The profile weight follows the most recent weigh-in, not the one just typed:
        // back-filling last Tuesday must not overwrite this morning's number.
        state.profile.weightKg = G.latestBodyweight(state);
        save(); settleRewards(); m.close(); render(); toast('Weight logged (+5 XP).', 'good');
      } }, 'Save')] });
  }

  function lastMeasure(k) { const r = state.body.filter((b) => b[k]).sort((a, b) => (a.d < b.d ? -1 : 1)).pop(); return r ? r[k] : undefined; }

  function bodyLog() {
    const keys = [['waist', 'Waist'], ['chest', 'Chest'], ['hips', 'Hips'], ['arm', 'Arm'], ['thigh', 'Thigh'], ['neck', 'Neck']];
    const d = {};
    const rows = state.body.slice().sort((a, b) => (a.d < b.d ? 1 : -1)).slice(0, 30);
    const m = modal('Body log', h('div',
      h('p.muted.small', 'Add today\'s measurements. Leave blank anything you didn\'t measure.'),
      h('div.row3', keys.map((k) => { const i = numIn('', k[1]); i.placeholder = lastMeasure(k[0]) ? U.l(lastMeasure(k[0])) : ''; i.addEventListener('input', () => { d[k[0]] = U.lIn(i.value); }); return field(k[1] + ' (' + U.lUnit() + ')', i); })),
      h('button.btn', { type: 'button', onclick: () => { if (!Object.keys(d).some((k) => d[k] > 0)) { toast('Enter at least one measurement.', 'warn'); return; } addBody(d); m.close(); toast('Measurements saved.', 'good'); } }, 'Save measurements'),
      rows.length ? h('table.tbl.small', h('thead', h('tr', h('th', 'Date'), h('th', U.wUnit()), keys.map((k) => h('th', k[1])), h('th', 'BF%'), h('th', ''))),
        h('tbody', rows.map((r) => h('tr', h('td', fmtDate(r.d, { month: 'short', day: 'numeric' })), h('td', r.w ? U.w(r.w) : ''), keys.map((k) => h('td', r[k[0]] ? U.l(r[k[0]]) : '')), h('td', r.bf || ''),
          h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Delete entry', onclick: () => { state.body = state.body.filter((x) => x !== r); save(); m.close(); bodyLog(); } }, '✕')))))) : null));
  }

  /* ===================================================================
     ME: profile, settings, sync, data
     =================================================================== */
  function screenMe() {
    const p = state.profile, st = state.settings;
    main.appendChild(h('header.page-head', h('h1', 'Me'), h('p.muted', 'Profile, settings, reminders and your data.')));
    const d = derived();
    main.appendChild(h('div.card.me-card', h('div.avatar', (p.name || 'You').charAt(0).toUpperCase()),
      h('div.grow', h('strong', p.name || 'Athlete'), h('div.muted', 'Level ' + d.lvl.level + ' ' + d.lvl.title + ' · ' + fmtInt(d.xp.total) + ' XP')),
      h('button.btn.small.ghost', { type: 'button', onclick: () => { p.onboarded = false; save(); go('today'); } }, 'Redo setup')));

    const set = (k, v) => { p[k] = v; save(); };
    const nameIn = h('input', { type: 'text', value: p.name, maxlength: 40, onchange: (e) => set('name', e.target.value.trim()) });
    const wIn = numIn(U.w(p.weightKg, 0), 'Weight'); wIn.addEventListener('change', () => { const kg = U.wIn(wIn.value); if (kg) set('weightKg', kg); });
    const hd = { cm: p.heightCm };
    const hBox = heightInputs(hd); hBox.addEventListener('change', () => set('heightCm', hd.cm));
    main.appendChild(h('div.card', h('div.card-title', 'Profile'),
      field('Name', nameIn),
      field('Units', seg([['imperial', 'lb / mi / in'], ['metric', 'kg / km / cm']], p.units, (v) => { set('units', v); U.set(v); render(); })),
      h('div.row2', field('Sex', seg([['m', 'Male'], ['f', 'Female']], p.sex, (v) => set('sex', v))), field('Birth year', (() => { const i = numIn(p.birthYear, 'Birth year'); i.addEventListener('change', () => { const y = parseInt(i.value, 10); if (y > 1900 && y < 2020) set('birthYear', y); }); return i; })())),
      hBox, field('Weight (' + U.wUnit() + ')', wIn, 'Logging weight in Progress keeps this up to date.'),
      field('Activity level', select(Calc.ACTIVITY.map((a) => [a[0], a[1]]), p.activity, (v) => set('activity', parseFloat(v))))));

    const goalStepper = (k, step, label, conv, back) => field(label, stepper(conv ? conv(p[k]) : p[k], step, (v) => { const n = parseFloat(v); if (n > 0) { p[k] = back ? back(n) : n; save(); renderChrome(); } }, { min: step }));
    main.appendChild(h('div.card', h('div.card-title', 'Targets'),
      goalStepper('weeklyGoal', 1, 'Workouts per week (streak goal)'),
      h('div.row2', goalStepper('waterGoal', 1, 'Water (glasses)'), goalStepper('proteinGoal', 5, 'Protein (g)')),
      h('div.row2', goalStepper('sleepGoal', 0.5, 'Sleep (hours)'), goalStepper('stepsGoal', 500, 'Steps'))));

    const ntfState = !('Notification' in window) ? 'unsupported' : Notification.permission;
    main.appendChild(h('div.card', h('div.card-title', 'Workout & reminders'),
      field('Default rest between sets', select([[45, '45 s'], [60, '1:00'], [90, '1:30'], [120, '2:00'], [180, '3:00'], [240, '4:00']], st.rest, (v) => { st.rest = +v; save(); })),
      h('label.toggle', h('input', { type: 'checkbox', checked: st.sound, onchange: (e) => { st.sound = e.target.checked; save(); if (st.sound) beep(1); } }), h('span', 'Rest-timer sound')),
      h('label.toggle', h('input', { type: 'checkbox', checked: st.vibrate, onchange: (e) => { st.vibrate = e.target.checked; save(); } }), h('span', 'Vibrate (Android)')),
      h('label.toggle', h('input', { type: 'checkbox', checked: st.remind && ntfState === 'granted', disabled: ntfState === 'unsupported' || ntfState === 'denied', onchange: async (e) => {
        if (e.target.checked && Notification.permission !== 'granted') {
          const r = await Notification.requestPermission();
          if (r !== 'granted') { e.target.checked = false; toast('Notifications were blocked in your browser settings.', 'warn'); return; }
        }
        st.remind = e.target.checked; save();
        if (st.remind) notify('Reminders are on', 'SlipFit will nudge you at ' + st.remindTime + ' on training days.');
      } }), h('span', 'Workout reminder notification')),
      field('Reminder time', h('input', { type: 'time', value: st.remindTime, onchange: (e) => { st.remindTime = e.target.value || '18:00'; save(); } })),
      h('p.muted.small', ntfState === 'denied' ? 'Notifications are blocked for this site in your browser settings.' : ntfState === 'unsupported' ? 'This browser does not support notifications. Use the calendar file below.'
        : 'Browser reminders fire while SlipFit is open or installed. For a reminder that always fires, add your training days to your phone calendar:'),
      h('button.btn.ghost', { type: 'button', onclick: exportIcs, disabled: !state.plan }, '📅 Add training days to my calendar (.ics)')));

    // ---- sync ----
    const syncBox = h('div.card', h('div.card-title', 'Sync across devices'));
    main.appendChild(syncBox);
    drawSync(syncBox);

    // ---- theme + data ----
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: importBackup });
    main.appendChild(h('div.card', h('div.card-title', 'Appearance & data'),
      field('Theme', seg([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.theme, (v) => { st.theme = v; save(); applyTheme(); })),
      h('div.btn-row', h('button.btn.ghost', { type: 'button', onclick: exportBackup }, '⬇ Export backup'), h('button.btn.ghost', { type: 'button', onclick: () => fileIn.click() }, '⬆ Import backup'), fileIn),
      h('p.muted.small', 'A backup is a JSON file with everything you have logged. Keep one somewhere safe now and then.'),
      h('button.btn.ghost.danger', { type: 'button', onclick: async () => {
        if (await confirmBox('Erase everything?', 'This deletes every workout, goal, badge and setting in this browser. Export a backup first if you might want it back.', 'Erase all data', true)) {
          store.replace(S.defaults()); state = store.state; toast('All data erased.'); go('today');
        }
      } }, 'Erase all data')));

    main.appendChild(h('div.card', h('div.card-title', 'About SlipFit'),
      h('p', 'Version ' + VERSION + ' · ', h('button.link-btn', { type: 'button', onclick: () => whatsNew(true) }, 'What\'s new')),
      h('p.muted.small', 'SlipFit is a training log and planning tool, not medical advice. Check with a doctor before starting a new exercise or diet program, especially with an injury or health condition. Stop if something hurts.'),
      h('div.btn-row', h('a.btn.ghost', { href: feedbackUrl('me'), target: '_blank', rel: 'noopener' }, '💬 Send feedback'), h('a.btn.ghost', { href: 'https://projects.slippylabs.com/' }, '← More projects'))));
  }

  async function drawSync(box) {
    while (box.childNodes.length > 1) box.removeChild(box.lastChild);
    const status = h('p.muted.small#sync-status');
    if (!window.LabAccount) { box.appendChild(h('p.muted', 'The account service could not be reached, so sync is unavailable right now. Everything still works in this browser.')); return; }
    const user = store.syncUser;
    if (!user) {
      box.appendChild(h('p', 'Sign in with your slippylabs account to keep your log on your phone and computer at the same time.'));
      box.appendChild(h('a.btn', { href: 'https://admin.slippylabs.com/login?next=' + encodeURIComponent(location.href) }, 'Sign in'));
      return;
    }
    const sz = store.sizes();
    const pct = Math.max(sz.main, sz.log) / sz.max;
    box.appendChild(h('p', 'Signed in as ', h('strong', user), '.'));
    box.appendChild(h('label.toggle', h('input', { type: 'checkbox', checked: store.syncOn, onchange: async (e) => {
      if (!e.target.checked && !(await confirmBox('Turn off sync?', 'Your account copy will be cleared. This browser keeps everything.', 'Turn off'))) { e.target.checked = true; return; }
      await store.setSync(e.target.checked); state = store.state; render();
    } }), h('span', 'Sync my data to this account')));
    if (store.syncOn) box.appendChild(h('button.btn.small.ghost', { type: 'button', onclick: async () => { await store.pull(); state = store.state; } }, 'Sync now'));
    box.appendChild(h('div.muted.small', 'Storage used: ' + Math.round(pct * 100) + '% of the account limit' + (pct > 0.8 ? '. Getting full: export a backup.' : '.')));
    box.appendChild(status);
  }

  store.onStatus((msg, err) => {
    const el = $('sync-status');
    if (el) { el.textContent = msg; el.classList.toggle('err', !!err); }
    else if (err) toast(msg, 'warn', 5000);
  });

  function exportBackup() {
    const copy = JSON.parse(JSON.stringify(state));
    copy.active = null;
    download('slipfit-backup-' + today() + '.json', JSON.stringify({ app: 'slipfit', version: VERSION, exported: new Date().toISOString(), state: copy }, null, 1), 'application/json');
  }

  function importBackup(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      let data;
      try { data = JSON.parse(rd.result); } catch (err) { toast('That file is not a SlipFit backup.', 'warn'); return; }
      const s = data && data.app === 'slipfit' ? data.state : null;
      if (!s || !Array.isArray(s.workouts)) { toast('That file is not a SlipFit backup.', 'warn'); return; }
      if (!(await confirmBox('Replace your data?', 'Import ' + s.workouts.length + ' workouts from ' + (data.exported || '').slice(0, 10) + '? This replaces what is in this browser now.', 'Import'))) return;
      store.replace(s); state = store.state; U.set(state.profile.units); toast('Backup imported.', 'good'); render();
    };
    rd.readAsText(f);
    e.target.value = '';
  }

  /* .ics with one weekly event per training day; the alarm is the reminder. */
  function exportIcs() {
    const p = state.plan;
    if (!p || !p.schedule.length) return;
    const code = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const tm = (state.settings.remindTime || '18:00').replace(':', '') + '00';
    const first = nextScheduledDate(today()) || today();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const dur = Math.max(20, state.profile.minutes || 45);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//slippylabs//SlipFit ' + VERSION + '//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT', 'UID:slipfit-' + p.id + '@fit.slippylabs.com', 'DTSTAMP:' + stamp, 'DTSTART:' + first.replace(/-/g, '') + 'T' + tm,
      'DURATION:PT' + dur + 'M', 'RRULE:FREQ=WEEKLY;BYDAY=' + p.schedule.slice().sort().map((d) => code[d]).join(','),
      'SUMMARY:' + esc('🏋️ Workout: ' + p.name), 'DESCRIPTION:' + esc('Open SlipFit to see today\'s session: https://fit.slippylabs.com/'), 'URL:https://fit.slippylabs.com/',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc('Time to train'), 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
    download('slipfit-training-days.ics', lines.join('\r\n') + '\r\n', 'text/calendar');
    toast('Open the downloaded file to add it to your calendar.', 'good');
  }

  /* ---------- notifications ---------- */
  async function notify(title, body) {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) reg.showNotification(title, { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'slipfit' });
      else new Notification(title, { body: body, icon: 'icons/icon-192.png' });
    } catch (e) { /* notifications unavailable */ }
  }

  function reminderCheck() {
    const st = state.settings;
    if (!st.remind || !state.plan) return;
    const t = today();
    const now = new Date();
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    if (hhmm < st.remindTime) return;
    if (state.plan.schedule.indexOf(G.weekday(t)) < 0 || state.workouts.some((w) => w.d === t) || state.active) return;
    let last = '';
    try { last = localStorage.getItem('slipfit-reminded') || ''; } catch (e) { /* ignore */ }
    if (last === t) return;
    try { localStorage.setItem('slipfit-reminded', t); } catch (e) { /* ignore */ }
    const nx = nextPlanDay();
    const s = G.streaks(state, t);
    notify('Time to train: ' + (nx ? nx.day.name : 'workout'), s.current ? 'Keep your ' + s.current + '-week 🔥 streak going.' : 'Your session is ready in SlipFit.');
  }
  setInterval(reminderCheck, 30000);

  /* ---------- feedback ---------- */
  function feedbackUrl(screen) {
    const details = 'What happened / what would make this better:\n\n\n---\nSlipFit v' + VERSION + ' · screen: ' + screen + ' · ' + (window.innerWidth + '×' + window.innerHeight) + ' · ' + navigator.userAgent;
    return 'https://slippylabs.com/report.html?project=fit&title=' + encodeURIComponent('[v' + VERSION + '] ') + '&details=' + encodeURIComponent(details);
  }
  $('feedback-btn').addEventListener('click', () => window.open(feedbackUrl(route), '_blank', 'noopener'));

  /* ---------- what's new ---------- */
  function whatsNew(force) {
    const log = window.FitChangelog;
    const seen = state.seenVersion;
    const fresh = force ? log : log.filter((e) => !seen || cmpVer(e.v, seen) > 0);
    if (!fresh.length) return;
    modal(force ? 'Release notes' : 'What\'s new in SlipFit', h('div', fresh.map((e) => h('div.release', h('div.release-head', h('strong', 'v' + e.v + ' · ' + e.title), h('span.muted', fmtDate(e.d, { month: 'short', day: 'numeric', year: 'numeric' }))),
      h('ul', e.items.map((i) => h('li', i)))))), { onClose: () => { state.seenVersion = VERSION; save({ local: true }); } });
  }
  function cmpVer(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

  /* ---------- theme ---------- */
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  /* ---------- the sitewide floating deck sits in a bottom corner; on a phone
     lift it above this app's tab bar instead of over the Progress tab. ---------- */
  function liftDeck() {
    const host = document.getElementById('slippy-deck-root');
    if (!host || !host.shadowRoot || host.shadowRoot.getElementById('fit-lift')) return !!host;
    const st = document.createElement('style');
    st.id = 'fit-lift';
    st.textContent = '@media (max-width: 899px) { .wrap:not(.open) { bottom: calc(80px + env(safe-area-inset-bottom)) !important; } body.resting .wrap:not(.open) { bottom: calc(140px + env(safe-area-inset-bottom)) !important; } }';
    host.shadowRoot.appendChild(st);
    return true;
  }
  new MutationObserver(() => liftDeck()).observe(document.body, { childList: true });

  /* ---------- boot ---------- */
  applyTheme();
  store.onChange(() => { state = store.state; });
  $('active-pill').addEventListener('click', () => go('train'));
  render();
  settleRewards(true);
  if (state.profile.onboarded) setTimeout(() => whatsNew(false), 600);
  store.initSync().then((user) => { state = store.state; U.set(state.profile.units); if (user) render(); });
  reminderCheck();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  // Test hook: lets the browser suite drive and inspect the app headlessly.
  window.__fit = { store: store, get state() { return state; }, render: render, go: go, derived: derived, settleRewards: settleRewards, suggest: suggest, goalProgress: goalProgress, version: VERSION };
})();
