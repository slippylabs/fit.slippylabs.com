/* SlipFit charts: small hand-drawn canvas charts that follow the page theme.
 * Colours come from CSS custom properties so light and dark both work, and
 * every chart redraws on resize at the device pixel ratio. */
(function (root) {
  'use strict';

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320, hgt = canvas.clientHeight || 200;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    return { ctx: ctx, w: w, h: hgt };
  }

  function niceStep(range, ticks) {
    const raw = range / Math.max(1, ticks);
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  }

  /* Line chart over time.
   * series: [{ points: [[dayNum, value], ...], color: '--accent', dots: true, width: 2 }]
   * fmtX(dayNum) -> label, fmtY(value) -> label */
  function line(canvas, series, opts) {
    opts = opts || {};
    const s = setup(canvas), ctx = s.ctx;
    const all = [];
    series.forEach((se) => se.points.forEach((p) => all.push(p)));
    const font = '12px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.font = font;
    if (!all.length) {
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'center';
      ctx.fillText(opts.empty || 'No data yet', s.w / 2, s.h / 2);
      return;
    }
    let x0 = Math.min.apply(null, all.map((p) => p[0])), x1 = Math.max.apply(null, all.map((p) => p[0]));
    let y0 = Math.min.apply(null, all.map((p) => p[1])), y1 = Math.max.apply(null, all.map((p) => p[1]));
    if (x0 === x1) { x0 -= 3; x1 += 3; }
    if (opts.zero) y0 = Math.min(0, y0);
    const pad = (y1 - y0) * 0.12 || Math.abs(y1) * 0.1 || 1;
    y0 -= opts.zero && y0 === 0 ? 0 : pad; y1 += pad;
    const step = niceStep(y1 - y0, 4);
    y0 = Math.floor(y0 / step) * step; y1 = Math.ceil(y1 / step) * step;
    const L = 44, R = 12, T = 12, B = 26;
    const X = (v) => L + (v - x0) / (x1 - x0) * (s.w - L - R);
    const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (s.h - T - B);
    // grid + y labels
    ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1; ctx.fillStyle = css('--muted'); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = y0; v <= y1 + step / 2; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(s.w - R, y); ctx.stroke();
      ctx.fillText(opts.fmtY ? opts.fmtY(v) : String(Math.round(v * 10) / 10), L - 6, y);
    }
    // x labels: first, middle, last
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const xs = x1 - x0 > 2 ? [x0, (x0 + x1) / 2, x1] : [x0, x1];
    xs.forEach((v, i) => {
      ctx.textAlign = i === 0 ? 'left' : i === xs.length - 1 ? 'right' : 'center';
      ctx.fillText(opts.fmtX ? opts.fmtX(Math.round(v)) : String(v), X(v), s.h - B + 8);
    });
    // series
    series.forEach((se) => {
      if (!se.points.length) return;
      ctx.strokeStyle = css(se.color || '--accent'); ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = se.width || 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(se.dash || []);
      ctx.beginPath();
      se.points.forEach((p, i) => { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); });
      ctx.stroke();
      ctx.setLineDash([]);
      if (se.dots !== false) se.points.forEach((p) => { ctx.beginPath(); ctx.arc(X(p[0]), Y(p[1]), se.points.length > 40 ? 2 : 3.5, 0, Math.PI * 2); ctx.fill(); });
    });
    if (opts.target !== undefined && opts.target >= y0 && opts.target <= y1) {
      ctx.strokeStyle = css('--gold'); ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(L, Y(opts.target)); ctx.lineTo(s.w - R, Y(opts.target)); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  /* Vertical bars. bars: [{ label, value, color? }] */
  function bars(canvas, list, opts) {
    opts = opts || {};
    const s = setup(canvas), ctx = s.ctx;
    ctx.font = '11px system-ui, -apple-system, Segoe UI, sans-serif';
    const max = Math.max(opts.min || 1, Math.max.apply(null, list.map((b) => b.value).concat([0])));
    const L = 8, R = 8, T = 18, B = 22;
    const bw = (s.w - L - R) / Math.max(1, list.length);
    list.forEach((b, i) => {
      const hh = (s.h - T - B) * (b.value / max);
      const x = L + i * bw + bw * 0.18, w = bw * 0.64, y = s.h - B - hh;
      ctx.fillStyle = css(b.color || '--accent');
      roundRect(ctx, x, y, w, Math.max(hh, b.value > 0 ? 3 : 1), 4);
      ctx.fillStyle = css('--muted'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(b.label, x + w / 2, s.h - B + 6);
      if (b.value > 0) { ctx.textBaseline = 'bottom'; ctx.fillStyle = css('--text'); ctx.fillText(opts.fmt ? opts.fmt(b.value) : String(b.value), x + w / 2, y - 3); }
    });
    if (opts.goal) {
      const y = s.h - B - (s.h - T - B) * (opts.goal / max);
      ctx.strokeStyle = css('--gold'); ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(s.w - R, y); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function roundRect(ctx, x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + hh); ctx.lineTo(x, y + hh); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();
  }

  root.FitCharts = { line: line, bars: bars };
})(this);
