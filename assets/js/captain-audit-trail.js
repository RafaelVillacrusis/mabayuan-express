let socket;
let _auditRows = [];
let auditPg;

const ACTION_LABELS = {
  SET_RELEASE_DATE: 'Set Release Date',
  MARK_CLAIMED:     'Marked as Claimed',
  CAPTAIN_APPROVE:  'Captain Approved',
  CAPTAIN_DECLINE:  'Captain Declined',
  STAFF_PROCESS:    'Staff Processed',
};
function actionLabel(key) { return ACTION_LABELS[key] || escapeHtml(key || '-'); }
function actionBadgeClass(key) {
  if (key === 'MARK_CLAIMED')     return 'status-claimed';
  if (key === 'SET_RELEASE_DATE') return 'status-ready-for-pickup';
  if (key === 'CAPTAIN_APPROVE')  return 'status-approved';
  if (key === 'CAPTAIN_DECLINE')  return 'status-declined';
  return 'status-pending-approval';
}
function detailsHtml(row) {
  const parts = [];
  if (row.old_status && row.new_status && row.old_status !== row.new_status)
    parts.push(`${escapeHtml(row.old_status)} → <strong>${escapeHtml(row.new_status)}</strong>`);
  if (row.new_release_date) parts.push(`Release: <strong>${escapeHtml(row.new_release_date)}</strong>`);
  if (row.remarks)           parts.push(`Note: ${escapeHtml(row.remarks)}`);
  return parts.length ? parts.join('<br>') : '—';
}

function renderAuditRow(row) {
  return `<tr>
    <td style="white-space:nowrap">${formatDateTime(row.created_at)}</td>
    <td>${escapeHtml(row.document_name  || '—')}</td>
    <td>${escapeHtml(row.resident_name  || '—')}</td>
    <td><span class="status-pill ${actionBadgeClass(row.action_type)}">${actionLabel(row.action_type)}</span></td>
    <td>${escapeHtml(row.changed_by_name || row.changed_by_role || '—')}</td>
    <td style="font-size:0.85rem;line-height:1.5">${detailsHtml(row)}</td>
  </tr>`;
}

async function loadAuditLogs() {
  const search   = document.getElementById('searchFilter').value.trim();
  const action   = document.getElementById('actionFilter').value;
  const dateFrom = document.getElementById('dateFromFilter').value;
  const dateTo   = document.getElementById('dateToFilter').value;
  const params   = new URLSearchParams();
  if (search)   params.set('search',    search);
  if (action)   params.set('action',    action);
  if (dateFrom) params.set('date_from', dateFrom);
  if (dateTo)   params.set('date_to',   dateTo);

  const res  = await fetch(`/api/captain/audit-trail?${params.toString()}`);
  _auditRows = await res.json();
  auditPg.setRows(_auditRows, renderAuditRow);
}

function bindFilters() {
  document.getElementById('applyFilters').addEventListener('click', loadAuditLogs);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('searchFilter').value   = '';
    document.getElementById('actionFilter').value   = '';
    document.getElementById('dateFromFilter').value = '';
    document.getElementById('dateToFilter').value   = '';
    loadAuditLogs();
  });
  let t;
  document.getElementById('searchFilter').addEventListener('input', () => {
    clearTimeout(t); t = setTimeout(loadAuditLogs, 300);
  });
}

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.emit('join:role', 'captain');
  socket.on('dashboard:refresh', loadAuditLogs);
}

document.addEventListener('DOMContentLoaded', async () => {
  auditPg = createPaginator('auditRows', 'auditPg', 10);
  bindFilters();
  await loadAuditLogs();
  connectSocket();
});
