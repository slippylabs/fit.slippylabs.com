# SlipFit

A workout tracker and fitness planner that runs in the browser: **https://fit.slippylabs.com/**

Plans that tell you what to do today, a logger that remembers last time and tells you
how to beat it, goals with deadlines, twelve fitness calculators, progress charts, and
streaks, XP and achievements to give you a reason to come back.

- **Local-first.** Everything is stored in your browser. No account is needed and nothing
  is sent anywhere unless you sign in to a slippylabs account and turn sync on.
- **Offline.** A service worker caches the app, so it opens in a gym with no signal, and it
  installs to a phone home screen.
- **No build step, no dependencies.** Plain HTML, CSS and JavaScript.

## Layout

| File | What it is |
| --- | --- |
| `js/exercises.js` | The exercise library (ids are stored in logs: never rename one) |
| `js/calc.js` | Calculator formulas, pure functions |
| `js/programs.js` | Built-in programs and the plan generator |
| `js/gamify.js` | PRs, streaks, XP, levels and badges, all derived from the log |
| `js/store.js` | State, schema migrations, the compact log encoding and sync |
| `js/ui.js`, `js/charts.js` | DOM helpers and canvas charts |
| `js/app.js` | Routing and every screen |
| `js/changelog.js` | Release notes; its newest entry is the app version |

The data modules also load under Node, which is how they are tested.

## Tests

```sh
node tools/test_calc.js     # formulas against independent reference values
node tools/test_logic.js    # streaks, PRs, XP, badges, plan generator, store and sync
python3 tools/browser_test.py [url]   # end-to-end in headless Chromium (needs Playwright)
```

`tools/oracle_calc.py` produces the calculator reference values from each formula's
original published units (the Navy method's inch form, for example), so the tests do not
compare the code with a copy of itself.

## Versioning

Semver tags. See `CHANGELOG.md` for the release checklist.

Not medical advice: SlipFit is a training log and planning tool.
