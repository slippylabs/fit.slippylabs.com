#!/usr/bin/env node
/* Calculator oracles. Run: node tools/test_calc.js
 * Reference values are either worked by hand from the published formula
 * (commented inline) or come from tools/oracle_calc.json, which computes them
 * in Python from the formulas' ORIGINAL units -- the Navy method's inch form,
 * not the cm form calc.js uses -- so a transcription slip can't agree with itself. */
'use strict';
const path = require('path');
const C = require(path.join(__dirname, '..', 'js', 'calc.js'));
const O = require(path.join(__dirname, 'oracle_calc.json'));

let pass = 0, fail = 0;
function near(name, got, want, tol) {
  const ok = Math.abs(got - want) <= (tol === undefined ? 1e-6 : tol);
  if (ok) pass++; else { fail++; console.log('FAIL', name, 'got', got, 'want', want); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log('FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); }
}

// ---- units: exact definitions ----
near('lb->kg', C.lbToKg(225), 102.05828325, 1e-9);
near('kg->lb round trip', C.kgToLb(C.lbToKg(185.5)), 185.5, 1e-9);
near('in->cm', C.inToCm(70), 177.8, 1e-9);
near('mi->km', C.miToKm(26.2188), 42.195, 1e-3);

// ---- BMI: 80 / 1.8^2 ----
near('bmi', C.bmi(80, 180), 24.691358, 1e-5);
eq('bmi cats', [18.4, 18.5, 24.99, 25, 29.9, 30].map(C.bmiCategory), ['Underweight', 'Healthy weight', 'Healthy weight', 'Overweight', 'Overweight', 'Obese']);

// ---- Mifflin-St Jeor: 10w + 6.25h - 5a + 5 / -161 ----
near('mifflin m', C.bmrMifflin('m', 80, 180, 30), 800 + 1125 - 150 + 5);
near('mifflin f', C.bmrMifflin('f', 60, 165, 25), 600 + 1031.25 - 125 - 161);
// ---- Katch-McArdle: 370 + 21.6 * LBM ----
near('katch', C.bmrKatch(80, 20), 370 + 21.6 * 64, 1e-9);
near('tdee', C.tdee(1780, 1.55), 2759);

// ---- macros: calories add back up; protein by g/kg ----
['lose', 'keep', 'gain'].forEach((g) => {
  const m = C.macros(2700, g, 80);
  near('macros kcal sum ' + g, m.protein * 4 + m.carbs * 4 + m.fat * 9, m.kcal, 1e-6);
  near('macros fat share ' + g, m.fat * 9 / m.kcal, 0.25, 1e-9);
});
near('macro lose kcal', C.macros(2700, 'lose', 80).kcal, 2160);
near('macro gain kcal', C.macros(2700, 'gain', 80).kcal, 2970);
near('macro lose protein', C.macros(2700, 'lose', 80).protein, 160);

// ---- Navy body fat: cm form vs the inch form (oracle) ----
O.navy.forEach((c, i) => near('navy ' + c.sex + i, C.navyBodyFat(c.sex, c.h, c.neck, c.waist, c.hip), c.bf, 0.4));  // the two published forms differ by up to ~0.35 points
eq('navy invalid', isNaN(C.navyBodyFat('m', 180, 40, 38, 0)), true);

// ---- 1RM ----
Object.keys(O.onerm).forEach((k) => near('1rm ' + k, C.oneRepMax(100, 5, k), O.onerm[k], 1e-9));
Object.keys(C.ONE_RM).forEach((k) => near('1rm single ' + k, C.oneRepMax(140, 1, k), 140));
near('1rm epley 225x8', C.oneRepMax(225, 8), 225 * (1 + 8 / 30), 1e-9);
near('weightForReps inverts epley', C.weightForReps(C.oneRepMax(100, 6), 6), 100, 1e-9);
eq('estimate1RM ignores >12 reps', C.estimate1RM(50, 20), 0);

// ---- ideal weight: inch-form oracle ----
const iw = C.idealWeights('m', O.ideal_m_70in.cm);
['devine', 'robinson', 'miller', 'hamwi'].forEach((k) => near('ideal ' + k, iw[k], O.ideal_m_70in[k], 1e-9));
near('ideal bmi low', iw.bmiLow, 18.5 * 1.778 * 1.778, 1e-9);

// ---- heart rate ----
near('max hr fox', C.maxHeartRate(30), 190);
near('max hr tanaka', C.maxHeartRate(30, 'tanaka'), 187);
const z = C.karvonen(190, 60);
near('karvonen z2 lo', z[1].lo, 60 + 0.6 * 130);
near('karvonen z5 hi', z[4].hi, 190);
eq('zones contiguous', z.slice(1).every((zz, i) => Math.abs(zz.lo - z[i].hi) < 1e-9), true);

// ---- running ----
near('riegel 5k->10k', C.riegel(1500, 5, 10), 1500 * Math.pow(2, 1.06), 1e-9);
near('riegel identity', C.riegel(1500, 5, 5), 1500, 1e-9);
near('pace', C.pace(1500, 5), 300);
near('time<-pace', C.timeFor(300, 5), 1500);
near('dist<-pace', C.distanceFor(1500, 300), 5);
eq('fmtDuration', [59, 60, 3599, 3600, 3725, 0].map(C.fmtDuration), ['0:59', '1:00', '59:59', '1:00:00', '1:02:05', '0:00']);
eq('parseDuration', ['25:30', '1:02:03', '90', '1h 5m', '45m', '30s', '', 'abc', '1:2:3:4'].map((s) => { const v = C.parseDuration(s); return isNaN(v) ? null : v; }),
  [1530, 3723, 90, 3900, 2700, 30, null, null, null]);
// round trip
for (let s = 0; s < 20000; s += 37) if (C.parseDuration(C.fmtDuration(s)) !== s) { fail++; console.log('FAIL duration round trip', s); break; }
pass++;

// ---- energy ----
near('met kcal', C.caloriesBurned(9.8, 70, 60), 686, 1e-9);
near('water', C.waterMl(80, 60), 2800 + 1000);
eq('protein range', C.proteinRange(80, 'muscle').map((x) => Math.round(x * 10) / 10), [128, 176]);

// ---- trend ----
const tr = C.trend([[0, 100], [7, 99], [14, 98], [21, 97]]);
near('trend slope', tr.slope, -1 / 7, 1e-12);
near('trend intercept', tr.intercept, 100, 1e-9);
eq('trend needs 2 days', C.trend([[3, 1], [3, 2]]), null);
eq('moving avg', C.movingAverage([1, 2, 3, 4], 2), [1, 1.5, 2.5, 3.5]);

// ---- plate loader: DP vs brute force over every target ----
function brute(perSide, plates) {
  // every multiset of up to 12 plates, by DFS over sorted denominations
  const u = plates.map((p) => Math.round(p * 100)).sort((a, b) => b - a), goal = Math.round(perSide * 100);
  let best = { sum: 0, n: 0 };
  (function dfs(i, sum, n) {
    if (sum > goal) return;
    if (sum > best.sum || (sum === best.sum && n < best.n)) best = { sum: sum, n: n };
    if (i >= u.length || n >= 12) return;
    dfs(i, sum + u[i], n + 1);
    dfs(i + 1, sum, n);
  })(0, 0, 0);
  return best;
}
let plateChecks = 0;
[['kg', [25, 20, 15, 10, 5, 2.5, 1.25], 20, 1.25], ['lb', [45, 35, 25, 10, 5, 2.5], 45, 2.5], ['odd', [20, 10, 2.5], 20, 1], ['no-small', [25, 20, 15], 20, 2.5]].forEach(([name, plates, bar, step]) => {
  for (let t = bar; t <= bar + 260; t += step) {
    const r = C.plates(t, bar, plates);
    const b = brute((t - bar) / 2, plates);
    const sum = r.perSide.reduce((a, x) => a + x, 0);
    plateChecks++;
    if (Math.abs(r.total - (bar + 2 * sum)) > 1e-9 || Math.round(sum * 100) !== b.sum || r.perSide.length !== b.n || r.total > t + 1e-9) {
      fail++; console.log('FAIL plates', name, t, JSON.stringify(r), JSON.stringify(b)); return;
    }
  }
});
pass++;
eq('plates exact 100kg', C.plates(100, 20, [25, 20, 15, 10, 5, 2.5, 1.25]).total, 100);
eq('plates 225lb', C.plates(225, 45, [45, 35, 25, 10, 5, 2.5]).perSide, [45, 45]);

console.log(pass + ' passed, ' + fail + ' failed (' + plateChecks + ' plate targets checked against brute force)');
process.exit(fail ? 1 : 0);
