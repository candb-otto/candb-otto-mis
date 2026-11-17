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

// Units master: data unit (+ sub unit) on a date → report unit, its roll-up group and floor.
// A row applies from "Effective From" to "Effective To"; when several apply, the latest "Effective From" wins.
// Units with "Roll-up To" are added into that unit for every figure (tailors and targets are not entered for them),
// and shown under it with their own output only.
const stripUnit = s => String(s || '').replace(/^(unit|floor)\s*/i, '').trim();
function unitMapper(master, process) {
  const norm = s => String(s || '').trim().toLowerCase();
  const rows = master.filter(r => norm(r.Process) === norm(process) && r.Active !== 'No').map((r, i) => ({
    du: norm(r['Data Unit']), su: norm(r['Sub Unit']), ru: String(r['Report Unit'] || '').trim(), roll: String(r['Roll-up To'] || '').trim(),
    floor: String(r.Floor || '').replace(/^floor\s*/i, '').trim().toUpperCase(), from: r['Effective From'] || '', to: r['Effective To'] || '9999-12-31', i }));
  const order = [];
  rows.forEach(r => { for (const u of [r.roll || r.ru, r.ru]) if (u && !order.includes(u)) order.push(u); });
  const floorOf = {};
  rows.forEach(r => { if (r.floor) { floorOf[r.ru] = floorOf[r.ru] || r.floor; if (r.roll) floorOf[r.roll] = floorOf[r.roll] || r.floor; } });
  const cache = {};
  const pick = (du, su, d) => rows.filter(r => r.du === du && r.su === su && r.from <= d && d <= r.to).sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : a.i - b.i))[0];
  const map = (unit, sub, date) => {
    const d = String(date || '').length === 7 ? date + '-01' : String(date || '9999-12-31').slice(0, 10);
    const key = `${unit}|${sub || ''}|${d}`;
    if (key in cache) return cache[key];
    const du = norm(unit), su = norm(sub);
    const hit = (su && (pick(du, su, d) || pick(su, '', d))) || pick(du, '', d);
    const ru = hit ? hit.ru : stripUnit(sub || unit) || '(none)';
    return (cache[key] = { unit: hit && hit.roll ? hit.roll : ru, sub: ru });
  };
  map.order = order; map.floorOf = floorOf;
  map.sort = list => [...list].sort((a, b) => { const x = order.indexOf(a), y = order.indexOf(b); return (x < 0) - (y < 0) || x - y || String(a).localeCompare(String(b)); });
  return map;
}

const SewingV2 = {
  sources: ['ms_sewing_lot', 'ms_sewing_daily', 'ms_sewing_ot', 'ms_targets'],
  dims: { unit: 'Unit', category: 'Category' },
  filterKey: 'unit',
  compareModes: true,
  detailSources: [
    { report: 'ms_sewing_lot', title: 'Sewing lots', map: { unit: '_unit', category: 'Category' },
      view: r => ({ ...r, _unit: SEW.unitOf(r), Category: (SEW.items[String(r.Item || '').toUpperCase()] || {}).cat || '(none)' }) },
    { report: 'ms_sewing_daily', title: 'Daily tailors', map: { unit: '_unit' }, consts: {}, view: r => ({ ...r, _unit: SEW.unitOf(r) }) },
    { report: 'ms_sewing_ot', title: 'Overtime', map: { unit: '_unit' }, consts: {}, view: r => ({ ...r, _unit: SEW.unitOf(r) }) },
  ],

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const to = p.to;
    const [lotM, lotD, daily, ot, tg, wd, items, equ, mach, settings, units] = await Promise.all([
      agg({ report: 'ms_sewing_lot', from, to, by: ['month', 'Unit', 'Sub Unit', 'Item', 'Section'], sum: ['Qty'] }),
      agg({ report: 'ms_sewing_lot', from: p.from, to: p.to, by: ['date', 'Unit', 'Sub Unit', 'Item', 'Section'], sum: ['Qty'] }),
      agg({ report: 'ms_sewing_daily', from, to, by: ['date', 'Unit', 'Sub Unit'], sum: ['Tailor Strength', 'Tailor Present', 'Machines Used'] }),
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
    const um = unitMapper(units, 'Sewing');
    SEW.unitOf = r => um(r.Unit, r['Sub Unit'], r.Date).unit;
    const lotRow = (period, unit, sub, item, section, qty) => {
      const cat = catOf(item, section);
      return { ...um(unit, sub, period), cat, qty: qty || 0, eq: (qty || 0) * factor(period.slice(0, 7), cat.toLowerCase()) };
    };
    const lots = lotM.rows.map(([m, u, su, it, sec, q]) => ({ month: m, ...lotRow(m, u, su, it, sec, q) }));
    const lotDays = lotD.rows.map(([d, u, su, it, sec, q]) => ({ date: d, month: d && d.slice(0, 7), ...lotRow(d || p.from, u, su, it, sec, q) }));
    const days = daily.rows.map(([d, u, su, st, pr, used]) => ({ date: d, month: d && d.slice(0, 7), unit: um(u, su, d).unit, strength: st || 0, present: pr || 0, used: used || 0 }));
    const ots = ot.map(r => ({ date: r.Date, month: String(r.Date || '').slice(0, 7), unit: um(r.Unit, r['Sub Unit'], r.Date).unit, hc: (Number(r['OT Hours']) || 0) * (Number(r['Tailors on OT']) || 0) / hours }));
    const targets = tg.rows.filter(r => /^sewing/i.test(r[1] || '')).map(([m, proc, u, q, pres]) => ({ month: m, eqTarget: /equiv/i.test(proc), unit: um(u, '', m).unit, qty: q || 0, present: pres || 0 }));
    const wdays = Object.fromEntries(wd.rows.map(([m, n]) => [m, n]));
    const unitFloor = um.floorOf;
    const machines = mach.map(r => ({ floor: String(r.Floor || '').replace(/^floor\s*/i, '').trim().toUpperCase(), n: Number(r.Machines) || 0, from: String(r['Active From'] || '1900-01-01'), cap: Number(r['Capacity per Year']) || 0 }));
    return { lots, lotDays, days, ots, targets, wdays, unitFloor, machines, base, hours, fy, from, sortUnits: um.sort };
  },

  units(data) { return data.sortUnits(new Set(data.lots.map(r => r.unit).concat(data.days.map(r => r.unit)).filter(Boolean))); },

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
    // for one unit, only the months it has data (a unit can start or stop inside the period, e.g. C before / after the split)
    const months = monthSeq(range.from, range.to).filter(m => f.unit == null || L.some(r => r.month === m) || D.some(r => r.month === m) || T.some(r => r.month === m));
    const wd = sum(months, m => data.wdays[m] || new Set(data.days.filter(r => r.month === m && r.present > 0).map(r => r.date)).size);
    const target = sum(T.filter(r => !r.eqTarget), r => r.qty), eqTarget = sum(T.filter(r => r.eqTarget), r => r.qty);
    // machines in place on the last day of the period (per floor, latest "Active From")
    const end = lastDay(range.to);
    const floors = f.unit ? [data.unitFloor[f.unit] || stripUnit(f.unit).replace(/\d+$/, '').toUpperCase()] : [...new Set(data.machines.map(m => m.floor))];
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
    const mode = ctx.compareMode || 'prev';                       // prev | ly | target  (top-bar "Compare with")
    const refR = mode === 'ly' ? shiftP(p, -12) : ctx.compare;
    const C = this.metrics(data, p, f), R = this.metrics(data, refR, f), FY = this.metrics(data, fyR, f);
    const refLabel = shortPeriod(refR), fyl = data.fy.label;
    const na = 'Not split by category';
    // One comparison line per card, following the "Compare with" choice.
    //   cur/ref: values for this period and the comparison period; tgt: [target text, achievement 0..n] for Target mode
    const cmp = (cur, ref, tgt, lowerIsBetter) => {
      if (mode === 'target') return tgt ? [['Target', tgt[1] == null ? tgt[0] : `${tgt[0]} · ${achHtml(tgt[1])}`]] : [['Target', '<span class="note">no target</span>']];
      return [[`vs ${refLabel}`, chgHtml(cur, ref, lowerIsBetter)]];
    };
    const presentTarget = sum(data.targets.filter(t => !t.eqTarget && t.month >= p.from && t.month <= p.to && (f.unit == null || t.unit === f.unit)), t => t.present) / Math.max(1, monthsBetween(p.from, p.to));

    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Sewing Qty', n0(C.qty), `${fyl} to date: ${n0(FY.qty)}`, cmp(C.qty, R.qty, C.target ? [n0(C.target), C.ach] : null)),
      cmpTile('Equivalent Qty', n0(C.eq), `Base ${data.base} pcs per tailor per day`, cmp(C.eq, R.eq, C.eqTarget ? [n0(C.eqTarget), C.eq / C.eqTarget] : null)),
      cmpTile('Target Achieved', C.ach == null ? '–' : pctTxt(C.ach), C.target ? `${n0(C.qty)} of ${n0(C.target)}` : (f.category ? na : 'No target set'),
        mode === 'target' ? [['Target', '100%']] : [[`${refLabel}`, pctTxt(R.ach)]]),
      cmpTile('Average per Working Day', n0(C.avgWD), `${C.wd} working days`, cmp(C.avgWD, R.avgWD, C.tgtWD ? [n0(C.tgtWD) + ' / day', C.avgWD / C.tgtWD] : null)),
      cmpTile('Efficiency', C.eff == null ? '–' : pctTxt(C.eff), f.category ? na : 'Equivalent qty per tailor-day (incl. OT) ÷ ' + data.base, cmp(C.eff, R.eff, C.eff == null ? null : ['100%', C.eff])),
      cmpTile('Tailors Present / Day', n0(C.presentDay), f.category ? na : `Present ${pctTxt(C.presentPct)} · Absent ${C.presentPct == null ? '–' : pctTxt(1 - C.presentPct)}`,
        cmp(C.presentDay, R.presentDay, presentTarget && C.presentDay != null ? [n0(presentTarget), C.presentDay / presentTarget] : null)),
      cmpTile('Pieces per Tailor / Day', n1(C.ppt), f.category ? na : 'Qty ÷ tailors present', cmp(C.ppt, R.ppt, null)),
      cmpTile('OT Head Count / Day', n1(C.otDay), f.category ? na : `${n0(C.hc)} head count on ${C.otDays} OT days`, cmp(C.otDay, R.otDay, null, true)),
      cmpTile('Equ. Pcs per Machine / Day', n1(C.eqPerMachine), `${n0(C.mc)} machines · capacity used ${pctTxt(C.capUtil)}${C.used ? ` · idle ${n0(C.idle)} machine-days` : ''}`,
        cmp(C.eqPerMachine, R.eqPerMachine, C.eqPerMachine == null ? null : [String(data.base), C.eqPerMachine / data.base])),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid gauge-row">${chartBox('cGauge') + chartBox('cEff')}</div>
      <div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid">${chartBox('cAtt') + chartBox('cCat')}</div>`;

    // 1. Target vs actual gauge
    Charts.gauge($('cGauge'), { actual: C.qty, target: C.target }, { id: 'sew2-gauge', title: 'Target vs Actual', sub: periodLabel(p), actualLabel: 'Actual', fmt: n0 });

    // 2. Efficiency by unit (target 100%)
    const unitsAll = data.sortUnits(new Set(data.lots.map(r => r.unit).filter(Boolean)));
    const ucolors = Charts.colorMap(unitsAll);
    const effItems = unitsAll.filter(u => this.metrics(data, p, { unit: u }).qty > 0).map(u => { const m = this.metrics(data, p, { ...f, unit: u }); return { key: u, label: u, short: u, value: m.eff == null ? 0 : m.eff * 100, color: ucolors[u], hi: f.unit ? f.unit === u : false }; });
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

    // Summary by unit + FY to date
    const urows = unitsAll.map(u => ({ u, c: this.metrics(data, p, { ...f, unit: u }), l: this.metrics(data, refR, { ...f, unit: u }), y: this.metrics(data, fyR, { ...f, unit: u }) }))
      .filter(x => x.c.qty || x.c.present || x.c.target);
    const td = v => `<td class="num">${v}</td>`;
    // sub units rolled into a unit: output only (tailors and targets are entered for the whole unit)
    const subsOf = (u, R) => data.sortUnits(new Set(data.lots.filter(r => r.unit === u && r.sub !== u && r.month >= R.from && r.month <= R.to).map(r => r.sub)));
    const subQty = (u, sb, R) => { const L = data.lots.filter(r => r.unit === u && r.sub === sb && r.month >= R.from && r.month <= R.to && (f.category == null || r.cat === f.category)); return { qty: sum(L, r => r.qty), eq: sum(L, r => r.eq) }; };
    const dash = td('<span class="note">–</span>');
    const subLine = (u, sb, wd) => { const c = subQty(u, sb, p), l = subQty(u, sb, refR);
      return `<tr class="sub-row"><td>↳ ${esc(sb)}</td>${td(n0(c.qty))}${td(n0(c.eq))}${dash}${dash}${mode === 'target' ? '' : td(chgHtml(c.qty, l.qty))}${td(wd ? n0(c.qty / wd) : '–')}${dash}${dash}${dash}${dash}${dash}</tr>`; };
    const subFy = (u, sb) => { const y = subQty(u, sb, fyR); return `<tr class="sub-row"><td>↳ ${esc(sb)}</td>${td(n0(y.qty))}${dash}${dash}${dash}${td(n0(y.eq))}${dash}</tr>`; };
    const line = (name, c, l, sel) => `<tr class="${name !== 'Total' ? 'click' : 'total'} ${sel ? 'sel' : ''}" ${name !== 'Total' ? `data-k="${esc(name)}"` : ''}><td>${esc(name)}</td>
      ${td(n0(c.qty))}${td(n0(c.eq))}${td(c.target ? n0(c.target) : '–')}${td(achHtml(c.ach))}${mode === 'target' ? '' : td(chgHtml(c.qty, l.qty))}${td(n0(c.avgWD))}
      ${td(n0(c.presentDay))}${td(pctTxt(c.presentPct))}${td(n1(c.ppt))}${td(n1(c.otDay))}${td(c.eff == null ? '–' : achHtml(c.eff))}</tr>`;
    const fyLine = (name, y) => { const diff = y.target ? y.qty - y.target : null; return `<tr class="${name === 'Total' ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(y.qty))}${td(y.target ? n0(y.target) : '–')}${td(achHtml(y.ach))}${td(diff == null ? '–' : `<span class="${diff >= 0 ? 'good' : 'bad'}">${diff >= 0 ? '+' : ''}${n0(diff)}</span>`)}${td(n0(y.eq))}${td(pctTxt(y.eff))}</tr>`; };
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Unit – ${esc(periodLabel(p))}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Sewing Qty</th><th class="num">Equ. Qty</th><th class="num">Target</th><th class="num">Achieved</th>${mode === 'target' ? '' : `<th class="num">vs ${esc(refLabel)}</th>`}
          <th class="num">Avg / Working Day</th><th class="num">Tailors / Day</th><th class="num">Present %</th><th class="num">Pcs / Tailor</th><th class="num">OT HC / Day</th><th class="num">Efficiency</th></tr></thead>
        <tbody>${urows.map(x => line(x.u, x.c, x.l, f.unit === x.u) + subsOf(x.u, p).map(sb => subLine(x.u, sb, x.c.wd)).join('')).join('') || `<tr><td colspan="${mode === 'target' ? 11 : 12}" class="empty">No data for this selection.</td></tr>`}</tbody>
        ${urows.length ? `<tfoot>${line('Total', this.metrics(data, p, { category: f.category }), this.metrics(data, refR, { category: f.category }))}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">${esc(fyl)} to date – ${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))}</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Sewing Qty</th><th class="num">Target to date</th><th class="num">Achieved</th><th class="num">Difference</th><th class="num">Equ. Qty</th><th class="num">Efficiency</th></tr></thead>
        <tbody>${urows.map(x => fyLine(x.u, x.y) + subsOf(x.u, fyR).map(sb => subFy(x.u, sb)).join('')).join('')}</tbody>
        <tfoot>${fyLine('Total', FY)}</tfoot>
      </table></div>
      <p class="note small foot-note">Efficiency = equivalent qty ÷ (tailors present + OT head count) ÷ ${data.base}. OT head count = tailors × OT hours ÷ ${data.hours}. Average per working day uses the working days of each month. Machines in place on the last day of the period; capacity from the machines list. Unit names come from the Units master; ↳ rows are sub units added into the unit above (their tailors and targets are entered for the whole unit).</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
