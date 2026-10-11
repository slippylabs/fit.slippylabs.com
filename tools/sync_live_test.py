#!/usr/bin/env python3
"""Live two-device sync test against the real account service.
    $VENV tools/sync_live_test.py <session-cookie>
Needs a throwaway account whose session cookie is passed in; the caller creates
and deletes that account (see the README). Drives the real Me-screen switch."""
import json, sys
from playwright.sync_api import sync_playwright
COOKIE = sys.argv[1]
URL = 'https://fit.slippylabs.com/'
fails = []
def check(name, cond, detail=''):
    print(('ok   ' if cond else 'FAIL ') + name, detail if not cond else '')
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    def device():
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block')
        ctx.add_cookies([{'name': 'session', 'value': COOKIE, 'domain': '.slippylabs.com', 'path': '/', 'secure': True, 'httpOnly': True}])
        pg = ctx.new_page(); pg.set_default_timeout(20000)
        return pg
    A = device()
    A.goto(URL)
    A.wait_for_selector('.onboard')
    A.click('.onboard-actions >> text=Skip')
    A.wait_for_function('window.__fit && window.__fit.store.syncUser === "fittest"')
    A.evaluate("""() => { const s = window.__fit.state;
      s.workouts.push({id:'synctest1', d:'2026-10-11', st:Date.now()-3600000, en:Date.now(), name:'Sync Test', ex:[{id:'bench', s:[{w:61.235,r:8},{w:61.235,r:8}]}]});
      s.profile.name = 'Device A'; window.__fit.store.save(); }""")
    A.evaluate("window.__fit.go('me')")
    A.click('label.toggle:has-text("Sync my data") input')
    A.wait_for_function("document.getElementById('sync-status') && /Synced|Loaded|newer/.test(document.getElementById('sync-status').textContent)")
    check('A reports synced', True)
    B = device()
    B.goto(URL)
    B.wait_for_selector('.onboard')
    B.click('.onboard-actions >> text=Skip')
    B.wait_for_function('window.__fit.store.syncUser === "fittest"')
    B.evaluate("window.__fit.go('me')")
    B.click('label.toggle:has-text("Sync my data") input')
    B.wait_for_function("window.__fit.state.workouts.some(w => w.id === 'synctest1')")
    st = B.evaluate('window.__fit.state')
    check('B received the workout', any(w['id'] == 'synctest1' and w['ex'][0]['s'][0]['w'] == 61.235 for w in st['workouts']))
    check('B received the profile', st['profile']['name'] == 'Device A', st['profile']['name'])
    # B logs more; A pulls it on reload.
    B.evaluate("""() => { window.__fit.state.workouts.push({id:'synctest2', d:'2026-10-11', st:0, en:0, name:'From B', ex:[{id:'squat', s:[{w:80,r:5}]}]}); window.__fit.store.save(); }""")
    B.evaluate('window.__fit.store.push(false)')
    B.wait_for_timeout(1500)
    A.reload()
    A.wait_for_function("window.__fit.state.workouts.some(w => w.id === 'synctest2')")
    check('A pulled B\'s newer edit', True)
    # Sync off withdraws the server copy.
    B.evaluate("window.__fit.go('me')")
    B.click('label.toggle:has-text("Sync my data") input')
    B.click('.sheet-actions >> text=Turn off')
    B.wait_for_function("/Sync is off/.test(document.getElementById('sync-status') ? document.getElementById('sync-status').textContent : '')")
    raw = B.evaluate("fetch('https://admin.slippylabs.com/api/saves/fit-log',{credentials:'include'}).then(r=>r.json())")
    check('sync off empties the server log', raw.get('save_data', {}).get('w') == [], raw)
    check('B keeps local data after sync off', len(B.evaluate('window.__fit.state.workouts')) == 2)
    b.close()
print('%d failed' % len(fails))
sys.exit(1 if fails else 0)
