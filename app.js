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
const TITLES = { password: 'Change Password', home: 'Home', users: 'Users' };

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
  if (route === 'users' && u.role !== 'admin') route = 'home';

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
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

window.addEventListener('hashchange', render);
boot();
