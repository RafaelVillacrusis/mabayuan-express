/* Captain — review a single request */
const requestId = window.location.pathname.split('/').pop();

const ACTION_LABELS = {
  CREATE: 'Request submitted',
  CAPTAIN_APPROVE: 'Approved by the Captain',
  CAPTAIN_DECLINE: 'Declined by the Captain',
  CAPTAIN_DECISION: 'Reviewed by the Captain',
  SET_RELEASE_DATE: 'Release date set',
  MARK_CLAIMED: 'Marked as claimed',
};
const ROLE_LABELS = { resident: 'Resident', captain: 'Captain', staff: 'Staff', system_admin: 'System admin' };

function friendlyAction(log) {
  return ACTION_LABELS[log.action_type]
    || String(log.action_type || 'Update').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function renderHistory(logs) {
  if (!logs.length) return '<li><strong>No history yet</strong></li>';
  return logs.map(log => {
    const changes = [];
    if (log.new_status && log.new_status !== log.old_status) changes.push(`Status: ${escapeHtml(log.old_status || '—')} → <strong style="display:inline">${escapeHtml(log.new_status)}</strong>`);
    if (log.new_release_date && log.new_release_date !== log.old_release_date) changes.push(`Release date: ${escapeHtml(formatDate(log.new_release_date))}`);
    return `<li>
      <strong>${escapeHtml(friendlyAction(log))}</strong>
      <div class="st-tl-meta">${escapeHtml(ROLE_LABELS[log.changed_by_role] || log.changed_by_role || 'System')} · ${formatDateTime(log.created_at)}</div>
      ${changes.length ? `<p>${changes.join(' · ')}</p>` : ''}
      ${log.remarks ? `<p style="color:var(--muted)">“${escapeHtml(log.remarks)}”</p>` : ''}
    </li>`;
  }).join('');
}

function renderHeader(req) {
  const pending = req.status === 'Pending Approval';
  const declined = req.status === 'Declined';
  document.getElementById('reqTitle').textContent = req.transaction_no || 'Request';
  document.title = `${req.transaction_no} — Mabayuan Express Captain`;
  const pill = document.getElementById('reqStatusPill');
  pill.textContent = pending ? 'Needs your decision' : req.status;
  pill.className = `status-pill status-${String(req.status || '').toLowerCase().replace(/[^a-z]+/g, '-')}`;
  document.getElementById('reqSubtitle').textContent = `${req.document_name} for ${req.resident_name}`;

  // Progress
  const step = { 'Pending Approval': 0, Approved: 1, Declined: 1, 'Ready for Pickup': 2, Claimed: 3 }[req.status] ?? 0;
  document.querySelectorAll('#stProgress li').forEach((li, i) => {
    li.classList.toggle('done', i <= step);
    li.classList.toggle('current', pending && i === 1);
  });
  document.getElementById('pgSubmitted').textContent = req.created_at ? formatDate(req.created_at) : '';
  document.getElementById('pgDecisionLabel').textContent = declined ? 'Declined' : pending ? 'Captain decision' : 'Captain approved';
  document.getElementById('pgDecision').textContent = pending ? 'Waiting for you' : declined ? 'Request ended' : 'Sent to staff';
  if (declined) document.querySelectorAll('#stProgress li').forEach((li, i) => { if (i > 1) li.style.opacity = '.4'; });
  if (req.release_date) document.getElementById('pgReady').textContent = `Release ${formatDate(req.release_date)}`;

  // Next step / outcome
  const next = document.getElementById('stNext');
  const msg = pending
    ? ['⚖️ This request needs your decision', 'Check the resident details, purpose and valid ID, then approve or decline below.']
    : declined ? ['✖ You declined this request', 'The resident was notified by email. No further action is needed.']
    : req.status === 'Approved' ? ['✓ Approved — waiting for staff', 'Staff will set a release date and notify the resident.']
    : req.status === 'Ready for Pickup' ? ['📦 Ready for pickup', `The resident can claim the document${req.release_date ? ' from ' + formatDate(req.release_date) : ''}.`]
    : req.status === 'Claimed' ? ['🎉 Completed', 'The resident has picked up the document.'] : null;
  next.hidden = !msg;
  if (msg) {
    next.classList.toggle('done', !pending && !declined);
    next.innerHTML = `<div><strong>${msg[0]}</strong>${escapeHtml(msg[1])}</div>`;
  }

  // Decision card only while waiting for the Captain
  document.getElementById('decisionCard').hidden = !pending;
  const done = document.getElementById('decisionDone');
  done.hidden = pending;
  if (!pending) {
    done.innerHTML = `<h3>Decision</h3>
      <p style="margin:0 0 6px"><span class="status-pill status-${declined ? 'declined' : 'approved'}">${declined ? 'Declined' : 'Approved'}</span></p>
      ${req.captain_notes ? `<p style="margin:8px 0 0;line-height:1.6">Your note: “${escapeHtml(req.captain_notes)}”</p>` : '<p style="margin:8px 0 0;color:var(--muted)">No note was added.</p>'}`;
  }
}

async function loadRequest() {
  const res = await fetch(`/api/captain/requests/${requestId}`);
  const data = await res.json();
  const req = data.request;
  document.getElementById('residentName').textContent = req.resident_name;
  document.getElementById('residentAddress').textContent = req.address || '-';
  document.getElementById('residentContact').textContent = req.contact_number || req.phone_number || '-';
  document.getElementById('residentEmail').textContent = req.email || '-';
  document.getElementById('requestTransaction').textContent = req.transaction_no;
  document.getElementById('requestDocument').textContent = req.document_name;
  document.getElementById('requestPrice').textContent = peso(req.price_at_request);
  document.getElementById('requestSuggested').textContent = formatDate(req.suggested_release_date);
  document.getElementById('requestStatus').textContent = req.status;
  document.getElementById('requestPurpose').textContent = req.purpose || '-';
  renderRequestValidId(req, 'captain');
  document.getElementById('captainNotes').value = req.captain_notes || '';
  document.getElementById('logList').innerHTML = renderHistory(data.logs || []);
  document.getElementById('decisionForm').action = `/api/captain/requests/${requestId}/decision`;
  renderHeader(req);
}

// ── Decide: choose → confirm → submit ─────────────────────────────────────
function setupDecision() {
  const form = document.getElementById('decisionForm');
  const notes = document.getElementById('captainNotes');
  const err = document.getElementById('decisionError');
  const confirmBox = document.getElementById('decisionConfirm');
  const buttons = document.getElementById('decisionButtons');

  function reset() {
    confirmBox.hidden = true;
    buttons.hidden = false;
    err.style.display = 'none';
  }
  notes.addEventListener('input', () => { err.style.display = 'none'; });

  buttons.addEventListener('click', e => {
    const b = e.target.closest('[data-decide]');
    if (!b) return;
    const decision = b.dataset.decide;
    if (decision === 'decline' && notes.value.trim().length < 5) {
      err.textContent = 'Please write the reason for declining. It will be included in the email to the resident.';
      err.style.display = 'block';
      notes.focus();
      return;
    }
    document.getElementById('decisionValue').value = decision;
    const approve = decision === 'approve';
    buttons.hidden = true;
    confirmBox.hidden = false;
    confirmBox.classList.toggle('done', approve);
    confirmBox.innerHTML = `<div style="flex:1">
      <strong>${approve ? 'Approve this request?' : 'Decline this request?'}</strong>
      ${approve ? 'It will be sent to staff for processing and the resident will be emailed.' : 'The request will end and the resident will be emailed your reason.'}
      <div class="button-row" style="justify-content:flex-end;margin-top:10px;">
        <button type="button" class="btn btn-small btn-ghost" id="decisionCancel">Cancel</button>
        <button type="submit" class="btn btn-small ${approve ? '' : 'btn-danger'}" id="decisionSubmit">${approve ? '✓ Yes, approve' : '✖ Yes, decline'}</button>
      </div></div>`;
    document.getElementById('decisionCancel').addEventListener('click', reset);
  });

  form.addEventListener('submit', () => {
    const s = document.getElementById('decisionSubmit');
    if (s) { s.disabled = true; s.textContent = 'Saving…'; }
  });
  window.addEventListener('pageshow', reset);
}

document.addEventListener('DOMContentLoaded', async () => {
  showStatusMessage('pageMessage');
  const error = new URLSearchParams(window.location.search).get('error');
  if (error) {
    const m = document.getElementById('pageMessage');
    m.textContent = `⚠️ ${error}`;
    m.style.cssText = 'display:block;background:#fef2f2;color:#b42318;border:1px solid #fecaca;';
  }
  setupDecision();
  await loadRequest();
});
