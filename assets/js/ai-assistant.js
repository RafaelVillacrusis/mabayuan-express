/* AI Report Generator page (staff & captain) */
(function () {
  // [href, label, icon, short label for the phone tab bar, badge?]
  const NAV = {
    staff: [
      ['/staff/dashboard', 'Dashboard', '🏠', 'Home'], ['/staff/residents', 'Residents', '👥', 'Residents'],
      ['/staff/report', 'Reports', '📊', 'Reports'], ['/staff/inbox', 'Messages', '📨', 'Messages', 'staff_inbox_last_seen'],
      ['/staff/ai-assistant', 'AI Assistant', '🤖', 'AI'],
    ],
    captain: [
      ['/captain/dashboard', 'Dashboard', '🏠', 'Home', 'pending'], ['/captain/analytics', 'Analytics', '📈', 'Analytics'],
      ['/captain/messages', 'Announcements', '📢', 'Announce'], ['/captain/documents', 'Documents', '📄', 'Docs'], ['/captain/rbac', 'Access', '🔐', null], ['/captain/audit-trail', 'Audit Trail', '📋', 'Audit'],
      ['/captain/ai-assistant', 'AI Assistant', '🤖', 'AI'],
    ],
  };

  const $ = id => document.getElementById(id);
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── Shared request helper with consistent error handling ────────────────────
  async function callApi(url, options = {}) {
    if (!navigator.onLine) throw new Error('You appear to be offline. Please check your internet connection.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    let res;
    try {
      res = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      throw new Error(err.name === 'AbortError'
        ? 'The report took too long to generate. Please try again in a moment.'
        : 'Connection error. Please check your internet connection and try again.');
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 403) throw new Error('You are not allowed to use this feature.');
    if (!res.ok || !data || data.ok === false) throw new Error((data && data.message) || 'Something went wrong. Please try again later.');
    return data;
  }
  function postJson(url, body) {
    return callApi(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function reportRender(logId, startedAt) {
    if (!logId) return;
    requestAnimationFrame(() => {
      fetch('/api/ai/metrics', {
        method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: logId, ui_render_ms: Math.round(performance.now() - startedAt) }),
      }).catch(() => {});
    });
  }
  function showError(el, msg) { el.textContent = msg; el.hidden = !msg; }
  function copyText(text, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = t), 1500); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => {});
  }

  // ── Nav ─────────────────────────────────────────────────────────────────────
  callApi('/api/ai/me').then(me => {
    const items = NAV[me.role] || [];
    const roleName = me.role === 'captain' ? 'Captain Portal' : 'Staff Portal';
    $('brandRole').textContent = roleName;
    $('rsBrand').href = items[0] ? items[0][0] : '/';
    const link = ([href, label, icon, short, seenKey], mobile) =>
      `<a href="${href}"${href.endsWith('/ai-assistant') ? ' aria-current="page"' : ''}><span class="rs-ico" aria-hidden="true">${icon}</span>${mobile ? short : label}` +
      (seenKey ? `<span class="rs-badge" data-seen-key="${seenKey}" hidden></span>` : '') + '</a>';
    $('rsNav').innerHTML = items.map(i => link(i, false)).join('');
    $('rsBottom').innerHTML = items.filter(i => i[3] !== null).map(i => link(i, true)).join(''); // null short label = top nav only

    const name = me.full_name || (me.role === 'captain' ? 'Captain' : 'Staff');
    const parts = name.trim().split(/\s+/);
    $('rsAvatar').textContent = ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    $('rsUserName').textContent = parts[0];
    $('rsMenuName').textContent = name;
    $('rsMenuRole').textContent = me.role === 'captain' ? 'Barangay Captain' : 'Barangay Staff';

    // captain: requests waiting for a decision
    if (me.role === 'captain') {
      fetch('/api/captain/counts').then(r => r.ok ? r.json() : {}).then(c => {
        const n = Number(c.pending_approval || 0);
        document.querySelectorAll('[data-seen-key="pending"]').forEach(b => { b.textContent = n > 9 ? '9+' : n; b.hidden = n === 0; });
      }).catch(() => {});
    }
    // unread staff messages badge
    if (me.role === 'staff') {
      fetch('/api/staff/inbox').then(r => r.ok ? r.json() : []).then(msgs => {
        let seen = 0; try { seen = parseInt(localStorage.getItem('staff_inbox_last_seen') || '0', 10) || 0; } catch {}
        const n = msgs.filter(m => m.message_id > seen).length;
        document.querySelectorAll('[data-seen-key]').forEach(b => { b.textContent = n > 9 ? '9+' : n; b.hidden = n === 0; });
      }).catch(() => {});
    }
  }).catch(() => { window.location.href = '/login'; });

  // Account menu
  (function () {
    const btn = $('rsUserBtn'), menu = $('rsUserMenu');
    btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
    document.addEventListener('click', e => { if (!menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
  })();

  // ── Report generator ────────────────────────────────────────────────────────
  const today = new Date();
  function setRange(fromDate, toDate, presetBtn) {
    $('dateFrom').value = isoDate(fromDate);
    $('dateTo').value = isoDate(toDate);
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('on', b === presetBtn));
  }
  const PRESETS = {
    '30d': () => [new Date(today.getTime() - 29 * 86400000), today],
    month: () => [new Date(today.getFullYear(), today.getMonth(), 1), today],
    lastmonth: () => [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)],
    year: () => [new Date(today.getFullYear(), 0, 1), today],
  };
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const [f, t] = PRESETS[b.dataset.preset]();
    setRange(f, t, b);
  }));
  setRange(...PRESETS['30d'](), document.querySelector('[data-preset="30d"]'));
  $('dateTo').max = isoDate(today);
  $('dateFrom').max = isoDate(today);
  ['dateFrom', 'dateTo'].forEach(id => $(id).addEventListener('change', () =>
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('on'))));

  function syncReportFields() {
    const isAnn = $('reportType').value === 'announcement';
    document.querySelectorAll('[data-for="range"]').forEach(el => { el.hidden = isAnn; });
    document.querySelectorAll('[data-for="announcement"]').forEach(el => { el.hidden = !isAnn; });
    $('reportBtn').textContent = isAnn ? 'Draft announcement' : 'Generate report';
  }
  $('reportType').addEventListener('change', syncReportFields);
  syncReportFields();

  // ── AI commentary (loads after the exact figures are already shown) ─────────
  let commentaryRun = 0;
  function setAiNote(ok, message) {
    const note = $('reportNote');
    note.className = ok ? 'ai-note ok' : 'ai-note';
    note.innerHTML = ok
      ? '✅ <strong>Figures are exact:</strong> calculated directly from the records. The overview, observations, and recommendations were written by AI, so review them before use.'
      : `ℹ️ <strong>Figures are exact:</strong> calculated directly from the records. ${escapeHtml(message || '')}`;
  }
  async function loadCommentary(key, originalReport) {
    const run = ++commentaryRun;
    const note = $('reportNote');
    note.className = 'ai-note';
    note.innerHTML = '<span class="ai-spinner" style="display:inline-block;vertical-align:-3px"></span> <strong>Figures are ready and exact.</strong> Adding AI commentary in the background, so you can already read, copy, or print the report.';
    try {
      const data = await postJson('/api/ai/report/commentary', { key });
      if (run !== commentaryRun) return;               // a newer report was generated meanwhile
      if ($('reportOutput').value === originalReport) {
        $('reportOutput').value = data.report;
        setAiNote(true);
      } else {
        // the user already edited the report — don't overwrite their changes
        note.className = 'ai-note ok';
        note.innerHTML = '✨ <strong>AI commentary is ready.</strong> You have edited the report, so it was not replaced automatically. <button type="button" class="btn btn-small" id="insertAi" style="margin-left:6px">Replace with AI version</button>';
        $('insertAi').addEventListener('click', () => { $('reportOutput').value = data.report; setAiNote(true); });
      }
    } catch (err) {
      if (run !== commentaryRun) return;
      setAiNote(false, err.message);
    }
  }

  $('reportForm').addEventListener('submit', async e => {
    e.preventDefault();
    const type = $('reportType').value;
    const body = { type };
    if (type === 'announcement') {
      body.topic = $('annTopic').value.trim();
      body.details = $('annDetails').value.trim();
      body.audience = $('audience').value;
      if (body.topic.length < 5) return showError($('reportError'), 'Please enter an announcement topic (at least 5 characters).');
    } else {
      body.date_from = $('dateFrom').value;
      body.date_to = $('dateTo').value;
      if (!body.date_from || !body.date_to) return showError($('reportError'), 'Please choose a date range.');
      if (body.date_from > body.date_to) return showError($('reportError'), 'The start date must be before the end date.');
      if (body.date_to > isoDate(today)) return showError($('reportError'), 'The end date cannot be in the future.');
    }
    showError($('reportError'), '');
    commentaryRun++;
    $('reportBtn').disabled = true;
    $('reportLoading').hidden = false;
    $('reportLoadingText').textContent = type === 'announcement' ? 'Drafting announcement…' : 'Calculating figures…';
    const slow = setTimeout(() => { $('reportLoadingText').textContent = type === 'announcement' ? 'Still drafting, the AI service is busy…' : 'Still calculating…'; }, 4000);
    const t0 = performance.now();
    try {
      const data = await postJson('/api/ai/report', body);
      const received = performance.now();
      $('reportOutput').value = data.report;
      $('reportOutputWrap').hidden = false;
      const note = $('reportNote');
      if (type === 'announcement') {
        note.className = 'ai-note';
        note.innerHTML = '⚠️ <strong>AI-generated draft.</strong> Check the details and fill in any [PLACEHOLDERS] before posting it.';
      } else if (data.ai_used) {
        setAiNote(true);
      } else if (data.commentary_key) {
        loadCommentary(data.commentary_key, data.report);
      } else {
        setAiNote(false, 'AI commentary is not available, so a plain summary was used.');
      }
      $('reportMeta').textContent = `Generated in ${((received - t0) / 1000).toFixed(1)}s${data.cached ? ' (from cache)' : ''}`;
      $('reportOutputWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
      reportRender(data.log_id, received);
    } catch (err) {
      showError($('reportError'), err.message);
    } finally {
      clearTimeout(slow);
      $('reportBtn').disabled = false;
      $('reportLoading').hidden = true;
    }
  });
  $('copyReport').addEventListener('click', e => copyText($('reportOutput').value, e.currentTarget));
  $('printReport').addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><title>Mabayuan Express Report</title><pre style="font:13px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;margin:32px">${escapeHtml($('reportOutput').value)}</pre>`);
    w.document.close();
    w.focus();
    w.print();
  });
})();
