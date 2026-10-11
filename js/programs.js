/* SlipFit programs: the built-in library and the plan generator.
 *
 * A plan is plain data, saved into the user's state when chosen:
 *   { id, name, goal, desc, mode: 'cycle' | 'sequence', perWeek, schedule: [weekday...],
 *     days: [{ name, note?, items: [{ ex, sets, lo, hi, rest, min?, note? }] }] }
 *
 * mode 'cycle' repeats days in order forever (lifting splits). mode 'sequence'
 * walks through days once and then the plan is finished (Couch to 5K).
 * lo/hi are reps for 'w'/'b' exercises and seconds for 't'; cardio/mobility
 * items carry `min` instead. Nothing here touches the DOM.
 */
(function (root) {
  'use strict';
  const Ex = (typeof module !== 'undefined' && module.exports) ? require('./exercises.js') : root.FitEx;

  const EQUIP_SETS = {
    gym: ['barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'band', 'bodyweight', 'cardio'],
    home: ['dumbbell', 'kettlebell', 'band', 'bodyweight', 'cardio'],
    bodyweight: ['bodyweight', 'cardio'],
  };

  // JS weekday numbers, Sunday = 0. Spread so no two lifting days are always back to back.
  const DEFAULT_SCHEDULE = {
    1: [3], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6],
  };

  const ISOLATION = new Set(['lat_raise', 'bicep', 'tricep', 'rear_delt', 'calf', 'chest_iso', 'quad_iso', 'ham_iso', 'shrug']);
  const COMPOUND = new Set(['squat', 'hinge', 'hpush', 'vpush', 'hpull', 'vpull', 'lunge']);
  // Moves a beginner is better off building toward than starting with.
  const HARD = new Set(['pullup', 'chinup', 'dips', 'front-squat', 'nordic', 'hanging-raise', 'ab-wheel', 'pike-pushup', 'jump-squat', 'sumo-dl']);

  const EASIER = {
    pullup: 'Can\'t do one yet? Jump to the top and lower yourself as slowly as you can; each lowering is a rep.',
    chinup: 'Can\'t do one yet? Jump to the top and lower yourself as slowly as you can; each lowering is a rep.',
    'pike-pushup': 'Too hard? Lower your hips and bend less at the waist; it gets easier the more upright you are.',
    dips: 'Too hard? Do bench dips with your feet on the floor instead.',
  };

  const SPLITS = {
    fullA: ['Full Body A', ['squat', 'hpush', 'hpull', 'lat_raise', 'core', 'bicep', 'calf']],
    fullB: ['Full Body B', ['hinge', 'vpush', 'vpull', 'lunge', 'tricep', 'core', 'rear_delt']],
    fullC: ['Full Body C', ['squat', 'hpush', 'hpull', 'glute', 'rear_delt', 'core', 'calf']],
    upperA: ['Upper A', ['hpush', 'hpull', 'vpush', 'vpull', 'lat_raise', 'bicep', 'tricep']],
    lowerA: ['Lower A', ['squat', 'hinge', 'lunge', 'ham_iso', 'calf', 'core']],
    upperB: ['Upper B', ['vpush', 'vpull', 'hpush', 'hpull', 'rear_delt', 'tricep', 'bicep']],
    lowerB: ['Lower B', ['hinge', 'squat', 'glute', 'quad_iso', 'calf', 'core']],
    push: ['Push', ['hpush', 'vpush', 'hpush', 'lat_raise', 'tricep', 'chest_iso', 'tricep']],
    pull: ['Pull', ['vpull', 'hpull', 'hpull', 'rear_delt', 'bicep', 'shrug', 'bicep']],
    legs: ['Legs', ['squat', 'hinge', 'lunge', 'ham_iso', 'quad_iso', 'calf', 'core']],
    upper: ['Upper', ['hpush', 'hpull', 'vpush', 'vpull', 'lat_raise', 'bicep', 'tricep']],
    lower: ['Lower', ['squat', 'hinge', 'lunge', 'ham_iso', 'calf', 'core']],
  };

  const SPLIT_FOR_DAYS = {
    1: ['fullA'], 2: ['fullA', 'fullB'], 3: ['fullA', 'fullB', 'fullC'], 4: ['upperA', 'lowerA', 'upperB', 'lowerB'],
    5: ['upper', 'lower', 'push', 'pull', 'legs'], 6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
    7: ['push', 'pull', 'legs', 'push', 'pull', 'legs', 'fullA'],
  };

  // Exercises per session by length in minutes.
  function itemCount(minutes) {
    if (minutes <= 30) return 4;
    if (minutes <= 45) return 5;
    if (minutes <= 60) return 6;
    return 7;
  }

  function candidates(pattern, equip, experience) {
    const allowed = EQUIP_SETS[equip] || EQUIP_SETS.gym;
    const list = Ex.LIST.filter((e) => !e.custom && e.pattern === pattern && allowed.indexOf(e.equip) >= 0);
    // Stable re-rank: timed holds and (for beginners) hard moves go to the back,
    // but are still used rather than leaving the slot empty.
    const rank = (e) => (e.type === 't' && pattern !== 'core' ? 2 : 0) + (experience === 'beginner' && HARD.has(e.id) ? 1 : 0);
    return list.map((e, i) => [e, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((p) => p[0]);
  }

  function prescription(goal, pattern, ex, slotIndex, equip) {
    if (ex.type === 't') return { sets: 3, lo: 30, hi: 60, rest: 60 };
    if (ex.type === 'c' || ex.type === 'm') return { sets: 1, min: 10, rest: 0 };
    const iso = ISOLATION.has(pattern) || pattern === 'core' || pattern === 'glute';
    const main = slotIndex < 2 && COMPOUND.has(pattern);
    if (ex.type === 'b' && equip === 'bodyweight') return { sets: 3, lo: iso ? 12 : 8, hi: iso ? 20 : 15, rest: 60 };
    if (pattern === 'core') return { sets: 3, lo: 10, hi: 15, rest: 60 };
    switch (goal) {
      case 'strength':
        return main ? { sets: 5, lo: 3, hi: 5, rest: 180 } : iso ? { sets: 3, lo: 10, hi: 15, rest: 75 } : { sets: 3, lo: 6, hi: 10, rest: 120 };
      case 'muscle':
        return main ? { sets: 4, lo: 6, hi: 10, rest: 120 } : iso ? { sets: 3, lo: 10, hi: 15, rest: 60 } : { sets: 3, lo: 8, hi: 12, rest: 90 };
      case 'lose':
        return iso ? { sets: 3, lo: 12, hi: 15, rest: 45 } : { sets: 3, lo: 10, hi: 15, rest: 60 };
      default:
        return iso ? { sets: 3, lo: 10, hi: 15, rest: 60 } : { sets: 3, lo: 8, hi: 12, rest: 90 };
    }
  }

  function buildDay(splitKey, opts, occurrences) {
    const def = SPLITS[splitKey];
    const n = itemCount(opts.minutes || 45) - (opts.goal === 'lose' && (opts.minutes || 45) >= 45 ? 1 : 0);
    // Walk the whole slot list and stop at n filled: a slot with no exercise for
    // this equipment (no lateral raise without weights) hands its place on.
    const slots = def[1];
    const used = new Set();
    const items = [];
    slots.forEach((pattern) => {
      if (items.length >= n) return;
      const i = items.length;
      const c = candidates(pattern, opts.equip, opts.experience);
      if (!c.length) return;
      // Rotate variants each time a pattern recurs in the plan, so Upper A and
      // Upper B don't repeat the same press -- except the main lifts of a
      // strength plan, which you want to practise every session.
      const seen = occurrences[pattern] || 0;
      occurrences[pattern] = seen + 1;
      const keepMain = opts.goal === 'strength' && i < 2;
      let k = keepMain ? 0 : seen;
      let ex = null;
      for (let t = 0; t < c.length; t++) {
        const e = c[(k + t) % c.length];
        if (!used.has(e.id)) { ex = e; break; }
      }
      if (!ex) return;
      used.add(ex.id);
      const rx = prescription(opts.goal, pattern, ex, i, opts.equip);
      if (opts.experience === 'beginner' && HARD.has(ex.id) && ex.type === 'b') {
        // Nothing easier fits this slot with this equipment, so make it doable.
        Object.assign(rx, { lo: 3, hi: 8, note: EASIER[ex.id] || 'Start with whatever range you can control and build toward the full move.' });
      }
      items.push(Object.assign({ ex: ex.id }, rx));
    });
    if (opts.goal === 'lose' && (opts.minutes || 45) >= 45) {
      items.push({ ex: opts.equip === 'gym' ? 'hiit' : 'burpee', sets: opts.equip === 'gym' ? 1 : 3,
        min: opts.equip === 'gym' ? 10 : undefined, lo: 10, hi: 15, rest: 45, note: 'Finisher: keep it hard and short.' });
    }
    return { name: def[0], items: items };
  }

  const GOAL_NAMES = { muscle: 'Build Muscle', strength: 'Get Stronger', lose: 'Lose Fat', general: 'General Fitness', run: 'Run' };

  function generate(opts) {
    opts = Object.assign({ goal: 'general', days: 3, minutes: 45, equip: 'gym', experience: 'beginner' }, opts || {});
    const days = Math.max(1, Math.min(7, opts.days | 0));
    if (opts.goal === 'run') return runPlan(opts, days);
    const occurrences = {};
    const plan = {
      name: GOAL_NAMES[opts.goal] + ' · ' + days + '×/week',
      goal: opts.goal, mode: 'cycle', perWeek: days, schedule: DEFAULT_SCHEDULE[days].slice(),
      desc: describe(opts, days),
      days: SPLIT_FOR_DAYS[days].map((k) => buildDay(k, opts, occurrences)),
      gen: { goal: opts.goal, days: days, minutes: opts.minutes, equip: opts.equip, experience: opts.experience },
    };
    // Six-day PPL repeats Push/Pull/Legs; give the second round distinct names.
    const seen = {};
    plan.days.forEach((d) => { seen[d.name] = (seen[d.name] || 0) + 1; if (seen[d.name] > 1) d.name += ' 2'; });
    return plan;
  }

  function describe(opts, days) {
    const split = days <= 3 ? 'full-body sessions' : days === 4 ? 'an upper/lower split' : days === 5 ? 'upper, lower, push, pull and legs' : 'push / pull / legs twice through';
    const how = {
      strength: 'Heavy main lifts in low reps with long rests; add weight whenever you hit the top of the range.',
      muscle: 'Moderate weights in the 6-15 rep range. When every set reaches the top of the range, add weight next time.',
      lose: 'Higher reps, short rests and a conditioning finisher to keep your heart rate up. Pair with the calorie target from the calculators.',
      general: 'Balanced strength work for every muscle group. Add reps, then weight.',
    }[opts.goal] || '';
    return days + ' days a week of ' + split + ', about ' + (opts.minutes || 45) + ' minutes each. ' + how;
  }

  /* ---------- running ---------- */

  // Couch to 5K (Josh Clark's 9-week schedule). Every run has a 5-minute walk
  // warm-up and cool-down, included in `min`.
  const C25K = [
    ['Run 60 s, walk 90 s. Repeat 8 times.', 30],
    ['Run 60 s, walk 90 s. Repeat 8 times.', 30],
    ['Run 60 s, walk 90 s. Repeat 8 times.', 30],
    ['Run 90 s, walk 2 min. Repeat 6 times.', 31],
    ['Run 90 s, walk 2 min. Repeat 6 times.', 31],
    ['Run 90 s, walk 2 min. Repeat 6 times.', 31],
    ['Twice: run 90 s, walk 90 s, run 3 min, walk 3 min.', 28],
    ['Twice: run 90 s, walk 90 s, run 3 min, walk 3 min.', 28],
    ['Twice: run 90 s, walk 90 s, run 3 min, walk 3 min.', 28],
    ['Run 3 min, walk 90 s, run 5 min, walk 2.5 min, run 3 min, walk 90 s, run 5 min.', 32],
    ['Run 3 min, walk 90 s, run 5 min, walk 2.5 min, run 3 min, walk 90 s, run 5 min.', 32],
    ['Run 3 min, walk 90 s, run 5 min, walk 2.5 min, run 3 min, walk 90 s, run 5 min.', 32],
    ['Run 5 min, walk 3 min. Repeat 3 times.', 34],
    ['Run 8 min, walk 5 min, run 8 min.', 31],
    ['Run 20 minutes without stopping.', 30],
    ['Run 5 min, walk 3 min, run 8 min, walk 3 min, run 5 min.', 34],
    ['Run 10 min, walk 3 min, run 10 min.', 33],
    ['Run 25 minutes without stopping.', 35],
    ['Run 25 minutes.', 35], ['Run 25 minutes.', 35], ['Run 25 minutes.', 35],
    ['Run 28 minutes.', 38], ['Run 28 minutes.', 38], ['Run 28 minutes.', 38],
    ['Run 30 minutes.', 40], ['Run 30 minutes.', 40], ['Run 30 minutes, or 5 km. You did it.', 40],
  ];

  function c25k() {
    return {
      name: 'Couch to 5K', goal: 'run', mode: 'sequence', perWeek: 3, schedule: DEFAULT_SCHEDULE[3].slice(),
      desc: 'Nine weeks, three runs a week, from walking to running 5 km (or 30 minutes) without stopping. Repeat a week whenever it felt too hard; there is no prize for rushing.',
      days: C25K.map((r, i) => ({
        name: 'Week ' + (Math.floor(i / 3) + 1) + ' · Run ' + (i % 3 + 1),
        items: [{ ex: /walk/.test(r[0]) ? 'run-intervals' : 'run',
          sets: 1, min: r[1], note: '5 min brisk walk, then: ' + r[0] + ' Then a 5 min walk.' }],
      })),
    };
  }

  function runPlan(opts, days) {
    if (opts.experience === 'beginner') {
      const p = c25k();
      if (days < 3) {
        // Fewer runs a week just stretches the nine weeks out; the sessions are the same.
        p.perWeek = days;
        p.schedule = DEFAULT_SCHEDULE[days].slice();
        p.desc += ' At ' + days + ' run' + (days === 1 ? '' : 's') + ' a week it takes longer, and that is fine.';
      }
      if (days > 3) {
        // Extra days become easy strength so legs and core can handle the mileage.
        p.desc += ' Your extra days are short strength sessions.';
        p.perWeek = days;
        p.schedule = DEFAULT_SCHEDULE[days].slice();
        p.mode = 'sequence';
        const s = buildDay('fullA', Object.assign({}, opts, { goal: 'general', minutes: 30 }), {});
        s.name = 'Runner Strength';
        const out = [];
        p.days.forEach((d, i) => { out.push(d); if (i % 3 === 2) for (let k = 3; k < days; k++) out.push(JSON.parse(JSON.stringify(s))); });
        p.days = out;
      }
      return p;
    }
    const runs = [
      { name: 'Easy Run', items: [{ ex: 'run', sets: 1, min: 35, note: 'Conversational pace (Zone 2).' }] },
      { name: 'Intervals', items: [{ ex: 'run', sets: 1, min: 40, note: '10 min easy, 6 × (2 min hard / 2 min jog), 6 min easy.' }] },
      { name: 'Long Run', items: [{ ex: 'run', sets: 1, min: 55, note: 'Slow and steady; add 5 minutes each week up to 90.' }] },
      { name: 'Tempo Run', items: [{ ex: 'run', sets: 1, min: 40, note: '10 min easy, 20 min comfortably hard, 10 min easy.' }] },
    ];
    const strength = buildDay('fullA', Object.assign({}, opts, { goal: 'general', minutes: 30 }), {});
    strength.name = 'Runner Strength';
    const order = days <= 2 ? [runs[0], runs[2]] : days === 3 ? [runs[0], runs[1], runs[2]]
      : days === 4 ? [runs[0], runs[1], strength, runs[2]] : days === 5 ? [runs[0], runs[1], strength, runs[3], runs[2]]
      : [runs[0], runs[1], strength, runs[0], runs[3], runs[2]].concat(days === 7 ? [{ name: 'Recovery', items: [{ ex: 'stretch', sets: 1, min: 20 }] }] : []);
    return {
      name: 'Run Builder · ' + days + '×/week', goal: 'run', mode: 'cycle', perWeek: days, schedule: DEFAULT_SCHEDULE[days].slice(),
      desc: 'Easy miles, one quality session and a long run each week. Most running should feel easy.',
      days: JSON.parse(JSON.stringify(order)),
      gen: { goal: 'run', days: days, minutes: opts.minutes, equip: opts.equip, experience: opts.experience },
    };
  }

  /* ---------- built-in library ---------- */

  function mobility() {
    return {
      name: 'Mobility & Recovery', goal: 'general', mode: 'cycle', perWeek: 3, schedule: [2, 4, 6],
      desc: 'Short sessions for stiff hips, shoulders and backs. Great alongside any plan or on rest days.',
      days: [
        { name: 'Hips & Spine', items: [{ ex: 'cat-cow', sets: 2, lo: 8, hi: 10, rest: 0 }, { ex: 'worlds-greatest', sets: 2, lo: 5, hi: 6, rest: 0 }, { ex: 'hip-opener', sets: 1, min: 10 }, { ex: 'glute-bridge', sets: 2, lo: 12, hi: 15, rest: 30 }, { ex: 'stretch', sets: 1, min: 10 }] },
        { name: 'Flow & Roll', items: [{ ex: 'foam-roll', sets: 1, min: 10 }, { ex: 'yoga', sets: 1, min: 20 }, { ex: 'meditate', sets: 1, min: 5 }] },
        { name: 'Shoulders & Walk', items: [{ ex: 'shoulder-mob', sets: 1, min: 10 }, { ex: 'band-pull-apart', sets: 3, lo: 15, hi: 20, rest: 30 }, { ex: 'bird-dog', sets: 2, lo: 8, hi: 10, rest: 30 }, { ex: 'walk', sets: 1, min: 30 }] },
      ],
    };
  }

  function library() {
    const g = (o, name, desc) => { const p = generate(o); p.name = name; if (desc) p.desc = desc + ' ' + p.desc; p.builtin = true; return p; };
    const lib = [
      ['beginner-full', g({ goal: 'general', days: 3, minutes: 45, equip: 'gym', experience: 'beginner' }, 'Beginner Full Body', 'The best place to start in a gym.')],
      ['strength-basics', g({ goal: 'strength', days: 3, minutes: 60, equip: 'gym', experience: 'intermediate' }, 'Stronger Basics', 'Squat, press and pull heavy, three times a week.')],
      ['upper-lower', g({ goal: 'muscle', days: 4, minutes: 60, equip: 'gym', experience: 'intermediate' }, 'Upper / Lower', 'A classic four-day muscle builder.')],
      ['ppl', g({ goal: 'muscle', days: 6, minutes: 60, equip: 'gym', experience: 'advanced' }, 'Push / Pull / Legs', 'High-frequency six-day split for experienced lifters.')],
      ['fat-loss', g({ goal: 'lose', days: 4, minutes: 45, equip: 'gym', experience: 'beginner' }, 'Fat Loss Circuit', 'Keep the muscle, lose the fat.')],
      ['home-db', g({ goal: 'general', days: 3, minutes: 45, equip: 'home', experience: 'beginner' }, 'Home Dumbbells', 'Dumbbells, bands and your bodyweight.')],
      ['bodyweight', g({ goal: 'general', days: 3, minutes: 30, equip: 'bodyweight', experience: 'beginner' }, 'Bodyweight Anywhere', 'No equipment, no excuses; 30 minutes.')],
      ['c25k', Object.assign(c25k(), { builtin: true })],
      ['run-builder', Object.assign(generate({ goal: 'run', days: 4, minutes: 45, equip: 'gym', experience: 'intermediate' }), { name: 'Run Builder', builtin: true })],
      ['mobility', Object.assign(mobility(), { builtin: true })],
    ];
    return lib.map((p) => Object.assign(p[1], { key: p[0] }));
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const api = { generate, library, c25k, candidates, itemCount, DEFAULT_SCHEDULE, EQUIP_SETS, SPLITS, SPLIT_FOR_DAYS, GOAL_NAMES, WEEKDAYS, ISOLATION, COMPOUND };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitPrograms = api;
})(this);
