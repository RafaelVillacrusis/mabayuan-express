function audienceLabel(a) {
  if (a === 'all') return 'Everyone';
  if (a === 'resident') return 'Residents';
  if (a === 'staff') return 'Staff';
  return a;
}

async function loadInbox() {
  const res = await fetch('/api/staff/inbox');
  const msgs = await res.json();

  if (msgs.length > 0) {
    localStorage.setItem('staff_inbox_last_seen', String(msgs[0].message_id));
  }

  document.getElementById('inboxList').innerHTML = msgs.length
    ? msgs.map(m => `
      <div style="border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:12px;background:var(--surface)">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:16px;flex-wrap:wrap;margin-bottom:6px">
          <strong style="font-size:1rem">${escapeHtml(m.subject)}</strong>
          <span style="font-size:12px;color:var(--muted);white-space:nowrap">${formatDateTime(m.created_at)}</span>
        </div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px">
          From: <strong>${escapeHtml(m.captain_name || 'Captain')}</strong> &nbsp;&middot;&nbsp; To: ${audienceLabel(m.target_audience)}
        </div>
        <p style="margin:0;white-space:pre-wrap;line-height:1.65;font-size:.9rem">${escapeHtml(m.body)}</p>
      </div>`).join('')
    : '<p class="empty-state">No messages yet.</p>';
}

document.addEventListener('DOMContentLoaded', loadInbox);
