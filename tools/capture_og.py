#!/usr/bin/env python3
"""Render og-image.png (1200x630) from the Today screen with the demo log.
    $VENV tools/capture_og.py demo.json"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
state = open(sys.argv[1]).read()
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); h.log_message = lambda *a: None
srv = socketserver.TCPServer(('127.0.0.1', 0), h); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 630}, color_scheme='dark', service_workers='block')
    pg.clock.install(time='2026-10-12T16:00:00')
    pg.add_init_script('localStorage.setItem("slipfit-v1", %r)' % state)
    pg.goto('http://127.0.0.1:%d/index.html#/today' % srv.server_address[1])
    pg.wait_for_selector('.hero')
    pg.add_style_tag(content='#toasts{display:none}')
    pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(ROOT, 'og-image.png'))
    b.close()
