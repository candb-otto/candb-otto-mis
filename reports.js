// MIS Master System - module reports (Phase 1d).
// Framework: report list on the left, filters in the top bar, KPI cards, cross-filtering charts,
// summary table and a "View Details" table. Each report is a small definition object.

const MODULE_REPORTS = {
  production: [
    { key: 'fabric', name: 'Fabric Issue', def: () => FabricReport },
    { key: 'cutting', name: 'Cutting', def: () => CuttingReport },
    { key: 'fusing', name: 'Fusing & Embroidery', def: () => FusingReport },
    { key: 'sewing', name: 'Sewing', def: () => SewingReport },
    { key: 'ironing', name: 'Ironing', def: () => IroningReport },
    { key: 'washing', name: 'Washing', def: () => WashingReport },
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
  const fk = def.filterKey || 'unit', fl = def.dims[fk] || 'Unit';
  const cmp = compareOf(rp.period);

  $('repBody').innerHTML = `
    <header class="rep-filters">
      <div class="filters">
        <label>Period <select id="fPeriod">${hasCur ? '' : `<option value="${cur}" selected>${esc(periodLabel(rp.period))}</option>`}${optHtml}</select></label>
        ${units.length ? `<label>${esc(fl)} <select id="fUnit"><option value="">All</option>${units.map(u => `<option ${rp.filters[fk] === u ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select></label>` : ''}
        ${Object.values(rp.filters).some(v => v != null) ? '<button class="link" id="fClear" type="button">Clear filters</button>' : ''}
        <span class="updated">Last updated ${rp.lastUpdated ? fmtDate(rp.lastUpdated) : '–'}</span>
        ${downloadMenuHtml()}
      </div>
    </header>
    <p class="compare">${esc(periodLabel(rp.period))} compared with ${esc(periodLabel(cmp))}${def.note ? ' · ' + def.note : ''}</p>
    ${filterChips ? `<div class="chips">${filterChips}<span class="note small">Click a bar again to remove its filter.</span></div>` : '<p class="note small hint">Tip: click any bar or table row to filter the whole page.</p>'}
    <div class="tiles" id="repTiles"></div>
    <div id="repCharts"></div>
    <div class="card" id="repSummary"></div>
    <div class="card hidden" id="repDetails"></div>`;

  $('fPeriod').onchange = e => { const [from, to] = e.target.value.split(':'); setPeriod({ from, to }); };
  if ($('fUnit')) $('fUnit').onchange = e => setFilter(fk, e.target.value || null, true);
  if ($('fClear')) $('fClear').onclick = () => { rp.filters = {}; drawReport(data); };
  document.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => setFilter(b.dataset.clear, null, true));
  wireDownloadMenu();

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
// def.detailSources: [{ report, title, map: {dim: column}, consts: {dim: value}, view: row => row }]
// "consts" are filter values the whole sheet has (e.g. Embroidery rows are all process "Embroidery").
async function openDetails(srcIndex = 0) {
  rp.details = { search: '', page: 1, sort: null, dir: 1, src: srcIndex };
  const box = $('repDetails');
  box.classList.remove('hidden');
  box.innerHTML = '<p class="note">Loading all rows…</p>';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try { await ensureRaw(srcIndex); drawDetails(); }
  catch (err) { box.innerHTML = `<p class="status error">${esc(err.message)}</p>`; }
}

async function ensureRaw(i) {
  const src = rp.def.detailSources[i];
  const c = rp.cache[`${rp.period.from}:${rp.period.to}`];
  c.raw = c.raw || {};
  if (!c.raw[src.report]) c.raw[src.report] = await api(`/api/rows?${qs({ report: src.report, from: rp.period.from, to: rp.period.to })}`);
  return c.raw[src.report];
}

function detailMatches(row, src) {
  for (const [dim, val] of Object.entries(rp.filters)) {
    if (val == null) continue;
    if (src.consts && dim in src.consts) { if (String(src.consts[dim]) !== String(val)) return false; continue; }
    if (!src.map || !(dim in src.map)) continue;
    if (String(row[src.map[dim]]) !== String(val)) return false;
  }
  return true;
}

function drawDetails() {
  const def = rp.def, d = rp.details, box = $('repDetails');
  const src = def.detailSources[d.src];
  const c = rp.cache[`${rp.period.from}:${rp.period.to}`];
  const raw = c.raw && c.raw[src.report];
  if (!raw) return;
  const cols = raw.columns;
  let rows = raw.rows.filter(r => detailMatches(src.view ? src.view(r) : r, src));
  if (d.search) { const q = d.search.toLowerCase(); rows = rows.filter(r => cols.some(col => r[col] != null && String(r[col]).toLowerCase().includes(q))); }
  if (d.sort) rows = [...rows].sort((a, b) => { const x = a[d.sort], y = b[d.sort]; return (x == null) - (y == null) || (x > y ? 1 : x < y ? -1 : 0) * d.dir; });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  d.page = Math.min(d.page, pages);
  const slice = rows.slice((d.page - 1) * PAGE_SIZE, d.page * PAGE_SIZE);
  const numCols = new Set(cols.filter(col => raw.rows.some(r => typeof r[col] === 'number')));
  const filtered = Object.values(rp.filters).some(v => v != null);
  const picker = def.detailSources.length > 1
    ? `<select id="detSrc">${def.detailSources.map((s, i) => `<option value="${i}" ${i === d.src ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select>` : '';
  box.innerHTML = `<div class="sec-title" style="margin-top:0">Details – ${esc(src.title)} <small>${esc(periodLabel(rp.period))}${filtered ? ' · filters applied' : ''}</small></div>
    <div class="tbl-tools">${picker}<input class="grow" id="detSearch" placeholder="Search any column" value="${esc(d.search)}"><button class="btn" id="detClose" type="button">Close details</button></div>
    <div class="tbl-wrap"><table><thead><tr>${cols.map(col => `<th data-sort="${esc(col)}" class="${numCols.has(col) ? 'num' : ''}">${esc(col)}${d.sort === col ? (d.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
    <tbody>${slice.map(r => `<tr>${cols.map(col => `<td class="${numCols.has(col) ? 'num' : ''}">${r[col] == null ? '' : typeof r[col] === 'number' ? r[col].toLocaleString('en-IN') : esc(r[col])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">No rows match.</td></tr>`}</tbody></table></div>
    <div class="pager" id="detPager"></div>`;
  pager('detPager', rows.length, d.page, p => { d.page = p; drawDetails(); });
  const s = $('detSearch');
  s.oninput = () => { d.search = s.value; d.page = 1; clearTimeout(d.t); d.t = setTimeout(() => { drawDetails(); const n = $('detSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $('detClose').onclick = () => { rp.details = null; box.classList.add('hidden'); };
  if ($('detSrc')) $('detSrc').onchange = e => openDetails(Number(e.target.value));
  box.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    const col = th.dataset.sort; d.dir = d.sort === col ? -d.dir : 1; d.sort = col; drawDetails();
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
  detailSources: [
    { report: 'sewing_lot', title: 'Sewing lots (Sew 1)', map: { unit: 'Unit', brand: 'Brand', category: 'Catagory', date: 'DATE' } },
    { report: 'sewing_daily', title: 'Daily tailors (Sew 2)', map: { unit: 'Unit', date: 'DATE' } },
  ],
  dims: { unit: 'Unit', brand: 'Brand', category: 'Category', date: 'Date' },
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
    $('btnDetails').onclick = () => openDetails(0);
  },
};

function shortPeriod(p) { return p.from === p.to ? shortMonth(p.from) : `${shortMonth(p.from)}–${shortMonth(p.to)}`; }

// =====================================================================
// Report builder: most Production reports follow one pattern, described by a small config.
//   sources: [{ report, title, dims: {dimKey: column}, consts: {dimKey: value}, measures: {key: column}, dateCol }]
//   dims:    [{ key, label, chart: true/false, top: n }]          (cross-filter dimensions)
//   main:    measure key used for the trend and the dimension charts; mainLabel: its name
//   raw:     true = work from every row (needed when a figure depends on blank cells, e.g. Washing)
//   rowMap:  for raw reports, turns one Excel row into {dims..., date, measures..., n}
//   normalize: {dimKey: value => clean value}
//   kpis(S, P, ctx, h) -> tile HTML list;  summary: { dim, cols: [{ label, get: (S, P) => value, fmt }] }
// S / P = summaries of the current / previous period rows after filters:
//   S.sum(key), S.days(key) = days with key > 0, S.perDay(key), S.ratio(a, b), S.rows
// =====================================================================
function summarise(rows) {
  const S = {
    rows,
    sum: k => sum(rows, r => r[k]),
    days: (k = '__any') => new Set(rows.filter(r => (k === '__any' ? true : r[k] > 0) && r.date).map(r => r.date)).size,
    perDay: (k, dk) => { const d = S.days(dk || k); return d ? S.sum(k) / d : null; },
    ratio: (a, b) => { const y = S.sum(b); return y ? S.sum(a) / y : null; },
  };
  return S;
}
const pct1 = v => (v == null || isNaN(v) ? '–' : v.toFixed(1) + '%');
function deltaCell(cur, prev) {
  if (cur == null || !prev) return '–';
  const ch = (cur - prev) / prev * 100;
  return `<span class="${ch >= 0 ? 'up' : 'down'}">${ch >= 0 ? '▲ +' : '▼ '}${ch.toFixed(1)}%</span>`;
}

function makeReport(cfg) {
  const dimKeys = cfg.dims.map(d => d.key);
  const ident = Object.fromEntries([...dimKeys, 'date'].map(k => [k, k]));
  const fmtOf = f => (f === 'n1' ? n1 : f === 'pct' ? pct1 : n0);

  async function loadRows(src, from, to) {
    if (cfg.raw) {
      const res = await api(`/api/rows?${qs({ report: src.report, from, to })}`);
      return res.rows.map(r => ({ ...src.consts, ...cfg.rowMap(r, src) }));
    }
    const byCols = Object.entries(src.dims || {});
    const mKeys = Object.keys(src.measures);
    const res = await agg({ report: src.report, from, to, by: [...byCols.map(([, c]) => c), 'date'], sum: mKeys.map(k => src.measures[k]) });
    return res.rows.map(a => {
      const o = { ...src.consts };
      byCols.forEach(([k], i) => { o[k] = a[i] ?? '(blank)'; });
      o.date = a[byCols.length];
      mKeys.forEach((k, i) => { o[k] = a[byCols.length + 1 + i] || 0; });
      o.n = a.at(-1);
      return o;
    });
  }

  async function loadTrend(src, from, to) {
    const byCols = Object.entries(src.dims || {});
    const col = cfg.trendCol ? cfg.trendCol(src) : src.measures[cfg.main];
    if (!col) return [];
    const res = await agg({ report: src.report, from, to, by: ['month', ...byCols.map(([, c]) => c)], sum: [col] });
    return res.rows.map(a => {
      const o = { ...src.consts, month: a[0] };
      byCols.forEach(([k], i) => { o[k] = a[1 + i] ?? '(blank)'; });
      o[cfg.main] = a[1 + byCols.length] || 0;
      return o;
    });
  }

  const clean = rows => {
    if (cfg.normalize) for (const r of rows) for (const [k, fn] of Object.entries(cfg.normalize)) if (k in r) r[k] = fn(r[k]);
    return rows;
  };

  return {
    sources: cfg.sources.map(s => s.report),
    dims: { ...Object.fromEntries(cfg.dims.map(d => [d.key, d.label])), date: 'Date' },
    filterKey: cfg.filterKey || cfg.dims[0].key,
    note: cfg.note,
    detailSources: cfg.sources.map(s => ({
      report: s.report, title: s.title, consts: s.consts,
      map: { ...(s.dims || {}), date: s.dateCol }, view: cfg.detailView,
    })),

    async load(p, c) {
      const trendFrom = addMonths(p.to, -11);
      const parts = await Promise.all(cfg.sources.map(s => Promise.all([loadRows(s, p.from, p.to), loadRows(s, c.from, c.to), loadTrend(s, trendFrom, p.to)])));
      return { cur: clean(parts.flatMap(x => x[0])), prev: clean(parts.flatMap(x => x[1])), trend: clean(parts.flatMap(x => x[2])), trendFrom };
    },

    units(data) {
      const k = cfg.filterKey || cfg.dims[0].key;
      return [...new Set(data.cur.map(r => r[k]).filter(v => v != null && v !== '(blank)'))].sort();
    },

    draw(data, ctx) {
      const f = ctx.filters;
      const cur = data.cur.filter(r => matches(r, f, ident));
      const prev = data.prev.filter(r => matches(r, f, ident, ['date']));
      const S = summarise(cur), P = summarise(prev);
      const prevLabel = periodLabel(ctx.compare);
      const h = { prevLabel, d: (a, b, fmt) => deltaHtml(a, b, prevLabel, fmt || n0) };
      $('repTiles').innerHTML = cfg.kpis(S, P, ctx, h).join('');

      const charts = cfg.dims.filter(d => d.chart);
      $('repCharts').innerHTML = `<div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
        <div class="chart-grid three">${charts.map(d => chartBox('c_' + d.key)).join('')}</div>`;
      const fmt = n0;
      const inPeriod = m => m >= ctx.period.from && m <= ctx.period.to;
      const ml = cfg.mainLabel;

      const tr = data.trend.filter(r => matches(r, f, ident, ['date']));
      const months = monthSeq(data.trendFrom, ctx.period.to);
      const tm = groupSum(tr, 'month', cfg.main, false);
      Charts.barsV($('cTrend'), months.map(m => ({ key: m, label: fmtMonth(m), short: shortMonth(m), value: (tm.find(x => x.key === m) || {}).value || 0, hi: inPeriod(m) })),
        { id: cfg.id + '-trend', title: `${ml} – last 12 months`, sub: 'Click a month to view it', keyLabel: 'Month', valueLabel: ml, fmt,
          onClick: d => setPeriod({ from: d.key, to: d.key }) });

      const dd = data.cur.filter(r => matches(r, f, ident, ['date']));
      const byDay = groupSum(dd.filter(r => r.date), 'date', cfg.main, false).sort((a, b) => (a.key < b.key ? -1 : 1));
      Charts.barsV($('cDaily'), byDay.map(x => ({ ...x, label: fmtDay(x.key), short: x.key.slice(8), hi: f.date ? f.date === x.key : false })),
        { id: cfg.id + '-daily', title: `Daily ${ml}`, sub: monthsBetween(ctx.period.from, ctx.period.to) > 1 ? 'All days in the period' : 'Click a day to filter', keyLabel: 'Date', valueLabel: ml, fmt,
          onClick: d => setFilter('date', d.key) });

      for (const d of charts) {
        const rows = data.cur.filter(r => matches(r, f, ident, [d.key]));
        const items = topN(groupSum(rows, d.key, cfg.main), d.top || 12);
        const total = sum(items, x => x.value);
        Charts.barsH($('c_' + d.key), items, { id: `${cfg.id}-${d.key}`, title: `${ml} by ${d.label}`, keyLabel: d.label, valueLabel: ml, fmt, selected: f[d.key] ?? null,
          tip: x => tipHtml(x.label, [[ml, n0(x.value)], ['Share', total ? (x.value / total * 100).toFixed(1) + '%' : '–']]),
          onClick: x => { if (!x.other) setFilter(d.key, x.key); } });
      }

      // Summary table
      const sd = cfg.summary.dim, sdl = cfg.dims.find(d => d.key === sd).label;
      const keys = [...new Set(cur.map(r => r[sd]))].filter(k => k != null).sort((a, b) => summarise(cur.filter(r => r[sd] === b)).sum(cfg.main) - summarise(cur.filter(r => r[sd] === a)).sum(cfg.main));
      const cell = (col, s, p) => {
        const v = col.get(s, p, S);
        return `<td class="num">${col.fmt === 'html' ? v : fmtOf(col.fmt)(v)}</td>`;
      };
      const body = keys.map(k => {
        const s = summarise(cur.filter(r => r[sd] === k)), p = summarise(prev.filter(r => r[sd] === k));
        return `<tr class="click ${f[sd] === k ? 'sel' : ''}" data-k="${esc(k)}"><td>${esc(k)}</td>${cfg.summary.cols.map(col => cell(col, s, p)).join('')}</tr>`;
      }).join('');
      $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by ${esc(sdl)}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>${esc(sdl)}</th>${cfg.summary.cols.map(col => `<th class="num">${esc(col.label === 'vs' ? 'vs ' + shortPeriod(ctx.compare) : col.label)}</th>`).join('')}</tr></thead>
          <tbody>${body || `<tr><td colspan="${cfg.summary.cols.length + 1}" class="empty">No data for this selection.</td></tr>`}</tbody>
          ${keys.length ? `<tfoot><tr class="total"><td>Total</td>${cfg.summary.cols.map(col => cell(col, S, P)).join('')}</tr></tfoot>` : ''}
        </table></div>
        ${cfg.footNote ? `<p class="note small foot-note">${cfg.footNote}</p>` : ''}`;
      $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter(sd, tr.dataset.k));
      $('btnDetails').onclick = () => openDetails(0);
    },
  };
}

// Common summary columns
const COL = {
  qty: (key, label) => ({ label, get: s => s.sum(key) }),
  share: key => ({ label: 'Share', fmt: 'pct', get: (s, p, T) => { const t = T.sum(key); return t ? s.sum(key) / t * 100 : null; } }),
  vs: key => ({ label: 'vs', fmt: 'html', get: (s, p) => deltaCell(s.sum(key), p.sum(key)) }),
  days: key => ({ label: 'Days', get: s => s.days(key) }),
  perDay: (key, label) => ({ label, get: s => s.perDay(key) }),
};

// ---------- Fabric Issue ----------
const FabricReport = makeReport({
  id: 'fab', main: 'qty', mainLabel: 'Fabric Issued',
  sources: [{ report: 'fabric', title: 'Fabric issue (Fabric sheet)', dateCol: 'DATE',
    dims: { unit: 'Unit', brand: 'Brand', category: 'Category', dept: 'Department' }, measures: { qty: 'Qty issued' } }],
  dims: [{ key: 'unit', label: 'Unit', chart: true }, { key: 'brand', label: 'Brand', chart: true, top: 10 },
    { key: 'category', label: 'Category', chart: true }, { key: 'dept', label: 'Department', chart: true }],
  kpis: (S, P, ctx, h) => {
    const top = groupSum(S.rows, 'unit', 'qty')[0];
    return [
      tile('Fabric Issued', n0(S.sum('qty')), 'Quantity issued to cutting', h.d(S.sum('qty'), P.sum('qty'))),
      tile('Average per Day', n0(S.perDay('qty')), `${S.days('qty')} issue days`, h.d(S.perDay('qty'), P.perDay('qty'))),
      tile('Categories Issued', n0(new Set(S.rows.filter(r => r.qty > 0).map(r => r.category)).size), 'Fabric categories with issue'),
      tile('Largest Unit', top ? esc(top.label) : '–', top && S.sum('qty') ? `${(top.value / S.sum('qty') * 100).toFixed(1)}% of issue (${n0(top.value)})` : ''),
    ];
  },
  summary: { dim: 'unit', cols: [COL.qty('qty', 'Fabric Issued'), COL.share('qty'), COL.vs('qty'), COL.days('qty'), COL.perDay('qty', 'Avg / Day')] },
});

// ---------- Cutting ----------
const CuttingReport = makeReport({
  id: 'cut', main: 'prod', mainLabel: 'Cutting Qty',
  sources: [{ report: 'cutting', title: 'Cutting (Cutting sheet)', dateCol: 'Date', dims: { unit: 'Unit' },
    measures: { prod: 'Production Qty', fabIn: 'Fabric In', inward: 'Inward Qty', actual: 'Actual Strength', present: 'Present Strength' } }],
  dims: [{ key: 'unit', label: 'Unit', chart: true }],
  kpis: (S, P, ctx, h) => [
    tile('Cutting Qty', n0(S.sum('prod')), `${S.days('prod')} working days`, h.d(S.sum('prod'), P.sum('prod'))),
    tile('Average per Day', n0(S.perDay('prod')), 'Cutting qty ÷ working days', h.d(S.perDay('prod'), P.perDay('prod'))),
    tile('Fabric In', n0(S.sum('fabIn')), `Inward qty ${n0(S.sum('inward'))}`, h.d(S.sum('fabIn'), P.sum('fabIn'))),
    tile('Present / Day', n0(S.perDay('present')), `Attendance ${pct1(S.ratio('present', 'actual') * 100)}`, h.d(S.perDay('present'), P.perDay('present'))),
    tile('Pieces per Person / Day', n1(S.ratio('prod', 'present')), 'Cutting qty ÷ people present', h.d(S.ratio('prod', 'present'), P.ratio('prod', 'present'), n1)),
  ],
  summary: { dim: 'unit', cols: [COL.qty('prod', 'Cutting Qty'), COL.share('prod'), COL.vs('prod'), COL.days('prod'), COL.perDay('prod', 'Avg / Day'),
    COL.qty('fabIn', 'Fabric In'), COL.perDay('present', 'Present / Day'),
    { label: 'Pcs / Person / Day', fmt: 'n1', get: s => s.ratio('prod', 'present') },
    { label: 'Attendance', fmt: 'pct', get: s => { const r = s.ratio('present', 'actual'); return r == null ? null : r * 100; } }] },
  footNote: 'Present / Day = people present on working days. Attendance = present ÷ actual strength.',
});

// ---------- Fusing & Embroidery (two sheets shown together) ----------
const FusingReport = makeReport({
  id: 'fus', main: 'prod', mainLabel: 'Production',
  sources: [
    { report: 'fusing', title: 'Fusing (Fusing sheet)', dateCol: 'Date', dims: { unit: 'Unit' }, consts: { process: 'Fusing' },
      measures: { prod: 'Production', inward: 'Inward', actual: 'Actual Strength', present: 'Present Strength' } },
    { report: 'embroidery', title: 'Embroidery (Emb sheet)', dateCol: 'Date', consts: { process: 'Embroidery', unit: 'Embroidery' },
      measures: { prod: 'Production Qty', inward: 'Inward Qty', actual: 'Actual Strength', present: 'Present Strength' } },
  ],
  dims: [{ key: 'process', label: 'Process', chart: true }, { key: 'unit', label: 'Floor', chart: true }],
  filterKey: 'unit',
  kpis: (S, P, ctx, h) => {
    const part = (X, pr) => summarise(X.rows.filter(r => r.process === pr));
    const fs = part(S, 'Fusing'), fp = part(P, 'Fusing'), es = part(S, 'Embroidery'), ep = part(P, 'Embroidery');
    return [
      tile('Fusing Production', n0(fs.sum('prod')), `Inward ${n0(fs.sum('inward'))}`, h.d(fs.sum('prod'), fp.sum('prod'))),
      tile('Embroidery Production', n0(es.sum('prod')), `Inward ${n0(es.sum('inward'))}`, h.d(es.sum('prod'), ep.sum('prod'))),
      tile('Fusing Pcs / Person / Day', n1(fs.ratio('prod', 'present')), 'Production ÷ people present', h.d(fs.ratio('prod', 'present'), fp.ratio('prod', 'present'), n1)),
      tile('Embroidery Pcs / Person / Day', n1(es.ratio('prod', 'present')), 'Production ÷ people present', h.d(es.ratio('prod', 'present'), ep.ratio('prod', 'present'), n1)),
      tile('Present / Day', n0(S.perDay('present')), `Attendance ${pct1(S.ratio('present', 'actual') * 100)}`, h.d(S.perDay('present'), P.perDay('present'))),
    ];
  },
  summary: { dim: 'unit', cols: [COL.qty('prod', 'Production'), COL.share('prod'), COL.vs('prod'), COL.qty('inward', 'Inward'),
    COL.days('prod'), COL.perDay('prod', 'Avg / Day'), COL.perDay('present', 'Present / Day'),
    { label: 'Pcs / Person / Day', fmt: 'n1', get: s => s.ratio('prod', 'present') }] },
  footNote: 'Fusing floors come from the Fusing sheet; Embroidery has no floor column, so it is shown as one line.',
});

// ---------- Ironing ----------
const IroningReport = makeReport({
  id: 'iron', main: 'qty', mainLabel: 'Ironing Qty',
  sources: [{ report: 'ironing', title: 'Ironing (Ironing sheet)', dateCol: 'Date', dims: { unit: 'Floor' },
    measures: { qty: 'Production Quantity', tables: 'Production Table' } }],
  dims: [{ key: 'unit', label: 'Floor', chart: true }],
  kpis: (S, P, ctx, h) => [
    tile('Ironing Qty', n0(S.sum('qty')), `${S.days('qty')} working days`, h.d(S.sum('qty'), P.sum('qty'))),
    tile('Average per Day', n0(S.perDay('qty')), 'Ironing qty ÷ working days', h.d(S.perDay('qty'), P.perDay('qty'))),
    tile('Tables / Day', n1(S.perDay('tables', 'qty')), 'Production tables used per working day', h.d(S.perDay('tables', 'qty'), P.perDay('tables', 'qty'), n1)),
    tile('Pieces per Table', n1(S.ratio('qty', 'tables')), 'Ironing qty ÷ table-days', h.d(S.ratio('qty', 'tables'), P.ratio('qty', 'tables'), n1)),
  ],
  summary: { dim: 'unit', cols: [COL.qty('qty', 'Ironing Qty'), COL.share('qty'), COL.vs('qty'), COL.days('qty'), COL.perDay('qty', 'Avg / Day'),
    { label: 'Tables / Day', fmt: 'n1', get: s => s.perDay('tables', 'qty') }, { label: 'Pcs / Table', fmt: 'n1', get: s => s.ratio('qty', 'tables') }] },
  footNote: 'Pcs / Table = total ironing qty ÷ total production tables over the working days.',
});

// ---------- Washing (works from every row: a blank "Received" means the lot is still out) ----------
// The Wash "Floor" column is typed freely ("C", "c", "C1 & C2", "A1 & B", "Sam Unit", "GRT/ W/H"...).
// Rule: each part naming a floor (A, A1, Floor A, c2...) counts as that floor; Sample / Sam Unit = Sample;
// a line covering more than one floor = "Multiple floors"; anything else = "Other".
const normFloor = v => {
  const s = String(v ?? '').trim().replace(/\bfloor\s*/gi, '');
  if (!s) return '(blank)';
  const parts = s.split(/\s*(?:&|,|\/|\.|\band\b)\s*|\s+(?=[A-G]\d?\b)/i).map(p => p.trim()).filter(Boolean);
  const found = new Set();
  let other = false;
  for (const p of parts) {
    const m = /^([a-g])\d?$/i.exec(p);
    if (m) found.add('Floor ' + m[1].toUpperCase());
    else if (/^kids$/i.test(p)) found.add('Floor D');
    else if (/^(sam(ple)?\b.*|sam\s*unit)$/i.test(p)) found.add('Sample');
    else other = true;
  }
  if (found.size === 1 && !other) return [...found][0];
  if (found.size > 1 || (found.size && other)) return 'Multiple floors';
  return 'Other';
};
const numOr0 = v => (typeof v === 'number' ? v : Number(v) || 0);
const WashingReport = makeReport({
  id: 'wash', main: 'sent', mainLabel: 'Sent to Washing', raw: true,
  sources: [{ report: 'washing', title: 'Washing (Wash sheet)', dateCol: 'Sent Date', dims: { floor: 'Floor', jobber: 'Sent To' }, measures: { sent: 'Sent Qty' } }],
  trendCol: () => 'Sent Qty',
  normalize: { floor: normFloor },
  detailView: r => ({ ...r, Floor: normFloor(r.Floor) }),
  rowMap: r => {
    const received = r['Received Qty'] != null || r['Received Date'] != null;
    const sent = numOr0(r['Sent Qty']);
    return {
      floor: r.Floor, jobber: r['Sent To'] ?? '(blank)', date: r['Sent Date'] || null,
      sent, recv: numOr0(r['Received Qty']), short: numOr0(r['Shortage / Excess Qty']),
      days: received ? numOr0(r['No- of Days']) : 0, recvLots: received ? 1 : 0,
      pendLots: received ? 0 : 1, pendQty: received ? 0 : sent, n: 1,
    };
  },
  dims: [{ key: 'jobber', label: 'Jobber', chart: true }, { key: 'floor', label: 'Floor', chart: true }],
  filterKey: 'floor',
  note: 'Floor spellings are grouped (C, c, C1 & C2 → Floor C; several floors → Multiple floors)',
  kpis: (S, P, ctx, h) => {
    const avgDays = X => { const l = X.sum('recvLots'); return l ? X.sum('days') / l : null; };
    const short = S.sum('short');
    return [
      tile('Sent to Washing', n0(S.sum('sent')), `${n0(S.sum('n'))} lot lines`, h.d(S.sum('sent'), P.sum('sent'))),
      tile('Received Back', n0(S.sum('recv')), `${pct1(S.sum('sent') ? S.sum('recv') / S.sum('sent') * 100 : null)} of sent`, h.d(S.sum('recv'), P.sum('recv'))),
      tile('Shortage / Excess', `<span class="${short < 0 ? 'down' : ''}">${n0(short)}</span>`, 'From the sheet (− = shortage)'),
      tile('Average Days at Jobber', n1(avgDays(S)), 'Received lots only', h.d(avgDays(S), avgDays(P), n1)),
      tile('Lots Not Yet Received', n0(S.sum('pendLots')), `${n0(S.sum('pendQty'))} pcs still out`),
    ];
  },
  summary: { dim: 'jobber', cols: [COL.qty('sent', 'Sent Qty'), COL.share('sent'), COL.vs('sent'), COL.qty('recv', 'Received Qty'),
    COL.qty('short', 'Short / Excess'),
    { label: 'Avg Days', fmt: 'n1', get: s => { const l = s.sum('recvLots'); return l ? s.sum('days') / l : null; } },
    COL.qty('pendLots', 'Lots Pending'), COL.qty('pendQty', 'Pcs Pending')] },
  footNote: 'Lots pending = lines with no received date and no received qty. Average days uses the "No- of Days" column of received lots.',
});
