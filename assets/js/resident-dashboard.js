let residentSocket;

const PENDING_STATUSES = ['pending approval', 'pending'];

function isPending(status) {
  return PENDING_STATUSES.includes((status || '').toLowerCase().trim());
}

function queryStatusFromUrl() {
  return new URLSearchParams(window.location.search).get('status') || 'all';
}

function pushStatus(status) {
  const url = new URL(window.location.href);
  if (status === 'all') url.searchParams.delete('status');
  else url.searchParams.set('status', status);
  window.history.replaceState({}, '', url);
}

async function loadResidentProfile() {
  const res = await fetch('/api/resident/profile');
  const data = await res.json();
  document.getElementById('residentName').textContent = `${data.first_name} ${data.last_name}`;
  connectResidentSocket(data.resident_id);
}

async function loadResidentStats() {
  const res = await fetch('/api/resident/stats');
  const stats = await res.json();
  document.getElementById('statTotal').textContent = stats.total_requests || 0;
  document.getElementById('statPending').textContent = stats.pending_count || 0;
  document.getElementById('statProcessing').textContent = stats.processing_count || 0;
  document.getElementById('statReady').textContent = stats.ready_count || 0;
  document.getElementById('statDeclined').textContent = stats.declined_count || 0;
}

async function loadResidentRequests() {
  const filter = queryStatusFromUrl();
  // "processing" is shown to residents but stored as "Approved" in DB
  const apiFilter = filter === 'processing' ? 'Approved' : filter;
  const res = await fetch(`/api/resident/requests?status=${encodeURIComponent(apiFilter)}`);
  const rows = await res.json();

  document.getElementById('requestRows').innerHTML = rows.map(row => {
    const pending = isPending(row.status);

    // Show "Processing" to residents instead of the internal "Approved" label
    const rawStatus = (row.status || '').trim();
    const displayStatus = rawStatus.toLowerCase() === 'approved' ? 'Processing' : rawStatus;

    // Build CSS class from display status
    const statusClass = displayStatus.toLowerCase().replace(/[^a-z]+/g, '-');

    const actions = `
      <div class="actions-col" style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-small btn-ghost" style="font-size:12px;padding:6px 12px"
          onclick="openDetails(${row.request_id}, ${pending})">👁 View</button>
        ${pending ? `<button class="btn btn-small btn-danger" style="font-size:12px;padding:6px 12px"
          onclick="deleteRequest(${row.request_id})">🗑 Delete</button>` : ''}
      </div>`;
    return `
      <tr>
        <td style="font-family:monospace;font-size:12px">${escapeHtml(row.transaction_no || '-')}</td>
        <td>${escapeHtml(row.document_name)}</td>
        <td>${peso(row.price_at_request)}</td>
        <td>${formatDate(row.suggested_release_date)}</td>
        <td>${formatDate(row.release_date)}</td>
        <td><span class="status-pill status-${statusClass}">${escapeHtml(displayStatus)}</span></td>
        <td>${formatDate(row.updated_at || row.created_at)}</td>
        <td>${actions}</td>
      </tr>`;
  }).join('') || `<tr><td colspan="8" class="empty-state">No requests found.</td></tr>`;

  document.querySelectorAll('.filter-card').forEach(card =>
    card.classList.toggle('active', card.dataset.status === filter)
  );
}

async function loadNotifications(markRead = false) {
  const res = await fetch('/api/resident/notifications');
  const items = await res.json();
  const unread = items.filter(item => !item.is_read).length;
  document.getElementById('notifCount').textContent = unread;
  document.getElementById('notifList').innerHTML = items.map(item => `
    <div class="notif-item ${item.is_read ? 'read' : 'unread'}">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.message)}</p>
      <span>${formatDateTime(item.created_at)}</span>
    </div>`).join('') || '<p class="empty-state">No notifications yet.</p>';

  if (markRead && unread > 0) {
    await fetch('/api/resident/notifications/read', { method: 'POST' });
    document.getElementById('notifCount').textContent = '0';
  }
}

async function loadInboxBadge() {
  const res = await fetch('/api/resident/inbox');
  const msgs = await res.json();
  const lastSeen = parseInt(localStorage.getItem('inbox_last_seen') || '0', 10);
  const unread = msgs.filter(m => m.message_id > lastSeen).length;
  const badge = document.getElementById('inboxBadge');
  if (!badge) return;
  badge.textContent = unread;
  badge.style.display = unread > 0 ? '' : 'none';
}

function connectResidentSocket(residentId) {
  if (residentSocket) return;
  residentSocket = io();
  residentSocket.emit('join:resident', residentId);
  residentSocket.emit('join:role', 'resident');
  residentSocket.on('notification:new', async (payload) => {
    if (payload && payload.from_captain) {
      await loadInboxBadge();
      return;
    }
    await loadNotifications();
    await loadResidentStats();
    await loadResidentRequests();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  showStatusMessage('pageMessage');
  await loadResidentProfile();
  await loadResidentStats();
  await loadResidentRequests();
  await loadNotifications();
  await loadInboxBadge();

  document.querySelectorAll('.filter-card').forEach(card =>
    card.addEventListener('click', async () => {
      pushStatus(card.dataset.status);
      await loadResidentRequests();
    })
  );

  const bellButton = document.getElementById('notifButton');
  const dropdown = document.getElementById('notifDropdown');
  bellButton.addEventListener('click', async () => {
    dropdown.classList.toggle('show');
    if (dropdown.classList.contains('show')) await loadNotifications(true);
  });
});
