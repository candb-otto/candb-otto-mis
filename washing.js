// MIS Master System - Washing report on the "MIS System" data (step C).
// Metrics agreed with Mari (MIS Report Metrics.xlsx), following the old MIS:
//   Sent / Received          = Sent Qty / Received Qty (month by Sent Date)
//   Pending                  = lots with no Received Date yet (as of today)
//   Shortage / Excess        = Received Qty − Sent Qty (received lots)
//   Average cycle time       = days from Sent Date to Received Date per lot; same day counts as 1 day (old MIS)
//   Washing amount           = Sent Qty × Rate per Pc (Jobbers master)
//   Debit amount             = sum of Debit Amt
// No target for washing: "Compare with" offers the previous period and the same period last year.
// Uses helpers from sewing.js (rowsOf, cmpTile, chgHtml, pctTxt, unitMapper, shiftP).

const WASH_CMP = { prev: 'Previous period', ly: 'Same period last year' };
const n2 = v => (v == null || isNaN(v) ? '–' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

const WashingV2 = {
  sources: ['ms_washing'],
  dims: { jobber: 'Jobber', unit: 'Floor', date: 'Sent Date' },
  filterKey: 'jobber',
  compareModes: true,
  noTarget: true,
  detailSources: [
    { report: 'ms_washing', title: 'Washing lots', map: { jobber: 'Jobber', unit: '_unit', date: 'Sent Date' }, consts: {}, view: r => ({ ...r, _unit: WashingV2.unitOf(r) }) },
  ],
  unitOf: r => r.Unit,

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const [rows, units, jobbers] = await Promise.all([
      rowsOf('ms_washing', from, p.to),
      rowsOf('ms_units', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_jobbers', MASTER_MONTH, MASTER_MONTH),
    ]);
    const um = unitMapper(units, 'Washing');
    this.unitOf = r => um(r.Unit, '', r['Sent Date']).unit;
    const rate = Object.fromEntries(jobbers.filter(j => !j.Process || /wash/i.test(j.Process)).map(j => [String(j.Jobber || '').toUpperCase(), Number(j['Rate per Pc']) || 0]));
    const lots = rows.filter(r => r['Sent Date']).map(r => {
      const sent = String(r['Sent Date']).slice(0, 10), rec = r['Received Date'] ? String(r['Received Date']).slice(0, 10) : null;
      const jobber = String(r.Jobber || '(none)').trim(), sq = Number(r['Sent Qty']) || 0, rq = Number(r['Received Qty']) || 0;
      return { date: sent, month: sent.slice(0, 7), jobber, unit: um(r.Unit, '', sent).unit, dc: r['DC No'] || '', lot: r['Lot No'] || '',
        sent: sq, received: rec ? rq : 0, done: !!rec, days: rec ? Math.max(1, dayDiff(sent, rec)) : null,
        short: rec ? rq - sq : 0, rate: rate[jobber.toUpperCase()] || 0, amount: sq * (rate[jobber.toUpperCase()] || 0), debit: Number(r['Debit Amt']) || 0 };
    });
    return { lots, fy, sortUnits: um.sort, loadedFrom: from, rates: rate };
  },

  units(data) { return [...new Set(data.lots.map(r => r.jobber))].sort(); },

  metrics(data, range, f) {
    const inR = m => m && m >= range.from && m <= range.to;
    const ok = r => (f.jobber == null || r.jobber === f.jobber) && (f.unit == null || r.unit === f.unit) && (f.date == null || r.date === f.date);
    const L = data.lots.filter(r => inR(r.month) && ok(r));
    const done = L.filter(r => r.done);
    const sent = sum(L, r => r.sent), received = sum(done, r => r.received);
    return {
      sent, received, lots: L.length, doneLots: done.length,
      short: sum(done, r => r.short), sentDone: sum(done, r => r.sent),
      cycle: done.length ? sum(done, r => r.days) / done.length : null,
      amount: sum(L, r => r.amount), debit: sum(L, r => r.debit),
      noRate: [...new Set(L.filter(r => !r.rate).map(r => r.jobber))],
      pendLots: L.length - done.length, pendPcs: sum(L.filter(r => !r.done), r => r.sent),
    };
  },

  draw(data, ctx) {
    const f = ctx.filters, p = ctx.period;
    const fyR = { from: data.fy.start > p.from ? p.from : data.fy.start, to: p.to };
    const mode = ctx.compareMode === 'ly' ? 'ly' : 'prev';
    const refR = mode === 'ly' ? shiftP(p, -12) : ctx.compare;
    const C = this.metrics(data, p, f), R = this.metrics(data, refR, f), FY = this.metrics(data, fyR, { ...f, date: null });
    const refLabel = shortPeriod(refR), fyl = data.fy.label;
    const cmp = (cur, ref, lowerIsBetter) => [[`vs ${refLabel}`, chgHtml(cur, ref, lowerIsBetter)]];
    const rs = v => '₹' + n0(v);
    // pending as of today: every loaded lot without a received date (whatever the period), with the current jobber / floor filters
    const pend = data.lots.filter(r => !r.done && (f.jobber == null || r.jobber === f.jobber) && (f.unit == null || r.unit === f.unit));
    const today = new Date().toISOString().slice(0, 10);
    const shortHtml = v => (v === 0 ? '0' : `<span class="${v < 0 ? 'bad' : 'warn'}">${v > 0 ? '+' : ''}${n0(v)}</span>`);

    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Sent to Washing', n0(C.sent), `${n0(C.lots)} lots · ${fyl} to date: ${n0(FY.sent)}`, cmp(C.sent, R.sent)),
      cmpTile('Received', n0(C.received), `${n0(C.doneLots)} of ${n0(C.lots)} lots back`, cmp(C.received, R.received)),
      cmpTile('Pending Today', n0(sum(pend, r => r.sent)), pend.length ? `${pend.length} lots not back · oldest ${Math.max(...pend.map(r => dayDiff(r.date, today)))} days` : 'Every lot is back', []),
      cmpTile('Shortage / Excess', shortHtml(C.short), C.sentDone ? `${pctTxt(Math.abs(C.short) / C.sentDone)} of received lots` : 'Received − sent, received lots', cmp(Math.abs(C.short), Math.abs(R.short), true)),
      cmpTile('Average Cycle Time', C.cycle == null ? '–' : n2(C.cycle) + ' days', 'Sent to received, per lot (same day = 1 day)', cmp(C.cycle, R.cycle, true)),
      cmpTile('Washing Amount', rs(C.amount), C.noRate.length ? `No rate for ${C.noRate.join(', ')}` : 'Sent qty × rate per piece', cmp(C.amount, R.amount, true)),
      cmpTile('Debit Amount', rs(C.debit), 'Debit raised on jobbers', cmp(C.debit, R.debit)),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid">${chartBox('cTrend') + chartBox('cJob')}</div>
      <div class="chart-grid">${chartBox('cCycle') + chartBox('cFloor')}</div>
      <div class="chart-grid">${chartBox('cDaily') + chartBox('cPend')}</div>`;

    const inP = r => r.month >= p.from && r.month <= p.to;
    const except = k => r => Object.entries(f).every(([d, v]) => v == null || d === k || r[d] === v);

    // 1. 12-month trend of sent qty
    const trendFrom = addMonths(p.to, -11), tf = { ...f, date: null };
    Charts.barsV($('cTrend'), monthSeq(trendFrom, p.to).map(m => ({ key: m, label: fmtMonth(m), short: shortMonth(m), value: this.metrics(data, { from: m, to: m }, tf).sent, hi: m >= p.from && m <= p.to })),
      { id: 'wash2-trend', title: 'Sent to Washing – last 12 months', sub: 'Click a month to view it', keyLabel: 'Month', valueLabel: 'Sent Qty', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 2. Sent by jobber (doughnut)
    const jRows = data.lots.filter(r => inP(r) && except('jobber')(r));
    const jcolors = dimColors(data.lots, 'jobber', 'sent');
    Charts.donut($('cJob'), topN(groupSum(jRows, 'jobber', 'sent'), 6).map(x => ({ ...x, color: jcolors[x.other ? '__other' : x.key] })),
      { id: 'wash2-job', title: 'Sent by Jobber', keyLabel: 'Jobber', valueLabel: 'Sent Qty', fmt: n0, centerLabel: 'Sent', selected: f.jobber ?? null, onClick: d => { if (!d.other) setFilter('jobber', d.key); } });

    // 3. Cycle time by jobber
    const jobs = [...new Set(jRows.map(r => r.jobber))].sort();
    Charts.barsH($('cCycle'), jobs.map(j => { const m = this.metrics(data, p, { ...f, jobber: j }); return { key: j, label: j, value: m.cycle || 0, color: jcolors[j] }; }),
      { id: 'wash2-cycle', title: 'Average Cycle Time by Jobber', keyLabel: 'Jobber', valueLabel: 'Days', fmt: n2, selected: f.jobber ?? null, onClick: d => setFilter('jobber', d.key) });

    // 4. Sent by floor
    const fRows = data.lots.filter(r => inP(r) && except('unit')(r));
    const fcolors = dimColors(data.lots, 'unit', 'sent');
    Charts.barsH($('cFloor'), topN(groupSum(fRows, 'unit', 'sent'), 10).map(x => ({ ...x, color: fcolors[x.other ? '__other' : x.key] })),
      { id: 'wash2-floor', title: 'Sent by Floor', keyLabel: 'Floor', valueLabel: 'Sent Qty', fmt: n0, selected: f.unit ?? null, onClick: d => { if (!d.other) setFilter('unit', d.key); } });

    // 5. Daily sent
    drawDaily($('cDaily'), 'wash2-daily', data.lots.filter(r => inP(r) && except('date')(r)).map(r => ({ date: r.date, v: r.sent })), 'v', 'Sent Qty', ctx, f, true);

    // 6. Pending today by jobber
    if (!pend.length) $('cPend').innerHTML = '<h2 class="chart-title">Pending Lots by Jobber</h2><p class="empty">Every lot sent has come back.</p>';
    else Charts.barsH($('cPend'), groupSum(pend, 'jobber', 'sent').map(x => ({ ...x, color: jcolors[x.key] })),
      { id: 'wash2-pend', title: 'Pending Lots by Jobber', keyLabel: 'Jobber', valueLabel: 'Pending Pcs', fmt: n0, onClick: d => setFilter('jobber', d.key) });

    // Summary by jobber + FY to date + pending list
    const td = v => `<td class="num">${v}</td>`;
    const line = (name, c, l, sel, total) => `<tr class="${total ? 'total' : 'click'} ${sel ? 'sel' : ''}" ${total ? '' : `data-k="${esc(name)}"`}><td>${esc(name)}</td>
      ${td(n0(c.sent))}${td(chgHtml(c.sent, l.sent))}${td(n0(c.received))}${td(shortHtml(c.short))}${td(n0(c.lots))}${td(c.pendLots ? n0(c.pendLots) : '0')}
      ${td(c.cycle == null ? '–' : n2(c.cycle))}${td(total ? '' : (data.rates[name.toUpperCase()] ? '₹' + data.rates[name.toUpperCase()] : '<span class="note">no rate</span>'))}${td(rs(c.amount))}${td(rs(c.debit))}</tr>`;
    const uf = { ...f }; delete uf.jobber;
    const jrows = (f.jobber ? [f.jobber] : jobs).map(j => ({ j, c: this.metrics(data, p, { ...f, jobber: j }), l: this.metrics(data, refR, { ...f, jobber: j }) }));
    const fyJobs = f.jobber ? [f.jobber] : [...new Set(data.lots.filter(r => r.month >= fyR.from && r.month <= fyR.to && except('jobber')({ ...r, date: f.date })).map(r => r.jobber))].sort();
    const fyLine = (name, y, total) => `<tr class="${total ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(y.sent))}${td(n0(y.received))}${td(shortHtml(y.short))}${td(n0(y.lots))}${td(y.cycle == null ? '–' : n2(y.cycle))}${td(rs(y.amount))}${td(rs(y.debit))}</tr>`;
    const fyf = { ...uf, date: null };
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Jobber – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Jobber</th><th class="num">Sent</th><th class="num">vs ${esc(refLabel)}</th><th class="num">Received</th><th class="num">Shortage / Excess</th><th class="num">Lots</th><th class="num">Pending Lots</th>
          <th class="num">Cycle Days</th><th class="num">Rate / Pc</th><th class="num">Amount</th><th class="num">Debit</th></tr></thead>
        <tbody>${jrows.map(x => line(x.j, x.c, x.l, f.jobber === x.j)).join('') || '<tr><td colspan="11" class="empty">No data for this selection.</td></tr>'}</tbody>
        ${jrows.length ? `<tfoot>${line('Total', this.metrics(data, p, uf), this.metrics(data, refR, uf), false, true)}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">${esc(fyl)} to date – ${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Jobber</th><th class="num">Sent</th><th class="num">Received</th><th class="num">Shortage / Excess</th><th class="num">Lots</th><th class="num">Cycle Days</th><th class="num">Amount</th><th class="num">Debit</th></tr></thead>
        <tbody>${fyJobs.map(j => fyLine(j, this.metrics(data, fyR, { ...fyf, jobber: j }))).join('')}</tbody>
        <tfoot>${fyLine('Total', this.metrics(data, fyR, fyf), true)}</tfoot>
      </table></div>
      <div class="sec-title">Pending lots today <small>Sent from ${esc(fmtMonth(data.loadedFrom))}, not yet received</small></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Sent Date</th><th>DC No</th><th>Lot No</th><th>Floor</th><th>Jobber</th><th class="num">Sent Qty</th><th class="num">Days Out</th></tr></thead>
        <tbody>${pend.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 50).map(r => `<tr><td>${esc(fmtDay(r.date))} ${esc(r.date.slice(0, 4))}</td><td>${esc(r.dc)}</td><td>${esc(r.lot)}</td><td>${esc(r.unit)}</td><td>${esc(r.jobber)}</td>${td(n0(r.sent))}${td(n0(dayDiff(r.date, today)))}</tr>`).join('') || '<tr><td colspan="7" class="empty">Every lot sent has come back.</td></tr>'}</tbody>
      </table></div>
      <p class="note small foot-note">Month is taken from the sent date. Cycle time = days from sent to received for each lot (a lot back the same day counts as 1 day). Amount = sent qty × rate per piece from the Jobbers master. There is no washing target, so the comparison is with the previous period or the same period last year.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('jobber', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
