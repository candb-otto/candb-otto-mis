// MIS Master System - small SVG chart kit in the C&B Theme.
// Bars only (vertical for time, horizontal for categories), hover tooltip, click to cross-filter,
// and a table view for every chart. Colours come from theme tokens (--s1, --grid, --axis).

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  let tip;

  function tooltip() {
    if (!tip) { tip = document.createElement('div'); tip.className = 'viz-tip'; document.body.appendChild(tip); }
    return tip;
  }
  function showTip(e, html) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = 'block';
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > innerHeight - 8) y = e.clientY - h - pad;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }

  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  // Compact Indian numbers for axes: 4.4 L, 1.2 Cr, 85 K
  function compact(n) {
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' L';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + ' K';
    return String(Math.round(n));
  }
  // Axis top = 4 round steps (1, 2, 2.5, 5 × 10^n each), so tick labels stay tidy
  function niceMax(v) {
    if (v <= 0) return 4;
    const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p * 4;
    return 40 * p;
  }
  // Bar path with 4px rounded data end, square at the baseline
  function barPath(x, y, w, h, horizontal) {
    const r = Math.min(4, (horizontal ? h : w) / 2, horizontal ? w : h);
    if (h <= 0 || w <= 0) return '';
    if (horizontal) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // Shared shell: title, table toggle, svg area, table area
  function shell(host, opts) {
    host.innerHTML = '';
    host.classList.add('chart');
    const head = document.createElement('div');
    head.className = 'viz-head';
    head.innerHTML = `<h2 class="chart-title">${opts.title}${opts.sub ? `<small>${opts.sub}</small>` : ''}</h2>`;
    const btn = document.createElement('button');
    btn.className = 'viz-toggle'; btn.type = 'button';
    head.appendChild(btn);
    const area = document.createElement('div'); area.className = 'chart-area';
    const table = document.createElement('div'); table.className = 'chart-table tbl-wrap';
    host.append(head, area, table);
    const setMode = asTable => {
      host.dataset.mode = asTable ? 'table' : 'chart';
      area.hidden = asTable; table.hidden = !asTable;
      btn.textContent = asTable ? 'Chart' : 'Table';
    };
    btn.onclick = () => { const t = host.dataset.mode !== 'table'; Charts.tableMode[opts.id] = t; setMode(t); };
    setMode(!!Charts.tableMode[opts.id]);
    return { area, table };
  }

  function tableHtml(items, opts) {
    const total = items.reduce((a, d) => a + (d.value || 0), 0);
    return `<table class="viz-table"><thead><tr><th>${opts.keyLabel || ''}</th><th class="num">${opts.valueLabel || 'Value'}</th>${opts.share ? '<th class="num">Share</th>' : ''}</tr></thead><tbody>` +
      items.map(d => `<tr class="${opts.onClick ? 'click' : ''} ${opts.selected === d.key ? 'sel' : ''}" data-key="${escAttr(d.key)}"><td>${escHtml(d.label)}</td><td class="num">${opts.fmt(d.value)}</td>${opts.share ? `<td class="num">${total ? (d.value / total * 100).toFixed(1) + '%' : '–'}</td>` : ''}</tr>`).join('') +
      '</tbody></table>';
  }

  function wireTable(tableEl, items, opts) {
    if (!opts.onClick) return;
    tableEl.querySelectorAll('tr[data-key]').forEach(tr => tr.onclick = () => {
      const d = items.find(i => String(i.key) === tr.dataset.key);
      if (d) opts.onClick(d);
    });
  }

  // Horizontal bars for categories. items: [{key, label, value}], opts: {title, id, fmt, selected, onClick, tip}
  function barsH(host, items, opts) {
    const { area, table } = shell(host, opts);
    table.innerHTML = tableHtml(items, { ...opts, share: true });
    wireTable(table, items, opts);
    if (!items.length) { area.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
    const W = Math.max(260, area.clientWidth || host.clientWidth || 400);
    const rowH = 26, gap = 2, top = 4, labelW = Math.min(150, Math.max(90, W * 0.32)), valueW = 64;
    const H = top + items.length * (rowH + gap) + 18;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'img', 'aria-label': opts.title });
    const max = niceMax(Math.max(...items.map(d => d.value || 0)));
    const x0 = labelW, plotW = W - labelW - valueW;
    for (let i = 0; i <= 4; i++) {
      const x = x0 + plotW * i / 4;
      el('line', { x1: x, x2: x, y1: top, y2: H - 18, class: i ? 'viz-grid' : 'viz-axis' }, svg);
      el('text', { x, y: H - 4, 'text-anchor': i ? 'middle' : 'start', class: 'viz-tick' }, svg).textContent = compact(max * i / 4);
    }
    items.forEach((d, i) => {
      const y = top + i * (rowH + gap);
      const g = el('g', { class: 'viz-row' + (opts.onClick ? ' clickable' : '') }, svg);
      const dim = opts.selected != null && opts.selected !== d.key;
      el('rect', { x: 0, y, width: W, height: rowH, class: 'viz-hit', fill: 'transparent' }, g);
      const label = el('text', { x: x0 - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'viz-cat' + (dim ? ' dim' : '') }, g);
      label.textContent = truncate(d.label, Math.floor(labelW / 7));
      const w = plotW * (d.value || 0) / max;
      el('path', { d: barPath(x0, y + 5, Math.max(w, d.value ? 1.5 : 0), rowH - 10, true), class: 'viz-mark' + (dim ? ' dim' : ''), fill: 'var(--s1)' }, g);
      el('text', { x: x0 + w + 6, y: y + rowH / 2 + 4, class: 'viz-val' + (dim ? ' dim' : '') }, g).textContent = compact(d.value || 0);
      g.addEventListener('mousemove', e => showTip(e, opts.tip ? opts.tip(d) : `<div class="viz-tip-h">${escHtml(d.label)}</div><b>${opts.fmt(d.value)}</b>`));
      g.addEventListener('mouseleave', hideTip);
      if (opts.onClick) g.addEventListener('click', () => { hideTip(); opts.onClick(d); });
    });
    area.appendChild(svg);
  }

  // Vertical bars for time. items: [{key, label, short, value, hi}] (hi = highlighted)
  function barsV(host, items, opts) {
    const { area, table } = shell(host, opts);
    table.innerHTML = tableHtml(items, opts);
    wireTable(table, items, opts);
    if (!items.length) { area.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
    const W = Math.max(260, area.clientWidth || host.clientWidth || 400), H = opts.height || 220;
    const left = 44, right = 6, top = 10, bottom = 26;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'img', 'aria-label': opts.title });
    const max = niceMax(Math.max(...items.map(d => d.value || 0)));
    const plotW = W - left - right, plotH = H - top - bottom;
    for (let i = 0; i <= 4; i++) {
      const y = top + plotH - plotH * i / 4;
      el('line', { x1: left, x2: W - right, y1: y, y2: y, class: i ? 'viz-grid' : 'viz-axis' }, svg);
      el('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', class: 'viz-tick' }, svg).textContent = compact(max * i / 4);
    }
    const step = plotW / items.length, bw = Math.max(2, Math.min(28, step - 2));
    const every = Math.ceil(items.length / Math.max(1, Math.floor(plotW / 38)));
    const anyHi = items.some(d => d.hi);
    items.forEach((d, i) => {
      const x = left + i * step + (step - bw) / 2;
      const h = plotH * (d.value || 0) / max;
      const g = el('g', { class: 'viz-col' + (opts.onClick ? ' clickable' : '') }, svg);
      el('rect', { x: left + i * step, y: top, width: step, height: plotH, class: 'viz-hit', fill: 'transparent' }, g);
      el('path', { d: barPath(x, top + plotH - h, bw, h, false), class: 'viz-mark' + (anyHi && !d.hi ? ' dim' : ''), fill: 'var(--s1)' }, g);
      if (i % every === 0) el('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'viz-tick' }, g).textContent = d.short || d.label;
      g.addEventListener('mousemove', e => showTip(e, opts.tip ? opts.tip(d) : `<div class="viz-tip-h">${escHtml(d.label)}</div><b>${opts.fmt(d.value)}</b>`));
      g.addEventListener('mouseleave', hideTip);
      if (opts.onClick) g.addEventListener('click', () => { hideTip(); opts.onClick(d); });
    });
    area.appendChild(svg);
  }

  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; }
  function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escAttr(s) { return escHtml(s); }

  return { barsH, barsV, compact, hideTip, tableMode: {} };
})();
