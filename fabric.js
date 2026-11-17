// MIS Master System - Fabric Issue report on the "MIS System" data (step C).
// Metrics agreed with Mari (MIS Report Metrics.xlsx). All quantities are pieces.
//   Target vs Actual %        = Fabric issued ÷ fabric target (target is set for the whole factory: Unit "All")
//   Average per working day   = issued ÷ working days (1st metric, as in the old MIS)
//   Average per issue day     = issued ÷ days with an issue (2nd metric)
//   Issue by unit / brand / category / item; no Shirt-vs-Trouser chart (Mari: not needed)
// Uses helpers from sewing.js (rowsOf, cmpTile, chgHtml, achHtml, pctTxt, unitMapper, shiftP).

const FabricV2 = {
  sources: ['ms_fabric', 'ms_targets'],
  dims: { unit: 'Unit', brand: 'Brand', category: 'Category', item: 'Item', date: 'Date' },
  filterKey: 'unit',
  compareModes: true,
  detailSources: [
    { report: 'ms_fabric', title: 'Fabric issues', map: { unit: '_unit', item: 'Item', date: 'Date', brand: '_brand', category: '_cat' }, consts: {},
      view: r => { const it = FabricV2.itemOf(r.Item); return { ...r, _unit: FabricV2.unitOf(r), _brand: it.brand, _cat: it.cat }; } },
  ],
  unitOf: r => r['Cutting Unit'],
  itemOf: () => ({ brand: '(none)', cat: '(none)' }),

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const to = p.to;
    const [fab, tg, wd, units, items] = await Promise.all([
      agg({ report: 'ms_fabric', from, to, by: ['date', 'Cutting Unit', 'Item'], sum: ['Qty Issued'] }),
      agg({ report: 'ms_targets', from, to, by: ['month', 'Process', 'Unit'], sum: ['Target Qty'] }),
      agg({ report: 'ms_working_days', from, to, by: ['month'], sum: ['Working Days'] }),
      rowsOf('ms_units', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_items', MASTER_MONTH, MASTER_MONTH),
    ]);
    const um = unitMapper(units, 'Cutting');
    const itemMap = Object.fromEntries(items.map(r => [String(r.Item || '').toUpperCase(), { brand: r.Brand || '(none)', cat: r.Category || '(none)' }]));
    this.itemOf = it => itemMap[String(it || '').toUpperCase()] || { brand: '(none)', cat: '(none)' };
    this.unitOf = r => um(r['Cutting Unit'], '', r.Date).unit;
    const rows = fab.rows.map(([d, u, it, q]) => { const i = this.itemOf(it); return { date: d, month: d && d.slice(0, 7), unit: um(u, '', d).unit, item: it || '(none)', brand: i.brand, category: i.cat, qty: q || 0 }; });
    // "All" = factory target; a target given for a unit is used when that unit is chosen
    const targets = tg.rows.filter(r => /^fabric/i.test(r[1] || '')).map(([m, , u, q]) => ({ month: m, unit: /^all$/i.test(String(u || '').trim()) ? 'All' : um(u, '', m).unit, qty: q || 0 }));
    const wdays = Object.fromEntries(wd.rows.map(([m, n]) => [m, n]));
    return { rows, targets, wdays, fy, sortUnits: um.sort };
  },

  units(data) { return data.sortUnits(new Set(data.rows.filter(r => r.qty).map(r => r.unit).filter(Boolean))); },

  metrics(data, range, f) {
    const inR = m => m && m >= range.from && m <= range.to;
    const ok = r => (f.unit == null || r.unit === f.unit) && (f.brand == null || r.brand === f.brand) && (f.category == null || r.category === f.category)
      && (f.item == null || r.item === f.item) && (f.date == null || r.date === f.date);
    const L = data.rows.filter(r => inR(r.month) && ok(r));
    const qty = sum(L, r => r.qty);
    const issueDays = new Set(L.filter(r => r.qty > 0).map(r => r.date)).size;
    const months = monthSeq(range.from, range.to).filter(m => f.unit == null || L.some(r => r.month === m));
    const wd = f.date ? 1 : sum(months, m => data.wdays[m] || new Set(data.rows.filter(r => r.month === m && r.qty > 0).map(r => r.date)).size);
    // target only for the whole factory, or for a unit that has its own target; not for brand / category / item / day
    const split = f.brand == null && f.category == null && f.item == null && f.date == null;
    const T = data.targets.filter(r => inR(r.month) && (f.unit == null ? r.unit === 'All' || !data.targets.some(t => t.month === r.month && t.unit === 'All') : r.unit === f.unit));
    const target = split ? sum(T, r => r.qty) : 0;
    return {
      qty, issueDays, wd, target: target || null,
      ach: target ? qty / target : null,
      avgWD: wd ? qty / wd : null, tgtWD: target && wd ? target / wd : null,
      avgIssue: issueDays ? qty / issueDays : null,
      unitCount: new Set(L.filter(r => r.qty).map(r => r.unit)).size, itemCount: new Set(L.filter(r => r.qty).map(r => r.item)).size,
    };
  },

  draw(data, ctx) {
    const f = ctx.filters, p = ctx.period;
    const fyR = { from: data.fy.start > p.from ? p.from : data.fy.start, to: p.to };
    const mode = ctx.compareMode || 'prev';
    const refR = mode === 'ly' ? shiftP(p, -12) : ctx.compare;
    const C = this.metrics(data, p, f), R = this.metrics(data, refR, f), FY = this.metrics(data, fyR, { ...f, date: null });
    const refLabel = shortPeriod(refR), fyl = data.fy.label;
    const cmp = (cur, ref, tgt) => {
      if (mode === 'target') return tgt ? [['Target', tgt[1] == null ? tgt[0] : `${tgt[0]} · ${achHtml(tgt[1])}`]] : [['Target', '<span class="note">no target</span>']];
      return [[`vs ${refLabel}`, chgHtml(cur, ref)]];
    };
    const noTgt = f.date ? 'Targets are monthly' : (f.brand || f.category || f.item) ? 'Target is not split by item' : f.unit ? 'Target is for the whole factory' : 'No target set';

    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Fabric Issued', n0(C.qty), `Pieces · ${fyl} to date: ${n0(FY.qty)}`, cmp(C.qty, R.qty, C.target ? [n0(C.target), C.ach] : null)),
      cmpTile('Target Achieved', C.ach == null ? '–' : pctTxt(C.ach), C.target ? `${n0(C.qty)} of ${n0(C.target)}` : noTgt,
        mode === 'target' ? [['Target', '100%']] : [[refLabel, pctTxt(R.ach)]]),
      cmpTile('Average Issue per Working Day', n0(C.avgWD), f.date ? 'For the chosen day' : `${C.wd} working days`, cmp(C.avgWD, R.avgWD, C.tgtWD ? [n0(C.tgtWD) + ' / day', C.avgWD / C.tgtWD] : null)),
      cmpTile('Average Issue per Issue Day', n0(C.avgIssue), `${C.issueDays} days with an issue`, cmp(C.avgIssue, R.avgIssue, null)),
      cmpTile('Units Issued To', n0(C.unitCount), 'Cutting units that received fabric', mode === 'target' ? [] : [[`${refLabel}`, n0(R.unitCount)]]),
      cmpTile('Items Issued', n0(C.itemCount), 'Different items in the period', mode === 'target' ? [] : [[`${refLabel}`, n0(R.itemCount)]]),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid gauge-row">${chartBox('cGauge') + chartBox('cUnit')}</div>
      <div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid">${chartBox('cBrand') + chartBox('cCat')}</div>
      <div class="chart-grid one">${chartBox('cItem')}</div>`;

    // 1. Target vs actual gauge
    Charts.gauge($('cGauge'), { actual: C.qty, target: C.target }, { id: 'fab2-gauge', title: 'Target vs Actual', sub: periodLabel(p), actualLabel: 'Issued', fmt: n0 });

    const inP = r => r.month >= p.from && r.month <= p.to;
    const except = k => r => Object.entries(f).every(([d, v]) => v == null || d === k || r[d] === v);
    // 2. Issue by unit
    const uRows = data.rows.filter(r => inP(r) && except('unit')(r));
    const unitsAll = data.sortUnits(new Set(uRows.filter(r => r.qty).map(r => r.unit)));
    const ucolors = Charts.colorMap(unitsAll);
    Charts.barsV($('cUnit'), unitsAll.map(u => ({ key: u, label: u, short: u, value: sum(uRows.filter(r => r.unit === u), r => r.qty), color: ucolors[u], hi: f.unit ? f.unit === u : false })),
      { id: 'fab2-unit', title: 'Fabric Issued by Unit', sub: 'Click a unit to filter', keyLabel: 'Unit', valueLabel: 'Fabric Issued', fmt: n0, onClick: d => setFilter('unit', d.key) });

    // 3. 12-month trend with target line
    const trendFrom = addMonths(p.to, -11);
    const tf = { ...f, date: null };
    const tItems = monthSeq(trendFrom, p.to).map(m => { const x = this.metrics(data, { from: m, to: m }, tf); return { key: m, label: fmtMonth(m), short: shortMonth(m), value: x.qty, line: x.target || null, hi: m >= p.from && m <= p.to }; });
    Charts.barsV($('cTrend'), tItems, { id: 'fab2-trend', title: 'Fabric Issued – last 12 months', sub: 'Line = target · click a month to view it', keyLabel: 'Month', valueLabel: 'Fabric Issued', lineLabel: 'Target', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 4. Daily issue with average line (click a day to filter)
    drawDaily($('cDaily'), 'fab2-daily', data.rows.filter(r => inP(r) && except('date')(r)).map(r => ({ date: r.date, v: r.qty })), 'v', 'Fabric Issued', ctx, f, true);

    // 5-7. Brand, category (doughnuts) and top items (bars)
    const dimChart = (host, id, title, dim, n, kind) => {
      const colors = dimColors(data.rows, dim, 'qty');
      const rows = data.rows.filter(r => inP(r) && except(dim)(r));
      const items = topN(groupSum(rows, dim, 'qty'), n).map(x => ({ ...x, color: colors[x.other ? '__other' : x.key] }));
      const total = sum(items, d => d.value);
      const o = { id, title, keyLabel: this.dims[dim], valueLabel: 'Fabric Issued', fmt: n0, selected: f[dim] ?? null, centerLabel: 'Issued',
        tip: d => tipHtml(d.label, [['Fabric Issued', n0(d.value)], ['Share', total ? (d.value / total * 100).toFixed(1) + '%' : '–']]),
        onClick: d => { if (!d.other) setFilter(dim, d.key); } };
      if (kind === 'donut') Charts.donut($(host), items, o); else Charts.barsH($(host), items, o);
    };
    dimChart('cBrand', 'fab2-brand', 'Fabric Issued by Brand', 'brand', 6, 'donut');
    dimChart('cCat', 'fab2-cat', 'Fabric Issued by Category', 'category', 6, 'donut');
    dimChart('cItem', 'fab2-item', 'Top Items', 'item', 15, 'bars');

    // Summary by unit (target on the total row: it is set for the whole factory) + FY to date
    const td = v => `<td class="num">${v}</td>`;
    const uf = { ...f }; delete uf.unit;
    const tot = this.metrics(data, p, uf), totL = this.metrics(data, refR, uf);
    const line = (name, c, l, sel, total) => `<tr class="${total ? 'total' : 'click'} ${sel ? 'sel' : ''}" ${total ? '' : `data-k="${esc(name)}"`}><td>${esc(name)}</td>
      ${td(n0(c.qty))}${td(tot.qty ? pctTxt(c.qty / tot.qty) : '–')}${td(c.target ? n0(c.target) : '–')}${td(achHtml(c.ach))}${mode === 'target' ? '' : td(chgHtml(c.qty, l.qty))}
      ${td(n0(c.avgWD))}${td(n0(c.issueDays))}${td(n0(c.avgIssue))}</tr>`;
    const fyf = { ...uf, date: null };
    const fyTot = this.metrics(data, fyR, fyf);
    const fyLine = (name, y, total) => { const diff = y.target ? y.qty - y.target : null; return `<tr class="${total ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(y.qty))}${td(fyTot.qty ? pctTxt(y.qty / fyTot.qty) : '–')}${td(y.target ? n0(y.target) : '–')}${td(achHtml(y.ach))}${td(diff == null ? '–' : `<span class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${n0(diff)}</span>`)}${td(n0(y.avgWD))}</tr>`; };
    const shown = f.unit ? [f.unit] : unitsAll;
    const urows = shown.map(u => ({ u, c: this.metrics(data, p, { ...f, unit: u }), l: this.metrics(data, refR, { ...f, unit: u }) }));
    const fyUnits = f.unit ? [f.unit] : data.sortUnits(new Set(data.rows.filter(r => r.month >= fyR.from && r.month <= fyR.to && r.qty && except('unit')({ ...r, date: f.date })).map(r => r.unit)));
    const ncol = mode === 'target' ? 8 : 9;
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Unit – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Fabric Issued</th><th class="num">Share</th><th class="num">Target</th><th class="num">Achieved</th>${mode === 'target' ? '' : `<th class="num">vs ${esc(refLabel)}</th>`}
          <th class="num">Avg / Working Day</th><th class="num">Issue Days</th><th class="num">Avg / Issue Day</th></tr></thead>
        <tbody>${urows.map(x => line(x.u, x.c, x.l, f.unit === x.u)).join('') || `<tr><td colspan="${ncol}" class="empty">No data for this selection.</td></tr>`}</tbody>
        ${urows.length ? `<tfoot>${line('Total', tot, totL, false, true)}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">${esc(fyl)} to date – ${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Fabric Issued</th><th class="num">Share</th><th class="num">Target to date</th><th class="num">Achieved</th><th class="num">Difference</th><th class="num">Avg / Working Day</th></tr></thead>
        <tbody>${fyUnits.map(u => fyLine(u, this.metrics(data, fyR, { ...fyf, unit: u }))).join('')}</tbody>
        <tfoot>${fyLine('Total', fyTot, true)}</tfoot>
      </table></div>
      <p class="note small foot-note">All quantities are pieces. The fabric target is set for the whole factory, so it shows on the Total row. Average per working day uses the working days of each month (Masters page); average per issue day uses the days that had an issue. Brand and category come from the Items master; unit names from the Units master.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
