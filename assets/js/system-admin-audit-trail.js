let socket;
let _auditRows = [];
let auditPg;

async function loadAuditLogs() {
  const params = new URLSearchParams({
    actor:       document.getElementById('actorFilter').value.trim(),
    action:      document.getElementById('actionFilter').value.trim(),
    target_type: document.getElementById('targetTypeFilter').value,
    date_from:   document.getElementById('dateFromFilter').value,
    date_to:     document.getElementById('dateToFilter').value,
    limit: '500'
  });
  const res  = await fetch(`/api/system-admin/audit-logs?${params.toString()}`);
  _auditRows = await res.json();
  auditPg.setRows(_auditRows, row => `
    <tr>
      <td>${formatDateTime(row.created_at)}</td>
      <td>${escapeHtml(row.actor_name || 'System')}</td>
      <td>${escapeHtml(row.actor_role || '-')}</td>
      <td>${escapeHtml(row.action)}</td>
      <td>${escapeHtml(row.target_type)}${row.target_id ? ' #' + escapeHtml(String(row.target_id)) : ''}</td>
      <td>${escapeHtml(row.description || '-')}</td>
    </tr>`);
}

function bindFilters() {
  document.getElementById('auditFilterForm').addEventListener('submit', async (e) => {
    e.preventDefault(); await loadAuditLogs();
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
  auditPg = createPaginator('auditRows', 'sysAuditPg', 10);
  bindFilters();
  await loadAuditLogs();
  connectSocket();
});
