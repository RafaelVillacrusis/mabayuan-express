const express = require('express');
const path = require('path');
const pool = require('../db');
const { requireRole, forgetUserRole } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const {
  getRoleCounts,
  getRequestsByRole,
  getRequestById,
  getRequestLogs,
  createRequestLog
} = require('../actions/request.actions');
const {
  createResidentNotification,
  refreshRoleDashboards,
  sendCaptainMessage,
  getCaptainMessages
} = require('../actions/notification.actions');
const { getFilteredAuditLogs, createAuditLog } = require('../actions/audit.actions');
const { sendRequestApprovedEmail, sendRequestDeclinedEmail } = require('../actions/email.actions');

const { sendStoredFile, FILE_NOT_FOUND_PAGE, uploadToStorage, removeFromStorage } = require('../actions/upload.actions');
const multer = require('multer');
const announcementUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('image');
const ANNOUNCEMENT_IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;
const docs = require('../actions/document.actions');

const router = express.Router();

router.get('/captain/dashboard', requireRole('captain'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/captain_dashboard.html'));
});

router.get('/captain/request/:id', requireRole('captain'), (req, res) => {
  res.sendFile(path.join(__dirname, '../dashboards/captain_request.html'));
});

router.get('/api/captain/me', requireRole('captain'), (req, res) =>
  res.json(req.session.user)
);

router.get('/api/captain/counts', requireRole('captain'), async (req, res) =>
  res.json(await getRoleCounts('captain'))
);

router.get('/api/captain/requests', requireRole('captain'), async (req, res) => {
  const status    = req.query.status    || 'all';
  const search    = (req.query.search   || '').trim().toLowerCase();
  const date_from = req.query.date_from || '';
  const date_to   = req.query.date_to   || '';
  let rows = await getRequestsByRole('captain', status);
  if (search) {
    rows = rows.filter(r =>
      (r.transaction_no || '').toLowerCase().includes(search) ||
      (r.resident_name  || '').toLowerCase().includes(search) ||
      (r.document_name  || '').toLowerCase().includes(search)
    );
  }
  if (date_from) rows = rows.filter(r => r.created_at && new Date(r.created_at).toISOString().slice(0,10) >= date_from);
  if (date_to)   rows = rows.filter(r => r.created_at && new Date(r.created_at).toISOString().slice(0,10) <= date_to);
  res.json(rows);
});

router.get('/api/captain/requests/:id', requireRole('captain'), async (req, res) => {
  const request = await getRequestById(req.params.id);
  const logs = await getRequestLogs(req.params.id);
  res.json({ request, logs });
});

// Valid ID the resident uploaded with this request
router.get('/api/captain/requests/:id/valid-id', requireRole('captain'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT valid_id_path FROM requests WHERE request_id = $1 LIMIT 1', [req.params.id]);
    if (!rows.length || !(await sendStoredFile(res, rows[0].valid_id_path))) res.status(404).send(FILE_NOT_FOUND_PAGE);
  } catch (err) {
    console.error('Request valid ID error:', err);
    if (!res.headersSent) res.status(500).send('Could not load the valid ID.');
  }
});

router.post('/api/captain/requests/:id/decision', requireRole('captain'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const { decision, captain_notes } = req.body;

    const request = await getRequestById(requestId);
    if (!request) return res.status(404).send('Request not found.');

    // Only requests still waiting for the Captain can be decided — prevents resetting
    // requests that staff already processed (e.g. Ready for Pickup / Claimed)
    if (!['approve', 'decline'].includes(decision)) return res.status(400).send('Invalid decision.');
    if (request.status !== 'Pending Approval') {
      return res.redirect(`/captain/request/${requestId}?error=${encodeURIComponent('This request has already been decided.')}`);
    }
    if (decision === 'decline' && !(captain_notes || '').trim()) {
      return res.redirect(`/captain/request/${requestId}?error=${encodeURIComponent('Please give a reason when declining a request.')}`);
    }

    const newStatus = decision === 'approve' ? 'Approved' : 'Declined';

    // ✅ PostgreSQL-safe UPDATE (NO updated_at here)
    await pool.query(
      `
      UPDATE requests
      SET
        status = $1,
        captain_notes = $2,
        reviewed_by = $3
      WHERE request_id = $4
      `,
      [
        newStatus,
        captain_notes || null,
        req.session.user.user_id,
        requestId
      ]
    );

    await createRequestLog({
      requestId,
      actionType: decision === 'approve'
        ? 'CAPTAIN_APPROVE'
        : 'CAPTAIN_DECLINE',
      oldStatus: request.status,
      newStatus,
      remarks: captain_notes || null,
      changedByUserId: req.session.user.user_id,
      changedByRole: 'captain'
    });

    await createResidentNotification({
      residentId: request.resident_id,
      requestId,
      title: `Request ${decision === 'approve' ? 'approved' : 'declined'}`,
      message: `${request.document_name} request was ${
        decision === 'approve'
          ? 'approved by the captain and forwarded to staff'
          : 'declined by the captain'
      }.`
    });

    // Send email to resident
    if (decision === 'approve') {
      await sendRequestApprovedEmail({
        firstName: request.first_name,
        lastName: request.last_name,
        email: request.email,
        documentName: request.document_name,
        transactionNo: request.transaction_no
      });
    } else {
      await sendRequestDeclinedEmail({
        firstName: request.first_name,
        lastName: request.last_name,
        email: request.email,
        documentName: request.document_name,
        transactionNo: request.transaction_no,
        captainNotes: captain_notes || null
      });
    }

    refreshRoleDashboards('captain', 'staff', 'system_admin');
    res.redirect(`/captain/request/${requestId}?saved=1`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Could not update request.');
  }
});

// ── Analytics dashboard page ──────────────────────────────────────────────────
router.get('/captain/analytics', requireRole('captain'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/captain_analytics.html'))
);

// Graph 2 – requests grouped by document type (with optional date range)
router.get('/api/captain/analytics/by-document', requireRole('captain'), async (req, res) => {
  try {
    const { date_from = '', date_to = '' } = req.query;
    const conditions = [`status IN ('Pending Approval','Approved','Declined','Ready for Pickup','Claimed')`];
    const params = [];

    if (date_from) { params.push(date_from); conditions.push(`DATE(r.created_at) >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conditions.push(`DATE(r.created_at) <= $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT d.document_name, COUNT(r.request_id)::int AS request_count
       FROM requests r
       JOIN documents d ON d.document_id = r.document_id
       ${where}
       GROUP BY d.document_name
       ORDER BY request_count DESC
       LIMIT 15`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load document analytics.' }); }
});

// Graph 3 – daily request volume (submitted / approved / declined) with optional date range
router.get('/api/captain/analytics/volume-over-time', requireRole('captain'), async (req, res) => {
  try {
    const { date_from = '', date_to = '' } = req.query;
    const conditions = [`status IN ('Pending Approval','Approved','Declined','Ready for Pickup','Claimed')`];
    const params = [];

    if (date_from) { params.push(date_from); conditions.push(`DATE(r.created_at) >= $${params.length}`); }
    if (date_to)   { params.push(date_to);   conditions.push(`DATE(r.created_at) <= $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(DATE(r.created_at), 'Mon DD') AS date,
         DATE(r.created_at) AS raw_date,
         COUNT(*)::int AS total,
         SUM(CASE WHEN r.status IN ('Approved','Ready for Pickup','Claimed') THEN 1 ELSE 0 END)::int AS approved,
         SUM(CASE WHEN r.status = 'Declined' THEN 1 ELSE 0 END)::int AS declined
       FROM requests r
       ${where}
       GROUP BY DATE(r.created_at)
       ORDER BY raw_date ASC
       LIMIT 90`,
      params
    );
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load volume analytics.' }); }
});

// ── Audit trail ───────────────────────────────────────────────────────────────
router.get('/captain/audit-trail', requireRole('captain'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/captain_audit_trail.html'))
);

router.get('/api/captain/audit-trail', requireRole('captain'), async (req, res) => {
  try {
    const { search = '', action = '', date_from = '', date_to = '' } = req.query;

    // Fetch request_logs joined with requests + residents so captain sees staff actions
    const conditions = [];
    const params = [];

    // Scope: only request-level logs (staff + captain actions on requests)
    conditions.push(`rl.changed_by_role IN ('staff','captain')`);

    if (action) {
      params.push(action);
      conditions.push(`rl.action_type = $${params.length}`);
    }

    if (date_from) {
      params.push(date_from);
      conditions.push(`DATE(rl.created_at) >= $${params.length}`);
    }

    if (date_to) {
      params.push(date_to);
      conditions.push(`DATE(rl.created_at) <= $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      const i = params.length;
      conditions.push(`(r.transaction_no ILIKE $${i-2} OR r.document_name ILIKE $${i-1} OR (res.last_name || ', ' || res.first_name) ILIKE $${i})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         rl.log_id,
         rl.action_type,
         rl.old_status,
         rl.new_status,
         rl.old_release_date,
         rl.new_release_date,
         rl.remarks,
         rl.changed_by_role,
         rl.created_at,
         r.transaction_no,
         r.document_name,
         res.last_name || ', ' || res.first_name AS resident_name,
         u.full_name AS changed_by_name
       FROM request_logs rl
       JOIN requests r   ON r.request_id   = rl.request_id
       JOIN residents res ON res.resident_id = r.resident_id
       LEFT JOIN users u  ON u.user_id       = rl.changed_by_user_id
       ${where}
       ORDER BY rl.created_at DESC, rl.log_id DESC
       LIMIT 300`,
      params
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load audit trail.' });
  }
});

router.get('/captain/messages', requireRole('captain'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/captain_messages.html'))
);

router.get('/api/captain/messages', requireRole('captain'), async (req, res) => {
  try {
    const messages = await getCaptainMessages({ limit: 100 });
    res.json(messages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load messages.' });
  }
});

// Dates from the form are Philippine time (UTC+8, no daylight saving)
const PH_OFFSET = '+08:00';
function parsePhDateTime(v) {           // "YYYY-MM-DDTHH:mm"
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00${PH_OFFSET}`);
  return isNaN(d) ? null : d;
}
function endOfPhDay(v) {                // "YYYY-MM-DD" → start of the next day, PH time
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00${PH_OFFSET}`);
  if (isNaN(d)) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// Accepts JSON (text only) or multipart form data with an optional "image" file
router.post('/api/captain/messages', requireRole('captain'), (req, res, next) => {
  announcementUpload(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'The image must be 5MB or smaller.' : 'The image upload failed. Please try again.';
      return res.status(400).json({ error: msg, field: 'image' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { target_audience, subject, body, publish_at, expires_on } = req.body;
    const hasImage = !!req.file;
    if (!target_audience || !subject || !String(subject).trim()) {
      return res.status(400).json({ error: 'Please enter a subject.', field: 'subject' });
    }
    if (!hasImage && (!body || !String(body).trim())) {
      return res.status(400).json({ error: 'Please write a message or add an image.', field: 'body' });
    }
    if (String(subject).trim().length > 200) return res.status(400).json({ error: 'The subject must be 200 characters or fewer.', field: 'subject' });
    if (String(body || '').trim().length > 2000) return res.status(400).json({ error: 'The message must be 2,000 characters or fewer.', field: 'body' });
    if (hasImage && !ANNOUNCEMENT_IMAGE_MIME.test(req.file.mimetype)) {
      return res.status(400).json({ error: 'The image must be a JPG, PNG, WEBP or GIF file.', field: 'image' });
    }
    const validAudiences = ['resident', 'staff', 'all'];
    if (!validAudiences.includes(target_audience)) {
      return res.status(400).json({ error: 'Invalid target_audience.' });
    }

    // Optional schedule
    let publishAt = null;
    if (publish_at) {
      publishAt = parsePhDateTime(publish_at);
      if (!publishAt) return res.status(400).json({ error: 'Please choose a valid publish date and time.', field: 'publish_at' });
      if (publishAt < new Date(Date.now() - 60 * 1000)) return res.status(400).json({ error: 'The publish date and time has already passed. Choose a future time, or select "Post now".', field: 'publish_at' });
      if (publishAt > new Date(Date.now() + 366 * 86400000)) return res.status(400).json({ error: 'Announcements can be scheduled up to one year ahead.', field: 'publish_at' });
    }

    // Optional expiry — the announcement stays visible through the whole chosen day
    let expiresAt = null;
    if (expires_on) {
      expiresAt = endOfPhDay(expires_on);
      if (!expiresAt) return res.status(400).json({ error: 'Please choose a valid expiry date.', field: 'expires_on' });
      const start = publishAt && publishAt > new Date() ? publishAt : new Date();
      if (expiresAt <= start) return res.status(400).json({ error: 'The expiry date must be on or after the day the announcement is published.', field: 'expires_on' });
    }

    let imagePath = null;
    if (hasImage) {
      imagePath = await uploadToStorage(req.file, 'announcements', `captain-${req.session.user.user_id}`);
      if (!imagePath) return res.status(500).json({ error: 'The image could not be saved. Please try again.', field: 'image' });
    }

    let msg;
    try {
      msg = await sendCaptainMessage({
        captainUserId: req.session.user.user_id,
        targetAudience: target_audience,
        subject: String(subject).trim(),
        body: String(body || '').trim(),
        publishAt,
        expiresAt,
        imagePath
      });
    } catch (err) {
      if (imagePath) removeFromStorage(imagePath);   // don't leave an orphaned image
      throw err;
    }

    res.json({ ok: true, message_id: msg.message_id, scheduled: msg.scheduled, publish_at: msg.publish_at, expires_at: msg.expires_at, has_image: !!imagePath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send message.' });
  }
});

// Cancel a scheduled announcement (deletes it) or take a live one down now
router.post('/api/captain/messages/:id/end', requireRole('captain'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT message_id, subject, COALESCE(publish_at, created_at) AS publish_at, expires_at, image_path
       FROM captain_messages WHERE message_id = $1`, [req.params.id]);
    const msg = rows[0];
    if (!msg) return res.status(404).json({ error: 'Announcement not found.' });

    let action;
    if (new Date(msg.publish_at) > new Date()) {
      await pool.query('DELETE FROM captain_messages WHERE message_id = $1', [msg.message_id]);
      if (msg.image_path) removeFromStorage(msg.image_path);
      action = 'cancelled';
    } else if (msg.expires_at && new Date(msg.expires_at) <= new Date()) {
      return res.status(400).json({ error: 'This announcement has already expired.' });
    } else {
      await pool.query('UPDATE captain_messages SET expires_at = NOW() WHERE message_id = $1', [msg.message_id]);
      action = 'ended';
    }

    await createAuditLog({
      actorUserId: req.session.user.user_id,
      actorRole: 'captain',
      targetType: 'captain_message',
      targetId: msg.message_id,
      action: action === 'cancelled' ? 'CAPTAIN_MESSAGE_CANCELLED' : 'CAPTAIN_MESSAGE_ENDED',
      description: `Captain ${action === 'cancelled' ? 'cancelled scheduled' : 'took down'} announcement "${msg.subject}".`,
      metadata: {}
    });
    refreshRoleDashboards('resident', 'staff', 'captain');
    res.json({ ok: true, action });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update the announcement.' });
  }
});

/* ================= DOCUMENT CONFIGURATION ================= */
router.get('/captain/documents', requireRole('captain'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/captain_documents.html'))
);

router.get('/api/captain/documents', requireRole('captain'), async (req, res) => {
  try { res.json(await docs.listDocumentsWithUsage()); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Could not load documents.' }); }
});

router.post('/api/captain/documents', requireRole('captain'), async (req, res) => {
  try {
    const v = await docs.validateDocument(req.body);
    if (v.error) return res.status(400).json(v);
    const doc = await docs.createDocument(req.session.user, v.data);
    res.json({ ok: true, document: doc });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not add the document.' }); }
});

router.put('/api/captain/documents/:id', requireRole('captain'), async (req, res) => {
  try {
    const v = await docs.validateDocument(req.body, Number(req.params.id));
    if (v.error) return res.status(400).json(v);
    const doc = await docs.updateDocument(req.session.user, req.params.id, v.data);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    res.json({ ok: true, document: doc });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not save the document.' }); }
});

router.delete('/api/captain/documents/:id', requireRole('captain'), async (req, res) => {
  try {
    const r = await docs.deleteDocument(req.session.user, req.params.id);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not delete the document.' }); }
});

/* ================= RBAC (personnel accounts) =================
 * The Captain manages Staff and Captain accounts. System Admin accounts are
 * view-only here, and the Captain can't change their own role or delete themselves.
 */
const CAPTAIN_MANAGEABLE = ['staff', 'captain'];
const ROLE_NAMES = { staff: 'Staff', captain: 'Captain', system_admin: 'System Admin' };

router.get('/captain/rbac', requireRole('captain'), (req, res) =>
  res.sendFile(path.join(__dirname, '../dashboards/captain_rbac.html'))
);

router.get('/api/captain/users', requireRole('captain'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT user_id, full_name, email, role, created_at FROM users ORDER BY
         CASE role WHEN 'system_admin' THEN 0 WHEN 'captain' THEN 1 ELSE 2 END, full_name ASC`);
    const me = Number(req.session.user.user_id);
    res.json(rows.map(u => ({
      ...u,
      is_self: u.user_id === me,
      can_manage: u.user_id !== me && CAPTAIN_MANAGEABLE.includes(u.role),
    })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not load accounts.' }); }
});

async function loadManageableUser(req, res) {
  const targetId = Number(req.params.id);
  if (targetId === Number(req.session.user.user_id)) {
    res.status(400).json({ error: 'You cannot change or remove your own account here.' });
    return null;
  }
  const { rows: [user] } = await pool.query('SELECT user_id, full_name, email, role FROM users WHERE user_id = $1', [targetId]);
  if (!user) { res.status(404).json({ error: 'Account not found.' }); return null; }
  if (!CAPTAIN_MANAGEABLE.includes(user.role)) {
    res.status(403).json({ error: 'System Admin accounts can only be managed by a System Admin.' });
    return null;
  }
  return user;
}

router.post('/api/captain/users', requireRole('captain'), async (req, res) => {
  try {
    const full_name = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = req.body.role;
    if (full_name.length < 3) return res.status(400).json({ error: 'Please enter the full name.', field: 'full_name' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
    if (!CAPTAIN_MANAGEABLE.includes(role)) return res.status(400).json({ error: 'Choose Staff or Captain. Only a System Admin can create System Admin accounts.', field: 'role' });
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ error: 'The password must be at least 8 characters and include a letter and a number.', field: 'password' });
    }
    const { rows: existing } = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.length) return res.status(400).json({ error: 'An account with this email already exists.', field: 'email' });

    const hash = await bcrypt.hash(password, 10);
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING user_id`,
      [full_name, email, hash, role]);
    await createAuditLog({
      actorUserId: req.session.user.user_id, actorRole: 'captain', targetType: 'user', targetId: user.user_id,
      action: 'USER_CREATED', description: `Captain created ${ROLE_NAMES[role]} account for ${full_name}.`, metadata: { email, role },
    });
    refreshRoleDashboards('system_admin', 'captain');
    res.json({ ok: true, user_id: user.user_id });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not create the account.' }); }
});

router.post('/api/captain/users/:id/role', requireRole('captain'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!CAPTAIN_MANAGEABLE.includes(role)) return res.status(400).json({ error: 'You can assign the Staff or Captain role only.' });
    const user = await loadManageableUser(req, res);
    if (!user) return;
    if (user.role === role) return res.json({ ok: true, unchanged: true });
    await pool.query('UPDATE users SET role = $1 WHERE user_id = $2', [role, user.user_id]);
    forgetUserRole(user.user_id);
    await createAuditLog({
      actorUserId: req.session.user.user_id, actorRole: 'captain', targetType: 'user', targetId: user.user_id,
      action: 'USER_ROLE_UPDATED',
      description: `Captain changed ${user.full_name}'s role from ${ROLE_NAMES[user.role]} to ${ROLE_NAMES[role]}.`,
      metadata: { old_role: user.role, new_role: role, email: user.email },
    });
    refreshRoleDashboards('system_admin', 'staff', 'captain');
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Could not change the role.' }); }
});

router.delete('/api/captain/users/:id', requireRole('captain'), async (req, res) => {
  try {
    const user = await loadManageableUser(req, res);
    if (!user) return;
    await pool.query('DELETE FROM users WHERE user_id = $1', [user.user_id]);
    forgetUserRole(user.user_id);
    await createAuditLog({
      actorUserId: req.session.user.user_id, actorRole: 'captain', targetType: 'user', targetId: user.user_id,
      action: 'USER_DELETED', description: `Captain deleted ${ROLE_NAMES[user.role]} account for ${user.full_name}.`,
      metadata: { email: user.email, role: user.role },
    });
    refreshRoleDashboards('system_admin', 'staff', 'captain');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the account. It may be linked to existing records.' });
  }
});

module.exports = router;