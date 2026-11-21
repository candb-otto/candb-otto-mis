// MIS Master System - Order Fulfilment reports (Phase 3): Seasonal Fulfilment, Core Fulfilment, DC Dispatch.
// Data: ord_so (order qty), ord_cancel (cancel qty), ord_dc (DC qty) + masters Order Seasons, Item Groups,
// Stock Points, Core Day Buckets.
// Agreed with Mari (20-11-2026):
//   Order line       = SO No + Section + Dept + Brand (DC and cancel lines are matched on Order No + Section + Dept + Brand)
//   Net order        = Order Qty − Cancel Qty
//   DC %             = DC Qty ÷ Net order            (quantity only)
//   On-time DC %     = DC Qty dated on or before the season cut-off ÷ Net order
//   Pending          = Net order − DC Qty (per line, never below 0)
//   Season           = order-number prefix (text before the first "/") → Order Seasons; Type decides the report
//   Core (CO / CE)   = no cut-off; DC qty is split into the Core Day Buckets (days from order date to DC date)
//   RBK, IN (Type Exclude) are left out of fulfilment; DCs with no order number count for the stock point only.
// Invoice % and on-time invoice % follow when the revised invoice file is ready.
// Uses helpers from reports.js / sewing.js (agg, rowsOf, cmpTile, chgHtml, achHtml, pctTxt, dayDiff, shiftP).

const OKey = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const prefixOf = no => String(no || '').split('/')[0].trim().toUpperCase();
const lineKey = (no, sec, dept, br) => [no, sec, dept, br].map(OKey).join('|');
const todayIso = () => new Date().toISOString().slice(0, 10);
const pctOf = (a, b) => (b ? a / b : null);
const pctBar = v => (v == null ? 0 : Math.round(v * 1000) / 10);
const pctFmt = v => (v == null ? '–' : Number(v).toFixed(1) + '%');

// FY to date of the latest month with data (seasons span several months)
const fyToDate = months => { const latest = months[0], fy = fyOf(latest); const from = fy.start < months.at(-1) ? months.at(-1) : fy.start; return { from, to: latest }; };

const ORD = {
  masters: null,
  async loadMasters() {
    const [seasons, groups, points, buckets] = await Promise.all(['ms_order_seasons', 'ms_item_groups', 'ms_stock_points', 'ms_core_buckets'].map(async k => (await api(`/api/masters/rows?key=${k}`)).rows));
    const season = {};
    seasons.forEach(r => { season[String(r['Order Prefix'] || '').trim().toUpperCase()] = { name: r['Season Name'] || r['Order Prefix'], type: r.Type || 'Seasonal', cutoff: r['Cut-off Date'] || null, sort: Number(r['Sort No']) || 999, status: r.Status || '' }; });
    const group = {};
    groups.forEach(r => { group[lineKey('', r.Section, r.Dept, r.Brand)] = r; });
    const point = {};
    points.forEach(r => { point[OKey(r['Site Name']) + '|' + OKey(r['Stock Point'])] = r; });
    const bk = buckets.map(r => ({ label: String(r.Bucket), from: Number(r['From Day']) || 0, to: r['To Day'] == null || r['To Day'] === '' ? Infinity : Number(r['To Day']) }))
      .sort((a, b) => a.from - b.from);
    return { season, group, point, buckets: bk.length ? bk : [{ label: 'All days', from: 0, to: Infinity }] };
  },
  seasonOf(no, M) {
    const p = prefixOf(no), s = M.season[p];
    return s ? { prefix: p, ...s } : { prefix: p, name: `${p || '(no prefix)'} (not in Order Seasons)`, type: 'Seasonal', cutoff: null, sort: 9999, unknown: true };
  },
  groupOf(sec, dept, br, M) {
    const g = M.group[lineKey('', sec, dept, br)] || {};
    return { revSec: g['Rev Section'] || sec || '(none)', revDept: g['Rev Dept'] || dept || '(none)', revBrand: g['Rev Brand'] || br || '(none)',
      merch: g.Merchandiser || '(not set)', wh: g['WH Head'] || '(not set)' };
  },
  bucketOf(days, M) { return (M.buckets.find(b => days >= b.from && days <= b.to) || M.buckets[M.buckets.length - 1]).label; },

  // Order lines placed in the period, with cancels and DCs (up to the latest data) linked to them
  async loadLines(p, keepType) {
    const M = await this.loadMasters();
    const latest = [p.to, ...(rp.months || [])].sort().pop();
    const [so, cn, dc] = await Promise.all([
      agg({ report: 'ord_so', from: p.from, to: p.to, by: ['SO No', 'Section', 'Dept', 'Brand', 'Site', 'date'], sum: ['Order Qty'] }),
      agg({ report: 'ord_cancel', from: p.from, to: latest, by: ['Order No', 'Section', 'Dept', 'Brand'], sum: ['Cancel Qty'] }).catch(() => ({ rows: [] })),
      agg({ report: 'ord_dc', from: p.from, to: latest, by: ['Order No', 'Section', 'Dept', 'Brand', 'date'], sum: ['DC Qty'] }).catch(() => ({ rows: [] })),
    ]);
    const lines = new Map();
    for (const [no, sec, dept, br, site, date, qty] of so.rows) {
      const s = this.seasonOf(no, M);
      if (!keepType(s.type)) continue;
      const k = lineKey(no, sec, dept, br);
      let l = lines.get(k);
      if (!l) {
        const g = this.groupOf(sec, dept, br, M);
        lines.set(k, l = { no, prefix: s.prefix, season: s.name, type: s.type, cutoff: s.cutoff, sort: s.sort, unknown: !!s.unknown, date, month: date ? date.slice(0, 7) : '',
          site: site || '(none)', section: g.revSec, dept: g.revDept, brand: g.revBrand, merch: g.merch, wh: g.wh, rawSec: sec, rawDept: dept, rawBrand: br,
          qty: 0, cancel: 0, dc: 0, onTime: 0, dcs: [] });
      }
      l.qty += qty || 0;
      if (date && date < l.date) { l.date = date; l.month = date.slice(0, 7); }
    }
    for (const [no, sec, dept, br, q] of cn.rows) { const l = lines.get(lineKey(no, sec, dept, br)); if (l) l.cancel += q || 0; }
    for (const [no, sec, dept, br, date, q] of dc.rows) {
      const l = lines.get(lineKey(no, sec, dept, br));
      if (!l || !q) continue;
      l.dc += q;
      if (l.cutoff && date && date <= l.cutoff) l.onTime += q;
      l.dcs.push({ date, qty: q, days: date && l.date ? Math.max(0, dayDiff(l.date, date)) : null });
    }
    const out = [...lines.values()].map(l => ({ ...l, net: Math.max(0, l.qty - l.cancel), pending: Math.max(0, l.qty - l.cancel - l.dc) }));
    return { lines: out, M, latest, loadedTo: latest };
  },

  metrics(L) {
    const qty = sum(L, r => r.qty), cancel = sum(L, r => r.cancel), net = sum(L, r => r.net), dc = sum(L, r => r.dc), pending = sum(L, r => r.pending);
    const withCut = L.filter(r => r.cutoff), netCut = sum(withCut, r => r.net);
    const dcDays = L.flatMap(r => r.dcs).filter(d => d.days != null);
    return { qty, cancel, net, dc, pending, lines: L.length, orders: new Set(L.map(r => OKey(r.no))).size,
      dcPct: pctOf(dc, net), onTime: sum(withCut, r => r.onTime), onTimePct: netCut ? sum(withCut, r => r.onTime) / netCut : null, netCut,
      avgDays: sum(dcDays, d => d.qty) ? sum(dcDays, d => d.days * d.qty) / sum(dcDays, d => d.qty) : null };
  },
  pass(r, f, skip) { return Object.entries(f).every(([d, v]) => v == null || d === skip || r[d] === v); },

  // DC % by one dimension, as horizontal bars (value = %)
  pctBars(host, id, title, L, dim, f, colors) {
    const keys = [...new Set(L.map(r => r[dim]))];
    const items = keys.map(k => { const m = this.metrics(L.filter(r => r[dim] === k)); return { key: k, label: k, value: pctBar(m.dcPct), net: m.net, dc: m.dc, color: colors ? colors[k] : undefined }; })
      .sort((a, b) => b.net - a.net).slice(0, 12);
    Charts.barsH(host, items, { id, title, sub: 'DC % of net order · largest orders first', keyLabel: rpDimLabel(dim), valueLabel: 'DC %', fmt: pctFmt,
      valueText: d => pctFmt(d.value), selected: f[dim] ?? null, onClick: d => setFilter(dim, d.key),
      tip: d => tipHtml(d.label, [['Net order', n0(d.net)], ['DC qty', n0(d.dc)], ['DC %', pctFmt(d.value)]]) });
  },

  pendingTable(L, title) {
    const td = v => `<td class="num">${v}</td>`;
    const P = L.filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 50);
    return `<div class="sec-title">${esc(title)} <small>${P.length ? `largest ${P.length} of ${n0(L.filter(r => r.pending > 0).length)} order lines with pending qty` : ''}</small></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>SO No</th><th>Order Date</th><th>Season</th><th>Section</th><th>Dept</th><th>Brand</th><th>Merchandiser</th><th class="num">Net Order</th><th class="num">DC Qty</th><th class="num">Pending</th><th class="num">Days since order</th></tr></thead>
        <tbody>${P.map(r => `<tr><td>${esc(r.no)}</td><td>${esc(r.date ? fmtYmd(r.date) : '')}</td><td>${esc(r.season)}</td><td>${esc(r.section)}</td><td>${esc(r.dept)}</td><td>${esc(r.brand)}</td><td>${esc(r.merch)}</td>
          ${td(n0(r.net))}${td(n0(r.dc))}${td(n0(r.pending))}${td(r.date ? n0(dayDiff(r.date, todayIso())) : '')}</tr>`).join('') || '<tr><td colspan="11" class="empty">Nothing pending.</td></tr>'}</tbody>
      </table></div>`;
  },
};
const rpDimLabel = dim => (rp.def && rp.def.dims[dim]) || dim;

// ---------------------------------------------------------------- Seasonal Fulfilment
const OrderSeasonal = {
  sources: ['ord_so', 'ord_dc', 'ord_cancel'],
  dims: { season: 'Season', brand: 'Brand', section: 'Section', dept: 'Dept', merch: 'Merchandiser', site: 'Site' },
  filterKey: 'season',
  defaultPeriod: fyToDate,
  noCompare: true,
  note: 'orders placed in this period; DCs up to the latest data',
  detailSources: [
    { report: 'ord_so', title: 'Sales orders', map: { season: '_season', brand: '_brand', section: '_section', dept: '_dept', merch: '_merch', site: 'Site' }, view: r => OrderSeasonal.view(r) },
  ],
  view: r => r,

  async load(p) {
    const d = await ORD.loadLines(p, t => t === 'Seasonal');
    this.view = r => { const s = ORD.seasonOf(r['SO No'], d.M), g = ORD.groupOf(r.Section, r.Dept, r.Brand, d.M); return { ...r, _season: s.name, _brand: g.revBrand, _section: g.revSec, _dept: g.revDept, _merch: g.merch }; };
    return d;
  },
  units(data) { return [...new Set(data.lines.map(r => r.season))].sort((a, b) => this.sortOf(data, a) - this.sortOf(data, b) || a.localeCompare(b)); },
  sortOf(data, name) { const l = data.lines.find(r => r.season === name); return l ? l.sort : 9999; },

  draw(data, ctx) {
    const f = ctx.filters;
    const L = data.lines.filter(r => ORD.pass(r, f));
    const C = ORD.metrics(L);
    const seasons = this.units(data);
    const one = f.season ? data.lines.find(r => r.season === f.season) : null;
    const today = todayIso();
    let cut = `${seasons.length} season${seasons.length === 1 ? '' : 's'}`, cutSub = 'Choose a season to see its cut-off';
    if (one) {
      if (!one.cutoff) { cut = '–'; cutSub = one.unknown ? 'Prefix not in Order Seasons' : 'No cut-off date in Order Seasons'; }
      else { const dd = dayDiff(today, one.cutoff); cut = fmtYmd(one.cutoff); cutSub = dd > 0 ? `${dd} day${dd === 1 ? '' : 's'} to go` : dd === 0 ? 'Today' : `Closed ${-dd} day${dd === -1 ? '' : 's'} ago`; }
    }
    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Ordered', n0(C.qty), `${n0(C.orders)} orders · ${n0(C.lines)} order lines`, []),
      cmpTile('Cancelled', n0(C.cancel), C.qty ? `${pctTxt(C.cancel / C.qty)} of ordered` : '', []),
      cmpTile('Net Order', n0(C.net), 'Ordered − cancelled', []),
      cmpTile('DC Qty', n0(C.dc), 'Delivered against these orders', []),
      cmpTile('DC %', achHtml(C.dcPct), 'DC qty ÷ net order', []),
      cmpTile('On-time DC %', achHtml(C.onTimePct), C.netCut < C.net ? `DC on or before the cut-off · ${n0(C.net - C.netCut)} pcs have no cut-off date` : 'DC on or before the season cut-off', []),
      cmpTile('Pending', n0(C.pending), C.net ? `${pctTxt(C.pending / C.net)} of net order` : '', []),
      cmpTile('Cut-off', cut, cutSub, []),
      cmpTile('Invoice %', '–', 'Waiting for the revised invoice file', []),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid one">${chartBox('cSeason')}</div>
      <div class="chart-grid">${chartBox('cBrand') + chartBox('cSection')}</div>
      <div class="chart-grid">${chartBox('cMerch') + chartBox('cSite')}</div>
      <div class="chart-grid one">${chartBox('cDcDaily')}</div>`;

    // 1. Fulfilment by season (stacked: on time, late, pending)
    const sL = data.lines.filter(r => ORD.pass(r, f, 'season'));
    const sKeys = seasons.filter(s => sL.some(r => r.season === s));
    Charts.columns($('cSeason'), sKeys.map(s => ({ key: s, label: s })),
      [{ key: 'on', label: 'DC on time', color: 'var(--s2)' }, { key: 'late', label: 'DC after cut-off / no cut-off', color: 'var(--s4)' }, { key: 'pend', label: 'Pending', color: 'var(--s5)' }],
      sKeys.map(s => { const m = ORD.metrics(sL.filter(r => r.season === s)); return [m.onTime, m.dc - m.onTime, m.pending]; }),
      { id: 'ord-season', title: 'Fulfilment by Season', sub: 'Net order split into DC on time, DC late and pending · click a season', keyLabel: 'Season', fmt: n0, selected: f.season ?? null, onClick: c => setFilter('season', c.key) });

    // 2–4. DC % by brand, section, merchandiser
    const bc = dimColors(data.lines, 'brand', 'net');
    ORD.pctBars($('cBrand'), 'ord-brand', 'DC % by Brand', data.lines.filter(r => ORD.pass(r, f, 'brand')), 'brand', f, bc);
    ORD.pctBars($('cSection'), 'ord-section', 'DC % by Section', data.lines.filter(r => ORD.pass(r, f, 'section')), 'section', f);
    ORD.pctBars($('cMerch'), 'ord-merch', 'DC % by Merchandiser', data.lines.filter(r => ORD.pass(r, f, 'merch')), 'merch', f);

    // 5. Net order by site
    const stL = data.lines.filter(r => ORD.pass(r, f, 'site'));
    const sc = dimColors(data.lines, 'site', 'net');
    Charts.donut($('cSite'), topN(groupSum(stL, 'site', 'net'), 6).map(x => ({ ...x, color: sc[x.other ? '__other' : x.key] })),
      { id: 'ord-site', title: 'Net Order by Site', keyLabel: 'Site', valueLabel: 'Net order', fmt: n0, centerLabel: 'Net order', selected: f.site ?? null, onClick: d => { if (!d.other) setFilter('site', d.key); } });

    // 6. Daily DC against these orders
    const byDay = {};
    L.forEach(r => r.dcs.forEach(d => { if (d.date) byDay[d.date] = (byDay[d.date] || 0) + d.qty; }));
    const days = Object.keys(byDay).sort();
    Charts.barsV($('cDcDaily'), days.map(d => ({ key: d, label: fmtYmd(d), short: d.slice(8), value: byDay[d], hi: data.lines.some(r => r.cutoff === d) })),
      { id: 'ord-dcdaily', title: 'Daily DC against these orders', sub: 'DC date · up to the latest data', keyLabel: 'DC Date', valueLabel: 'DC Qty', fmt: n0 });

    // Summary by season
    const td = v => `<td class="num">${v}</td>`;
    const line = (name, m, cutoff, total, unknown) => {
      const dd = cutoff ? dayDiff(today, cutoff) : null;
      return `<tr class="${total ? 'total' : 'click'} ${f.season === name ? 'sel' : ''}" ${total ? '' : `data-k="${esc(name)}"`}><td>${esc(name)}${unknown ? ' <span class="note small">add it in Masters → Order Seasons</span>' : ''}</td>
        <td>${cutoff ? esc(fmtYmd(cutoff)) : (total ? '' : '–')}</td>${td(n0(m.qty))}${td(n0(m.cancel))}${td(n0(m.net))}${td(n0(m.dc))}${td(achHtml(m.dcPct))}${td(achHtml(m.onTimePct))}${td(n0(m.pending))}
        ${td(dd == null ? '' : dd > 0 ? `${dd} to go` : dd === 0 ? 'today' : `closed`)}</tr>`;
    };
    const rows = (f.season ? [f.season] : sKeys).map(s => { const sl = sL.filter(r => r.season === s); return line(s, ORD.metrics(sl), sl[0] && sl[0].cutoff, false, sl[0] && sl[0].unknown); });
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Season – orders placed ${esc(periodLabel(ctx.period))}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Season</th><th>Cut-off</th><th class="num">Ordered</th><th class="num">Cancelled</th><th class="num">Net Order</th><th class="num">DC Qty</th><th class="num">DC %</th><th class="num">On-time DC %</th><th class="num">Pending</th><th class="num">Days</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="10" class="empty">No seasonal orders in this period.</td></tr>'}</tbody>
        ${rows.length > 1 ? `<tfoot>${line('Total', ORD.metrics(sL.filter(r => ORD.pass(r, f))), null, true)}</tfoot>` : ''}
      </table></div>
      ${ORD.pendingTable(L, 'Pending order lines')}
      <p class="note small foot-note">Orders placed in the chosen period; cancellations and DCs are counted up to ${esc(fmtMonth(data.latest))}. A DC is linked to its order by Order No + Section + Dept + Brand. On time = DC dated on or before the season cut-off (Masters → Order Seasons). RBK and IN orders are left out. Invoice % follows when the revised invoice file is ready.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('season', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};

// ---------------------------------------------------------------- Core Fulfilment
const OrderCore = {
  sources: ['ord_so', 'ord_dc', 'ord_cancel'],
  dims: { brand: 'Brand', section: 'Section', dept: 'Dept', merch: 'Merchandiser', site: 'Site', month: 'Order Month' },
  filterKey: 'brand',
  defaultPeriod: fyToDate,
  noCompare: true,
  note: 'Core orders (CO / CE) placed in this period; DCs up to the latest data',
  detailSources: [
    { report: 'ord_so', title: 'Sales orders', map: { brand: '_brand', section: '_section', dept: '_dept', merch: '_merch', site: 'Site' }, view: r => OrderCore.view(r) },
  ],
  view: r => r,

  async load(p) {
    const d = await ORD.loadLines(p, t => t === 'Core');
    this.view = r => { const g = ORD.groupOf(r.Section, r.Dept, r.Brand, d.M); return { ...r, _brand: g.revBrand, _section: g.revSec, _dept: g.revDept, _merch: g.merch }; };
    return d;
  },
  units(data) { return [...new Set(data.lines.map(r => r.brand))].sort(); },

  buckets(L, M) {
    const out = Object.fromEntries(M.buckets.map(b => [b.label, 0]));
    L.forEach(r => r.dcs.forEach(d => { if (d.days != null) out[ORD.bucketOf(d.days, M)] += d.qty; }));
    return out;
  },

  draw(data, ctx) {
    const f = ctx.filters, M = data.M;
    const L = data.lines.filter(r => ORD.pass(r, f));
    const C = ORD.metrics(L);
    const B = this.buckets(L, M), first = M.buckets[0];
    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Ordered', n0(C.qty), `${n0(C.orders)} orders · ${n0(C.lines)} order lines`, []),
      cmpTile('Cancelled', n0(C.cancel), C.qty ? `${pctTxt(C.cancel / C.qty)} of ordered` : '', []),
      cmpTile('Net Order', n0(C.net), 'Ordered − cancelled', []),
      cmpTile('DC Qty', n0(C.dc), 'Delivered against these orders', []),
      cmpTile('DC %', achHtml(C.dcPct), 'DC qty ÷ net order', []),
      cmpTile('Pending', n0(C.pending), C.net ? `${pctTxt(C.pending / C.net)} of net order` : '', []),
      cmpTile('Average Days to DC', C.avgDays == null ? '–' : n1(C.avgDays), 'Order date to DC date, weighted by qty', []),
      cmpTile(`DC within ${esc(first.label)}`, pctTxt(pctOf(B[first.label], C.dc)), `${n0(B[first.label])} of ${n0(C.dc)} pcs`, []),
      cmpTile('Invoice %', '–', 'Waiting for the revised invoice file', []),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid">${chartBox('cBucket') + chartBox('cAge')}</div>
      <div class="chart-grid one">${chartBox('cMonth')}</div>
      <div class="chart-grid">${chartBox('cBrand') + chartBox('cSection')}</div>
      <div class="chart-grid one">${chartBox('cMerch')}</div>`;

    // 1. DC qty by day bucket
    Charts.barsV($('cBucket'), M.buckets.map(b => ({ key: b.label, label: b.label, short: b.label.replace(/\s*days?$/i, ''), value: B[b.label] })),
      { id: 'core-bucket', title: 'DC Qty by Days from Order', sub: 'Buckets from Masters → Core Day Buckets', keyLabel: 'Days', valueLabel: 'DC Qty', fmt: n0,
        tip: d => tipHtml(d.label, [['DC qty', n0(d.value)], ['Share of DC', pctTxt(pctOf(d.value, C.dc))]]) });

    // 2. Pending qty by age (today − order date)
    const age = Object.fromEntries(M.buckets.map(b => [b.label, 0]));
    L.filter(r => r.pending > 0 && r.date).forEach(r => { age[ORD.bucketOf(dayDiff(r.date, todayIso()), M)] += r.pending; });
    Charts.barsH($('cAge'), M.buckets.map(b => ({ key: b.label, label: b.label, value: age[b.label], color: 'var(--s5)' })),
      { id: 'core-age', title: 'Pending Qty by Age', sub: 'Days since the order date (today)', keyLabel: 'Age', valueLabel: 'Pending', fmt: n0 });

    // 3. By order month: DC vs pending
    const mL = data.lines.filter(r => ORD.pass(r, f, 'month'));
    const months = [...new Set(mL.map(r => r.month))].filter(Boolean).sort();
    Charts.columns($('cMonth'), months.map(m => ({ key: m, label: shortMonth(m) })),
      [{ key: 'dc', label: 'DC qty', color: 'var(--s2)' }, { key: 'pend', label: 'Pending', color: 'var(--s5)' }],
      months.map(m => { const x = ORD.metrics(mL.filter(r => r.month === m)); return [x.dc, x.pending]; }),
      { id: 'core-month', title: 'Fulfilment by Order Month', sub: 'Click a month to filter', keyLabel: 'Order month', fmt: n0, selected: f.month ?? null, onClick: c => setFilter('month', c.key) });

    // 4–6. DC % by brand, section, merchandiser
    ORD.pctBars($('cBrand'), 'core-brand', 'DC % by Brand', data.lines.filter(r => ORD.pass(r, f, 'brand')), 'brand', f, dimColors(data.lines, 'brand', 'net'));
    ORD.pctBars($('cSection'), 'core-section', 'DC % by Section', data.lines.filter(r => ORD.pass(r, f, 'section')), 'section', f);
    ORD.pctBars($('cMerch'), 'core-merch', 'DC % by Merchandiser', data.lines.filter(r => ORD.pass(r, f, 'merch')), 'merch', f);

    // Summary by brand with bucket split
    const td = v => `<td class="num">${v}</td>`;
    const bL = data.lines.filter(r => ORD.pass(r, f, 'brand'));
    const brands = f.brand ? [f.brand] : [...new Set(bL.map(r => r.brand))].sort();
    const row = (name, LL, total) => {
      const m = ORD.metrics(LL), b = this.buckets(LL, M);
      return `<tr class="${total ? 'total' : 'click'} ${f.brand === name ? 'sel' : ''}" ${total ? '' : `data-k="${esc(name)}"`}><td>${esc(name)}</td>${td(n0(m.qty))}${td(n0(m.net))}${td(n0(m.dc))}${td(achHtml(m.dcPct))}${td(n0(m.pending))}${td(m.avgDays == null ? '–' : n1(m.avgDays))}
        ${M.buckets.map(x => td(pctTxt(pctOf(b[x.label], m.dc)))).join('')}</tr>`;
    };
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Brand – core orders placed ${esc(periodLabel(ctx.period))}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Brand</th><th class="num">Ordered</th><th class="num">Net Order</th><th class="num">DC Qty</th><th class="num">DC %</th><th class="num">Pending</th><th class="num">Avg Days</th>${M.buckets.map(b => `<th class="num">${esc(b.label)}</th>`).join('')}</tr></thead>
        <tbody>${brands.map(b => row(b, bL.filter(r => r.brand === b))).join('') || `<tr><td colspan="${7 + M.buckets.length}" class="empty">No core orders in this period.</td></tr>`}</tbody>
        ${brands.length > 1 ? `<tfoot>${row('Total', bL, true)}</tfoot>` : ''}
      </table></div>
      <p class="note small">Bucket columns = share of the DC qty delivered within those days of the order date.</p>
      ${ORD.pendingTable(L, 'Pending core order lines')}
      <p class="note small foot-note">Core orders = order prefixes with Type "Core" in Masters → Order Seasons (CO, CE). Orders placed in the chosen period; cancellations and DCs are counted up to ${esc(fmtMonth(data.latest))}. Day buckets come from Masters → Core Day Buckets and can be changed there.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('brand', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};

// ---------------------------------------------------------------- DC Dispatch (by DC date)
const DC_KINDS = { order: 'Against orders', none: 'Without order no', excl: 'Returns / excluded (RBK, IN)' };
const OrderDispatch = {
  sources: ['ord_dc'],
  dims: { sp: 'Stock Point', wh: 'WH Head', kind: 'DC Type', section: 'Section', date: 'Date' },
  filterKey: 'sp',
  compareModes: true,
  noTarget: true,
  detailSources: [
    { report: 'ord_dc', title: 'DC lines', map: { sp: 'Stock Point', wh: '_wh', kind: '_kind', section: '_section', date: 'DC Date' }, view: r => OrderDispatch.view(r) },
  ],
  view: r => r,

  async load(p, c) {
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), c.from].sort()[0];
    const M = await ORD.loadMasters();
    const res = await agg({ report: 'ord_dc', from, to: p.to, by: ['date', 'Site', 'Stock Point', 'Order No', 'DC No', 'Section', 'Dept', 'Brand'], sum: ['DC Qty'] });
    const kindOf = no => { if (!no || !String(no).trim()) return DC_KINDS.none; const s = M.season[prefixOf(no)]; return s && s.type === 'Exclude' ? DC_KINDS.excl : DC_KINDS.order; };
    const spOf = (site, sp) => { const x = M.point[OKey(site) + '|' + OKey(sp)]; return { wh: (x && x['WH Head']) || '(not set)', measured: !!(x && x.Measure === 'Yes') }; };
    const rows = res.rows.map(([date, site, sp, no, dcno, sec, dept, br, q]) => {
      const s = spOf(site, sp), g = ORD.groupOf(sec, dept, br, M);
      return { date, month: date ? date.slice(0, 7) : '', site: site || '(none)', sp: sp || '(none)', wh: s.wh, measured: s.measured, kind: kindOf(no), dcno, section: g.revSec, qty: q || 0 };
    });
    this.view = r => { const s = spOf(r.Site, r['Stock Point']), g = ORD.groupOf(r.Section, r.Dept, r.Brand, M); return { ...r, _wh: s.wh, _kind: kindOf(r['Order No']), _section: g.revSec }; };
    return { rows, M, loadedFrom: from };
  },
  units(data) { return [...new Set(data.rows.map(r => r.sp))].sort(); },

  metrics(data, range, f) {
    const R = data.rows.filter(r => r.month >= range.from && r.month <= range.to && ORD.pass(r, f));
    const by = k => sum(R.filter(r => r.kind === k), r => r.qty);
    const days = new Set(R.filter(r => r.qty > 0).map(r => r.date)).size;
    return { qty: sum(R, r => r.qty), order: by(DC_KINDS.order), none: by(DC_KINDS.none), excl: by(DC_KINDS.excl),
      dcs: new Set(R.map(r => r.dcno)).size, days, perDay: days ? sum(R, r => r.qty) / days : null, points: new Set(R.map(r => r.sp)).size };
  },

  draw(data, ctx) {
    const f = ctx.filters, p = ctx.period;
    const refR = ctx.compareMode === 'ly' ? shiftP(p, -12) : ctx.compare;
    const C = this.metrics(data, p, f), R = this.metrics(data, refR, f);
    const refLabel = shortPeriod(refR);
    const cmp = (a, b) => [[`vs ${refLabel}`, chgHtml(a, b)]];
    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('DC Qty', n0(C.qty), `${n0(C.dcs)} DCs · ${n0(C.days)} days with DC`, cmp(C.qty, R.qty)),
      cmpTile('Against Orders', n0(C.order), C.qty ? `${pctTxt(C.order / C.qty)} of DC qty` : '', cmp(C.order, R.order)),
      cmpTile('Without Order No', n0(C.none), 'Menswear / Junior DCs with no order number', cmp(C.none, R.none)),
      cmpTile('Returns / Excluded', n0(C.excl), 'RBK and IN orders (not fulfilment)', cmp(C.excl, R.excl)),
      cmpTile('Average per Day', n0(C.perDay), 'DC qty ÷ days with DC', cmp(C.perDay, R.perDay)),
      cmpTile('Stock Points', n0(C.points), 'Stock points that sent DCs', []),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid">${chartBox('cTrend') + chartBox('cKind')}</div>
      <div class="chart-grid one">${chartBox('cSp')}</div>
      <div class="chart-grid">${chartBox('cWh') + chartBox('cSec')}</div>
      <div class="chart-grid one">${chartBox('cDaily')}</div>`;
    const inP = r => r.month >= p.from && r.month <= p.to;
    const except = k => r => ORD.pass(r, f, k);

    const trendFrom = addMonths(p.to, -11), tf = { ...f, date: null };
    Charts.barsV($('cTrend'), monthSeq(trendFrom, p.to).map(m => ({ key: m, label: fmtMonth(m), short: shortMonth(m), value: this.metrics(data, { from: m, to: m }, tf).qty, hi: m >= p.from && m <= p.to })),
      { id: 'dc-trend', title: 'DC Qty – last 12 months', sub: 'Click a month to view it', keyLabel: 'Month', valueLabel: 'DC Qty', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    const kc = { [DC_KINDS.order]: 'var(--s2)', [DC_KINDS.none]: 'var(--s4)', [DC_KINDS.excl]: 'var(--s6)' };
    Charts.donut($('cKind'), groupSum(data.rows.filter(r => inP(r) && except('kind')(r)), 'kind', 'qty').map(x => ({ ...x, color: kc[x.key] })),
      { id: 'dc-kind', title: 'DC Qty by Type', keyLabel: 'Type', valueLabel: 'DC Qty', fmt: n0, centerLabel: 'DC qty', selected: f.kind ?? null, onClick: d => setFilter('kind', d.key) });

    const spRows = data.rows.filter(r => inP(r) && except('sp')(r));
    const sps = groupSum(spRows, 'sp', 'qty').slice(0, 15).map(x => x.key);
    Charts.columns($('cSp'), sps.map(s => ({ key: s, label: s })),
      Object.values(DC_KINDS).map(k => ({ key: k, label: k, color: kc[k] })),
      sps.map(s => Object.values(DC_KINDS).map(k => sum(spRows.filter(r => r.sp === s && r.kind === k), r => r.qty))),
      { id: 'dc-sp', title: 'DC Qty by Stock Point', sub: 'Largest 15 · click a stock point to filter', keyLabel: 'Stock point', fmt: n0, selected: f.sp ?? null, onClick: c => setFilter('sp', c.key) });

    const whc = dimColors(data.rows, 'wh', 'qty');
    Charts.barsH($('cWh'), groupSum(data.rows.filter(r => inP(r) && except('wh')(r)), 'wh', 'qty').map(x => ({ ...x, color: whc[x.key] })),
      { id: 'dc-wh', title: 'DC Qty by WH Head', sub: 'WH head from Masters → Stock Points', keyLabel: 'WH Head', valueLabel: 'DC Qty', fmt: n0, selected: f.wh ?? null, onClick: d => setFilter('wh', d.key) });
    Charts.barsH($('cSec'), topN(groupSum(data.rows.filter(r => inP(r) && except('section')(r)), 'section', 'qty'), 10),
      { id: 'dc-sec', title: 'DC Qty by Section', keyLabel: 'Section', valueLabel: 'DC Qty', fmt: n0, selected: f.section ?? null, onClick: d => { if (!d.other) setFilter('section', d.key); } });

    drawDaily($('cDaily'), 'dc-daily', data.rows.filter(r => inP(r) && except('date')(r)).map(r => ({ date: r.date, v: r.qty })), 'v', 'DC Qty', ctx, f, true);

    // Summary by stock point
    const td = v => `<td class="num">${v}</td>`;
    const pts = [...new Set(spRows.map(r => r.site + '|' + r.sp))];
    const lineOf = key => {
      const [site, sp] = key.split('|'), rr = spRows.filter(r => r.site === site && r.sp === sp), ref = data.rows.filter(r => r.month >= refR.from && r.month <= refR.to && r.site === site && r.sp === sp && except('sp')(r));
      const by = k => sum(rr.filter(r => r.kind === k), r => r.qty), q = sum(rr, r => r.qty);
      return { site, sp, wh: rr[0] ? rr[0].wh : '', measured: rr[0] && rr[0].measured, q, ref: sum(ref, r => r.qty), order: by(DC_KINDS.order), none: by(DC_KINDS.none), excl: by(DC_KINDS.excl),
        dcs: new Set(rr.map(r => r.dcno)).size, days: new Set(rr.map(r => r.date)).size };
    };
    const lines = pts.map(lineOf).sort((a, b) => b.q - a.q);
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Stock Point – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Stock Point</th><th>Site</th><th>WH Head</th><th class="num">DCs</th><th class="num">Days</th><th class="num">Against Orders</th><th class="num">Without Order No</th><th class="num">Returns / Excl.</th><th class="num">Total DC Qty</th><th class="num">vs ${esc(refLabel)}</th></tr></thead>
        <tbody>${lines.map(l => `<tr class="click ${f.sp === l.sp ? 'sel' : ''}" data-k="${esc(l.sp)}"><td>${esc(l.sp)}${l.measured ? '' : ' <span class="note small">not measured</span>'}</td><td>${esc(l.site)}</td><td>${esc(l.wh)}</td>
          ${td(n0(l.dcs))}${td(n0(l.days))}${td(n0(l.order))}${td(n0(l.none))}${td(n0(l.excl))}${td(n0(l.q))}${td(chgHtml(l.q, l.ref))}</tr>`).join('') || '<tr><td colspan="10" class="empty">No DCs in this period.</td></tr>'}</tbody>
        ${lines.length > 1 ? `<tfoot><tr class="total"><td>Total</td><td></td><td></td>${td(n0(C.dcs))}${td(n0(C.days))}${td(n0(C.order))}${td(n0(C.none))}${td(n0(C.excl))}${td(n0(C.qty))}${td(chgHtml(C.qty, R.qty))}</tr></tfoot>` : ''}
      </table></div>
      <p class="note small foot-note">Menswear and Junior DCs only (raw material, scrap and other divisions are not loaded). Month is taken from the DC date. "Without order no" = DCs with a blank order number, the stock-point efficiency measure. RBK and IN orders (Type Exclude in Masters → Order Seasons) are shown separately. WH head and "measured" come from Masters → Stock Points.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('sp', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
