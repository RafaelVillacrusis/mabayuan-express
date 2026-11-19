/* Staff Messages page — captain messages to staff / everyone */
let allMessages = [];
let previouslySeen = 0;

function audienceLabel(a) {
  if (a === 'all') return 'Everyone';
  if (a === 'resident') return 'Residents';
  if (a === 'staff') return 'Staff only';
  return a;
}

function timeAgo(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 7 * 86400) { const d = Math.floor(diff / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return formatDate(value);
}

function renderMessages() {
  const q = (document.getElementById('anSearch').value || '').trim().toLowerCase();
  const list = document.getElementById('inboxList');
  const items = q ? allMessages.filter(m => `${m.subject} ${m.body}`.toLowerCase().includes(q)) : allMessages;

  document.getElementById('anCount').textContent = allMessages.length
    ? (q ? `${items.length} of ${allMessages.length} messages` : `${allMessages.length} message${allMessages.length === 1 ? '' : 's'}`)
    : '';

  if (!allMessages.length) {
    list.innerHTML = '<div class="an-empty panel"><div>📭</div><strong>No messages yet</strong>Messages from the Barangay Captain will appear here.</div>';
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="an-empty panel"><div>🔍</div><strong>No matches</strong>No messages match “${escapeHtml(q)}”.</div>`;
    return;
  }
  list.innerHTML = items.map(m => {
    const isNew = m.message_id > previouslySeen;
    return `<article class="an-card${isNew ? ' is-new' : ''}">
      <div class="an-icon" aria-hidden="true">📨</div>
      <div class="an-body">
        <h2 class="an-title">${isNew ? '<span class="an-new">NEW</span>' : ''}<span>${escapeHtml(m.subject)}</span></h2>
        <div class="an-meta">${escapeHtml(m.captain_name || 'Barangay Captain')} · <time datetime="${escapeHtml(m.created_at)}" title="${escapeHtml(formatDateTime(m.created_at))}">${timeAgo(m.created_at)}</time>
          <span class="an-audience">To: ${escapeHtml(audienceLabel(m.target_audience))}</span></div>
        <p class="an-text">${escapeHtml(m.body)}</p>
      </div>
    </article>`;
  }).join('');
}

async function loadInbox() {
  const list = document.getElementById('inboxList');
  try {
    const res = await fetch('/api/staff/inbox');
    if (!res.ok) throw new Error();
    allMessages = await res.json();
    previouslySeen = window.stInboxLastSeen ? window.stInboxLastSeen() : 0;
    if (allMessages.length) {
      try { localStorage.setItem('staff_inbox_last_seen', String(allMessages[0].message_id)); } catch {}
    }
    renderMessages();
  } catch {
    list.innerHTML = '<div class="an-empty panel"><div>⚠️</div><strong>Couldn\'t load messages</strong>Please check your connection and refresh the page.</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('anSearch').addEventListener('input', renderMessages);
  loadInbox();
});
