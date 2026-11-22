// MIS Master System - line icons (same 24px style and set as the Item Master app, plus factory / MIS icons).
// Icons.svg(name) returns the icon. Icons are added to buttons, menus, cards and messages automatically,
// so screens do not need their own icon code. Colours come from the existing theme.
const Icons = (() => {
  const P = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.6"/>',
    truck: '<path d="M2 6h11v10H2zM13 9.5h4.5L21 13v3h-8"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
    shirt: '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3c-.6 1.8-2.2 3-4 3S8.6 4.8 8 3z"/>',
    ruler: '<path d="m3 16.5 13.5-13.5 4.5 4.5L7.5 21z"/><path d="m7 12.5 2 2M10 9.5l2 2M13 6.5l2 2"/>',
    coins: '<ellipse cx="9" cy="6.5" rx="6" ry="3"/><path d="M3 6.5v4c0 1.7 2.7 3 6 3s6-1.3 6-3v-4"/><path d="M9 16.5c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.4-2.9-5.5-3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="7.5" cy="15.5" r="4"/><path d="m10.5 12.5 9-9M16 6l3 3M14 8l2 2"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.4-.5 4.7-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    login: '<path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/><path d="M10 17l5-5-5-5M15 12H3"/>',
    logout: '<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9"/><path d="M3 4v5h5M4 13a8 8 0 0 0 14.6 4.5L21 15"/><path d="M21 20v-5h-5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M14 10l2 2-2 2"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
    filePlus: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
    scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1h-4M7 4a2 2 0 0 0-2 2v12a2 2 0 0 1-2-2v-1h4"/><path d="M7 4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h11a2 2 0 0 0 2-2V7"/><path d="M11 9h5M11 13h5"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z"/>',
    checkSquare: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    barcode: '<path d="M4 5v14M7 5v14M10.5 5v14M13 5v14M16.5 5v14M20 5v14"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    loader: '<path d="M12 3a9 9 0 1 0 9 9"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 9v12"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 18v2h16v-2"/>',
    upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 18v2h16v-2"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    factory: '<path d="M3 21V10l6 4v-4l6 4V4h6v17z"/><path d="M7 18h2M12 18h2M17 18h1M17 8h1"/>',
    package: '<path d="m12 3 9 5v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
    warehouse: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-9h10v9M7 15h10M7 18h10"/>',
    rupee: '<path d="M7 4h11M7 9h11M12 4c2.6 0 4 2 4 5s-2 5-5 5H7l8 7"/>',
    trendUp: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/><path d="M15.5 7H20v4.5"/>',
    trendDown: '<path d="M3 3v18h18"/><path d="m7 8 4 4 3-3 6 7"/><path d="M20 11.5V16h-4.5"/>',
    scissors: '<circle cx="6" cy="6.5" r="2.8"/><circle cx="6" cy="17.5" r="2.8"/><path d="M8.2 8.2 20 18M8.2 15.8 20 6M12.5 12h.01"/>',
    needle: '<path d="M20.5 3.5 7 17l-3.5 3.5"/><path d="M17 4.5 19.5 7"/><path d="M4 12c3-1 5 0 6.5 1.5S13 17 12 20"/>',
    iron: '<path d="M3 18h18v-3a7 7 0 0 0-7-7H7"/><path d="M4 18c0-4 2-6.5 6-7M7 5h7a3 3 0 0 1 3 3"/><path d="M8 14h.01M12 14h.01M16 14h.01"/>',
    droplets: '<path d="M8 3s5 5.2 5 9a5 5 0 0 1-10 0c0-3.8 5-9 5-9z"/><path d="M17 9s4 3.8 4 6.8a4 4 0 0 1-6.6 3"/>',
    roll: '<ellipse cx="6.5" cy="9" rx="3.5" ry="6"/><path d="M6.5 3H18c2 0 3.5 2.7 3.5 6s-1.5 6-3.5 6H6.5"/><path d="M12 15v6h9v-6.6"/><path d="M6.5 8v2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    gauge: '<path d="M4 18a9.5 9.5 0 1 1 16 0"/><path d="m12 14 4.5-5"/><circle cx="12" cy="14.5" r="1.4"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
    clockCheck: '<path d="M21 12a9 9 0 1 0-9 9"/><path d="M12 7v5l3 2"/><path d="m15.5 19 2 2 4-4.5"/>',
    hourglass: '<path d="M6 3h12M6 21h12M7.5 3v3.5c0 2 4.5 4 4.5 5.5s-4.5 3.5-4.5 5.5V21M16.5 3v3.5c0 2-4.5 4-4.5 5.5s4.5 3.5 4.5 5.5V21"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 4.5zM9 11h6M9 15h6"/>',
    receipt: '<path d="M5 3v18l2.3-1.5L9.7 21l2.3-1.5 2.3 1.5 2.4-1.5L19 21V3l-2.3 1.5L14.3 3 12 4.5 9.7 3 7.3 4.5z"/><path d="M9 9h6M9 13h6"/>',
    userCheck: '<circle cx="9.5" cy="8" r="3.8"/><path d="M2.5 20.5c.6-3.8 3.5-5.8 7-5.8 1.5 0 2.9.4 4 1.1"/><path d="m16 18 2 2 4-4.5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14"/><path d="m5 7-3 7a3.4 3.4 0 0 0 6 0zM19 7l-3 7a3.4 3.4 0 0 0 6 0z"/>',
    sigma: '<path d="M18 5H6l6.5 7L6 19h12"/>',
    mapPin: '<path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    map: '<path d="m3 6 6-2.5 6 2.5 6-2.5v15L15 21l-6-2.5L3 21z"/><path d="M9 3.5v15M15 6v15"/>',
    building: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    repeat: '<path d="M17 3l4 4-4 4"/><path d="M3 11V9a2 2 0 0 1 2-2h16M7 21l-4-4 4-4"/><path d="M21 13v2a2 2 0 0 1-2 2H3"/>',
    filter: '<path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v6h8V3M7 21v-7h10v7"/>',
    undo: '<path d="M8 5 3 10l5 5"/><path d="M3 10h11a6 6 0 0 1 0 12h-3"/>',
    excel: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 12.5l5 5M14 12.5l-5 5"/>',
    pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    slides: '<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M12 17v4M8 21h8M8 13V10M12 13V8M16 13v-2"/>',
    barChart: '<path d="M3 21h18"/><rect x="5" y="11" width="3.5" height="7"/><rect x="10.3" y="6" width="3.5" height="12"/><rect x="15.5" y="9" width="3.5" height="9"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10M15 10v10"/>',
    rows: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    helpAlert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  };
  const svg = (n, cls) => '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[n] || P.info) + '</svg>';

  const NAV = { home: 'home', upload: 'upload', masters: 'database', missing: 'alert', users: 'users', password: 'key' };
  const MODULE = { production: 'factory', hr: 'users', admin: 'truck', orders: 'package', inventory: 'warehouse', costing: 'rupee', sales: 'trendUp' };
  const REPORT = [[/fabric/i, 'roll'], [/cutting/i, 'scissors'], [/sewing/i, 'needle'], [/ironing/i, 'iron'], [/washing/i, 'droplets'], [/packing/i, 'package'],
    [/fusing|embroid/i, 'layers'], [/seasonal/i, 'calendar'], [/core/i, 'repeat'], [/dispatch/i, 'truck'], [/return/i, 'undo'], [/sales/i, 'trendUp']];
  const MASTER = [[/order seasons/i, 'calendar'], [/item groups/i, 'layers'], [/stock points/i, 'warehouse'], [/merchandiser/i, 'users'], [/core day/i, 'clock'], [/^sites/i, 'mapPin'],
    [/^states/i, 'map'], [/^units/i, 'building'], [/targets/i, 'target'], [/working days/i, 'calendar'], [/^items/i, 'tag'], [/equivalent/i, 'scale'], [/machines/i, 'cpu'], [/settings/i, 'sliders'], [/jobbers/i, 'truck'], [/seasons/i, 'sun']];
  const BUTTON = [[/^(saving|loading|reading|checking|copying)/i, 'loader'], [/bulk upload/i, 'upload'], [/^upload|choose another/i, 'upload'], [/download/i, 'download'], [/^sync/i, 'refresh'], [/check again|^refresh|try again/i, 'refresh'],
    [/check storage/i, 'database'], [/archive old/i, 'inbox'], [/check rows/i, 'search'], [/view details|view rows/i, 'eye'], [/hide rows|close details/i, 'eyeOff'], [/add to master|add all|add row|^\+|add user|add new/i, 'plus'], [/replace/i, 'repeat'], [/^save/i, 'save'], [/cancel changes|^undo/i, 'undo'],
    [/delete/i, 'trash'], [/^copy/i, 'copy'], [/^(cancel|close)/i, 'x'], [/review/i, 'alert'], [/show all/i, 'rows'], [/reset/i, 'key'], [/enable|activate/i, 'check'], [/disable|deactivate/i, 'xCircle'], [/^chart$/i, 'barChart'], [/^table$/i, 'table'], [/log ?in|sign in/i, 'login']];
  const KPI = [[/units issued/i, 'building'], [/items issued/i, 'tag'], [/pass %/i, 'checkSquare'], [/invoice/i, 'receipt'], [/on-?time/i, 'clockCheck'], [/cut-?off/i, 'calendar'], [/pending/i, 'hourglass'], [/cancel/i, 'xCircle'], [/net order/i, 'sigma'], [/^ordered|order qty/i, 'clipboard'], [/without order/i, 'alert'], [/against orders/i, 'checkSquare'],
    [/returns?/i, 'undo'], [/stock points?/i, 'warehouse'], [/dc within|days to dc|cycle/i, 'clock'], [/dc %/i, 'percent'], [/^dc qty/i, 'truck'], [/efficien|pcs ?\/|per person|per tailor/i, 'gauge'], [/target|achiev/i, 'target'], [/average|avg/i, 'activity'], [/present|tailors?|strength|attendance/i, 'userCheck'],
    [/damage|rejected|shortage/i, 'alert'], [/amount|debit|rate/i, 'rupee'], [/sent|received/i, 'truck'], [/fabric/i, 'roll'], [/cut/i, 'scissors'], [/sewing|sewn|equivalent/i, 'needle'], [/iron/i, 'iron'], [/pack/i, 'package'], [/wash/i, 'droplets'], [/machine|table/i, 'cpu'], [/ot\b|overtime/i, 'clock']];
  const TITLE = [[/summary/i, 'table'], [/pending/i, 'hourglass'], [/to date/i, 'calendar'], [/upload history/i, 'clock'], [/data in the system/i, 'database'], [/^upload/i, 'upload'], [/recent activity/i, 'activity'], [/^users/i, 'users'], [/add a user/i, 'plus'], [/details/i, 'rows'], ...MASTER];
  const pick = (list, text) => { const hit = list.find(([re]) => re.test(text)); return hit ? hit[1] : null; };
  const textOf = el => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const put = (el, name, cls) => {
    if (!name || el.querySelector(':scope > svg, :scope > .ico-wrap')) return;
    el.insertAdjacentHTML('afterbegin', cls ? '<span class="ico-wrap ' + cls + '">' + svg(name) + '</span>' : svg(name));
  };

  function decorate(root) {
    root.querySelectorAll('.btn:not(.dl-btn), .viz-toggle').forEach(b => put(b, pick(BUTTON, textOf(b))));
    root.querySelectorAll('.rep-btn > span:first-child').forEach(s => put(s, pick(REPORT, textOf(s))));
    root.querySelectorAll('.ms-tab').forEach(b => put(b, pick(MASTER, textOf(b))));
    root.querySelectorAll('.tile > .k, .kpi > .k').forEach(k => put(k, pick(KPI, textOf(k)) || 'barChart', 'kpi-ico'));
    root.querySelectorAll('.sec-title, .sum-head > h2, .um-title > h2, .ms-head h2').forEach(t => put(t, pick(TITLE, textOf(t))));
    root.querySelectorAll('.dl-menu button[data-dl]').forEach(b => { const kind = b.dataset.dl.split(':')[0]; const lab = b.firstChild; if (!b.querySelector('.dl-name')) { const sp = document.createElement('span'); sp.className = 'dl-name'; sp.innerHTML = svg(kind === 'excel' ? 'excel' : kind === 'pdf' ? 'pdf' : 'slides'); sp.append(lab); b.prepend(sp); } });
    root.querySelectorAll('.status.ok, .status.error').forEach(s => { if (s.textContent.trim()) put(s, s.classList.contains('error') ? 'alert' : 'check'); });
    root.querySelectorAll('.home-alert > span, .ms-errors > b').forEach(s => put(s, 'alert'));
    root.querySelectorAll('.sync-box > div > b').forEach(s => put(s, 'sheet'));
  }

  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; decorate(document); }); };
  function start() {
    document.querySelectorAll('.nav-btn[data-route]').forEach(b => { const s = b.querySelector('svg'), n = NAV[b.dataset.route]; if (s && n) s.innerHTML = P[n]; });
    const t = document.getElementById('toggle'); if (t && t.querySelector('svg')) t.querySelector('svg').innerHTML = P.menu;
    const o = document.querySelector('.nav-btn[data-logout] svg'); if (o) o.innerHTML = P.logout;
    decorate(document);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  return { svg, paths: P, module: k => P[MODULE[k]] || P.layers, decorate };
})();
