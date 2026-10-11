/* SlipFit calculators. Pure functions, metric in and metric out; the UI converts
 * units at the edges. Every formula here is checked against independently worked
 * values in tools/test_calc.js -- change one and run that first.
 */
(function (root) {
  'use strict';

  const KG_PER_LB = 0.45359237;          // exact, by definition
  const CM_PER_IN = 2.54;                // exact
  const KM_PER_MI = 1.609344;            // exact

  const lbToKg = (lb) => lb * KG_PER_LB;
  const kgToLb = (kg) => kg / KG_PER_LB;
  const inToCm = (inch) => inch * CM_PER_IN;
  const cmToIn = (cm) => cm / CM_PER_IN;
  const miToKm = (mi) => mi * KM_PER_MI;
  const kmToMi = (km) => km / KM_PER_MI;

  const round = (x, dp) => { const f = Math.pow(10, dp || 0); return Math.round(x * f) / f; };

  /* ---------- body composition ---------- */

  function bmi(kg, cm) {
    const m = cm / 100;
    return kg / (m * m);
  }

  // WHO adult categories.
  function bmiCategory(v) {
    if (v < 18.5) return 'Underweight';
    if (v < 25) return 'Healthy weight';
    if (v < 30) return 'Overweight';
    return 'Obese';
  }

  // Mifflin-St Jeor (1990).
  function bmrMifflin(sex, kg, cm, age) {
    return 10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5);
  }

  // Katch-McArdle: needs body-fat %.
  function bmrKatch(kg, bodyFatPct) {
    const lbm = kg * (1 - bodyFatPct / 100);
    return 370 + 21.6 * lbm;
  }

  const ACTIVITY = [
    [1.2, 'Sedentary (desk job, little exercise)'],
    [1.375, 'Light (exercise 1-3 days a week)'],
    [1.55, 'Moderate (exercise 3-5 days a week)'],
    [1.725, 'Very active (hard exercise 6-7 days)'],
    [1.9, 'Athlete (twice a day or physical job)'],
  ];

  function tdee(bmr, activity) { return bmr * activity; }

  /* Calorie and macro targets for a goal.
   * lose:  20% deficit, protein 2.0 g/kg (keeps muscle while dieting)
   * gain:  10% surplus, protein 1.8 g/kg
   * keep:  maintenance, protein 1.6 g/kg
   * Fat is 25% of calories, carbs take the rest. Protein is from body weight,
   * so it is the same number whatever the calorie target. */
  const GOAL_ADJ = { lose: -0.20, keep: 0, gain: 0.10 };
  const GOAL_PROTEIN = { lose: 2.0, keep: 1.6, gain: 1.8 };

  function macros(tdeeKcal, goal, kg) {
    const adj = GOAL_ADJ[goal] !== undefined ? GOAL_ADJ[goal] : 0;
    const kcal = tdeeKcal * (1 + adj);
    const protein = (GOAL_PROTEIN[goal] || 1.6) * kg;
    const fat = kcal * 0.25 / 9;
    const carbs = Math.max(0, (kcal - protein * 4 - fat * 9) / 4);
    return { kcal: kcal, protein: protein, fat: fat, carbs: carbs };
  }

  /* U.S. Navy circumference method (Hodgdon & Beckett 1984), centimetre form. */
  function navyBodyFat(sex, heightCm, neckCm, waistCm, hipCm) {
    if (sex === 'f') {
      const x = waistCm + hipCm - neckCm;
      if (!(x > 0)) return NaN;
      return 495 / (1.29579 - 0.35004 * Math.log10(x) + 0.22100 * Math.log10(heightCm)) - 450;
    }
    const x = waistCm - neckCm;
    if (!(x > 0)) return NaN;
    return 495 / (1.0324 - 0.19077 * Math.log10(x) + 0.15456 * Math.log10(heightCm)) - 450;
  }

  // ACE body-fat categories.
  function bodyFatCategory(sex, pct) {
    const t = sex === 'f' ? [14, 21, 25, 32] : [6, 14, 18, 25];
    if (pct < t[0]) return 'Essential fat';
    if (pct < t[1]) return 'Athletic';
    if (pct < t[2]) return 'Fitness';
    if (pct < t[3]) return 'Average';
    return 'Above average';
  }

  /* Ideal-weight formulas, all defined on height in inches over 5 ft. */
  function idealWeights(sex, cm) {
    const over = cmToIn(cm) - 60;
    const f = sex === 'f';
    const m = cm / 100;
    return {
      devine: (f ? 45.5 : 50) + 2.3 * over,
      robinson: (f ? 49 : 52) + (f ? 1.7 : 1.9) * over,
      miller: (f ? 53.1 : 56.2) + (f ? 1.36 : 1.41) * over,
      hamwi: (f ? 45.5 : 48) + (f ? 2.2 : 2.7) * over,
      bmiLow: 18.5 * m * m,
      bmiHigh: 24.9 * m * m,
    };
  }

  function waistToHeight(waistCm, heightCm) { return waistCm / heightCm; }

  // Baseline 35 ml/kg plus 500 ml per 30 minutes of exercise.
  function waterMl(kg, exerciseMin) { return kg * 35 + (exerciseMin || 0) / 30 * 500; }

  // g/kg ranges commonly used in sports nutrition (ISSN position stand).
  const PROTEIN_RANGES = {
    sedentary: [0.8, 1.0], general: [1.2, 1.6], muscle: [1.6, 2.2], lose: [1.8, 2.4], endurance: [1.2, 1.6],
  };
  function proteinRange(kg, kind) {
    const r = PROTEIN_RANGES[kind] || PROTEIN_RANGES.general;
    return [r[0] * kg, r[1] * kg];
  }

  /* ---------- strength ---------- */

  const ONE_RM = {
    epley: (w, r) => w * (1 + r / 30),
    brzycki: (w, r) => w * 36 / (37 - r),
    lombardi: (w, r) => w * Math.pow(r, 0.10),
    oconner: (w, r) => w * (1 + 0.025 * r),
    mayhew: (w, r) => 100 * w / (52.2 + 41.9 * Math.exp(-0.055 * r)),
    wathan: (w, r) => 100 * w / (48.8 + 53.8 * Math.exp(-0.075 * r)),
    lander: (w, r) => 100 * w / (101.3 - 2.67123 * r),
  };

  /* A single (1-rep) set IS the max; every formula above is meant for 2-12 reps
   * and some of them don't return w at r = 1. Above 12 reps the estimate is
   * noise, so the app stops using it for PRs (see estimate1RM). */
  function oneRepMax(w, r, formula) {
    if (!(w > 0) || !(r >= 1)) return 0;
    if (r === 1) return w;
    return ONE_RM[formula || 'epley'](w, r);
  }

  function oneRepMaxAll(w, r) {
    const out = {};
    Object.keys(ONE_RM).forEach((k) => { out[k] = oneRepMax(w, r, k); });
    const vals = Object.values(out);
    out.average = vals.reduce((a, b) => a + b, 0) / vals.length;
    return out;
  }

  // The number PRs and charts use: Epley, only for 1-12 reps.
  function estimate1RM(w, r) { return r >= 1 && r <= 12 ? oneRepMax(w, r, 'epley') : 0; }

  // Inverse Epley: the load you can lift for r reps given a 1RM.
  function weightForReps(oneRm, r) { return r <= 1 ? oneRm : oneRm / (1 + r / 30); }

  /* Plate loader: the closest load at or under `target` you can build, with the
   * fewest plates. Exact dynamic programme over hundredths, so odd plate sets
   * (no 15s, fractional plates) are still optimal -- greedy is not always. */
  function plates(target, bar, available) {
    const perSide = (target - bar) / 2;
    if (perSide <= 0) return { perSide: [], total: bar, short: Math.max(0, target - bar) };
    const sizes = available.slice().sort((a, b) => b - a);
    const units = sizes.map((p) => Math.round(p * 100));
    const goal = Math.round(perSide * 100);
    const best = new Array(goal + 1).fill(Infinity);
    const pick = new Array(goal + 1).fill(-1);
    best[0] = 0;
    for (let v = 1; v <= goal; v++) {
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (u <= v && best[v - u] + 1 < best[v]) { best[v] = best[v - u] + 1; pick[v] = i; }
      }
    }
    let v = goal;
    while (v > 0 && best[v] === Infinity) v--;
    const out = [];
    let cur = v;
    while (cur > 0) { out.push(sizes[pick[cur]]); cur -= units[pick[cur]]; }
    out.sort((a, b) => b - a);
    const total = bar + 2 * v / 100;
    return { perSide: out, total: total, short: round(target - total, 2) };
  }

  const PLATE_SETS = {
    kg: { bar: 20, plates: [25, 20, 15, 10, 5, 2.5, 1.25] },
    lb: { bar: 45, plates: [45, 35, 25, 10, 5, 2.5] },
  };

  /* ---------- heart rate ---------- */

  function maxHeartRate(age, method) {
    if (method === 'tanaka') return 208 - 0.7 * age;
    return 220 - age;
  }

  const HR_ZONES = [
    [0.50, 0.60, 'Zone 1', 'Recovery / warm-up'],
    [0.60, 0.70, 'Zone 2', 'Easy aerobic, fat burning'],
    [0.70, 0.80, 'Zone 3', 'Aerobic, tempo'],
    [0.80, 0.90, 'Zone 4', 'Threshold'],
    [0.90, 1.00, 'Zone 5', 'Max effort'],
  ];

  // Karvonen: target = rest + pct * (max - rest).
  function karvonen(maxHr, restHr) {
    return HR_ZONES.map((z) => ({
      name: z[2], label: z[3],
      lo: restHr + z[0] * (maxHr - restHr),
      hi: restHr + z[1] * (maxHr - restHr),
    }));
  }

  /* ---------- running ---------- */

  // Seconds per unit distance.
  function pace(seconds, distance) { return distance > 0 ? seconds / distance : 0; }
  function timeFor(paceSec, distance) { return paceSec * distance; }
  function distanceFor(seconds, paceSec) { return paceSec > 0 ? seconds / paceSec : 0; }

  // Riegel (1977): T2 = T1 * (D2/D1)^1.06.
  function riegel(t1, d1, d2) { return t1 * Math.pow(d2 / d1, 1.06); }

  function fmtDuration(sec) {
    if (!isFinite(sec) || sec < 0) return '--';
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    const mm = (h ? String(m).padStart(2, '0') : String(m)), ss = String(s).padStart(2, '0');
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  // Accepts "25:30", "1:02:03", "90" (seconds), "1h 5m".
  function parseDuration(text) {
    const t = String(text || '').trim();
    if (!t) return NaN;
    if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
    const hm = t.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?$/i);
    if (hm && (hm[1] || hm[2] || hm[3])) return (+hm[1] || 0) * 3600 + (+hm[2] || 0) * 60 + (+hm[3] || 0);
    const parts = t.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
    return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
  }

  /* ---------- energy ---------- */

  // MET values from the 2011 Compendium of Physical Activities.
  const METS = [
    ['Walking, 3 mph (moderate)', 3.5],
    ['Walking, 4 mph (brisk)', 5.0],
    ['Hiking', 6.0],
    ['Running, 5 mph (12 min/mi)', 8.3],
    ['Running, 6 mph (10 min/mi)', 9.8],
    ['Running, 7.5 mph (8 min/mi)', 11.8],
    ['Cycling, 12-14 mph (moderate)', 8.0],
    ['Cycling, stationary (moderate)', 6.8],
    ['Swimming laps, moderate', 5.8],
    ['Rowing machine, moderate', 7.0],
    ['Elliptical, moderate', 5.0],
    ['Stair climber', 9.0],
    ['Jump rope, moderate', 11.8],
    ['Weight training, moderate', 3.5],
    ['Weight training, vigorous', 6.0],
    ['Circuit / HIIT, vigorous', 8.0],
    ['Yoga (hatha)', 2.5],
    ['Basketball game', 6.5],
    ['Soccer, casual', 7.0],
    ['Tennis, singles', 8.0],
    ['Dancing, general', 5.0],
  ];

  // kcal = MET x kg x hours.
  function caloriesBurned(met, kg, minutes) { return met * kg * minutes / 60; }

  /* ---------- goals ---------- */

  /* Least-squares slope of value against day number: units per day. Used to
   * project when a weight or lift goal will be reached. Needs 2+ points on
   * different days. */
  function trend(points) {
    if (!points || points.length < 2) return null;
    const n = points.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    points.forEach((p) => { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
    const den = n * sxx - sx * sx;
    if (den === 0) return null;
    const slope = (n * sxy - sx * sy) / den;
    return { slope: slope, intercept: (sy - slope * sx) / n };
  }

  function movingAverage(values, window) {
    return values.map((_, i) => {
      const s = values.slice(Math.max(0, i - window + 1), i + 1);
      return s.reduce((a, b) => a + b, 0) / s.length;
    });
  }

  const api = {
    KG_PER_LB, CM_PER_IN, KM_PER_MI, lbToKg, kgToLb, inToCm, cmToIn, miToKm, kmToMi, round,
    bmi, bmiCategory, bmrMifflin, bmrKatch, ACTIVITY, tdee, macros, GOAL_PROTEIN,
    navyBodyFat, bodyFatCategory, idealWeights, waistToHeight, waterMl, proteinRange, PROTEIN_RANGES,
    ONE_RM, oneRepMax, oneRepMaxAll, estimate1RM, weightForReps, plates, PLATE_SETS,
    maxHeartRate, karvonen, HR_ZONES, pace, timeFor, distanceFor, riegel, fmtDuration, parseDuration,
    METS, caloriesBurned, trend, movingAverage,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitCalc = api;
})(this);
