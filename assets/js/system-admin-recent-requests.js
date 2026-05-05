let socket;
let allRequests = [];

function renderRequests(rows) {
  const tbody = document.getElementById('requestRows');
  const countEl = document.getElementById('reqCount');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No requests found.</td></tr>`;
    if (countEl) countEl.textContent = '';
    return;
  }
  const statusClass = s => s.toLowerCase().replace(/[^a-z]+/g, '-');
  tbody.innerHTML = rows.map(row => {
    const display = row.status === 'Approved' ? 'Processing' : row.status;
    return `<tr>
      <td style="font-family:monospace;font-size:12px;">${escapeHtml(row.transaction_no)}</td>
      <td>${escapeHtml(row.resident_name)}</td>
      <td>${escapeHtml(row.document_name)}</td>
      <td><span class="status-pill status-${statusClass(display)}">${escapeHtml(display)}</span></td>
      <td>${formatDate(row.suggested_release_date)}</td>
    </tr>`;
  }).join('');
  if (countEl) countEl.textContent = `Showing ${rows.length} of ${allRequests.length} requests`;
}

function filterRequests() {
  const q = (document.getElementById('reqSearch').value || '').toLowerCase();
  const s = (document.getElementById('reqStatus').value || '');
  const filtered = allRequests.filter(row => {
    const matchSearch = !q ||
      row.transaction_no.toLowerCase().includes(q) ||
      row.resident_name.toLowerCase().includes(q) ||
      row.document_name.toLowerCase().includes(q);
    const matchStatus = !s || row.status === s;
    return matchSearch && matchStatus;
  });
  renderRequests(filtered);
}

function clearReqFilter() {
  document.getElementById('reqSearch').value = '';
  document.getElementById('reqStatus').value = '';
  renderRequests(allRequests);
}

async function loadRequests() {
  const res = await fetch('/api/system-admin/requests');
  allRequests = await res.json();
  filterRequests();
}

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.emit('join:role', 'system_admin');
  socket.on('dashboard:refresh', loadRequests);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadRequests();
  connectSocket();
});
