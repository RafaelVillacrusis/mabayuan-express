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
  }).join('') || (filter === 'all'
    ? `<tr><td colspan="8" class="empty-state"><div class="rd-empty">
         <div class="rd-empty-icon">📭</div><strong>No requests yet</strong>
         <p>Your document requests will appear here once you submit one.</p>
         <a class="btn btn-small" href="/resident/request">+ Request your first document</a></div></td></tr>`
    : `<tr><td colspan="8" class="empty-state"><div class="rd-empty">
         <div class="rd-empty-icon">🔍</div><strong>No ${escapeHtml(FILTER_LABELS[filter] || filter)} requests</strong>
         <p>Click "Total Requests" above to see all of your requests.</p></div></td></tr>`);

  document.querySelectorAll('.filter-card').forEach(card =>
    card.classList.toggle('active', card.dataset.status === filter)
  );
  const note = document.getElementById('rdFilterNote');
  if (note) note.textContent = filter === 'all'
    ? 'Showing all requests. Click a card above to filter by status.'
    : `Showing ${FILTER_LABELS[filter] || filter} requests only.`;
}

const FILTER_LABELS = { pending: 'Pending', processing: 'Processing', ready: 'Ready for Pickup', declined: 'Declined' };

// Latest barangay announcements (captain messages to residents) for the sidebar
function renderAnnouncements(msgs, lastSeen) {
  const list = document.getElementById('rdAnnouncements');
  if (!list) return;
  list.innerHTML = msgs.length ? msgs.slice(0, 3).map(m => `
    <li>
      <div class="rd-ann-title">${m.message_id > lastSeen ? '<span class="rd-ann-new">NEW</span>' : ''}<span>${escapeHtml(m.subject)}</span></div>
      <div class="rd-ann-meta">${formatDate(m.created_at)}${m.captain_name ? ` · ${escapeHtml(m.captain_name)}` : ''}</div>
      <p class="rd-ann-body">${escapeHtml(m.body)}</p>
    </li>`).join('')
    : '<li class="rd-muted">No announcements yet. Barangay news and advisories will appear here.</li>';
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
  renderAnnouncements(msgs, lastSeen);
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
  const today = document.getElementById('rdToday');
  if (today) today.textContent = new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
