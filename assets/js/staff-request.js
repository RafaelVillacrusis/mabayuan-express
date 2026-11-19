async function loadRequest() {
  const requestId = window.location.pathname.split('/').pop();
  const res = await fetch(`/api/staff/requests/${requestId}`);
  const data = await res.json();
  const req = data.request;
  document.getElementById('residentName').textContent = req.resident_name;
  document.getElementById('residentContact').textContent = req.contact_number || req.phone_number || '-';
  document.getElementById('requestTransaction').textContent = req.transaction_no;
  document.getElementById('requestDocument').textContent = req.document_name;
  document.getElementById('requestPrice').textContent = peso(req.price_at_request);
  document.getElementById('requestSuggested').textContent = formatDate(req.suggested_release_date);
  document.getElementById('requestRelease').textContent = formatDate(req.release_date);
  document.getElementById('requestStatus').textContent = req.status;
  document.getElementById('requestPurpose').textContent = req.purpose || '-';
  renderRequestValidId(req, 'staff');
  const initial = req.release_date || req.suggested_release_date;
  setReleaseDate(initial ? new Date(initial).toISOString().slice(0, 10) : '');
  document.getElementById('staffNotesRelease').value = req.staff_notes || '';
  document.getElementById('staffNotesClaim').value = req.staff_notes || '';
  document.getElementById('printReportLink').href = `/staff/request/${requestId}/report`;

  renderRequestHeader(req);
  document.getElementById('logList').innerHTML = renderHistory(data.logs || []);
  document.getElementById('releaseForm').action = `/api/staff/requests/${requestId}/set-release`;
  document.getElementById('claimForm').action = `/api/staff/requests/${requestId}/claim`;

  // Show/hide action cards based on current request status
  const status = req.status;
  const releaseCard = document.getElementById('releaseForm').closest('.info-card');
  const claimCard = document.getElementById('claimForm').closest('.info-card');
  releaseCard.style.display = status === 'Approved' ? '' : 'none';
  claimCard.style.display = status === 'Ready for Pickup' ? '' : 'none';
}

document.addEventListener('DOMContentLoaded', async()=>{
  showStatusMessage('pageMessage');
  await loadRequest();

  // Release date must be today (Philippine time) or later
  const todayPHT = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  document.getElementById('releaseDatePicker').min = todayPHT;
  const current = document.getElementById('releaseDateInput').value;
  if (!current || current < todayPHT) setReleaseDate(todayPHT);
  setupReleaseDateField(todayPHT);

  // Intercept release form — validate date before submitting
  document.getElementById('releaseForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const problem = checkReleaseDate(todayPHT);
    if (problem) {
      showReleaseHint(problem, 'bad');
      document.getElementById('releaseDateText').focus();
      return;
    }
    const btn = document.getElementById('releaseBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const formData = new FormData(this);
    const res = await fetch(this.action, {
      method: 'POST',
      body: new URLSearchParams(formData)
    });
    if (res.ok) {
      window.location.href = `/staff/request/${window.location.pathname.split('/').pop()}?saved=1`;
    } else {
      const data = await res.json().catch(() => ({}));
      if (btn) { btn.disabled = false; btn.textContent = 'Save & notify resident'; }
      alert(data.error || 'Could not save release date. Please try again.');
    }
  });
});

/* ── Header, progress, and next step ───────────────────────────────── */
const STATUS_STEP = { 'Pending Approval': 0, 'Approved': 1, 'Ready for Pickup': 2, 'Claimed': 3 };

function renderRequestHeader(req) {
  document.getElementById('reqTitle').textContent = req.transaction_no || 'Request';
  const pill = document.getElementById('reqStatusPill');
  const label = req.status === 'Approved' ? 'To process' : req.status;
  pill.textContent = label;
  pill.className = `status-pill status-${String(req.status || '').toLowerCase().replace(/[^a-z]+/g, '-')}`;
  document.getElementById('reqSubtitle').textContent = `${req.document_name} for ${req.resident_name}`;
  document.title = `${req.transaction_no} — Mabayuan Express Staff`;

  const step = STATUS_STEP[req.status] ?? 0;
  document.querySelectorAll('#stProgress li').forEach((li, i) => {
    li.classList.toggle('done', i <= step);
    li.classList.toggle('current', i === step + 1 && req.status !== 'Claimed' && req.status !== 'Declined');
  });
  document.getElementById('pgSubmitted').textContent = req.created_at ? formatDate(req.created_at) : '';
  if (req.release_date) document.getElementById('pgReady').textContent = `Release ${formatDate(req.release_date)}`;

  const next = document.getElementById('stNext');
  const msgs = {
    'Approved': ['📅 Next step: set the release date', 'Pick a date below. The resident will be emailed that their document is ready for pickup.'],
    'Ready for Pickup': ['✅ Next step: mark as claimed when picked up', `The resident can pick up the document${req.release_date ? ' from ' + formatDate(req.release_date) : ''}. Mark it as claimed once they have it.`],
    'Claimed': ['🎉 Completed', 'This document has been picked up. No further action is needed.'],
  };
  const m = msgs[req.status];
  next.hidden = !m;
  if (m) {
    next.classList.toggle('done', req.status === 'Claimed');
    next.innerHTML = `<div><strong>${m[0]}</strong>${escapeHtml(m[1])}</div>`;
  }
}

/* ── Readable history timeline ────────────────────────────────────── */
const ACTION_LABELS = {
  CREATE: 'Request submitted',
  CAPTAIN_DECISION: 'Reviewed by the Captain',
  CAPTAIN_APPROVE: 'Approved by the Captain',
  CAPTAIN_DECLINE: 'Declined by the Captain',
  SET_RELEASE: 'Release date set',
  SET_RELEASE_DATE: 'Release date set',
  CLAIM: 'Marked as claimed',
  CLAIMED: 'Marked as claimed',
  MARK_CLAIMED: 'Marked as claimed',
};
const ROLE_LABELS = { resident: 'Resident', captain: 'Captain', staff: 'Staff', system_admin: 'System admin' };

function friendlyAction(log) {
  if (ACTION_LABELS[log.action_type]) return ACTION_LABELS[log.action_type];
  return String(log.action_type || 'Update').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
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

// Disable the claim button while submitting
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('claimForm')?.addEventListener('submit', () => {
    const b = document.getElementById('claimBtn');
    if (b) { b.disabled = true; b.textContent = 'Saving…'; }
  });
});

/* ── Release date field: typed as mm/dd/yy, stored as YYYY-MM-DD ───── */
const pad2 = n => String(n).padStart(2, '0');
// "YYYY-MM-DD" → "mm/dd/yy"
function isoToMdy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : '';
}
// "mm/dd/yy" → "YYYY-MM-DD", or '' if it isn't a real date
function mdyToIso(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(text || '');
  if (!m) return '';
  const [mm, dd, yyyy] = [Number(m[1]), Number(m[2]), 2000 + Number(m[3])];
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return '';
  return `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
}
function longDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function showReleaseHint(msg, kind) {
  const h = document.getElementById('releaseDateHint');
  h.textContent = msg;
  h.className = 'rd-hint' + (kind ? ' ' + kind : '');
  document.getElementById('releaseDateText').classList.toggle('bad', kind === 'bad');
}
function setReleaseDate(iso) {
  document.getElementById('releaseDateInput').value = iso;
  document.getElementById('releaseDateText').value = isoToMdy(iso);
  document.getElementById('releaseDatePicker').value = iso;
  if (iso) showReleaseHint(`📅 ${longDate(iso)}`, 'ok');
}
/** Returns an error message, or '' when the typed date is valid. Keeps the hidden field in sync. */
function checkReleaseDate(minIso) {
  const text = document.getElementById('releaseDateText').value.trim();
  const iso = mdyToIso(text);
  document.getElementById('releaseDateInput').value = iso;
  if (!text) return 'Please enter the release date (mm/dd/yy).';
  if (!/^\d{2}\/\d{2}\/\d{2}$/.test(text)) return 'Use the format mm/dd/yy, e.g. 11/25/26.';
  if (!iso) return `${text} is not a valid date.`;
  if (iso < minIso) return `The release date can't be in the past. Choose ${isoToMdy(minIso)} or later.`;
  return '';
}
function setupReleaseDateField(minIso) {
  const text = document.getElementById('releaseDateText');
  const picker = document.getElementById('releaseDatePicker');
  // Type digits only; slashes are added automatically → mm/dd/yy
  text.addEventListener('input', () => {
    const digits = text.value.replace(/\D/g, '').slice(0, 6);
    text.value = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)].filter(Boolean).join('/');
    if (digits.length < 6) { document.getElementById('releaseDateInput').value = ''; showReleaseHint('Type the date as mm/dd/yy, e.g. 11/25/26, or use the calendar.'); return; }
    const problem = checkReleaseDate(minIso);
    if (problem) showReleaseHint(problem, 'bad');
    else { picker.value = document.getElementById('releaseDateInput').value; showReleaseHint(`📅 ${longDate(picker.value)}`, 'ok'); }
  });
  document.getElementById('releaseDateCal').addEventListener('click', () => {
    try { picker.showPicker(); } catch { picker.style.pointerEvents = 'auto'; picker.focus(); picker.click(); }
  });
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    setReleaseDate(picker.value);
    const problem = checkReleaseDate(minIso);
    if (problem) showReleaseHint(problem, 'bad');
  });
}
