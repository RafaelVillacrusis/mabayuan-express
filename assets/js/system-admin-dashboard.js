let socket;
let currentAdminId = null;

async function loadMe() {
  const res = await fetch('/api/system-admin/me');
  const me = await res.json();
  currentAdminId = me.user_id;
  document.getElementById('adminName').textContent = me.full_name;
}

async function loadCounts() {
  const res = await fetch('/api/system-admin/counts');
  const data = await res.json();
  document.getElementById('countTotal').textContent = data.total_requests || 0;
  document.getElementById('countResidents').textContent = data.total_residents || 0;
  document.getElementById('countDocuments').textContent = data.total_documents || 0;
  document.getElementById('countUsers').textContent = data.total_users || 0;
}

async function loadDocuments() {
  const res = await fetch('/api/system-admin/documents');
  const rows = await res.json();
  document.getElementById('documentRows').innerHTML = rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.document_name)}</strong><br><small style="color:#94a3b8">${escapeHtml(row.description||'')}</small></td>
      <td>₱${Number(row.price).toFixed(2)}</td>
      <td>${row.processing_days} day${row.processing_days !== 1 ? 's' : ''}</td>
      <td><span class="badge ${row.is_active ? 'badge-green' : 'badge-gray'}">${row.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="display:flex;gap:6px;">
        <button class="btn btn-small btn-ghost" onclick="editDocument(${row.document_id},'${escapeHtml(row.document_name).replace(/'/g,"&#39;")}','${escapeHtml(row.description||'').replace(/'/g,"&#39;")}','${row.price}','${row.processing_days}','${row.is_active}')">Edit</button>
        <button class="btn btn-small btn-danger" onclick="deleteDocument(${row.document_id},'${escapeHtml(row.document_name).replace(/'/g,"&#39;")}')">Delete</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty-state">No documents yet.</td></tr>`;
}

async function loadUsers() {
  const res = await fetch('/api/system-admin/users');
  const rows = await res.json();
  const roleLabel = { staff:'Staff', captain:'Captain', system_admin:'System Admin' };
  document.getElementById('userRows').innerHTML = rows.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.full_name)}</strong></td>
      <td style="color:#64748b">${escapeHtml(row.email)}</td>
      <td>
        <select class="select" style="min-width:130px" onchange="updateUserRole(${row.user_id}, this.value)">
          <option value="staff" ${row.role==='staff'?'selected':''}>Staff</option>
          <option value="captain" ${row.role==='captain'?'selected':''}>Captain</option>
          <option value="system_admin" ${row.role==='system_admin'?'selected':''}>System Admin</option>
        </select>
      </td>
      <td>${Number(row.user_id)===Number(currentAdminId)
        ? '<span style="color:#94a3b8;font-size:13px">Current account</span>'
        : `<button class="btn btn-small btn-danger" onclick="deleteUser(${row.user_id})">Delete</button>`}</td>
    </tr>`).join('') || `<tr><td colspan="4" class="empty-state">No users yet.</td></tr>`;
}

async function updateUserRole(id, role) {
  const res = await fetch(`/api/system-admin/users/${id}/update-role`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({role}) });
  if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error || 'Could not update role.'); }
  await refreshAll();
}

async function deleteUser(id) {
  showDeleteModal({
    title: '🗑 Delete User',
    message: 'Delete this user account?',
    onConfirm: async () => {
      const res = await fetch(`/api/system-admin/users/${id}/delete`, { method:'POST' });
      if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error || 'Could not delete user.'); }
      await refreshAll();
    }
  });
}

function editDocument(id, name, description, price, days, active) {
  // Populate modal fields
  document.getElementById('editDocName').value = decodeHtml(name);
  document.getElementById('editDocDesc').value = decodeHtml(description || '');
  document.getElementById('editDocPrice').value = price;
  document.getElementById('editDocDays').value = days;
  document.getElementById('editDocActive').value = active ? '1' : '0';
  document.getElementById('editDocError').style.display = 'none';

  // Store the id for submission
  document.getElementById('editDocModal').dataset.docId = id;
  document.getElementById('editDocModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeEditDocModal() {
  document.getElementById('editDocModal').style.display = 'none';
  document.body.style.overflow = '';
}

async function submitEditDoc() {
  const id = document.getElementById('editDocModal').dataset.docId;
  const name = document.getElementById('editDocName').value.trim();
  const description = document.getElementById('editDocDesc').value.trim();
  const price = document.getElementById('editDocPrice').value;
  const days = document.getElementById('editDocDays').value;
  const is_active = document.getElementById('editDocActive').value;
  const errorEl = document.getElementById('editDocError');

  if (!name || !price || !days) {
    errorEl.textContent = 'Document name, price, and processing days are required.';
    errorEl.style.display = 'block';
    return;
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/api/system-admin/documents/${id}/update`;
  [['document_name', name], ['description', description], ['price', price], ['processing_days', days], ['is_active', is_active]].forEach(([k, v]) => {
    const inp = document.createElement('input'); inp.type = 'hidden'; inp.name = k; inp.value = v; form.appendChild(inp);
  });
  document.body.appendChild(form);
  form.submit();
}

// Close modal on backdrop click
document.addEventListener('DOMContentLoaded', function () {
  const modal = document.getElementById('editDocModal');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === this) closeEditDocModal();
    });
  }
});

function decodeHtml(v) { const t = document.createElement('textarea'); t.innerHTML = v; return t.value; }

async function deleteDocument(id, name) {
  showDeleteModal({
    title: '🗑 Delete Document',
    message: `Delete "${name}" from document types?`,
    onConfirm: async () => {
      const res = await fetch(`/api/system-admin/documents/${id}/delete`, { method: 'POST' });
      if (res.ok) {
        await refreshAll();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Could not delete document.');
      }
    }
  });
}

window.updateUserRole = updateUserRole;
window.deleteUser = deleteUser;
window.editDocument = editDocument;
window.deleteDocument = deleteDocument;
window.closeEditDocModal = closeEditDocModal;
window.submitEditDoc = submitEditDoc;

async function refreshAll() { await Promise.all([loadCounts(), loadDocuments(), loadUsers()]); }

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.emit('join:role', 'system_admin');
  socket.on('dashboard:refresh', refreshAll);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadMe();
  await refreshAll();
  connectSocket();
});
