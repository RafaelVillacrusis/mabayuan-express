let socket;
let allRequests = [];
let reqPg;

function renderReqRow(row) {
  const display = row.status === 'Approved' ? 'Processing' : row.status;
  const statusClass = s => s.toLowerCase().replace(/[^a-z]+/g, '-');
  return `<tr>
    <td style="font-family:monospace;font-size:12px;">${escapeHtml(row.transaction_no)}</td>
    <td>${escapeHtml(row.resident_name)}</td>
    <td>${escapeHtml(row.document_name)}</td>
    <td><span class="status-pill status-${statusClass(display)}">${escapeHtml(display)}</span></td>
    <td>${formatDate(row.suggested_release_date)}</td>
  </tr>`;
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
  reqPg.setRows(filtered, renderReqRow);
}

function clearReqFilter() {
  document.getElementById('reqSearch').value  = '';
  document.getElementById('reqStatus').value  = '';
  reqPg.setRows(allRequests, renderReqRow);
}

async function loadRequests() {
  const res  = await fetch('/api/system-admin/requests');
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
  reqPg = createPaginator('requestRows', 'reqPg', 10);
  await loadRequests();
  connectSocket();

  let t;
  const searchEl = document.getElementById('reqSearch');
  if (searchEl) searchEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(filterRequests, 250); });
  const statusEl = document.getElementById('reqStatus');
  if (statusEl) statusEl.addEventListener('change', filterRequests);
});
