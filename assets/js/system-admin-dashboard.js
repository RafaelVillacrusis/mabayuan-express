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
      <td><button class="btn btn-small btn-ghost" onclick="editDocument(${row.document_id},'${escapeHtml(row.document_name).replace(/'/g,"&#39;")}','${escapeHtml(row.description||'').replace(/'/g,"&#39;")}','${row.price}','${row.processing_days}','${row.is_active}')">Edit</button></td>
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
  if (!confirm('Delete this user account? This cannot be undone.')) return;
  const res = await fetch(`/api/system-admin/users/${id}/delete`, { method:'POST' });
  if (!res.ok) { const d = await res.json().catch(()=>({})); alert(d.error || 'Could not delete user.'); }
  await refreshAll();
}

function editDocument(id, name, description, price, days, active) {
  const newName = prompt('Document name', decodeHtml(name));
  if (newName === null || !newName.trim()) return;
  const newDescription = prompt('Description', decodeHtml(description || ''));
  if (newDescription === null) return;
  const newPrice = prompt('Price (₱)', price);
  if (newPrice === null) return;
  const newDays = prompt('Processing days', days);
  if (newDays === null) return;
  const newActive = confirm('Set as Active? (Cancel = Inactive)') ? 1 : 0;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `/api/system-admin/documents/${id}/update`;
  [['document_name',newName],['description',newDescription],['price',newPrice],['processing_days',newDays],['is_active',newActive]].forEach(([k,v]) => {
    const inp = document.createElement('input'); inp.type='hidden'; inp.name=k; inp.value=v; form.appendChild(inp);
  });
  document.body.appendChild(form);
  form.submit();
}

function decodeHtml(v) { const t = document.createElement('textarea'); t.innerHTML = v; return t.value; }
window.updateUserRole = updateUserRole;
window.deleteUser = deleteUser;
window.editDocument = editDocument;

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
