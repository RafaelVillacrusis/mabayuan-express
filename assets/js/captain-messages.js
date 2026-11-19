/* Captain — compose, schedule and manage announcements.
   All dates are Philippine time (Asia/Manila), whatever the device's time zone. */
const TZ = 'Asia/Manila';
const $ = id => document.getElementById(id);
let postMode = 'now';      // 'now' | 'later'
let expiryMode = 'never';  // 'never' | 'date'
let allMessages = [];
let stateFilter = 'all';

// "YYYY-MM-DDTHH:mm" for a Date, in PH time
function phDateTimeValue(d) {
  return d.toLocaleString('sv-SE', { timeZone: TZ, hour12: false }).replace(' ', 'T').slice(0, 16);
}
const phDateValue = d => phDateTimeValue(d).slice(0, 10);
// Parse form values as PH time
const fromPhDateTime = v => new Date(`${v}:00+08:00`);
const fromPhDate = v => new Date(`${v}T00:00:00+08:00`);
function addDaysToDateValue(v, n) {
  const d = fromPhDate(v);
  d.setUTCDate(d.getUTCDate() + n);
  return phDateValue(d);
}
const fmtDateTime = d => new Date(d).toLocaleString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtDate = d => new Date(d).toLocaleDateString('en-PH', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
// expires_at is the start of the day after the last day shown
const lastDayShown = expiresAt => new Date(new Date(expiresAt).getTime() - 1000);

// ── Compose: audience ──────────────────────────────────────────────────────
document.querySelectorAll('.audience-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.audience-pill').forEach(p => p.classList.remove('selected'));
    pill.classList.add('selected');
    $('targetAudience').value = pill.dataset.val;
    updateSummary();
  });
});

// ── Compose: when to post / expiry ─────────────────────────────────────────
function setSeg(attr, value) {
  document.querySelectorAll(`[data-${attr}]`).forEach(b => {
    if (b.closest('.seg')) b.classList.toggle('on', b.dataset[attr] === value);
  });
}

function publishDate() {
  return postMode === 'later' && $('publishAt').value ? fromPhDateTime($('publishAt').value) : new Date();
}

function refreshLimits() {
  const now = new Date();
  $('publishAt').min = phDateTimeValue(now);
  $('expiresOn').min = phDateValue(publishDate() > now ? publishDate() : now);
}

document.querySelectorAll('.seg [data-when]').forEach(b => b.addEventListener('click', () => {
  postMode = b.dataset.when;
  setSeg('when', postMode);
  $('publishField').hidden = postMode !== 'later';
  if (postMode === 'later' && !$('publishAt').value) {
    const t = new Date(Date.now() + 3600000);
    $('publishAt').value = phDateTimeValue(t).slice(0, 14) + '00';   // next full hour
  }
  refreshLimits();
  updateSummary();
}));

document.querySelectorAll('.seg [data-exp]').forEach(b => b.addEventListener('click', () => {
  expiryMode = b.dataset.exp;
  setSeg('exp', expiryMode);
  $('expiryField').hidden = expiryMode !== 'date';
  if (expiryMode === 'date' && !$('expiresOn').value) $('expiresOn').value = addDaysToDateValue(phDateValue(publishDate()), 7);
  refreshLimits();
  updateSummary();
}));

$('publishQuick').addEventListener('click', e => {
  const b = e.target.closest('[data-pub]');
  if (!b) return;
  const today = phDateValue(new Date());
  let day = addDaysToDateValue(today, 1);
  if (b.dataset.pub === 'monday8') {
    const phDow = new Date(`${today}T12:00:00+08:00`).getUTCDay(); // noon PH is the same calendar day in UTC
    day = addDaysToDateValue(today, ((8 - phDow) % 7) || 7);       // next Monday (a week ahead if today is Monday)
  }
  $('publishAt').value = `${day}T08:00`;
  refreshLimits();
  updateSummary();
});

$('expiryQuick').addEventListener('click', e => {
  const b = e.target.closest('[data-days]');
  if (!b) return;
  // "1 day" = shown on the publish day only
  $('expiresOn').value = addDaysToDateValue(phDateValue(publishDate()), Number(b.dataset.days) - 1);
  updateSummary();
});

['publishAt', 'expiresOn'].forEach(id => $(id).addEventListener('input', () => { refreshLimits(); updateSummary(); }));

/** Returns an error message, or '' when the schedule is valid. Also updates the summary box. */
function updateSummary() {
  const box = $('whenSummary');
  const audience = { resident: 'residents', staff: 'staff', all: 'everyone' }[$('targetAudience').value];
  $('publishAt').classList.remove('bad');
  $('expiresOn').classList.remove('bad');
  let error = '';

  const pub = publishDate();
  if (postMode === 'later') {
    if (!$('publishAt').value) error = 'Choose the date and time to publish.';
    else if (pub < new Date()) error = 'The publish time has already passed. Choose a future time.';
    if (error) $('publishAt').classList.add('bad');
  }
  let lastDay = null;
  if (expiryMode === 'date') {
    if (!$('expiresOn').value) { error = error || 'Choose the last day to show the announcement.'; $('expiresOn').classList.add('bad'); }
    else {
      lastDay = $('expiresOn').value;
      if (lastDay < phDateValue(pub)) { error = error || 'The expiry date must be on or after the publish date.'; $('expiresOn').classList.add('bad'); }
    }
  }

  const when = postMode === 'later' && $('publishAt').value ? `on <strong>${escapeHtml(fmtDateTime(pub))}</strong>` : '<strong>right away</strong>';
  const until = lastDay ? `until the end of <strong>${escapeHtml(fmtDate(fromPhDate(lastDay)))}</strong>` : '<strong>until you take it down</strong>';
  box.className = 'when-summary' + (postMode === 'later' ? ' sched' : '');
  box.innerHTML = `${postMode === 'later' ? '🗓' : '📢'} Will be posted to <strong>${audience}</strong> ${when} and shown ${until}.`;
  $('sendBtn').textContent = postMode === 'later' ? '🗓 Schedule Announcement' : '📢 Post Announcement';
  return error;
}

function showSendError(msg) {
  $('sendError').textContent = msg;
  $('sendError').hidden = !msg;
}

async function sendMessage() {
  showSendError('');
  const target = $('targetAudience').value;
  const subject = $('msgSubject').value.trim();
  const body = $('msgBody').value.trim();
  if (!subject) { showSendError('Please enter a subject.'); return $('msgSubject').focus(); }
  if (!body) { showSendError('Please enter the message.'); return $('msgBody').focus(); }
  const problem = updateSummary();
  if (problem) return showSendError(problem);

  const payload = { target_audience: target, subject, body };
  if (postMode === 'later') payload.publish_at = $('publishAt').value;
  if (expiryMode === 'date') payload.expires_on = $('expiresOn').value;

  const btn = $('sendBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = postMode === 'later' ? 'Scheduling…' : 'Posting…';
  try {
    const res = await fetch('/api/captain/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { showSendError(json.error || 'Could not send the announcement.'); return; }

    $('msgSubject').value = '';
    $('msgBody').value = '';
    const succ = $('sendSuccess');
    succ.textContent = json.scheduled
      ? `✅ Announcement scheduled for ${fmtDateTime(json.publish_at)}.`
      : '✅ Announcement posted!';
    succ.style.display = 'block';
    setTimeout(() => { succ.style.display = 'none'; }, 5000);
    await loadMessages();
  } catch {
    showSendError('Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
    updateSummary();
  }
}
window.sendMessage = sendMessage;

// ── History ────────────────────────────────────────────────────────────────
function audienceBadge(audience) {
  const labels = { resident: 'Residents', staff: 'Staff', all: 'Everyone' };
  return `<span class="audience-badge ${audience}">${labels[audience] || audience}</span>`;
}
const STATE_LABEL = { scheduled: 'Scheduled', live: 'Live', expired: 'Expired' };

function renderMessages() {
  const list = $('msgLogList');
  const counts = { all: allMessages.length, scheduled: 0, live: 0, expired: 0 };
  allMessages.forEach(m => { counts[m.state] = (counts[m.state] || 0) + 1; });
  document.querySelectorAll('#msgFilter [data-state]').forEach(b => {
    b.classList.toggle('on', b.dataset.state === stateFilter);
    b.textContent = `${b.dataset.state === 'all' ? 'All' : STATE_LABEL[b.dataset.state]} (${counts[b.dataset.state] || 0})`;
  });

  const rows = allMessages.filter(m => stateFilter === 'all' || m.state === stateFilter);
  if (!rows.length) {
    list.innerHTML = `<div class="empty-log">${allMessages.length ? 'No announcements in this list.' : 'No announcements yet.'}</div>`;
    return;
  }
  list.innerHTML = rows.map(m => {
    const pubLabel = m.state === 'scheduled' ? 'Publishes' : 'Published';
    const expiry = m.expires_at
      ? `${m.state === 'expired' ? 'Expired' : 'Shown until'} <strong>${escapeHtml(m.state === 'expired' ? fmtDateTime(m.expires_at) : fmtDate(lastDayShown(m.expires_at)))}</strong>`
      : 'No expiry';
    const action = m.state === 'scheduled'
      ? `<button type="button" class="btn btn-small btn-ghost" data-end="${m.message_id}" data-kind="cancel">✖ Cancel</button>`
      : m.state === 'live'
        ? `<button type="button" class="btn btn-small btn-ghost" data-end="${m.message_id}" data-kind="end">⏹ Take down now</button>`
        : '';
    return `
      <div class="msg-log-item ${m.state}">
        <div class="msg-log-header">
          <span class="msg-log-subject">${escapeHtml(m.subject)}</span>
          <span class="state-badge ${m.state}">${STATE_LABEL[m.state]}</span>
          ${audienceBadge(m.target_audience)}
        </div>
        <div class="msg-log-body">${escapeHtml(m.body)}</div>
        <div class="msg-dates"><span>🗓 ${pubLabel} <strong>${escapeHtml(fmtDateTime(m.publish_at))}</strong></span><span>⏳ ${expiry}</span></div>
        <div class="msg-log-foot">
          <div class="msg-log-meta">By ${escapeHtml(m.captain_name || 'Captain')} · created ${escapeHtml(fmtDateTime(m.created_at))}</div>
          ${action}
        </div>
      </div>`;
  }).join('');
}

async function loadMessages() {
  try {
    const res = await fetch('/api/captain/messages');
    allMessages = await res.json();
    if (!Array.isArray(allMessages)) allMessages = [];
  } catch {
    allMessages = [];
  }
  renderMessages();
}

$('msgFilter').addEventListener('click', e => {
  const b = e.target.closest('[data-state]');
  if (!b) return;
  stateFilter = b.dataset.state;
  renderMessages();
});

$('msgLogList').addEventListener('click', async e => {
  const b = e.target.closest('[data-end]');
  if (!b) return;
  const cancel = b.dataset.kind === 'cancel';
  const ok = confirm(cancel
    ? 'Cancel this scheduled announcement? It will be deleted and never posted.'
    : 'Take this announcement down now? Residents and staff will no longer see it.');
  if (!ok) return;
  b.disabled = true;
  try {
    const res = await fetch(`/api/captain/messages/${encodeURIComponent(b.dataset.end)}/end`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert(json.error || 'Could not update the announcement.');
  } catch {
    alert('Network error. Please try again.');
  }
  await loadMessages();
});

document.addEventListener('DOMContentLoaded', () => {
  refreshLimits();
  updateSummary();
  loadMessages();
  // Scheduled announcements go live on their own — refresh the list every minute
  setInterval(loadMessages, 60000);
});
