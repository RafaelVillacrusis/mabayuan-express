let socket;
function getFilter() { return new URLSearchParams(window.location.search).get('status') || 'all'; }
function setFilter(status) { const url = new URL(window.location.href); status === 'all' ? url.searchParams.delete('status') : url.searchParams.set('status', status); window.history.replaceState({}, '', url); }
async function loadMe() { const res = await fetch('/api/staff/me'); const me = await res.json(); document.getElementById('staffName').textContent = me.full_name; }
async function loadCounts() { const res = await fetch('/api/staff/counts'); const counts = await res.json(); const map = { all: counts.total_requests || 0, Approved: counts.approved_count || 0, 'Ready for Pickup': counts.ready_count || 0, Claimed: counts.claimed_count || 0 }; document.querySelectorAll('.filter-card[data-status]').forEach(card => { card.querySelector('.filter-value').textContent = map[card.dataset.status] || 0; card.classList.toggle('active', card.dataset.status === getFilter()); }); document.getElementById('pendingResidentsCount').textContent = counts.pending_residents || 0; }
async function loadRequests() { const res = await fetch(`/api/staff/requests?status=${encodeURIComponent(getFilter())}`); const rows = await res.json(); document.getElementById('staffRequestRows').innerHTML = rows.map(row => `<tr><td>${escapeHtml(row.transaction_no)}</td><td>${escapeHtml(row.resident_name)}</td><td>${escapeHtml(row.document_name)}</td><td>${formatDate(row.suggested_release_date)}</td><td>${formatDate(row.release_date)}</td><td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${row.status}</span></td><td><a class="btn btn-small" href="/staff/request/${row.request_id}">Open</a></td></tr>`).join('') || `<tr><td colspan="7" class="empty-state">No requests found.</td></tr>`; }
async function loadPendingResidents() { const res = await fetch('/api/staff/pending-residents'); const rows = await res.json(); document.getElementById('pendingResidentsRows').innerHTML = rows.map(row => `<tr><td>${escapeHtml(row.last_name)}, ${escapeHtml(row.first_name)}</td><td>${escapeHtml(row.email)}</td><td>${escapeHtml(row.phone_number || '-')}</td><td>${escapeHtml(row.address || '-')}</td><td>${row.valid_id_path ? `<a class="btn btn-small" href="/api/staff/residents/${row.resident_id}/id-image" target="_blank">View ID</a>` : '-'}</td><td class="table-actions"><button class="btn btn-small" onclick="approveResident(${row.resident_id})">Approve</button><button class="btn btn-small btn-ghost" onclick="declineResident(${row.resident_id})">Decline</button></td></tr>`).join('') || `<tr><td colspan="6" class="empty-state">No pending residents.</td></tr>`; }
async function approveResident(id) { const res = await fetch(`/api/staff/residents/${id}/approve`, { method:'POST' }); if (!res.ok) alert('Could not approve resident.'); await refreshAll(); }
async function declineResident(id) {
  // Show decline reason modal
  showDeclineModal(id);
}

function showDeclineModal(residentId) {
  // Inject modal if not exists
  if (!document.getElementById('declineReasonModal')) {
    document.body.insertAdjacentHTML('afterbegin', `
    <div class="details-modal" id="declineReasonModal">
      <div class="details-card" style="max-width:460px;">
        <div class="details-head" style="background:linear-gradient(135deg,#8b1a22,#b03040);">
          <h2>🚫 Decline Account</h2>
          <button class="details-close" onclick="closeDeclineModal()">✕</button>
        </div>
        <div class="details-body" style="padding:22px 24px;">
          <p style="margin:0 0 16px;font-size:14px;color:#2d1518;">Please select a reason for declining this account registration:</p>
          <div style="margin-bottom:14px;">
            <label class="form-label">Reason</label>
            <select class="select" id="declineReasonSelect" onchange="handleDeclineReasonChange()">
              <option value="">Select a reason...</option>
              <option value="Invalid or unclear valid ID submitted.">Invalid or unclear valid ID</option>
              <option value="Valid ID does not match the provided personal information.">ID does not match personal information</option>
              <option value="Submitted ID has expired.">Expired ID</option>
              <option value="Incomplete personal information provided.">Incomplete personal information</option>
              <option value="Applicant is not a registered resident of Barangay Mabayuan.">Not a registered resident of Barangay Mabayuan</option>
              <option value="Duplicate account detected.">Duplicate account detected</option>
              <option value="others">Others (custom reason)</option>
            </select>
          </div>
          <div id="declineCustomWrap" style="display:none;margin-bottom:8px;">
            <label class="form-label">Custom Reason</label>
            <textarea class="input textarea" id="declineCustomReason" rows="3" placeholder="Type your reason here..." style="resize:vertical;min-height:80px;"></textarea>
          </div>
          <div id="declineReasonError" style="display:none;color:#dc2626;font-size:12px;margin-top:4px;"></div>
        </div>
        <div class="details-foot" style="justify-content:flex-end;">
          <button class="btn-delete" style="border-radius:10px;padding:11px 20px;" onclick="closeDeclineModal()">Cancel</button>
          <button class="btn-view" style="background:#8b1a22;border-radius:10px;padding:11px 20px;" onclick="submitDecline()">Confirm Decline</button>
        </div>
      </div>
    </div>`);
  }
  document.getElementById('declineReasonModal')._residentId = residentId;
  document.getElementById('declineReasonSelect').value = '';
  document.getElementById('declineCustomWrap').style.display = 'none';
  document.getElementById('declineCustomReason').value = '';
  document.getElementById('declineReasonError').style.display = 'none';
  document.getElementById('declineReasonModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function handleDeclineReasonChange() {
  const sel = document.getElementById('declineReasonSelect').value;
  document.getElementById('declineCustomWrap').style.display = sel === 'others' ? 'block' : 'none';
}

function closeDeclineModal() {
  document.getElementById('declineReasonModal').classList.remove('open');
  document.body.style.overflow = '';
}

async function submitDecline() {
  const modal = document.getElementById('declineReasonModal');
  const residentId = modal._residentId;
  const sel = document.getElementById('declineReasonSelect').value;
  const custom = document.getElementById('declineCustomReason').value.trim();
  const errorEl = document.getElementById('declineReasonError');

  if (!sel) {
    errorEl.textContent = 'Please select a reason.';
    errorEl.style.display = 'block';
    return;
  }
  if (sel === 'others' && !custom) {
    errorEl.textContent = 'Please enter a custom reason.';
    errorEl.style.display = 'block';
    return;
  }

  const reason = sel === 'others' ? custom : sel;
  errorEl.style.display = 'none';

  const res = await fetch(`/api/staff/residents/${residentId}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });

  closeDeclineModal();
  if (!res.ok) alert('Could not decline resident.');
  await refreshAll();
}
window.approveResident = approveResident; window.declineResident = declineResident;
async function refreshAll(){ await loadCounts(); await loadPendingResidents(); await loadRequests(); }
async function loadInboxBadge() {
  const res = await fetch('/api/staff/inbox');
  const msgs = await res.json();
  const lastSeen = parseInt(localStorage.getItem('staff_inbox_last_seen') || '0', 10);
  const unread = msgs.filter(m => m.message_id > lastSeen).length;
  const badge = document.getElementById('inboxBadge');
  const bellCount = document.getElementById('staffNotifCount');
  if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }
  if (bellCount) { bellCount.textContent = unread; bellCount.style.display = unread > 0 ? '' : 'none'; }
  return msgs;
}

function renderNotifDropdown(msgs) {
  const lastSeen = parseInt(localStorage.getItem('staff_inbox_last_seen') || '0', 10);
  const el = document.getElementById('staffNotifList');
  if (!el) return;
  el.innerHTML = msgs.length
    ? msgs.slice(0, 10).map(m => `
      <div class="notif-item ${m.message_id > lastSeen ? 'unread' : ''}">
        <strong>${escapeHtml(m.subject)}</strong>
        <p>${escapeHtml(m.body.length > 100 ? m.body.slice(0, 100) + '…' : m.body)}</p>
        <span>${formatDateTime(m.created_at)}</span>
      </div>`).join('') +
      `<div style="padding:10px 14px;text-align:center"><a href="/staff/inbox" class="btn btn-small btn-outline">View all messages</a></div>`
    : '<p style="padding:14px;color:var(--muted);font-size:.85rem">No messages yet.</p>';
}

function connectSocket() { if (socket) return; socket = io(); socket.emit('join:role', 'staff'); socket.on('dashboard:refresh', refreshAll); socket.on('notification:new', async (payload) => { if (payload && payload.from_captain) { showCaptainNotification(payload); const msgs = await loadInboxBadge(); renderNotifDropdown(msgs); } }); }

function showCaptainNotification(payload) {
  // Create or reuse a banner element
  let banner = document.getElementById('captainMsgBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'captainMsgBanner';
    banner.style.cssText = 'position:fixed;top:64px;right:16px;z-index:9999;max-width:360px;background:#fff;border:1px solid #8b5cf6;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:16px 20px;animation:slideIn .25s ease;';
    document.body.appendChild(banner);
    const style = document.createElement('style');
    style.textContent = '@keyframes slideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
  }
  banner.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:start;gap:8px"><div><div style="font-weight:700;font-size:.9rem;color:#6d28d9;margin-bottom:4px">${escapeHtml(payload.title)}</div><div style="font-size:.85rem;color:#374151;white-space:pre-wrap">${escapeHtml(payload.message)}</div><div style="font-size:.75rem;color:#9ca3af;margin-top:6px">${formatDateTime(payload.created_at)}</div></div><button onclick="document.getElementById('captainMsgBanner').remove()" style="background:none;border:none;font-size:1.1rem;cursor:pointer;color:#9ca3af;padding:0;line-height:1">×</button></div>`;
  clearTimeout(banner._timeout);
  banner._timeout = setTimeout(() => { if (banner.parentNode) banner.remove(); }, 12000);
}
document.addEventListener('DOMContentLoaded', async () => {
  await loadMe();
  await refreshAll();
  connectSocket();
  const msgs = await loadInboxBadge();
  renderNotifDropdown(msgs);
  document.querySelectorAll('.filter-card[data-status]').forEach(card => card.addEventListener('click', async () => { setFilter(card.dataset.status); await loadCounts(); await loadRequests(); }));
  const bellBtn = document.getElementById('staffNotifButton');
  const dropdown = document.getElementById('staffNotifDropdown');
  if (bellBtn && dropdown) {
    bellBtn.addEventListener('click', async () => {
      dropdown.classList.toggle('show');
      if (dropdown.classList.contains('show')) {
        const latest = await loadInboxBadge();
        renderNotifDropdown(latest);
      }
    });
  }
});
