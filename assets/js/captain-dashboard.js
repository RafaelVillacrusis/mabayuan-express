let socket;
function getFilter() { return new URLSearchParams(window.location.search).get('status') || 'all'; }
function getSearch() { return (document.getElementById('captainSearch') || {}).value || ''; }
function setFilter(status) { const url = new URL(window.location.href); status === 'all' ? url.searchParams.delete('status') : url.searchParams.set('status', status); window.history.replaceState({}, '', url); }

async function loadMe() { const res = await fetch('/api/captain/me'); const me = await res.json(); document.getElementById('captainName').textContent = me.full_name; }
async function loadCounts() {
  const res = await fetch('/api/captain/counts'); const counts = await res.json();
  const map = { all: counts.total_requests || 0, 'Pending Approval': counts.pending_approval || 0, Approved: counts.approved_count || 0, Declined: counts.declined_count || 0, 'Ready for Pickup': counts.ready_count || 0, Claimed: counts.claimed_count || 0 };
  document.querySelectorAll('.filter-card').forEach(card => { card.querySelector('.filter-value').textContent = map[card.dataset.status] || 0; card.classList.toggle('active', card.dataset.status === getFilter()); });
}
async function loadRequests() {
  const search = getSearch();
  const res = await fetch(`/api/captain/requests?status=${encodeURIComponent(getFilter())}&search=${encodeURIComponent(search)}`);
  const rows = await res.json();
  document.getElementById('captainRequestRows').innerHTML = rows.map(row => `
    <tr><td>${escapeHtml(row.transaction_no)}</td><td>${escapeHtml(row.resident_name)}</td><td>${escapeHtml(row.document_name)}</td><td>${peso(row.price_at_request)}</td><td>${formatDate(row.suggested_release_date)}</td><td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${row.status}</span></td><td><a class="btn btn-small" href="/captain/request/${row.request_id}">View</a></td></tr>`).join('') || `<tr><td colspan="7" class="empty-state">No requests found.</td></tr>`;
}
function connectSocket() { if (socket) return; socket = io(); socket.emit('join:role', 'captain'); socket.on('dashboard:refresh', async()=>{await loadCounts(); await loadRequests();}); }

document.addEventListener('DOMContentLoaded', async () => {
  await loadMe(); await loadCounts(); await loadRequests(); connectSocket();
  document.querySelectorAll('.filter-card').forEach(card => card.addEventListener('click', async()=>{ setFilter(card.dataset.status); await loadCounts(); await loadRequests(); }));
  let searchTimer;
  document.getElementById('captainSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadRequests(), 300);
  });
});
