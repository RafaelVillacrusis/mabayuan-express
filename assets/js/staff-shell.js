/**
 * Staff portal shell — shared by all staff pages.
 *  - highlights the current page in the top nav and the mobile tab bar
 *  - keeps the unread "Messages" badge up to date on every page
 *  - account menu (name, email, logout)
 *  - after logout, pages restored from the browser cache are sent back to /login
 * Each page sets <body class="rs-portal st-portal" data-page="dashboard|residents|report|inbox|request">.
 * Shell styles live in resident.css (shared) + staff.css.
 */
(function () {
  const page = document.body.dataset.page || '';
  const SEEN_KEY = 'staff_inbox_last_seen';

  // ── Current page ──────────────────────────────────────────────────────────
  // The request detail page belongs to the Dashboard section (it's opened from the queue)
  const section = page === 'request' ? 'dashboard' : page;
  document.querySelectorAll('[data-nav]').forEach(el => {
    if (el.dataset.nav === section) el.setAttribute('aria-current', 'page');
  });

  // ── Unread messages badge ─────────────────────────────────────────────────
  function lastSeen() {
    try { return parseInt(localStorage.getItem(SEEN_KEY) || '0', 10) || 0; } catch { return 0; }
  }
  function setInboxBadge(count) {
    document.querySelectorAll('[data-inbox-badge]').forEach(b => {
      b.textContent = count > 9 ? '9+' : String(count);
      b.hidden = !(count > 0) || page === 'inbox';
    });
  }
  async function refreshInboxBadge() {
    try {
      const res = await fetch('/api/staff/inbox');
      if (!res.ok) return [];
      const msgs = await res.json();
      const seen = lastSeen();
      setInboxBadge(msgs.filter(m => m.message_id > seen).length);
      return msgs;
    } catch { return []; }
  }
  window.stSetInboxBadge = setInboxBadge;
  window.stInboxLastSeen = lastSeen;
  window.stRefreshInboxBadge = refreshInboxBadge;
  // The dashboard and inbox pages manage the badge themselves
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

  fetch('/api/staff/me').then(r => (r.ok ? r.json() : null)).then(u => {
    if (!u) return;
    const name = u.full_name || 'Staff';
    const parts = name.trim().split(/\s+/);
    const initials = (parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('rsAvatar', (initials || 'S').toUpperCase());
    set('rsUserName', parts[0] || name);
    set('rsMenuName', name);
    set('rsMenuEmail', u.email || '');
  }).catch(() => {});

  // ── Session check when a page is restored from the back/forward cache ─────
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    fetch('/api/session-check', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.ok) window.location.replace('/login'); })
      .catch(() => {});
  });

  // ── Service worker ────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/assets/sw.js').catch(() => {}));
  }
})();
