#!/usr/bin/env python3
"""End-to-end browser run of SlipFit: onboarding, logging, PRs, persistence,
every screen and calculator, plus a touch-target and overflow audit.

    VENV=/home/slippy/projects/medievalmmo-dev/venv/bin/python
    $VENV tools/browser_test.py [base_url] [--shots DIR]

Default base_url serves this checkout on a local port. Pass the live URL to
test what is actually deployed.
"""
import faulthandler, functools, http.server, json, os, socketserver, sys, threading
faulthandler.dump_traceback_later(int(os.environ.get("HANG_DUMP", "0")) or 10**6, exit=True)
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
if SHOTS and SHOTS in args:
    args.remove(SHOTS)

fails, passes = [], 0
def check(name, cond, detail=''):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(name + (': ' + str(detail) if detail else ''))
        print('FAIL', name, detail)

def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a: None
    srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d/' % srv.server_address[1]

BASE = args[0] if args else serve()

AUDIT_JS = """() => {
  const out = [];
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  document.querySelectorAll('button, a, select, input, summary, [role=radio]').forEach((el) => {
    if (!vis(el) || el.classList.contains('skip')) return;
    if (el.closest('.sl-legal') && el.tagName === 'A') { /* checked below like everything else */ }
    if (el.type === 'checkbox') { const l = el.closest('label'); if (l && l.getBoundingClientRect().height >= 40) return; }
    if (el.type === 'file') return;
    if (el.closest('p, li') && el.tagName === 'A') return;
    const r = el.getBoundingClientRect();
    if (r.height < 40 || r.width < 40) out.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + [...el.classList].join('.')) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || el.value || '').trim().slice(0, 20) + '"');
  });
  return { small: out, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
}"""

def audit(page, label):
    r = page.evaluate(AUDIT_JS)
    check('touch targets ' + label, not r['small'], r['small'][:6])
    check('no horizontal overflow ' + label, r['overflow'] <= 0, r['overflow'])

def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []

    def new_page(width, height, mobile):
        ctx = browser.new_context(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile,
                                  device_scale_factor=2 if mobile else 1, service_workers='block')
        pg = ctx.new_page()
        pg.set_default_timeout(15000)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'lab.slippylabs.com' not in m.text and 'admin.slippylabs.com' not in m.text and 'Failed to load resource' not in m.text else None)
        return ctx, pg

    ctx, page = new_page(390, 844, True)
    # Pin "today" to a Monday so a default 3-day plan (Mon/Wed/Fri) has a session today.
    page.clock.install(time='2026-10-12T17:30:00')
    page.goto(BASE + 'index.html')
    page.wait_for_selector('.onboard')
    check('onboarding shown on first visit', page.is_visible('text=Welcome to SlipFit'))
    shot(page, '01-onboard')
    page.fill('.onboard input[type=text]', 'Sam')
    audit(page, 'onboarding')
    for i in range(4):
        page.click('.onboard-actions .btn.big')
    check('plan preview on last step', page.is_visible('text=Your plan is ready'))
    shot(page, '02-plan-ready')
    page.click('text=Start my plan')
    page.wait_for_selector('.hero')
    st = page.evaluate('window.__fit.state')
    check('profile onboarded', st['profile']['onboarded'] and st['profile']['name'] == 'Sam')
    check('plan started', st['plan'] and len(st['plan']['days']) == 3, st['plan'] and st['plan']['name'])
    check('weigh-in seeded', len(st['body']) == 1)
    check('greeting uses name', page.is_visible('text=Good afternoon, Sam'))
    check('today has a session (Monday)', page.is_visible('text=Start workout'))
    shot(page, '03-today')
    audit(page, 'today')

    # ---- check-ins ----
    check('zero counts render as 0', page.inner_text('.ci-val').startswith('0'), page.inner_text('.ci-val'))
    for _ in range(8):
        page.click('[aria-label="more Water"]')
    st = page.evaluate('window.__fit.state')
    check('water logged', st['daily']['2026-10-12']['water'] == 8, st['daily'])

    # ---- log a workout ----
    page.click('text=Start workout')
    page.wait_for_selector('.ex-card')
    cards = page.query_selector_all('.ex-card')
    check('logger shows plan exercises', len(cards) >= 4, len(cards))
    first = cards[0]
    name0 = first.query_selector('.ex-name').inner_text()
    w_inputs = first.query_selector_all('.set-row:not(.head) input[aria-label=Weight]')
    for inp in w_inputs:
        inp.fill('135')
    for inp in first.query_selector_all('.set-row:not(.head) input[aria-label=Reps]'):
        inp.fill('8')
    first.query_selector_all('.check')[0].click()
    check('rest timer appears after a set', page.is_visible('#rest-bar'))
    check('rest timer counts', ':' in page.inner_text('.rest-time'))
    shot(page, '04-logger')
    audit(page, 'logger')
    # Rest timer survives the clock jumping (phone locked): wall-clock based.
    page.clock.fast_forward(200_000)
    page.wait_for_timeout(400)
    check('rest done after time passes', page.inner_text('.rest-time') in ('Go!',) or page.is_hidden('#rest-bar'), page.inner_text('#rest-bar') if page.is_visible('#rest-bar') else 'hidden')
    for b in first.query_selector_all('.check')[1:]:
        b.click()
    page.click('.rest-inner >> text=Skip') if page.is_visible('.rest-inner') else None
    page.click('text=Finish workout')
    page.wait_for_selector('text=Finish workout?')
    page.click('.sheet-actions >> text=Finish')
    page.wait_for_selector('.celebrate')
    check('celebration shows XP', '+' in page.inner_text('.celebrate .stat-row'))
    shot(page, '05-celebrate')
    page.click('.sheet-actions >> text=Done')
    st = page.evaluate('window.__fit.state')
    check('workout saved', len(st['workouts']) == 1 and st['workouts'][0]['ex'][0]['id'] == st['plan']['days'][0]['items'][0]['ex'], st['workouts'])
    check('only ticked sets saved', len(st['workouts'][0]['ex']) == 1, len(st['workouts'][0]['ex']))
    saved_kg = st['workouts'][0]['ex'][0]['s'][0]['w']
    check('135 lb stored as kg', abs(saved_kg - 61.235) < 0.01, saved_kg)
    check('first-workout badge', 'first-workout' in st['badges'])
    check('today shows done', page.is_visible('text=Done for today'))

    # ---- next session two days later: progression + PR ----
    page.clock.fast_forward(2 * 86400_000)
    page.evaluate("window.__fit.go('today')")
    page.evaluate("window.__fit.render()")
    st = page.evaluate('window.__fit.state')
    # Start Full Body A again via the picker so the same exercise comes back.
    page.click('text=Train anyway') if page.is_visible('text=Train anyway') else page.click('text=Start workout')
    page.wait_for_selector('.ex-card')
    page.click('text=Discard')
    page.click('.sheet-actions >> text=Discard')
    page.evaluate("window.__fit.go('train')")
    page.click('text=Other workout')
    page.click('.pick >> text=' + st['plan']['days'][0]['name'])
    page.wait_for_selector('.ex-card')
    first = page.query_selector('.ex-card')
    check('last time shown', '135' in first.inner_text(), first.inner_text()[:200])
    first.query_selector('input[aria-label=Weight]').fill('145')
    first.query_selector('input[aria-label=Reps]').fill('8')
    first.query_selector('.check').click()
    page.wait_for_timeout(100)
    check('live PR toast', 'New PR' in page.inner_text('#toasts'), page.inner_text('#toasts'))
    page.click('text=Finish workout')
    page.wait_for_selector('text=Finish workout?')
    page.click('.sheet-actions >> text=Finish')
    page.wait_for_selector('.celebrate')
    check('celebration lists the PR', 'personal records' in page.inner_text('.celebrate').lower())
    page.click('.sheet-actions >> text=Done')

    # ---- persistence ----
    page.reload()
    page.wait_for_selector('.hero')
    st = page.evaluate('window.__fit.state')
    check('survives reload', len(st['workouts']) == 2 and st['profile']['name'] == 'Sam')
    d = page.evaluate('window.__fit.derived().xp.total')
    check('xp earned', d > 200, d)

    # ---- every screen ----
    for route in ['train', 'plans', 'tools', 'progress', 'me']:
        page.evaluate("window.__fit.go('%s')" % route)
        page.wait_for_timeout(250)
        check('screen renders ' + route, page.query_selector('main .page-head') is not None)
        shot(page, '06-' + route)
        audit(page, route)

    # ---- every calculator ----
    page.evaluate("window.__fit.go('tools')")
    keys = page.eval_on_selector_all('.calc-card', 'els => els.map(e => e.dataset.calc)')
    check('12 calculators', len(keys) == 12, len(keys))
    for k in keys:
        page.click('.calc-card[data-calc=%s]' % k)
        page.wait_for_timeout(60)
        out = page.inner_text('#calc-panel')
        check('calculator renders ' + k, 'Check the numbers' not in out and len(out) > 20, out[:80])
    # Fill the 1RM calculator and read the answer: 225 x 5 -> Epley 262.5
    page.click('.calc-card[data-calc=onerm]')
    page.fill('#calc-panel input[aria-label=Weight]', '225')
    page.fill('#calc-panel input[aria-label=Reps]', '5')
    page.wait_for_timeout(50)
    check('1RM result', '262.5' in page.inner_text('#calc-panel .result') or '263' in page.inner_text('#calc-panel .result'), page.inner_text('#calc-panel .result'))
    page.click('.calc-card[data-calc=plates]')
    page.fill('#calc-panel input[aria-label=Target]', '225')
    page.wait_for_timeout(50)
    check('plates 225 = 45+45', '45 + 45' in page.inner_text('#calc-panel .result'), page.inner_text('#calc-panel .result'))
    shot(page, '07-plates')
    audit(page, 'tools-open')

    # ---- goals ----
    page.evaluate("window.__fit.go('plans')")
    page.click('text=+ New goal')
    page.fill('.sheet input.num', '170')
    page.click('.sheet-actions >> text=Set goal')
    st = page.evaluate('window.__fit.state')
    check('weight goal created', len(st['goals']) == 1 and abs(st['goals'][0]['target'] - 77.11) < 0.01, st['goals'])
    check('goal badge', 'goal-set' in st['badges'])

    # ---- modals: every interactive sheet is audited too ----
    page.evaluate("window.__fit.go('train')")
    page.click('text=Browse exercises')
    page.wait_for_selector('.ex-pick-list .pick')
    audit(page, 'exercise picker')
    page.keyboard.press('Escape')

    # ---- units switch ----
    page.evaluate("window.__fit.go('me')")
    page.click('.seg >> text=kg / km / cm')
    page.evaluate("window.__fit.go('progress')")
    page.wait_for_timeout(200)
    check('metric shown after switch', ' kg' in page.inner_text('main'))

    # ---- desktop layout ----
    ctx2, desk = new_page(1280, 900, False)
    desk.add_init_script('localStorage.setItem("slipfit-v1", %s)' % json.dumps(json.dumps(st)))
    desk.goto(BASE + 'index.html#/today')
    desk.wait_for_selector('.hero')
    for route in ['today', 'train', 'plans', 'tools', 'progress', 'me']:
        desk.evaluate("window.__fit.go('%s')" % route)
        desk.wait_for_timeout(200)
        r = desk.evaluate(AUDIT_JS)
        check('desktop overflow ' + route, r['overflow'] <= 0, r['overflow'])
        shot(desk, '08-desk-' + route)
    nav = desk.eval_on_selector('#nav', 'e => e.getBoundingClientRect().toJSON()')
    check('desktop nav is a left rail', nav['width'] < 120 and nav['height'] > 500, nav)

    check('no page errors', not errors, errors[:5])
    browser.close()

print('%d passed, %d failed' % (passes, len(fails)))
sys.exit(1 if fails else 0)
