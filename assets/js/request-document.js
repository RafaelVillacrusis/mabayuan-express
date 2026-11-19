/* Request a Document — form with live summary */
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);
  const form = $('requestForm');
  const select = $('documentSelect');
  const details = $('purposeDetails');
  const phone = $('contactNumber');
  const errorBox = $('formError');
  const submitBtn = $('submitBtn');
  let docs = [];

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
  }

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
  form.addEventListener('submit', e => {
    showError('');
    if (!select.value) { e.preventDefault(); return showError('Please choose the document you need.', select); }
    const purpose = selectedPurpose();
    if (!purpose) { e.preventDefault(); return showError('Please choose the purpose of your request.', form.querySelector('input[name="purpose"]')); }
    if (purpose === 'Others' && details.value.trim().length < 3) {
      e.preventDefault();
      return showError('Please describe the purpose in "Additional details".', details);
    }
    if (!/^9\d{9}$/.test(phone.value)) {
      e.preventDefault();
      phPhoneValidate(phone);
      return showError('Please enter a valid mobile number (10 digits starting with 9).', phone);
    }
    // Store as 09XXXXXXXXX, same format as the resident profile
    phone.value = '0' + phone.value;
    phone.removeAttribute('maxlength');
    phone.removeAttribute('pattern');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
  });

  // If the page is restored from the back/forward cache after submitting, reset the button
  window.addEventListener('pageshow', () => {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit request';
    if (/^09\d{9}$/.test(phone.value)) phone.value = phone.value.slice(1);
    phone.setAttribute('maxlength', '10');
  });
});
