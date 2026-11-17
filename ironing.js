// MIS Master System - Ironing report on the "MIS System" data (step C).
// Metrics agreed with Mari (MIS Report Metrics.xlsx), following the old MIS:
//   Target vs Actual %     = Ironing Qty ÷ ironing target
//   Average per day        = Ironing Qty ÷ working days (Working Days master)
//   Qty per table per day  = Ironing Qty ÷ tables used (table-days)
//   Average present        = people present ÷ working days (tables used, while "Present" is not filled)
//   Individual Eff. %      = (Qty ÷ tables used) ÷ (Target ÷ (tables on the floor × working days))
//                            tables on the floor come from the Machines / Tables master (Process = Ironing)
// Uses helpers from sewing.js (rowsOf, cmpTile, chgHtml, achHtml, pctTxt, unitMapper, shiftP, lastDay).

const IroningV2 = {
  sources: ['ms_ironing', 'ms_targets'],
  dims: { unit: 'Floor', date: 'Date' },
  filterKey: 'unit',
  compareModes: true,
  detailSources: [
    { report: 'ms_ironing', title: 'Ironing daily', map: { unit: '_unit', date: 'Date' }, consts: {}, view: r => ({ ...r, _unit: IroningV2.unitOf(r) }) },
  ],
  unitOf: r => r.Unit,

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const to = p.to;
    const [iron, tg, wd, units, mach] = await Promise.all([
      agg({ report: 'ms_ironing', from, to, by: ['date', 'Unit'], sum: ['Ironing Qty', 'Tables Used', 'Present'] }),
      agg({ report: 'ms_targets', from, to, by: ['month', 'Process', 'Unit'], sum: ['Target Qty'] }),
      agg({ report: 'ms_working_days', from, to, by: ['month'], sum: ['Working Days'] }),
      rowsOf('ms_units', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_machines', MASTER_MONTH, MASTER_MONTH),
    ]);
    const um = unitMapper(units, 'Ironing');
    this.unitOf = r => um(r.Unit, '', r.Date).unit;
    const days = iron.rows.map(([d, u, q, t, pr]) => ({ date: d, month: d && d.slice(0, 7), unit: um(u, '', d).unit, qty: q || 0, tables: t || 0, present: pr || 0 }));
    const targets = tg.rows.filter(r => /^ironing/i.test(r[1] || '')).map(([m, , u, q]) => ({ month: m, unit: um(u, '', m).unit, qty: q || 0 }));
    const wdays = Object.fromEntries(wd.rows.map(([m, n]) => [m, n]));
    const tables = mach.filter(r => /^ironing/i.test(r.Process || '')).map(r => ({ floor: stripUnit(r.Floor).toUpperCase(), n: Number(r.Machines) || 0, from: String(r['Active From'] || '1900-01-01') }));
    return { days, targets, wdays, tables, floorOf: um.floorOf, fy, sortUnits: um.sort };
  },

  units(data) { return data.sortUnits(new Set(data.days.filter(r => r.qty || r.tables).map(r => r.unit).filter(Boolean))); },

  // tables on a floor at the end of a month
  tablesOn(data, unit, month) {
    const fl = data.floorOf[unit] || stripUnit(unit).toUpperCase(), end = lastDay(month);
    const rows = data.tables.filter(t => t.floor === fl && t.from <= end).sort((a, b) => (a.from < b.from ? 1 : -1));
    return rows[0] ? rows[0].n : 0;
  },

  metrics(data, range, f) {
    const inR = m => m && m >= range.from && m <= range.to;
    const uOk = r => f.unit == null || r.unit === f.unit;
    const D = data.days.filter(r => inR(r.month) && uOk(r) && (f.date == null || r.date === f.date));
    const T = data.targets.filter(r => inR(r.month) && uOk(r));
    const qty = sum(D, r => r.qty), tables = sum(D, r => r.tables), presentIn = sum(D, r => r.present);
    const present = presentIn || tables;                       // "Present" not filled yet → tables used, as in the old MIS
    const months = monthSeq(range.from, range.to).filter(m => f.unit == null || D.some(r => r.month === m && (r.qty || r.tables)) || T.some(r => r.month === m));
    const wdOf = m => data.wdays[m] || new Set(data.days.filter(r => r.month === m && r.qty > 0).map(r => r.date)).size;
    const wd = f.date ? 1 : sum(months, wdOf);
    const target = f.date ? null : sum(T, r => r.qty);
    // installed table-days: tables on each floor × working days of each month (only floors with data that month)
    let tableDays = 0;
    if (!f.date) for (const m of months) {
      const us = new Set(data.days.filter(r => r.month === m && uOk(r) && (r.qty || r.tables)).map(r => r.unit));
      for (const u of us) tableDays += this.tablesOn(data, u, m) * wdOf(m);
    }
    const indTarget = target && tableDays ? target / tableDays : null, indActual = tables ? qty / tables : null;
    return {
      qty, tables, present, presentFromTables: !presentIn, wd, target: target || null, tableDays,
      ach: target ? qty / target : null,
      avgWD: wd ? qty / wd : null, tgtWD: target && wd ? target / wd : null,
      presentDay: wd ? present / wd : null, tablesDay: wd ? tables / wd : null,
      perTable: indActual, indTarget,
      eff: indTarget && indActual != null ? indActual / indTarget : null,
    };
  },

  draw(data, ctx) {
    const f = ctx.filters, p = ctx.period;
    const fyR = { from: data.fy.start > p.from ? p.from : data.fy.start, to: p.to };
    const mode = ctx.compareMode || 'prev';
    const refR = mode === 'ly' ? shiftP(p, -12) : ctx.compare;
    const C = this.metrics(data, p, f), R = this.metrics(data, refR, f), FY = this.metrics(data, fyR, { unit: f.unit });
    const refLabel = shortPeriod(refR), fyl = data.fy.label;
    const cmp = (cur, ref, tgt, lowerIsBetter) => {
      if (mode === 'target') return tgt ? [['Target', tgt[1] == null ? tgt[0] : `${tgt[0]} · ${achHtml(tgt[1])}`]] : [['Target', '<span class="note">no target</span>']];
      return [[`vs ${refLabel}`, chgHtml(cur, ref, lowerIsBetter)]];
    };
    const dayNote = f.date ? 'For the chosen day' : `${C.wd} working days`;

    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Ironing Qty', n0(C.qty), `${fyl} to date: ${n0(FY.qty)}`, cmp(C.qty, R.qty, C.target ? [n0(C.target), C.ach] : null)),
      cmpTile('Target Achieved', C.ach == null ? '–' : pctTxt(C.ach), C.target ? `${n0(C.qty)} of ${n0(C.target)}` : (f.date ? 'Targets are monthly' : 'No target set'),
        mode === 'target' ? [['Target', '100%']] : [[refLabel, pctTxt(R.ach)]]),
      cmpTile('Average Qty per Working Day', n0(C.avgWD), dayNote, cmp(C.avgWD, R.avgWD, C.tgtWD ? [n0(C.tgtWD) + ' / day', C.avgWD / C.tgtWD] : null)),
      cmpTile('Qty per Table per Day', n0(C.perTable), `${n0(C.tables)} table-days used`, cmp(C.perTable, R.perTable, C.indTarget && C.perTable != null ? [n0(C.indTarget), C.perTable / C.indTarget] : null)),
      cmpTile('Average Present', n0(C.presentDay), C.presentFromTables ? 'People per working day (tables used)' : 'People per working day', cmp(C.presentDay, R.presentDay, null)),
      cmpTile('Individual Efficiency', C.eff == null ? '–' : pctTxt(C.eff), C.indTarget ? `Target ${n0(C.indTarget)} pcs per table per day` : 'Qty per table used ÷ target per table on the floor', cmp(C.eff, R.eff, C.eff == null ? null : ['100%', C.eff])),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid gauge-row">${chartBox('cGauge') + chartBox('cAch')}</div>
      <div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid">${chartBox('cTable') + chartBox('cEff')}</div>`;

    // 1. Target vs actual gauge
    Charts.gauge($('cGauge'), { actual: C.qty, target: C.target }, { id: 'iron2-gauge', title: 'Target vs Actual', sub: periodLabel(p), actualLabel: 'Actual', fmt: n0 });

    // 2. Achieved by floor, 5. qty per table by floor, 6. individual efficiency by floor
    const unitsAll = data.sortUnits(new Set(data.days.filter(r => r.month >= p.from && r.month <= p.to && (r.qty || r.tables)).map(r => r.unit)));
    const ucolors = Charts.colorMap(unitsAll);
    const per = unitsAll.map(u => ({ u, m: this.metrics(data, p, { ...f, unit: u }) }));
    const bars = (host, id, title, sub, val, fmt, avg) => Charts.barsV($(host), per.map(({ u, m }) => ({ key: u, label: u, short: u, value: val(m) || 0, color: ucolors[u], hi: f.unit ? f.unit === u : false })),
      { id, title, sub, keyLabel: 'Floor', valueLabel: title, fmt, avg, onClick: d => setFilter('unit', d.key) });
    const pct = v => (v == null ? '–' : v.toFixed(1) + '%');
    bars('cAch', 'iron2-ach', 'Target Achieved by Floor', 'Ironing qty ÷ target · click a floor to filter', m => (m.ach == null ? 0 : m.ach * 100), pct, { value: 100, label: 'Target' });

    // 3. 12-month trend with target line
    const trendFrom = addMonths(p.to, -11);
    const tItems = monthSeq(trendFrom, p.to).map(m => { const x = this.metrics(data, { from: m, to: m }, { unit: f.unit }); return { key: m, label: fmtMonth(m), short: shortMonth(m), value: x.qty, line: x.target || null, hi: m >= p.from && m <= p.to }; });
    Charts.barsV($('cTrend'), tItems, { id: 'iron2-trend', title: 'Ironing Qty – last 12 months', sub: 'Line = target · click a month to view it', keyLabel: 'Month', valueLabel: 'Ironing Qty', lineLabel: 'Target', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 4. Daily qty with average line (click a day to filter)
    drawDaily($('cDaily'), 'iron2-daily', data.days.filter(r => r.month >= p.from && r.month <= p.to && (f.unit == null || r.unit === f.unit)).map(r => ({ date: r.date, v: r.qty })), 'v', 'Ironing Qty', ctx, f, true);

    bars('cTable', 'iron2-table', 'Qty per Table per Day by Floor', 'Ironing qty ÷ tables used', m => m.perTable, n0, null);
    bars('cEff', 'iron2-eff', 'Individual Efficiency by Floor', 'Qty per table used ÷ target per table on the floor', m => (m.eff == null ? 0 : m.eff * 100), pct, { value: 100, label: 'Target' });

    // Summary by floor + FY to date
    const td = v => `<td class="num">${v}</td>`;
    const effTd = e => td(e == null ? '–' : achHtml(e));
    const line = (name, c, l, sel) => `<tr class="${name !== 'Total' ? 'click' : 'total'} ${sel ? 'sel' : ''}" ${name !== 'Total' ? `data-k="${esc(name)}"` : ''}><td>${esc(name)}</td>
      ${td(c.target ? n0(c.target) : '–')}${td(n0(c.qty))}${td(achHtml(c.ach))}${mode === 'target' ? '' : td(chgHtml(c.qty, l.qty))}${td(n0(c.avgWD))}
      ${td(n0(c.presentDay))}${td(n0(c.perTable))}${td(c.indTarget ? n0(c.indTarget) : '–')}${effTd(c.eff)}</tr>`;
    const fyLine = (name, y) => { const diff = y.target ? y.qty - y.target : null; return `<tr class="${name === 'Total' ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(y.qty))}${td(y.target ? n0(y.target) : '–')}${td(achHtml(y.ach))}${td(diff == null ? '–' : `<span class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${n0(diff)}</span>`)}${td(n0(y.avgWD))}${td(n0(y.presentDay))}${td(n0(y.perTable))}${effTd(y.eff)}</tr>`; };
    const urows = unitsAll.map(u => ({ u, c: this.metrics(data, p, { ...f, unit: u }), l: this.metrics(data, refR, { ...f, unit: u }) }));
    const fyUnits = f.unit ? [f.unit] : data.sortUnits(new Set(data.days.filter(r => r.month >= fyR.from && r.month <= fyR.to && (r.qty || r.tables)).map(r => r.unit)));
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Floor – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Floor</th><th class="num">Target</th><th class="num">Ironing Qty</th><th class="num">Achieved</th>${mode === 'target' ? '' : `<th class="num">vs ${esc(refLabel)}</th>`}
          <th class="num">Avg / Working Day</th><th class="num">Avg Present</th><th class="num">Qty / Table / Day</th><th class="num">Target / Table / Day</th><th class="num">Individual Eff.</th></tr></thead>
        <tbody>${urows.map(x => line(x.u, x.c, x.l, f.unit === x.u)).join('') || `<tr><td colspan="${mode === 'target' ? 9 : 10}" class="empty">No data for this selection.</td></tr>`}</tbody>
        ${urows.length ? `<tfoot>${line('Total', this.metrics(data, p, { date: f.date }), this.metrics(data, refR, { date: f.date }))}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">${esc(fyl)} to date – ${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Floor</th><th class="num">Ironing Qty</th><th class="num">Target to date</th><th class="num">Achieved</th><th class="num">Difference</th><th class="num">Avg / Working Day</th><th class="num">Avg Present</th><th class="num">Qty / Table / Day</th><th class="num">Individual Eff.</th></tr></thead>
        <tbody>${fyUnits.map(u => fyLine(u, this.metrics(data, fyR, { unit: u }))).join('')}</tbody>
        <tfoot>${fyLine('Total', this.metrics(data, fyR, {}))}</tfoot>
      </table></div>
      <p class="note small foot-note">Individual efficiency = (ironing qty ÷ tables used) ÷ (target ÷ (tables on the floor × working days)); tables on the floor come from the Machines / Tables master. Average present = tables used per working day while the Present column is not filled. Floor names come from the Units master.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
