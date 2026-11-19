let staffReqPg, pendingResPg;
let pendingResidentsById = new Map();
let allStaffRequests = [];
let staffSortCol = 'suggested_release_date', staffSortDir = 'asc';
let socket;
function getFilter() { return new URLSearchParams(window.location.search).get('status') || 'all'; }
function setFilter(status) { const url = new URL(window.location.href); status === 'all' ? url.searchParams.delete('status') : url.searchParams.set('status', status); window.history.replaceState({}, '', url); }
async function loadMe() { const res = await fetch('/api/staff/me'); const me = await res.json(); document.getElementById('staffName').textContent = (me.full_name || 'Staff').split(' ')[0]; const t = document.getElementById('stToday'); if (t) t.textContent = new Date().toLocaleDateString('en-PH', { weekday:'long', month:'long', day:'numeric', year:'numeric' }); }
async function loadCounts() { const res = await fetch('/api/staff/counts'); const counts = await res.json(); const map = { all: counts.total_requests || 0, Approved: counts.approved_count || 0, 'Ready for Pickup': counts.ready_count || 0, Claimed: counts.claimed_count || 0 }; document.querySelectorAll('.filter-card[data-status]').forEach(card => { card.querySelector('.filter-value').textContent = map[card.dataset.status] || 0; card.classList.toggle('active', card.dataset.status === getFilter()); }); const pend = Number(counts.pending_residents || 0); document.getElementById('pendingResidentsCount').textContent = pend; document.getElementById('pendingResidentsCard')?.classList.toggle('st-attention', pend > 0); const hc = document.getElementById('pendingHeadCount'); if (hc) { hc.textContent = pend; hc.hidden = pend === 0; } }
async function loadRequests() {
  const res = await fetch('/api/staff/requests?status=all');
  allStaffRequests = await res.json();
  renderStaffQueue();
}

function getStaffQueueFiltered() {
  const search   = (document.getElementById('staffQueueSearch')?.value || '').trim().toLowerCase();
  const status   = document.getElementById('staffQueueStatus')?.value || 'all';
  const dateFrom = document.getElementById('staffQueueDateFrom')?.value || '';
  const dateTo   = document.getElementById('staffQueueDateTo')?.value || '';
  const cardFilter = getFilter();

  let rows = allStaffRequests.filter(row => {
    if (cardFilter !== 'all' && row.status !== cardFilter) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (dateFrom || dateTo) {
      const d = (row.suggested_release_date || '').slice(0, 10);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
    }
    if (search) {
      const hay = [row.transaction_no, row.resident_name, row.document_name, row.status].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  rows.sort((a, b) => {
    let va = a[staffSortCol] ?? '', vb = b[staffSortCol] ?? '';
    va = String(va).toLowerCase(); vb = String(vb).toLowerCase();
    if (va < vb) return staffSortDir === 'asc' ? -1 : 1;
    if (va > vb) return staffSortDir === 'asc' ?  1 : -1;
    return 0;
  });

  return rows;
}

function renderStaffQueue() {
  const rows = getStaffQueueFiltered();
  // Update sort indicators
  document.querySelectorAll('#staffQueueTable thead th[data-col]').forEach(th => {
    th.classList.toggle('sort-asc',  th.dataset.col === staffSortCol && staffSortDir === 'asc');
    th.classList.toggle('sort-desc', th.dataset.col === staffSortCol && staffSortDir === 'desc');
  });
  if (!staffReqPg) staffReqPg = createPaginator('staffRequestRows', 'staffReqPg', 10);
  staffReqPg.setRows(rows, row => `<tr>
    <td>${escapeHtml(row.transaction_no)}</td>
    <td>${escapeHtml(row.resident_name)}</td>
    <td>${escapeHtml(row.document_name)}</td>
    <td>${formatDate(row.suggested_release_date)}</td>
    <td>${formatDate(row.release_date)}</td>
    <td><span class="status-pill status-${row.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${escapeHtml(row.status)}</span></td>
    <td><a class="btn btn-small" href="/staff/request/${row.request_id}">Open</a></td>
  </tr>`);
}
async function loadPendingResidents() {
  const res  = await fetch('/api/staff/pending-residents');
  const rows = await res.json();
  if (!pendingResPg) pendingResPg = createPaginator('pendingResidentsRows', 'pendingResPg', 10);
  pendingResidentsById = new Map(rows.map(r => [String(r.resident_id), r]));
  pendingResPg.setRows(rows, row => `<tr>
    <td>${escapeHtml(row.last_name)}, ${escapeHtml(row.first_name)}</td>
    <td>${escapeHtml(row.email)}</td>
    <td>${escapeHtml(row.phone_number || '-')}</td>
    <td>${escapeHtml(row.address || '-')}</td>
    <td>${docStatusHtml(row)}</td>
    <td class="table-actions"><button class="btn btn-small" onclick="openReviewModal(${row.resident_id})">Review</button></td>
  </tr>`);
}


function docStatusHtml(row) {
  const id   = row.valid_id_path ? `<div>🪪 ${escapeHtml(row.valid_id_type || 'Valid ID')}</div>` : '<div style="color:#dc2626">🪪 No valid ID</div>';
  const cert = row.residency_cert_path ? '<div>📄 Certificate of Residency</div>' : '<div style="color:#dc2626">📄 No certificate</div>';
  return `<div style="font-size:12px;line-height:1.6">${id}${cert}</div>`;
}

// Renders an uploaded document (image or PDF) for the review modal
function reviewDocHtml(title, subtitle, url, storedPath) {
  if (!storedPath || storedPath.startsWith('missing:')) {
    return `<div class="review-doc"><div class="review-doc-head"><strong>${title}</strong><span>${escapeHtml(subtitle)}</span></div>
      <div class="review-doc-empty">Not provided${storedPath ? ' (file lost — resident must re-upload)' : ''}</div></div>`;
  }
  const isPdf = /\.pdf$/i.test(storedPath);
  const preview = isPdf
    ? `<iframe src="${url}" title="${title}"></iframe>`
    : `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${title}"></a>`;
  return `<div class="review-doc"><div class="review-doc-head"><strong>${title}</strong><span>${escapeHtml(subtitle)}</span>
    <a class="btn btn-small btn-ghost" href="${url}" target="_blank" rel="noopener">Open full size ↗</a></div>
    <div class="review-doc-preview">${preview}</div></div>`;
}

function ensureReviewModal() {
  if (document.getElementById('residentReviewModal')) return;
  document.head.insertAdjacentHTML('beforeend', `<style>
    #residentReviewModal .details-card { width:min(1000px,100%); max-height:92vh; }
    .review-info { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px 18px; margin-bottom:18px; font-size:14px; }
    .review-info div span { display:block; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#9a7a7d; font-weight:700; }
    .review-docs { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; }
    .review-doc { border:1px solid #f0e4e5; border-radius:14px; overflow:hidden; background:#fdf8f8; display:flex; flex-direction:column; }
    .review-doc-head { display:flex; flex-wrap:wrap; align-items:center; gap:6px 10px; padding:10px 12px; border-bottom:1px solid #f0e4e5; background:#fff; }
    .review-doc-head strong { flex:1 1 100%; font-size:14px; color:#2d1518; }
    .review-doc-head span { flex:1; font-size:12px; color:#6b5b6e; }
    .review-doc-preview { height:340px; display:flex; align-items:center; justify-content:center; background:#f5f0f1; }
    .review-doc-preview a { display:flex; width:100%; height:100%; align-items:center; justify-content:center; }
    .review-doc-preview img { max-width:100%; max-height:100%; object-fit:contain; }
    .review-doc-preview iframe { width:100%; height:100%; border:0; background:#fff; }
    .review-doc-empty { padding:40px 16px; text-align:center; color:#dc2626; font-size:13px; }
    .review-checklist { margin:18px 0 0; padding:12px 16px; background:#fdf4dc; border:1px solid #e8d48a; border-radius:10px; font-size:13px; color:#5c4500; }
    .review-checklist ul { margin:6px 0 0; padding-left:18px; }
  </style>`);
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="details-modal" id="residentReviewModal" role="dialog" aria-modal="true" aria-labelledby="reviewTitle">
      <div class="details-card">
        <div class="details-head">
          <h2 id="reviewTitle">Review Registration</h2>
          <button class="details-close" onclick="closeReviewModal()" aria-label="Close">✕</button>
        </div>
        <div class="details-body" id="reviewBody"></div>
        <div class="details-foot" style="justify-content:flex-end;">
          <span id="reviewError" style="display:none;color:#dc2626;font-size:13px;align-self:center;margin-right:auto;"></span>
          <button class="btn-delete" id="reviewDeclineBtn">Decline</button>
          <button class="btn-view" id="reviewApproveBtn">✓ Approve Account</button>
        </div>
      </div>
    </div>`);
  document.getElementById('residentReviewModal').addEventListener('click', e => { if (e.target.id === 'residentReviewModal') closeReviewModal(); });
}

function openReviewModal(residentId) {
  const r = pendingResidentsById.get(String(residentId));
  if (!r) return;
  ensureReviewModal();
  const fullName = [r.first_name, r.middle_name, r.last_name, r.suffix].filter(Boolean).join(' ');
  document.getElementById('reviewTitle').textContent = `Review Registration — ${fullName}`;
  document.getElementById('reviewBody').innerHTML = `
    <div class="review-info">
      <div><span>Full name</span>${escapeHtml(fullName)}</div>
      <div><span>Birth date</span>${r.birth_date ? formatDate(r.birth_date) : '—'}</div>
      <div><span>Email</span>${escapeHtml(r.email)}</div>
      <div><span>Phone</span>${escapeHtml(r.phone_number || '—')}</div>
      <div style="grid-column:1/-1"><span>Address</span>${escapeHtml(r.address || '—')}</div>
      <div><span>Registered</span>${formatDateTime(r.created_at)}</div>
    </div>
    <div class="review-docs">
      ${reviewDocHtml('Valid ID', r.valid_id_type || 'ID type not specified', `/api/staff/residents/${r.resident_id}/id-image`, r.valid_id_path)}
      ${reviewDocHtml('Barangay Certificate of Residency', 'Proof of residency in Barangay Mabayuan', `/api/staff/residents/${r.resident_id}/residency-cert`, r.residency_cert_path)}
    </div>
    <div class="review-checklist"><strong>Before approving, confirm that:</strong>
      <ul>
        <li>The name and birth date on the valid ID match the details above.</li>
        <li>The ID is clear, readable, and not expired.</li>
        <li>The Certificate of Residency was issued by Barangay Mabayuan and names this applicant.</li>
      </ul>
    </div>`;
  document.getElementById('reviewError').style.display = 'none';
  const approveBtn = document.getElementById('reviewApproveBtn');
  approveBtn.disabled = false;
  approveBtn.textContent = '✓ Approve Account';
  approveBtn.onclick = () => approveResident(residentId);
  document.getElementById('reviewDeclineBtn').onclick = () => { closeReviewModal(); declineResident(residentId); };
  document.getElementById('residentReviewModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeReviewModal() {
  const modal = document.getElementById('residentReviewModal');
  if (modal) modal.classList.remove('open');
  document.body.style.overflow = '';
}
window.openReviewModal = openReviewModal; window.closeReviewModal = closeReviewModal;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReviewModal(); });

async function approveResident(id) {
  const btn = document.getElementById('reviewApproveBtn');
  const errEl = document.getElementById('reviewError');
  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }
  const res = await fetch(`/api/staff/residents/${id}/approve`, { method:'POST' });
  if (!res.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Approve Account'; }
    if (errEl) { errEl.textContent = 'Could not approve resident. Please try again.'; errEl.style.display = 'inline'; }
    return;
  }
  closeReviewModal();
  await refreshAll();
}
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
  if (window.stSetInboxBadge) window.stSetInboxBadge(unread);
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
  // "Residents to Verify" card jumps to the pending list
  const pendCard = document.getElementById('pendingResidentsCard');
  const goPending = () => document.getElementById('pendingResidentsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  pendCard?.addEventListener('click', goPending);
  pendCard?.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goPending(); } });
  await loadMe();
  await refreshAll();
  connectSocket();
  const msgs = await loadInboxBadge();
  renderNotifDropdown(msgs);
  document.querySelectorAll('.filter-card[data-status]').forEach(card => card.addEventListener('click', async () => {
    setFilter(card.dataset.status);
    await loadCounts();
    renderStaffQueue();
  }));

  // Queue filter controls
  let qTimer;
  document.getElementById('staffQueueSearch')?.addEventListener('input', () => {
    clearTimeout(qTimer); qTimer = setTimeout(renderStaffQueue, 250);
  });
  document.getElementById('staffQueueStatus')?.addEventListener('change', renderStaffQueue);
  document.getElementById('staffQueueApply')?.addEventListener('click', renderStaffQueue);
  document.getElementById('staffQueueReset')?.addEventListener('click', () => {
    document.getElementById('staffQueueSearch').value  = '';
    document.getElementById('staffQueueStatus').value  = 'all';
    document.getElementById('staffQueueDateFrom').value = '';
    document.getElementById('staffQueueDateTo').value   = '';
    setFilter('all');
    document.querySelectorAll('.filter-card[data-status]').forEach(c =>
      c.classList.toggle('active', c.dataset.status === 'all'));
    renderStaffQueue();
  });

  // Sort headers
  document.querySelectorAll('#staffQueueTable thead th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (staffSortCol === col) staffSortDir = staffSortDir === 'asc' ? 'desc' : 'asc';
      else { staffSortCol = col; staffSortDir = 'asc'; }
      renderStaffQueue();
    });
  });
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
