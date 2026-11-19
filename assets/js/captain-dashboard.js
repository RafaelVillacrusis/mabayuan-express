let socket;
let allRows   = [];
let sortCol   = 'suggested_release_date';
let sortDir   = 'asc';
let pendingFirst = true;   // requests needing the Captain are listed first until a column is sorted
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
    // Date range filter
    const dateFrom = getDateFrom();
    const dateTo   = getDateTo();
    if (dateFrom || dateTo) {
      const rowDate = (row.suggested_release_date || row.updated_at || '').slice(0, 10);
      if (dateFrom && rowDate < dateFrom) return false;
      if (dateTo   && rowDate > dateTo)   return false;
    }
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
    else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  return rows;
}

function renderTable() {
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
          <td>${escapeHtml(row.transaction_no)}</td>
          <td>${escapeHtml(row.resident_name)}</td>
          <td>${escapeHtml(row.document_name)}</td>
          <td>${peso(row.price_at_request)}</td>
          <td>${formatDate(row.suggested_release_date)}</td>
          <td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${escapeHtml(row.status === 'Pending Approval' ? 'Needs decision' : row.status)}</span></td>
          <td>${row.status === 'Pending Approval'
            ? `<a class="btn btn-small" href="/captain/request/${row.request_id}">Review</a>`
            : `<a class="btn btn-small btn-ghost" href="/captain/request/${row.request_id}">View</a>`}</td>
        </tr>`).join('')
    : `<tr><td colspan="7" class="empty-state">${getFilter() === 'Pending Approval' ? '🎉 No requests waiting for your decision.' : 'No requests match these filters.'}</td></tr>`;

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

  // Apply / Reset date filter buttons
  const applyBtn = document.getElementById('applyDashFilter');
  const resetBtn = document.getElementById('resetDashFilter');
  if (applyBtn) applyBtn.addEventListener('click', () => { currentPage = 1; renderTable(); });
  if (resetBtn) resetBtn.addEventListener('click', () => {
    document.getElementById('captainSearch').value   = '';
    document.getElementById('statusDropdown').value  = 'all';
    document.getElementById('dateFromFilter').value  = '';
    document.getElementById('dateToFilter').value    = '';
    setFilter('all');
    document.querySelectorAll('.filter-card').forEach(c => c.classList.toggle('active', c.dataset.status === 'all'));
    currentPage = 1;
    renderTable();
  });

  // Column sort
  document.querySelectorAll('#captainTable thead th[data-col]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      pendingFirst = false;
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = col; sortDir = 'asc'; }
      currentPage = 1;
      renderTable();
    });
  });
});

// ── Date filter helpers (wired up in DOMContentLoaded above via applyDashFilter/resetDashFilter) ──
function getDateFrom() { return (document.getElementById('dateFromFilter') || {}).value || ''; }
function getDateTo()   { return (document.getElementById('dateToFilter')   || {}).value || ''; }
