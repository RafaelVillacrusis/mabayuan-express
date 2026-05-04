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
