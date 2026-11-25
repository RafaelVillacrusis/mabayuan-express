function footerHtml() {
  return `
    <footer class="site-footer">
      <div>
        <h4>Mabayuan Express</h4>
        <p>Barangay document request and tracking portal for online requesting, status tracking, and document release updates.</p>
      </div>
      <div>
        <h4>Access</h4>
        <a href="/resident/login">Resident Login</a>
        <a href="/resident/register">Create Resident Account</a>
      </div>
      <div>
        <h4>Help</h4>
        <a href="/help/about">About</a>
        <a href="/help/faq">FAQ</a>
        <a href="/help/privacy-policy">Privacy Policy</a>
        <a href="/help/terms-and-conditions">Terms &amp; Conditions</a>
      </div>
      <div>
        <h4>Contact</h4>
        <p>mabayuan.express@gmail.com</p>
        <p>0992-713-0687</p>
      </div>
    </footer>`;
}

function mountFooter() {
  let target = document.getElementById('footerMount');
  if (!target) {
    const pageShell = document.querySelector('.page-shell');
    if (!pageShell) return;
    target = document.createElement('div');
    target.id = 'footerMount';
    pageShell.appendChild(target);
  }
  target.innerHTML = footerHtml();
}

document.addEventListener('DOMContentLoaded', function() {
  // Only mount footer on the landing page
  const path = window.location.pathname;
  if (path === '/' || path === '/index.html') {
    mountFooter();
  }
});

function showStatusMessage(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const params = new URLSearchParams(window.location.search);
  const map = {
    pending: 'Registration received. Please wait for system admin approval before logging in.',
    '1': 'Changes saved successfully.'
  };
  let text = '';
  if (params.get('registered') === 'pending') text = map.pending;
  else if (params.get('submitted') === '1') text = 'Your request has been submitted successfully.';
  else if (params.get('saved') === '1') text = map['1'];
  target.textContent = text;
  target.style.display = text ? 'block' : 'none';
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function peso(value) {
  const number = Number(value || 0);
  return `₱${number.toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLogs(logs) {
  return logs.map(log => `
    <div class="log-item">
      <strong>${escapeHtml(log.action_type)}</strong>
      <div>${escapeHtml(log.old_status || '-')} → ${escapeHtml(log.new_status || '-')}</div>
      <div>Release: ${escapeHtml(log.old_release_date || '-')} → ${escapeHtml(log.new_release_date || '-')}</div>
      <div>${escapeHtml(log.remarks || 'No remarks')}</div>
      <small>${escapeHtml(log.changed_by_role || 'system')} • ${formatDateTime(log.created_at)}</small>
    </div>
  `).join('') || '<p class="empty-state">No logs yet.</p>';
}

// Show inline error from query string (used by login/register redirects)
function showErrorFromQuery(bannerId) {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  if (error) {
    const el = document.getElementById(bannerId);
    if (el) { el.textContent = decodeURIComponent(error); el.style.display = 'block'; }
  }
}

// Clamp year to 4 digits on all date inputs — prevents years like 275760
(function () {
  function clampYear(input) {
    if (!input.value) return;
    const parts = input.value.split('-');
    if (parts[0] && parts[0].length > 4) {
      parts[0] = parts[0].slice(0, 4);
      input.value = parts.join('-');
    }
  }

  function attachDateClamp() {
    document.querySelectorAll('input[type="date"]').forEach(function (input) {
      if (input.dataset.yearClamped) return;
      input.dataset.yearClamped = '1';

      // Set a reasonable max year
      if (!input.max) input.max = '2100-12-31';
      if (!input.min && !input.id?.includes('dateFrom') && !input.id?.includes('dateTo')) {
        // For birth dates, allow past dates; for others, keep existing min
      }

      input.addEventListener('input', function () { clampYear(this); });
      input.addEventListener('change', function () { clampYear(this); });
      input.addEventListener('blur', function () { clampYear(this); });
      input.addEventListener('keyup', function () { clampYear(this); });
    });
  }

  // Run on DOM ready and after dynamic content loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachDateClamp);
  } else {
    attachDateClamp();
  }

  // Also re-run after modals/dynamic content open (MutationObserver)
  const obs = new MutationObserver(function () { attachDateClamp(); });
  document.addEventListener('DOMContentLoaded', function () {
    obs.observe(document.body, { childList: true, subtree: true });
  });
})();

// Global Philippine phone number validation — 09XXXXXXXXX only
function phPhoneInput(inp) {
  // Strip non-digits
  let v = inp.value.replace(/\D/g, '');
  // Must start with 9 (since +63 is the prefix, first digit is 9)
  if (v.length >= 1 && v[0] !== '9') v = '9' + v.replace(/^9*/, '');
  // Cap at 10 digits (9XXXXXXXXX)
  if (v.length > 10) v = v.slice(0, 10);
  inp.value = v;
  phPhoneValidate(inp);
}

function phPhoneValidate(inp) {
  const v = inp.value;
  const hint = inp.closest('.ph-phone-wrap') ? inp.closest('.ph-phone-wrap').nextElementSibling : inp.nextElementSibling;
  const valid = /^9[0-9]{9}$/.test(v);
  if (!v) {
    inp.style.borderColor = '';
    if (hint && hint.classList.contains('ph-phone-hint')) hint.style.display = 'none';
  } else if (!valid) {
    inp.style.borderColor = '#dc2626';
    if (hint && hint.classList.contains('ph-phone-hint')) {
      hint.style.display = 'block';
      hint.textContent = !v.startsWith('9') ? 'Number must start with 9 (e.g. 9171234567).'
        : v.length < 10 ? 'Must be exactly 10 digits after +63.'
        : 'Invalid phone number.';
    }
  } else {
    inp.style.borderColor = '#16a34a';
    if (hint && hint.classList.contains('ph-phone-hint')) hint.style.display = 'none';
  }
}

// Get full phone number with +63 prefix for storage (returns 09XXXXXXXXX format)
function phPhoneFullValue(inp) {
  return inp.value ? '0' + inp.value : '';
}


/**
 * Show the valid ID a resident uploaded with a document request (staff & captain request pages).
 * @param {object} req   request from getRequestById (has_valid_id, valid_id_type, request_id)
 * @param {string} role  'staff' | 'captain'
 */
function renderRequestValidId(req, role) {
  const box = document.getElementById('validIdBody');
  if (!box) return;
  if (!req.has_valid_id) {
    box.innerHTML = '<p class="rq-id-missing">⚠️ No valid ID was uploaded with this request. Ask the resident to present one when claiming.</p>';
    return;
  }
  const url = `/api/${role}/requests/${encodeURIComponent(req.request_id)}/valid-id`;
  const type = req.valid_id_type || 'ID from registration (type not specified)';
  box.innerHTML = `
    <div class="rq-id-type"><span>ID type</span><strong>${escapeHtml(type)}</strong></div>
    <a class="rq-id-frame" href="${url}" target="_blank" rel="noopener" title="Open full size">
      <img alt="Valid ID uploaded by the resident" loading="lazy">
      <span class="rq-id-pdf" hidden>📄 PDF file — open to view</span>
    </a>
    <div class="button-row" style="margin-top:10px"><a class="btn btn-small btn-ghost" href="${url}" target="_blank" rel="noopener">🔍 Open full size</a></div>
    <p class="rq-id-tip">Check that the name and photo match the resident and that the ID is not expired.</p>`;
  const img = box.querySelector('img');
  img.addEventListener('error', () => {
    // Not an image (PDF) or the file is gone — find out which
    fetch(url, { method: 'HEAD' }).then(r => {
      const pdf = r.ok && /pdf/i.test(r.headers.get('content-type') || '');
      img.hidden = true;
      const note = box.querySelector('.rq-id-pdf');
      note.hidden = false;
      if (!pdf) note.textContent = '⚠️ The ID file could not be loaded.';
    }).catch(() => {});
  });
  img.src = url;
}


/** Gender badge for request queues; residents who registered before gender was asked show "Not specified". */
function genderPill(gender) {
  if (!gender) return '<span class="g-pill g-none">Not specified</span>';
  const cls = gender === 'Male' ? 'g-male' : gender === 'Female' ? 'g-female' : 'g-other';
  return `<span class="g-pill ${cls}">${escapeHtml(gender)}</span>`;
}
/** Sort order for the Gender column: Female, Male, Prefer not to say, then Not specified. */
function genderSortKey(gender) {
  return { Female: '1', Male: '2', 'Prefer not to say': '3' }[gender] || '9';
}
