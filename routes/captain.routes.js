const express = require('express');
const path = require('path');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
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
const { getFilteredAuditLogs } = require('../actions/audit.actions');
const { sendRequestApprovedEmail, sendRequestDeclinedEmail } = require('../actions/email.actions');

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
  if (date_from) rows = rows.filter(r => r.created_at && r.created_at.slice(0,10) >= date_from);
  if (date_to)   rows = rows.filter(r => r.created_at && r.created_at.slice(0,10) <= date_to);
  res.json(rows);
});

router.get('/api/captain/requests/:id', requireRole('captain'), async (req, res) => {
  const request = await getRequestById(req.params.id);
  const logs = await getRequestLogs(req.params.id);
  res.json({ request, logs });
});

router.post('/api/captain/requests/:id/decision', requireRole('captain'), async (req, res) => {
  try {
    const requestId = req.params.id;
    const { decision, captain_notes } = req.body;

    const request = await getRequestById(requestId);
    if (!request) return res.status(404).send('Request not found.');

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

router.post('/api/captain/messages', requireRole('captain'), async (req, res) => {
  try {
    const { target_audience, subject, body } = req.body;
    if (!target_audience || !subject || !body) {
      return res.status(400).json({ error: 'target_audience, subject, and body are required.' });
    }
    const validAudiences = ['resident', 'staff', 'all'];
    if (!validAudiences.includes(target_audience)) {
      return res.status(400).json({ error: 'Invalid target_audience.' });
    }

    const msg = await sendCaptainMessage({
      captainUserId: req.session.user.user_id,
      targetAudience: target_audience,
      subject: subject.trim(),
      body: body.trim()
    });

    res.json({ ok: true, message_id: msg.message_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not send message.' });
  }
});

module.exports = router;