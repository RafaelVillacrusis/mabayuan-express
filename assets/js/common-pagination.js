/* ══════════════════════════════════════════════════════
 *  Shared Pagination Utility — Mabayuan Express
 *  Usage: const pg = createPaginator(tbodyId, paginationId, PAGE_SIZE)
 *         pg.setRows(rows)  — set/update data and re-render
 *         pg.goPage(n)      — jump to page n
 * ══════════════════════════════════════════════════════ */
function createPaginator(tbodyId, paginationId, pageSize = 10) {
  let _rows = [];
  let _page = 1;
  let _renderRow; // caller must set this

  function _totalPages() { return Math.max(1, Math.ceil(_rows.length / pageSize)); }

  function _renderTable() {
    const total = _rows.length;
    const tp    = _totalPages();
    _page       = Math.min(_page, tp);
    const start = (_page - 1) * pageSize;
    const slice = _rows.slice(start, start + pageSize);

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = slice.length
      ? slice.map((row, i) => _renderRow(row, i)).join('')
      : tbody.dataset.emptyColspan
        ? `<tr><td colspan="${tbody.dataset.emptyColspan}" class="empty-state">No records found.</td></tr>`
        : `<tr><td colspan="99" class="empty-state">No records found.</td></tr>`;

    _renderPagination(total, tp, start, slice.length);
  }

  function _renderPagination(total, tp, start, count) {
    const el = document.getElementById(paginationId);
    if (!el) return;
    if (total === 0) { el.innerHTML = ''; return; }

    const end = start + count;
    const pages = new Set([1, tp]);
    for (let i = Math.max(1, _page - 1); i <= Math.min(tp, _page + 1); i++) pages.add(i);
    const sorted = [...pages].sort((a, b) => a - b);

    let btns = '';
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) btns += `<span class="pg-ellipsis">…</span>`;
      btns += `<button class="pg-btn${p === _page ? ' active' : ''}" onclick="window.__pg_${paginationId}(${p})">${p}</button>`;
      prev = p;
    }

    el.innerHTML = `
      <div class="pg-info">Showing ${start + 1}–${end} of ${total} record${total !== 1 ? 's' : ''}</div>
      <div class="pg-controls">
        <button class="pg-btn" onclick="window.__pg_${paginationId}(${_page - 1})" ${_page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        ${btns}
        <button class="pg-btn" onclick="window.__pg_${paginationId}(${_page + 1})" ${_page >= tp ? 'disabled' : ''}>Next ›</button>
      </div>`;
  }

  // Expose goPage globally so inline onclick works
  window[`__pg_${paginationId}`] = function(p) {
    _page = Math.max(1, Math.min(p, _totalPages()));
    _renderTable();
    const el = document.getElementById(tbodyId);
    if (el) el.closest('section, .panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return {
    setRows(rows, renderRowFn) {
      _rows = rows;
      if (renderRowFn) _renderRow = renderRowFn;
      _page = 1;
      _renderTable();
    },
    refresh() { _renderTable(); },
    goPage(p) { window[`__pg_${paginationId}`](p); },
  };
}
