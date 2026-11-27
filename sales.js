// MIS Master System - Sales Analysis and Return Analysis (daily summaries in D1, View Details from the monthly Google Sheet).
// Quantity and value come from the invoice file. Brand / Section / Dept use the Item Groups master; season uses the order prefix.
const makeSalesReport = ({ table, dataset, word }) => {
  const isRet = dataset === 'Returns';
  const def = {
    sources: [table],
    dims: { brand: 'Brand', section: 'Section', dept: 'Dept', state: 'State', season: 'Season', site: 'Site', date: 'Date', ...(isRet ? { type: 'Return Type' } : {}) },
    filterKey: 'brand',
    compareModes: true,
    noTarget: true,
    detailSources: [{ report: table, title: `${word} lines`, fetch: async p => { const d = await fetchSheetDetail('sales', dataset, p); d.rows.forEach(salesRow); d.columns = d.columns.map(c => SALES_ALIAS[c] && !d.columns.includes(SALES_ALIAS[c]) ? SALES_ALIAS[c] : c); return d; },
      map: { brand: '_brand', section: '_section', dept: '_dept', state: '_state', season: '_season', site: 'SITE_NAME', date: '_date', type: 'INVOICE_TYPE', division: 'DIVISION' }, view: r => def.view(r) }],
    view: r => r,

    async load(p, c) {
      const fy = fyOf(p.to);
      const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
      const by = ['date', 'Site', 'Section', 'Dept', 'Brand', 'State', 'Order Prefix', ...(isRet ? ['Return Type'] : [])];
      const [res, M, st] = await Promise.all([agg({ report: table, from, to: p.to, by, sum: ['Qty', 'Value'] }), ORD.loadMasters(), api('/api/masters/rows?key=ms_states')]);
      const stateOf = Object.fromEntries(st.rows.map(s => [OKey(s['State Name in Data']), s.State]));
      const seasonName = pre => (!pre || pre === '(NONE)' || pre === '(none)' ? 'No order number' : ORD.seasonOf(pre + '/', M).name);
      const n = by.length;
      const rows = res.rows.map(r => {
        const g = ORD.groupOf(r[2], r[3], r[4], M);
        return { date: r[0], month: r[0].slice(0, 7), site: r[1], section: g.revSec, dept: g.revDept, brand: g.revBrand, state: r[5], season: seasonName(r[6]), type: isRet ? r[7] : '', qty: r[n] || 0, value: r[n + 1] || 0 };
      });
      def.view = r => { r = salesRow(r); const g = ORD.groupOf(r.SECTION, r.DEPARTMENT, r.BRAND, M); return { ...r, _brand: g.revBrand, _section: g.revSec, _dept: g.revDept, _state: stateOf[OKey(r.STATE)] || r.STATE, _season: seasonName(prefixOf(r.SO_NUM)), _date: String(r.INVOICE_DATE || '').slice(0, 10) }; };
      return { rows, fy };
    },
    units(data) { return [...new Set(data.rows.map(r => r.brand))].sort(); },
    metrics(data, range, f) {
      const R = data.rows.filter(r => r.month >= range.from && r.month <= range.to && ORD.pass(r, f));
      const qty = sum(R, r => r.qty), value = sum(R, r => r.value), days = new Set(R.filter(r => r.qty > 0).map(r => r.date)).size;
      return { qty, value, rate: qty ? value / qty : null, days, perDay: days ? value / days : null, states: new Set(R.map(r => r.state)).size };
    },
    draw(data, ctx) {
      const f = ctx.filters, p = ctx.period;
      const refR = ctx.compareMode === 'ly' ? shiftP(p, -12) : ctx.compare;
      const fyR = { from: data.fy.start > p.from ? p.from : data.fy.start, to: p.to };
      const C = def.metrics(data, p, f), R = def.metrics(data, refR, f), FY = def.metrics(data, fyR, { ...f, date: null });
      const refLabel = shortPeriod(refR), rs = v => '₹' + n0(v);
      const cmp = (a, b) => [[`vs ${refLabel}`, chgHtml(a, b, isRet)]];
      $('repTiles').classList.add('wide');
      $('repTiles').innerHTML = [
        cmpTile(`${word} Value`, rs(C.value), `${data.fy.label} to date: ${rs(FY.value)}`, cmp(C.value, R.value)),
        cmpTile(`${word} Qty`, n0(C.qty), `${data.fy.label} to date: ${n0(FY.qty)}`, cmp(C.qty, R.qty)),
        cmpTile('Average Rate', C.rate == null ? '–' : '₹' + n1(C.rate), 'Value ÷ qty', [[`vs ${refLabel}`, chgHtml(C.rate, R.rate)]]),
        cmpTile('Average per Day', rs(C.perDay), `${n0(C.days)} days with ${word.toLowerCase()}`, cmp(C.perDay, R.perDay)),
        cmpTile('States', n0(C.states), `States with ${word.toLowerCase()}`, []),
      ].join('');
      $('repCharts').innerHTML = `<div class="chart-grid">${chartBox('cTrend') + chartBox('cBrand')}</div>
        <div class="chart-grid">${chartBox('cSection') + chartBox('cState')}</div>
        <div class="chart-grid">${chartBox('cSeason') + chartBox(isRet ? 'cType' : 'cSite')}</div>
        <div class="chart-grid one">${chartBox('cDaily')}</div>`;
      const inP = r => r.month >= p.from && r.month <= p.to;
      const rowsFor = k => data.rows.filter(r => inP(r) && ORD.pass(r, f, k));
      const trendFrom = addMonths(p.to, -11), tf = { ...f, date: null };
      Charts.barsV($('cTrend'), monthSeq(trendFrom, p.to).map(m => ({ key: m, label: fmtMonth(m), short: shortMonth(m), value: def.metrics(data, { from: m, to: m }, tf).value, hi: m >= p.from && m <= p.to })),
        { id: `${table}-trend`, title: `${word} Value – last 12 months`, sub: 'Click a month to view it', keyLabel: 'Month', valueLabel: 'Value', fmt: rs, onClick: d => setPeriod({ from: d.key, to: d.key }) });
      const bc = dimColors(data.rows, 'brand', 'value');
      Charts.donut($('cBrand'), topN(groupSum(rowsFor('brand'), 'brand', 'value'), 6).map(x => ({ ...x, color: bc[x.other ? '__other' : x.key] })),
        { id: `${table}-brand`, title: `${word} by Brand`, keyLabel: 'Brand', valueLabel: 'Value', fmt: rs, centerLabel: 'Value', selected: f.brand ?? null, onClick: d => { if (!d.other) setFilter('brand', d.key); } });
      const bars = (id, key, title, label) => Charts.barsH($(id), topN(groupSum(rowsFor(key), key, 'value'), 10),
        { id: `${table}-${key}`, title, keyLabel: label, valueLabel: 'Value', fmt: rs, selected: f[key] ?? null, onClick: d => { if (!d.other) setFilter(key, d.key); } });
      bars('cSection', 'section', `${word} by Section`, 'Section');
      bars('cState', 'state', `${word} by State`, 'State');
      bars('cSeason', 'season', `${word} by Season`, 'Season');
      if (isRet) bars('cType', 'type', 'Returns by Type', 'Type'); else bars('cSite', 'site', 'Sales by Source Site', 'Site');
      drawDaily($('cDaily'), `${table}-daily`, rowsFor('date').map(r => ({ date: r.date, v: r.value })), 'v', `${word} Value`, ctx, f, true);

      const td = v => `<td class="num">${v}</td>`;
      const noBrand = { ...f }; delete noBrand.brand;
      const brands = f.brand ? [f.brand] : [...new Set(rowsFor('brand').map(r => r.brand))].sort();
      const line = (name, c, l, total) => `<tr class="${total ? 'total' : 'click'} ${f.brand === name ? 'sel' : ''}" ${total ? '' : `data-k="${esc(name)}"`}><td>${esc(name)}</td>${td(n0(c.qty))}${td(rs(c.value))}${td(chgHtml(c.value, l.value, isRet))}${td(c.rate == null ? '–' : '₹' + n1(c.rate))}${td(n0(c.days))}</tr>`;
      $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Brand – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
        <div class="tbl-wrap"><table><thead><tr><th>Brand</th><th class="num">Qty</th><th class="num">Value</th><th class="num">vs ${esc(refLabel)}</th><th class="num">Average Rate</th><th class="num">Days</th></tr></thead>
        <tbody>${brands.map(b => line(b, def.metrics(data, p, { ...noBrand, brand: b }), def.metrics(data, refR, { ...noBrand, brand: b }))).join('') || `<tr><td colspan="6" class="empty">No ${word.toLowerCase()} in this period.</td></tr>`}</tbody>
        ${brands.length > 1 ? `<tfoot>${line('Total', def.metrics(data, p, noBrand), def.metrics(data, refR, noBrand), true)}</tfoot>` : ''}</table></div>
        <p class="note small foot-note">Value is the invoice gross amount. Raw material lines are kept in View Details but not counted in this report. Brand, Section and Dept follow Masters → Item Groups. Season follows the order-number prefix. View Details reads the monthly Google Sheet, so it takes longer than the report.</p>`;
      $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('brand', tr.dataset.k));
      $('btnDetails').onclick = () => openDetails(0);
    },
  };
  return def;
};
const SalesReport = makeSalesReport({ table: 'sum_sales', dataset: 'Sales', word: 'Sales' });
const ReturnReport = makeSalesReport({ table: 'sum_returns', dataset: 'Returns', word: 'Returns' });
