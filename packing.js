// MIS Master System - Packing report on the "MIS System" data (step C).
// Metrics agreed with Mari (MIS Report Metrics.xlsx), following the old MIS:
//   Packed Qty      = Out Qty (Packing_Daily, shirts, all units together) + trouser lot qty (Unit G, Packing_Lot)
//                     When one unit / item / category is chosen, its lot qty is used (Out Qty is not split by unit).
//   Target vs Actual = Packed ÷ packing target (Targets master, Process Packing, Unit "All")
//   Damage %        = (No exchange + damage + cut garment pcs) ÷ lot qty; allowed % from Settings (2%)
//   Pass %          = Pass pcs ÷ lot qty
//   Present %       = Present ÷ Strength (Packing_Daily)
//   Packed vs Sewn  = Packed ÷ sewing qty of the same period
//   Shirt vs Trouser packed – FY to date, no comparison (Mari)
// Uses helpers from sewing.js (rowsOf, cmpTile, chgHtml, achHtml, pctTxt, unitMapper, shiftP).

const PackingV2 = {
  sources: ['ms_packing_lot', 'ms_packing_daily', 'ms_targets'],
  dims: { unit: 'Unit', category: 'Category', section: 'Section', date: 'Date' },
  filterKey: 'unit',
  compareModes: true,
  detailSources: [
    { report: 'ms_packing_lot', title: 'Packing lots', map: { unit: '_unit', section: 'Section', date: 'Date', category: '_cat' }, consts: {},
      view: r => ({ ...r, _unit: PackingV2.unitOf(r), _cat: PackingV2.catOf(r.Item) }) },
    { report: 'ms_packing_daily', title: 'Packing daily', map: { date: 'Date' }, consts: {} },
  ],
  unitOf: r => r['Packing Unit'],
  catOf: () => '(none)',

  async load(p, c) {
    const fy = fyOf(p.to);
    const from = [addMonths(p.from, -12), addMonths(p.to, -11), fy.start, c.from].sort()[0];
    const to = p.to;
    const [lot, daily, sew, tg, wd, units, items, settings] = await Promise.all([
      agg({ report: 'ms_packing_lot', from, to, by: ['date', 'Packing Unit', 'Item', 'Section'], sum: ['Lot Qty', 'Pass Pcs', 'No Exchange Pcs', 'Damage Pcs', 'Cut Garment Pcs'] }),
      agg({ report: 'ms_packing_daily', from, to, by: ['date'], sum: ['Strength', 'Present', 'Out Qty'] }),
      agg({ report: 'ms_sewing_lot', from, to, by: ['month'], sum: ['Qty'] }),
      agg({ report: 'ms_targets', from, to, by: ['month', 'Process', 'Unit'], sum: ['Target Qty'] }),
      agg({ report: 'ms_working_days', from, to, by: ['month'], sum: ['Working Days'] }),
      rowsOf('ms_units', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_items', MASTER_MONTH, MASTER_MONTH),
      rowsOf('ms_settings', MASTER_MONTH, MASTER_MONTH),
    ]);
    const um = unitMapper(units, 'Packing');
    const cats = Object.fromEntries(items.map(r => [String(r.Item || '').toUpperCase(), r.Category || '(none)']));
    this.catOf = it => cats[String(it || '').toUpperCase()] || '(none)';
    this.unitOf = r => um(r['Packing Unit'], '', r.Date).unit;
    const lots = lot.rows.map(([d, u, it, sec, q, pass, nx, dm, cg]) => ({ date: d, month: d && d.slice(0, 7), unit: um(u, '', d).unit, item: it || '(none)', category: this.catOf(it),
      section: sec || '(none)', lot: q || 0, pass: pass || 0, noex: nx || 0, dmg: dm || 0, cut: cg || 0 }));
    const days = daily.rows.map(([d, st, pr, out]) => ({ date: d, month: d && d.slice(0, 7), strength: st || 0, present: pr || 0, out: out || 0 }));
    const sewn = Object.fromEntries(sew.rows.map(([m, q]) => [m, q || 0]));
    const targets = tg.rows.filter(r => /^packing/i.test(r[1] || '')).map(([m, , u, q]) => ({ month: m, unit: /^all$/i.test(String(u || '').trim()) ? 'All' : um(u, '', m).unit, qty: q || 0 }));
    const wdays = Object.fromEntries(wd.rows.map(([m, n]) => [m, n]));
    const s = settings.find(r => /damage/i.test(String(r.Setting || '')));
    const allowed = s && Number(s.Value) >= 0 ? Number(s.Value) / 100 : 0.02;
    return { lots, days, sewn, targets, wdays, allowed, fy, sortUnits: um.sort };
  },

  units(data) { return data.sortUnits(new Set(data.lots.filter(r => r.lot).map(r => r.unit).filter(Boolean))); },

  metrics(data, range, f) {
    const inR = m => m && m >= range.from && m <= range.to;
    const lotOk = r => (f.unit == null || r.unit === f.unit) && (f.category == null || r.category === f.category) && (f.section == null || r.section === f.section) && (f.date == null || r.date === f.date);
    const L = data.lots.filter(r => inR(r.month) && lotOk(r));
    const D = data.days.filter(r => inR(r.month) && (f.date == null || r.date === f.date));
    const lot = sum(L, r => r.lot), pass = sum(L, r => r.pass), noex = sum(L, r => r.noex), dmg = sum(L, r => r.dmg), cut = sum(L, r => r.cut);
    const out = sum(D, r => r.out), strength = sum(D, r => r.strength), present = sum(D, r => r.present);
    // shirts are counted by Out Qty (all units together); trousers by their lot qty
    const whole = f.unit == null && f.category == null && f.section == null;
    const trouser = sum(data.lots.filter(r => inR(r.month) && r.section === 'Trouser' && (f.date == null || r.date === f.date)), r => r.lot);
    const shirtOut = out || sum(data.lots.filter(r => inR(r.month) && r.section !== 'Trouser' && (f.date == null || r.date === f.date)), r => r.lot);
    const packed = whole ? shirtOut + trouser : (f.section === 'Trouser' && f.unit == null && f.category == null ? trouser : f.section === 'Shirt' && f.unit == null && f.category == null ? shirtOut : lot);
    const months = monthSeq(range.from, range.to).filter(m => whole || L.some(r => r.month === m));
    const wd = f.date ? 1 : sum(months, m => data.wdays[m] || new Set(data.days.filter(r => r.month === m && r.out > 0).map(r => r.date)).size);
    const T = whole && f.date == null ? data.targets.filter(r => inR(r.month) && r.unit === 'All') : [];
    const target = sum(T, r => r.qty);
    const sewn = whole && f.date == null ? sum(monthSeq(range.from, range.to), m => data.sewn[m] || 0) : 0;
    const rej = noex + dmg + cut;
    return {
      packed, lot, pass, noex, dmg, cut, rej, out, trouser, shirtOut, strength, present, wd, whole, target: target || null, sewn: sewn || null,
      ach: target ? packed / target : null,
      avgWD: wd ? packed / wd : null, tgtWD: target && wd ? target / wd : null,
      passPct: lot ? pass / lot : null, rejPct: lot ? rej / lot : null,
      dmgPct: lot ? dmg / lot : null, noexPct: lot ? noex / lot : null, cutPct: lot ? cut / lot : null,
      presentPct: strength ? present / strength : null, presentDay: wd ? present / wd : null, strengthDay: wd ? strength / wd : null,
      ppd: present ? out / present : null,
      vsSewn: sewn ? packed / sewn : null,
    };
  },

  draw(data, ctx) {
    const f = ctx.filters, p = ctx.period;
    const fyR = { from: data.fy.start > p.from ? p.from : data.fy.start, to: p.to };
    const mode = ctx.compareMode || 'prev';
    const refR = mode === 'ly' ? shiftP(p, -12) : ctx.compare;
    const C = this.metrics(data, p, f), R = this.metrics(data, refR, f), FY = this.metrics(data, fyR, { ...f, date: null });
    const refLabel = shortPeriod(refR), fyl = data.fy.label, allowed = data.allowed;
    const cmp = (cur, ref, tgt, lowerIsBetter) => {
      if (mode === 'target') return tgt ? [['Target', tgt[1] == null ? tgt[0] : `${tgt[0]} · ${achHtml(tgt[1])}`]] : [['Target', '<span class="note">no target</span>']];
      return [[`vs ${refLabel}`, chgHtml(cur, ref, lowerIsBetter)]];
    };
    const rejHtml = v => (v == null ? '–' : `<span class="${v <= allowed ? 'good' : 'bad'}">${pctTxt(v)}</span>`);
    const noTgt = f.date ? 'Targets are monthly' : !C.whole ? 'Target is for the whole factory' : 'No target set';
    const packedNote = C.whole ? `Out qty ${n0(C.shirtOut)} + trouser ${n0(C.trouser)}` : 'Lot qty of the selection (out qty is not split by unit)';

    $('repTiles').classList.add('wide');
    $('repTiles').innerHTML = [
      cmpTile('Packed Qty', n0(C.packed), packedNote, cmp(C.packed, R.packed, C.target ? [n0(C.target), C.ach] : null)),
      cmpTile('Target Achieved', C.ach == null ? '–' : pctTxt(C.ach), C.target ? `${n0(C.packed)} of ${n0(C.target)}` : noTgt,
        mode === 'target' ? [['Target', '100%']] : [[refLabel, pctTxt(R.ach)]]),
      cmpTile('Average Packed per Working Day', n0(C.avgWD), f.date ? 'For the chosen day' : `${C.wd} working days`, cmp(C.avgWD, R.avgWD, C.tgtWD ? [n0(C.tgtWD) + ' / day', C.avgWD / C.tgtWD] : null)),
      cmpTile('Packed vs Sewn', C.vsSewn == null ? '–' : pctTxt(C.vsSewn), C.sewn ? `Sewn ${n0(C.sewn)} in the period` : 'For the whole factory, by month', cmp(C.vsSewn, R.vsSewn, null)),
      cmpTile('Pass %', pctTxt(C.passPct), `${n0(C.pass)} passed of ${n0(C.lot)} lot pcs`, cmp(C.passPct, R.passPct, null)),
      cmpTile('Damage %', rejHtml(C.rejPct), `No exchange ${pctTxt(C.noexPct)} · damage ${pctTxt(C.dmgPct)} · cut garment ${pctTxt(C.cutPct)}`,
        mode === 'target' ? [['Allowed', `${pctTxt(allowed)} · ${rejHtml(C.rejPct)}`]] : [[`vs ${refLabel}`, chgHtml(C.rejPct, R.rejPct, true)]]),
      cmpTile('Present %', pctTxt(C.presentPct), `${n0(C.presentDay)} present of ${n0(C.strengthDay)} on roll per day`, cmp(C.presentPct, R.presentPct, null)),
      cmpTile('Pieces per Person / Day', n1(C.ppd), 'Out qty ÷ people present', cmp(C.ppd, R.ppd, null)),
    ].join('');

    $('repCharts').innerHTML = `<div class="chart-grid gauge-row">${chartBox('cGauge') + chartBox('cRej')}</div>
      <div class="chart-grid">${chartBox('cTrend') + chartBox('cDaily')}</div>
      <div class="chart-grid">${chartBox('cRejMix') + chartBox('cCat')}</div>`;

    // 1. Target vs actual gauge
    Charts.gauge($('cGauge'), { actual: C.packed, target: C.target }, { id: 'pack2-gauge', title: 'Target vs Actual', sub: periodLabel(p), actualLabel: 'Packed', fmt: n0 });

    const inP = r => r.month >= p.from && r.month <= p.to;
    const except = k => r => Object.entries(f).every(([d, v]) => v == null || d === k || r[d] === v);
    const uRows = data.lots.filter(r => inP(r) && except('unit')(r));
    const unitsAll = data.sortUnits(new Set(uRows.filter(r => r.lot).map(r => r.unit)));
    const ucolors = Charts.colorMap(unitsAll);
    const per = unitsAll.map(u => ({ u, m: this.metrics(data, p, { ...f, unit: u }) }));

    // 2. Damage % by unit with the allowed line
    Charts.barsV($('cRej'), per.map(({ u, m }) => ({ key: u, label: u, short: u, value: m.rejPct == null ? 0 : m.rejPct * 100, color: ucolors[u], hi: f.unit ? f.unit === u : false })),
      { id: 'pack2-rej', title: 'Damage % by Unit', sub: 'No exchange + damage + cut garment ÷ lot qty · click a unit to filter', keyLabel: 'Unit', valueLabel: 'Damage %',
        fmt: v => (v == null ? '–' : v.toFixed(2) + '%'), avg: { value: allowed * 100, label: 'Allowed' }, onClick: d => setFilter('unit', d.key) });

    // 3. 12-month trend with target line
    const trendFrom = addMonths(p.to, -11);
    const tf = { ...f, date: null };
    const tItems = monthSeq(trendFrom, p.to).map(m => { const x = this.metrics(data, { from: m, to: m }, tf); return { key: m, label: fmtMonth(m), short: shortMonth(m), value: x.packed, line: x.target || null, hi: m >= p.from && m <= p.to }; });
    Charts.barsV($('cTrend'), tItems, { id: 'pack2-trend', title: 'Packed Qty – last 12 months', sub: 'Line = target · click a month to view it', keyLabel: 'Month', valueLabel: 'Packed Qty', lineLabel: 'Target', fmt: n0, onClick: d => setPeriod({ from: d.key, to: d.key }) });

    // 4. Daily packed (out qty + trouser lots, or lot qty for a selection) with average line
    const dayRows = C.whole
      ? data.days.filter(inP).map(r => ({ date: r.date, v: r.out })).concat(data.lots.filter(r => inP(r) && r.section === 'Trouser').map(r => ({ date: r.date, v: r.lot })))
      : data.lots.filter(r => inP(r) && except('date')(r)).map(r => ({ date: r.date, v: r.lot }));
    drawDaily($('cDaily'), 'pack2-daily', dayRows, 'v', 'Packed Qty', ctx, f, true);

    // 5. What was rejected, by unit (stacked)
    Charts.columns($('cRejMix'), per.map(({ u }) => ({ key: u, label: u })),
      [{ key: 'nx', label: 'No exchange', color: 'var(--s1)' }, { key: 'dm', label: 'Damage', color: 'var(--s5)' }, { key: 'cg', label: 'Cut garment', color: 'var(--s3)' }],
      per.map(({ m }) => [m.noex, m.dmg, m.cut]),
      { id: 'pack2-rejmix', title: 'Rejected Pieces by Unit', sub: 'Pieces not passed, by reason', keyLabel: 'Unit', fmt: n0, stack: true, selected: f.unit ?? null, onClick: c => setFilter('unit', c.key) });

    // 6. Category mix (doughnut, lot qty)
    const colors = dimColors(data.lots, 'category', 'lot');
    const cRows = data.lots.filter(r => inP(r) && except('category')(r));
    const cItems = topN(groupSum(cRows, 'category', 'lot'), 6).map(x => ({ ...x, color: colors[x.other ? '__other' : x.key] }));
    Charts.donut($('cCat'), cItems, { id: 'pack2-cat', title: 'Lot Qty by Category', keyLabel: 'Category', valueLabel: 'Lot Qty', fmt: n0, centerLabel: 'Lot Qty',
      selected: f.category ?? null, onClick: d => { if (!d.other) setFilter('category', d.key); } });

    // Summary by unit + Shirt / Trouser FY to date
    const td = v => `<td class="num">${v}</td>`;
    const line = (name, c, l, sel, total) => `<tr class="${total ? 'total' : 'click'} ${sel ? 'sel' : ''}" ${total ? '' : `data-k="${esc(name)}"`}><td>${esc(name)}</td>
      ${td(n0(c.lot))}${mode === 'target' ? '' : td(chgHtml(c.lot, l.lot))}${td(n0(c.pass))}${td(pctTxt(c.passPct))}${td(n0(c.noex))}${td(n0(c.dmg))}${td(n0(c.cut))}${td(rejHtml(c.rejPct))}</tr>`;
    const urows = (f.unit ? [f.unit] : unitsAll).map(u => ({ u, c: this.metrics(data, p, { ...f, unit: u }), l: this.metrics(data, refR, { ...f, unit: u }) }));
    const uf = { ...f }; delete uf.unit;
    const secRow = (name, v, tot) => `<tr class="${name === 'Total' ? 'total' : ''}"><td>${esc(name)}</td>${td(n0(v))}${td(tot ? pctTxt(v / tot) : '–')}</tr>`;
    const fyAll = this.metrics(data, fyR, {});
    $('repSummary').innerHTML = `<div class="sum-head"><h2>Summary by Unit – ${esc(periodLabel(p))}${f.date ? ' · ' + esc(fmtDay(f.date)) : ''}</h2><button class="btn primary" id="btnDetails" type="button">View Details</button></div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Unit</th><th class="num">Lot Qty</th>${mode === 'target' ? '' : `<th class="num">vs ${esc(refLabel)}</th>`}<th class="num">Pass Pcs</th><th class="num">Pass %</th>
          <th class="num">No Exchange</th><th class="num">Damage</th><th class="num">Cut Garment</th><th class="num">Damage %</th></tr></thead>
        <tbody>${urows.map(x => line(x.u, x.c, x.l, f.unit === x.u)).join('') || `<tr><td colspan="${mode === 'target' ? 8 : 9}" class="empty">No data for this selection.</td></tr>`}</tbody>
        ${urows.length ? `<tfoot>${line('Total', this.metrics(data, p, uf), this.metrics(data, refR, uf), false, true)}</tfoot>` : ''}
      </table></div>
      <div class="sec-title">Shirt and Trouser packed – ${esc(fyl)} to date (${esc(fmtMonth(fyR.from))} to ${esc(fmtMonth(p.to))})</div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>Section</th><th class="num">Packed Qty</th><th class="num">Share</th></tr></thead>
        <tbody>${secRow('Shirt', fyAll.shirtOut, fyAll.packed)}${secRow('Trouser', fyAll.trouser, fyAll.packed)}</tbody>
        <tfoot>${secRow('Total', fyAll.packed, fyAll.packed)}</tfoot>
      </table></div>
      <p class="note small foot-note">Packed qty = out qty from Packing daily (shirts, all units) + trouser lot qty (Unit G). Damage % = (no exchange + damage + cut garment pcs) ÷ lot qty; allowed ${pctTxt(allowed)} (Settings). The packing target is set for the whole factory (Targets on the Masters page). Unit names come from the Units master.</p>`;
    $('repSummary').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => setFilter('unit', tr.dataset.k));
    $('btnDetails').onclick = () => openDetails(0);
  },
};
