/* SlipFit UI helpers: element builder, modals, toasts, unit display, sound. */
(function (root) {
  'use strict';
  const Calc = root.FitCalc;

  /* h('div.card#id', {attrs}, children...) -- tiny element builder. Text children
   * become text nodes, so user-typed names can never inject markup. */
  function h(sel, attrs) {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) m[2].replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
    let kids = Array.prototype.slice.call(arguments, 2);
    // Only a plain object is attributes; 0, '', false, text and nodes are children
    // (a bare `0` used to vanish here, so a zero count rendered as nothing).
    if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { if (attrs !== null && attrs !== undefined) kids.unshift(attrs); attrs = null; }
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;          // only ever used with literal markup
        else if (k in el && k !== 'list' && k !== 'type' && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    append(el, kids);
    return el;
  }

  function append(el, kids) {
    kids.forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) append(el, c);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  /* ---------- modal sheet ---------- */
  let modalStack = [];
  function modal(title, body, opts) {
    opts = opts || {};
    const close = () => {
      back.remove();
      modalStack = modalStack.filter((m) => m !== back);
      document.body.classList.toggle('modal-open', modalStack.length > 0);
      if (opts.onClose) opts.onClose();
    };
    const sheet = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-head', h('h2', title), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      h('div.sheet-body', body),
      opts.actions ? h('div.sheet-actions', opts.actions) : null);
    const back = h('div.backdrop', { onclick: (e) => { if (e.target === back && !opts.sticky) close(); } }, sheet);
    document.body.appendChild(back);
    modalStack.push(back);
    document.body.classList.add('modal-open');
    const first = sheet.querySelector('input,select,textarea');
    if (first && opts.focus !== false && window.matchMedia('(min-width: 720px)').matches) first.focus();
    back.close = close;
    return back;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
  });

  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let answered = false;
      const m = modal(title, h('p', text), {
        onClose: () => { if (!answered) resolve(false); },
        actions: [
          h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Cancel'),
          h('button.btn' + (danger ? '.danger' : ''), { type: 'button', onclick: () => { answered = true; m.close(); resolve(true); } }, okLabel || 'OK'),
        ],
      });
    });
  }

  /* ---------- toasts ---------- */
  function toast(text, kind, ms) {
    let box = document.getElementById('toasts');
    if (!box) { box = h('div#toasts', { 'aria-live': 'polite' }); document.body.appendChild(box); }
    const t = h('div.toast' + (kind ? '.' + kind : ''), text);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms || 3200);
  }

  /* ---------- units ---------- */
  let units = 'imperial';
  const U = {
    set(u) { units = u === 'metric' ? 'metric' : 'imperial'; },
    get metric() { return units === 'metric'; },
    wUnit() { return units === 'metric' ? 'kg' : 'lb'; },
    dUnit() { return units === 'metric' ? 'km' : 'mi'; },
    lUnit() { return units === 'metric' ? 'cm' : 'in'; },
    // weight kg -> display number
    w(kg, dp) { if (kg === undefined || kg === null || kg === '') return ''; const v = units === 'metric' ? kg : Calc.kgToLb(kg); return trim(v, dp === undefined ? 1 : dp); },
    wIn(v) { v = parseFloat(v); if (!isFinite(v)) return undefined; return units === 'metric' ? v : Calc.lbToKg(v); },
    wFmt(kg, dp) { return U.w(kg, dp) + ' ' + U.wUnit(); },
    d(km, dp) { if (km === undefined || km === null || km === '') return ''; return trim(units === 'metric' ? km : Calc.kmToMi(km), dp === undefined ? 2 : dp); },
    dIn(v) { v = parseFloat(v); if (!isFinite(v)) return undefined; return units === 'metric' ? v : Calc.miToKm(v); },
    dFmt(km, dp) { return U.d(km, dp) + ' ' + U.dUnit(); },
    l(cm, dp) { if (cm === undefined || cm === null || cm === '') return ''; return trim(units === 'metric' ? cm : Calc.cmToIn(cm), dp === undefined ? 1 : dp); },
    lIn(v) { v = parseFloat(v); if (!isFinite(v)) return undefined; return units === 'metric' ? v : Calc.inToCm(v); },
    height(cm) {
      if (units === 'metric') return Math.round(cm) + ' cm';
      const inch = Math.round(Calc.cmToIn(cm));
      return Math.floor(inch / 12) + '′ ' + (inch % 12) + '″';
    },
    // Weight increments the progression suggests, in display units.
    inc(lower, equip) {
      if (units === 'metric') return equip === 'dumbbell' || equip === 'kettlebell' ? 2 : lower ? 5 : 2.5;
      return lower && equip !== 'dumbbell' && equip !== 'kettlebell' ? 10 : 5;
    },
  };
  function trim(v, dp) { const f = Math.pow(10, dp); return String(Math.round(v * f) / f); }

  function fmtInt(n) { return Math.round(n).toLocaleString(); }

  function fmtDate(s, opts) {
    const p = s.split('-');
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    return d.toLocaleDateString(undefined, opts || { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function relDay(s, today) {
    const G = root.FitGame;
    const diff = G.dayNum(today) - G.dayNum(s);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return diff + ' days ago';
    return fmtDate(s);
  }

  /* ---------- sound + haptics ---------- */
  let actx = null;
  function beep(times) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime;
      for (let i = 0; i < (times || 3); i++) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = i === (times || 3) - 1 ? 1320 : 880;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.22 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.18);
        o.connect(g).connect(actx.destination);
        o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.2);
      }
    } catch (e) { /* no audio available */ }
  }
  // iOS only lets audio start inside a user gesture; unlock on first tap.
  document.addEventListener('pointerdown', function unlock() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { /* ignore */ }
    document.removeEventListener('pointerdown', unlock);
  });
  function buzz(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern || [200, 100, 200]); } catch (e) { /* ignore */ } }

  /* Number input with -/+ steppers; big targets for sweaty thumbs. */
  function stepper(value, step, onChange, opts) {
    opts = opts || {};
    const input = h('input.num', { type: 'number', inputmode: 'decimal', step: 'any', value: value === undefined ? '' : value, 'aria-label': opts.label || 'value', placeholder: opts.placeholder || '' });
    const bump = (d) => {
      const v = parseFloat(input.value);
      const next = Math.max(opts.min !== undefined ? opts.min : 0, (isFinite(v) ? v : 0) + d);
      input.value = String(Math.round(next * 100) / 100);
      onChange(input.value);
    };
    input.addEventListener('input', () => onChange(input.value));
    return h('div.stepper', h('button.step', { type: 'button', 'aria-label': 'decrease', onclick: () => bump(-step) }, '−'), input,
      h('button.step', { type: 'button', 'aria-label': 'increase', onclick: () => bump(step) }, '+'));
  }

  function field(label, control, hint) {
    return h('label.field', h('span.field-label', label), control, hint ? h('span.hint', hint) : null);
  }

  function select(options, value, onChange, label) {
    const s = h('select', { 'aria-label': label || '' });
    options.forEach((o) => {
      const opt = h('option', { value: String(o[0]) }, o[1]);
      if (String(o[0]) === String(value)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  function seg(options, value, onChange, label) {
    const wrap = h('div.seg', { role: 'radiogroup', 'aria-label': label || '' });
    options.forEach((o) => {
      const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o[0]) === String(value) ? 'true' : 'false',
        class: String(o[0]) === String(value) ? 'on' : '', onclick: () => {
          wrap.querySelectorAll('button').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-checked', 'false'); });
          b.classList.add('on'); b.setAttribute('aria-checked', 'true'); onChange(o[0]);
        } }, o[1]);
      wrap.appendChild(b);
    });
    return wrap;
  }

  function progressBar(frac, cls) {
    return h('div.bar' + (cls ? '.' + cls : ''), h('div.bar-fill', { style: { width: Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%' } }));
  }

  /* SVG ring for the weekly goal. */
  function ring(frac, label, sub) {
    const r = 42, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'ring'); svg.setAttribute('aria-hidden', 'true');
    const mk = (cls, dash) => {
      const ci = document.createElementNS(NS, 'circle');
      ci.setAttribute('cx', '50'); ci.setAttribute('cy', '50'); ci.setAttribute('r', String(r)); ci.setAttribute('class', cls);
      if (dash !== undefined) { ci.setAttribute('stroke-dasharray', c.toFixed(2)); ci.setAttribute('stroke-dashoffset', (c * (1 - dash)).toFixed(2)); }
      return ci;
    };
    svg.appendChild(mk('ring-bg')); svg.appendChild(mk('ring-fg' + (f >= 1 ? ' full' : ''), f));
    return h('div.ring-wrap', svg, h('div.ring-label', h('strong', label), sub ? h('span', sub) : null));
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/octet-stream' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  root.FitUI = { h, clear, modal, confirmBox, toast, U, fmtInt, fmtDate, relDay, beep, buzz, stepper, field, select, seg, progressBar, ring, download };
})(this);
