let socket;

async function loadAuditLogs() {
  const params = new URLSearchParams({
    actor: document.getElementById('actorFilter').value.trim(),
    action: document.getElementById('actionFilter').value.trim(),
    target_type: document.getElementById('targetTypeFilter').value,
    date_from: document.getElementById('dateFromFilter').value,
    date_to: document.getElementById('dateToFilter').value,
    limit: '200'
  });

  const res = await fetch(`/api/system-admin/audit-logs?${params.toString()}`);
  const rows = await res.json();
  document.getElementById('auditRows').innerHTML = rows.map(row => `
    <tr>
      <td>${formatDateTime(row.created_at)}</td>
      <td>${escapeHtml(row.actor_name || 'System')}</td>
      <td>${escapeHtml(row.actor_role || '-')}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.target_type)}${row.target_id ? ' #' + escapeHtml(String(row.target_id)) : ''}</td>
      <td>${escapeHtml(row.description || '-')}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="empty-state">No audit logs found.</td></tr>`;
}

function bindFilters() {
  document.getElementById('auditFilterForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadAuditLogs();
  });

  document.getElementById('resetAuditFilters').addEventListener('click', async () => {
    document.getElementById('auditFilterForm').reset();
    await loadAuditLogs();
  });
}

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.emit('join:role', 'system_admin');
  socket.on('dashboard:refresh', loadAuditLogs);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindFilters();
  await loadAuditLogs();
  connectSocket();
});
