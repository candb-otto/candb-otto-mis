// MIS Master System - module reports (Phase 1d).
// Framework: report list on the left, filters in the top bar, KPI cards, cross-filtering charts,
// summary table and a "View Details" table. Each report is a small definition object.

const MODULE_REPORTS = {
  production: [
    { key: 'fabric', name: 'Fabric Issue' },
    { key: 'cutting', name: 'Cutting' },
    { key: 'fusing', name: 'Fusing & Embroidery' },
    { key: 'sewing', name: 'Sewing', def: () => SewingReport },
    { key: 'ironing', name: 'Ironing' },
    { key: 'washing', name: 'Washing' },
    { key: 'packing', name: 'Packing' },
  ],
};
const MODULE_NAMES = { production: 'Production' };
const REPNAV_KEY = 'mis.repnavOpen';

// ---------- small helpers ----------
const n0 = v => (v == null || isNaN(v) ? '–' : Math.round(v).toLocaleString('en-IN'));
const n1 = v => (v == null || isNaN(v) ? '–' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const sum = (arr, f) => arr.reduce((a, r) => a + (Number(f(r)) || 0), 0);
function addMonths(ym, k) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1) + 1; }
function monthSeq(from, to) { const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out; }
function fyOf(ym) { const [y, m] = ym.split('-').map(Number); const s = m >= 4 ? y : y - 1; return { start: `${s}-04`, end: `${s + 1}-03`, label: `FY ${String(s).slice(2)}-${String(s + 1).slice(2)}` }; }
function shortMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' }) + ' ' + String(y).slice(2); }
function periodLabel(p) { return p.from === p.to ? fmtMonth(p.from) : `${fmtMonth(p.from)} – ${fmtMonth(p.to)}`; }
function deltaHtml(cur, prev, prevLabel, fmt = n0) {
  if (cur == null || prev == null || !prev) return `<div class="s">No ${prevLabel ? esc(prevLabel) : 'previous'} data to compare</div>`;
  const pct = (cur - prev) / prev * 100, up = pct >= 0;
  return `<div class="s"><span class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(1)}%</span> vs ${esc(prevLabel)} (${fmt(prev)})</div>`;
}
// Lists become repeated parameters (?sum=a&sum=b): column names may contain any character
function qs(params) {
  return Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(x => `${k}=${encodeURIComponent(x)}`)).join('&');
}
const agg = p => api('/api/agg?' + qs(p));
// Turns /api/agg arrays into objects with the given names
function objRows(res, names) { return res.rows.map(r => Object.fromEntries(names.map((nm, i) => [nm, r[i]]))); }

// ---------- module page ----------
const rp = { module: null, report: null, months: [], lastUpdated: null, period: null, filters: {}, cache: {}, details: null, token: 0 };

async function loadModule(modKey, repKey) {
  const list = MODULE_REPORTS[modKey];
  if (!list) return go('home');
  const live = list.filter(r => r.def);
  if (!repKey) return go(`module/${modKey}/${(live[0] || list[0]).key}`);
  const rep = list.find(r => r.key === repKey);
  if (!rep) return go(`module/${modKey}`);

  $('pageTitle').textContent = rep.name;
  document.title = `${rep.name} · ${MODULE_NAMES[modKey]} · MIS Master System`;
  $('repNavTitle').textContent = MODULE_NAMES[modKey];
  $('repList').innerHTML = list.map(r => `<button class="rep-btn ${r.key === repKey ? 'active' : ''}" data-rep="${r.key}">
      <span>${esc(r.name)}</span>${r.def ? '' : '<small>soon</small>'}</button>`).join('');
  $('repNav').classList.toggle('collapsed', store(REPNAV_KEY) === '0');
  const activeBtn = $('repList').querySelector('.rep-btn.active');
  if (activeBtn && window.innerWidth <= 860) $('repList').scrollLeft = activeBtn.offsetLeft - 8;

  const changed = rp.module !== modKey || rp.report !== repKey;
  rp.module = modKey; rp.report = repKey;
  if (changed) { rp.filters = {}; rp.details = null; rp.cache = {}; }
  if (!rep.def) return drawComingSoon(rep);
  const def = rep.def();
  rp.def = def;
  try {
    const m = await api(`/api/months?${qs({ report: def.sources })}`);
    rp.months = m.months; rp.lastUpdated = m.lastUpdated;
    if (!rp.months.length) { $('repBody').innerHTML = '<div class="card"><p class="empty">No data uploaded yet for this report. Use <b>Upload data</b> first.</p></div>'; return; }
    if (changed || !rp.period) rp.period = { from: rp.months[0], to: rp.months[0] };
    await refreshReport();
  } catch (err) { say(err.message, 'error'); }
}

function drawComingSoon(rep) {
  $('repBody').innerHTML = `<div class="card soon-card"><h2>${esc(rep.name)}</h2>
    <p class="note">${rep.key === 'packing' ? 'Waiting for the real packing data (the Pack sheet is currently a copy of Wash).' : 'This report is being built in the next step of Phase 1d.'}</p></div>`;
}

function periodOptions() {
  const latest = rp.months[0], oldest = rp.months.at(-1);
  const opts = [];
  const add = (from, to, label) => { if (from < oldest) from = oldest; opts.push({ v: `${from}:${to}`, label }); };
  opts.push({ group: 'Quick' });
  add(latest, latest, `Latest month (${fmtMonth(latest)})`);
  add(addMonths(latest, -2), latest, 'Last 3 months');
  add(addMonths(latest, -11), latest, 'Last 12 months');
  const fy = fyOf(latest);
  add(fy.start, latest, `${fy.label} to date`);
  const pfy = fyOf(addMonths(fy.start, -1));
  if (pfy.end >= oldest) add(pfy.start, pfy.end, pfy.label);
  opts.push({ group: 'Month' });
  rp.months.slice(0, 36).forEach(m => add(m, m, fmtMonth(m)));
  return opts;
}

function compareOf(p) {
  const len = monthsBetween(p.from, p.to);
  return { from: addMonths(p.from, -len), to: addMonths(p.from, -1) };
}

// Fetch (with a small cache) then draw
async function refreshReport() {
  const def = rp.def, token = ++rp.token;
  const key = `${rp.period.from}:${rp.period.to}`;
  const body = $('repBody');
  if (!rp.cache[key]) {
    body.classList.add('loading');
    try { rp.cache[key] = await def.load(rp.period, compareOf(rp.period)); }
    finally { body.classList.remove('loading'); }
  }
  if (token !== rp.token) return;
  drawReport(rp.cache[key]);
}

function drawReport(data) {
  const def = rp.def;
  const filterChips = Object.entries(rp.filters).filter(([, v]) => v != null)
    .map(([k, v]) => `<button class="chip on" data-clear="${esc(k)}" title="Remove this filter">${esc(def.dims[k] || k)}: ${esc(k === 'date' ? fmtDay(v) : v)} ✕</button>`).join('');
  const opts = periodOptions();
  const cur = `${rp.period.from}:${rp.period.to}`;
  const optHtml = opts.map(o => o.group ? `${o.group === 'Quick' ? '' : '</optgroup>'}<optgroup label="${o.group}">` : `<option value="${o.v}" ${o.v === cur ? 'selected' : ''}>${esc(o.label)}</option>`).join('') + '</optgroup>';
  const hasCur = opts.some(o => o.v === cur);
  const units = def.units ? def.units(data) : [];
  const cmp = compareOf(rp.period);

  $('repBody').innerHTML = `
    <header class="rep-filters">
      <div class="filters">
        <label>Period <select id="fPeriod">${hasCur ? '' : `<option value="${cur}" selected>${esc(periodLabel(rp.period))}</option>`}${optHtml}</select></label>
        ${units.length ? `<label>Unit <select id="fUnit"><option value="">All units</option>${units.map(u => `<option ${rp.filters.unit === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>` : ''}
        ${Object.values(rp.filters).some(v => v != null) ? '<button class="link" id="fClear" type="button">Clear filters</button>' : ''}
        <span class="updated">Last updated ${rp.lastUpdated ? fmtDate(rp.lastUpdated) : '–'}</span>
      </div>
    </header>
    <p class="compare">${esc(periodLabel(rp.period))} compared with ${esc(periodLabel(cmp))}${def.note ? ' · ' + def.note : ''}</p>
    ${filterChips ? `<div class="chips">${filterChips}<span class="note small">Click a bar again to remove its filter.</span></div>` : '<p class="note small hint">Tip: click any bar or table row to filter the whole page.</p>'}
    <div class="tiles" id="repTiles"></div>
    <div id="repCharts"></div>
    <div class="card" id="repSummary"></div>
    <div class="card hidden" id="repDetails"></div>`;

  $('fPeriod').onchange = e => { const [from, to] = e.target.value.split(':'); setPeriod({ from, to }); };
  if ($('fUnit')) $('fUnit').onchange = e => setFilter('unit', e.target.value || null, true);
  if ($('fClear')) $('fClear').onclick = () => { rp.filters = {}; drawReport(data); };
  document.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => setFilter(b.dataset.clear, null, true));

  def.draw(data, { period: rp.period, compare: cmp, filters: rp.filters });
  if (rp.details) drawDetails();
}

function setPeriod(p) {
  rp.period = p;
  if (rp.filters.date) rp.filters.date = null;
  rp.details = null;
  refreshReport().catch(err => say(err.message, 'error'));
}

// Power BI style: clicking the selected value again clears it
function setFilter(dim, value, exact) {
  rp.filters[dim] = (!exact && rp.filters[dim] === value) ? null : value;
  drawReport(rp.cache[`${rp.period.from}:${rp.period.to}`]);
}

function fmtDay(d) { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }

// Rows match the filters, except the dimensions listed in "skip"
function matches(row, filters, map, skip = []) {
  for (const [dim, val] of Object.entries(filters)) {
    if (val == null || skip.includes(dim) || !(dim in map)) continue;
    if (String(row[map[dim]]) !== String(val)) return false;
  }
  return true;
}
// Group and total: returns [{key, label, value}] sorted by value
function groupSum(rows, keyField, valueField, sortByValue = true) {
  const m = new Map();
  for (const r of rows) { const k = r[keyField] ?? '(blank)'; m.set(k, (m.get(k) || 0) + (Number(r[valueField]) || 0)); }
  const out = [...m.entries()].map(([key, value]) => ({ key, label: String(key), value }));
  return sortByValue ? out.sort((a, b) => b.value - a.value) : out;
}
function topN(items, n) {
  if (items.length <= n) return items;
  const rest = items.slice(n - 1);
  return [...items.slice(0, n - 1), { key: '__other', label: `Other (${rest.length})`, value: sum(rest, d => d.value), other: true }];
}
function tile(label, value, sub, deltaBlock) {
  return `<div class="tile"><div class="k">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}${deltaBlock || ''}</div>`;
}
function chartBox(id) { return `<div class="card chart-card" id="${id}"></div>`; }
function tipHtml(title, lines) { return `<div class="viz-tip-h">${esc(title)}</div>` + lines.map(([k, v]) => `<div class="viz-tip-row"><span>${esc(k)}</span>&nbsp;<b>${v}</b></div>`).join(''); }

// ---------- View Details ----------
async function openDetails() {
  const def = rp.def;
  const key = `${rp.period.from}:${rp.period.to}`;
  rp.details = { search: '', page: 1, sort: null, dir: 1 };
  const box = $('repDetails');
  box.classList.remove('hidden');
  box.innerHTML = '<p class="note">Loading all rows…</p>';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    if (!rp.cache[key].raw) rp.cache[key].raw = await api(`/api/rows?${qs({ report: def.detailSource, from: rp.period.from, to: rp.period.to })}`);
    drawDetails();
  } catch (err) { box.innerHTML = `<p class="status error">${esc(err.message)}</p>`; }
}

function drawDetails() {
  const def = rp.def, d = rp.details, box = $('repDetails');
  const raw = rp.cache[`${rp.period.from}:${rp.period.to}`].raw;
  if (!raw) return;
  const cols = raw.columns;
  let rows = raw.rows.filter(r => matches(r, rp.filters, def.detailMap));
  if (d.search) { const q = d.search.toLowerCase(); rows = rows.filter(r => cols.some(c => r[c] != null && String(r[c]).toLowerCase().includes(q))); }
  if (d.sort) rows = [...rows].sort((a, b) => { const x = a[d.sort], y = b[d.sort]; return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * d.dir; });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  d.page = Math.min(d.page, pages);
  const slice = rows.slice((d.page - 1) * PAGE_SIZE, d.page * PAGE_SIZE);
  const isNum = c => raw.rows.some(r => typeof r[c] === 'number');
  const numCols = new Set(cols.filter(isNum));
  const filtered = Object.values(rp.filters).some(v => v != null);
  box.innerHTML = `<div class="sec-title" style="margin-top:0">Details – ${esc(def.detailTitle)} <small>${esc(periodLabel(rp.period))}${filtered ? ' · filters applied' : ''}</small></div>
    <div class="tbl-tools"><input class="grow" id="detSearch" placeholder="Search any column" value="${esc(d.search)}"><button class="btn" id="detClose" type="button">Close details</button></div>
    <div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th data-sort="${esc(c)}" class="${numCols.has(c) ? 'num' : ''}">${esc(c)}${d.sort === c ? (d.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${slice.map(r => `<tr>${cols.map(c => `<td class="${numCols.has(c) ? 'num' : ''}">${r[c] == null ? '' : numCols.has(c) && typeof r[c] === 'number' ? r[c].toLocaleString('en-IN') : esc(r[c])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">No rows match.</td></tr>`}</tbody></table></div>
    <div class="pager" id="detPager"></div>`;
  pager('detPager', rows.length, d.page, p => { d.page = p; drawDetails(); });
  const s = $('detSearch');
  s.oninput = () => { d.search = s.value; d.page = 1; clearTimeout(d.t); d.t = setTimeout(() => { drawDetails(); const n = $('detSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $('detClose').onclick = () => { rp.details = null; box.classList.add('hidden'); };
  box.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    const c = th.dataset.sort; d.dir = d.sort === c ? -d.dir : 1; d.sort = c; drawDetails();
  });
}

// ---------- report list (sidebar) events ----------
$('repList').addEventListener('click', e => { const b = e.target.closest('[data-rep]'); if (b) { say(''); go(`module/${rp.module}/${b.dataset.rep}`); } });
$('repNavToggle').addEventListener('click', () => {
  const nav = $('repNav'); nav.classList.toggle('collapsed');
  store(REPNAV_KEY, nav.classList.contains('collapsed') ? '0' : '1');
  if (rp.def && rp.cache[`${rp.period.from}:${rp.period.to}`]) drawReport(rp.cache[`${rp.period.from}:${rp.period.to}`]);
});
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (rp.def && currentRoute().startsWith('module/') && rp.period && rp.cache[`${rp.period.from}:${rp.period.to}`]) drawReport(rp.cache[`${rp.period.from}:${rp.period.to}`]); }, 200);
});

// =====================================================================
// Sewing report: Sew 1 (lot-wise qty), Sew 2 (daily tailors), Sew OT
// =====================================================================
const unitKey = u => String(u || '').replace(/\s*\(.*\)\s*$/, '').trim();

const SewingReport = {
  sources: ['sewing_lot', 'sewing_daily', 'sewing_ot'],
  detailSource: 'sewing_lot',
  detailTitle: 'Sewing lots (Sew 1)',
  dims: { unit: 'Unit', brand: 'Brand', category: 'Category', date: 'Date' },
  detailMap: { unit: 'Unit', brand: 'Brand', category: 'Catagory', date: 'DATE' },
  note: 'Tailor figures from Sew 2, OT from Sew OT',

  async load(p, c) {
    const trendFrom = addMonths(p.to, -11);
    const lotBy = ['Unit', 'Brand', 'Catagory'];
    const otCols = (await api('/api/columns?report=sewing_ot')).columns.filter(x => /^Total Tailors/i.test(x) && x.includes('|'));
    const [lot, lotPrev, trend, daily, dailyPrev, ot, otPrev] = await Promise.all([
      agg({ report: 'sewing_lot', from: p.from, to: p.to, by: [...lotBy, 'date'], sum: ['QTY', 'Equ. Qty'] }),
      agg({ report: 'sewing_lot', from: c.from, to: c.to, by: [...lotBy, 'date'], sum: ['QTY', 'Equ. Qty'] }),
      agg({ report: 'sewing_lot', from: trendFrom, to: p.to, by: ['month', 'Unit', 'Brand', 'Catagory'], sum: ['QTY'] }),
      agg({ report: 'sewing_daily', from: p.from, to: p.to, by: ['Unit', 'date'], sum: ['Qty', 'Tailor Prersent'] }),
      agg({ report: 'sewing_daily', from: c.from, to: c.to, by: ['Unit', 'date'], sum: ['Qty', 'Tailor Prersent'] }),
      otCols.length ? agg({ report: 'sewing_ot', from: p.from, to: p.to, by: ['date'], sum: ['Total', ...otCols] }) : null,
      otCols.length ? agg({ report: 'sewing_ot', from: c.from, to: c.to, by: ['date'], sum: ['Total', ...otCols] }) : null,
    ]);
    const lotNames = ['Unit', 'Brand', 'Catagory', 'date', 'QTY', 'EQ', 'n'];
    const otNames = ['date', 'Total', ...otCols, 'n'];
    return {
      lot: objRows(lot, lotNames),
      lotPrev: objRows(lotPrev, lotNames),
      trend: objRows(trend, ['month', 'Unit', 'Brand', 'Catagory', 'QTY', 'n']),
      trendFrom,
      daily: objRows(daily, ['Unit', 'date', 'Qty', 'Present', 'n']),
      dailyPrev: objRows(dailyPrev, ['Unit', 'date', 'Qty', 'Present', 'n']),
      ot: ot ? objRows(ot, otNames) : [], otPrev: otPrev ? objRows(otPrev, otNames) : [], otCols,
    };
  },

  units(data) { return [...new Set(data.lot.map(r => r.Unit).concat(data.daily.map(r => r.Unit)).filter(Boolean))].sort(); },

  draw(data, ctx) {
    const f = ctx.filters;
    const map = { unit: 'Unit', brand: 'Brand', category: 'Catagory', date: 'date' };
    const lotF = data.lot.filter(r => matches(r, f, map));
    const prevF = data.lotPrev.filter(r => matches(r, f, map, ['date']));
    const qty = sum(lotF, r => r.QTY), prevQty = sum(prevF, r => r.QTY);
    const eq = sum(lotF, r => r.EQ);
    const days = new Set(lotF.filter(r => r.QTY > 0).map(r => r.date)).size;
    const prevLabel = periodLabel(ctx.compare);

    // Tailor figures (Sew 2) only split by unit and date
    const byBrandCat = f.brand != null || f.category != null;
    const dmap = { unit: 'Unit', date: 'date' };
    const dF = data.daily.filter(r => matches(r, f, dmap));
    const dP = data.dailyPrev.filter(r => matches(r, f, dmap, ['date']));
    const dayKeys = rows => new Set(rows.filter(r => r.Present > 0).map(r => r.date)).size;
    const presentDay = rows => { const d = dayKeys(rows); return d ? sum(rows, r => r.Present) / d : null; };
    const perTailor = rows => { const p = sum(rows, r => r.Present); return p ? sum(rows, r => r.Qty) / p : null; };

    // OT (Sew OT): total, or the selected unit's column
    const otCol = f.unit ? data.otCols.find(c => unitKey(c.split('|')[1]) === unitKey(f.unit)) : 'Total';
    const otDay = rows => {
      if (!otCol) return null;
      const r2 = rows.filter(r => (f.date ? r.date === f.date : true) && r[otCol] > 0);
      return r2.length ? sum(r2, r => r[otCol]) / r2.length : null;
    };
    const avgDay = days ? qty / days : null;
    const prevDays = new Set(prevF.filter(r => r.QTY > 0).map(r => r.date)).size;

    $('repTiles').innerHTML = [
      tile('Sewing Qty', n0(qty), `Equivalent qty ${n0(eq)}`, deltaHtml(qty, prevQty, prevLabel)),
      tile('Average per Day', n0(avgDay), `${days} working day${days === 1 ? '' : 's'}`, deltaHtml(avgDay, prevDays ? prevQty / prevDays : null, prevLabel)),
      byBrandCat ? tile('Tailors Present / Day', '–', 'Not split by brand or category') :
        tile('Tailors Present / Day', n0(presentDay(dF)), 'From Sew 2', deltaHtml(presentDay(dF), presentDay(dP), prevLabel)),
      byBrandCat ? tile('Pieces per Tailor / Day', '–', 'Not split by brand or category') :
        tile('Pieces per Tailor / Day', n1(perTailor(dF)), 'Sew 2 qty ÷ tailors present', deltaHtml(perTailor(dF), perTailor(dP), prevLabel, n1)),
      byBrandCat || !otCol ? tile('OT Head Count / Day', '–', otCol ? 'Not split by brand or category' : 'No OT data for this unit') :
        tile('OT Head Count / Day', n1(otDay(data.ot)), 'Calculated head count, OT days', deltaHtml(otDay(data.ot), otDay(data.otPrev), prevLabel, n1)),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid three">${chartBox('cUnit') + chartBox('cBrand') + chartBox('cCat')}</div>`;
    const fmt = v => n0(v);
    const inPeriod = m => m >= ctx.period.from && m <= ctx.period.to;

    // 1. 12-month trend (click a month to switch the period)
    const tr = data.trend.filter(r => matches(r, f, map, ['date']));
    const months = monthSeq(data.trendFrom, ctx.period.to);
    const tm = groupSum(tr, 'month', 'QTY', false);
    Charts.barsV($('cTrend'), months.map(m => ({ key: m, label: fmtMonth(m), short: shortMonth(m), value: (tm.find(x => x.key === m) || {}).value || 0, hi: inPeriod(m) })),
      { id: 'sew-trend', title: 'Sewing Qty – last 12 months', sub: 'Click a month to view it', keyLabel: 'Month', valueLabel: 'Sewing Qty', fmt,
        onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 2. Daily output in the period
    const dd = data.lot.filter(r => matches(r, f, map, ['date']));
    const byDay = groupSum(dd, 'date', 'QTY', false).filter(x => x.key !== '(blank)').sort((a, b) => a.key < b.key ? -1 : 1);
    Charts.barsV($('cDaily'), byDay.map(x => ({ ...x, label: fmtDay(x.key), short: x.key.slice(8), hi: f.date ? f.date === x.key : false })),
      { id: 'sew-daily', title: 'Daily Sewing Qty', sub: monthsBetween(ctx.period.from, ctx.period.to) > 1 ? 'All days in the period' : '', keyLabel: 'Date', valueLabel: 'Sewing Qty', fmt,
        onClick: d => setFilter('date', d.key) });

    // 3-5. By unit, brand, category (each chart is filtered by the others, and highlights its own selection)
    const sharedTip = total => d => tipHtml(d.label, [['Sewing Qty', n0(d.value)], ['Share', total ? (d.value / total * 100).toFixed(1) + '%' : '–']]);
    const dimChart = (host, id, title, dim, field, n) => {
      const rows = data.lot.filter(r => matches(r, f, map, [dim]));
      const items = topN(groupSum(rows, field, 'QTY'), n);
      const total = sum(items, d => d.value);
      Charts.barsH($(host), items, { id, title, keyLabel: this.dims[dim], valueLabel: 'Sewing Qty', fmt, selected: f[dim] ?? null,
        tip: sharedTip(total), onClick: d => { if (!d.other) setFilter(dim, d.key); } });
    };
    dimChart('cUnit', 'sew-unit', 'Sewing Qty by Unit', 'unit', 'Unit', 12);
    dimChart('cBrand', 'sew-brand', 'Sewing Qty by Brand', 'brand', 'Brand', 10);
    dimChart('cCat', 'sew-cat', 'Sewing Qty by Category', 'category', 'Catagory', 12);

    // Summary table by unit
    const units = [...new Set(lotF.map(r => r.Unit).concat(byBrandCat ? [] : dF.map(r => r.Unit)).filter(Boolean))].sort();
    const rowsHtml = units.map(u => {
      const L = lotF.filter(r => r.Unit === u), P = prevF.filter(r => r.Unit === u), D = dF.filter(r => r.Unit === u);
      const q = sum(L, r => r.QTY), pq = sum(P, r => r.QTY), dys = new Set(L.filter(r => r.QTY > 0).map(r => r.date)).size;
      const ch = pq ? (q - pq) / pq * 100 : null;
      return `<tr class="click ${f.unit === u ? 'sel' : ''}" data-unit="${esc(u)}"><td>${esc(u)}</td><td class="num">${n0(q)}</td>
        <td class="num">${qty ? (q / qty * 100).toFixed(1) + '%' : '–'}</td>
        <td class="num">${ch == null ? '–' : `<span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲ +' : '▼ '}${ch.toFixed(1)}%</span>`}</td>
        <td class="num">${dys}</td><td class="num">${dys ? n0(q / dys) : '–'}</td>
        <td class="num">${byBrandCat ? '–' : n0(presentDay(D))}</td><td class="num">${byBrandCat ? '–' : n1(perTailor(D))}</td>
        <td class="num">${n0(sum(L, r => r.EQ))}</td></tr>`;
    }).join('');
    const ch = prevQty ? (qty - prevQty) / prevQty * 100 : null;
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Unit</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Sewing Qty</th><th class="num">Share</th><th class="num">vs ${esc(shortPeriod(ctx.compare))}</th><th class="num">Days</th><th class="num">Avg / Day</th><th class="num">Tailors / Day</th><th class="num">Pcs / Tailor / Day</th><th class="num">Equ. Qty</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="9" class="empty">No data for this selection.</td></tr>'}</tbody>
        ${units.length ? `<tfoot><tr class="total"><td>Total</td><td class="num">${n0(qty)}</td><td class="num">100%</td>
          <td class="num">${ch == null ? '–' : `${ch >= 0 ? '▲ +' : '▼ '}${ch.toFixed(1)}%`}</td><td class="num">${days}</td><td class="num">${n0(avgDay)}</td>
          <td class="num">${byBrandCat ? '–' : n0(presentDay(dF))}</td><td class="num">${byBrandCat ? '–' : n1(perTailor(dF))}</td><td class="num">${n0(eq)}</td></tr></tfoot>` : ''}
      </table></div>
      <p class="note small foot-note">Days = days with sewing output. Tailors / Day = average tailors present on working days (Sew 2). Equ. Qty = equivalent quantity from the file.</p>`;
    $('repSummary').querySelectorAll('tr[data-unit]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.unit));
    $('btnDetails').onclick = openDetails;
  },
};

function shortPeriod(p) { return p.from === p.to ? shortMonth(p.from) : `${shortMonth(p.from)}–${shortMonth(p.to)}`; }
