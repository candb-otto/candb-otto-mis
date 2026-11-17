// MIS Master System - Masters page: units, targets, working days, items, factors, machines, settings, jobbers, seasons.
// Each list is edited on screen and saved as a whole. The Worker checks every row again before saving.

const MS = { defs: [], key: null, rows: [], version: '', dirty: false, page: 1, search: '', proc: '', errors: {}, base: 20, widths: {} };
const MS_PAGE = 25;
let msSeq = 0;

const Masters = {
  dirty: () => MS.dirty,
  discard() { MS.dirty = false; MS.key = null; },
};

async function loadMasters(key) {
  try {
    if (!MS.defs.length) {
      const d = await api('/api/masters');
      MS.defs = d.masters;
    }
    const want = MS.defs.find(x => x.key === key) ? key : (MS.key || MS.defs[0].key);
    if (want === MS.key && MS.dirty) { drawMasters(); return; }   // keep unsaved edits
    await openMaster(want);
  } catch (err) { say(err.message, 'error'); }
}

async function openMaster(key) {
  $('msBody').innerHTML = '<p class="note">Loading…</p>';
  const d = await api(`/api/masters/rows?key=${encodeURIComponent(key)}`);
  MS.key = key; MS.version = d.version || ''; MS.dirty = false; MS.page = 1; MS.search = ''; MS.proc = ''; MS.errors = {};
  MS.rows = d.rows.map(r => ({ ...r, _id: ++msSeq }));
  if (key === 'ms_equ_factor') {
    try {
      const s = await api('/api/masters/rows?key=ms_settings');
      const b = s.rows.find(r => /base/i.test(String(r.Setting || '')));
      if (b && Number(b.Value) > 0) MS.base = Number(b.Value);
    } catch { /* keep 20 */ }
  }
  const want = `masters/${key}`;
  if (currentRoute() !== want) history.replaceState(null, '', '#/' + want);
  drawMasters();
}

const msDef = () => MS.defs.find(x => x.key === MS.key);

function drawMasters() {
  const def = msDef();
  $('msTabs').innerHTML = MS.defs.map(x => `<button type="button" class="ms-tab ${x.key === MS.key ? 'on' : ''}" data-k="${x.key}">${esc(x.label)}<small>${fmtNum(x.key === MS.key ? MS.rows.length : x.rows)}</small></button>`).join('');
  $('msTabs').querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
    if (b.dataset.k === MS.key) return;
    if (MS.dirty && !confirm('You have changes that are not saved. Leave them?')) return;
    MS.dirty = false;
    openMaster(b.dataset.k).catch(err => say(err.message, 'error'));
  });
  const hasProc = def.cols.some(c => c.name === 'Process');
  const procs = hasProc ? [...new Set(MS.rows.map(r => r.Process).filter(Boolean))].sort() : [];
  const months = def.dated ? [...new Set(MS.rows.map(r => String(r[def.dated] || '').slice(0, 7)).filter(Boolean))].sort().reverse() : [];
  const saved = msDef().lastUpdated ? `Last saved ${fmtDate(def.lastUpdated)}${def.updatedBy ? ' by ' + esc(def.updatedBy) : ''}` : 'Not saved in the app yet';
  $('msBody').innerHTML = `
    <div class="ms-head">
      <div><h2>${esc(def.label)}</h2><p class="note small">${esc(def.desc)}</p><p class="note small">${saved}</p></div>
      <div class="ms-actions">
        <span class="ms-dirty ${MS.dirty ? '' : 'hidden'}" id="msDirty">Changes not saved</span>
        <button class="btn" type="button" id="msExcel">Download Excel</button>
        <button class="btn" type="button" id="msCancel" ${MS.dirty ? '' : 'disabled'}>Cancel changes</button>
        <button class="btn primary" type="button" id="msSave" ${MS.dirty ? '' : 'disabled'}>Save</button>
      </div>
    </div>
    <div class="tbl-tools">
      <button class="btn" type="button" id="msAdd">+ Add row</button>
      ${def.dated ? `<span class="ms-copy">Copy month <select id="msCopyFrom">${months.map(m => `<option value="${m}">${esc(fmtMonth(m))}</option>`).join('')}</select>
        to <input type="month" id="msCopyTo"> <button class="btn" type="button" id="msCopy">Copy</button></span>` : ''}
      ${hasProc ? `<select id="msProc"><option value="">All processes</option>${procs.map(p => `<option ${p === MS.proc ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>` : ''}
      <input id="msSearch" class="grow" placeholder="Search" value="${esc(MS.search)}">
    </div>
    <div id="msErrors"></div>
    <div class="tbl-wrap ms-grid"><table>
      <thead><tr><th class="num">#</th>${def.cols.map(c => `<th title="${esc(c.help || '')}">${esc(c.name)}${c.req ? ' <span class="req">*</span>' : ''}</th>`).join('')}<th></th></tr></thead>
      <tbody id="msRows"></tbody>
    </table></div>
    <div class="pager" id="msPager"></div>
    ${datalists(def)}`;
  $('msAdd').onclick = addRow;
  $('msSave').onclick = saveMaster;
  $('msCancel').onclick = () => { if (confirm('Undo all changes since the last save?')) { MS.dirty = false; openMaster(MS.key).catch(err => say(err.message, 'error')); } };
  $('msExcel').onclick = () => downloadMaster().catch(err => say(err.message, 'error'));
  $('msSearch').oninput = e => { MS.search = e.target.value; MS.page = 1; drawRows(); };
  if (hasProc) $('msProc').onchange = e => { MS.proc = e.target.value; MS.page = 1; drawRows(); };
  if (def.dated) $('msCopy').onclick = copyMonth;
  drawRows();
  drawErrors();
}

// Suggestions for text columns: every value already used in that column (and units from the Units list)
function datalists(def) {
  return def.cols.filter(c => c.type === 'text').map((c, i) => {
    const vals = [...new Set(MS.rows.map(r => r[c.name]).filter(v => v != null && v !== ''))].sort().slice(0, 300);
    return `<datalist id="msdl${i}">${vals.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  }).join('');
}

function visibleRows() {
  const q = MS.search.trim().toLowerCase();
  return MS.rows.map((r, i) => ({ r, n: i + 1 })).filter(({ r }) =>
    (!MS.proc || r.Process === MS.proc) &&
    (!q || msDef().cols.some(c => String(r[c.name] ?? '').toLowerCase().includes(q))));
}

function cellHtml(c, r, ci) {
  const v = r[c.name];
  const bad = MS.errors[r._id] && MS.errors[r._id][c.name];
  const attr = `data-c="${esc(c.name)}" class="${bad ? 'bad' : ''}" ${bad ? `title="${esc(bad)}"` : ''} aria-label="${esc(c.name)}"`;
  if (c.type === 'yesno' || c.type === 'choice') {
    const opts = c.type === 'yesno' ? ['Yes', 'No'] : c.options;
    return `<select ${attr}><option value=""></option>${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  }
  if (c.type === 'date') return `<input type="date" ${attr} value="${esc(v || '')}">`;
  if (c.type === 'month') return `<input type="month" ${attr} value="${esc(String(v || '').slice(0, 7))}">`;
  if (c.type === 'number') {
    const ph = c.name === 'Equ. Factor' && Number(r['Target Pcs / Tailor / Day']) > 0 ? (Math.round(MS.base / Number(r['Target Pcs / Tailor / Day']) * 100) / 100).toString() : '';
    return `<input inputmode="decimal" ${attr} value="${v == null ? '' : esc(v)}" ${ph ? `placeholder="${ph} (auto)"` : ''}>`;
  }
  const w = MS.widths[c.name] || 12;
  return `<input ${attr} style="min-width:calc(${w}ch + 18px)" value="${esc(v ?? '')}" list="msdl${msDef().cols.filter(x => x.type === 'text').indexOf(c)}" maxlength="300">`;
}

function drawRows() {
  const def = msDef();
  const vis = visibleRows();
  const pages = Math.max(1, Math.ceil(vis.length / MS_PAGE));
  if (MS.page > pages) MS.page = pages;
  const slice = vis.slice((MS.page - 1) * MS_PAGE, MS.page * MS_PAGE);
  MS.widths = Object.fromEntries(def.cols.filter(c => c.type === 'text').map(c => [c.name, Math.min(32, Math.max(10, c.name.length + 2, ...MS.rows.map(r => String(r[c.name] ?? '').length + 2)))]));
  $('msRows').innerHTML = slice.map(({ r, n }) => `<tr data-id="${r._id}" class="${r._new ? 'new' : ''}"><td class="num note">${n}</td>
    ${def.cols.map((c, ci) => `<td>${cellHtml(c, r, ci)}</td>`).join('')}
    <td class="ms-row-act"><button type="button" class="btn small" data-dup title="Copy this row">Copy</button>
      <button type="button" class="btn small danger" data-del title="Delete this row">Delete</button></td></tr>`).join('')
    || `<tr><td colspan="${def.cols.length + 2}" class="empty">${MS.rows.length ? 'No rows match.' : 'No rows yet. Use “+ Add row”.'}</td></tr>`;
  msPager(vis.length);
  $('msRows').querySelectorAll('tr[data-id]').forEach(tr => {
    const row = MS.rows.find(r => r._id === Number(tr.dataset.id));
    tr.querySelectorAll('[data-c]').forEach(el => {
      el.onchange = () => {
        const c = def.cols.find(x => x.name === el.dataset.c);
        let v = el.value.trim();
        if (c.type === 'month' && v) v += '-01';
        if (c.type === 'number' && v !== '' && isFinite(Number(v.replace(/,/g, '')))) v = Number(v.replace(/,/g, ''));
        if (v === '') delete row[c.name]; else row[c.name] = v;
        if (MS.errors[row._id]) { delete MS.errors[row._id][c.name]; el.classList.remove('bad'); el.removeAttribute('title'); }
        if (c.name === 'Target Pcs / Tailor / Day') drawRows();
        markDirty();
      };
    });
    tr.querySelector('[data-del]').onclick = () => { MS.rows = MS.rows.filter(r => r !== row); markDirty(); drawRows(); };
    tr.querySelector('[data-dup]').onclick = () => {
      const copy = { ...row, _id: ++msSeq, _new: true };
      MS.rows.splice(MS.rows.indexOf(row) + 1, 0, copy); markDirty(); drawRows();
    };
  });
}

function msPager(total) {
  const el = $('msPager'), pages = Math.max(1, Math.ceil(total / MS_PAGE)), page = MS.page;
  if (total <= MS_PAGE) { el.innerHTML = total ? `<span class="info">Total ${fmtNum(total)}</span>` : ''; return; }
  let nums = '';
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums += `<button data-p="${p}" class="${p === page ? 'on' : ''}">${p}</button>`;
    else if (Math.abs(p - page) === 2) nums += '<span>…</span>';
  }
  el.innerHTML = `<span class="info">Page ${page} of ${pages} · Total ${fmtNum(total)}</span>
    <button data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>Previous</button>${nums}
    <button data-p="${page + 1}" ${page === pages ? 'disabled' : ''}>Next</button>`;
  el.querySelectorAll('button[data-p]').forEach(b => b.onclick = () => { MS.page = Number(b.dataset.p); drawRows(); });
}

function markDirty() {
  if (!MS.dirty) { MS.dirty = true; window.addEventListener('beforeunload', stopLeave); }
  $('msDirty').classList.remove('hidden');
  $('msSave').disabled = false; $('msCancel').disabled = false;
  const tab = $('msTabs').querySelector('.on small'); if (tab) tab.textContent = fmtNum(MS.rows.length);
}

function addRow() {
  const def = msDef();
  const r = { _id: ++msSeq, _new: true };
  for (const c of def.cols) if (c.type === 'yesno' && c.name === 'Active') r[c.name] = 'Yes';
  if (MS.proc && def.cols.some(c => c.name === 'Process')) r.Process = MS.proc;
  MS.rows.unshift(r);
  MS.search = ''; MS.page = 1; $('msSearch').value = '';
  markDirty(); drawRows();
  const first = $('msRows').querySelector('tr [data-c]'); if (first) first.focus();
}

// Copies every row of one month to another month (for targets and working days)
function copyMonth() {
  const def = msDef(), from = $('msCopyFrom').value, to = $('msCopyTo').value;
  if (!from || !to) return say('Choose the month to copy from and the month to copy to.', 'error');
  if (from === to) return say('Choose two different months.', 'error');
  const src = MS.rows.filter(r => String(r[def.dated] || '').slice(0, 7) === from);
  const key = r => def.unique.map(u => u === def.dated ? '' : String(r[u] ?? '').toLowerCase()).join('|');
  const have = new Set(MS.rows.filter(r => String(r[def.dated] || '').slice(0, 7) === to).map(key));
  const add = src.filter(r => !have.has(key(r))).map(r => ({ ...r, [def.dated]: to + '-01', _id: ++msSeq, _new: true }));
  if (!add.length) return say(`${fmtMonth(to)} already has all the rows of ${fmtMonth(from)}.`, 'error');
  MS.rows.unshift(...add);
  MS.search = to; MS.page = 1;
  markDirty(); drawMasters();
  say(`${add.length} rows copied to ${fmtMonth(to)}. Change the numbers if needed, then press Save.`, 'ok');
}

// Same checks as the Worker, so mistakes show on the right cell before sending
function checkRows() {
  const def = msDef(), errs = {}, list = [], seen = new Map();
  const put = (r, n, col, msg) => { (errs[r._id] = errs[r._id] || {})[col] = msg; list.push(`Row ${n}: ${msg}`); };
  MS.rows.forEach((r, i) => {
    const n = i + 1;
    for (const c of def.cols) {
      const v = r[c.name];
      if (v == null || v === '') { if (c.req) put(r, n, c.name, `"${c.name}" is required.`); continue; }
      if (c.type === 'number') {
        const x = Number(v);
        if (!isFinite(x)) put(r, n, c.name, `"${c.name}" must be a number.`);
        else if (c.min != null && x < c.min) put(r, n, c.name, `"${c.name}" must be at least ${c.min}.`);
        else if (c.max != null && x > c.max) put(r, n, c.name, `"${c.name}" must be at most ${c.max}.`);
      }
      if (c.pattern && !new RegExp(c.pattern).test(String(v))) put(r, n, c.name, `"${c.name}" should look like ${c.help || c.pattern}.`);
    }
    if (r['Effective From'] && r['Effective To'] && r['Effective To'] < r['Effective From']) put(r, n, 'Effective To', '"Effective To" is before "Effective From".');
    const k = def.unique.map(u => String(r[u] ?? '').toLowerCase()).join('|');
    if (seen.has(k)) put(r, n, def.unique[def.unique.length - 1], `same ${def.unique.join(' + ')} as row ${seen.get(k)}.`);
    else seen.set(k, n);
  });
  return { errs, list };
}

function drawErrors(list) {
  const el = $('msErrors'); if (!el) return;
  el.innerHTML = list && list.length ? `<div class="ms-errors"><b>Please correct these rows (row numbers are in the # column):</b><ul>${list.slice(0, 20).map(e => `<li>${esc(e)}</li>`).join('')}</ul>${list.length > 20 ? `<p class="note small">…and ${list.length - 20} more.</p>` : ''}</div>` : '';
}

async function saveMaster() {
  const { errs, list } = checkRows();
  MS.errors = errs;
  if (list.length) { drawRows(); drawErrors(list); say('Some rows need correcting before saving.', 'error'); return; }
  const btn = $('msSave'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const rows = MS.rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_'))));
    const res = await fetch(API + '/api/masters/save', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store(TOKEN_KEY) },
      body: JSON.stringify({ key: MS.key, version: MS.version, rows }) });
    const d = await res.json().catch(() => ({ ok: false, error: 'Unexpected reply from the server.' }));
    if (res.status === 401) { endSession(d.error); return; }
    if (!d.ok) { drawErrors(d.errors); throw new Error(d.error || 'Could not save.'); }
    window.removeEventListener('beforeunload', stopLeave);
    MS.dirty = false;
    const def = msDef(); def.rows = d.rows; def.lastUpdated = d.version; def.updatedBy = state.user.loginId;
    await openMaster(MS.key);
    say(`${def.label} saved: ${fmtNum(d.rows)} rows. Reports use the new list straight away.`, 'ok');
  } catch (err) {
    say(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Save';
  }
}

async function downloadMaster() {
  const X = await ensureXLSX(), def = msDef();
  const data = MS.rows.map(r => Object.fromEntries(def.cols.map(c => [c.name, r[c.name] ?? ''])));
  const ws = X.utils.json_to_sheet(data, { header: def.cols.map(c => c.name) });
  ws['!cols'] = def.cols.map(c => ({ wch: Math.max(10, c.name.length + 2) }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, def.label.slice(0, 31));
  X.writeFile(wb, `${def.label} - ${new Date().toISOString().slice(0, 10)}.xlsx`);
}
