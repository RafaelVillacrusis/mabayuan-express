/* Captain — Document Configuration: add, edit, enable/disable and delete document types */
(function () {
  const $ = id => document.getElementById(id);
  let docs = [];
  let editing = null;       // document being edited, or null when adding
  let toastTimer;

  const feeText = p => Number(p) > 0 ? peso(p) : 'Free';
  const daysText = d => Number(d) > 0 ? `${d} working day${Number(d) === 1 ? '' : 's'}` : 'Same day';

  function toast(msg) {
    const t = $('dcToast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(json.error || 'Something went wrong. Please try again.'); e.field = json.field; throw e; }
    return json;
  }

  // ── List ───────────────────────────────────────────────────────────────────
  async function load() {
    try {
      docs = await api('/api/captain/documents');
    } catch (e) {
      $('docRows').innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(e.message)}</td></tr>`;
      return;
    }
    render();
  }

  function render() {
    const on = docs.filter(d => d.is_active).length;
    $('statTotal').textContent = docs.length;
    $('statOn').textContent = on;
    $('statOff').textContent = docs.length - on;
    $('statOpen').textContent = docs.reduce((n, d) => n + (d.open_count || 0), 0);

    const q = $('docSearch').value.trim().toLowerCase();
    const f = $('docFilter').value;
    const rows = docs.filter(d =>
      (f === 'all' || (f === 'on') === !!d.is_active) &&
      (!q || `${d.document_name} ${d.description || ''}`.toLowerCase().includes(q)));
    $('docResult').textContent = `${rows.length} of ${docs.length} document${docs.length === 1 ? '' : 's'}`;

    $('docRows').innerHTML = rows.length ? rows.map(d => `
      <tr class="${d.is_active ? '' : 'dc-off'}">
        <td><div class="dc-doc"><strong>${escapeHtml(d.document_name)}</strong>${d.description ? `<small>${escapeHtml(d.description)}</small>` : ''}</div></td>
        <td><span class="dc-fee ${Number(d.price) > 0 ? '' : 'free'}">${feeText(d.price)}</span></td>
        <td style="white-space:nowrap">${daysText(d.processing_days)}</td>
        <td>${d.request_count}${d.open_count ? `<div class="dc-muted">${d.open_count} open</div>` : ''}</td>
        <td><label class="dc-switch" title="${d.is_active ? 'Residents can request this document' : 'Hidden from residents'}">
          <input type="checkbox" data-toggle="${d.document_id}" ${d.is_active ? 'checked' : ''} aria-label="Available to residents: ${escapeHtml(d.document_name)}">
          <span class="dc-track"></span><span class="${d.is_active ? 'dc-on' : 'dc-off-label'}">${d.is_active ? 'Available' : 'Unavailable'}</span></label></td>
        <td><div class="dc-actions">
          <button type="button" class="btn btn-small btn-ghost" data-edit="${d.document_id}">✏️ Edit</button>
          ${d.request_count ? '' : `<button type="button" class="btn btn-small btn-ghost" data-delete="${d.document_id}" style="color:#b42318">🗑 Delete</button>`}
        </div></td>
      </tr>`).join('')
      : `<tr><td colspan="6" class="empty-state">${docs.length ? 'No documents match your search.' : 'No document types yet. Click “＋ Add document” to create one.'}</td></tr>`;
  }

  // ── Quick availability toggle ──────────────────────────────────────────────
  async function toggle(input) {
    const d = docs.find(x => String(x.document_id) === input.dataset.toggle);
    if (!d) return;
    const makeOn = input.checked;
    if (!makeOn && d.is_active && docs.filter(x => x.is_active).length === 1 &&
        !confirm(`"${d.document_name}" is the only available document. If you turn it off, residents won't be able to request anything online. Continue?`)) {
      input.checked = true;
      return;
    }
    input.disabled = true;
    try {
      await api(`/api/captain/documents/${d.document_id}`, {
        method: 'PUT',
        body: JSON.stringify({ document_name: d.document_name, description: d.description || '', price: d.price, processing_days: d.processing_days, is_active: makeOn ? '1' : '0' }),
      });
      toast(makeOn ? `✅ ${d.document_name} is now available to residents` : `⏸️ ${d.document_name} is now hidden from residents`);
      await load();
    } catch (e) {
      input.checked = !makeOn;
      input.disabled = false;
      alert(e.message);
    }
  }

  // ── Add / edit modal ───────────────────────────────────────────────────────
  function openModal(doc) {
    editing = doc || null;
    $('docModalTitle').textContent = doc ? `Edit ${doc.document_name}` : 'Add document';
    $('docSave').textContent = doc ? 'Save changes' : 'Add document';
    $('fName').value = doc ? doc.document_name : '';
    $('fDesc').value = doc ? doc.description || '' : '';
    $('fPrice').value = doc ? Number(doc.price).toFixed(2) : '';
    $('fDays').value = doc ? doc.processing_days : '';
    $('fActive').checked = doc ? !!doc.is_active : true;
    showError('');
    updatePreview();
    $('docModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('fName').focus(), 30);
  }
  function closeModal() {
    $('docModal').hidden = true;
    document.body.style.overflow = '';
  }
  function showError(msg, field) {
    $('docError').textContent = msg;
    $('docError').hidden = !msg;
    ['fName', 'fDesc', 'fPrice', 'fDays'].forEach(id => $(id).classList.remove('bad'));
    const el = { document_name: 'fName', description: 'fDesc', price: 'fPrice', processing_days: 'fDays' }[field];
    if (el) { $(el).classList.add('bad'); $(el).focus(); }
  }

  function updatePreview() {
    const name = $('fName').value.trim() || 'Document name';
    const price = $('fPrice').value === '' ? null : Number($('fPrice').value);
    const days = $('fDays').value === '' ? null : Number($('fDays').value);
    $('fDescCount').textContent = $('fDesc').value.length;
    $('fActiveLabel').textContent = $('fActive').checked ? 'Available — residents can request it' : 'Unavailable — hidden from residents';
    $('pvOption').textContent = `${name} — ${price === null ? '₱—' : feeText(price)}`;
    $('pvMeta').textContent = [
      days === null ? null : `Processing time: ${daysText(days)}`,
      $('fDesc').value.trim() || null,
    ].filter(Boolean).join(' · ') || '';
    $('pvOption').style.opacity = $('fActive').checked ? '1' : '.45';

    // Warn about changes that affect residents
    const warn = [];
    if (editing) {
      if (price !== null && Number(editing.price) !== price) warn.push(`The fee changes from ${feeText(editing.price)} to ${feeText(price)} for new requests.`);
      if (days !== null && Number(editing.processing_days) !== days) warn.push(`Processing time changes to ${daysText(days).toLowerCase()} for new requests.`);
      if (editing.is_active && !$('fActive').checked && editing.open_count) warn.push(`${editing.open_count} open request${editing.open_count === 1 ? '' : 's'} will still be processed — residents just can't submit new ones.`);
    }
    $('docWarn').innerHTML = warn.map(w => `⚠️ ${escapeHtml(w)}`).join('<br>');
    $('docWarn').hidden = !warn.length;
  }

  function validate() {
    const name = $('fName').value.trim();
    if (name.length < 3) return ['Please enter the document name (at least 3 characters).', 'document_name'];
    const dup = docs.find(d => d.document_name.toLowerCase() === name.toLowerCase() && (!editing || d.document_id !== editing.document_id));
    if (dup) return [`A document named "${dup.document_name}" already exists.`, 'document_name'];
    const price = $('fPrice').value;
    if (price === '' || Number(price) < 0 || Number(price) > 100000) return ['Please enter a fee from ₱0 to ₱100,000 (use 0 for free documents).', 'price'];
    const days = $('fDays').value;
    if (days === '' || !Number.isInteger(Number(days)) || Number(days) < 0 || Number(days) > 60) return ['Processing days must be a whole number from 0 (same day) to 60.', 'processing_days'];
    return null;
  }

  async function save(e) {
    e.preventDefault();
    const problem = validate();
    if (problem) return showError(...problem);
    showError('');
    const btn = $('docSave');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const body = JSON.stringify({
      document_name: $('fName').value.trim(),
      description: $('fDesc').value.trim(),
      price: $('fPrice').value,
      processing_days: $('fDays').value,
      is_active: $('fActive').checked ? '1' : '0',
    });
    try {
      if (editing) await api(`/api/captain/documents/${editing.document_id}`, { method: 'PUT', body });
      else await api('/api/captain/documents', { method: 'POST', body });
      closeModal();
      toast(editing ? '✅ Document updated' : '✅ Document added');
      await load();
    } catch (err) {
      showError(err.message, err.field);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function remove(doc) {
    showDeleteModal({
      title: '🗑 Delete document',
      message: `Delete "${doc.document_name}"? It has never been requested, so it can be removed completely.`,
      onConfirm: async () => {
        try {
          await api(`/api/captain/documents/${doc.document_id}`, { method: 'DELETE' });
          toast('🗑 Document deleted');
        } catch (e) { alert(e.message); }
        await load();
      },
    });
  }

  // ── Wire up ────────────────────────────────────────────────────────────────
  $('addDocBtn').addEventListener('click', () => openModal(null));
  $('docForm').addEventListener('submit', save);
  $('docForm').addEventListener('input', updatePreview);
  $('fActive').addEventListener('change', updatePreview);
  $('docModal').addEventListener('click', e => {
    if (e.target.id === 'docModal' || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('docModal').hidden) closeModal(); });
  $('docSearch').addEventListener('input', render);
  $('docFilter').addEventListener('change', render);
  $('docRows').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]');
    if (edit) return openModal(docs.find(d => String(d.document_id) === edit.dataset.edit));
    const del = e.target.closest('[data-delete]');
    if (del) return remove(docs.find(d => String(d.document_id) === del.dataset.delete));
  });
  $('docRows').addEventListener('change', e => {
    if (e.target.matches('[data-toggle]')) toggle(e.target);
  });

  // Keep in sync when the system admin (or another captain session) changes documents
  if (window.io) {
    const socket = io();
    socket.emit('join:role', 'captain');
    socket.on('dashboard:refresh', load);
  }

  load();
})();
