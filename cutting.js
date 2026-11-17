// MIS Master System - Cutting report on the "MIS System" data (step C).
// Metrics agreed with Mari (MIS Report Metrics.xlsx):
//   Target vs Actual %   = Cut Qty ÷ cutting target
//   Average per day      = Cut Qty ÷ working days (Working Days master)
//   Present %            = Present ÷ Strength
//   Pieces per person    = Cut Qty ÷ people present (person-days)
//   Individual Eff. %    = (Cut Qty ÷ total present) ÷ (Target Qty ÷ total strength)
//   Fabric In vs Cut     = Fabric In compared with Cut Qty
// Uses helpers from sewing.js (rowsOf, cmpTile, chgHtml, achHtml, pctTxt, unitMapper, shiftP).

const CuttingV2 = {
  sources: ['ms_cutting', 'ms_targets'],
  dims: { unit: 'Unit', date: 'Date' },
  filterKey: 'unit',
  compareModes: true,
  detailSources: [
    { report: 'ms_cutting', title: 'Cutting daily', map: { unit: '_unit', date: 'Date' }, consts: {}, view: r => ({ ...r, _unit: CuttingV2.unitOf(r) }) },
  ],
  unitOf: r => r.Unit,

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const to = p.to;
    const [cut, tg, wd, units] = await Promise.all([
      agg({ report: 'ms_cutting', from, to, by: ['date', 'Unit'], sum: ['Cut Qty', 'Strength', 'Present', 'Fabric In', 'Inward Qty'] }),
      agg({ report: 'ms_targets', from, to, by: ['month', 'Process', 'Unit'], sum: ['Target Qty'] }),
      agg({ report: 'ms_working_days', from, to, by: ['month'], sum: ['Working Days'] }),
      rowsOf('ms_units', MASTER_MONTH, MASTER_MONTH),
    ]);
    const um = unitMapper(units, 'Cutting');
    this.unitOf = r => um(r.Unit, '', r.Date).unit;
    const days = cut.rows.map(([d, u, q, st, pr, fab, inw]) => ({ date: d, month: d && d.slice(0, 7), unit: um(u, '', d).unit,
      qty: q || 0, strength: st || 0, present: pr || 0, fabric: fab || 0, inward: inw || 0 }));
    const targets = tg.rows.filter(r => /^cutting/i.test(r[1] || '')).map(([m, , u, q]) => ({ month: m, unit: um(u, '', m).unit, qty: q || 0 }));
    const wdays = Object.fromEntries(wd.rows.map(([m, n]) => [m, n]));
    return { days, targets, wdays, fy, sortUnits: um.sort };
  },

  units(data) { return data.sortUnits(new Set(data.days.filter(r => r.qty || r.present).map(r => r.unit).filter(Boolean))); },

  metrics(data, range, f) {
    const inR = m => m && m >= range.from && m <= range.to;
    const uOk = r => f.unit == null || r.unit === f.unit;
    const D = data.days.filter(r => inR(r.month) && uOk(r) && (f.date == null || r.date === f.date));
    const T = data.targets.filter(r => inR(r.month) && uOk(r));
    const qty = sum(D, r => r.qty), present = sum(D, r => r.present), strength = sum(D, r => r.strength);
    const fabric = sum(D, r => r.fabric), inward = sum(D, r => r.inward);
    const workDays = new Set(D.filter(r => r.qty > 0 || r.present > 0).map(r => r.date)).size;
    // for one unit, only the months it has data
    const months = monthSeq(range.from, range.to).filter(m => f.unit == null || D.some(r => r.month === m && (r.qty || r.present)) || T.some(r => r.month === m));
    const wd = f.date ? 1 : sum(months, m => data.wdays[m] || new Set(data.days.filter(r => r.month === m && r.qty > 0).map(r => r.date)).size);
    const target = f.date ? null : sum(T, r => r.qty);
    const indTarget = target && strength ? target / strength : null, indActual = present ? qty / present : null;
    return {
      qty, present, strength, fabric, inward, wd, workDays, target: target || null,
      ach: target ? qty / target : null,
      avgWD: wd ? qty / wd : null, tgtWD: target && wd ? target / wd : null,
      strengthDay: wd ? strength / wd : null, presentDay: wd ? present / wd : null,
      presentPct: strength ? present / strength : null,
      ppd: indActual, indTarget,
      eff: indTarget && indActual != null ? indActual / indTarget : null,
      cutVsFabric: fabric ? qty / fabric : null,
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
      cmpTile('Cut Qty', n0(C.qty), `${fyl} to date: ${n0(FY.qty)}`, cmp(C.qty, R.qty, C.target ? [n0(C.target), C.ach] : null)),
      cmpTile('Target Achieved', C.ach == null ? '–' : pctTxt(C.ach), C.target ? `${n0(C.qty)} of ${n0(C.target)}` : (f.date ? 'Targets are monthly' : 'No target set'),
        mode === 'target' ? [['Target', '100%']] : [[refLabel, pctTxt(R.ach)]]),
      cmpTile('Average Cut per Working Day', n0(C.avgWD), dayNote, cmp(C.avgWD, R.avgWD, C.tgtWD ? [n0(C.tgtWD) + ' / day', C.avgWD / C.tgtWD] : null)),
      cmpTile('Individual Efficiency', C.eff == null ? '–' : pctTxt(C.eff), 'Pcs per person present ÷ target pcs per person on roll', cmp(C.eff, R.eff, C.eff == null ? null : ['100%', C.eff])),
      cmpTile('Pieces per Person / Day', n1(C.ppd), C.indTarget ? `Target ${n1(C.indTarget)} per person on roll` : 'Cut Qty ÷ people present', cmp(C.ppd, R.ppd, C.indTarget && C.ppd != null ? [n1(C.indTarget), C.ppd / C.indTarget] : null)),
      cmpTile('Present %', pctTxt(C.presentPct), `${n0(C.presentDay)} present of ${n0(C.strengthDay)} on roll per day · Absent ${C.presentPct == null ? '–' : pctTxt(1 - C.presentPct)}`, cmp(C.presentPct, R.presentPct, null)),
      cmpTile('Fabric In vs Cut', n0(C.fabric), C.fabric ? `Fabric in · cut ${n0(C.qty)} = ${pctTxt(C.cutVsFabric)} of fabric in` : 'No fabric in recorded', cmp(C.fabric, R.fabric, null)),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid gauge-row">${chartBox('cGauge') + chartBox('cAch')}</div>
      <div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid">${chartBox('cAtt') + chartBox('cEff')}</div>`;

    // 1. Target vs actual gauge
    Charts.gauge($('cGauge'), { actual: C.qty, target: C.target }, { id: 'cut2-gauge', title: 'Target vs Actual', sub: periodLabel(p), actualLabel: 'Actual', fmt: n0 });

    // 2. Target achieved by unit, and 6. individual efficiency by unit (100% line)
    const unitsAll = data.sortUnits(new Set(data.days.filter(r => r.month >= p.from && r.month <= p.to && (r.qty || r.present)).map(r => r.unit)));
    const ucolors = Charts.colorMap(unitsAll);
    const per = unitsAll.map(u => ({ u, m: this.metrics(data, p, { ...f, unit: u }) }));
    const pctBars = (host, id, title, sub, key) => Charts.barsV($(host), per.map(({ u, m }) => ({ key: u, label: u, short: u, value: m[key] == null ? 0 : m[key] * 100, color: ucolors[u], hi: f.unit ? f.unit === u : false })),
      { id, title, sub, keyLabel: 'Unit', valueLabel: title, fmt: v => (v == null ? '–' : v.toFixed(1) + '%'), avg: { value: 100, label: 'Target' }, onClick: d => setFilter('unit', d.key) });
    pctBars('cAch', 'cut2-ach', 'Target Achieved by Unit', 'Cut qty ÷ target · click a unit to filter', 'ach');

    // 3. 12-month trend with target line
    const trendFrom = addMonths(p.to, -11);
    const tItems = monthSeq(trendFrom, p.to).map(m => { const x = this.metrics(data, { from: m, to: m }, { unit: f.unit }); return { key: m, label: fmtMonth(m), short: shortMonth(m), value: x.qty, line: x.target || null, hi: m >= p.from && m <= p.to }; });
    Charts.barsV($('cTrend'), tItems, { id: 'cut2-trend', title: 'Cut Qty – last 12 months', sub: 'Line = target · click a month to view it', keyLabel: 'Month', valueLabel: 'Cut Qty', lineLabel: 'Target', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 4. Daily cut with average line (click a day to filter)
    drawDaily($('cDaily'), 'cut2-daily', data.days.filter(r => r.month >= p.from && r.month <= p.to && (f.unit == null || r.unit === f.unit)).map(r => ({ date: r.date, v: r.qty })), 'v', 'Cut Qty', ctx, f, true);

    // 5. Attendance by unit
    drawAttendance($('cAtt'), 'cut2-att', data.days.filter(r => r.month >= p.from && r.month <= p.to && (f.date == null || r.date === f.date)), 'unit', 'Unit', 'present', 'strength', f, 'unit');
    pctBars('cEff', 'cut2-eff', 'Individual Efficiency by Unit', 'Pcs per person present ÷ target pcs per person on roll', 'eff');

    // Summary by unit + FY to date
    const td = v => `<td class="num">${v}</td>`;
    const effTd = e => td(e == null ? '–' : achHtml(e));
    const line = (name, c, l, sel) => `<tr class="${name !== 'Total' ? 'click' : 'total'} ${sel ? 'sel' : ''}" ${name !== 'Total' ? `data-k="${esc(name)}"` : ''}><td>${esc(name)}</td>
      ${td(c.target ? n0(c.target) : '–')}${td(n0(c.qty))}${td(achHtml(c.ach))}${mode === 'target' ? '' : td(chgHtml(c.qty, l.qty))}${td(n0(c.avgWD))}
      ${td(n0(c.strengthDay))}${td(n0(c.presentDay))}${td(pctTxt(c.presentPct))}${td(n1(c.ppd))}${effTd(c.eff)}${td(n0(c.fabric))}</tr>`;
    const fyLine = (name, y) => { const diff = y.target ? y.qty - y.target : null; return `<tr class="${name === 'Total' ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(y.qty))}${td(y.target ? n0(y.target) : '–')}${td(achHtml(y.ach))}${td(diff == null ? '–' : `<span class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${n0(diff)}</span>`)}${td(n0(y.avgWD))}${td(n0(y.presentDay))}${td(pctTxt(y.presentPct))}${effTd(y.eff)}</tr>`; };
    const urows = unitsAll.map(u => ({ u, c: this.metrics(data, p, { ...f, unit: u }), l: this.metrics(data, refR, { ...f, unit: u }) }));
    const fyUnits = f.unit ? [f.unit] : data.sortUnits(new Set(data.days.filter(r => r.month >= fyR.from && r.month <= fyR.to && (r.qty || r.present)).map(r => r.unit)));
    const fyNoUnit = { ...f }; delete fyNoUnit.date;
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Unit – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Target</th><th class="num">Cut Qty</th><th class="num">Achieved</th>${mode === 'target' ? '' : `<th class="num">vs ${esc(refLabel)}</th>`}
          <th class="num">Avg / Working Day</th><th class="num">Strength / Day</th><th class="num">Present / Day</th><th class="num">Present %</th><th class="num">Pcs / Person</th><th class="num">Individual Eff.</th><th class="num">Fabric In</th></tr></thead>
        <tbody>${urows.map(x => line(x.u, x.c, x.l, f.unit === x.u)).join('') || `<tr><td colspan="${mode === 'target' ? 11 : 12}" class="empty">No data for this selection.</td></tr>`}</tbody>
        ${urows.length ? `<tfoot>${line('Total', this.metrics(data, p, { date: f.date }), this.metrics(data, refR, { date: f.date }))}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">${esc(fyl)} to date – ${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Cut Qty</th><th class="num">Target to date</th><th class="num">Achieved</th><th class="num">Difference</th><th class="num">Avg / Working Day</th><th class="num">Avg Present / Day</th><th class="num">Present %</th><th class="num">Individual Eff.</th></tr></thead>
        <tbody>${fyUnits.map(u => fyLine(u, this.metrics(data, fyR, { ...fyNoUnit, unit: u }))).join('')}</tbody>
        <tfoot>${fyLine('Total', this.metrics(data, fyR, {}))}</tfoot>
      </table></div>
      <p class="note small foot-note">Individual efficiency = (cut qty ÷ total present) ÷ (target qty ÷ total strength). Average per working day and people per day use the working days of each month (Masters page). Unit names come from the Units master.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
