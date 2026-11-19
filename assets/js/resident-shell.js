/**
 * Resident portal shell — shared by the dashboard, request, and announcements pages.
 *  - highlights the current page in the top nav and the mobile tab bar
 *  - keeps the unread-announcements badge up to date
 *  - account menu (name, email, help, logout)
 *  - "Assistant" tab opens the AI chat
 *  - after logout, pages restored from the browser cache are sent back to /login
 * The page sets <body class="rs-portal" data-page="dashboard|request|inbox">.
 */
(function () {
  const page = document.body.dataset.page || '';

  // ── Current page ──────────────────────────────────────────────────────────
  document.querySelectorAll('[data-nav]').forEach(el => {
    if (el.dataset.nav === page) el.setAttribute('aria-current', 'page');
  });

  // ── Unread announcements badge ────────────────────────────────────────────
  function setInboxBadge(count) {
    document.querySelectorAll('[data-inbox-badge]').forEach(b => {
      b.textContent = count > 9 ? '9+' : String(count);
      b.hidden = !(count > 0) || page === 'inbox';
    });
  }
  window.rsSetInboxBadge = setInboxBadge;

  function lastSeen() {
    try { return parseInt(localStorage.getItem('inbox_last_seen') || '0', 10) || 0; } catch { return 0; }
  }
  window.rsInboxLastSeen = lastSeen;

  async function refreshInboxBadge() {
    try {
      const res = await fetch('/api/resident/inbox');
      if (!res.ok) return;
      const msgs = await res.json();
      const seen = lastSeen();
      setInboxBadge(msgs.filter(m => m.message_id > seen).length);
    } catch { /* offline — leave badge as is */ }
  }
  window.rsRefreshInboxBadge = refreshInboxBadge;
  // The dashboard loads the inbox itself and calls rsSetInboxBadge
  if (page !== 'dashboard' && page !== 'inbox') refreshInboxBadge();

  // ── Account menu ──────────────────────────────────────────────────────────
  const btn = document.getElementById('rsUserBtn');
  const menu = document.getElementById('rsUserMenu');
  function closeMenu() { if (menu) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }
  if (btn && menu) {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', e => { if (!menu.contains(e.target)) closeMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  }

  fetch('/api/resident/profile').then(r => (r.ok ? r.json() : null)).then(p => {
    if (!p) return;
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Resident';
    const initials = ((p.first_name || '').trim()[0] || '') + ((p.last_name || '').trim()[0] || '');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('rsAvatar', (initials || 'R').toUpperCase());
    set('rsUserName', p.first_name || name);
    set('rsMenuName', name);
    set('rsMenuEmail', p.email || '');
  }).catch(() => {});

  // ── Assistant tab ─────────────────────────────────────────────────────────
  document.querySelectorAll('[data-nav="assistant"]').forEach(el =>
    el.addEventListener('click', () => { if (window.mxOpenAiChat) window.mxOpenAiChat(); }));

  // ── Session check when a page is restored from the back/forward cache ─────
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    fetch('/api/session-check', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.ok) window.location.replace('/login'); else if (page !== 'dashboard' && page !== 'inbox') refreshInboxBadge(); })
      .catch(() => {});
  });

  // ── Service worker ────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/assets/sw.js').catch(() => {}));
  }
})();
