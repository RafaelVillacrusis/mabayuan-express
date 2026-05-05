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
  // Force start with 09
  if (v.length >= 1 && v[0] !== '0') v = '0' + v;
  if (v.length >= 2 && v[1] !== '9') v = '09' + v.replace(/^0*9*/, '');
  // Cap at 11
  if (v.length > 11) v = v.slice(0, 11);
  inp.value = v;
  phPhoneValidate(inp);
}

function phPhoneValidate(inp) {
  const v = inp.value;
  const hint = inp.nextElementSibling;
  const valid = /^09[0-9]{9}$/.test(v);
  if (!v) {
    inp.style.borderColor = '';
    if (hint && hint.classList.contains('ph-phone-hint')) hint.style.display = 'none';
  } else if (!valid) {
    inp.style.borderColor = '#dc2626';
    if (hint && hint.classList.contains('ph-phone-hint')) {
      hint.style.display = 'block';
      hint.textContent = !v.startsWith('09') ? 'Philippine numbers must start with 09.'
        : v.length < 11 ? 'Must be exactly 11 digits.'
        : 'Invalid phone number.';
    }
  } else {
    inp.style.borderColor = '#16a34a';
    if (hint && hint.classList.contains('ph-phone-hint')) hint.style.display = 'none';
  }
}
