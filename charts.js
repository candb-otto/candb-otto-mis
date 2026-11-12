// MIS Master System - SVG chart kit in the C&B Theme.
// Forms: horizontal bars (rankings), vertical bars with optional line / average line (time),
// doughnut (share of a whole), stacked or grouped columns (parts per category).
// Every chart: hover tooltip, click to cross-filter, legend inside the SVG (so it prints), table view.
// Colours: categorical slots --s1…--s6 (validated palette), --s-other for "Other".

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const SLOTS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
  const OTHER = 'var(--s-other)';
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

  // Colour follows the entity, not its current rank. With weights (e.g. totals over two years) the six
  // biggest names get the six colours and keep them whatever is filtered; smaller names share grey.
  // Without weights, names are taken in alphabetical order.
  function colorMap(keys, weights) {
    const uniq = [...new Set(keys.map(String))].filter(k => k !== '__other');
    const sorted = weights ? uniq.sort((a, b) => (weights[b] || 0) - (weights[a] || 0) || a.localeCompare(b)) : uniq.sort((a, b) => a.localeCompare(b));
    const m = { __other: OTHER };
    sorted.forEach((k, i) => { m[k] = i < SLOTS.length ? SLOTS[i] : OTHER; });
    return m;
  }

  // Compact Indian numbers for axes: 4.4 L, 1.2 Cr, 85 K
  function compact(n) {
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(a >= 1e6 ? 0 : 1).replace(/\.0$/, '') + ' L';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + ' K';
    return String(Math.round(n));
  }
  // Axis labels use one unit for the whole axis (0, 0.5 L, 1 L …), chosen from the axis top
  function axisFmt(max) {
    const [d, u] = max >= 1e7 ? [1e7, ' Cr'] : max >= 1e5 ? [1e5, ' L'] : max >= 1e3 ? [1e3, ' K'] : [1, ''];
    return v => (v === 0 ? '0' : +(v / d).toFixed(2) + u);
  }
  // Axis top = 4 round steps (1, 2, 2.5, 5 × 10^n each), so tick labels stay tidy
  function niceMax(v) {
    if (v <= 0) return 4;
    const raw = v / 4, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p * 4;
    return 40 * p;
  }
  // Bar path with 4px rounded data end, square at the baseline (round = false: square both ends)
  function barPath(x, y, w, h, horizontal, round = true) {
    if (h <= 0 || w <= 0) return '';
    if (!round) return `M${x},${y}H${x + w}V${y + h}H${x}Z`;
    const r = Math.min(4, (horizontal ? h : w) / 2, horizontal ? w : h);
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
  const widthOf = (area, host) => Math.max(260, area.clientWidth || host.clientWidth || 400);

  // Legend drawn inside the SVG (one row, wraps). entries: [{label, color, kind: 'box'|'line'|'dash'}]
  function svgLegend(svg, entries, x0, y0, maxW) {
    let x = x0, y = y0;
    for (const e of entries) {
      const w = 22 + String(e.label).length * 6.4 + 14;
      if (x + w > x0 + maxW && x > x0) { x = x0; y += 18; }
      if (e.kind === 'line') { el('line', { x1: x, x2: x + 14, y1: y - 4, y2: y - 4, stroke: e.color, 'stroke-width': 2 }, svg); el('circle', { cx: x + 7, cy: y - 4, r: 3, fill: e.color }, svg); }
      else if (e.kind === 'dash') el('line', { x1: x, x2: x + 14, y1: y - 4, y2: y - 4, stroke: e.color, 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, svg);
      else el('rect', { x, y: y - 9, width: 10, height: 10, rx: 2, fill: e.color }, svg);
      el('text', { x: x + 20, y, class: 'viz-legend-t' }, svg).textContent = e.label;
      x += w;
    }
    return y - y0 + 18; // height used
  }

  function tableHtml(items, opts) {
    const total = items.reduce((a, d) => a + (d.value || 0), 0);
    const extra = opts.lineLabel ? `<th class="num">${opts.lineLabel}</th>` : '';
    return `<table class="viz-table"><thead><tr><th>${opts.keyLabel || ''}</th><th class="num">${opts.valueLabel || 'Value'}</th>${extra}${opts.share ? '<th class="num">Share</th>' : ''}</tr></thead><tbody>` +
      items.map(d => `<tr class="${opts.onClick ? 'click' : ''} ${opts.selected === d.key ? 'sel' : ''}" data-key="${escAttr(d.key)}"><td>${escHtml(d.label)}</td><td class="num">${opts.fmt(d.value)}</td>${opts.lineLabel ? `<td class="num">${d.line == null ? '–' : opts.fmt(d.line)}</td>` : ''}${opts.share ? `<td class="num">${total ? (d.value / total * 100).toFixed(1) + '%' : '–'}</td>` : ''}</tr>`).join('') +
      '</tbody></table>';
  }

  function wireTable(tableEl, items, opts) {
    if (!opts.onClick) return;
    tableEl.querySelectorAll('tr[data-key]').forEach(tr => tr.onclick = () => {
      const d = items.find(i => String(i.key) === tr.dataset.key);
      if (d) opts.onClick(d);
    });
  }
  function wire(g, d, opts, tipFn) {
    g.addEventListener('mousemove', e => showTip(e, tipFn(d)));
    g.addEventListener('mouseleave', hideTip);
    if (opts.onClick) g.addEventListener('click', () => { hideTip(); opts.onClick(d); });
  }
  const defaultTip = opts => d => `<div class="viz-tip-h">${escHtml(d.label)}</div><b>${opts.fmt(d.value)}</b>`;

  // ---------- Horizontal bars (rankings). items: [{key, label, value, color?}] ----------
  function barsH(host, items, opts) {
    const { area, table } = shell(host, opts);
    table.innerHTML = tableHtml(items, { ...opts, share: true });
    wireTable(table, items, opts);
    if (!items.length) { area.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
    const W = widthOf(area, host);
    // Label space fits the longest name (up to 42% of the width); longer names are shortened with "…"
    const longest = Math.max(...items.map(d => String(d.label).length));
    const rowH = 26, gap = 2, top = 4, valueW = 64, CH = 6.8;
    const labelW = Math.round(Math.min(W * 0.42, Math.max(70, longest * CH + 14)));
    const H = top + items.length * (rowH + gap) + 18;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'img', 'aria-label': opts.title });
    const max = niceMax(Math.max(...items.map(d => d.value || 0)));
    const x0 = labelW, plotW = W - labelW - valueW;
    for (let i = 0; i <= 4; i++) {
      const x = x0 + plotW * i / 4;
      el('line', { x1: x, x2: x, y1: top, y2: H - 18, class: i ? 'viz-grid' : 'viz-axis' }, svg);
      el('text', { x, y: H - 4, 'text-anchor': i ? 'middle' : 'start', class: 'viz-tick' }, svg).textContent = axisFmt(max)(max * i / 4);
    }
    items.forEach((d, i) => {
      const y = top + i * (rowH + gap);
      const g = el('g', { class: 'viz-row' + (opts.onClick ? ' clickable' : '') }, svg);
      const dim = opts.selected != null && opts.selected !== d.key;
      el('rect', { x: 0, y, width: W, height: rowH, class: 'viz-hit', fill: 'transparent' }, g);
      const label = el('text', { x: x0 - 8, y: y + rowH / 2 + 4, 'text-anchor': 'end', class: 'viz-cat' + (dim ? ' dim' : '') }, g);
      label.textContent = truncate(d.label, Math.floor((labelW - 12) / CH));
      if (String(d.label) !== label.textContent) el('title', {}, label).textContent = d.label;
      const w = plotW * (d.value || 0) / max;
      el('path', { d: barPath(x0, y + 5, Math.max(w, d.value ? 1.5 : 0), rowH - 10, true), class: 'viz-mark' + (dim ? ' dim' : ''), fill: d.color || 'var(--s1)' }, g);
      el('text', { x: x0 + w + 6, y: y + rowH / 2 + 4, class: 'viz-val' + (dim ? ' dim' : '') }, g).textContent = opts.valueText ? opts.valueText(d) : compact(d.value || 0);
      wire(g, d, opts, opts.tip || defaultTip(opts));
    });
    area.appendChild(svg);
  }

  // ---------- Vertical bars for time, with optional comparison line and average line ----------
  // items: [{key, label, short, value, hi, line?}]; opts.lineLabel names the line (same unit, same axis);
  // opts.avg = {value, label} draws a dashed reference line.
  function barsV(host, items, opts) {
    const { area, table } = shell(host, opts);
    table.innerHTML = tableHtml(items, opts);
    wireTable(table, items, opts);
    if (!items.length) { area.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
    const W = widthOf(area, host);
    const legend = [{ label: opts.valueLabel || 'Value', color: opts.color || 'var(--s1)', kind: 'box' }];
    if (opts.lineLabel) legend.push({ label: opts.lineLabel, color: 'var(--s3)', kind: 'line' });
    if (opts.avg) legend.push({ label: `${opts.avg.label} ${compact(opts.avg.value)}`, color: 'var(--ink)', kind: 'dash' });
    const legendH = legend.length > 1 ? 22 : 0;
    const H = (opts.height || 220) + legendH;
    const left = 44, right = 6, top = 10 + legendH, bottom = 26;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'img', 'aria-label': opts.title });
    if (legendH) svgLegend(svg, legend, left, 14, W - left);
    const max = niceMax(Math.max(...items.map(d => Math.max(d.value || 0, d.line || 0)), opts.avg ? opts.avg.value : 0));
    const plotW = W - left - right, plotH = H - top - bottom;
    for (let i = 0; i <= 4; i++) {
      const y = top + plotH - plotH * i / 4;
      el('line', { x1: left, x2: W - right, y1: y, y2: y, class: i ? 'viz-grid' : 'viz-axis' }, svg);
      el('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', class: 'viz-tick' }, svg).textContent = axisFmt(max)(max * i / 4);
    }
    const step = plotW / items.length, bw = Math.max(2, Math.min(28, step - 2));
    const every = Math.ceil(items.length / Math.max(1, Math.floor(plotW / 38)));
    const anyHi = items.some(d => d.hi);
    const yOf = v => top + plotH - plotH * (v || 0) / max;
    items.forEach((d, i) => {
      const x = left + i * step + (step - bw) / 2;
      const h = plotH * (d.value || 0) / max;
      const g = el('g', { class: 'viz-col' + (opts.onClick ? ' clickable' : '') }, svg);
      el('rect', { x: left + i * step, y: top, width: step, height: plotH, class: 'viz-hit', fill: 'transparent' }, g);
      el('path', { d: barPath(x, top + plotH - h, bw, h, false), class: 'viz-mark' + (anyHi && !d.hi ? ' dim' : ''), fill: d.color || opts.color || 'var(--s1)' }, g);
      if (i % every === 0) el('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'viz-tick' }, g).textContent = d.short || d.label;
      const tipFn = opts.tip || (dd => `<div class="viz-tip-h">${escHtml(dd.label)}</div><div class="viz-tip-row"><span>${escHtml(opts.valueLabel || 'Value')}</span>&nbsp;<b>${opts.fmt(dd.value)}</b></div>` +
        (opts.lineLabel ? `<div class="viz-tip-row"><span>${escHtml(opts.lineLabel)}</span>&nbsp;<b>${dd.line == null ? '–' : opts.fmt(dd.line)}</b></div>` : ''));
      wire(g, d, opts, tipFn);
    });
    if (opts.lineLabel) {
      const pts = items.map((d, i) => d.line == null ? null : [left + i * step + step / 2, yOf(d.line)]);
      let path = '';
      pts.forEach((p, i) => { if (p) path += (path && pts[i - 1] ? 'L' : 'M') + p[0] + ',' + p[1]; });
      el('path', { d: path, fill: 'none', stroke: 'var(--s3)', 'stroke-width': 2, class: 'viz-line' }, svg);
      pts.forEach(p => { if (p) el('circle', { cx: p[0], cy: p[1], r: 4, fill: 'var(--s3)', stroke: '#fff', 'stroke-width': 2 }, svg); });
    }
    if (opts.avg) {
      const y = yOf(opts.avg.value);
      el('line', { x1: left, x2: W - right, y1: y, y2: y, stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', opacity: 0.7 }, svg);
    }
    area.appendChild(svg);
  }

  // ---------- Doughnut (share of a whole). items: [{key, label, value, color}] ----------
  function donut(host, items, opts) {
    const { area, table } = shell(host, opts);
    table.innerHTML = tableHtml(items, { ...opts, share: true });
    wireTable(table, items, opts);
    const total = items.reduce((a, d) => a + (d.value || 0), 0);
    if (!items.length || !total) { area.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
    const W = widthOf(area, host);
    const R = 78, r = 50, rowH = 20;
    const below = W < 470;                       // narrow: legend under the ring
    const cx = below ? W / 2 : R + 8, legendX = below ? 8 : cx + R + 22;
    const H = below ? 2 * R + 20 + items.length * rowH + 6 : Math.max(2 * R + 16, items.length * rowH + 16);
    const cy = below ? R + 8 : H / 2;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'img', 'aria-label': opts.title });
    let a0 = -Math.PI / 2;
    const arc = (a1, a2) => {
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const p = (rad, a) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
      const [x1, y1] = p(R, a1), [x2, y2] = p(R, a2), [x3, y3] = p(r, a2), [x4, y4] = p(r, a1);
      return `M${x1},${y1}A${R},${R} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${r},${r} 0 ${large} 0 ${x4},${y4}Z`;
    };
    items.forEach((d, i) => {
      const frac = (d.value || 0) / total;
      if (frac <= 0) return;
      const a1 = a0, a2 = a0 + frac * 2 * Math.PI - (frac < 1 ? 0.0001 : 0);
      a0 = a2;
      const dim = opts.selected != null && opts.selected !== d.key;
      const g = el('g', { class: 'viz-slice' + (opts.onClick ? ' clickable' : '') }, svg);
      el('path', { d: frac >= 0.9999 ? arc(-Math.PI / 2, 1.5 * Math.PI - 0.0001) : arc(a1, a2), fill: d.color || SLOTS[i % SLOTS.length], stroke: '#fff', 'stroke-width': 2, class: 'viz-mark' + (dim ? ' dim' : '') }, g);
      // legend row
      const ly = below ? 2 * R + 30 + i * rowH : cy - (items.length * rowH) / 2 + i * rowH + 14;
      const lg = el('g', { class: 'viz-row' + (opts.onClick ? ' clickable' : '') }, svg);
      el('rect', { x: legendX - 4, y: ly - 14, width: W - legendX, height: rowH, fill: 'transparent', class: 'viz-hit' }, lg);
      el('rect', { x: legendX, y: ly - 10, width: 10, height: 10, rx: 2, fill: d.color || SLOTS[i % SLOTS.length], class: 'viz-mark' + (dim ? ' dim' : '') }, lg);
      const pct = (frac * 100).toFixed(frac < 0.1 ? 1 : 0) + '%';
      const room = Math.max(6, Math.floor((W - legendX - 90) / 6.6));
      el('text', { x: legendX + 16, y: ly, class: 'viz-cat' + (dim ? ' dim' : '') }, lg).textContent = truncate(d.label, room);
      el('text', { x: W - 4, y: ly, 'text-anchor': 'end', class: 'viz-val' + (dim ? ' dim' : '') }, lg).textContent = `${compact(d.value)} · ${pct}`;
      const tipFn = opts.tip || (dd => `<div class="viz-tip-h">${escHtml(dd.label)}</div><b>${opts.fmt(dd.value)}</b> <span>(${(dd.value / total * 100).toFixed(1)}%)</span>`);
      wire(g, d, opts, tipFn); wire(lg, d, opts, tipFn);
    });
    el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'viz-center' }, svg).textContent = compact(total);
    el('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', class: 'viz-tick' }, svg).textContent = opts.centerLabel || 'Total';
    area.appendChild(svg);
  }

  // ---------- Stacked or grouped columns ----------
  // cats: [{key, label, short}], series: [{key, label, color}], values[catIndex][seriesIndex]
  // opts.mode: 'stack' (default) or 'group'
  function columns(host, cats, series, values, opts) {
    const { area, table } = shell(host, opts);
    const totals = cats.map((_, i) => series.reduce((a, _s, j) => a + (values[i][j] || 0), 0));
    table.innerHTML = `<table class="viz-table"><thead><tr><th>${opts.keyLabel || ''}</th>${series.map(s => `<th class="num">${escHtml(s.label)}</th>`).join('')}${opts.mode === 'group' ? '' : '<th class="num">Total</th>'}</tr></thead><tbody>` +
      cats.map((c, i) => `<tr class="${opts.onClick ? 'click' : ''} ${opts.selected === c.key ? 'sel' : ''}" data-key="${escAttr(c.key)}"><td>${escHtml(c.label)}</td>${series.map((s, j) => `<td class="num">${opts.fmt(values[i][j] || 0)}</td>`).join('')}${opts.mode === 'group' ? '' : `<td class="num">${opts.fmt(totals[i])}</td>`}</tr>`).join('') + '</tbody></table>';
    wireTable(table, cats, opts);
    if (!cats.length) { area.innerHTML = '<p class="empty">No data for this selection.</p>'; return; }
    const W = widthOf(area, host);
    const legendH = 22, H = (opts.height || 220) + legendH;
    const left = 44, right = 6, top = 10 + legendH, bottom = 26;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'viz-svg', role: 'img', 'aria-label': opts.title });
    svgLegend(svg, series.map(s => ({ label: s.label, color: s.color, kind: 'box' })), left, 14, W - left);
    const group = opts.mode === 'group';
    const max = niceMax(group ? Math.max(...values.flat().map(v => v || 0)) : Math.max(...totals));
    const plotW = W - left - right, plotH = H - top - bottom;
    for (let i = 0; i <= 4; i++) {
      const y = top + plotH - plotH * i / 4;
      el('line', { x1: left, x2: W - right, y1: y, y2: y, class: i ? 'viz-grid' : 'viz-axis' }, svg);
      el('text', { x: left - 6, y: y + 4, 'text-anchor': 'end', class: 'viz-tick' }, svg).textContent = axisFmt(max)(max * i / 4);
    }
    const step = plotW / cats.length;
    const bw = Math.max(4, Math.min(group ? 22 * series.length : 34, step - 8));
    const every = Math.ceil(cats.length / Math.max(1, Math.floor(plotW / 44)));
    cats.forEach((c, i) => {
      const x = left + i * step + (step - bw) / 2;
      const dim = opts.selected != null && opts.selected !== c.key;
      const g = el('g', { class: 'viz-col' + (opts.onClick ? ' clickable' : '') }, svg);
      el('rect', { x: left + i * step, y: top, width: step, height: plotH, class: 'viz-hit', fill: 'transparent' }, g);
      if (group) {
        const sw = (bw - 2 * (series.length - 1)) / series.length;
        series.forEach((s, j) => {
          const h = plotH * (values[i][j] || 0) / max;
          el('path', { d: barPath(x + j * (sw + 2), top + plotH - h, sw, h, false), fill: s.color, class: 'viz-mark' + (dim ? ' dim' : '') }, g);
        });
      } else {
        let y = top + plotH;
        const last = series.map((_, j) => j).filter(j => (values[i][j] || 0) > 0).pop();
        series.forEach((s, j) => {
          const h = plotH * (values[i][j] || 0) / max;
          if (h <= 0) return;
          const seg = Math.max(0, h - (j === last ? 0 : 2));     // 2px gap between stacked parts
          el('path', { d: barPath(x, y - h, bw, seg, false, j === last), fill: s.color, class: 'viz-mark' + (dim ? ' dim' : '') }, g);
          y -= h;
        });
      }
      if (i % every === 0) el('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'viz-tick' }, g).textContent = truncate(c.short || c.label, Math.max(4, Math.floor(step * every / 6.5)));
      const tipFn = () => `<div class="viz-tip-h">${escHtml(c.label)}</div>` + series.map((s, j) =>
        `<div class="viz-tip-row"><i style="background:${s.color};height:8px;width:8px;border-radius:2px"></i><span>${escHtml(s.label)}</span>&nbsp;<b>${opts.fmt(values[i][j] || 0)}</b>${!group && totals[i] ? ` <span>(${((values[i][j] || 0) / totals[i] * 100).toFixed(0)}%)</span>` : ''}</div>`).join('');
      wire(g, c, opts, tipFn);
    });
    area.appendChild(svg);
  }

  function truncate(s, n) { s = String(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; }
  function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function escAttr(s) { return escHtml(s); }

  return { barsH, barsV, donut, columns, colorMap, compact, hideTip, SLOTS, OTHER, tableMode: {} };
})();
