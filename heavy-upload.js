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
  const today = todayIso(), seen = new Map(), detail = { Sales: {}, Returns: {} }, sumS = new Map(), sumR = new Map(), dates = new Set();
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
    if (kind === 'Sales') { sq += q; sv += v; add(sumS, dims.map(OKey).join('|'), dims, q, v); }
    else { rq += q; rv += v; const dr = [...dims, String(get('Invoice Type'))]; add(sumR, dr.map(OKey).join('|'), dr, q, v); }
  }
  if (!rowsRead) note(errors, 'No data rows found.');
  const list = [...dates].sort();
  const months = [...new Set(list.map(d => d.slice(0, 7)))];
  return { fileName, sheet: f.name, rowsRead, dates: list, months, detail, sumS: [...sumS.values()], sumR: [...sumR.values()], sq, sv, rq, rv, extra,
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
async function readDetailTab(month, dataset) {
  const out = [];
  for (let start = 1; ; start += 5000) {
    const d = await api(`/api/detail/read?module=sales&month=${month}&dataset=${dataset}&start=${start}&limit=5000`);
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

async function salesSave() {
  const p = SU.plan;
  if (!p || p.errors.length || up.busy) return;
  if (!confirm(`Upload ${fmtNum(p.rowsRead)} rows?\n\n${fmtYmd(p.dates[0])} to ${fmtYmd(p.dates.at(-1))}: these ${p.dates.length} dates replace the same dates already saved. Other dates stay as they are.`)) return;
  up.busy = true;
  window.addEventListener('beforeunload', stopLeave);
  $('salesSave').disabled = true; $('salesClear').disabled = true;
  say('');
  if (!up.config) up.config = await api('/api/upload/config');
  let uploadId = null, committed = false;
  const temps = [], fileDates = new Set(p.dates);
  try {
    uploadId = (await api('/api/sum/begin', { fileName: p.fileName, rowsRead: p.rowsRead, dates: p.dates })).uploadId;
    const jobs = p.months.flatMap(month => ['Sales', 'Returns'].map(dataset => ({ month, dataset })));
    for (const j of jobs) {
      progress(0, 1, `Reading ${j.dataset} ${fmtMonth(j.month)}…`);
      const old = await readDetailTab(j.month, j.dataset);
      if (old.length && (old[0].length < SALES_COLS.length || SALES_COLS.some((c, i) => String(old[0][i]) !== c))) throw new Error(`The tab "${j.dataset}" in the ${fmtMonth(j.month)} sheet has different column names. Nothing was changed.`);
      const keep = old.slice(1).filter(r => !fileDates.has(String(r[SALES_DATE_AT]).slice(0, 10)));
      const fresh = (p.detail[j.dataset][j.month] || []);
      if (!old.length && !fresh.length) continue;
      const all = [SALES_COLS, ...keep, ...fresh], want = keep.length + fresh.length;
      const b = await api('/api/detail/begin', { module: 'sales', month: j.month, dataset: j.dataset, rows: want, cols: SALES_COLS.length, uploadId });
      const t = { month: j.month, dataset: j.dataset, tab: b.tab, rows: want };
      temps.push(t);
      let done = 0;
      await sendBatches(sent => `/api/detail/append?module=sales&month=${j.month}&tab=${encodeURIComponent(t.tab)}&start=${sent + 1}`, all, n => { done += n; progress(done, all.length, `Saving ${j.dataset} ${fmtMonth(j.month)} to Google Sheet…`); });
      const v = await api('/api/detail/verify', { module: 'sales', month: j.month, tab: t.tab });
      if (v.rows !== want) throw new Error(`Google Sheet check failed for ${j.dataset} ${fmtMonth(j.month)}: expected ${want} rows, found ${v.rows}. Nothing was changed.`);
    }
    progress(0, p.sumS.length + p.sumR.length, 'Saving summaries…');
    let d = 0;
    for (const [table, rows] of [['sum_sales', p.sumS], ['sum_returns', p.sumR]]) {
      await sendBatches(() => `/api/sum/rows?upload=${uploadId}&table=${table}`, rows, n => { d += n; progress(d, p.sumS.length + p.sumR.length, 'Saving summaries…'); });
    }
    const fin = await api('/api/sum/finish', { uploadId, dates: p.dates, salesRows: p.sumS.length, returnRows: p.sumR.length });
    committed = true;
    const failed = [];
    for (const month of p.months) {
      const swaps = temps.filter(t => t.month === month);
      if (!swaps.length) continue;
      try { await api('/api/detail/swap', { module: 'sales', month, swaps }); }
      catch { failed.push(fmtMonth(month)); }
    }
    if (failed.length) throw new Error(`Reports are updated, but View Details for ${failed.join(', ')} could not be switched. Please upload the same file again.`);
    $('progress').classList.add('hidden');
    say(`Upload complete: ${fmtNum(p.rowsRead)} rows, ${fmtNum(fin.summaryRows)} summary rows saved.`, 'ok');
    SU.plan = null; $('heavyCheck').innerHTML = ''; $('fileInput').value = '';
    if (typeof rp !== 'undefined') rp.cache = {};
  } catch (err) {
    $('progress').classList.add('hidden');
    if (!committed) {
      if (uploadId) await api('/api/sum/cancel', { uploadId, reason: err.message }).catch(() => {});
      for (const month of [...new Set(temps.map(t => t.month))]) await api('/api/detail/drop', { module: 'sales', month, tabs: temps.filter(t => t.month === month).map(t => t.tab) }).catch(() => {});
    }
    say(err.message, 'error');
    if ($('salesSave')) { $('salesSave').disabled = !!committed; $('salesClear').disabled = false; }
  } finally {
    up.busy = false;
    window.removeEventListener('beforeunload', stopLeave);
    loadUploadPage();
  }
}
