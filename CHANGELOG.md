# SlipFit changelog

Versions follow semver: patch for fixes, minor for features. The in-app "What's new"
sheet reads `js/changelog.js`; keep both in step.

**Releasing:** bump the newest entry in `js/changelog.js`, every `?v=` in `index.html`,
`CACHE`/`V` in `sw.js`, add an entry here, run the three test suites, deploy, then
`git tag -a vX.Y.Z` and push.

## v1.0.0 (2026-10-11)

First release.

- Today screen: today's planned session, weekly-goal ring, week streak, XP and level, daily check-ins (water, protein, sleep, steps), next badges, goals and recent PRs.
- Workout logger: 120 exercises with how-to cues, last-session numbers pre-filled, double-progression suggestions, a wall-clock rest timer with sound and vibration, live PR detection, templates, editing past workouts.
- Plans: a generator (goal, days, minutes, equipment, experience) and 10 built-in programs including Couch to 5K. Editable schedule, sets, reps and exercises.
- Goals: weight, lift (estimated 1RM), run distance, workout count and free-form, with deadlines, on-track status and a projected finish date from your trend.
- 12 calculators: calories and macros, BMI, body fat (U.S. Navy), one-rep max (7 formulas), plate loader, heart-rate zones, pace and race prediction, calories burned, ideal weight, water, protein, waist-to-height.
- Progress: exercise and bodyweight charts, workouts per week, sets per muscle, a 26-week heatmap, a PR board and 46 achievements.
- Me: profile, targets, reminders (notifications and an .ics calendar file), optional account sync, JSON backup export and import, light and dark themes.
- Works offline and installs to the home screen. A feedback button on every screen.
