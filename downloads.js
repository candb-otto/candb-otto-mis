// MIS Master System - downloads (Phase 1d step 3)
// Excel (styled, C&B colours) and PDF (full Otto masthead) for one report or a whole module.
// How it works: the report is drawn on screen as usual, then its cards, charts and tables are
// "harvested" from the page and written into the file. For a whole module each report is drawn
// in turn behind a "Preparing…" screen, then the page goes back to where you were.

const XLSX_STYLE_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const BRAND = 'F8A51A', INK = '0B2014', BAND = 'E6F0E9', SOFT = 'FFF3DC', MUTED = '5F6B7A';
// Indian grouping in Excel: 1,23,45,678
const IN_FMT = '[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0';
const IN_FMT1 = '[>=10000000]##\\,##\\,##\\,##0.0;[>=100000]##\\,##\\,##0.0;##,##0.0';

async function ensureXlsxStyle() {
  if (!window.__xlsxStyle) { await loadScript(XLSX_STYLE_URL); window.__xlsxStyle = window.XLSX; }
  return window.__xlsxStyle;
}
async function ensurePdfLibs() {
  if (!window.html2canvas) await loadScript(HTML2CANVAS_URL);
  if (!window.jspdf) await loadScript(JSPDF_URL);
  return { html2canvas: window.html2canvas, jsPDF: window.jspdf.jsPDF };
}

// ---------- busy overlay ----------
function busy(msg) {
  let o = $('dlBusy');
  if (!msg) { if (o) o.remove(); return; }
  if (!o) { o = document.createElement('div'); o.id = 'dlBusy'; o.className = 'dl-busy'; document.body.appendChild(o); }
  o.innerHTML = `<div class="dl-busy-box"><span class="spinner"></span><span>${esc(msg)}</span></div>`;
}

// ---------- harvest what is on screen ----------
function cellText(td) { return td.innerText.replace(/\s+/g, ' ').trim(); }
function tableModel(table) {
  if (!table) return null;
  const head = [...table.querySelectorAll('thead th')].map(th => th.innerText.replace(/[▲▼]\s*$/, '').trim());
  const body = [...table.querySelectorAll('tbody tr')].filter(tr => !tr.querySelector('.empty')).map(tr => [...tr.children].map(cellText));
  const total = [...table.querySelectorAll('tfoot tr')].map(tr => [...tr.children].map(cellText))[0] || null;
  const num = [...table.querySelectorAll('thead th')].map(th => th.classList.contains('num'));
  return { head, body, total, num };
}

function harvest(repName) {
  const filters = Object.entries(rp.filters).filter(([, v]) => v != null).map(([k, v]) => `${rp.def.dims[k] || k}: ${k === 'date' ? fmtDay(v) : v}`);
  const tiles = [...document.querySelectorAll('#repTiles .tile')].map(t => ({
    k: t.querySelector('.k').innerText.trim(), v: t.querySelector('.v').innerText.trim(),
    s: [...t.querySelectorAll('.s')].map(s => s.innerText.trim()),
  }));
  const charts = [...document.querySelectorAll('#repCharts .chart')].map(c => ({
    title: c.querySelector('.chart-title').childNodes[0].textContent.trim(),
    svg: c.querySelector('.chart-area svg'),
    table: tableModel(c.querySelector('.chart-table table')),
  }));
  const summaryTitle = ($('repSummary').querySelector('h2') || {}).textContent || 'Summary';
  return {
    name: repName, module: MODULE_NAMES[rp.module], period: periodLabel(rp.period), compare: periodLabel(compareOf(rp.period)),
    lastUpdated: rp.lastUpdated ? fmtDate(rp.lastUpdated) : '–', filters, tiles, charts,
    summaryTitle, summary: tableModel($('repSummary').querySelector('table')),
    note: (document.querySelector('#repBody .compare') || {}).textContent || '',
    footNote: ($('repSummary').querySelector('.foot-note') || {}).textContent || '',
  };
}

// Draws each live report of the module for the current period (no filters) and harvests it.
async function harvestModule() {
  const list = MODULE_REPORTS[rp.module].filter(r => r.def);
  const saved = { report: rp.report, def: rp.def, filters: rp.filters, months: rp.months, lastUpdated: rp.lastUpdated, cache: rp.cache, details: rp.details };
  const out = [];
  try {
    for (let i = 0; i < list.length; i++) {
      const rep = list[i];
      busy(`Preparing ${rep.name} (${i + 1} of ${list.length})…`);
      rp.report = rep.key; rp.def = rep.def(); rp.filters = {}; rp.details = null;
      rp.cache = rep.key === saved.report ? saved.cache : {};
      const m = await api(`/api/months?${qs({ report: rp.def.sources })}`);
      rp.lastUpdated = m.lastUpdated; rp.months = m.months.length ? m.months : saved.months;
      const key = `${rp.period.from}:${rp.period.to}`;
      if (!rp.cache[key]) rp.cache[key] = await rp.def.load(rp.period, compareOf(rp.period));
      drawReport(rp.cache[key]);
      out.push(harvest(rep.name));
    }
  } finally {
    Object.assign(rp, saved);
    const key = `${rp.period.from}:${rp.period.to}`;
    if (rp.cache[key]) drawReport(rp.cache[key]);
  }
  return out;
}

// ---------- Excel ----------
function toNumber(text) {
  if (text == null) return null;
  const t = String(text).replace(/[▲▼✕]/g, '').trim();
  if (!t || t === '–' || t === '-') return null;
  const pct = /%$/.test(t);
  const s = t.replace(/%$/, '').replace(/,/g, '').replace(/^\+/, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return pct ? { v: n / 100, z: '0.0%' } : { v: n, z: /\./.test(s) ? IN_FMT1 : IN_FMT };
}

const XS = {
  title: { font: { name: 'Segoe UI Black', sz: 16, color: { rgb: INK } } },
  sub: { font: { name: 'Segoe UI', bold: true, sz: 12, color: { rgb: INK } } },
  info: { font: { name: 'Segoe UI', sz: 10, color: { rgb: INK } }, fill: { fgColor: { rgb: BAND } } },
  muted: { font: { name: 'Segoe UI', sz: 9, italic: true, color: { rgb: MUTED } } },
  section: { font: { name: 'Segoe UI', bold: true, sz: 11, color: { rgb: INK } }, border: { bottom: { style: 'medium', color: { rgb: BRAND } } } },
  head: { font: { name: 'Segoe UI', bold: true, sz: 10, color: { rgb: INK } }, fill: { fgColor: { rgb: BRAND } }, alignment: { vertical: 'center', wrapText: true } },
  cell: { font: { name: 'Segoe UI', sz: 10, color: { rgb: INK } }, border: { bottom: { style: 'thin', color: { rgb: 'ECEEEF' } } } },
  total: { font: { name: 'Segoe UI', bold: true, sz: 10, color: { rgb: INK } }, fill: { fgColor: { rgb: SOFT } } },
  up: { font: { name: 'Segoe UI', sz: 10, color: { rgb: '2E7D4F' } } },
  down: { font: { name: 'Segoe UI', sz: 10, color: { rgb: 'C8463B' } } },
};

// Builds one worksheet for a harvested report
function reportSheet(X, h) {
  const rows = [];
  const put = (cells, style) => rows.push(cells.map(c => (c && typeof c === 'object' && 'v' in c) ? c : { v: c ?? '', t: typeof c === 'number' ? 'n' : 's', s: style }));
  put(['Otto Clothing Pvt Ltd'], XS.title);
  put([`${h.module} – ${h.name}`], XS.sub);
  put([`Period: ${h.period}   ·   Compared with: ${h.compare}   ·   Last updated: ${h.lastUpdated}${h.filters.length ? '   ·   Filters: ' + h.filters.join(', ') : ''}`], XS.info);
  put(['Prepared by C&B Consulting & Beyond · MIS Master System'], XS.muted);
  put([]);
  put(['Key figures'], XS.section);
  put(['Measure', 'Value', 'Detail', 'Compared with previous'], XS.head);
  for (const t of h.tiles) {
    const n = toNumber(t.v);
    const delta = t.s.find(s => /vs /.test(s)) || '';
    rows.push([{ v: t.k, t: 's', s: XS.cell }, n ? { v: n.v, t: 'n', z: n.z, s: XS.cell } : { v: t.v, t: 's', s: XS.cell },
      { v: t.s.filter(s => s !== delta).join(' · '), t: 's', s: XS.cell },
      { v: delta.replace(/^No .*compare$/, '–'), t: 's', s: /▼/.test(delta) ? XS.down : /▲/.test(delta) ? XS.up : XS.cell }]);
  }
  const addTable = (title, tm) => {
    if (!tm || !tm.head.length) return;
    put([]);
    put([title], XS.section);
    put(tm.head, XS.head);
    const line = (r, base) => r.map((v, i) => {
      const n = i > 0 ? toNumber(v) : null;
      const st = base === XS.total ? XS.total : /^▼/.test(v) ? XS.down : /^▲/.test(v) ? XS.up : base;
      return n ? { v: n.v, t: 'n', z: n.z, s: st } : { v, t: 's', s: st };
    });
    tm.body.forEach(r => rows.push(line(r, XS.cell)));
    if (tm.total) rows.push(line(tm.total, XS.total));
  };
  addTable(h.summaryTitle, h.summary);
  if (h.footNote) put([h.footNote], XS.muted);
  h.charts.forEach(c => addTable(`Chart data – ${c.title}`, c.table));

  const ws = X.utils.aoa_to_sheet(rows.map(r => r.map(c => c.v)));
  rows.forEach((r, ri) => r.forEach((c, ci) => {
    const ref = X.utils.encode_cell({ r: ri, c: ci });
    ws[ref] = { v: c.v, t: c.t || (typeof c.v === 'number' ? 'n' : 's'), s: c.s };
    if (c.z) ws[ref].z = c.z;
  }));
  const width = Math.max(...rows.map(r => r.length), 4);
  ws['!cols'] = Array.from({ length: width }, (_, i) => ({ wch: i === 0 ? 30 : i === 2 ? 26 : 15 }));
  ws['!merges'] = [0, 1, 2, 3].map(r => ({ s: { r, c: 0 }, e: { r, c: Math.max(width - 1, 5) } }));
  return ws;
}

// Raw rows (with the page filters) as a plain styled sheet
function detailSheet(X, src, raw) {
  const rows = raw.rows.filter(r => detailMatches(src.view ? src.view(r) : r, src));
  const cols = raw.columns;
  const aoa = [cols, ...rows.map(r => cols.map(c => r[c] ?? ''))];
  const ws = X.utils.aoa_to_sheet(aoa);
  cols.forEach((c, i) => { const ref = X.utils.encode_cell({ r: 0, c: i }); ws[ref].s = XS.head; });
  for (let r = 1; r < aoa.length; r++) cols.forEach((c, i) => {
    const cell = ws[X.utils.encode_cell({ r, c: i })];
    if (!cell) return;
    if (typeof cell.v === 'number') cell.z = Number.isInteger(cell.v) ? IN_FMT : IN_FMT1;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(cell.v)) {
      // Excel day number (whole number, no time part)
      const [y, m, d] = cell.v.split('-').map(Number);
      cell.v = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; cell.t = 'n'; cell.z = 'dd-mmm-yyyy';
    }
  });
  ws['!cols'] = cols.map(c => ({ wch: Math.min(40, Math.max(10, c.length + 2)) }));
  ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: cols.length - 1 } }) };
  return { ws, count: rows.length };
}

const safeSheet = s => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
const fileBase = (what) => `${MODULE_NAMES[rp.module]} - ${what} - ${periodLabel(rp.period).replace(/[^\w\s–-]/g, '')}`;

async function downloadExcel(scope) {
  try {
    busy('Preparing Excel…');
    const X = await ensureXlsxStyle();
    const wb = X.utils.book_new();
    if (scope === 'module') {
      const all = await harvestModule();
      busy('Writing Excel…');
      all.forEach(h => X.utils.book_append_sheet(wb, reportSheet(X, h), safeSheet(h.name)));
      X.writeFile(wb, `${fileBase('All reports')}.xlsx`);
    } else {
      const repName = MODULE_REPORTS[rp.module].find(r => r.key === rp.report).name;
      const h = harvest(repName);
      X.utils.book_append_sheet(wb, reportSheet(X, h), 'Summary');
      for (let i = 0; i < rp.def.detailSources.length; i++) {
        const src = rp.def.detailSources[i];
        busy(`Adding details: ${src.title}…`);
        const raw = await ensureRaw(i);
        const { ws } = detailSheet(X, src, raw);
        X.utils.book_append_sheet(wb, ws, safeSheet('Details ' + (src.title.match(/\(([^)]+)\)/) || [, src.title])[1]));
      }
      X.writeFile(wb, `${fileBase(repName)}.xlsx`);
    }
    await logDownload('Excel', scope);
  } catch (err) { say(err.message || 'Could not make the Excel file.', 'error'); }
  finally { busy(null); }
}

// ---------- PDF ----------
// SVG charts use theme variables; for the PDF the computed colours are written onto each element.
function svgForPdf(svg) {
  if (!svg) return '';
  const clone = svg.cloneNode(true);
  const src = svg.querySelectorAll('*'), dst = clone.querySelectorAll('*');
  const rootStyle = getComputedStyle(document.documentElement);
  const resolve = v => { const m = /^var\((--[^)]+)\)$/.exec(v || ''); return m ? rootStyle.getPropertyValue(m[1]).trim() : null; };
  src.forEach((el, i) => {
    const cs = getComputedStyle(el), d = dst[i];
    if (el.tagName === 'path' || el.tagName === 'rect' || el.tagName === 'line') {
      const attr = el.getAttribute('fill');
      d.setAttribute('fill', attr === 'transparent' ? 'none' : (resolve(attr) || cs.fill));
      if (cs.stroke && cs.stroke !== 'none') d.setAttribute('stroke', cs.stroke);
      d.setAttribute('stroke-width', cs.strokeWidth);
    }
    if (el.tagName === 'text') { d.setAttribute('fill', cs.fill); d.setAttribute('font-size', cs.fontSize); d.setAttribute('font-weight', cs.fontWeight); d.setAttribute('font-family', 'Segoe UI, sans-serif'); }
    if (cs.opacity !== '1') d.setAttribute('opacity', cs.opacity);
    d.removeAttribute('class');
  });
  clone.removeAttribute('class');
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return clone.outerHTML;
}

// Turns a chart into a PNG picture (drawn at 2x) so the PDF shows it exactly as on screen
function svgToImg(svg) {
  return new Promise(resolve => {
    if (!svg) return resolve('');
    const w = Number(svg.getAttribute('width')), h = Number(svg.getAttribute('height'));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * 2; c.height = h * 2;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(`<img class="pdf-chart-img" src="${c.toDataURL('image/png')}" style="width:${w}px" alt="">`);
    };
    img.onerror = () => resolve('');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgForPdf(svg));
  });
}

function tableHtml(tm, cls = '') {
  if (!tm) return '';
  const td = (v, i) => `<td class="${tm.num[i] ? 'num' : ''}">${esc(v).replace(/^▲/, '<span class="up">▲</span>').replace(/^▼/, '<span class="down">▼</span>')}</td>`;
  return `<table class="${cls}"><thead><tr>${tm.head.map((h, i) => `<th class="${tm.num[i] ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${tm.body.map(r => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody>
    ${tm.total ? `<tfoot><tr class="total">${tm.total.map(td).join('')}</tr></tfoot>` : ''}</table>`;
}

// The PDF is built from blocks (header + cards, chart rows, table chunks). Each block is drawn
// as an image and placed on A4 landscape pages; a block that does not fit starts a new page,
// so charts and table rows are never cut in half. Every report starts on a new page.
const PDF_TABLE_ROWS = 18;

async function reportPdfBlocks(h) {
  const blocks = [];
  const tileHtml = t => `<div class="tile"><div class="k">${esc(t.k)}</div><div class="v">${esc(t.v)}</div>${t.s.map(s => `<div class="s">${esc(s).replace(/▲[^v]*/, m => `<span class="up">${m}</span>`).replace(/▼[^v]*/, m => `<span class="down">${m}</span>`)}</div>`).join('')}</div>`;
  blocks.push({ newPage: true, html: `
    <div class="masthead"><img class="logo-l" src="img/otto-logo.png" alt=""><p class="company">Otto Clothing Pvt Ltd</p><img class="logo-r" src="img/cb-logo.jpg" alt=""></div>
    <h1 class="report-title">${esc(h.module)} – ${esc(h.name)}</h1>
    <header><div class="filters"><label>Period:</label><span>${esc(h.period)}</span><label>Compared with:</label><span>${esc(h.compare)}</span>
      ${h.filters.length ? `<label>Filters:</label><span>${esc(h.filters.join(', '))}</span>` : ''}<span class="pdf-upd">Last updated ${esc(h.lastUpdated)}</span></div></header>
    <p class="compare">${esc(h.note)}</p>
    <div class="tiles pdf-tiles" style="grid-template-columns: repeat(${Math.min(5, Math.max(3, h.tiles.length))}, 1fr)">${h.tiles.map(tileHtml).join('')}</div>` });
  // Charts as pictures: first row = trend + daily, then the "by …" charts three to a row
  const imgs = await Promise.all(h.charts.map(c => svgToImg(c.svg)));
  const withImg = h.charts.map((c, i) => [c, imgs[i]]);
  const rows = [withImg.slice(0, 2)];
  for (let i = 2; i < withImg.length; i += 3) rows.push(withImg.slice(i, i + 3));
  for (const row of rows.filter(r => r.length)) {
    const cols = row.length;
    blocks.push({ html: `<div class="pdf-charts" style="grid-template-columns: repeat(${cols}, 1fr)">${row.map(([c, img]) => `<div class="card pdf-chart"><h2 class="chart-title">${esc(c.title)}</h2>${img}</div>`).join('')}</div>` });
  }
  const tm = h.summary;
  if (tm) {
    const chunks = [];
    for (let i = 0; i < Math.max(1, tm.body.length); i += PDF_TABLE_ROWS) chunks.push(tm.body.slice(i, i + PDF_TABLE_ROWS));
    chunks.forEach((rows, i) => {
      const last = i === chunks.length - 1;
      const part = { ...tm, body: rows, total: last ? tm.total : null };
      blocks.push({ html: `<div class="card pdf-summary">${i === 0 ? `<h2>${esc(h.summaryTitle)}</h2>` : `<h2>${esc(h.summaryTitle)} (continued)</h2>`}${tableHtml(part)}${last && h.footNote ? `<p class="note small">${esc(h.footNote)}</p>` : ''}</div>` });
    });
  }
  return blocks;
}

// Test hook: the local test page can replace this to capture the file
async function savePdf(doc, filename) { doc.save(filename); }

async function downloadPdf(scope) {
  const wrap = document.createElement('div');
  try {
    busy('Preparing PDF…');
    const { html2canvas, jsPDF } = await ensurePdfLibs();
    const parts = scope === 'module' ? await harvestModule() : [harvest(MODULE_REPORTS[rp.module].find(r => r.key === rp.report).name)];

    // Blocks are laid out in a hidden 1120px-wide page under the "Preparing" screen
    wrap.className = 'pdf-wrap';
    document.body.appendChild(wrap);
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const PW = 297, PH = 210, M = 8, FOOT = 10, W = PW - 2 * M;
    let y = M, first = true;
    const sx = window.scrollX, sy = window.scrollY;
    window.scrollTo(0, 0);

    for (let p = 0; p < parts.length; p++) {
      const blocks = await reportPdfBlocks(parts[p]);
      for (let b = 0; b < blocks.length; b++) {
        busy(`Writing PDF… ${parts.length > 1 ? `${parts[p].name} ` : ''}(${b + 1} of ${blocks.length})`);
        wrap.innerHTML = `<div class="pdf-root">${blocks[b].html}</div>`;
        const el = wrap.firstElementChild;
        await Promise.all([...el.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, windowWidth: 1200, logging: false });
        let w = W, hgt = canvas.height * W / canvas.width;
        const maxH = PH - M - FOOT;
        if (hgt > maxH - M) { hgt = maxH - M; w = canvas.width * hgt / canvas.height; }   // very tall block: shrink to fit
        if (!first && (blocks[b].newPage || y + hgt > maxH)) { doc.addPage(); y = M; }
        doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', M, y, w, hgt);
        y += hgt + 2;
        first = false;
      }
    }
    window.scrollTo(sx, sy);

    // Footer on every page
    const n = doc.getNumberOfPages();
    const printed = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(95, 107, 122);
      doc.text(`MIS Master System · Prepared by C&B Consulting & Beyond · Printed ${printed}`, M, PH - 5);
      doc.text(`Page ${i} of ${n}`, PW - M, PH - 5, { align: 'right' });
    }
    const name = scope === 'module' ? fileBase('All reports') : fileBase(parts[0].name);
    await savePdf(doc, `${name}.pdf`);
    await logDownload('PDF', scope);
  } catch (err) { say(err.message || 'Could not make the PDF.', 'error'); }
  finally { busy(null); wrap.remove(); }
}

// Records the download in the activity log (best effort)
async function logDownload(kind, scope) { try { await api('/api/log-download', { kind, module: rp.module, report: scope === 'module' ? 'all reports' : rp.report, period: periodLabel(rp.period) }); } catch { /* not important */ } }

// ---------- Download menu ----------
function downloadMenuHtml() {
  return `<div class="dl">
    <button class="btn dl-btn" id="dlBtn" type="button" aria-haspopup="true" aria-expanded="false">
      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>Download</button>
    <div class="dl-menu hidden" id="dlMenu" role="menu">
      <div class="dl-group">This report</div>
      <button role="menuitem" data-dl="excel:report">Excel <small>summary, charts data, all rows</small></button>
      <button role="menuitem" data-dl="pdf:report">PDF <small>as on screen</small></button>
      <div class="dl-group">All ${esc(MODULE_NAMES[rp.module])} reports</div>
      <button role="menuitem" data-dl="excel:module">Excel <small>one sheet per report</small></button>
      <button role="menuitem" data-dl="pdf:module">PDF <small>one page set per report</small></button>
    </div></div>`;
}

function wireDownloadMenu() {
  const btn = $('dlBtn'), menu = $('dlMenu');
  if (!btn) return;
  btn.onclick = e => { e.stopPropagation(); const open = menu.classList.toggle('hidden') === false; btn.setAttribute('aria-expanded', open); };
  menu.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => {
    menu.classList.add('hidden');
    const [kind, scope] = b.dataset.dl.split(':');
    if (kind === 'excel') downloadExcel(scope); else downloadPdf(scope);
  });
}
document.addEventListener('click', e => { const m = $('dlMenu'); if (m && !e.target.closest('.dl')) m.classList.add('hidden'); });
