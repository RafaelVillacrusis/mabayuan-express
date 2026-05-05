/**
 * Reusable delete/confirm modal — uses .details-modal CSS from style.css
 * Usage: showDeleteModal({ title, message, onConfirm })
 */
(function () {
  function injectModal() {
    if (document.getElementById('globalDeleteModal')) return;
    const html = `
    <div class="details-modal" id="globalDeleteModal">
      <div class="details-card" style="max-width:400px;">
        <div class="details-head" style="background:linear-gradient(135deg,#8b1a22,#b03040);">
          <h2 id="gdmTitle">🗑 Delete</h2>
          <button class="details-close" onclick="closeDeleteModal()">✕</button>
        </div>
        <div class="details-body" style="text-align:center;padding:28px 24px;">
          <p id="gdmMessage" style="font-size:15px;color:#2d1518;margin:0 0 8px;font-weight:600;"></p>
          <p style="font-size:13px;color:#9a7a7d;margin:0;">This cannot be undone.</p>
        </div>
        <div class="details-foot" style="justify-content:center;">
          <button class="btn-delete" onclick="closeDeleteModal()">Cancel</button>
          <button class="btn-view" style="background:#8b1a22;" id="gdmConfirmBtn">Confirm</button>
        </div>
      </div>
    </div>`;
    document.body.insertAdjacentHTML('afterbegin', html);
    document.getElementById('globalDeleteModal').addEventListener('click', function (e) {
      if (e.target === this) closeDeleteModal();
    });
  }

  window.showDeleteModal = function ({ title, message, onConfirm }) {
    injectModal();
    document.getElementById('gdmTitle').textContent = title || '🗑 Delete';
    document.getElementById('gdmMessage').textContent = message || 'Are you sure?';
    const modal = document.getElementById('globalDeleteModal');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    const btn = document.getElementById('gdmConfirmBtn');
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', function () {
      closeDeleteModal();
      if (typeof onConfirm === 'function') onConfirm();
    });
  };

  window.closeDeleteModal = function () {
    const modal = document.getElementById('globalDeleteModal');
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  };
})();
