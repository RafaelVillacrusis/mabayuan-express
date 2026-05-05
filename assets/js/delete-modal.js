/**
 * Reusable delete confirmation modal
 * Matches the design on resident_dashboard.html
 * Usage: showDeleteModal({ title, message, onConfirm })
 */
(function () {
  function injectModal() {
    if (document.getElementById('globalDeleteModal')) return;
    const html = `
    <div class="details-modal" id="globalDeleteModal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.55);align-items:center;justify-content:center;backdrop-filter:blur(4px);">
      <div class="details-card" style="max-width:400px;width:calc(100% - 32px);">
        <div class="details-head" style="background:linear-gradient(135deg,#8b1a22,#b03040);">
          <h2 id="gdmTitle">🗑 Delete</h2>
          <button class="details-close" onclick="closeDeleteModal()">✕</button>
        </div>
        <div class="details-body" style="text-align:center;padding:28px 24px;">
          <p id="gdmMessage" style="font-size:15px;color:#2d1518;margin:0 0 8px;font-weight:600;">Are you sure?</p>
          <p style="font-size:13px;color:#9a7a7d;margin:0;">This cannot be undone.</p>
        </div>
        <div class="details-foot" style="justify-content:center;gap:12px;">
          <button class="btn-delete" style="border-radius:10px;padding:11px 24px;font-size:14px;" onclick="closeDeleteModal()">Cancel</button>
          <button class="btn-view" style="border-radius:10px;padding:11px 24px;font-size:14px;background:#8b1a22;color:#fff;border:none;cursor:pointer;" id="gdmConfirmBtn">Confirm</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('afterbegin', html);

    // Close on backdrop click
    document.getElementById('globalDeleteModal').addEventListener('click', function (e) {
      if (e.target === this) closeDeleteModal();
    });
  }

  window.showDeleteModal = function ({ title = '🗑 Delete', message = 'Are you sure you want to delete this?', onConfirm }) {
    injectModal();
    document.getElementById('gdmTitle').textContent = title;
    document.getElementById('gdmMessage').textContent = message;
    const modal = document.getElementById('globalDeleteModal');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const btn = document.getElementById('gdmConfirmBtn');
    const newBtn = btn.cloneNode(true); // remove old listeners
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', function () {
      closeDeleteModal();
      if (typeof onConfirm === 'function') onConfirm();
    });
  };

  window.closeDeleteModal = function () {
    const modal = document.getElementById('globalDeleteModal');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  };
})();
