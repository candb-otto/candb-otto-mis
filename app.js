// MIS Master System - front end (Phase 1a: login, change password, users)
// No keys or data are stored here. All checks happen in the Worker.

const API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:8787'
  : 'https://mis-api.candb-otto.workers.dev';

const TOKEN_KEY = 'mis.token';
const SIDEBAR_KEY = 'mis.sidebarOpen';
const PAGE_SIZE = 10;

const state = { user: null, users: [], userPage: 1, activity: [], activityPage: 1 };
const $ = id => document.getElementById(id);

// ---------- storage (wrapped: may be blocked in private windows) ----------
function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); }
  catch { return null; }
}

// ---------- API calls ----------
async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = store(TOKEN_KEY);
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(API + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the server. Check your internet connection and try again.');
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Unexpected reply from the server.' }));
  if (res.status === 401 && path !== '/api/login') { endSession(data.error); throw new Error(data.error); }
  if (!res.ok || !data.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

// ---------- messages ----------
// Shows a message in the box that belongs to whatever is on screen.
function say(msg, kind) {
  const target = !state.user ? 'authStatus' : state.user.mustChange ? 'firstPwStatus' : 'status';
  for (const id of ['authStatus', 'firstPwStatus', 'status']) {
    const el = $(id);
    const show = id === target && msg;
    el.textContent = show ? msg : '';
    el.className = (id === 'status' ? '' : 'auth-status ') + 'status' + (show && kind ? ' ' + kind : '');
  }
}

// ---------- routing ----------
const TITLES = { password: 'Change Password', home: 'Home', upload: 'Upload Data', users: 'Users' };
const ADMIN_ROUTES = ['users', 'upload'];

function go(route) { if (location.hash !== '#/' + route) location.hash = '#/' + route; else render(); }

function currentRoute() { return (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0]; }

function render() {
  const u = state.user;
  const authMode = !u || u.mustChange;
  $('authScreen').classList.toggle('hidden', !authMode);
  $('appShell').classList.toggle('hidden', authMode);
  $('loginForm').classList.toggle('hidden', !!u);
  $('firstPwForm').classList.toggle('hidden', !(u && u.mustChange));
  document.title = authMode ? 'Log in · MIS Master System' : 'MIS Master System';
  if (authMode) { setTimeout(() => (u ? $('fpCurrent') : $('loginId')).focus(), 0); return; }

  let route = currentRoute();
  if (!TITLES[route]) route = 'home';
  if (ADMIN_ROUTES.includes(route) && u.role !== 'admin') route = 'home';

  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + route));
  document.querySelectorAll('#sidebar [data-route]').forEach(b => {
    b.classList.toggle('active', b.dataset.route === route);
    if (b.dataset.role) b.classList.toggle('hidden', u.role !== b.dataset.role);
  });
  $('pageTitle').textContent = TITLES[route];
  document.title = TITLES[route] + ' · MIS Master System';
  $('userName').textContent = u.name;
  $('userLogin').textContent = u.loginId;
  $('avatar').textContent = initials(u.name);

  if (route === 'home') $('homeName').textContent = u.name;
  if (route === 'users') loadUsers();
  if (route === 'upload') loadUploadPage();
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// ---------- session ----------
function endSession(msg, kind = 'error') {
  store(TOKEN_KEY, null);
  state.user = null;
  if (location.hash) history.replaceState(null, '', location.pathname);
  render();
  if (msg) say(msg, kind);
}

async function boot() {
  if (store(TOKEN_KEY)) {
    try { state.user = (await api('/api/me')).user; } catch { state.user = null; }
  }
  render();
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const loginId = $('loginId').value.trim(), password = $('loginPw').value;
  if (!loginId || !password) return say('Enter your login ID and password.', 'error');
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = 'Logging in…';
  say('');
  try {
    const data = await api('/api/login', { loginId, password });
    store(TOKEN_KEY, data.token);
    state.user = data.user;
    $('loginForm').reset();
    if (!state.user.mustChange && location.hash !== '#/home') history.replaceState(null, '', '#/home');
    render();
  } catch (err) {
    say(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
});

// Both password forms (first login, and the in-app page) work the same way.
for (const form of [$('firstPwForm'), $('pwForm')]) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    say('');
    const f = form.elements;
    if (!f.current.value || !f.next.value) return say('Fill in all the password boxes.', 'error');
    if (f.next.value !== f.next2.value) return say('The two new passwords do not match.', 'error');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('/api/change-password', { currentPassword: f.current.value, newPassword: f.next.value });
      state.user = data.user;
      form.reset();
      history.replaceState(null, '', '#/home');
      render();
      say('Password saved.', 'ok');
    } catch (err) {
      say(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => {
  try { await api('/api/logout', {}); } catch { /* already logged out */ }
  endSession('You have logged out.', 'ok');
}));

document.querySelectorAll('.show-pw').forEach(b => b.addEventListener('click', () => {
  const input = $(b.dataset.for);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.textContent = show ? 'Hide' : 'Show';
  input.focus();
}));

// ---------- sidebar ----------
const sidebar = $('sidebar');
if (store(SIDEBAR_KEY) === '1') sidebar.classList.remove('collapsed');
$('toggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  store(SIDEBAR_KEY, sidebar.classList.contains('collapsed') ? '0' : '1');
});
document.querySelectorAll('#sidebar [data-route]').forEach(b => b.addEventListener('click', () => {
  say('');
  go(b.dataset.route);
  if (window.innerWidth <= 700) sidebar.classList.add('collapsed');
}));

// ---------- users page ----------
async function loadUsers() {
  try {
    const [u, a] = await Promise.all([api('/api/users'), api('/api/activity')]);
    state.users = u.users;
    state.activity = a.activity;
    drawUsers();
    drawActivity();
  } catch (err) { say(err.message, 'error'); }
}

function drawUsers() {
  const q = $('userSearch').value.trim().toLowerCase();
  const rows = state.users.filter(u => !q || u.name.toLowerCase().includes(q) || u.login_id.toLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.userPage = Math.min(state.userPage, pages);
  const slice = rows.slice((state.userPage - 1) * PAGE_SIZE, state.userPage * PAGE_SIZE);
  $('userCount').textContent = `${fmtNum(rows.length)} user${rows.length === 1 ? '' : 's'}`;
  $('userRows').innerHTML = slice.length ? slice.map(u => {
    const status = !u.active ? '<span class="pill muted">Switched off</span>'
      : u.locked ? '<span class="pill bad">Locked</span>'
      : u.must_change ? '<span class="pill warn">Temp password</span>'
      : '<span class="pill good">Active</span>';
    const self = state.user && u.id === state.user.id;
    return `<tr>
      <td>${esc(u.name)}${self ? ' <span class="note">(you)</span>' : ''}</td>
      <td>${esc(u.login_id)}</td>
      <td>${esc(cap(u.role))}</td>
      <td>${status}</td>
      <td>${u.last_login ? fmtDate(u.last_login) : '<span class="note">Never</span>'}</td>
      <td><span class="actions">
        <button class="btn small" data-act="reset" data-id="${u.id}">Reset password</button>
        ${self ? '' : `<button class="btn small" data-act="${u.active ? 'off' : 'on'}" data-id="${u.id}">${u.active ? 'Switch off' : 'Switch on'}</button>`}
      </span></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No users found.</td></tr>';
  pager('userPager', rows.length, state.userPage, p => { state.userPage = p; drawUsers(); });
}

function drawActivity() {
  const rows = state.activity;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.activityPage = Math.min(state.activityPage, pages);
  const slice = rows.slice((state.activityPage - 1) * PAGE_SIZE, state.activityPage * PAGE_SIZE);
  $('activityRows').innerHTML = slice.length ? slice.map(r => `<tr>
    <td>${fmtDate(r.at)}</td><td>${esc(r.user_login || '')}</td><td>${esc(ACTIONS[r.action] || r.action)}</td><td>${esc(r.detail || '')}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">No activity yet.</td></tr>';
  pager('activityPager', rows.length, state.activityPage, p => { state.activityPage = p; drawActivity(); });
}

const ACTIONS = {
  login: 'Logged in', logout: 'Logged out', login_failed: 'Login failed', change_password: 'Changed password',
  user_created: 'Added user', password_reset: 'Reset password', user_activated: 'Switched on user', user_deactivated: 'Switched off user',
  upload: 'Uploaded data', upload_rejected: 'Upload rejected',
};

$('userSearch').addEventListener('input', () => { state.userPage = 1; drawUsers(); });

$('userRows').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const u = state.users.find(x => x.id === Number(b.dataset.id));
  if (!u) return;
  say('');
  try {
    if (b.dataset.act === 'reset') {
      if (!confirm(`Reset the password for ${u.name}? They will need the new temporary password to log in.`)) return;
      const d = await api('/api/users/reset-password', { id: u.id });
      showTemp(u.name, d.loginId, d.tempPassword);
    } else {
      const on = b.dataset.act === 'on';
      if (!on && !confirm(`Switch off ${u.name}? They will not be able to log in until switched on again.`)) return;
      await api('/api/users/set-active', { id: u.id, active: on });
      say(`${u.name} ${on ? 'switched on' : 'switched off'}.`, 'ok');
    }
    loadUsers();
  } catch (err) { say(err.message, 'error'); }
});

$('addUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  say('');
  try {
    const name = $('newName').value.trim();
    const d = await api('/api/users', { name, loginId: $('newLogin').value.trim() });
    $('addUserForm').reset();
    showTemp(name, d.loginId, d.tempPassword);
    loadUsers();
  } catch (err) { say(err.message, 'error'); }
});

function showTemp(name, loginId, pw) {
  const box = $('tempBox');
  box.innerHTML = `<b>${esc(name)}</b> — Login ID <code>${esc(loginId)}</code> · Temporary password <code>${esc(pw)}</code>
    <div class="note small">Give these to ${esc(name)}. They will be asked to choose their own password at first login.
    This password is shown only once. <button class="link" type="button" id="tempHide">Hide</button></div>`;
  box.classList.remove('hidden');
  $('tempHide').onclick = () => { box.classList.add('hidden'); box.innerHTML = ''; };
}

// ---------- upload page ----------
const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const up = { config: null, file: null, sheets: [], history: [], historyPage: 1, busy: false };

async function loadUploadPage() {
  try {
    if (!up.config) up.config = await api('/api/upload/config');
    const [s, h] = await Promise.all([api('/api/data-status'), api('/api/uploads')]);
    drawDataStatus(s.reports);
    up.history = h.uploads;
    drawHistory();
  } catch (err) { say(err.message, 'error'); }
}

function drawDataStatus(reports) {
  const loaded = reports.filter(r => r.rows);
  $('statusNote').textContent = loaded.length ? `${loaded.length} of ${reports.length} reports have data` : 'No data uploaded yet';
  $('statusRows').innerHTML = reports.map(r => `<tr class="${r.enabled ? '' : 'muted-row'}">
    <td>${esc(r.label)}</td><td>${esc(r.sheet)}</td>
    <td class="num">${r.rows ? fmtNum(r.rows) : '–'}</td>
    <td>${r.firstMonth ? `${fmtMonth(r.firstMonth)} – ${fmtMonth(r.lastMonth)}` : (r.enabled ? '<span class="note">No data yet</span>' : `<span class="note">${esc(r.note || 'Not loaded')}</span>`)}</td>
    <td>${r.lastUpdated ? fmtDate(r.lastUpdated) : '–'}</td><td>${esc(r.updatedBy || '')}</td></tr>`).join('');
}

function drawHistory() {
  const rows = up.history;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  up.historyPage = Math.min(up.historyPage, pages);
  const slice = rows.slice((up.historyPage - 1) * PAGE_SIZE, up.historyPage * PAGE_SIZE);
  const pill = { done: '<span class="pill good">Done</span>', loading: '<span class="pill warn">Loading</span>',
    failed: '<span class="pill bad">Failed</span>', rejected: '<span class="pill bad">Rejected</span>' };
  $('historyRows').innerHTML = slice.length ? slice.map(u => {
    let detail = '';
    if (u.status === 'done' && u.result) {
      const total = u.result.reduce((a, r) => a + r.rows, 0);
      detail = `${u.result.length} sheets · ${fmtNum(total)} rows`;
    } else if (u.error) {
      let e = u.error;
      try { e = JSON.parse(u.error).map(r => `${r.label}: ${r.errors.join(' ')}`).join(' | '); } catch { /* plain text */ }
      detail = esc(e.length > 160 ? e.slice(0, 160) + '…' : e);
    }
    return `<tr><td>${fmtDate(u.startedAt)}</td><td>${esc(u.fileName)}</td><td>${esc(u.by)}</td><td>${pill[u.status] || esc(u.status)}</td><td class="wrap">${detail}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No uploads yet.</td></tr>';
  pager('historyPager', rows.length, up.historyPage, p => { up.historyPage = p; drawHistory(); });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the Excel reader. Check your internet connection.'));
    document.head.appendChild(s);
  });
}

async function ensureXLSX() { if (!window.XLSX) await loadScript(XLSX_URL); return window.XLSX; }

// Reads one sheet: headers by name, rows as {header: value}, dates as YYYY-MM-DD.
function parseSheet(X, ws, cfg) {
  const out = { headers: [], rows: [], months: new Set(), noMonth: 0, errors: [], warnings: [] };
  if (!ws['!ref']) { out.errors.push('The sheet is empty.'); return out; }
  const R = X.utils.decode_range(ws['!ref']);
  const at = (r, c) => ws[X.utils.encode_cell({ r, c })];
  const text = cell => (cell && cell.v != null ? String(cell.v).trim() : '');
  const ymd = n => { const d = X.SSF.parse_date_code(n); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; };
  const val = cell => {
    if (!cell || cell.t === 'z' || cell.t === 'e') return null;
    if (cell.t === 'b') return cell.v;
    if (cell.t === 'n') return cell.z && X.SSF.is_date(cell.z) ? ymd(cell.v) : cell.v;
    if (cell.t === 'd') { const d = cell.v; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    const s = String(cell.v).trim();
    return s === '' ? null : s;
  };

  const hr = (cfg.headerRow || 1) - 1;
  // Header names. When a sheet repeats a name under different group headings (Sew OT), the group is added in front.
  let group = '';
  const cols = [];
  for (let c = R.s.c; c <= R.e.c; c++) {
    if (cfg.groupRow) { const g = text(at(cfg.groupRow - 1, c)); if (g) group = g; }
    cols.push({ c, name: text(at(hr, c)), group });
  }
  const count = {};
  cols.forEach(k => { if (k.name) count[k.name.toLowerCase()] = (count[k.name.toLowerCase()] || 0) + 1; });
  if (cfg.groupRow) cols.forEach(k => { if (k.name && count[k.name.toLowerCase()] > 1 && k.group) k.name = `${k.group} | ${k.name}`; });

  const named = cols.filter(k => k.name);
  const blank = cols.filter(k => !k.name);
  out.headers = named.map(k => k.name);
  const seen = {};
  for (const k of named) {
    const key = k.name.toLowerCase(), col = X.utils.encode_col(k.c);
    if (seen[key]) out.errors.push(`Two columns are named "${k.name}" (columns ${seen[key]} and ${col}). Please rename one of them in the Excel file.`);
    else seen[key] = col;
  }
  for (const need of [cfg.monthCol, cfg.dateCol]) if (!out.headers.includes(need)) out.errors.push(`Column "${need}" is missing.`);
  if (out.errors.length) return out;

  const blankHits = {};
  for (let r = hr + 1; r <= R.e.r; r++) {
    const obj = {};
    let any = false;
    for (const k of named) { const v = val(at(r, k.c)); if (v !== null) { obj[k.name] = v; any = true; } }
    for (const k of blank) { if (val(at(r, k.c)) !== null) blankHits[k.c] = (blankHits[k.c] || 0) + 1; }
    if (!any) continue;
    const m = obj[cfg.monthCol];
    if (typeof m !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m)) { out.noMonth++; continue; }
    const month = m.slice(0, 7);
    const d = obj[cfg.dateCol];
    out.rows.push([month, typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, obj]);
    out.months.add(month);
  }
  for (const [c, n] of Object.entries(blankHits)) {
    out.warnings.push(`Column ${X.utils.encode_col(Number(c))} has no header; its ${fmtNum(n)} values will not be loaded.`);
  }
  if (out.noMonth) out.warnings.push(`${fmtNum(out.noMonth)} rows have no valid "${cfg.monthCol}" date and will be skipped.`);
  return out;
}

async function handleFile(file) {
  if (!file || up.busy) return;
  say('');
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return say('Please choose an Excel file (.xlsx).', 'error');
  up.file = file;
  up.sheets = [];
  $('checkArea').classList.remove('hidden');
  $('checkFile').textContent = file.name;
  $('checkInfo').textContent = 'Reading the file…';
  $('checkRows').innerHTML = '';
  $('uploadBtn').disabled = true;
  $('progress').classList.add('hidden');
  try {
    if (!up.config) up.config = await api('/api/upload/config');
    const X = await ensureXLSX();
    const wb = X.read(await file.arrayBuffer(), { type: 'array', cellNF: true, cellDates: false });
    for (const name of wb.SheetNames) {
      const key = name.trim().toLowerCase();
      const cfg = up.config.reports.find(r => r.sheet.toLowerCase() === key);
      const entry = { sheet: name, cfg, rows: [], headers: [], months: new Set(), errors: [], warnings: [], info: [] };
      up.sheets.push(entry);
      if (!cfg) { entry.skip = up.config.skipSheets[key] || 'Not a known report sheet — skipped.'; continue; }
      if (cfg.enabled === false) { entry.skip = cfg.note || 'Not loaded at the moment.'; continue; }
      Object.assign(entry, parseSheet(X, wb.Sheets[name], cfg));
    }
    const toCheck = up.sheets.filter(s => s.cfg && !s.skip && !s.errors.length);
    if (toCheck.length) {
      const res = await api('/api/upload/check', { fileName: file.name, sheets: toCheck.map(s => ({ report: s.cfg.key, headers: s.headers, rows: s.rows.length })) });
      for (const r of res.results) {
        const s = toCheck.find(x => x.cfg.key === r.report);
        s.errors.push(...r.errors);
        if (r.firstUpload) s.info.push('First upload for this report: these columns will be remembered.');
        else if (r.newColumns.length) s.info.push(`New column${r.newColumns.length > 1 ? 's' : ''} will be added: ${r.newColumns.join(', ')}`);
      }
    }
    drawCheck();
  } catch (err) {
    $('checkInfo').textContent = '';
    say(err.message || 'Could not read the file.', 'error');
  }
}

function drawCheck() {
  const loadable = up.sheets.filter(s => s.cfg && !s.skip);
  const bad = loadable.filter(s => s.errors.length);
  const totalRows = loadable.reduce((a, s) => a + s.rows.length, 0);
  $('checkInfo').textContent = `${up.sheets.length} sheets found · ${loadable.length} to load · ${fmtNum(totalRows)} rows` +
    (bad.length ? ` · ${bad.length} with problems — fix them in Excel and choose the file again` : ' · ready to upload');
  $('uploadBtn').disabled = !!bad.length || !loadable.length;
  $('checkRows').innerHTML = up.sheets.map(s => {
    const months = [...s.months].sort();
    let result;
    if (s.skip) result = `<span class="pill muted">Skipped</span><ul class="msgs"><li class="info">${esc(s.skip)}</li></ul>`;
    else {
      const items = [...s.errors.map(e => `<li class="err">${esc(e)}</li>`), ...s.warnings.map(w => `<li class="warn">${esc(w)}</li>`), ...s.info.map(i => `<li class="info">${esc(i)}</li>`)];
      result = (s.errors.length ? '<span class="pill bad">Problem</span>' : s.warnings.length ? '<span class="pill warn">Ready, with notes</span>' : '<span class="pill good">Ready</span>') +
        (items.length ? `<ul class="msgs">${items.join('')}</ul>` : '');
    }
    return `<tr class="${s.skip ? 'muted-row' : ''}"><td>${esc(s.sheet)}</td><td>${s.cfg ? esc(s.cfg.label) : '–'}</td>
      <td class="num">${s.skip ? '–' : fmtNum(s.rows.length)}</td>
      <td>${months.length ? `${fmtMonth(months[0])} – ${fmtMonth(months.at(-1))} <span class="note">(${months.length})</span>` : '–'}</td><td>${result}</td></tr>`;
  }).join('');
}

async function sendText(path, text) {
  const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer ' + store(TOKEN_KEY) }, body: text })
    .catch(() => { throw new Error('Lost connection to the server during upload.'); });
  const data = await res.json().catch(() => ({ ok: false, error: 'Unexpected reply from the server.' }));
  if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}

function progress(done, total, label) {
  $('progress').classList.remove('hidden');
  const pct = total ? Math.round(done / total * 100) : 0;
  $('progressBar').style.width = pct + '%';
  $('progressText').textContent = `${label} ${pct}% (${fmtNum(done)} of ${fmtNum(total)} rows)`;
}

async function startUpload() {
  const sheets = up.sheets.filter(s => s.cfg && !s.skip && !s.errors.length && s.rows.length);
  if (!sheets.length || up.busy) return;
  const total = sheets.reduce((a, s) => a + s.rows.length, 0);
  if (!confirm(`Upload ${fmtNum(total)} rows from ${sheets.length} sheets?\n\nFor each sheet, the months in this file will replace the same months already in the system. Other months stay as they are.`)) return;
  up.busy = true;
  $('uploadBtn').disabled = true; $('clearFileBtn').disabled = true;
  window.addEventListener('beforeunload', stopLeave);
  say('');
  let uploadId = null;
  try {
    const start = await api('/api/upload/start', { fileName: up.file.name, sheets: sheets.map(s => ({ report: s.cfg.key, headers: s.headers, rows: s.rows.length })) });
    if (!start.canUpload) {
      start.results.forEach(r => { const s = sheets.find(x => x.cfg.key === r.report); if (s) s.errors = r.errors; });
      drawCheck();
      throw new Error('The file has problems; nothing was uploaded.');
    }
    uploadId = start.uploadId;
    const max = up.config.maxChunkBytes;
    let done = 0;
    progress(0, total, 'Uploading…');
    for (const s of sheets) {
      let parts = [], size = 2;
      const flush = async () => {
        if (!parts.length) return;
        await sendText(`/api/upload/rows?upload=${uploadId}&report=${encodeURIComponent(s.cfg.key)}`, '[' + parts.join(',') + ']');
        done += parts.length; parts = []; size = 2;
        progress(done, total, `Uploading ${s.cfg.label}…`);
      };
      for (const row of s.rows) {
        const j = JSON.stringify(row);
        if (size + j.length + 1 > max) await flush();
        parts.push(j); size += j.length + 1;
      }
      await flush();
    }
    progress(total, total, 'Saving…');
    const fin = await api('/api/upload/finish', { uploadId });
    const rows = fin.summary.reduce((a, r) => a + r.rows, 0);
    $('progressText').textContent = `Done: ${fmtNum(rows)} rows from ${fin.summary.length} sheets saved.`;
    say(`Upload complete: ${fmtNum(rows)} rows from ${fin.summary.length} sheets.`, 'ok');
    uploadId = null;
    up.file = null; up.sheets = [];
    $('fileInput').value = '';
    $('checkArea').classList.add('hidden');
  } catch (err) {
    if (uploadId) await api('/api/upload/cancel', { uploadId, reason: err.message }).catch(() => {});
    $('progress').classList.add('hidden');
    say(err.message + (uploadId ? ' Nothing was changed.' : ''), 'error');
  } finally {
    up.busy = false;
    $('clearFileBtn').disabled = false;
    window.removeEventListener('beforeunload', stopLeave);
    loadUploadPage();
  }
}

function stopLeave(e) { e.preventDefault(); e.returnValue = ''; }

function clearFile() {
  if (up.busy) return;
  up.file = null; up.sheets = [];
  $('fileInput').value = '';
  $('checkArea').classList.add('hidden');
  say('');
}

$('fileInput').addEventListener('change', e => handleFile(e.target.files[0]));
$('uploadBtn').addEventListener('click', startUpload);
$('clearFileBtn').addEventListener('click', () => { clearFile(); $('fileInput').click(); });
const dz = $('dropzone');
dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));

// ---------- shared helpers ----------
function pager(id, total, page, onPage) {
  const el = $(id);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) { el.innerHTML = total ? `<span class="info">Total ${fmtNum(total)}</span>` : ''; return; }
  let nums = '';
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums += `<button data-p="${p}" class="${p === page ? 'on' : ''}">${p}</button>`;
    else if (Math.abs(p - page) === 2) nums += '<span>…</span>';
  }
  el.innerHTML = `<span class="info">Page ${page} of ${pages} · Total ${fmtNum(total)}</span>
    <button data-p="${page - 1}" ${page === 1 ? 'disabled' : ''}>Previous</button>${nums}
    <button data-p="${page + 1}" ${page === pages ? 'disabled' : ''}>Next</button>`;
  el.querySelectorAll('button[data-p]').forEach(b => b.onclick = () => onPage(Number(b.dataset.p)));
}

function fmtNum(n) { return Number(n).toLocaleString('en-IN'); }
function fmtDate(s) {
  const iso = /T/.test(s) ? s : s.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  if (isNaN(d)) return esc(s);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMonth(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return esc(ym);
  return new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short', year: 'numeric' });
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

window.addEventListener('hashchange', render);
boot();
