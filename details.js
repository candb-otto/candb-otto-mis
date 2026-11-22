// MIS Master System - View Details for heavy-data modules: reads the month's Google Sheet page by page.
async function fetchSheetDetail(module, dataset, period) {
  const box = $('repDetails');
  const months = monthSeq(period.from, period.to);
  let columns = null;
  const rows = [];
  for (const month of months) {
    for (let start = 1; ; start += 5000) {
      if (box) box.innerHTML = `<p class="note">Loading from Google Sheets, this is slower than the reports… ${esc(fmtMonth(month))} · ${fmtNum(rows.length)} rows so far</p>`;
      const d = await api(`/api/detail/read?module=${module}&month=${month}&dataset=${dataset}&start=${start}&limit=5000`);
      const v = d.sheet ? d.sheet.values || [] : d.values || [];
      if (!v.length) break;
      let body = v;
      if (start === 1) { columns = columns || v[0].map(String); body = v.slice(1); }
      for (const line of body) rows.push(Object.fromEntries(columns.map((c, i) => [c, line[i] === '' || line[i] === undefined ? null : line[i]])));
      if (start + 5000 > (d.rowCount || 0)) break;
    }
  }
  return { columns: columns || [], rows };
}
