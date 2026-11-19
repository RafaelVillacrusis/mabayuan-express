/* Announcements page — captain messages to residents */
let allAnnouncements = [];
let previouslySeen = 0;

function timeAgo(value) {
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 7 * 86400) { const d = Math.floor(diff / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return formatDate(value);
}

function renderAnnouncements() {
  const q = (document.getElementById('anSearch').value || '').trim().toLowerCase();
  const list = document.getElementById('inboxList');
  const items = q
    ? allAnnouncements.filter(m => `${m.subject} ${m.body}`.toLowerCase().includes(q))
    : allAnnouncements;

  document.getElementById('anCount').textContent = allAnnouncements.length
    ? (q ? `${items.length} of ${allAnnouncements.length} announcements` : `${allAnnouncements.length} announcement${allAnnouncements.length === 1 ? '' : 's'}`)
    : '';

  if (!allAnnouncements.length) {
    list.innerHTML = `<div class="an-empty panel"><div>📭</div><strong>No announcements yet</strong>
      Barangay news and advisories will appear here.</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="an-empty panel"><div>🔍</div><strong>No matches</strong>
      No announcements match “${escapeHtml(q)}”.</div>`;
    return;
  }
  list.innerHTML = items.map(m => {
    const isNew = m.message_id > previouslySeen;
    return `<article class="an-card${isNew ? ' is-new' : ''}">
      <div class="an-icon" aria-hidden="true">📢</div>
      <div class="an-body">
        <h2 class="an-title">${isNew ? '<span class="an-new">NEW</span>' : ''}<span>${escapeHtml(m.subject)}</span></h2>
        <div class="an-meta">${escapeHtml(m.captain_name || 'Barangay Captain')} · <time datetime="${escapeHtml(m.created_at)}" title="${escapeHtml(formatDateTime(m.created_at))}">${timeAgo(m.created_at)}</time></div>
        ${m.has_image ? `<a href="/api/announcements/${m.message_id}/image" target="_blank" rel="noopener"><img class="an-img" src="/api/announcements/${m.message_id}/image" alt="" loading="lazy"></a>` : ''}
        ${m.body ? `<p class="an-text">${escapeHtml(m.body)}</p>` : ''}
      </div>
    </article>`;
  }).join('');
}

async function loadInbox() {
  const list = document.getElementById('inboxList');
  try {
    const res = await fetch('/api/resident/inbox');
    if (!res.ok) throw new Error();
    allAnnouncements = await res.json();
    previouslySeen = window.rsInboxLastSeen ? window.rsInboxLastSeen() : 0;
    if (allAnnouncements.length) {
      try { localStorage.setItem('inbox_last_seen', String(allAnnouncements[0].message_id)); } catch {}
    }
    renderAnnouncements();
  } catch {
    list.innerHTML = `<div class="an-empty panel"><div>⚠️</div><strong>Couldn't load announcements</strong>
      Please check your internet connection and refresh the page.</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('anSearch').addEventListener('input', renderAnnouncements);
  loadInbox();
});
