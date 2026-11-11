/* AI Assistant page — report generator, inquiry classifier, inquiry log (staff & captain) */
(function () {
  const NAV = {
    staff: [
      ['/staff/dashboard', 'Dashboard'], ['/staff/residents', 'Resident Records'], ['/staff/report', 'Report'],
      ['/staff/inbox', 'Messages'], ['/staff/ai-assistant', 'AI Assistant'],
    ],
    captain: [
      ['/captain/dashboard', 'Dashboard'], ['/captain/analytics', 'Analytics'], ['/captain/messages', 'Messages'],
      ['/captain/audit-trail', 'Audit Trail'], ['/captain/ai-assistant', 'AI Assistant'],
    ],
  };

  const $ = id => document.getElementById(id);
  const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // ── Shared request helper with consistent error handling ────────────────────
  async function callApi(url, options = {}) {
    if (!navigator.onLine) throw new Error('You appear to be offline. Please check your internet connection.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let res;
    try {
      res = await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      throw new Error(err.name === 'AbortError'
        ? 'The AI service took too long to respond. Please try again later.'
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
    $('brandRole').textContent = me.role === 'captain' ? 'Captain Dashboard' : 'Staff Dashboard';
    $('navLinks').innerHTML = (NAV[me.role] || []).map(([href, label]) =>
      `<a href="${href}"${href.endsWith('/ai-assistant') ? ' style="font-weight:700"' : ''}>${label}</a>`).join('');
  }).catch(() => { window.location.href = '/login'; });

  // ── Tabs ────────────────────────────────────────────────────────────────────
  let inquiriesLoaded = false;
  document.querySelectorAll('.ai-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.ai-tab').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
    if (tab.dataset.tab === 'inquiries' && !inquiriesLoaded) { inquiriesLoaded = true; loadInquiries(); }
  }));

  // ── Report generator ────────────────────────────────────────────────────────
  const today = new Date();
  $('dateTo').value = isoDate(today);
  $('dateFrom').value = isoDate(new Date(today.getTime() - 29 * 86400000));

  function syncReportFields() {
    const isAnn = $('reportType').value === 'announcement';
    document.querySelectorAll('[data-for="range"]').forEach(el => { el.hidden = isAnn; });
    document.querySelectorAll('[data-for="announcement"]').forEach(el => { el.hidden = !isAnn; });
  }
  $('reportType').addEventListener('change', syncReportFields);
  syncReportFields();

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
    }
    showError($('reportError'), '');
    $('reportBtn').disabled = true;
    $('reportLoading').hidden = false;
    const t0 = performance.now();
    try {
      const data = await postJson('/api/ai/report', body);
      const received = performance.now();
      $('reportOutput').value = data.report;
      $('reportOutputWrap').hidden = false;
      $('reportMeta').textContent = `Generated in ${((received - t0) / 1000).toFixed(1)}s${data.cached ? ' (from cache)' : ''}`;
      reportRender(data.log_id, received);
    } catch (err) {
      showError($('reportError'), err.message);
    } finally {
      $('reportBtn').disabled = false;
      $('reportLoading').hidden = true;
    }
  });
  $('copyReport').addEventListener('click', e => copyText($('reportOutput').value, e.currentTarget));

  // ── Classifier ──────────────────────────────────────────────────────────────
  $('classifyInput').addEventListener('input', () => { $('classifyCount').textContent = `${$('classifyInput').value.trim().length}/1000`; });
  $('classifyForm').addEventListener('submit', async e => {
    e.preventDefault();
    const message = $('classifyInput').value.trim();
    if (message.length < 3) return showError($('classifyError'), 'Please enter the resident message to classify.');
    showError($('classifyError'), '');
    $('classifyBtn').disabled = true;
    $('classifyLoading').hidden = false;
    try {
      const data = await postJson('/api/ai/classify', { message });
      const received = performance.now();
      const r = data.result;
      $('cCategory').textContent = r.category;
      $('cSub').textContent = r.subcategory;
      $('cIntent').textContent = r.intent;
      $('cSummary').textContent = r.summary || '—';
      $('cReply').value = r.suggested_reply || '';
      $('classifyResult').hidden = false;
      inquiriesLoaded = false;   // refresh the log next time it's opened
      reportRender(data.log_id, received);
    } catch (err) {
      showError($('classifyError'), err.message);
    } finally {
      $('classifyBtn').disabled = false;
      $('classifyLoading').hidden = true;
    }
  });
  $('copyReply').addEventListener('click', e => copyText($('cReply').value, e.currentTarget));

  // ── Inquiry log ─────────────────────────────────────────────────────────────
  async function loadInquiries() {
    const params = new URLSearchParams();
    if ($('inqCategory').value) params.set('category', $('inqCategory').value);
    if ($('inqFrom').value) params.set('from', $('inqFrom').value);
    if ($('inqTo').value) params.set('to', $('inqTo').value);
    const tbody = $('inqRows');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Loading…</td></tr>';
    try {
      const data = await callApi(`/api/ai/inquiries?${params}`);
      const sel = $('inqCategory');
      if (sel.options.length === 1) data.categories.forEach(c => sel.add(new Option(c, c)));
      $('inqCounts').innerHTML = data.counts.map(c => `<span class="ai-chipcount">${escapeHtml(c.category || 'Unclassified')} <b>${c.total}</b></span>`).join('');
      tbody.innerHTML = data.inquiries.length
        ? data.inquiries.map(i => `<tr>
            <td style="white-space:nowrap">${formatDateTime(i.created_at)}</td>
            <td class="ai-msgcell">${escapeHtml(i.message)}</td>
            <td>${escapeHtml(i.category || '—')}</td>
            <td>${escapeHtml(i.subcategory || '—')}</td>
            <td>${escapeHtml(i.intent || '—')}</td>
            <td class="ai-meta">${i.source === 'staff' ? 'Staff entry' : escapeHtml(i.resident_name || 'Public visitor')}</td>
          </tr>`).join('')
        : '<tr><td colspan="6" style="text-align:center;color:var(--muted)">No inquiries found.</td></tr>';
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#b42318">${escapeHtml(err.message)}</td></tr>`;
    }
  }
  ['inqCategory', 'inqFrom', 'inqTo'].forEach(id => $(id).addEventListener('change', loadInquiries));
})();
