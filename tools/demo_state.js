#!/usr/bin/env node
/* A believable six-week log for screenshots: node tools/demo_state.js > /tmp/demo.json */
'use strict';
const S = require('../js/store.js'), P = require('../js/programs.js'), G = require('../js/gamify.js');
const s = S.defaults();
Object.assign(s.profile, { name: 'Sam', onboarded: true, weightKg: 84, weeklyGoal: 3 });
const plan = P.library().find((p) => p.key === 'beginner-full');
plan.id = 'demo'; plan.started = '2026-08-31'; s.plan = plan;
let day = '2026-08-31', n = 0, kg = 86;
while (day < '2026-10-12') {
  if ([1, 3, 5].indexOf(G.weekday(day)) >= 0) {
    const pd = plan.days[n % 3], wk = Math.floor(n / 3);
    s.workouts.push({ id: 'd' + n, d: day, st: Date.parse(day + 'T17:30:00'), en: Date.parse(day + 'T18:25:00'), name: pd.name, plan: 'demo', pday: n % 3,
      ex: pd.items.map((it, i) => ({ id: it.ex, s: Array.from({ length: it.sets }, () => (it.lo && it.ex !== 'plank' && it.ex !== 'side-plank' && it.ex !== 'dead-bug' ? { w: Math.round((60 - i * 8 + wk * 2.5) * 10) / 10, r: it.lo + (wk % 3) } : { t: 40 + wk * 5 })) })) });
    n++;
  }
  if (G.weekday(day) % 2 === 0) { kg -= 0.25; s.body.push({ d: day, w: kg }); }
  s.daily[day] = { water: 6 + (n % 3), protein: 120 + (n % 4) * 10, sleep: 7 + (n % 2) * 0.5, steps: 7000 + (n % 5) * 900 };
  day = G.addDays(day, 1);
}
s.goals.push({ id: 'g1', type: 'weight', target: 80, start: 86, created: '2026-08-31', by: '2026-12-15' });
const sm = G.summary(s, '2026-10-12');
G.BADGES.forEach((b) => { if (b[4](sm)) s.badges[b[0]] = '2026-10-01'; });
s.seenVersion = '1.0.0';
process.stdout.write(JSON.stringify(s));
