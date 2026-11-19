/* Captain — User Access (RBAC): view personnel, add / re-role / remove Staff and Captain accounts */
(function () {
  const $ = id => document.getElementById(id);
  const ROLE = { system_admin: 'System Admin', captain: 'Captain', staff: 'Staff' };
  let users = [];
  let roleFilter = 'all';
  let toastTimer;

  function toast(msg) {
    const t = $('rbToast');
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
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

  // ── List ───────────────────────────────────────────────────────────────────
  async function load() {
    try { users = await api('/api/captain/users'); }
    catch (e) { $('userRows').innerHTML = `<tr><td colspan="4" class="empty-state">${escapeHtml(e.message)}</td></tr>`; return; }
    render();
  }

  function render() {
    const count = r => users.filter(u => u.role === r).length;
    $('statTotal').textContent = users.length;
    $('statCaptain').textContent = count('captain');
    $('statStaff').textContent = count('staff');
    $('statAdmin').textContent = count('system_admin');
    document.querySelectorAll('#roleFilter [data-role]').forEach(b => b.classList.toggle('on', b.dataset.role === roleFilter));

    const q = $('userSearch').value.trim().toLowerCase();
    const rows = users.filter(u => (roleFilter === 'all' || u.role === roleFilter) &&
      (!q || `${u.full_name} ${u.email}`.toLowerCase().includes(q)));
    $('userResult').textContent = `${rows.length} of ${users.length} account${users.length === 1 ? '' : 's'}`;

    $('userRows').innerHTML = rows.length ? rows.map(u => {
      let manage;
      if (u.can_manage) {
        manage = `<select class="select" data-role-change="${u.user_id}" aria-label="Role for ${escapeHtml(u.full_name)}">
            <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
            <option value="captain" ${u.role === 'captain' ? 'selected' : ''}>Captain</option>
          </select>
          <button type="button" class="btn btn-small btn-ghost" data-remove="${u.user_id}" style="color:#b42318">🗑 Remove</button>`;
      } else if (u.is_self) {
        manage = '<span class="rb-locked">🔒 Your account</span>';
      } else {
        manage = '<span class="rb-locked" title="Only a System Admin can change System Admin accounts">🔒 Managed by System Admin</span>';
      }
      return `<tr>
        <td><div class="rb-user r-${u.role}"><span class="rb-avatar">${escapeHtml(initials(u.full_name))}</span>
          <div><strong>${escapeHtml(u.full_name)}${u.is_self ? '<span class="rb-you">You</span>' : ''}</strong><small>${escapeHtml(u.email)}</small></div></div></td>
        <td><span class="rb-pill r-${u.role}">${ROLE[u.role] || escapeHtml(u.role)}</span></td>
        <td style="white-space:nowrap">${u.created_at ? formatDate(u.created_at) : '—'}</td>
        <td><div class="rb-actions">${manage}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="4" class="empty-state">No accounts match.</td></tr>`;
  }

  // ── Change role ────────────────────────────────────────────────────────────
  async function changeRole(select) {
    const u = users.find(x => String(x.user_id) === select.dataset.roleChange);
    const newRole = select.value;
    if (!u || u.role === newRole) return;
    const msg = newRole === 'captain'
      ? `Make ${u.full_name} a Captain?\n\nThey will be able to approve or decline requests, configure documents and manage Staff and Captain accounts.`
      : `Change ${u.full_name} to Staff?\n\nThey will lose Captain access (approvals, documents, user access) within 30 seconds.`;
    if (!confirm(msg)) { select.value = u.role; return; }
    select.disabled = true;
    try {
      await api(`/api/captain/users/${u.user_id}/role`, { method: 'POST', body: JSON.stringify({ role: newRole }) });
      toast(`✅ ${u.full_name} is now ${ROLE[newRole]}`);
    } catch (e) {
      alert(e.message);
    }
    await load();
  }

  function removeUser(u) {
    showDeleteModal({
      title: '🗑 Remove account',
      message: `Remove ${u.full_name}'s ${ROLE[u.role]} account (${u.email})? They will be signed out and can no longer log in.`,
      onConfirm: async () => {
        try {
          await api(`/api/captain/users/${u.user_id}`, { method: 'DELETE' });
          toast(`🗑 ${u.full_name}'s account was removed`);
        } catch (e) { alert(e.message); }
        await load();
      },
    });
  }

  // ── Add user modal ─────────────────────────────────────────────────────────
  function openModal() {
    ['uName', 'uEmail', 'uPassword'].forEach(id => { $(id).value = ''; $(id).classList.remove('bad'); });
    document.querySelector('input[name="uRole"][value="staff"]').checked = true;
    showError('');
    $('userModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('uName').focus(), 30);
  }
  function closeModal() {
    $('userModal').hidden = true;
    document.body.style.overflow = '';
  }
  function showError(msg, field) {
    $('userError').textContent = msg;
    $('userError').hidden = !msg;
    ['uName', 'uEmail', 'uPassword'].forEach(id => $(id).classList.remove('bad'));
    const el = { full_name: 'uName', email: 'uEmail', password: 'uPassword' }[field];
    if (el) { $(el).classList.add('bad'); $(el).focus(); }
  }
  function validate(d) {
    if (d.full_name.length < 3) return ['Please enter the full name.', 'full_name'];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return ['Please enter a valid email address.', 'email'];
    if (users.some(u => u.email.toLowerCase() === d.email)) return ['An account with this email already exists.', 'email'];
    if (d.password.length < 8 || !/[A-Za-z]/.test(d.password) || !/\d/.test(d.password)) return ['The password must be at least 8 characters and include a letter and a number.', 'password'];
    return null;
  }
  async function save(e) {
    e.preventDefault();
    const d = {
      full_name: $('uName').value.trim(),
      email: $('uEmail').value.trim().toLowerCase(),
      password: $('uPassword').value,
      role: document.querySelector('input[name="uRole"]:checked').value,
    };
    const problem = validate(d);
    if (problem) return showError(...problem);
    showError('');
    const btn = $('userSave');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      await api('/api/captain/users', { method: 'POST', body: JSON.stringify(d) });
      closeModal();
      toast(`✅ ${ROLE[d.role]} account created for ${d.full_name}`);
      await load();
    } catch (err) {
      showError(err.message, err.field);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Create account';
    }
  }

  // ── Wire up ────────────────────────────────────────────────────────────────
  $('addUserBtn').addEventListener('click', openModal);
  $('userForm').addEventListener('submit', save);
  $('userModal').addEventListener('click', e => { if (e.target.id === 'userModal' || e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('userModal').hidden) closeModal(); });
  $('pwdToggle').addEventListener('click', () => {
    const show = $('uPassword').type === 'password';
    $('uPassword').type = show ? 'text' : 'password';
    $('pwdToggle').textContent = show ? 'Hide' : 'Show';
  });
  $('userSearch').addEventListener('input', render);
  $('roleFilter').addEventListener('click', e => {
    const b = e.target.closest('[data-role]');
    if (!b) return;
    roleFilter = b.dataset.role;
    render();
  });
  $('userRows').addEventListener('change', e => { if (e.target.matches('[data-role-change]')) changeRole(e.target); });
  $('userRows').addEventListener('click', e => {
    const b = e.target.closest('[data-remove]');
    if (b) removeUser(users.find(u => String(u.user_id) === b.dataset.remove));
  });

  if (window.io) {
    const socket = io();
    socket.emit('join:role', 'captain');
    socket.on('dashboard:refresh', load);
  }
  load();
})();
