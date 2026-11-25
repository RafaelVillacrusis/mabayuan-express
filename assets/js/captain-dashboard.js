let socket;
let allRows   = [];
// List order: FIFO (oldest request first) by default; the Captain can switch to newest first.
// The choice is remembered on this device.
const ORDER_KEY = 'cp_request_order';
const PENDING_KEY = 'cp_pending_first';
function readPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePref(key, value) { try { localStorage.setItem(key, value); } catch { /* private mode */ } }
let sortCol   = 'created_at';
let sortDir   = readPref(ORDER_KEY, 'fifo') === 'newest' ? 'desc' : 'asc';
let pendingFirst = readPref(PENDING_KEY, '1') === '1';   // "Needs decision" requests on top
let currentPage = 1;
const PAGE_SIZE = 10;

function getFilter() { return new URLSearchParams(window.location.search).get('status') || 'all'; }
function getSearch() { return (document.getElementById('captainSearch') || {}).value.trim().toLowerCase() || ''; }
function getStatusFilter() { return (document.getElementById('statusDropdown') || {}).value || 'all'; }
function setFilter(status) {
  const url = new URL(window.location.href);
  status === 'all' ? url.searchParams.delete('status') : url.searchParams.set('status', status);
  window.history.replaceState({}, '', url);
}

async function loadMe() {
  const res = await fetch('/api/captain/me');
  const me  = await res.json();
  document.getElementById('captainName').textContent = (me.full_name || 'Captain').split(' ')[0];
  const t = document.getElementById('cpToday');
  if (t) t.textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

async function loadCounts() {
  const res    = await fetch('/api/captain/counts');
  const counts = await res.json();
  const map = {
    all: counts.total_requests || 0,
    'Pending Approval': counts.pending_approval || 0,
    Approved:  counts.approved_count  || 0,
    Declined:  counts.declined_count  || 0,
    'Ready for Pickup': counts.ready_count || 0,
    Claimed:   counts.claimed_count   || 0,
  };
  document.querySelectorAll('.filter-card').forEach(card => {
    card.querySelector('.filter-value').textContent = map[card.dataset.status] || 0;
    card.classList.toggle('active', card.dataset.status === getFilter());
  });
  const pending = Number(counts.pending_approval || 0);
  if (window.cpSetPendingBadge) window.cpSetPendingBadge(pending);
  document.getElementById('cpPendingCard')?.classList.toggle('st-attention', pending > 0);
  const pc = document.getElementById('cpPendingCount');
  if (pc) { pc.textContent = pending; pc.hidden = pending === 0; }
  const banner = document.getElementById('cpPendingBanner');
  if (banner) {
    banner.hidden = false;
    banner.classList.toggle('done', pending === 0);
    banner.innerHTML = pending > 0
      ? `<div><strong>⏳ ${pending} request${pending === 1 ? ' is' : 's are'} waiting for your decision</strong>Residents are notified by email once you approve or decline. <a href="?status=Pending%20Approval" id="cpShowPending" style="color:inherit;font-weight:700">Show them →</a></div>`
      : '<div><strong>🎉 All caught up</strong>There are no requests waiting for your decision.</div>';
    document.getElementById('cpShowPending')?.addEventListener('click', async e => {
      e.preventDefault();
      setFilter('Pending Approval');
      await loadCounts();
      renderTable();
      document.getElementById('cpQueue').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

async function loadRequests() {
  const res = await fetch(`/api/captain/requests?status=all&search=`);
  allRows = await res.json();
  currentPage = 1;
  renderTable();
}

function getFilteredSorted() {
  const search       = getSearch();
  const statusFilter = getStatusFilter();
  const cardFilter   = getFilter();

  let rows = allRows.filter(row => {
    // Card filter (top KPI cards)
    if (cardFilter !== 'all' && row.status !== cardFilter) return false;
    // Dropdown filter
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    // Date range filter — by the date the resident made the request (Philippine time)
    const [dateFrom, dateTo] = getDateRange();
    if (dateFrom || dateTo) {
      const rowDate = phDate(row.created_at);
      if (!rowDate) return false;
      if (dateFrom && rowDate < dateFrom) return false;
      if (dateTo   && rowDate > dateTo)   return false;
    }
    // Gender
    const g = (document.getElementById('genderFilter') || {}).value || 'all';
    if (g !== 'all' && (g === 'none' ? !!row.gender : row.gender !== g)) return false;
    // Search
    if (search) {
      const hay = [row.transaction_no, row.resident_name, row.document_name, row.status].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort
  rows.sort((a, b) => {
    if (pendingFirst) {
      const pa = a.status === 'Pending Approval', pb = b.status === 'Pending Approval';
      if (pa !== pb) return pa ? -1 : 1;
    }
    let va = a[sortCol] ?? '';
    let vb = b[sortCol] ?? '';
    // Numeric sort for price
    if (sortCol === 'price_at_request') { va = Number(va); vb = Number(vb); }
    else if (sortCol === 'gender') { va = genderSortKey(a.gender); vb = genderSortKey(b.gender); }
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    // Same value: keep submission order (FIFO), or reverse it for "Newest first"
    const ta = String(a.created_at || ''), tb = String(b.created_at || '');
    const tie = ta < tb ? -1 : ta > tb ? 1 : (a.request_id - b.request_id);
    return sortCol === 'created_at' && sortDir === 'desc' ? -tie : tie;
  });

  return rows;
}

function syncOrderControls() {
  const sel = document.getElementById('orderSelect');
  const note = document.getElementById('orderNote');
  if (!sel) return;
  sel.value = sortCol === 'created_at' ? (sortDir === 'asc' ? 'fifo' : 'newest') : 'custom';
  const colName = (document.querySelector(`#captainTable th[data-col="${sortCol}"]`) || {}).textContent || sortCol;
  note.textContent = sel.value === 'fifo' ? 'First come, first served — the request waiting longest is at the top.'
    : sel.value === 'newest' ? 'Most recent requests are at the top.'
    : `Sorted by ${colName.trim()} (${sortDir === 'asc' ? 'ascending' : 'descending'}). Choose an order to go back.`;
  document.getElementById('pendingFirstToggle').checked = pendingFirst;
}

function renderTable() {
  syncOrderControls();
  const rows      = getFilteredSorted();
  const total     = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage     = Math.min(currentPage, totalPages);
  const start     = (currentPage - 1) * PAGE_SIZE;
  const pageRows  = rows.slice(start, start + PAGE_SIZE);

  // Update sort indicators on headers
  document.querySelectorAll('#captainTable thead th[data-col]').forEach(th => {
    const col = th.dataset.col;
    th.classList.toggle('sort-asc',  col === sortCol && sortDir === 'asc');
    th.classList.toggle('sort-desc', col === sortCol && sortDir === 'desc');
  });

  // Render rows
  const tbody = document.getElementById('captainRequestRows');
  tbody.innerHTML = pageRows.length
    ? pageRows.map(row => `
        <tr>
          <td>${row.created_at ? formatDate(row.created_at) : '-'}</td>
          <td>${escapeHtml(row.resident_name)}</td>
          <td>${genderPill(row.gender)}</td>
          <td>${escapeHtml(row.document_name)}</td>
          <td>${peso(row.price_at_request)}</td>
          <td>${formatDate(row.suggested_release_date)}</td>
          <td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${escapeHtml(row.status === 'Pending Approval' ? 'Needs decision' : row.status)}</span></td>
          <td>${row.status === 'Pending Approval'
            ? `<a class="btn btn-small" href="/captain/request/${row.request_id}">Review</a>`
            : `<a class="btn btn-small btn-ghost" href="/captain/request/${row.request_id}">View</a>`}${row.valid_id_path && !String(row.valid_id_path).startsWith('missing:')
            ? `<button type="button" class="btn btn-small btn-ghost cp-id-btn" data-id-view="${row.request_id}" title="View the valid ID uploaded with this request">🪪 ID</button>`
            : ''}</td>
        </tr>`).join('')
    : `<tr><td colspan="8" class="empty-state">${getFilter() === 'Pending Approval' ? '🎉 No requests waiting for your decision.' : 'No requests match these filters.'}</td></tr>`;

  // Render pagination using shared pg-row style
  const pgEl = document.getElementById('paginationRow');
  if (pgEl) {
    if (total === 0) { pgEl.innerHTML = ''; }
    else {
      const end = start + pageRows.length;
      const pages = new Set([1, totalPages]);
      for (let i = Math.max(1, currentPage-1); i <= Math.min(totalPages, currentPage+1); i++) pages.add(i);
      const sorted = [...pages].sort((a,b)=>a-b);
      let btns = '', prev = 0;
      for (const p of sorted) {
        if (p - prev > 1) btns += `<span class="pg-ellipsis">…</span>`;
        btns += `<button class="pg-btn${p===currentPage?' active':''}" onclick="goPage(${p})">${p}</button>`;
        prev = p;
      }
      pgEl.innerHTML = `
        <span class="pg-info">Showing ${start+1}–${end} of ${total} record${total!==1?'s':''}</span>
        <div class="pg-controls">
          <button class="pg-btn" onclick="goPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>‹ Prev</button>
          ${btns}
          <button class="pg-btn" onclick="goPage(${currentPage+1})" ${currentPage>=totalPages?'disabled':''}>Next ›</button>
        </div>`;
    }
  }
}

function goPage(p) {
  const rows = getFilteredSorted();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  currentPage = Math.max(1, Math.min(p, totalPages));
  renderTable();
  document.querySelector('.panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.emit('join:role', 'captain');
  socket.on('dashboard:refresh', async () => { await loadCounts(); await loadRequests(); });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadMe();
  await loadCounts();
  await loadRequests();
  connectSocket();

  // KPI card filter
  document.querySelectorAll('.filter-card').forEach(card =>
    card.addEventListener('click', async () => {
      setFilter(card.dataset.status);
      // sync dropdown to match card
      const dd = document.getElementById('statusDropdown');
      if (dd) dd.value = 'all';
      await loadCounts();
      currentPage = 1;
      renderTable();
    })
  );

  // Search
  let searchTimer;
  document.getElementById('captainSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; renderTable(); }, 250);
  });

  // Status dropdown filter
  const dd = document.getElementById('statusDropdown');
  if (dd) dd.addEventListener('change', () => { currentPage = 1; renderTable(); });

  // From / To dates — apply as soon as a date is picked
  ['dateFromFilter', 'dateToFilter'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { currentPage = 1; renderTable(); }));

  // Apply / Reset buttons
  const applyBtn = document.getElementById('applyDashFilter');
  const resetBtn = document.getElementById('resetDashFilter');
  if (applyBtn) applyBtn.addEventListener('click', () => { currentPage = 1; renderTable(); });
  if (resetBtn) resetBtn.addEventListener('click', () => {
    document.getElementById('captainSearch').value   = '';
    document.getElementById('statusDropdown').value  = 'all';
    document.getElementById('dateFromFilter').value  = '';
    document.getElementById('dateToFilter').value    = '';
    document.getElementById('genderFilter').value    = 'all';
    getDateRange();
    setFilter('all');
    document.querySelectorAll('.filter-card').forEach(c => c.classList.toggle('active', c.dataset.status === 'all'));
    currentPage = 1;
    renderTable();
  });

  document.getElementById('genderFilter').addEventListener('change', () => { currentPage = 1; renderTable(); });

  // Order: FIFO / newest first
  document.getElementById('orderSelect').addEventListener('change', e => {
    if (e.target.value === 'custom') return;
    sortCol = 'created_at';
    sortDir = e.target.value === 'newest' ? 'desc' : 'asc';
    savePref(ORDER_KEY, e.target.value);
    currentPage = 1;
    renderTable();
  });
  document.getElementById('pendingFirstToggle').addEventListener('change', e => {
    pendingFirst = e.target.checked;
    savePref(PENDING_KEY, pendingFirst ? '1' : '0');
    currentPage = 1;
    renderTable();
  });

  // Column sort
  document.querySelectorAll('#captainTable thead th[data-col]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = col; sortDir = 'asc'; }
      if (col === 'created_at') savePref(ORDER_KEY, sortDir === 'asc' ? 'fifo' : 'newest');
      currentPage = 1;
      renderTable();
    });
  });
});

// ── From / To date filter ───────────────────────────────────────────────────
// YYYY-MM-DD of a timestamp in Philippine time
function phDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/** Returns [from, to]; ignores "To" when it is before "From" and says so. Also updates the hint line. */
function getDateRange() {
  const fromEl = document.getElementById('dateFromFilter');
  const toEl   = document.getElementById('dateToFilter');
  const from = fromEl ? fromEl.value : '';
  let to     = toEl ? toEl.value : '';
  if (toEl) toEl.min = from || '';
  if (fromEl) fromEl.max = to || '';
  const bad = from && to && to < from;
  document.getElementById('dateToField')?.classList.toggle('invalid', !!bad);
  const note = document.getElementById('dateRangeNote');
  if (note) {
    const fmt = v => new Date(v + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    note.hidden = !(from || to);
    note.innerHTML = bad ? '⚠️ The <strong>To</strong> date is before the <strong>From</strong> date, so it is ignored.'
      : from && to ? `Showing requests made from <strong>${fmt(from)}</strong> to <strong>${fmt(to)}</strong>.`
      : from ? `Showing requests made on or after <strong>${fmt(from)}</strong>.`
      : to ? `Showing requests made on or before <strong>${fmt(to)}</strong>.` : '';
  }
  if (bad) to = '';
  return [from, to];
}

// ── Valid ID viewer ─────────────────────────────────────────────────────────
function openIdViewer(requestId) {
  const row = allRows.find(r => String(r.request_id) === String(requestId));
  if (!row) return;
  const modal = document.getElementById('idModal');
  document.getElementById('idModalSub').textContent = `${row.resident_name} · ${row.document_name} · ${row.transaction_no}`;
  document.getElementById('idModalReview').href = `/captain/request/${row.request_id}`;
  document.getElementById('idModalReview').textContent = row.status === 'Pending Approval' ? 'Review request' : 'Open request';
  renderRequestValidId({ ...row, has_valid_id: true }, 'captain');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('idModalClose').focus();
}
function closeIdViewer() {
  const modal = document.getElementById('idModal');
  if (modal.hidden) return;
  modal.hidden = true;
  document.body.style.overflow = '';
  document.getElementById('validIdBody').innerHTML = '';
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-id-view]');
  if (b) return openIdViewer(b.dataset.idView);
  if (e.target.id === 'idModal' || e.target.closest('#idModalClose, #idModalDone')) closeIdViewer();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeIdViewer(); });
