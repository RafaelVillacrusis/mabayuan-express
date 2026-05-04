const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { getRoleCounts, getRequestsByRole } = require('../actions/request.actions');
const { getRecentAuditLogs, getFilteredAuditLogs, createAuditLog } = require('../actions/audit.actions');
const { refreshRoleDashboards } = require('../actions/notification.actions');

const router = express.Router();

router.get('/system-admin/dashboard', requireRole('system_admin'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/system_admin_dashboard.html'));
});

router.get('/system-admin/audit-trail', requireRole('system_admin'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/system_admin_audit_trail.html'));
});

router.get('/system-admin/recent-requests', requireRole('system_admin'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/system_admin_recent_requests.html'));
});

// 4.1 Role-Based Access Control (RBAC) page
router.get('/system-admin/rbac', requireRole('system_admin'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/system_admin_rbac.html'));
});

router.get('/api/system-admin/me', requireRole('system_admin'), (req, res) => {
  res.json(req.session.user);
});

router.get('/api/system-admin/counts', requireRole('system_admin'), async (req, res) => {
  const counts = await getRoleCounts('system_admin');
  const { rows: [documents] } = await pool.query(`SELECT COUNT(*) AS total_documents FROM documents WHERE is_active = true`);
  const { rows: [users] } = await pool.query(`SELECT COUNT(*) AS total_users FROM users`);
  const { rows: [residents] } = await pool.query(`SELECT COUNT(*) AS total_residents FROM residents`);
  res.json({
    ...counts,
    total_documents: documents.total_documents,
    total_users: users.total_users,
    total_residents: residents.total_residents
  });
});

router.get('/api/system-admin/requests', requireRole('system_admin'), async (req, res) => {
  const rows = await getRequestsByRole('system_admin', req.query.status || 'all');
  res.json(rows);
});

router.get('/api/system-admin/documents', requireRole('system_admin'), async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM documents ORDER BY is_active DESC, document_name ASC`);
  res.json(rows);
});

router.post('/api/system-admin/documents', requireRole('system_admin'), async (req, res) => {
  const { document_name, description, price, processing_days, is_active } = req.body;
  const isActiveBool = Boolean(Number(is_active ?? 1));
  const { rows: [result] } = await pool.query(
    `INSERT INTO documents (document_name, description, price, processing_days, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING document_id`,
    [document_name, description || null, Number(price || 0), Number(processing_days || 0), isActiveBool]
  );
  await createAuditLog({
    actorUserId: req.session.user.user_id,
    actorRole: 'system_admin',
    targetType: 'document',
    targetId: result.document_id,
    action: 'DOCUMENT_CREATED',
    description: `System admin created document type ${document_name}.`,
    metadata: { price: Number(price || 0), processing_days: Number(processing_days || 0), is_active: isActiveBool }
  });
  refreshRoleDashboards('system_admin', 'resident', 'staff', 'captain');
  res.redirect('/system-admin/dashboard?saved=1');
});

router.post('/api/system-admin/documents/:id/update', requireRole('system_admin'), async (req, res) => {
  const { document_name, description, price, processing_days, is_active } = req.body;
  const isActiveBool = Boolean(Number(is_active ?? 0));
  await pool.query(
    `UPDATE documents
     SET document_name = $1, description = $2, price = $3, processing_days = $4, is_active = $5
     WHERE document_id = $6`,
    [document_name, description || null, Number(price || 0), Number(processing_days || 0), isActiveBool, req.params.id]
  );
  await createAuditLog({
    actorUserId: req.session.user.user_id,
    actorRole: 'system_admin',
    targetType: 'document',
    targetId: req.params.id,
    action: 'DOCUMENT_UPDATED',
    description: `System admin updated document type ${document_name}.`,
    metadata: { price: Number(price || 0), processing_days: Number(processing_days || 0), is_active: isActiveBool }
  });
  refreshRoleDashboards('system_admin', 'resident', 'staff', 'captain');
  res.redirect('/system-admin/dashboard?saved=1');
});

router.get('/api/system-admin/users', requireRole('system_admin'), async (req, res) => {
  const { rows } = await pool.query(`SELECT user_id, full_name, email, role, created_at FROM users ORDER BY created_at DESC`);
  res.json(rows);
});

router.post('/api/system-admin/users', requireRole('system_admin'), async (req, res) => {
  const { full_name, email, password, role } = req.body;
  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  const { rows: existing } = await pool.query('SELECT user_id FROM users WHERE email=$1', [email]);
  if (existing.length) return res.status(400).json({ error: 'Email already exists.' });
  const hash = await bcrypt.hash(password, 10);
  const { rows: [result] } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING user_id`,
    [full_name, email, hash, role]
  );
  await createAuditLog({
    actorUserId: req.session.user.user_id,
    actorRole: 'system_admin',
    targetType: 'user',
    targetId: result.user_id,
    action: 'USER_CREATED',
    description: `System admin created ${role} account for ${full_name}.`,
    metadata: { email, role }
  });
  refreshRoleDashboards('system_admin');
  res.json({ ok: true, user_id: result.user_id });
});

router.post('/api/system-admin/users/:id/update-role', requireRole('system_admin'), async (req, res) => {
  const targetId = Number(req.params.id);
  const { role } = req.body;
  if (targetId === Number(req.session.user.user_id) && role !== 'system_admin') {
    return res.status(400).json({ error: 'You cannot remove your own system admin role.' });
  }
  const { rows: [existing] } = await pool.query(
    `SELECT user_id, full_name, email, role FROM users WHERE user_id = $1 LIMIT 1`,
    [targetId]
  );
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  await pool.query(`UPDATE users SET role = $1 WHERE user_id = $2`, [role, targetId]);
  await createAuditLog({
    actorUserId: req.session.user.user_id,
    actorRole: 'system_admin',
    targetType: 'user',
    targetId,
    action: 'USER_ROLE_UPDATED',
    description: `System admin changed ${existing.full_name}'s role from ${existing.role} to ${role}.`,
    metadata: { old_role: existing.role, new_role: role, email: existing.email }
  });
  refreshRoleDashboards('system_admin', 'staff', 'captain');
  res.json({ ok: true });
});

router.post('/api/system-admin/users/:id/delete', requireRole('system_admin'), async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === Number(req.session.user.user_id)) {
    return res.status(400).json({ error: 'You cannot delete your own account.' });
  }
  const { rows: [existing] } = await pool.query(
    `SELECT user_id, full_name, email, role FROM users WHERE user_id = $1 LIMIT 1`,
    [targetId]
  );
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  await pool.query(`DELETE FROM users WHERE user_id = $1`, [targetId]);
  await createAuditLog({
    actorUserId: req.session.user.user_id,
    actorRole: 'system_admin',
    targetType: 'user',
    targetId,
    action: 'USER_DELETED',
    description: `System admin deleted ${existing.role} account for ${existing.full_name}.`,
    metadata: { email: existing.email, role: existing.role }
  });
  refreshRoleDashboards('system_admin', 'staff', 'captain');
  res.json({ ok: true });
});

router.get('/api/system-admin/audit-logs', requireRole('system_admin'), async (req, res) => {
  const hasFilters = req.query.actor || req.query.action || req.query.target_type || req.query.date_from || req.query.date_to;
  const rows = hasFilters
    ? await getFilteredAuditLogs({
        actor: req.query.actor || '',
        action: req.query.action || '',
        targetType: req.query.target_type || '',
        dateFrom: req.query.date_from || '',
        dateTo: req.query.date_to || '',
        limit: req.query.limit || 100
      })
    : await getRecentAuditLogs(req.query.limit || 50);
  res.json(rows);
});

router.get('/api/system-admin/backup', requireRole('system_admin'), async (req, res) => {
  const { rows: users } = await pool.query(`SELECT user_id, full_name, email, role, created_at FROM users ORDER BY user_id ASC`);
  const { rows: residents } = await pool.query(`SELECT resident_id, first_name, middle_name, last_name, email, status, birth_date, phone_number, address, valid_id_path, created_at FROM residents ORDER BY resident_id ASC`);
  const { rows: documents } = await pool.query(`SELECT * FROM documents ORDER BY document_id ASC`);
  const { rows: requests } = await pool.query(`SELECT * FROM requests ORDER BY request_id ASC`);
  const { rows: notifications } = await pool.query(`SELECT * FROM notifications ORDER BY notification_id ASC`);
  const { rows: requestLogs } = await pool.query(`SELECT * FROM request_logs ORDER BY log_id ASC`);
  const { rows: auditLogs } = await pool.query(`SELECT * FROM audit_logs ORDER BY audit_id ASC`);

  await createAuditLog({
    actorUserId: req.session.user.user_id,
    actorRole: 'system_admin',
    targetType: 'system',
    action: 'BACKUP_EXPORTED',
    description: 'System admin exported a JSON backup.',
    metadata: { users: users.length, residents: residents.length, documents: documents.length, requests: requests.length }
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="mabayuan_express_backup_${new Date().toISOString().slice(0,10)}.json"`);
  res.send(JSON.stringify({ exported_at: new Date().toISOString(), users, residents, documents, requests, notifications, request_logs: requestLogs, audit_logs: auditLogs }, null, 2));
});

module.exports = router;
