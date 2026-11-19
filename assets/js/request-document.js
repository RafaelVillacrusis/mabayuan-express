/* Request a Document — form with live summary */
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const form = $('requestForm');
  const select = $('documentSelect');
  const details = $('purposeDetails');
  const phone = $('contactNumber');
  const errorBox = $('formError');
  const submitBtn = $('submitBtn');
  const idType = $('validIdType');
  const idFile = $('validIdFile');
  const idDrop = $('idDrop');
  const MAX_ID_BYTES = 5 * 1024 * 1024;
  const ID_MIME = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;
  let docs = [];
  let idPreviewUrl = null;

  function showError(msg, focusEl) {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
    if (focusEl) focusEl.focus();
  }

  function selectedPurpose() {
    const checked = form.querySelector('input[name="purpose"]:checked');
    return checked ? checked.value : '';
  }

  function formatRelease(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function updateSummary() {
    const doc = docs.find(d => String(d.document_id) === select.value);
    const desc = $('docDescription');
    if (doc) {
      const days = Number(doc.processing_days) || 0;
      const price = Number(doc.price) || 0;
      $('sumDocument').textContent = doc.document_name;
      $('processingDays').textContent = days ? `${days} working day${days === 1 ? '' : 's'}` : 'Same day';
      $('suggestedRelease').textContent = formatRelease(days);
      $('documentPrice').textContent = price > 0 ? peso(price) : 'Free';
      desc.textContent = doc.description || '';
      desc.hidden = !doc.description;
    } else {
      ['sumDocument', 'processingDays', 'suggestedRelease', 'documentPrice'].forEach(id => { $(id).textContent = '—'; });
      desc.hidden = true;
    }
    const purpose = selectedPurpose();
    $('sumPurpose').textContent = purpose || '—';
    $('detailsReq').textContent = purpose === 'Others' ? '(required — please describe the purpose)' : '(optional)';
    $('detailsCount').textContent = details.value.length;
    const file = idFile.files[0];
    $('sumValidId').textContent = idType.value ? (file ? idType.value : `${idType.value} (photo missing)`) : (file ? 'Type not selected' : '—');
  }

  // ── Valid ID upload ─────────────────────────────────────────────────────
  function idFileProblem(file) {
    if (!file) return 'Please upload a photo of your valid ID.';
    if (!ID_MIME.test(file.type)) return 'Your valid ID must be an image (JPG, PNG, GIF, WEBP) or a PDF.';
    if (file.size > MAX_ID_BYTES) return 'Your valid ID file must be 5MB or smaller.';
    return '';
  }

  function renderIdFile() {
    const file = idFile.files[0];
    if (idPreviewUrl) { URL.revokeObjectURL(idPreviewUrl); idPreviewUrl = null; }
    $('idDropEmpty').hidden = !!file;
    $('idDropFile').hidden = !file;
    idDrop.classList.toggle('has-file', !!file && !idFileProblem(file));
    idDrop.classList.remove('invalid');
    if (file) {
      const thumb = $('idThumb');
      $('idFileName').textContent = file.name;
      $('idFileSize').textContent = `${(file.size / 1024 / 1024).toFixed(file.size < 1024 * 1024 ? 2 : 1)} MB`;
      if (file.type.startsWith('image/')) {
        idPreviewUrl = URL.createObjectURL(file);
        thumb.style.backgroundImage = `url("${idPreviewUrl}")`;
        thumb.textContent = '';
      } else {
        thumb.style.backgroundImage = '';
        thumb.textContent = 'PDF';
      }
      const problem = idFileProblem(file);
      if (problem) { idDrop.classList.add('invalid'); showError(problem); }
      else showError('');
    }
    updateSummary();
  }

  idFile.addEventListener('change', renderIdFile);
  idType.addEventListener('change', () => { showError(''); updateSummary(); });
  ['dragenter', 'dragover'].forEach(ev => idDrop.addEventListener(ev, () => idDrop.classList.add('drag')));
  ['dragleave', 'drop'].forEach(ev => idDrop.addEventListener(ev, () => idDrop.classList.remove('drag')));

  // ── Load documents ──────────────────────────────────────────────────────
  try {
    const res = await fetch('/api/public/documents');
    docs = await res.json();
    select.insertAdjacentHTML('beforeend', docs.map(d => {
      const price = Number(d.price) > 0 ? peso(d.price) : 'Free';
      return `<option value="${d.document_id}">${escapeHtml(d.document_name)} — ${price}</option>`;
    }).join(''));
    if (!docs.length) showError('No documents are available for online request right now. Please contact the barangay office.');
  } catch {
    showError('Could not load the list of documents. Please check your connection and refresh the page.');
  }

  // Preselect a document when coming from another page (?document=<id>)
  const preselect = new URLSearchParams(window.location.search).get('document');
  if (preselect && [...select.options].some(o => o.value === preselect)) select.value = preselect;

  // Prefill the mobile number from the resident's profile
  try {
    const res = await fetch('/api/resident/profile');
    const profile = res.ok ? await res.json() : null;
    const num = (profile && profile.phone_number || '').replace(/\D/g, '').replace(/^63/, '').replace(/^0/, '');
    if (!phone.value && /^9\d{9}$/.test(num)) { phone.value = num; phPhoneValidate(phone); }
  } catch { /* leave empty */ }

  updateSummary();
  select.addEventListener('change', () => { showError(''); updateSummary(); });
  form.querySelectorAll('input[name="purpose"]').forEach(r => r.addEventListener('change', () => { showError(''); updateSummary(); }));
  details.addEventListener('input', updateSummary);

  // ── Validate & submit ───────────────────────────────────────────────────
  form.addEventListener('submit', async e => {
    e.preventDefault();
    showError('');
    if (!select.value) return showError('Please choose the document you need.', select);
    const purpose = selectedPurpose();
    if (!purpose) return showError('Please choose the purpose of your request.', form.querySelector('input[name="purpose"]'));
    if (purpose === 'Others' && details.value.trim().length < 3) {
      return showError('Please describe the purpose in "Additional details".', details);
    }
    if (!idType.value) return showError('Please select the type of valid ID you are uploading.', idType);
    const idProblem = idFileProblem(idFile.files[0]);
    if (idProblem) { idDrop.classList.add('invalid'); return showError(idProblem, idFile); }
    if (!/^9\d{9}$/.test(phone.value)) {
      phPhoneValidate(phone);
      return showError('Please enter a valid mobile number (10 digits starting with 9).', phone);
    }

    const data = new FormData(form);
    data.set('contact_number', '0' + phone.value); // stored as 09XXXXXXXXX, same as the profile
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading ID & submitting…';
    try {
      const res = await fetch(form.action, { method: 'POST', body: data, headers: { Accept: 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) { window.location.href = json.redirect || '/resident/dashboard?submitted=1'; return; }
      if (res.status === 401 || res.redirected) { window.location.href = '/login'; return; }
      const focus = { valid_id: idFile, valid_id_type: idType, document_id: select, contact_number: phone }[json.field];
      if (json.field === 'valid_id') idDrop.classList.add('invalid');
      showError(json.error || 'Could not submit your request. Please try again.', focus);
    } catch {
      showError('Could not reach the server. Please check your connection and try again.');
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit request';
  });

  // If the page is restored from the back/forward cache after submitting, reset the button
  window.addEventListener('pageshow', () => {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit request';
    renderIdFile();
  });
});
