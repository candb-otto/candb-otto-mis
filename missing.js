// MIS Master System - Undefined Masters page: values used in the daily data that are not in a master list.
// "Add to master" opens the list on the Masters page with the new row(s) filled in (not saved until Save).

const UM = { data: null, open: {}, busy: false };
const UM_SHOW = 25;

async function loadMissing(force) {
  if (UM.busy) return;
  if (UM.data && !force) { drawMissing(); return; }
  UM.busy = true;
  $('umBody').innerHTML = '<p class="note">Checking the data against the masters…</p>';
  try {
    UM.data = await api('/api/masters/undefined');
    drawMissing();
  } catch (err) { $('umBody').innerHTML = ''; say(err.message, 'error'); }
  finally { UM.busy = false; }
}

function umDate(d) { return d ? fmtDate(d).replace(/,.*$/, '') : ''; }

function drawMissing() {
  const d = UM.data;
  const chips = d.groups.map(g => `<button type="button" class="um-chip ${g.items.length ? 'bad' : 'ok'}" data-jump="um-${g.key}">${esc(g.label)} <b>${g.items.length ? fmtNum(g.items.length) : '✓'}</b></button>`).join('');
  $('umBody').innerHTML = `
    <div class="um-head">
      <p class="note">${d.total ? `<b>${fmtNum(d.total)}</b> values in the data have no matching row in a master list. Reports still show them, but with a guessed name, no target or no factor.` : 'Every value in the data has a matching master row.'}
        <br><span class="small">Checked ${esc(fmtDate(d.checkedAt))}</span></p>
      <button class="btn" type="button" id="umRefresh">Check again</button>
    </div>
    <div class="um-chips">${chips}</div>
    ${d.groups.map(groupHtml).join('')}
    ${(d.pending || []).map(p => `<p class="note small">${esc(p)}</p>`).join('')}`;
  $('umRefresh').onclick = () => loadMissing(true);
  $('umBody').querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const g = d.groups.find(x => x.key === b.dataset.g);
    const rows = b.dataset.add === 'all' ? g.items.map(i => i.prefill) : [g.items[Number(b.dataset.add)].prefill];
    sendToMaster(g.key, rows);
  });
  $('umBody').querySelectorAll('[data-jump]').forEach(b => b.onclick = () => { const t = document.getElementById(b.dataset.jump); if (t) t.scrollIntoView({ block: 'start' }); });
  $('umBody').querySelectorAll('[data-view]').forEach(b => b.onclick = () => viewRows(b).catch(err => say(err.message, 'error')));
  $('umBody').querySelectorAll('[data-more]').forEach(b => b.onclick = () => { UM.open[b.dataset.more] = true; drawMissing(); });
}

function groupHtml(g) {
  const head = `<div class="um-title" id="um-${g.key}"><h2>${esc(g.label)}</h2>
    <span class="note small">${g.items.length ? `${fmtNum(g.items.length)} missing` : 'All defined'}${g.note ? ' · ' + esc(g.note) : ''}</span>
    ${g.items.length > 1 ? `<button class="btn small" type="button" data-g="${g.key}" data-add="all">Add all ${fmtNum(g.items.length)} to ${esc(g.label)}</button>` : ''}</div>`;
  if (!g.items.length) return `<div class="card um-card ok">${head}</div>`;
  const list = UM.open[g.key] ? g.items : g.items.slice(0, UM_SHOW);
  return `<div class="card um-card">${head}
    <div class="tbl-wrap"><table>
      <thead><tr><th>Value in the data</th><th>Problem</th><th>Found in</th><th class="num">Rows</th><th class="num">Qty</th><th>First date</th><th>Last date</th><th></th></tr></thead>
      <tbody>${list.map(it => `<tr>
        <td><b>${esc(it.text)}</b></td><td>${esc(it.note)}</td><td>${esc(it.where)}</td>
        <td class="num">${fmtNum(it.rows)}</td><td class="num">${it.qty == null ? '' : fmtNum(it.qty)}</td>
        <td>${esc(umDate(it.first))}</td><td>${esc(umDate(it.last))}</td>
        <td class="um-act"><button class="btn small" type="button" data-g="${g.key}" data-view="${g.items.indexOf(it)}">View rows</button>
          <button class="btn small" type="button" data-g="${g.key}" data-add="${g.items.indexOf(it)}">Add to master</button></td></tr>
        <tr class="um-rows hidden" id="umv-${g.key}-${g.items.indexOf(it)}"><td colspan="8"></td></tr>`).join('')}</tbody>
    </table></div>
    ${list.length < g.items.length ? `<button class="btn small" type="button" data-more="${g.key}">Show all ${fmtNum(g.items.length)}</button>` : ''}</div>`;
}

function sendToMaster(key, rows) {
  try { sessionStorage.setItem('mis.prefill', JSON.stringify({ key, rows })); } catch { /* ignore */ }
  UM.data = null;   // check again when coming back
  go('masters/' + key);
}

// Home page alert for admins
async function homeMissingAlert() {
  const el = $('homeAlert');
  if (!el || state.user.role !== 'admin') return;
  try {
    const d = UM.data || await api('/api/masters/undefined');
    UM.data = d;
    el.innerHTML = d.total ? `<div class="home-alert"><span><b>${fmtNum(d.total)}</b> values in the data are not in the masters
      (${d.groups.filter(g => g.items.length).map(g => `${esc(g.label)} ${fmtNum(g.items.length)}`).join(' · ')}).</span>
      <button class="btn small" type="button" data-go-missing>Review</button></div>` : '';
    const b = el.querySelector('[data-go-missing]'); if (b) b.onclick = () => go('missing');
  } catch { el.innerHTML = ''; }
}

// Shows the data rows behind one value (up to 200 per report), newest first
async function viewRows(btn) {
  const g = UM.data.groups.find(x => x.key === btn.dataset.g), it = g.items[Number(btn.dataset.view)];
  const tr = document.getElementById(`umv-${g.key}-${btn.dataset.view}`);
  if (!tr.classList.contains('hidden')) { tr.classList.add('hidden'); btn.textContent = 'View rows'; return; }
  tr.classList.remove('hidden'); btn.textContent = 'Hide rows';
  const cell = tr.firstElementChild;
  cell.innerHTML = '<p class="note">Loading rows…</p>';
  const d = await api('/api/data/find', { looks: it.looks });
  cell.innerHTML = d.results.map(r => {
    const cols = r.columns.filter(c => r.rows.some(x => x[c] != null && x[c] !== ''));
    const months = [...new Set(r.rows.map(x => String(x.Date || x['Sent Date'] || x.Month || '').slice(0, 7)).filter(Boolean))];
    return `<div class="um-rowbox">
      <p><b>${esc(r.label)}</b> <span class="note small">(sheet ${esc(r.sheet)}) · ${r.total > r.rows.length ? `showing the latest ${fmtNum(r.rows.length)} of ${fmtNum(r.total)} rows` : `${fmtNum(r.total)} row${r.total === 1 ? '' : 's'}`}</span></p>
      <div class="tbl-wrap"><table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${r.rows.map(x => `<tr>${cols.map(c => `<td class="${typeof x[c] === 'number' ? 'num' : ''}">${x[c] == null ? '' : esc(typeof x[c] === 'number' ? fmtNum(x[c]) : x[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="note small">To correct: fix these rows in the MIS System sheet and upload it again.
        ${months.length === 1 ? `If the whole month ${esc(fmtMonth(months[0]))} is wrong (e.g. a typing mistake in the year), <a href="#/upload" data-delmonth="${esc(r.report)}|${esc(months[0])}">delete that month</a> on the Upload page after fixing the sheet.` : 'A wrong month can be removed on the Upload page (Delete a month).'}</p></div>`;
  }).join('');
  cell.querySelectorAll('[data-delmonth]').forEach(a => a.onclick = () => { try { sessionStorage.setItem('mis.delmonth', a.dataset.delmonth); } catch { /* ignore */ } });
}
