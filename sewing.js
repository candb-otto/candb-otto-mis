// MIS Master System - Sewing report on the "MIS System" data (step C).
// Metrics agreed with Mari (MIS Report Metrics.xlsx):
//   Equivalent Qty  = Qty × Equ. Factor (item → category → factor of that FY; Trouser section → Trouser)
//   OT head count   = Tailors on OT × OT Hours ÷ working hours per day (Settings, 8)
//   Efficiency %    = Equivalent Qty ÷ (Tailors present + OT head count) ÷ base pcs (Settings, 20)
//   Avg per day     = Qty ÷ working days (M_WorkingDays)
//   Every card compares with: target, last month (previous period), same month last year, FY to date.

const MASTER_MONTH = '1900-01';
const SEW = { items: {} };   // item → {cat, brand}; shared with View Details

async function rowsOf(report, from, to) { return (await api(`/api/rows?${qs({ report, from, to })}`)).rows; }
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const shiftP = (p, k) => ({ from: addMonths(p.from, k), to: addMonths(p.to, k) });
const pctTxt = v => (v == null || !isFinite(v) ? '–' : (v * 100).toFixed(1) + '%');
const chg = (a, b) => (a == null || !b ? null : (a - b) / b);
const chgHtml = (a, b, lowerIsBetter) => {
  const c = chg(a, b);
  if (c == null) return '<span class="note">–</span>';
  const good = lowerIsBetter ? c <= 0 : c >= 0;
  return `<span class="${good ? 'good' : 'bad'}">${c >= 0 ? '▲ +' : '▼ '}${(c * 100).toFixed(1)}%</span>`;
};
const achHtml = a => (a == null ? '–' : `<span class="${a >= 1 ? 'good' : a >= 0.9 ? 'warn' : 'bad'}">${(a * 100).toFixed(1)}%</span>`);
// A card with a list of comparisons: lines = [[label, html], …]
function cmpTile(label, value, sub, lines) {
  return `<div class="tile"><div class="k">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}
    ${lines.length ? `<dl class="cmp">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}</div>`;
}

const SewingV2 = {
  sources: ['ms_sewing_lot', 'ms_sewing_daily', 'ms_sewing_ot', 'ms_targets'],
  dims: { unit: 'Unit', category: 'Category' },
  filterKey: 'unit',
  detailSources: [
    { report: 'ms_sewing_lot', title: 'Sewing lots', map: { unit: 'Unit', category: 'Category' },
      view: r => ({ ...r, Category: (SEW.items[String(r.Item || '').toUpperCase()] || {}).cat || '(none)' }) },
    { report: 'ms_sewing_daily', title: 'Daily tailors', map: { unit: 'Unit' }, consts: {} },
    { report: 'ms_sewing_ot', title: 'Overtime', map: { unit: 'Unit' }, consts: {} },
  ],

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const to = p.to;
    const [lotM, lotD, daily, ot, tg, wd, items, equ, mach, settings, units] = await Promise.all([
      agg({ report: 'ms_sewing_lot', from, to, by: ['month', 'Unit', 'Item', 'Section'], sum: ['Qty'] }),
      agg({ report: 'ms_sewing_lot', from: p.from, to: p.to, by: ['date', 'Unit', 'Item', 'Section'], sum: ['Qty'] }),
      agg({ report: 'ms_sewing_daily', from, to, by: ['date', 'Unit'], sum: ['Tailor Strength', 'Tailor Present', 'Machines Used'] }),
      rowsOf('ms_sewing_ot', from, to),
      agg({ report: 'ms_targets', from, to, by: ['month', 'Process', 'Unit'], sum: ['Target Qty', 'Target Present / Day'] }),
      agg({ report: 'ms_working_days', from, to, by: ['month'], sum: ['Working Days'] }),
      rowsOf('ms_items', MASTER_MONTH, MASTER_MONTH), rowsOf('ms_equ_factor', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_machines', MASTER_MONTH, MASTER_MONTH), rowsOf('ms_settings', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_units', MASTER_MONTH, MASTER_MONTH),
    ]);
    const setting = (re, dflt) => { const s = settings.find(r => re.test(String(r.Setting || ''))); return s && Number(s.Value) > 0 ? Number(s.Value) : dflt; };
    const base = setting(/base/i, 20), hours = setting(/hour/i, 8);

    // item → category; equivalent factor per FY + category (missing year → nearest earlier year)
    SEW.items = Object.fromEntries(items.map(r => [String(r.Item || '').toUpperCase(), { cat: r.Category || '', brand: r.Brand || '' }]));
    const fac = {};
    for (const r of equ) {
      if (!r.FY || !r.Category) continue;
      const f = Number(r['Equ. Factor']) > 0 ? Number(r['Equ. Factor']) : (Number(r['Target Pcs / Tailor / Day']) > 0 ? Math.round(base / Number(r['Target Pcs / Tailor / Day']) * 100) / 100 : null);
      if (f) fac[`${r.FY}|${String(r.Category).toLowerCase()}`] = f;
    }
    const fyList = [...new Set(equ.map(r => r.FY).filter(Boolean))].sort();
    const factorCache = {};
    const factor = (month, cat) => {
      const key = `${month}|${cat}`;
      if (key in factorCache) return factorCache[key];
      const fyl = fyOf(month).label;
      let f = fac[`${fyl}|${cat}`];
      if (f == null) { const earlier = fyList.filter(x => x <= fyl).reverse(); for (const x of earlier) if (fac[`${x}|${cat}`] != null) { f = fac[`${x}|${cat}`]; break; } }
      if (f == null) { for (const x of fyList) if (fac[`${x}|${cat}`] != null) { f = fac[`${x}|${cat}`]; break; } }
      return (factorCache[key] = f == null ? 1 : f);
    };
    const catOf = (item, section) => (section === 'Trouser' ? 'Trouser' : (SEW.items[String(item || '').toUpperCase()] || {}).cat || '(none)');
    const lotRow = (period, unit, item, section, qty) => {
      const cat = catOf(item, section);
      return { unit, cat, qty: qty || 0, eq: (qty || 0) * factor(period.slice(0, 7), cat.toLowerCase()) };
    };
    const lots = lotM.rows.map(([m, u, it, sec, q]) => ({ month: m, ...lotRow(m, u, it, sec, q) }));
    const lotDays = lotD.rows.map(([d, u, it, sec, q]) => ({ date: d, month: d && d.slice(0, 7), ...lotRow(d || p.from, u, it, sec, q) }));
    const days = daily.rows.map(([d, u, st, pr, used]) => ({ date: d, month: d && d.slice(0, 7), unit: u, strength: st || 0, present: pr || 0, used: used || 0 }));
    const ots = ot.map(r => ({ date: r.Date, month: String(r.Date || '').slice(0, 7), unit: r.Unit, hc: (Number(r['OT Hours']) || 0) * (Number(r['Tailors on OT']) || 0) / hours }));
    const targets = tg.rows.filter(r => /^sewing/i.test(r[1] || '')).map(([m, proc, u, q, pres]) => ({ month: m, eqTarget: /equiv/i.test(proc), unit: u, qty: q || 0, present: pres || 0 }));
    const wdays = Object.fromEntries(wd.rows.map(([m, n]) => [m, n]));
    const unitFloor = {};
    units.filter(r => /sewing/i.test(r.Process || '')).forEach(r => { unitFloor[r.Unit] = String(r.Floor || '').trim().toUpperCase(); });
    const machines = mach.map(r => ({ floor: String(r.Floor || '').replace(/^floor\s*/i, '').trim().toUpperCase(), n: Number(r.Machines) || 0, from: String(r['Active From'] || '1900-01-01'), cap: Number(r['Capacity per Year']) || 0 }));
    return { lots, lotDays, days, ots, targets, wdays, unitFloor, machines, base, hours, fy, from };
  },

  units(data) { return [...new Set(data.lots.map(r => r.unit).concat(data.days.map(r => r.unit)).filter(Boolean))].sort(); },

  // All figures for one period and the current filters
  metrics(data, range, f) {
    const inR = m => m && m >= range.from && m <= range.to;
    const uOk = r => f.unit == null || r.unit === f.unit;
    const cOk = r => f.category == null || r.cat === f.category;
    const L = data.lots.filter(r => inR(r.month) && uOk(r) && cOk(r));
    const D = data.days.filter(r => inR(r.month) && uOk(r));
    const O = data.ots.filter(r => inR(r.month) && uOk(r));
    const T = data.targets.filter(r => inR(r.month) && uOk(r));
    const qty = sum(L, r => r.qty), eq = sum(L, r => r.eq);
    const present = sum(D, r => r.present), strength = sum(D, r => r.strength), used = sum(D, r => r.used);
    const presDays = new Set(D.filter(r => r.present > 0).map(r => r.date)).size;
    const hc = sum(O, r => r.hc), otDays = new Set(O.map(r => r.date)).size;
    const months = monthSeq(range.from, range.to);
    const wd = sum(months, m => data.wdays[m] || new Set(data.days.filter(r => r.month === m && r.present > 0).map(r => r.date)).size);
    const target = sum(T.filter(r => !r.eqTarget), r => r.qty), eqTarget = sum(T.filter(r => r.eqTarget), r => r.qty);
    // machines in place on the last day of the period (per floor, latest "Active From")
    const end = lastDay(range.to);
    const floors = f.unit ? [data.unitFloor[f.unit] || unitKey(f.unit).replace(/^unit\s*/i, '').replace(/\d+$/, '')] : [...new Set(data.machines.map(m => m.floor))];
    let mc = 0, cap = 0;
    for (const fl of floors) {
      const rows = data.machines.filter(m => m.floor === fl && m.from <= end).sort((a, b) => (a.from < b.from ? 1 : -1));
      if (rows[0]) { mc += rows[0].n; cap += rows[0].cap; }
    }
    const machineDays = used > 0 ? used : mc * wd;
    const split = f.category == null;          // tailor, OT and target figures are not split by category
    return {
      qty, eq, target: split ? target : null, eqTarget: split && eqTarget ? eqTarget : null, wd, present, strength, used, presDays, hc, otDays, mc, cap,
      ach: split && target ? qty / target : null,
      avgWD: wd ? qty / wd : null, tgtWD: split && target && wd ? target / wd : null,
      // tailors per day over WORKING days (as in the old MIS: Oct 2026 = 24,636 ÷ 25 = 985)
      presentDay: split && (wd || presDays) ? present / (wd || presDays) : null, presentPct: split && strength ? present / strength : null,
      ppt: split && present ? qty / present : null,
      otDay: split && otDays ? hc / otDays : null,
      eff: split && present + hc ? eq / (present + hc) / data.base : null,
      eqPerMachine: machineDays ? eq / machineDays : null, idle: used > 0 ? mc * presDays - used : null,
      capUtil: cap ? qty / (cap * months.length / 12) : null,
    };
  },

  draw(data, ctx) {
    const f = ctx.filters, p = ctx.period;
    const fyR = { from: data.fy.start > p.from ? p.from : data.fy.start, to: p.to };
    const lyR = shiftP(p, -12);
    const C = this.metrics(data, p, f), LM = this.metrics(data, ctx.compare, f), LY = this.metrics(data, lyR, f), FY = this.metrics(data, fyR, f);
    const lm = shortPeriod(ctx.compare), ly = shortPeriod(lyR), fyl = data.fy.label;
    const na = 'Not split by category';

    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Sewing Qty', n0(C.qty), '', [
        ['Target', C.target ? `${n0(C.target)} · ${achHtml(C.ach)}` : '–'],
        [`vs ${lm}`, chgHtml(C.qty, LM.qty)], [`vs ${ly}`, chgHtml(C.qty, LY.qty)],
        [`${fyl} to date`, `${n0(FY.qty)}${FY.target ? ' · ' + achHtml(FY.ach) : ''}`]]),
      cmpTile('Equivalent Qty', n0(C.eq), `Base ${data.base} pcs per tailor per day`, [
        ['Target', C.eqTarget ? `${n0(C.eqTarget)} · ${achHtml(C.eq / C.eqTarget)}` : '<span class="note">not set</span>'],
        [`vs ${lm}`, chgHtml(C.eq, LM.eq)], [`vs ${ly}`, chgHtml(C.eq, LY.eq)], [`${fyl} to date`, n0(FY.eq)]]),
      cmpTile('Target Achieved', C.ach == null ? '–' : pctTxt(C.ach), C.target ? `${n0(C.qty)} of ${n0(C.target)}` : (f.category ? na : 'No target set'), [
        [`${lm}`, pctTxt(LM.ach)], [`${fyl} to date`, achHtml(FY.ach)]]),
      cmpTile('Average per Working Day', n0(C.avgWD), `${C.wd} working days`, [
        ['Target per day', n0(C.tgtWD)], [`vs ${lm}`, chgHtml(C.avgWD, LM.avgWD)]]),
      cmpTile('Efficiency', C.eff == null ? '–' : pctTxt(C.eff), f.category ? na : 'Equivalent qty per tailor-day (incl. OT) ÷ ' + data.base, [
        ['Target', '100%'], [`vs ${lm}`, chgHtml(C.eff, LM.eff)], [`${fyl} to date`, pctTxt(FY.eff)]]),
      cmpTile('Tailors Present / Day', n0(C.presentDay), f.category ? na : `Present ${pctTxt(C.presentPct)} · Absent ${C.presentPct == null ? '–' : pctTxt(1 - C.presentPct)}`, [
        [`vs ${lm}`, chgHtml(C.presentDay, LM.presentDay)], [`${fyl} to date`, `${n0(FY.presentDay)} · ${pctTxt(FY.presentPct)}`]]),
      cmpTile('Pieces per Tailor / Day', n1(C.ppt), f.category ? na : 'Qty ÷ tailors present', [
        [`vs ${lm}`, chgHtml(C.ppt, LM.ppt)], [`vs ${ly}`, chgHtml(C.ppt, LY.ppt)]]),
      cmpTile('OT Head Count / Day', n1(C.otDay), f.category ? na : `${n0(C.hc)} head count on ${C.otDays} OT days`, [
        [`vs ${lm}`, chgHtml(C.otDay, LM.otDay, true)]]),
      cmpTile('Equ. Pcs per Machine / Day', n1(C.eqPerMachine), `${n0(C.mc)} machines${C.used ? ` · idle ${n0(C.idle)} machine-days` : ' (machines used not entered yet)'}`, [
        ['Target', String(data.base)], [`vs ${lm}`, chgHtml(C.eqPerMachine, LM.eqPerMachine)],
        ['Capacity used', pctTxt(C.capUtil)], [`${fyl} to date`, n1(FY.eqPerMachine)]]),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid gauge-row">${chartBox('cGauge') + chartBox('cEff')}</div>
      <div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid three">${chartBox('cAtt') + chartBox('cCat') + chartBox('cOT')}</div>`;

    // 1. Target vs actual gauge
    Charts.gauge($('cGauge'), { actual: C.qty, target: C.target }, { id: 'sew2-gauge', title: 'Target vs Actual', sub: periodLabel(p), actualLabel: 'Actual', fmt: n0 });

    // 2. Efficiency by unit (target 100%)
    const unitsAll = [...new Set(data.lots.map(r => r.unit).filter(Boolean))].sort();
    const ucolors = Charts.colorMap(unitsAll);
    const effItems = unitsAll.filter(u => this.metrics(data, p, { unit: u }).qty > 0).map(u => { const m = this.metrics(data, p, { ...f, unit: u }); return { key: u, label: u, short: u.replace(/^Unit /, ''), value: m.eff == null ? 0 : m.eff * 100, color: ucolors[u], hi: f.unit ? f.unit === u : false }; });
    Charts.barsV($('cEff'), effItems, { id: 'sew2-eff', title: 'Efficiency by Unit', sub: 'Equivalent qty per tailor-day (incl. OT) ÷ ' + data.base + ' · click a unit to filter',
      keyLabel: 'Unit', valueLabel: 'Efficiency %', fmt: v => (v == null ? '–' : v.toFixed(1) + '%'), avg: { value: 100, label: 'Target' },
      onClick: d => setFilter('unit', d.key) });

    // 3. 12-month trend with target line
    const trendFrom = addMonths(p.to, -11);
    const tItems = monthSeq(trendFrom, p.to).map(m => { const x = this.metrics(data, { from: m, to: m }, f); return { key: m, label: fmtMonth(m), short: shortMonth(m), value: x.qty, line: x.target || null, hi: m >= p.from && m <= p.to }; });
    Charts.barsV($('cTrend'), tItems, { id: 'sew2-trend', title: 'Sewing Qty – last 12 months', sub: 'Line = target · click a month to view it', keyLabel: 'Month', valueLabel: 'Sewing Qty', lineLabel: 'Target', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 4. Daily output with average line
    drawDaily($('cDaily'), 'sew2-daily', data.lotDays.filter(r => (f.unit == null || r.unit === f.unit) && (f.category == null || r.cat === f.category)).map(r => ({ date: r.date, v: r.qty })), 'v', 'Sewing Qty', ctx, {}, false);

    // 5. Attendance by unit (present / absent per working day)
    if (f.category) $('cAtt').innerHTML = '<h2 class="chart-title">Attendance by Unit</h2><p class="empty">Attendance is not split by category.</p>';
    else drawAttendance($('cAtt'), 'sew2-att', data.days.filter(r => r.month >= p.from && r.month <= p.to), 'unit', 'Unit', 'present', 'strength', f, 'unit');

    // 6. Category mix (doughnut)
    const catRows = data.lots.filter(r => r.month >= p.from && r.month <= p.to && (f.unit == null || r.unit === f.unit));
    const ccolors = dimColors(data.lots, 'cat', 'qty');
    const cItems = topN(groupSum(catRows, 'cat', 'qty'), 6).map(x => ({ ...x, color: ccolors[x.other ? '__other' : x.key] }));
    Charts.donut($('cCat'), cItems, { id: 'sew2-cat', title: 'Sewing Qty by Category', keyLabel: 'Category', valueLabel: 'Sewing Qty', fmt: n0, centerLabel: 'Sewing Qty',
      selected: f.category ?? null, onClick: d => { if (!d.other) setFilter('category', d.key); } });

    // 7. OT head count per day by unit
    const otItems = unitsAll.filter(u => this.metrics(data, p, { unit: u }).hc > 0).map(u => { const m = this.metrics(data, p, { unit: u }); return { key: u, label: u, value: m.otDay || 0, color: ucolors[u] }; });
    Charts.barsH($('cOT'), otItems, { id: 'sew2-ot', title: 'OT Head Count per Day', keyLabel: 'Unit', valueLabel: 'OT head count / day', fmt: n1, valueText: d => n1(d.value),
      selected: f.unit ?? null, onClick: d => setFilter('unit', d.key) });

    // Summary by unit + FY to date
    const urows = unitsAll.map(u => ({ u, c: this.metrics(data, p, { ...f, unit: u }), l: this.metrics(data, ctx.compare, { ...f, unit: u }), y: this.metrics(data, fyR, { ...f, unit: u }) }))
      .filter(x => x.c.qty || x.c.present || x.c.target);
    const td = v => `<td class="num">${v}</td>`;
    const line = (name, c, l, sel) => `<tr class="${name !== 'Total' ? 'click' : 'total'} ${sel ? 'sel' : ''}" ${name !== 'Total' ? `data-k="${esc(name)}"` : ''}><td>${esc(name)}</td>
      ${td(n0(c.qty))}${td(n0(c.eq))}${td(c.target ? n0(c.target) : '–')}${td(achHtml(c.ach))}${td(chgHtml(c.qty, l.qty))}${td(n0(c.avgWD))}
      ${td(n0(c.presentDay))}${td(pctTxt(c.presentPct))}${td(n1(c.ppt))}${td(n1(c.otDay))}${td(c.eff == null ? '–' : achHtml(c.eff))}</tr>`;
    const fyLine = (name, y) => { const diff = y.target ? y.qty - y.target : null; return `<tr class="${name === 'Total' ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(y.qty))}${td(y.target ? n0(y.target) : '–')}${td(achHtml(y.ach))}${td(diff == null ? '–' : `<span class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${n0(diff)}</span>`)}${td(n0(y.eq))}${td(pctTxt(y.eff))}</tr>`; };
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Unit – ${esc(periodLabel(p))}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Sewing Qty</th><th class="num">Equ. Qty</th><th class="num">Target</th><th class="num">Achieved</th><th class="num">vs ${esc(lm)}</th>
          <th class="num">Avg / Working Day</th><th class="num">Tailors / Day</th><th class="num">Present %</th><th class="num">Pcs / Tailor</th><th class="num">OT HC / Day</th><th class="num">Efficiency</th></tr></thead>
        <tbody>${urows.map(x => line(x.u, x.c, x.l, f.unit === x.u)).join('') || '<tr><td colspan="12" class="empty">No data for this selection.</td></tr>'}</tbody>
        ${urows.length ? `<tfoot>${line('Total', this.metrics(data, p, { category: f.category }), this.metrics(data, ctx.compare, { category: f.category }))}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">${esc(fyl)} to date – ${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Sewing Qty</th><th class="num">Target to date</th><th class="num">Achieved</th><th class="num">Difference</th><th class="num">Equ. Qty</th><th class="num">Efficiency</th></tr></thead>
        <tbody>${urows.map(x => fyLine(x.u, x.y)).join('')}</tbody>
        <tfoot>${fyLine('Total', FY)}</tfoot>
      </table></div>
      <p class="note small foot-note">Efficiency = equivalent qty ÷ (tailors present + OT head count) ÷ ${data.base}. OT head count = tailors × OT hours ÷ ${data.hours}. Average per working day uses the working days of each month. Machines in place on the last day of the period; capacity from the machines list.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
