/**
 * System admin (IT personnel) shell — shared by all system admin pages.
 *  - one sidebar on every page; highlights the current page / dashboard section
 *  - on the dashboard, sidebar links to sections switch without reloading
 *  - shows the signed-in admin's name in the top bar and sidebar
 *  - mobile sidebar toggle
 *  - after logout, pages restored from the browser cache are sent back to /login
 * Each page sets <body class="sa-portal" data-page="dashboard|rbac|audit|requests">.
 */
(function () {
  const page = document.body.dataset.page || '';

  // ── Active nav item ───────────────────────────────────────────────────────
  function setActive(key) {
    document.querySelectorAll('.admin-sidebar-nav [data-nav]').forEach(el => {
      const on = el.dataset.nav === key;
      el.classList.toggle('active', on);
      if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
  }
  window.adminSetActive = setActive;

  if (page === 'dashboard') {
    const section = new URLSearchParams(window.location.search).get('section') || 'overview';
    setActive(section);
    // Sidebar links to dashboard sections switch in place (no reload)
    document.querySelectorAll('.admin-sidebar-nav [data-section]').forEach(a => {
      a.addEventListener('click', e => {
        if (typeof window.showSection !== 'function') return;
        e.preventDefault();
        const name = a.dataset.section;
        window.showSection(name);
        if (name === 'ai' && typeof window.loadAiUsage === 'function') window.loadAiUsage();
        const url = new URL(window.location.href);
        if (name === 'overview') url.searchParams.delete('section'); else url.searchParams.set('section', name);
        history.replaceState({}, '', url);
        closeSidebar();
        window.scrollTo({ top: 0 });
      });
    });
  } else {
    setActive(page);
  }

  // ── Signed-in admin ───────────────────────────────────────────────────────
  fetch('/api/system-admin/me').then(r => (r.ok ? r.json() : null)).then(u => {
    if (!u) return;
    const name = u.full_name || 'System Admin';
    const parts = name.trim().split(/\s+/);
    const initials = ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || 'SA';
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('avatarInit', initials);
    set('topbarUser', name);
    set('sidebarAvatar', initials);
    set('sidebarUser', name);
    set('sidebarEmail', u.email || '');
  }).catch(() => {});

  // ── Mobile sidebar ────────────────────────────────────────────────────────
  const toggle = document.getElementById('sidebarToggle');
  const sidebar = document.querySelector('.admin-sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  function openSidebar() { sidebar.classList.add('open'); overlay && overlay.classList.add('show'); if (toggle) { toggle.textContent = '✕'; toggle.setAttribute('aria-expanded', 'true'); } }
  function closeSidebar() { if (!sidebar) return; sidebar.classList.remove('open'); overlay && overlay.classList.remove('show'); if (toggle) { toggle.textContent = '☰'; toggle.setAttribute('aria-expanded', 'false'); } }
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => (sidebar.classList.contains('open') ? closeSidebar() : openSidebar()));
    overlay && overlay.addEventListener('click', closeSidebar);
    document.querySelectorAll('.admin-sidebar-nav a').forEach(a => a.addEventListener('click', () => { if (window.innerWidth <= 920) closeSidebar(); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });
  }

  // ── Session check when a page is restored from the back/forward cache ─────
  window.addEventListener('pageshow', e => {
    if (!e.persisted) return;
    fetch('/api/session-check', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (!d.ok) window.location.replace('/login'); })
      .catch(() => {});
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/assets/sw.js').catch(() => {}));
  }
})();
