// MIS Master System - Sales invoice upload (heavy-data pattern).
// The browser reads the file, checks headers, field types, dates and required details, then builds daily summaries.
// Summaries go to D1; detail rows go to the month's Google Sheet (Sales_2026_11). Only the dates in the file are replaced.

const SALES_COLS = ['Source Site', 'Customer Name', 'Destination Site', 'Destination State', 'Destination City', 'Agent Name', 'Invoice Type', 'DIVISION', 'SECTION', 'DEPARTMENT',
  'Category5', 'Standard Rate', 'WSP', 'Invoice Rate', 'Invoice Date', 'Invoice No', 'SO', 'Invoice Qty', 'Invoice Gross Amt', 'Remarks'];
const SALES_REQUIRED = ['Source Site', 'Customer Name', 'Destination State', 'Invoice Type', 'DIVISION', 'SECTION', 'DEPARTMENT', 'Category5', 'Invoice Date', 'Invoice No'];
const SALES_NUMBERS = ['Standard Rate', 'WSP', 'Invoice Rate', 'Invoice Qty', 'Invoice Gross Amt'];
const SALES_DATE_AT = SALES_COLS.indexOf('Invoice Date');
const SU = { plan: null };

function salesHeaderRow(grid) {
  const need = ['invoiceno', 'invoicedate', 'invoiceqty', 'invoicegrossamt'];
  for (let r = 0; r < Math.min(6, grid.length); r++) {
    const heads = (grid[r] || []).map(erpNorm);
    if (need.every(n => heads.includes(n))) return r;
  }
  return -1;
}

// Returns true when the file is a sales invoice file (then this page handles it)
async function salesTryFile(X, wb, file) {
  let found = null;
  for (const name of wb.SheetNames) {
    const grid = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    const hr = salesHeaderRow(grid);
    if (hr >= 0) { found = { name, grid, hr }; break; }
  }
  $('heavyCheck').innerHTML = ''; SU.plan = null;
  if (!found) return false;
  $('checkArea').classList.add('hidden');
  $('heavyCheck').innerHTML = '<div class="card"><p class="note">Checking the sales file…</p></div>';
  const states = (await api('/api/masters/rows?key=ms_states')).rows;
  SU.plan = salesCheck(X, found, file.name, states);
  drawSalesCheck();
  return true;
}

function salesCheck(X, f, fileName, states) {
  const heads = (f.grid[f.hr] || []).map(h => String(h ?? '').trim());
  const at = {}; heads.forEach((h, i) => { at[erpNorm(h)] = i; });
  const errors = new Map(), warnings = new Map();
  const note = (m, msg, row) => { const e = m.get(msg) || { msg, n: 0, rows: [] }; e.n++; if (row != null && e.rows.length < 5) e.rows.push(row); m.set(msg, e); };
  const missing = SALES_COLS.filter(c => at[erpNorm(c)] == null);
  if (missing.length) { missing.forEach(c => note(errors, `Column "${c}" is missing. If the ERP renamed it, tell Claude the new name.`)); return { fileName, errors: [...errors.values()], warnings: [] }; }
  const extra = heads.filter(h => h && !SALES_COLS.some(c => erpNorm(c) === erpNorm(h)));
  const stateMap = Object.fromEntries(states.map(s => [OKey(s['State Name in Data']), s.State]));
  const today = todayIso(), seen = new Map(), detail = { Sales: {}, Returns: {} }, sumS = new Map(), sumR = new Map(), sumI = new Map(), dates = new Set();
  let rowsRead = 0, sq = 0, sv = 0, rq = 0, rv = 0;
  const add = (m, key, base, q, v) => { const x = m.get(key); if (x) { x[x.length - 2] += q; x[x.length - 1] += v; } else m.set(key, [...base, q, v]); };

  for (let r = f.hr + 1; r < f.grid.length; r++) {
    const line = f.grid[r] || [], excelRow = r + 1;
    if (line.every(v => v == null || String(v).trim() === '')) continue;
    rowsRead++;
    const row = SALES_COLS.map(c => { const v = line[at[erpNorm(c)]]; return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v ?? ''; });
    const get = c => row[SALES_COLS.indexOf(c)];
    let bad = false;
    for (const c of SALES_REQUIRED) if (get(c) === '') { note(errors, `"${c}" is blank`, excelRow); bad = true; }
    for (const c of SALES_NUMBERS) {
      const raw = get(c), n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      if (raw === '' || !isFinite(n)) { note(errors, `"${c}" is not a number`, excelRow); bad = true; } else row[SALES_COLS.indexOf(c)] = n;
    }
    const d = erpDate(get('Invoice Date'), X);
    if (!d) { if (get('Invoice Date') !== '') note(errors, '"Invoice Date" is not a valid date', excelRow); bad = true; }
    else if (d > today) { note(errors, '"Invoice Date" is in the future', excelRow); bad = true; }
    else row[SALES_DATE_AT] = d;
    const type = String(get('Invoice Type')).toUpperCase();
    const kind = type === 'SALES' ? 'Sales' : /RETURN|SRTN|CREDIT/.test(type) ? 'Returns' : null;
    if (type && !kind) { note(errors, `Invoice Type "${get('Invoice Type')}" is not known as sales or return`, excelRow); bad = true; }
    if (bad) continue;
    const qty = Number(get('Invoice Qty')), amt = Number(get('Invoice Gross Amt'));
    if (kind === 'Sales' && qty <= 0) { note(errors, 'Sales line with zero or negative "Invoice Qty"', excelRow); continue; }
    if (Math.abs(Math.abs(qty) * Number(get('Invoice Rate')) - Math.abs(amt)) > 1) note(warnings, 'Qty × Invoice Rate does not equal Gross Amt', excelRow);
    if (get('SO') === '') note(warnings, 'No order number (kept in Sales, left out of Order Fulfilment)', excelRow);
    const key = ['Source Site', 'Invoice No', 'SO', 'SECTION', 'DEPARTMENT', 'Category5', 'Invoice Rate', 'Invoice Type'].map(c => OKey(get(c))).join('|');
    if (seen.has(key)) { note(errors, 'Same line twice (Invoice No + SO + Section + Dept + Brand + Rate)', excelRow); continue; }
    seen.set(key, excelRow);
    const state = stateMap[OKey(get('Destination State'))];
    if (!state) note(warnings, `State "${get('Destination State')}" is not in Masters → States`, excelRow);
    const month = d.slice(0, 7), prefix = prefixOf(get('SO')) || '(none)', q = Math.abs(qty), v = Math.abs(amt);
    const dims = [d, month, get('Source Site'), get('DIVISION'), get('SECTION'), get('DEPARTMENT'), get('Category5'), prefix, state || String(get('Destination State'))];
    dates.add(d);
    (detail[kind][month] = detail[kind][month] || []).push(row);
    if (kind === 'Sales') {
      sq += q; sv += v; add(sumS, dims.map(OKey).join('|'), dims, q, v);
      if (get('SO') !== '') {   // invoice qty for Order Fulfilment
        const k = [d, get('SO'), get('SECTION'), get('DEPARTMENT'), get('Category5')].map(OKey).join('|'), x = sumI.get(k);
        if (x) x[8] += q; else sumI.set(k, [d, month, 'Invoice', String(get('SO')), get('SECTION'), get('DEPARTMENT'), get('Category5'), get('Source Site'), q]);
      }
    }
    else { rq += q; rv += v; const dr = [...dims, String(get('Invoice Type'))]; add(sumR, dr.map(OKey).join('|'), dr, q, v); }
  }
  if (!rowsRead) note(errors, 'No data rows found.');
  const list = [...dates].sort();
  const months = [...new Set(list.map(d => d.slice(0, 7)))];
  return { fileName, sheet: f.name, rowsRead, dates: list, months, detail, sumS: [...sumS.values()], sumR: [...sumR.values()], sumI: [...sumI.values()], sq, sv, rq, rv, extra,
    errors: [...errors.values()], warnings: [...warnings.values()] };
}

function drawSalesCheck() {
  const p = SU.plan, box = $('heavyCheck');
  const li = (e, c) => `<li class="${c}">${esc(e.msg)}${e.n > 1 || e.rows.length ? ` <span class="note small">${fmtNum(e.n)} row${e.n === 1 ? '' : 's'}${e.rows.length ? ' · Excel row ' + e.rows.join(', ') + (e.n > e.rows.length ? ' …' : '') : ''}</span>` : ''}</li>`;
  const ok = !p.errors.length;
  box.innerHTML = `<div class="card check-card">
    <div class="check-head"><div><b>${esc(p.fileName)}</b><div class="note small">${p.rowsRead ? `${fmtNum(p.rowsRead)} rows · ${esc(fmtYmd(p.dates[0] || ''))}${p.dates.length > 1 ? ' to ' + esc(fmtYmd(p.dates.at(-1))) : ''} · ${fmtNum(p.dates.length)} date${p.dates.length === 1 ? '' : 's'}` : ''}</div></div>
      <div class="check-actions"><button class="btn" type="button" id="salesClear">Choose another file</button><button class="btn primary" type="button" id="salesSave" ${ok ? '' : 'disabled'}>Upload</button></div></div>
    ${p.rowsRead && p.months ? `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th class="num">Qty</th><th class="num">Value</th><th class="num">Summary rows</th><th>Monthly sheet needed</th></tr></thead><tbody>
      <tr><td>Sales</td><td class="num">${n0(p.sq)}</td><td class="num">₹${n0(p.sv)}</td><td class="num">${fmtNum(p.sumS.length)}</td><td rowspan="2">${p.months.map(m => esc(`Sales_${m.replace('-', '_')}`)).join(', ')}</td></tr>
      <tr><td>Returns</td><td class="num">${n0(p.rq)}</td><td class="num">₹${n0(p.rv)}</td><td class="num">${fmtNum(p.sumR.length)}</td></tr></tbody></table></div>` : ''}
    <p>${ok ? '<span class="pill good">Ready</span>' : '<span class="pill bad">Fix these in the file, then choose it again. Nothing was saved.</span>'}</p>
    ${p.errors.length || p.warnings.length ? `<ul class="msgs">${p.errors.map(e => li(e, 'err')).join('')}${p.warnings.map(e => li(e, 'warn')).join('')}</ul>` : ''}
    ${p.extra && p.extra.length ? `<p class="note small">Not stored: ${esc(p.extra.join(', '))}</p>` : ''}
    <p class="note small">Only the dates in this file are replaced. Other dates stay as they are.</p></div>`;
  $('salesClear').onclick = () => { if (up.busy) return; SU.plan = null; box.innerHTML = ''; $('fileInput').value = ''; $('fileInput').click(); };
  $('salesSave').onclick = () => salesSave().catch(err => say(err.message, 'error'));
}

const detailValues = d => (d.sheet ? d.sheet.values || [] : d.values || []);
async function readDetailTab(module, month, dataset) {
  const out = [];
  for (let start = 1; ; start += 5000) {
    const d = await api(`/api/detail/read?module=${module}&month=${month}&dataset=${dataset}&start=${start}&limit=5000`);
    const v = detailValues(d);
    out.push(...v);
    if (!v.length || start + 5000 > (d.rowCount || 0)) break;
  }
  return out;
}

async function sendBatches(path, rows, onDone) {
  const max = up.config ? up.config.maxChunkBytes : 500000;
  let parts = [], size = 2, sent = 0;
  const flush = async () => { if (!parts.length) return; await sendText(path(sent), '[' + parts.join(',') + ']'); sent += parts.length; if (onDone) onDone(parts.length); parts = []; size = 2; };
  for (const r of rows) {
    const j = JSON.stringify(r);
    if (parts.length >= 2000 || size + j.length + 1 > max) await flush();
    parts.push(j); size += j.length + 1;
  }
  await flush();
}

// Saves one checked file: detail to the monthly Sheet (new hidden tab, verified), summaries to D1, then the new tab replaces the old one.
// cfg: { module, kind, fileName, rowsRead, dates, months, sets, detail: {set: {month: rows}}, cols, dateAt, sums: {table: rows}, saveBtn, clearBtn, done }
async function heavySave(cfg) {
  if (up.busy) return;
  if (!confirm(`Upload ${fmtNum(cfg.rowsRead)} rows?\n\n${fmtYmd(cfg.dates[0])} to ${fmtYmd(cfg.dates.at(-1))}: these ${cfg.dates.length} date${cfg.dates.length === 1 ? '' : 's'} replace the same dates already saved for this data. Other dates stay as they are.`)) return;
  up.busy = true;
  window.addEventListener('beforeunload', stopLeave);
  $(cfg.saveBtn).disabled = true; $(cfg.clearBtn).disabled = true;
  say('');
  if (!up.config) up.config = await api('/api/upload/config');
  let uploadId = null, committed = false;
  const temps = [], fileDates = new Set(cfg.dates), total = Object.values(cfg.sums).reduce((a, r) => a + r.length, 0);
  try {
    uploadId = (await api('/api/sum/begin', { kind: cfg.kind, fileName: cfg.fileName, rowsRead: cfg.rowsRead, dates: cfg.dates })).uploadId;
    for (const month of cfg.months) for (const dataset of cfg.sets) {
      progress(0, 1, `Reading ${dataset} ${fmtMonth(month)}…`);
      const old = await readDetailTab(cfg.module, month, dataset);
      if (old.length && (old[0].length < cfg.cols.length || cfg.cols.some((c, i) => String(old[0][i]) !== c))) throw new Error(`The tab "${dataset}" in the ${fmtMonth(month)} sheet has different column names. Nothing was changed.`);
      const keep = old.slice(1).filter(r => !fileDates.has(String(r[cfg.dateAt]).slice(0, 10)));
      const fresh = (cfg.detail[dataset] || {})[month] || [];
      if (!old.length && !fresh.length) continue;
      const all = [cfg.cols, ...keep, ...fresh], want = keep.length + fresh.length;
      const b = await api('/api/detail/begin', { module: cfg.module, month, dataset, rows: want, cols: cfg.cols.length, uploadId });
      const t = { month, dataset, tab: b.tab, rows: want };
      temps.push(t);
      let done = 0;
      await sendBatches(sent => `/api/detail/append?module=${cfg.module}&month=${month}&tab=${encodeURIComponent(t.tab)}&start=${sent + 1}`, all, n => { done += n; progress(done, all.length, `Saving ${dataset} ${fmtMonth(month)} to Google Sheet…`); });
      const v = await api('/api/detail/verify', { module: cfg.module, month, tab: t.tab });
      if (v.rows !== want) throw new Error(`Google Sheet check failed for ${dataset} ${fmtMonth(month)}: expected ${want} rows, found ${v.rows}. Nothing was changed.`);
    }
    let d = 0;
    progress(0, total, 'Saving summaries…');
    for (const [table, rows] of Object.entries(cfg.sums)) {
      await sendBatches(() => `/api/sum/rows?upload=${uploadId}&table=${table}`, rows, n => { d += n; progress(d, total, 'Saving summaries…'); });
    }
    const fin = await api('/api/sum/finish', { uploadId, dates: cfg.dates, expected: Object.fromEntries(Object.entries(cfg.sums).map(([t, r]) => [t, r.length])) });
    committed = true;
    const failed = [];
    for (const month of cfg.months) {
      const swaps = temps.filter(t => t.month === month);
      if (!swaps.length) continue;
      try { await api('/api/detail/swap', { module: cfg.module, month, swaps }); }
      catch (e) { failed.push(`${fmtMonth(month)} (${e.message})`); }
    }
    if (failed.length) throw new Error(`Reports are updated, but View Details for ${failed.join(', ')} could not be switched. Please upload the same file again.`);
    $('progress').classList.add('hidden');
    const arch = await api('/api/store/archive', {}).catch(() => null);
    const archText = arch && arch.moved && arch.moved.length ? ` Moved to Archive: ${arch.moved.join(', ')}.` : '';
    say(`Upload complete: ${fmtNum(cfg.rowsRead)} rows, ${fmtNum(fin.summaryRows)} summary rows saved.${archText}`, 'ok');
    SU.plan = null; $('heavyCheck').innerHTML = ''; $('fileInput').value = '';
    if (typeof rp !== 'undefined') rp.cache = {};
    if (typeof UM !== 'undefined') UM.data = null;
  } catch (err) {
    $('progress').classList.add('hidden');
    if (!committed) {
      if (uploadId) await api('/api/sum/cancel', { uploadId, reason: err.message }).catch(() => {});
      for (const month of [...new Set(temps.map(t => t.month))]) await api('/api/detail/drop', { module: cfg.module, month, tabs: temps.filter(t => t.month === month).map(t => t.tab) }).catch(() => {});
    }
    say(err.message, 'error');
    if ($(cfg.saveBtn)) { $(cfg.saveBtn).disabled = !!committed; $(cfg.clearBtn).disabled = false; }
  } finally {
    up.busy = false;
    window.removeEventListener('beforeunload', stopLeave);
    loadUploadPage();
  }
}

async function salesSave() {
  const p = SU.plan;
  if (!p || p.errors.length) return;
  return heavySave({ module: 'sales', kind: 'sales', fileName: p.fileName, rowsRead: p.rowsRead, dates: p.dates, months: p.months, sets: ['Sales', 'Returns'], detail: p.detail,
    cols: SALES_COLS, dateAt: SALES_DATE_AT, sums: { sum_sales: p.sumS, sum_returns: p.sumR, sum_order_activity: p.sumI }, saveBtn: 'salesSave', clearBtn: 'salesClear' });
}

// ---------- Order files: SO, Cancel, DC ----------
// cols: [name in the app, ...names in the ERP file]; names are matched ignoring case, spaces, "-" and "_"
const ORDER_FILES = {
  Order: { label: 'Sales Orders', dataset: 'SO', dateCol: 'Order Date', orderCol: 'SO No', qtyCol: 'Order Qty', detect: ['ordqty', 'orddt'],
    cols: [['Site', 'SITENAME', 'SITE'], ['Division', 'DIV'], ['Section', 'SEC'], ['Dept', 'DEPT'], ['Brand', 'CAT5'], ['Order Date', 'ORDdt', 'ORD DATE'], ['SO No', 'SO_NO', 'ORD NO', 'ORDNO'], ['Order Qty', 'ORDqty', 'ORD QTY']],
    key: ['SO No', 'Site', 'Section', 'Dept', 'Brand'], keyText: 'SO No + Site + Section + Dept + Brand' },
  Cancel: { label: 'Order Cancellations', dataset: 'Cancel', dateCol: 'Cancel Date', orderCol: 'Order No', qtyCol: 'Cancel Qty', detect: ['candate'],
    cols: [['Site', 'SITE', 'SITENAME'], ['Division', 'DIV'], ['Section', 'SEC'], ['Dept', 'DEPT'], ['Brand', 'CAT5'], ['Order No', 'ORD NO', 'ORDNO', 'SO_NO'], ['Cancel Date', 'CANDATE', 'CAN DATE'], ['Cancel Qty', 'CAN-QTY', 'CANQTY', 'CNLqty']],
    key: ['Order No', 'Site', 'Section', 'Dept', 'Brand', 'Cancel Date', 'Cancel Qty'], keyText: 'all columns' },
  DC: { label: 'Delivery Challans (DC)', dataset: 'DC', dateCol: 'DC Date', orderCol: 'Order No', qtyCol: 'DC Qty', detect: ['dcno', 'dcdate'], orderOptional: true, keepDivisions: ['MENS WEAR', 'JUNIOR'],
    cols: [['Site', 'SITE', 'SITENAME'], ['Division', 'DIV'], ['Section', 'SEC'], ['Dept', 'DEPT'], ['Brand', 'CAT5'], ['Stock Point', 'OUTSTKPOINT', 'OUT STK POINT'], ['DC No', 'DC NO', 'DCNO'], ['DC Date', 'DCDATE', 'DC DATE'], ['Order No', 'ORDNO', 'ORD NO', 'SO_NO'], ['DC Qty', 'DC-QTY', 'DCQTY', 'DC QTY']],
    key: ['DC No', 'Order No', 'Section', 'Dept', 'Brand', 'Stock Point'], keyText: 'DC No + Order No + Section + Dept + Brand + Stock Point' },
};

async function orderTryFile(X, wb, file) {
  for (const name of wb.SheetNames) {
    const grid = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    for (let hr = 0; hr < Math.min(6, grid.length); hr++) {
      const heads = (grid[hr] || []).map(erpNorm);
      const kind = Object.keys(ORDER_FILES).find(k => ORDER_FILES[k].detect.every(d => heads.includes(d)));
      if (!kind) continue;
      $('checkArea').classList.add('hidden');
      SU.plan = orderCheck(X, ORDER_FILES[kind], kind, grid, hr, file.name);
      drawOrderCheck();
      return true;
    }
  }
  return false;
}

function orderCheck(X, F, kind, grid, hr, fileName) {
  const heads = (grid[hr] || []).map(h => String(h ?? '').trim()), at = {};
  const names = F.cols.map(c => c[0]);
  const errors = new Map(), warnings = new Map();
  const note = (m, msg, row) => { const e = m.get(msg) || { msg, n: 0, rows: [] }; e.n++; if (row != null && e.rows.length < 5) e.rows.push(row); m.set(msg, e); };
  const used = new Set();
  for (const [app, ...alts] of F.cols) {
    const hit = heads.findIndex(h => [app, ...alts].some(a => erpNorm(a) === erpNorm(h)));
    if (hit < 0) note(errors, `Column "${alts[0]}" is missing. If the ERP renamed it, tell Claude the new name.`); else { at[app] = hit; used.add(hit); }
  }
  const base = { kind, F, fileName, rowsRead: 0, errors: [], warnings: [], dates: [], months: [] };
  if (errors.size) return { ...base, errors: [...errors.values()] };
  const extra = heads.filter((h, i) => h && !used.has(i));
  const today = todayIso(), seen = new Set(), detail = { [F.dataset]: {} }, act = new Map(), stock = new Map(), dates = new Set(), left = {};
  let qty = 0, saved = 0;
  const reqCols = names.filter(n => n !== F.qtyCol && !(F.orderOptional && n === F.orderCol));
  const addSum = (m, key, dims, q) => { const x = m.get(key); if (x) x[x.length - 1] += q; else m.set(key, [...dims, q]); };
  for (let r = hr + 1; r < grid.length; r++) {
    const line = grid[r] || [], excelRow = r + 1;
    if (line.every(v => v == null || String(v).trim() === '')) continue;
    base.rowsRead++;
    const row = names.map(n => { const v = line[at[n]]; return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v ?? ''; });
    const get = n => row[names.indexOf(n)];
    if (F.keepDivisions && !F.keepDivisions.includes(String(get('Division')).toUpperCase())) { const v = get('Division') || '(blank)'; left[v] = (left[v] || 0) + 1; continue; }
    let bad = false;
    for (const n of reqCols) if (n !== F.dateCol && get(n) === '') { note(errors, `"${n}" is blank`, excelRow); bad = true; }
    const rawQ = get(F.qtyCol), q = typeof rawQ === 'number' ? rawQ : Number(String(rawQ).replace(/,/g, ''));
    if (rawQ === '' || !isFinite(q)) { note(errors, `"${F.qtyCol}" is not a number`, excelRow); bad = true; }
    else if (q < 0) { note(errors, `"${F.qtyCol}" is negative`, excelRow); bad = true; }
    const d = erpDate(get(F.dateCol), X);
    if (!d) { note(errors, get(F.dateCol) === '' ? `"${F.dateCol}" is blank` : `"${F.dateCol}" is not a valid date`, excelRow); bad = true; }
    else if (d > today) { note(errors, `"${F.dateCol}" is in the future`, excelRow); bad = true; }
    if (bad) continue;
    row[names.indexOf(F.dateCol)] = d; row[names.indexOf(F.qtyCol)] = q;
    const key = F.key.map(n => OKey(get(n))).join('|');
    if (seen.has(key)) { note(errors, `Same line twice (${F.keyText})`, excelRow); continue; }
    seen.add(key);
    const month = d.slice(0, 7), no = String(get(F.orderCol));
    dates.add(d); qty += q; saved++;
    (detail[F.dataset][month] = detail[F.dataset][month] || []).push(row);
    if (no) {
      const dims = [d, month, kind, no, get('Section'), get('Dept'), get('Brand'), get('Site')];
      addSum(act, [d, no, get('Section'), get('Dept'), get('Brand')].map(OKey).join('|'), dims, q);
    } else note(warnings, 'No order number (counted for the stock point only)', excelRow);
    if (kind === 'DC') {
      const dims = [d, month, get('Site'), get('Stock Point'), prefixOf(no), get('Section'), get('Dept'), get('Brand')];
      addSum(stock, dims.map(OKey).join('|'), dims, q);
    }
  }
  const list = [...dates].sort();
  return { ...base, cols: names, dateAt: names.indexOf(F.dateCol), dates: list, months: [...new Set(list.map(x => x.slice(0, 7)))], detail, qty, saved, left, extra,
    sums: kind === 'DC' ? { sum_order_activity: [...act.values()], sum_dc_stock: [...stock.values()] } : { sum_order_activity: [...act.values()] },
    errors: [...errors.values()], warnings: [...warnings.values()] };
}

function drawOrderCheck() {
  const p = SU.plan, box = $('heavyCheck');
  const li = (e, c) => `<li class="${c}">${esc(e.msg)}${e.n > 1 || e.rows.length ? ` <span class="note small">${fmtNum(e.n)} row${e.n === 1 ? '' : 's'}${e.rows.length ? ' · Excel row ' + e.rows.join(', ') + (e.n > e.rows.length ? ' …' : '') : ''}</span>` : ''}</li>`;
  const empty = !p.errors.length && !p.saved;
  const ok = !p.errors.length && !!p.saved;
  const left = Object.entries(p.left || {});
  box.innerHTML = `<div class="card check-card">
    <div class="check-head"><div><b>${esc(p.fileName)}</b><div class="note small">${esc(p.F.label)}${p.rowsRead ? ` · ${fmtNum(p.rowsRead)} rows` : ''}${p.dates.length ? ` · ${esc(fmtYmd(p.dates[0]))}${p.dates.length > 1 ? ' to ' + esc(fmtYmd(p.dates.at(-1))) : ''} · ${fmtNum(p.dates.length)} date${p.dates.length === 1 ? '' : 's'}` : ''}</div></div>
      <div class="check-actions"><button class="btn" type="button" id="orderClear">Choose another file</button><button class="btn primary" type="button" id="orderSave" ${ok ? '' : 'disabled'}>Upload</button></div></div>
    ${p.saved ? `<div class="tbl-wrap"><table><thead><tr><th>Data</th><th class="num">Rows to save</th><th class="num">Qty</th><th class="num">Summary rows</th><th>Monthly sheet needed</th></tr></thead><tbody>
      <tr><td>${esc(p.F.label)}</td><td class="num">${fmtNum(p.saved)}</td><td class="num">${n0(p.qty)}</td><td class="num">${fmtNum(Object.values(p.sums).reduce((a, r) => a + r.length, 0))}</td><td>${p.months.map(m => esc(`Orders_${m.replace('-', '_')}`)).join(', ')}</td></tr></tbody></table></div>` : ''}
    <p>${ok ? '<span class="pill good">Ready</span>' : empty ? '<span class="pill muted">No rows in this file: nothing to load</span>' : '<span class="pill bad">Fix these in the file, then choose it again. Nothing was saved.</span>'}</p>
    ${p.errors.length || p.warnings.length ? `<ul class="msgs">${p.errors.map(e => li(e, 'err')).join('')}${p.warnings.map(e => li(e, 'warn')).join('')}</ul>` : ''}
    ${left.length ? `<p class="note small">Left out (only Menswear and Junior DCs are kept): ${esc(left.map(([k, n]) => `${k} ${fmtNum(n)} rows`).join(', '))}</p>` : ''}
    ${p.extra && p.extra.length ? `<p class="note small">Not stored: ${esc(p.extra.join(', '))}</p>` : ''}
    <p class="note small">Only the dates in this file are replaced for ${esc(p.F.label)}. Other dates and other data stay as they are.</p></div>`;
  $('orderClear').onclick = () => { if (up.busy) return; SU.plan = null; box.innerHTML = ''; $('fileInput').value = ''; $('fileInput').click(); };
  $('orderSave').onclick = () => {
    if (!ok) return;
    heavySave({ module: 'orders', kind: p.kind, fileName: p.fileName, rowsRead: p.saved, dates: p.dates, months: p.months, sets: [p.F.dataset], detail: p.detail, cols: p.cols, dateAt: p.dateAt, sums: p.sums, saveBtn: 'orderSave', clearBtn: 'orderClear' }).catch(err => say(err.message, 'error'));
  };
}
