/**
 * Captain portal shell — shared by all captain pages.
 *  - highlights the current page in the top nav and the mobile tab bar
 *  - "Dashboard" badge = requests waiting for the Captain's decision
 *  - account menu (name, email, logout)
 *  - after logout, pages restored from the browser cache are sent back to /login
 * Each page sets <body class="rs-portal st-portal" data-page="dashboard|analytics|messages|audit|request">.
 * Shell styles: resident.css (shared shell) + staff.css (portal page styles).
 */
(function () {
  const page = document.body.dataset.page || '';

  // The request review page belongs to the Dashboard section
  const section = page === 'request' ? 'dashboard' : page;
  document.querySelectorAll('[data-nav]').forEach(el => {
    if (el.dataset.nav === section) el.setAttribute('aria-current', 'page');
  });

  // ── Pending decisions badge ───────────────────────────────────────────────
  function setPendingBadge(count) {
    document.querySelectorAll('[data-pending-badge]').forEach(b => {
      b.textContent = count > 9 ? '9+' : String(count);
      b.hidden = !(count > 0);
      b.title = `${count} request${count === 1 ? '' : 's'} waiting for your decision`;
    });
  }
  async function refreshPendingBadge() {
    try {
      const res = await fetch('/api/captain/counts');
      if (!res.ok) return;
      const c = await res.json();
      setPendingBadge(Number(c.pending_approval || 0));
    } catch { /* offline */ }
  }
  window.cpSetPendingBadge = setPendingBadge;
  window.cpRefreshPendingBadge = refreshPendingBadge;
  if (page !== 'dashboard') refreshPendingBadge();   // the dashboard updates it from its own counts

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

  fetch('/api/captain/me').then(r => (r.ok ? r.json() : null)).then(u => {
    if (!u) return;
    const name = u.full_name || 'Captain';
    const parts = name.trim().split(/\s+/);
    const initials = (parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('rsAvatar', (initials || 'C').toUpperCase());
    set('rsUserName', parts[0] || name);
    set('rsMenuName', name);
    set('rsMenuEmail', u.email || '');
  }).catch(() => {});

  // ── Session check when a page is restored from the back/forward cache ─────
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    fetch('/api/session-check', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.ok) window.location.replace('/login'); else refreshPendingBadge(); })
      .catch(() => {});
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/assets/sw.js').catch(() => {}));
  }
})();
