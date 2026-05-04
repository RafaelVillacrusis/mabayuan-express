let socket;

async function loadRequests() {
  const res = await fetch('/api/system-admin/requests');
  const rows = await res.json();
  document.getElementById('requestRows').innerHTML = rows.slice(0, 50).map(row => `
    <tr>
      <td>${escapeHtml(row.transaction_no)}</td>
      <td>${escapeHtml(row.resident_name)}</td>
      <td>${escapeHtml(row.document_name)}</td>
      <td>${escapeHtml(row.status)}</td>
      <td>${formatDate(row.suggested_release_date)}</td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty-state">No requests found.</td></tr>`;
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
